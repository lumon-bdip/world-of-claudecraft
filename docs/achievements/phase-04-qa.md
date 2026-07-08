# 04 QA: Server persistence for Deeds

STATUS: NOT STARTED

Dedicated verification session for `phase-04-server-persistence.md`. Run this in
full before starting the leaderboard file; the in-session qa-checklist pass the
implement session ran does not substitute for this file.

Read first: `docs/achievements/overview.md` (sections 3 to 5),
`docs/achievements/phase-04-server-persistence.md`, and the implement session's
commit(s) via `git log --stat` on this branch.

## 1. What shipped (fill in from the diff before judging it)

List the actual files touched and compare against the implement file's Steps.
Any file outside the stated scope is a finding; the sim boundary for this
slice admits exactly one sanctioned exception (the `deedsRarity` facet getter
on `Sim` plus its `src/world_api/deeds.ts` declaration): anything else under
`src/sim/` is a finding.

## 2. Re-run acceptance exactly

- `npx vitest run tests/server/deeds.test.ts`
- `npx vitest run tests/deed_records.test.ts`
- `npx vitest run tests/server/leaderboard.test.ts`
- `npx vitest run tests/world_api_parity.test.ts tests/snapshots.test.ts
  tests/command_schema.test.ts` (the `deedsRarity` facet extension re-pinned
  W0c; W0a/W0b must be green and untouched)
- `npx vitest run tests/architecture.test.ts`
- `npx vitest run tests/localization_fixes.test.ts`
- `npm run gate` (unpiped, background if long; the exit code is the verdict)

Any red is a blocking finding; do not rationalize a red as pre-existing without
proving it red on the merge-base commit.

## 3. Decisive-assertion audit

Dispatch a fresh `test-coverage-auditor` over the implement diff. It must
specifically confirm:

- The idempotence test inserts the SAME (character_id, deed_id) twice and
  asserts exactly one row lands through the fake; a test that inserts twice and
  only asserts "no throw" is indecisive.
- The SCHEMA pins are literal strings (`UNIQUE (character_id, deed_id)`, the
  no-DEFAULT realm line), not the exported constant compared to itself.
- The observer test proves the never-throws contract: a rejecting insert stub
  leaves the FIFO alive and the caller unthrown, and `deedRecordsIdle()` drains
  deterministically.
- The broadcast tests cover BOTH arms of every rule: marquee yes / non-marquee
  no, retro no, opt-out no, ignored-recipient no, offline-recipient no.
- The rarity route test pins the response shape (`totalEligible` plus integer
  map) against the FakeDb fixture, and the sheet test pins the deeds block
  fields by name.

## 4. Domain reviewers (fresh, read-only)

- `migration-safety`: additive/idempotent DDL under the advisory-lock boot with
  concurrent realm processes; `realm TEXT NOT NULL` with no DEFAULT in
  character_deeds (the bank_ledger/character_leases precedent); ON DELETE
  CASCADE consequences for moderation-deleted accounts; the three indexes match
  the three read paths (rarity by deed_id, roll-up by account_id, recent by
  character_id + earned_at DESC); `deed_broadcasts` column additive with a sane
  default; old JSONB saves load untouched.
- `privacy-security-review`: prove there is NO path from any client message to
  a `character_deeds` insert or a broadcast except through a sim-emitted
  `deedUnlocked`; the toggle route requires auth and only flips the caller's own
  account; public rarity and sheet routes are rate-limited and expose nothing
  beyond their contracts; all SQL parameterized; no secrets, no realm-default
  regression.
- `cross-platform-sync` (targeted): the `deedBroadcast` event exists on both
  ends (server emit, `online.ts` handling, hud chat arm) and nowhere else; the
  offline `Sim` path for rarity returns null without error.

Apply every finding: blocking, should-fix, AND nits.

## 5. Adversarial what-is-missing pass

Answer explicitly, with evidence:

- Kill the db mid-session (or stub it rejecting): does the world loop tick rate
  degrade? Does autosave still succeed? Does the rarity endpoint serve stale
  cache instead of erroring?
- Was the bot-detector overlay fixed in BOTH copies? Run the private mirror's
  affected suites if the clone is present; if absent, state that the stub path
  was verified and flag the external copy as pending maintainer sync.
- Does a veteran's first post-rollout login (retro flood) broadcast anything or
  double-insert anything? Prove with the test or a manual run.
- grep the diff for em dashes, en dashes, emojis, and packet vocabulary in
  shipped files (the Stop hook floor catches some of this; check anyway).
- Is `deed_broadcasts` respected for FRIEND recipients too, or only guildmates?
  The spec says both audiences share one owner toggle.
- Confirm no new English literal in `game.ts` emits; if one exists, its matcher
  entry and dedicated test must be in the same commit (S3 blindness note).

## 6. Exit criteria

All acceptance green, all reviewer findings applied, adversarial answers
recorded in the session output, `progress.md` row 4Q set DONE with date. If any
finding required a code change, re-run the affected acceptance commands after
the fix and note the re-run.

End your final response by naming the next file:
`docs/achievements/phase-05-leaderboard.md`.
