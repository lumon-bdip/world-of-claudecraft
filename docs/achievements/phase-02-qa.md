# 02 QA: IWorldDeeds facet and wire

STATUS: NOT STARTED

Dedicated verification session for the 02 implement session. Run AFTER 02 is
committed, in a fresh session. Read `docs/achievements/overview.md` and
`docs/achievements/phase-02-iworld-wire.md` first, then the actual diff
(`git log --oneline` since the 01 QA commit, `git show` each). Verify against
the CODE, not the implement file's claims. Packet vocabulary stays out of any
fix commits this session produces.

## 1. Re-run acceptance

```
npx vitest run tests/world_api_parity.test.ts
npx vitest run tests/snapshots.test.ts
npx vitest run tests/command_schema.test.ts
npx vitest run tests/architecture.test.ts
npx vitest run tests/deeds.test.ts
npm run gate        (unpiped; a piped gate masks its exit code)
```

If goldens were regenerated in 02, diff the regeneration commit and confirm
the churn is field-key only (state-hash pins), with the reason stated in the
commit body.

## 2. Domain reviewer: cross-platform-sync (fresh agent, mandatory)

Dispatch with this explicit checklist and require a finding-by-finding
response:

- Every `IWorldDeeds` member exists SAME-KIND on both `Sim` and `ClientWorld`
  (data as property/getter, method as function); none is a stub on either side.
- `deedUnlocked` reaches the HUD event queue in BOTH hosts: offline via the
  drained `tick()` return, online via the `{ t: 'events' }` frame passthrough.
- ClientWorld derives NO state from `deedUnlocked` (presentation only; the
  snapshot is the single authority). Grep the mirror for event-driven writes.
- Entity `title`: set in the sim on title change AND on player spawn from
  persisted state; emitted by `wireEntity` only when non-null; applied by
  `applyWire`; a remote player's title survives the entity leaving and
  re-entering interest range.
- `TERSE_TO_IWORLD` covers every renamed terse key (`deeds`, `dstats`,
  `atitle`) and nothing else new; `renown` correctly absent.
- HEAVY_SELF gating: fresh hello resends all four fields; an unlock re-sends
  `deeds`; an ordinary combat tick re-sends `dstats` but NOT `deeds`.
- `deed_set_title` is in `COMMAND_NAMES`, `COMMAND_FACETS`, the server
  dispatch switch, and the ClientWorld send path, byte-identical everywhere.
- Facet purity: `src/world_api/deeds.ts` imports sim TYPES only (the
  architecture scan covers this; confirm it actually ran on the new file).

## 3. Decisive-assertion audit: test-coverage-auditor (fresh agent)

Known traps to check by name:

- The three W0c count pins and the W0a key-count pin are LITERALS, not
  expressions derived from the arrays they pin (the constant-self-comparison
  trap gives zero protection).
- The new command is pinned in BOTH `tests/command_schema.test.ts` AND
  `tests/world_api_parity.test.ts` surfaces; a past change shipped with only
  one and the gap was found in review.
- The snapshot round-trip fixture is non-vacuous: non-empty earned map (two or
  more entries, distinct utcDays), non-zero stats, non-null title; assert the
  values, not just key presence.
- Negative cases exist per validation arm: unearned deed, earned non-title
  deed, unknown id, null clears, malformed payload via dispatch. Each asserts
  state UNCHANGED, not merely "no throw".
- The sorted-name snapshots actually contain the five new names (spot-check
  one insertion position per list).

## 4. Adversarial what-is-missing pass (this session, after the agents report)

- Simulate a stale client: send `deed_set_title` for an id that exists on the
  wire but not in `DEEDS` (content drift); confirm silent no-op server-side.
- Kill the socket mid-session and reconnect: all four self fields repopulate.
- Two browser clients on a local server: client B sees client A's title on
  A's entity; A clears it; B sees null after re-wire.
- Confirm nothing in this slice grew `sim.ts`/`hud.ts`/`main.ts`/`renderer.ts`
  beyond thin delegation lines (module-first).
- Confirm no player-visible English was introduced anywhere in this slice
  (silent no-ops mean zero new strings; the S3 guard run is part of gate).

## 5. Exit criteria

All acceptance commands green; both reviewer agents report no unresolved
findings at should-fix or above (apply EVERY finding, including nits, per
standing rule); adversarial answers written into the session output; any fix
commits pushed with explicit paths and clean messages.

## End of session

- Update `docs/achievements/progress.md` (row 2Q -> DONE with date, notes for
  any fixes landed).
- Name the next file, exactly: `docs/achievements/phase-03-deeds-window.md`.
