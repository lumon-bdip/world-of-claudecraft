# 01 QA: Deeds sim core verification

STATUS: NOT STARTED
Run this in a FRESH session after phase-01-sim-core.md is committed. Read
`docs/achievements/overview.md` and `docs/achievements/phase-01-sim-core.md`
first, then the actual diff (`git log` + `git diff` against the branch point).
Verify against the code as committed, not the implement session's claims.
Reminder: no "phase"/packet vocabulary in anything you commit.

## 1. Re-verify acceptance (all exit codes, never piped)

- `npx vitest run tests/deeds.test.ts tests/deeds_content.test.ts`
- `npx vitest run tests/architecture.test.ts`
- `npx vitest run tests/localization_fixes.test.ts`
- `npx vitest run tests/parity/parity.test.ts`
- `npx vitest run tests/xp.test.ts tests/snapshots.test.ts`
- `npm run gate` (unpiped; normal clone if the worktree fights the full suite)

## 2. Catalog fidelity audit

Diff `src/sim/content/deeds.ts` against `docs/achievements/catalog/*.md`
systematically (a throwaway script is fine): every catalog id present or
explicitly listed as deferred in the implement session's output; names, descs,
renown, hidden/feat flags, and trigger parameters transcribed exactly; nothing
invented that the catalog does not contain. Spot-read 10 entries end to end.
Confirm `DEED_ORDER` covers exactly the `DEEDS` keys and carries the append-only
comment.

## 3. Decisive-assertion audit

Dispatch a fresh `test-coverage-auditor` over the new tests, then verify its
findings yourself. Non-negotiable checks:

- Every pin is a LITERAL (total deed count, total renown, the five milestone
  thresholds, specific renown values). The constant-self-comparison trap
  (asserting an exported constant against itself) fails this audit.
- Every trigger kind has a negative case (threshold minus one, wrong id, wrong
  bracket/difficulty) and a no-double-grant case.
- The pre-deed save fixture is a REAL shape (hand-written JSON without the new
  keys), not a serialize-then-strip of the new code's own output.
- Mutation spot-check, two mutations minimum: (a) flip one trigger threshold in
  the evaluator or content and confirm a test reds; (b) break the renown
  increment and confirm a test reds. Revert mutations by hand, never with
  `git checkout` over uncommitted work.

## 4. Determinism and parity

- Two seeded runs with identical scripted input produce identical
  `deedsEarned`, identical renown, and an identical event stream (the implement
  session's test does this; re-run it and read what it actually asserts).
- Confirm the evaluator contains zero `ctx.rng` / `this.rng` draws (grep the
  module) and that `updateDeeds` sits after `drainDelayedEvents`, before the
  grid refresh, with a comment stating the zero-draw invariant.
- Read the golden diff of the parity regeneration commit: additions of the new
  `PlayerMeta` fields and `deedUnlocked` digest entries ONLY. Any changed
  pre-existing scalar (hp, xp, rng fingerprint, draw count) is a regression;
  stop and fix.
- Confirm the new fields were NOT added to `META_EXCLUDE`.

## 5. Domain reviewer

Dispatch a fresh `architecture-reviewer` over the full committed diff. It must
explicitly confirm: seam additions are append-only (no renames/repurposes), the
evaluator draws no rng, state lives on `Sim`/`PlayerMeta` (no module globals),
sim purity (no DOM/Date.now/Math.random), and the Fiesta-standardization skip
exists and re-marks dirty on restore. Apply every finding, including nits.

## 6. Adversarial what-is-missing pass

Answer each with evidence (file + symbol), not assertion:

- Join-flood: a veteran with a rich save joins; how many `deedUnlocked` events
  fire in one drain, and does anything downstream (server event routing, the
  RL env) choke on a burst of 50+? Verify with a synthetic max-credit save.
- The `''` utcDay case (headless/replay): grants stamp an empty string; nothing
  parses it as a date anywhere in this slice.
- Dual-write honesty: does a legacy-milestone-only save round-trip through
  serialize/load twice without churn (byte-equal second save)?
- Is `renown` recomputed on load (saved value ignored for authority)?
- Can `grantDeed` be reached from any client-facing command in this slice? (It
  must not be.)
- Do the seam callbacks mark dirty on NO-OP changes (re-adding a present set
  member must not dirty)?
- Are there deeds whose trigger reads state that `sanitizeRemovedZone1Content`
  can strip? What happens then?

## 7. Exit criteria

All acceptance green; catalog fidelity confirmed with deferrals ruled on or
ticketed; both mutations redded a test; reviewer findings applied; adversarial
answers documented in the session output. Update
`docs/achievements/progress.md` (row 1Q DONE with date). Commit any QA-driven
fixes with explicit paths (`fix(deeds): ...` or `test(deeds): ...`). End your
final response by naming the next file:
`docs/achievements/phase-02-iworld-wire.md`.
