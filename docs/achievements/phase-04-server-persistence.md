# 04: Server persistence for Deeds (character_deeds, observer, broadcasts, rarity, public sheet)

STATUS: NOT STARTED

Read `docs/achievements/overview.md` FIRST; it is authoritative and its section 3
canonical identifiers are binding. This file assumes 01 (sim core), 02 (IWorld and
wire), and 03 (Book of Deeds window) have landed and their QA files passed: the sim
already evaluates deeds, emits `deedUnlocked { pid, deedId, retro? }`, persists
`CharacterState.deeds` / `deedStats` / `activeTitle` / `renown` inside the
`characters.state` JSONB blob, and the client renders the window and earn moments.

## Goal

Give the server its observer layer: a queryable per-character record of earned
deeds (`character_deeds`), live guild/friend broadcast of marquee unlocks, the
global rarity aggregate the window's rarity slot consumes, and a deeds summary on
the public character sheet. The sim save blob REMAINS the gameplay source of
truth; everything in this file observes, indexes, and reads. Nothing here may
grant, deny, or mutate a deed.

## Before you start: context to load

- `docs/achievements/overview.md` (sections 3, 4, 5).
- `server/CLAUDE.md` in full: the SQL-only-in-db-modules rule, the FakeDb testing
  model, the dual-edit rule for migrated routes, the S3 localization guard notes.
- `server/http/CLAUDE.md`: RouteDef contract, registry, new:endpoint scaffold.
- `server/bank_ledger.ts`: the reference observer (fire-and-forget FIFO promise
  tail, never awaited by the loop, never throws into the caller, `bankLedgerIdle`
  drain hook for tests). The deeds observer copies this shape minus the diffing
  (deeds are event-driven, no before/after snapshot needed).
- `server/db.ts`: the `bank_ledger` and `character_leases` DDL blocks (the two
  realm-no-DEFAULT precedents and the comment explaining why), the
  `daily_reward_events` block (the idempotency-key UNIQUE pattern),
  `ensureSchema` (advisory-lock boot).
- `server/game.ts`: `detectActivity` (the sim-event observer switch), the world
  loop calls to `routeEvents` and `detectActivity`, `sendDailyRewardPointsGained`
  (the per-session events-frame push shape), `socialTransport()` and
  `SocialTransport.deliver` in `server/social.ts`.
- `server/leaderboard.ts`: the rung-1 public-read exemplar (`export const routes`,
  `configureLeaderboardRuntime` injection, `publicReadRateLimited`, and
  `readPublicSheet` + `publicSheetHandler` for the sheet).
- `server/character_sheet.ts`: the shared sheet shape both dispatch arms serve.
- `tests/server/leaderboard.test.ts` and `tests/server/helpers/`: FakeDb + fakeCtx
  testing idiom. `tests/` bank ledger tests for the observer idiom.

## Working environment

If executing in a fresh worktree: `npm ci` first, and let `pretest` regenerate
wiki/i18n artifacts. Full-suite runs happen via `npm run gate` (unpiped); while
iterating, run single files with `npx vitest run <file>`.

## Design spec

### 1. The `character_deeds` table

Append a new DDL block to `SCHEMA` in `server/db.ts` (additive, idempotent,
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, runs under the
existing advisory-lock boot):

- `id BIGSERIAL PRIMARY KEY`
- `realm TEXT NOT NULL` with NO default. Copy the `bank_ledger` comment rationale:
  the interpolated `REALM_SQL_DEFAULT` pattern is last-boot-wins across realm
  processes, so every insert passes realm explicitly.
- `character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE`
- `account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`
- `deed_id TEXT NOT NULL`
- `earned_at TIMESTAMPTZ NOT NULL DEFAULT now()` (server clock; the sim's utcDay
  stamp lives in the state blob and is not duplicated here)
- `UNIQUE (character_id, deed_id)` (the idempotence backbone; retro re-emits and
  crash-replays collapse into no-ops)
- Indexes: `(deed_id)` for the rarity aggregate, `(account_id)` for the account
  roll-up the leaderboard file will consume, and `(character_id, earned_at DESC)`
  for the sheet's recent-deeds read.

Also add, in the accounts DDL region, an additive
`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deed_broadcasts BOOLEAN NOT NULL
DEFAULT TRUE` (the owner broadcast opt-out; see 4).

### 2. SQL boundary: `server/deeds_db.ts`

All SQL for this domain lives in a new `server/deeds_db.ts` (the
`*_db.ts` convention; zero raw SQL anywhere else). Functions, all parameterized:

- `insertCharacterDeed(row)`: `INSERT ... ON CONFLICT (character_id, deed_id) DO
  NOTHING`, realm passed explicitly.
- `deedRarityCounts()`: `SELECT deed_id, COUNT(*) ... GROUP BY deed_id` plus the
  eligible denominator `SELECT COUNT(*) FROM characters WHERE level >= 5 AND
  state IS NOT NULL`. Rarity is GLOBAL (cross-realm) by design: at current
  population, per-realm percentages would be noise.
- `recentDeedsForCharacter(characterId, limit)` for the sheet.
- `setDeedBroadcasts(accountId, enabled)` and its read (or fold the read into the
  existing account-settings fetch if one already serves the options surface).

### 3. The observer: `server/deeds_records.ts` + `detectActivity`

A small module copying the `bank_ledger.ts` runtime shape:

- `recordDeedUnlock(who: { characterId, accountId }, deedId): void`: chains one
  `insertCharacterDeed` onto a module-local FIFO promise tail; catch-and-log on
  rejection; the whole body wrapped so it can never throw into the caller; the
  game loop never awaits it. Export `deedRecordsIdle()` for deterministic test
  drains (mirror of `bankLedgerIdle`).
- Wiring: add a `deedUnlocked` case to the `detectActivity` switch in
  `server/game.ts`, resolving the session by `ev.pid` exactly like the
  neighboring cases, then calling `recordDeedUnlock`. Retro unlocks
  (`ev.retro === true`) insert through the same path; the UNIQUE constraint
  makes replays free. The observer records what the sim decided; there is no
  server-side grant path of any kind.

CRITICAL known gotcha, verbatim from the maintainer's history: adding db calls
inside `server/game.ts` breaks the private bot-detector overlay mocks; the
executor must fix BOTH copies (the in-tree `private/bot_detector/` mirror and
`~/Documents/wocc-bot-protection`) in the same change, the same way the
game.join/leave db calls did. Also: release-authored db-mock lease gaps are a
recurring test-failure class; every test overlay that stubs the db module needs
the new `deeds_db` functions covered (FakeDb or explicit stubs), or unrelated
suites red.

### 4. Marquee broadcast to guildmates and friends

- Trigger: a non-retro `deedUnlocked` whose `DEEDS[deedId]` (server imports the
  content table from `src/sim/content/deeds.ts`, which is sanctioned) has
  `renown >= 25` OR a title/border reward. Retro unlocks NEVER broadcast (a
  veteran's login must not spam their guild).
- Audience: online guildmates and friends of the earner, resolved through the
  social service reads, delivered per recipient session as a server-injected
  event in the existing per-player events frame (the
  `sendDailyRewardPointsGained` shape). The event is id-based, never English:
  `{ type: 'deedBroadcast', characterName, deedId }`. The client composes the
  localized line from `deed_i18n` plus a `hudChrome.deeds.*` chrome key (the
  window session already established both); add the small client handler in
  `src/net/online.ts` event passthrough and the hud chat arm in the SAME change,
  since a wire event only exists if both ends speak it. No English literal is
  added to `game.ts`, so the S3 guard stays green; state this in the PR-facing
  test description without packet vocabulary.
- Respect `isIgnoring(recipient, earner)` like guild chat does.
- Owner opt-out: if the earner's `accounts.deed_broadcasts` is false, skip the
  broadcast entirely. Expose the toggle as an authenticated
  `POST /api/deeds/broadcasts` `{ enabled: boolean }` route in the new domain
  module (rung-2 shape, `requireAccount`). The options-window toggle UI is
  DELIVERED by the polish session (08, which carries it as an explicit
  carve-out); until then exposure is API-only and harmless.
- The earner's OWN toast/banner is client-side from the sim event (landed with
  the window session); do not send the earner a duplicate frame here.

### 5. Rarity aggregate and endpoint

- New rung-1 public-read RouteDef module `server/deeds.ts` (domain `deeds`),
  scaffolded with `npm run new:endpoint -- --domain deeds --method GET --path
  /api/deeds/rarity --public`, registered in `server/http/registry.ts`. New
  routes are registry-only (no legacy ladder twin).
- Handler shape copies `server/leaderboard.ts`: static `routes` array,
  `configureDeedsRuntime` injection from `main.ts`, `publicReadRateLimited`
  in-handler, pure read function unit-testable against a FakeDb.
- Response: `{ totalEligible, earned: { [deedId]: count } }`. Percentages are
  computed client-side; the payload stays a compact integer map. Deeds with zero
  earns are simply absent.
- Cache: TTL-cache the aggregate in `main.ts` next to `leaderboardCache`
  (5 minutes; the existing 30 s leaderboard TTL is tighter than rarity needs),
  injected through the runtime object so the module stays cycle-free.
- Client surface, a SANCTIONED facet extension owned by this session: append
  ONE async read to `IWorldDeeds` in `src/world_api/deeds.ts`:
  `deedsRarity(): Promise<Record<string, number> | null>` (deed id to earned
  count, plus reserve the `totalEligible` under a `__total` key OR return the
  endpoint payload shape verbatim; pick one, document it in the facet header,
  and keep both worlds identical). Implement in BOTH worlds in the same
  commit: offline `Sim` resolves `null` (no population, no rarity); online
  `ClientWorld` lazy-fetches the endpoint (the daily-rewards async-read
  variant), caching the result per window-open. The window already renders
  rarity as present-when-available and hides the slot on null.
- Gate updates, same commit (the wire session pre-announced this extension):
  append `deedsRarity` as a `method` member to `IWORLD_MEMBERS`, insert it
  into the full and method-only sorted-name snapshots, add it to
  `FACET_DEEDS` (its `AssertNever` exhaustiveness type will red until you do),
  and bump the total/method literal count pins in
  `tests/world_api_parity.test.ts` (re-read the current literals at execution
  time). Run `tests/snapshots.test.ts` and `tests/command_schema.test.ts` too;
  no delta key or command changes are expected, so they must stay green
  untouched.
- If the scaffold appends an `apiError.*` leaf, keep the English terse (under
  the wordy threshold) or ship the five non-Latin fills with it; the M16 gate is
  the one i18n check this session can trip.

### 6. Public character sheet deeds summary

Extend the SHARED sheet shape so both dispatch arms stay identical: the change
lands in `server/character_sheet.ts` (and the `readPublicSheet` read path in
`server/leaderboard.ts` that feeds it), never handler-locally, which is what the
dual-edit rule requires for a migrated route. Added block:
`deeds: { renown, earnedCount, activeTitle, recent: [{ deedId, earnedAt }] }`
with `recent` limited to 5 from `recentDeedsForCharacter`. Renown, earned count,
and activeTitle come from the state blob the sheet already loads (no second
query). Deeds are publicly visible by default in v1 (maintainer call: flex is
the point); there is no per-account privacy toggle in this build.

### 7. Out of scope here (owned elsewhere)

- The Renown leaderboard, entry floor, tie-break, and cheater delisting: next
  implement file.
- Steam: everything.
- Any options-window UI for the broadcast toggle: mobile/polish session.
- Any change to accounts schema beyond `deed_broadcasts`.
- Any sim change: 01 owns the evaluator; if you find yourself editing
  `src/sim/`, stop and re-read the boundary. ONE sanctioned exception: the
  `deedsRarity` facet getter on `Sim` (returning `Promise.resolve(null)`) and
  its `src/world_api/deeds.ts` declaration, per design spec section 5.

## Steps

1. DDL: `character_deeds` block + `deed_broadcasts` column in `server/db.ts`,
   with the realm-no-default comment.
2. `server/deeds_db.ts` with the four parameterized functions + types.
3. `server/deeds_records.ts` observer + `deedRecordsIdle`; unit tests (FIFO
   order, idempotent double-insert, rejection logged not thrown, drain hook).
4. `detectActivity` case + bot-detector overlay mocks fixed in BOTH copies +
   db-stub overlays updated.
5. Broadcast: audience resolution, `deedBroadcast` event, `isIgnoring`,
   opt-out check; client handler in `online.ts` + hud chat arm; toggle route.
6. `server/deeds.ts` RouteDef module + registry + `main.ts` TTL cache +
   `configureDeedsRuntime`; the `deedsRarity` facet extension in BOTH worlds +
   the parity-gate pin updates; window rarity slot verified fed.
7. Sheet extension in the shared shape + tests.
8. Biome on touched files; targeted vitest; `npm run gate` unpiped.

## Acceptance

All of these must pass, exactly as written:

- `npx vitest run tests/server/deeds.test.ts` (new: rarity read fn vs FakeDb,
  routes via fakeCtx + configureDeedsRuntime, toggle route auth-gated, sheet
  summary shape)
- `npx vitest run tests/deed_records.test.ts` (new: observer FIFO + idempotence:
  the double-insert test inserts the same (character, deed) twice and asserts
  ONE row via the fake)
- `npx vitest run tests/server/leaderboard.test.ts` (sheet extension keeps the
  existing pins green and adds the deeds-block pin)
- A literal-SQL pin: a test asserts the SCHEMA string contains
  `UNIQUE (character_id, deed_id)` and `realm TEXT NOT NULL` without a DEFAULT
  in the character_deeds block (literal pins, not constant self-comparison)
- `npx vitest run tests/world_api_parity.test.ts tests/snapshots.test.ts
  tests/command_schema.test.ts` (the facet extension re-pins W0c; W0a/W0b stay
  green untouched)
- `npx vitest run tests/architecture.test.ts` and
  `npx vitest run tests/localization_fixes.test.ts` stay green
- `npm run gate` (unpiped) green at the end
- Manual: with `npm run server` + `npm run dev`, an unlock on a test account
  inserts one row (psql against the dev db on :5433), a guildmate sees the
  broadcast line, the rarity endpoint returns the map, the public sheet shows
  the summary, and a second login (retro replay) adds no rows and no broadcast.

## Reviewer dispatch (fresh agents, never the implementer)

- `migration-safety`: DDL additive/idempotent under concurrent realm boots,
  realm no-default respected, JSONB untouched, ON DELETE CASCADE reasoning,
  index coverage for the three read paths.
- `privacy-security-review`: no client-supplied grant path anywhere (the server
  only records sim emissions), toggle route auth, rate-limited public reads, the
  sheet exposes exactly the contracted block, parameterized SQL.
- `test-coverage-auditor`: decisive assertions per the acceptance list.

## Adversarial pass (answer each in the session output)

- What happens if the db is down for an hour: does gameplay degrade anywhere?
  (It must not; the blob still saves, the FIFO logs failures, rarity serves
  stale cache.)
- Can a crafted client message reach `recordDeedUnlock` or the broadcast path
  without the sim having emitted the event? Walk the path and prove not.
- Two realm processes, same account, simultaneous unlocks: any constraint or
  ordering hazard beyond what UNIQUE absorbs?
- Does the retro flood at first login after rollout (a veteran's dozens of
  predicate unlocks) stay within one FIFO tail without blocking the loop?
- Is any English literal newly emitted from `game.ts`? If yes, where is its
  matcher and its dedicated test?
- What did this session NOT cover that the next file assumes exists?

## End of session

Update `docs/achievements/progress.md` (row 4 DONE with date, notes). Commit with
explicit paths only, Conventional Commits, e.g. `feat(server): record earned
deeds, broadcast marquee unlocks, serve rarity and sheet summary` (no packet
vocabulary). Run the QA cadence next; name the next file explicitly in your
final response: `docs/achievements/phase-04-qa.md`.
