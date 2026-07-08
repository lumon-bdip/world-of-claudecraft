# 07: Steam account linking + achievement mirror (env-gated, dark by default)

STATUS: NOT STARTED

Read `docs/achievements/overview.md` first; it is authoritative (decisions in
section 1, canonical names in section 3). This file inherits everything there.
You are executing on Fable 5 at xhigh with ultracode: plan the whole session up
front, fan out reviewers at the end, and anchor every claim of done on a command
you actually ran.

## Goal

Ship the entire Steam integration for the Book of Deeds, dark: Steam account
LINKING (server-verified), a server-side achievement MIRROR that pushes a linked
account's deed unlocks to Steam via the publisher Web API, a reconcile-on-link
job, the desktop shell's ticket bridge, and the deed-to-achievement map. All of
it sits behind `STEAM_ENABLED` (default off) so the feature ships now and lights
up the day the Steamworks app exists, with zero further code changes.

## Hard constraints (maintainer, restated from overview section 1 decision 7)

1. Built FROM SCRATCH. Never consult, cherry-pick, or resurrect the old Steam
   prototype branches. If you find yourself reading `feature/electron-steam-*`
   history, stop.
2. Linking is allowed. LOGIN WITH STEAM IS FORBIDDEN. Login stays email +
   Discord only, everywhere, always. A `steam_links` row is a cosmetic-mirror
   pointer, never an identity or session source. You will write a test that
   pins this (see Acceptance).
3. Everything is env-gated OFF by default. The Steamworks app is not created
   yet; nothing in this slice may depend on it existing. `STEAM_APP_ID` and
   `STEAM_WEB_API_KEY` are read only when `STEAM_ENABLED=1`.

## Context to load (read these before writing code)

- `server/CLAUDE.md` (whole file: SQL-only-in-db-modules, the REST pipeline,
  endpoint rungs, error-code localization, FakeDb testing) and
  `server/http/CLAUDE.md` (RouteDef contract, registry, the DUAL-ARM rule for
  retained legacy routes).
- `server/db.ts`: the `wallet_links` DDL and its accessors (the link-table
  pattern to copy: one link per account, one account per external id, the row
  itself is the whole proof), `ensureSchema` and its advisory lock.
- `server/web_login_guard.ts` (`DESKTOP_APP_ORIGINS`; Origin is a client-class
  marker, never identity).
- `server/game.ts` `detectActivity` and the deed persistence recorder that the
  earlier server slice added (the mirror hooks in AFTER a `character_deeds`
  upsert resolves; do not add new db calls directly in `game.ts`, see Design).
- `electron/main.cjs` (the `trustedSender` gate: every `ipcMain.handle` checks
  it first), `electron/preload.cjs` (the `wocDesktop` contextBridge shape),
  `src/runtime.ts` (`DesktopBridge` optional-method typing: the login trio is
  required, everything newer is optional + feature-checked),
  `electron/desktop_config.cjs` (`DISTRIBUTIONS` website/steam, the packaged
  stamp), `scripts/electron-builder-config.mjs` (where `asarUnpack` goes).
- `ELECTRON-DESKTOP-AUDIT.md`: the macOS entitlement note
  (`com.apple.security.cs.disable-library-validation` is already planned for a
  Steam SDK build) and the warning that `steam_appid.txt` is dev-only and must
  NEVER ship in a packaged artifact.
- `server/steam/achievement_map.ts` source data: the `Steam:` columns in
  `docs/achievements/catalog/*.md`.

## Design spec

### 1. steam_links (db.ts, SCHEMA)

Copy the `wallet_links` shape, per the overview names table:

- `account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE`
- `steam_id TEXT NOT NULL UNIQUE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Additive, idempotent (`CREATE TABLE IF NOT EXISTS`), runs under the existing
advisory-lock boot. No realm column: links are account-global, like wallet and
Discord links. Accessors live in `db.ts` (or a `server/steam/steam_db.ts`
following the `*_db.ts` convention): `steamLinkForAccount`,
`accountForSteamId`, `insertSteamLink`, `deleteSteamLink`. Parameterized SQL
only.

### 2. Link routes (server/steam/, RouteDef modules)

Scaffold with `npm run new:endpoint` conventions; register the domain `routes`
in `server/http/registry.ts`. All three routes are AUTHENTICATED (bearer), all
hard-disabled unless `STEAM_ENABLED=1` with the stable code `steam.disabled`.

- `POST /api/steam/link` body `{ ticket }` (hex string, length-clamped).
  Flow: validate shape, rate-limit per account and IP (upstream verification
  is an external call; reuse the per-action limiter pattern), verify the
  ticket against the Steam Web API `ISteamUserAuth/AuthenticateUserTicket`
  (publisher key, `STEAM_APP_ID`, the agreed identity string `wocc-link`),
  require result OK. A ticket that fails verification or is malformed beyond
  the shape clamp -> `steam.invalid_ticket` (400). Reject VAC or publisher
  bans (`steam.banned`), extract `steamid`. Conflicts: account already
  linked -> `steam.already_linked` (409); steam id linked to another
  account -> `steam.account_taken` (409).
  Insert the row, fire the reconcile job (below), return the link status.
- `DELETE /api/steam/link`: delete the caller's row. Idempotent.
- `GET /api/steam/status`: `{ enabled, linked, steamId? }` for the caller.

Verification lives in a pure module (`server/steam/ticket.ts`: request
building, response parsing, ban rejection) with the IO shell separate, the
`wallet_link.ts` versus `wallet.ts` split named in `server/CLAUDE.md`. Error
codes are appended to `server/http/error_codes.ts`; each new `apiError.steam.*`
English leaf that is wordy needs its five non-Latin fills (zh, zh_TW, ja, ko,
ru) in the same change or M16 reds. That is the forced minimum; nothing else
gets translated (overview section 1 decision 8).

Capability advert: `GET /api/status` gains a `steam: { enabled }` field so no
client renders link UI when the flag is off. `/api/status` is a MIGRATED route
with a retained legacy twin: per the dual-arm rule in `server/http/CLAUDE.md`,
land the identical edit in BOTH arms in the same commit.

### 3. The achievement map (server/steam/achievement_map.ts)

`Record<string, string>` from deed id to `ACH_<UPPER_SNAKE>` name, transcribed
from the catalog's `Steam:` columns. Rules, each pinned by a test: at most 100
entries; ACH names unique and matching `^ACH_[A-Z0-9_]+$`; every key exists in
`DEEDS`; hidden deeds may appear (they become Steam-hidden achievements at App
Admin time). File comment states the stability contract: once an ACH name has
shipped to App Admin it is permanent; renames mean orphaned Steam unlocks.

### 4. The mirror writer (server/steam/mirror.ts)

An observer, never an authority: the sim decides unlocks, the persistence slice
records them, the mirror copies them outward. Hook point: after the
`character_deeds` upsert for a `deedUnlocked` event resolves in the recorder
added by the earlier server slice, call `mirror.onDeedRecorded(accountId,
deedId)`. Keep the hook inside that recorder module, NOT as a new db call in
`game.ts` (known trap: db calls added in `game.ts` break the private
bot-detector overlay mocks and must otherwise be fixed in BOTH copies).

Behavior: no-op unless `STEAM_ENABLED=1`, `deedId` is in the map, and the
account has a `steam_links` row (cache lookups per process with a short TTL).
Enqueue `(steamId, achName)` into an in-process FIFO with in-flight dedupe;
worker POSTs the publisher Web API `ISteamUserStats/SetUserStatsForGame`
(partner host, publisher key; verify the exact current parameter shape against
the live Steamworks docs when implementing, and note that SDK-era
`RequestCurrentStats` guidance is stale). Setting an already-set achievement is
idempotent on Steam's side; retries use capped exponential backoff (3 to 5
attempts), then drop with one warn log line (reconcile heals). The game loop
never awaits any of this.

Reconcile-on-link: after a successful `POST /api/steam/link`, query the
account's earned deeds from `character_deeds`, intersect with the map, enqueue
all of them. This is the Cogmind pattern: the server store is canonical, Steam
is a mirror that self-heals at link time. No periodic sweep in v1.

Secrets: `STEAM_WEB_API_KEY` is read from env inside `server/steam/` only,
appears in no log line (redact request URLs and upstream error bodies before
logging), and can never reach a client bundle (it lives in server code only;
the architecture guard already keeps server imports out of `src/`).

### 5. Desktop shell (electron/steam.cjs + bridge)

- `electron/steam.cjs`: lazily `require('steamworks.js')` ONLY when
  `desktopConfig.distribution === 'steam'` or the dev override
  `WOC_STEAM_DEV=1` is set. Website builds never initialize Steam. Exposes
  `getLinkTicket()`: init with the stamped app id (dev fallback 480, Valve's
  public Spacewar app), call the auth ticket API with identity `wocc-link`,
  return the hex ticket or null. Handle init failure (Steam not running)
  by returning null, never throwing across IPC.
- `electron/main.cjs`: `ipcMain.handle('desktop-steam-link-ticket', ...)`
  guarded by `trustedSender` first, like every existing handler.
- `electron/preload.cjs`: `steamLinkTicket: () =>
  ipcRenderer.invoke('desktop-steam-link-ticket')` on the `wocDesktop` bridge.
- `src/runtime.ts`: optional `steamLinkTicket?(): Promise<string | null>` on
  `DesktopBridge`; detection still requires only the login trio.
- Packaging: add `steamworks.js` to dependencies (lazy-required by the shell
  only; the maintainer sanctioned this dependency in the locked decisions) and
  `asarUnpack` its `dist/**` native module in
  `scripts/electron-builder-config.mjs`. NEVER ship `steam_appid.txt`
  (dev-only per the audit; keep it out of build inputs and add it to
  .gitignore if you create one locally).

### 6. Client link surface

A small section in the options/account area: when the capability advert says
enabled, show link status; on desktop with `steamLinkTicket` available, offer
Link (ticket -> `POST /api/steam/link`) and Unlink; on web show status and
Unlink only (no ticket source in a browser, v1). English keys in the sanctioned
English-only chrome domain; `apiError.steam.*` keys as in section 2. No UI
renders anywhere when the flag is off.

### 7. Failure modes (spell these out in code comments only where non-obvious)

| Case | Behavior |
|---|---|
| `STEAM_ENABLED` unset | Routes return `steam.disabled`; mirror inert; no client UI |
| Steam Web API down | Link route returns `steam.upstream` (503); mirror retries then drops; reconcile heals later |
| Unlinked account unlocks a deed | Mirror no-op |
| Deed not in map | Mirror no-op |
| Duplicate unlock delivery | Idempotent (Steam set-achievement is a no-op when already set; queue dedupes in flight) |
| Ticket replay or theft | Tickets are short-lived, single-app, verified server-side at link time with the pinned identity string; the worst case equals Steam's own linking model |
| Account deleted | `ON DELETE CASCADE` removes the link |

## Out of scope (owned elsewhere or by the maintainer)

- Any change to login/auth flows (pinned by test, below).
- App Admin data entry (achievement registration, icons, hidden flags):
  transcription from `achievement_map.ts` + the catalog when the app exists.
- macOS signing/notarization and the Steam depot pipeline (maintainer
  infrastructure; the entitlement plan is already in the audit doc).
- The deeds UI, leaderboards, wiki (earlier files).
- OPTIONAL STRETCH, clearly skippable if the session runs long:
  `scripts/steam_achievement_icons.mjs` exporting the crest-recipe badge PNGs
  for App Admin via the existing puppeteer-core harness pattern
  (`scripts/*.mjs`). NO new dependencies for this.

## Steps

1. DDL + accessors + FakeDb coverage (remember: new db functions need fakes in
   every test overlay that stubs the db module).
2. `server/steam/ticket.ts` (pure) + tests: response parsing, ban rejection,
   malformed upstream JSON.
3. Routes + registry registration + error codes + `apiError.steam.*` keys (+
   the five forced non-Latin fills for wordy leaves) + FakeDb route tests
   (enabled and disabled arms, both conflict cases, rate limit).
4. `/api/status` capability advert, BOTH arms, same commit.
5. `achievement_map.ts` transcribed from the catalog + its pin tests.
6. `mirror.ts` + queue + reconcile + tests (fake fetch; assert no await on the
   hot path; assert dedupe and retry caps).
7. Desktop: `steam.cjs`, IPC handler, preload method, `DesktopBridge` typing,
   builder config. `npm run electron:dev` smoke with `WOC_STEAM_DEV=1` against
   appid 480 if Steam is installed locally (manual, not CI).
8. Client link surface + English keys.
9. Biome on touched files, full gate, commit.

## Acceptance (run these; green means done)

- `npx vitest run tests/server/steam_routes.test.ts tests/server/steam_mirror.test.ts tests/steam_achievement_map.test.ts`
  (or the names you actually used; every arm above covered).
- The forbidden-login pin: a test asserting the steam domain never mints
  credentials: no route in `server/steam/` calls `newToken` or writes
  `auth_tokens` (assert via the FakeDb spy surface and a source-level scan in
  the test), and `steam.disabled` is returned on every route when the flag is
  off.
- The map pins: count <= 100, unique names, regex, every key in `DEEDS`.
- `npx vitest run tests/api_error_code_parity.test.ts tests/architecture.test.ts`
- `npm run gate` (unpiped) on the branch.
- Manual note recorded in the session output: the appid-480 dev loop result,
  or that it was skipped for lack of a local Steam client.

## Reviewer dispatch (spawn all three FRESH at completion, in parallel)

- privacy-security-review: the forbidden-login rule end to end; ticket
  verification trust chain; secret handling (no key in logs, errors, or client
  code); rate limiting on the upstream-calling route; CASCADE semantics.
- migration-safety: DDL additive/idempotent under the advisory lock; both
  uniqueness constraints; accessor SQL parameterized; boot safety when the
  table pre-exists.
- cross-platform-sync: flag OFF and ON behavior on web and desktop; the
  capability advert consumed identically; the dual-arm `/api/status` edit
  landed in both arms; `DesktopBridge` feature detection does not regress the
  login trio on old shells.

Apply every finding: blocking, should-fix, and nits alike.

## Adversarial pass (answer each in the session output)

- Can a captured ticket be replayed to link a victim's Steam account to my
  WoCC account, and what bounds the damage (single-use verification, short
  TTL, the unlink path, both UNIQUE constraints)?
- With the flag off, is every surface truly inert: routes, mirror, desktop
  module, client UI, capability advert?
- Does any error path echo the publisher key or the raw upstream body?
- What happens when the same account links, unlinks, and relinks a different
  Steam id: does reconcile push to the new id and never to the old one?
- Is there any path where the mirror blocks or slows the 50 ms world loop?
- Does anything here read `steam_appid.txt` or risk packaging it?

## End of session

Biome the touched files only. `npm run gate` unpiped. Update
`docs/achievements/progress.md` (row 7). Commits use Conventional Commits with
scope `server`, `electron`, or `deeds`; NEVER the word "phase" or any packet
reference in code, comments, commit messages, or PR text. End your final
response by naming the next file:
`docs/achievements/phase-07-qa.md`.
