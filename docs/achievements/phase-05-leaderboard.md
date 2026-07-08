# 05: The Renown board + integrity for every board

STATUS: NOT STARTED (see progress.md; do not start before phase-04-qa.md is done)

Read `docs/achievements/overview.md` FIRST. It is authoritative; if this file and
the overview disagree, the overview wins and you flag the conflict in your final
response. This file is self-contained otherwise: it assumes phase-01 through
phase-04 have landed (DEEDS content, `deedsEarned`/`renown` in character state,
the `character_deeds` table populated by the server observer) and nothing else.

Reminder that binds this whole session: never write "phase", packet references,
em dashes, en dashes, or emojis into code, comments, commits, or PR text.
Commits here use scopes `server`, `ui`, or `deeds`. English-only i18n via the
pending mechanism. Stage explicit paths only.

## Goal

Two deliverables, one session:

1. THE RENOWN BOARD: a lifetime, account-level leaderboard of Renown (deed
   points), served as a new `?board=deeds` fork of `/api/leaderboard` and a new
   tab in the in-game leaderboard window.
2. BOARD INTEGRITY: every player-derived board (lifetime XP realm and global,
   arena, guilds, the daily-rewards board, and the new Renown board) stops
   listing banned and suspended accounts, and moderation actions bust the
   board caches so delisting is immediate. The dev board is the one sanctioned
   exemption (GitHub identities, no game account to moderate against). This is the "delisting wired into the ban pipeline" research
   lesson (overview section 6, item 12): OSRS retrofitted this years late and
   it is their standing credibility wound; we build it in while the boards are
   young.

## Context to load before writing code

Read these in full; they are the patterns you extend, and every one is small:

- `server/leaderboard.ts`: the reference public-read RouteDef module. Note the
  three-layer split it documents in its header (pure decoders, pure builders,
  host-agnostic reads over a narrow Db interface, thin Ctx handlers), the
  `?board=` fork ladder in `leaderboardHandler` (`guilds`, then `devs`, then
  the default player board), `configureLeaderboardRuntime` injection, and
  `meta: { publicRead: true }` usage.
- `server/main.ts`: `leaderboardCache` / `refreshLeaderboard` /
  `getLeaderboard` and the guild twins (`LEADERBOARD_TTL_MS` is 30s, size is
  `LEADERBOARD_MAX`), and where `configureLeaderboardRuntime` is called at
  boot. The Renown cache is a sibling of these.
- `server/db.ts`: `topLifetimeXp` (both arms), `topArenaRatings`, `topGuilds`,
  `LIFETIME_XP_EXPR`, the `characters_lifetime_xp` indexes, and the accounts
  moderation columns (`banned_at`, `suspended_until`). Also
  `lifetimeXpRankForCharacter` as the self-rank precedent.
- `server/moderation_db.ts`: `moderateAccount` is the single transactional
  entry point for ban / unban / suspend / unsuspend. Find its caller (search
  `moderateAccount(` under `server/`); that admin route is where the
  cache-bust hook fires.
- `src/sim/leaderboard_page.ts`: `paginateRanked` and the thin typed wrappers;
  the Renown board gets one more wrapper here.
- `src/ui/leaderboard_window.ts` + `src/ui/leaderboard_view.ts` +
  `src/ui/guild_leaderboard_view.ts` + `src/ui/dev_leaderboard_view.ts`: the
  window family. `type LeaderboardBoard = 'players' | 'guilds' | 'devs' |
  'daily'` and the per-board page-state pattern are what you extend; each
  board has its own pure view core registered in `UI_PURE_CORES`
  (`tests/architecture.test.ts`).
- `docs/achievements/catalog/README.md` section on Renown values, and
  `src/sim/content/deeds.ts` as landed by phase-01 (renown per deed, zero-
  renown deeds exist and matter for scoring).
- The existing leaderboard tests: `rg --files tests | rg -i leaderboard` and
  read what is already pinned so you extend rather than duplicate.

## Design spec

### The Renown board is account-level and therefore GLOBAL-ONLY

Renown counts each deed once per ACCOUNT (overview, locked decision 2), and
accounts span realms (one account has characters on several realms; realm is a
character property). A realm scope for an account-level score is therefore not
well defined: the same account would need its deed set partitioned by which
character earned what, which contradicts "once per account". So this board has
exactly one scope. The decoder stays lenient per module convention: `?scope`
is accepted and ignored, and the response body always carries
`scope: 'global'`. Document this with a comment mirroring the dev board's
realm-agnostic note in `leaderboardHandler`.

### Scoring, floor, ordering (implemented as pure functions)

New module `server/deeds_board.ts` (host-agnostic, unit-tested with plain
fixtures, no db import):

- Input: rows of `{ accountId, characterId, deedId, earnedAt }` (the db read
  below), plus the in-memory `DEEDS` table imported from
  `src/sim/content/deeds.ts`. Points are NEVER stored in SQL; the content
  table is the single source of truth for Renown values, so a rebalance needs
  no migration.
- Per account: the COUNTED SET is the distinct deed ids with renown > 0
  (zero-renown deeds: feats, luck deeds, dynamic metas, are excluded so they
  can neither score nor perturb the tie-break). Score = sum of renown over the
  counted set. An unknown deed id in a row (content removed or renamed) is
  skipped and counted in a returned `unknownDeedIds` diagnostic list; it must
  never throw.
- ENTRY FLOOR: accounts with score < 50 are dropped (research lesson: floors
  kill throwaway-account noise; 50 is one notable deed or a handful of routine
  ones).
- ORDERING: score descending; tie-break is the EARLIER account, defined
  precisely as: completionTime = max(earnedAt) over the account's counted set
  (the moment its current score was reached); lower completionTime ranks
  higher. Final deterministic key: accountId ascending. This is the
  "score-then-earliest" rule from the research digest; document all three keys
  in a comment.
- DISPLAY CHARACTER: for each ranked account, the character of that account
  with the highest per-character Renown (same counted-set rule applied to that
  character's own rows); ties by lowest characterId. The board is
  account-scored but character-faced.
- Self row: given an accountId, return `{ rank, topPercent }` where
  topPercent = ceil(rank / totalRanked * 100), computed against the FULL
  ranked list before the LEADERBOARD_MAX cap is applied.

### DB read and the shared exclusion fragment

In `server/db.ts`:

- Export a named constant for the eligibility predicate, used verbatim by
  EVERY board query:
  `ELIGIBLE_ACCOUNT_SQL = "a.banned_at IS NULL AND (a.suspended_until IS NULL OR a.suspended_until <= now())"`.
- New read `deedsBoardRows()`: selects `account_id, character_id, deed_id,
  earned_at` from `character_deeds cd JOIN characters c ON c.id =
  cd.character_id JOIN accounts a ON a.id = cd.account_id` with
  `ELIGIBLE_ACCOUNT_SQL`, no LIMIT (the aggregation needs the full set; at
  current scale this is tiny, and the result is cached; leave a comment that
  if character_deeds outgrows memory the aggregation moves into SQL, never
  into a capacity cap that can drop legitimate accounts, per the raider.io
  lesson).
- A companion read for display characters: given character ids, return
  `name, realm, class, level, state->>'activeTitle'` rows (one IN query). The
  active title rides each entry as a deed id; the client localizes it through
  `deed_i18n.ts`. Never put English title text in the response.
- RETROFIT: add `JOIN accounts a ... AND ELIGIBLE_ACCOUNT_SQL` (or the
  equivalent `EXISTS` subquery, your call, but the same fragment text) to
  `topLifetimeXp` (BOTH arms), `topArenaRatings`, `topGuilds`, AND the
  daily-rewards leaderboard read (the ranked read behind
  `/api/daily-rewards/leaderboard`; it lives in `server/daily_rewards_db.ts`,
  consumed by `server/daily_rewards.ts`; it is account-keyed, so the fragment
  applies directly). For `topGuilds` the join applies to the MEMBER characters
  inside the SUM, so a banned member's XP stops inflating the guild score
  rather than delisting the whole guild.
- THE DEV BOARD IS EXEMPT, deliberately: `topContributors`
  (`server/github_contributors.ts`) ranks GitHub identities with no game
  account linkage, so there is nothing to moderate against. Add one comment
  there saying exactly that, so the exemption reads as a decision and not an
  omission.
- Indexes: the new joins are pk lookups (accounts.id); no new index is needed
  for them. `deedsBoardRows` wants `character_deeds (account_id)` and
  `character_deeds (character_id)`; phase-04 created the table, so ADD these
  indexes here only if phase-04 did not (check the DDL first; additive
  `CREATE INDEX IF NOT EXISTS` in the SCHEMA block per migration rules).

### Cache and runtime injection

In `server/main.ts`, a sibling cache: `deedsBoardCache` holding the computed
entry list plus `totalRanked`, TTL `LEADERBOARD_TTL_MS`, refreshed by
`deedsBoardRows()` -> `computeDeedsBoard(...)` -> display-character fill.
Entries carry `accountId` INTERNALLY for the self-row computation; the public
response entry must NOT include accountId (account ids are not public data;
privacy-security-review will look for exactly this).

Extend `LeaderboardRuntime` with `getDeedsLeaderboard(): Promise<...>` and a
`deedsSelfRank(accountId): Promise<{rank, topPercent} | null>` (both served
from the same cache), wired in the existing `configureLeaderboardRuntime`
call.

CACHE BUST: main.ts passes a `bustBoardCaches()` hook into the admin
moderation route module the same injected-runtime way (moderation_db must not
import main.ts; find where the route module that calls `moderateAccount` gets
its dependencies and extend that seam). The hook nulls EVERY board cache
scope: players realm and global, guilds realm and global, and deeds, after a
SUCCESSFUL `moderateAccount` of any action kind, so a ban delists and an
unban relists without waiting out the TTL. Arena is served uncached by
design; leave an in-code comment at the bust hook saying so. Check whether
the daily-rewards board read is cached anywhere: if it is, bust that cache
here too; if it reads per-request, the SQL exclusion alone is sufficient and
you note that in the same comment.

### Route

In `server/leaderboard.ts`, extend the `?board=` ladder with
`LEADERBOARD_DEEDS_BOARD = 'deeds'` before the default arm:

- Response body via a new pure builder `buildDeedsBoard(realm, entries, page,
  pageSize, self)`: `{ realm, scope: 'global', board: 'deeds', metric:
  'renown', ...paginated, self? }` where `self` is `{ rank, topPercent }` and
  is present only for an authenticated caller who is on the board.
- Pagination through a new `paginateDeedsLeaderboard` wrapper in
  `src/sim/leaderboard_page.ts` over a `DeedsLeaderboardEntry` type declared
  next to the existing entry types in `src/world_api` (fields: rank, name,
  realm, cls, level, renown, deedCount, title (deed id or null)).
- Auth: attach the shared `optionalReadAccount` middleware (the route already
  serving `/api/leaderboard` has none today; adding optional auth must NOT
  change anonymous behavior for the existing boards; an anonymous caller gets
  the deeds board with no self row). If touching the shared route's
  middleware risks the other boards' parity, fork the deeds arm into its own
  handler on the same path guarded by the query check FIRST and leave the
  legacy arms byte-identical; state in the commit body which shape you chose.

### Client window

- Extend `LeaderboardBoard` with `'deeds'`, per-board page state, and a tab
  (follow the `devs` tab exactly, including aria-selected handling). The tab
  is always visible.
- New pure core `src/ui/deeds_leaderboard_view.ts` (register in
  `UI_PURE_CORES` in `tests/architecture.test.ts`): maps the response to row
  view-models: rank, character name with realm, class crest id, Renown,
  deed count, localized title via a resolver the painter passes in (the core
  itself stays i18n-free; it returns the title DEED ID and the painter
  resolves through `deed_i18n.ts`), plus the self row line when present.
- Fetch path: mirror how the window fetches the dev board (injected deps),
  adding the bearer token the way other authenticated window fetches do so
  the self row appears for logged-in players.
- Chrome strings (tab label "Renown", column headers, "Top N percent" line,
  empty-board line) go in the `deeds:` section of
  `src/ui/i18n.catalog/hud_chrome.ts` created by phase-03; English only. Run
  the i18n scan/build and commit regenerated artifacts plus the sha256
  re-baseline IN THE SAME COMMIT as the key additions.

## Out of scope (owned elsewhere; do not touch)

- Seasons, percentile bands beyond the self row, archived boards.
- The rarity endpoint and public character sheet (phase-04, already landed).
- Admin dashboard board views (not in this packet).
- Steam anything (phase-07).
- Mobile layout polish for the new tab (phase-08 sweeps it; keep the tab
  functional under the existing responsive rules, nothing more).
- The Book of Deeds window itself (phase-03, already landed).

## Steps

1. Read the context files. Then write the failing tests first for
   `server/deeds_board.ts` (scoring, zero-renown exclusion, floor, all three
   ordering keys, display-character selection, self rank and topPercent,
   unknown-deed tolerance).
2. Implement `server/deeds_board.ts` to green.
3. `server/db.ts` (+ `server/daily_rewards_db.ts`): `ELIGIBLE_ACCOUNT_SQL`,
   `deedsBoardRows`, the display read, the four retrofit joins (lifetime XP,
   arena, guilds, daily rewards), the dev-board exemption comment, any
   missing character_deeds indexes.
4. `server/main.ts`: cache + runtime members + moderation cache-bust hook
   through the admin module's dependency seam.
5. `server/leaderboard.ts`: decoder constant, builder, handler arm, route
   middleware decision; keep every existing board's response byte-identical
   (the parity harness and existing tests are your guard).
6. `src/sim/leaderboard_page.ts` wrapper + `src/world_api` entry type.
7. Client: view core + UI_PURE_CORES registration + window tab + fetch +
   chrome keys + i18n artifacts + sha256 re-baseline.
8. Tests below green, biome on touched files, `npm run gate` unpiped.
9. Update `docs/achievements/progress.md` (row 5 DONE with date), commit in
   focused pieces (suggested: `feat(server): renown leaderboard scoring and
   board route`, `fix(server): exclude moderated accounts from public
   leaderboards`, `feat(ui): renown leaderboard tab`), push.

## Acceptance (all must pass; run exactly these)

- `npx vitest run tests/server/deeds_board.test.ts` (new): the pure-function
  suite. Must include, as separate named cases: zero-renown deeds neither
  score nor shift the tie-break; the 50 floor boundary (49 absent, 50
  present); tie broken by earlier completionTime then accountId; display
  character is the account's highest-Renown character; topPercent uses the
  pre-cap total.
- `npx vitest run tests/server/leaderboard_moderation.test.ts` (new): for
  EACH of players (realm and global arms), arena, guilds, daily rewards, and
  deeds: a banned
  account's row is ABSENT while a clean account's row is PRESENT in the same
  fixture; a suspended-in-the-past account is PRESENT (suspension expired).
  Where the exclusion lives in SQL, pin the mechanism: assert the query
  source embeds the exact `ELIGIBLE_ACCOUNT_SQL` literal (pin the literal
  string in the test, never compare the exported constant to itself), and
  drive the JS-observable arms (deeds aggregation, cache bust) behaviorally.
  Also: `moderateAccount` success triggers the injected bust hook; failure
  does not.
- `npx vitest run` on the EXISTING leaderboard route/view test files you
  extended (name them in the session output).
- `npx vitest run tests/architecture.test.ts` (UI_PURE_CORES registration,
  purity of the new view core).
- `npm run gate` (unpiped) green at the end.
- MANUAL (recommended, not gating): `npm run db:up`, seed two accounts with
  character_deeds rows, ban one via the admin route, curl
  `/api/leaderboard?board=deeds` and confirm live delisting end to end.

## Reviewer dispatch (fresh agents, never the implementer)

- `privacy-security-review`: focus points: no accountId in any public
  response; optional-auth arm rejects an invalid token rather than treating
  it as anonymous (module convention); the moderation bust hook cannot be
  reached from any public route; SQL is parameterized (the fragment is static
  text, never interpolated user input).
- `migration-safety`: additive index DDL only, idempotent, boot-safe under
  the advisory lock; the retrofit joins do not change row shapes in ways that
  break older readers; character_deeds FK/cascade semantics match phase-04.
- `test-coverage-auditor` on the two new test files (decisiveness: every
  claimed exclusion has an ABSENT assertion paired with a PRESENT control).

Apply every finding: blocking, should-fix, and nits.

## Adversarial pass (answer each in the session output)

- A DELETED character: do its character_deeds rows cascade away (check the
  phase-04 DDL), and does the account's score shrink coherently on next
  refresh? If rows survive deletion, the display-character fill must tolerate
  a missing character row without throwing or minting a blank entry.
- A RENAMED character: rows key on ids and the display read fetches names
  live, so a rename must show the new name after one TTL; confirm no name is
  cached anywhere longer than the board cache.
- An account whose ONLY deed-earning characters were deleted but which still
  clears the floor via remaining rows: does a display character still
  resolve, and if the account has zero live characters is the entry dropped
  (it must be, with a test if reachable)?
- Character transfer between accounts does not exist today; state that
  assumption in a code comment where the aggregation trusts
  `character_deeds.account_id`, so a future transfer feature knows to
  reconcile this table.
- Can the unban path leave a stale cache anywhere (the bust must cover every
  cached board scope)? Is there any second copy of the moderation write that skips
  `moderateAccount` (search for direct `banned_at` UPDATEs outside
  moderation_db before trusting the single hook site)?
- What is missing from this file that the feature needs? Name it rather than
  silently absorbing scope.

## End of session

Biome on touched files; `npm run gate` unpiped; update
`docs/achievements/progress.md`; commits as in step 9 with no packet
vocabulary; push. Your final response summarizes what shipped, lists any
overview conflicts, and names the next file:
`docs/achievements/phase-05-qa.md`.
