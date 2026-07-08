# 05 QA: verify the Renown board + board integrity

STATUS: NOT STARTED (run only after phase-05-leaderboard.md is DONE in
progress.md; this QA is a separate session from the implementation)

Read `docs/achievements/overview.md` and `docs/achievements/phase-05-leaderboard.md`
first. You are verifying, not implementing; fix only what this QA surfaces, and
apply EVERY finding (blocking, should-fix, and nits). House rules bind here too:
no "phase"/packet wording, em dashes, en dashes, or emojis in anything shipped;
biome on touched files only; stage explicit paths.

## 1. What shipped (fill in from the implementation session and the diff)

Diff the branch since the phase-04 QA commit
(`git log --oneline` + `git diff <last-qa-commit>..HEAD --stat`) and list: new
modules, extended modules, new tests, i18n artifact commits. Confirm the
implementation session's summary matches the actual diff; discrepancies are
findings.

## 2. Re-run acceptance exactly

- `npx vitest run tests/server/deeds_board.test.ts`
- `npx vitest run tests/server/leaderboard_moderation.test.ts`
- The existing leaderboard test files the implementation extended (take the
  list from its session output; if it failed to name them, that is a finding).
- `npx vitest run tests/architecture.test.ts`
- `npm run gate` (unpiped, exit code observed).

All green or the QA fails.

## 3. Decisive-assertion audit

Dispatch a fresh `test-coverage-auditor` over the two new test files plus any
extended ones, with these explicit hunt orders:

- Every exclusion claim must assert the banned row ABSENT and a clean row
  PRESENT in the SAME query/fixture, per board and per arm (players realm,
  players global, arena, guilds, daily rewards, deeds). An absent-only
  assertion passes on an empty board and is not decisive.
- The `ELIGIBLE_ACCOUNT_SQL` pin must be a LITERAL string in the test, not a
  comparison of the exported constant to itself (the constant-self-comparison
  trap); and each retrofit query's source must be asserted to embed it.
- Floor and tie-break pinned with literals: a 49/50 boundary pair, and a
  fixture where score ties are broken by completionTime then accountId (both
  orderings exercised, not just one).
- The suspended-in-the-past control (expired suspension PRESENT) exists; a
  suspension-active case is ABSENT.
- The self row: authenticated caller on the board gets rank + topPercent
  computed against the pre-cap total; anonymous caller gets NO self row; an
  authenticated caller below the floor gets no self row (or the documented
  behavior, which must be pinned either way).
- The bust hook: fires on every `moderateAccount` action kind on success,
  not on failure.

## 4. Domain reviewers (fresh, never the implementer)

- `privacy-security-review` must explicitly confirm: no account id or email in
  any public board response body (grep the builder + entry type and the test
  fixtures); the optional-auth arm 401s an INVALID presented token instead of
  silently degrading to anonymous; the moderation cache-bust seam is not
  reachable from any public surface; no new SQL interpolates request input.
- `migration-safety` must explicitly confirm: any index DDL added is
  `CREATE INDEX IF NOT EXISTS`, additive, and boot-idempotent under the
  advisory lock; re-running boot twice against a dev db is clean; the
  retrofit joins cannot NULL-out rows for legacy accounts (accounts predating
  the moderation columns have NULL banned_at/suspended_until and must remain
  ELIGIBLE; verify the predicate treats NULLs as eligible).

## 5. Behavioral spot checks (manual, dev environment)

- `npm run db:up`, boot the server, seed or use dev commands to earn deeds on
  two accounts; confirm `/api/leaderboard?board=deeds` orders and pages
  correctly and `scope` is reported `global` even when `?scope=realm` is sent.
- Ban one account through the real admin route: the row disappears on the
  NEXT request (bust hook, no TTL wait). Unban: it returns.
- In the client, open the leaderboard window: the new tab renders, the self
  row shows for a logged-in character on the board, titles render localized
  (English), and the players/guilds/devs tabs are visually and behaviorally
  unchanged.
- Load sanity: confirm by reading the code path that NO board query runs per
  request (every read goes through a TTL cache; the deeds aggregation runs at
  most once per TTL). If any new endpoint can hit the db per anonymous
  request without a cache or rate limit, that is a blocking finding.

## 6. Adversarial what-is-missing pass

Answer explicitly, with evidence:

- Did the implementation touch the shared `/api/leaderboard` middleware, and
  if so, did the existing boards' anonymous behavior change in ANY observable
  way (status, body, headers)? The parity guarantee for the legacy boards
  must hold.
- Is there any write path that sets `banned_at`/`suspended_until` outside
  `moderateAccount` (rg for those column names in UPDATE statements across
  server/); if yes, does each also bust the caches or is that documented as
  accepted staleness within one TTL?
- Does the deleted-character scenario from the implementation file's
  adversarial pass have either a test or a documented, verified behavior?
- Are the i18n artifacts (scan/build output + sha256 baseline) committed in
  the SAME commit as the chrome key additions (check the commit graph, not
  just the tree)?
- Does anything in the new code or comments say "phase", reference this
  packet, or use a dash that the Stop hook would reject?
- Name anything this QA file itself failed to cover that a reviewer of the
  live feature would catch.

## 7. Exit criteria

All of: acceptance green; every reviewer finding applied; spot checks clean;
adversarial answers written into the session output with evidence. Then update
`docs/achievements/progress.md` (row 5Q DONE with date), commit
(`test(server): ...` / `fix(...): ...` as needed, no packet vocabulary), push,
and end the session naming the next file:
`docs/achievements/phase-06-wiki-guide.md`.
