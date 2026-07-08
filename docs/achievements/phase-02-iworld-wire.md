# 02: IWorldDeeds facet, title command, and the wire

STATUS: NOT STARTED

Read `docs/achievements/overview.md` first; its sections 3 to 5 pin every
canonical name used here and its rules bind this session. This file assumes the
01 session landed: `DeedDef`, `DEEDS`/`DEED_ORDER`, the evaluator in
`src/sim/deeds.ts`, `PlayerMeta.deedsEarned` / `deedStats` / `activeTitle`,
`CharacterState.deeds` / `deedStats` / `activeTitle` / `renown`, and the
`deedUnlocked { pid, deedId, retro? }` sim event. Packet vocabulary (the word
"phase", packet file names) must not appear in any shipped artifact.

## Goal

Expose deeds through the one seam render/ui may consume: a new `IWorldDeeds`
facet implemented by BOTH worlds (offline `Sim`, online `ClientWorld`), a
`deed_set_title` wire command, and an entity-level `title` field so other
players' active titles render on nameplates and inspect. All three wire gates
(W0a snapshots, W0b command schema, W0c parity) are updated in the SAME commit
as the seam change. No UI renders anything yet; a later session consumes this
facet.

## Context to load (read before editing)

- `docs/achievements/overview.md` (authoritative decisions and names)
- `src/world_api.ts` (facet map header comment, the `extends` aggregate,
  `COMMAND_NAMES`, `DISPATCH_ONLY_COMMANDS`, `WorldFacet`, `COMMAND_FACETS`)
- `src/world_api/bank.ts` (the facet-file shape to copy: header doc, aux types,
  interface) and `src/world_api/daily_rewards.ts` (the async variant; this
  session ships no async member, but the persistence session later appends one
  async read to this facet, so know the shape)
- `tests/world_api_parity.test.ts` (W0c): `IWORLD_MEMBERS`, the
  total/data/method literal count pins, the THREE sorted-name `toEqual`
  snapshots (full, data, method), the `FACET_*` arrays with their
  `AssertNever` exhaustiveness types, `FACET_MEMBER_ARRAYS`, and the facet
  count pin
- `tests/snapshots.test.ts` (W0a): `ALL_DELTA_KEYS` (a literal sorted list with
  a count pin), the scrape test that asserts it equals the `maybe(...)` keys in
  `server/game.ts`, and `TERSE_TO_IWORLD`
- `tests/command_schema.test.ts` (W0b)
- `src/net/online.ts`: the ClientWorld mirror fields (see `bankInfo` and its
  snapshot apply), `applySnapshot`, the `applyWire` closure, the
  `msg.t === 'events'` passthrough, and the typed `cmd()` send path
- `server/game.ts`: `selfWireJson` and the HEAVY_SELF change-gating comment
  above it, `wireEntity`, and the `dispatchMessage` command switch (the bank
  cases are the template)
- `src/sim/CLAUDE.md` and the architecture guard `tests/architecture.test.ts`
  (facet files import sim TYPES only, no i18n, no host imports)

Reference symbols when navigating; line numbers in this packet rot.

## Design spec

### The facet: `src/world_api/deeds.ts`

`IWorldDeeds` has exactly five members in THIS session, four data + one method.
(A later session extends it: the persistence slice appends ONE async read,
`deedsRarity(): Promise<Record<string, number> | null>`, and re-pins the same
three gates then. Build the five members now and keep `FACET_DEEDS` and its
`AssertNever` exhaustiveness type trivially extensible; do not pre-add the
member.)

- `deedsEarned: ReadonlyMap<string, string>` (data): deed id to the utcDay
  string earned ('YYYY-MM-DD', possibly ''), for the SELF player. Sim exposes its live per-player map (the `questLog`
  precedent); ClientWorld maintains a mirror `Map` rebuilt on snapshot apply.
- `deedStats: Readonly<DeedStats>` (data): the persisted lifetime counter block
  (type imported from `../sim/types`; it was defined in the 01 session).
- `renown: number` (data): the self player's current Renown total, exactly the
  denormalized value the evaluator maintains.
- `activeTitle: string | null` (data): the SELF player's selected title deed id.
- `setActiveTitle(deedId: string | null): void` (method): request a title
  change. Offline: delegates straight into the sim helper. Online: sends the
  wire command and waits for the snapshot echo (no optimistic local write; the
  bank precedent).

File header documents the facet in the `bank.ts` style. The facet imports ONLY
`import type` from `../sim/types`. No aux interfaces are needed; if `DeedStats`
must be re-exported for downstream `from '../world_api'` imports, re-export it
as a type in `src/world_api.ts` beside the other facet aux re-exports.

Aggregate wiring in `src/world_api.ts`: add the `import type`, the line in the
facet-map header comment (`deeds.ts  IWorldDeeds  earned deeds, lifetime stats,
renown, active title`), and `IWorldDeeds` in the `extends` clause. Append
`'IWorldDeeds'` to the `WorldFacet` union.

### Title validation (sim-side, both worlds)

Validation lives in `src/sim/deeds.ts` (a pure helper the Sim method and the
server dispatch both reach through the sim): a non-null `deedId` is accepted
only when (a) the player has earned it and (b) `DEEDS[deedId].reward` exists
with kind `title`. `null` always clears. Invalid input is a SILENT no-op
(defensive against stale clients; no error event, no player text, so the S3
i18n guard has nothing to see). On accept, the helper writes
`PlayerMeta.activeTitle` AND the player's entity `title` field (below) so both
read paths agree within the same tick.

### The command: `deed_set_title`

- Append `'deed_set_title'` at the END of `COMMAND_NAMES` (append-only; the
  wire string is the protocol). It is NOT dispatch-only.
- Tag it in `COMMAND_FACETS` as `IWorldDeeds`.
- Server: a new `case 'deed_set_title':` in the `dispatchMessage` switch,
  shaped like the bank cases: validate the payload shape (a string deed id or
  null), then call the sim entry point. The server never decides validity
  itself; the sim helper does.
- Client: `ClientWorld.setActiveTitle` sends
  `{ cmd: 'deed_set_title', deedId }` through the typed `cmd()` path.

### Entity wire: the `title` field

Add `title` to the `Entity` shape in `src/sim/types.ts` (optional,
`string | null`, default null; a deed id, never display text). The sim writes
it for player entities when the active title changes and on player spawn from
persisted state. `wireEntity` in `server/game.ts` emits the key ONLY when
non-null (mobs and untitled players pay zero bytes); `applyWire` in
`src/net/online.ts` copies it onto the mirrored entity, defaulting null.
(`wireEntity` has no existing `title` key; verified at packet authoring. The
canonical wire name is `title`.) Unchanged entities ride the `keep` list, so
the field costs bytes only when an entity re-wires.

### Self-state wire: ride the snapshot delta machinery, never bespoke sync

The four self values flow through `selfWireJson` as change-gated `maybe(...)`
delta keys, which is exactly the "send once on join, then only on change"
behavior required (HEAVY_SELF starts true so the first snapshot after hello is
full; afterwards a key is emitted only when its value changed):

- `deeds` (terse) -> `deedsEarned`: a plain JSON object `{ [deedId]: utcDay }`.
  Maps and Sets do NOT survive JSON.stringify (a `Set` silently becomes `{}`);
  the wire shapes are plain objects/arrays and ClientWorld rebuilds the `Map`
  here and BOTH `Set`s in `dstats` on apply. Re-sent only when an unlock
  changes the set (rare).
- `dstats` (terse) -> `deedStats`: the COMPLETE `DeedStats` shape as plain
  JSON: the numeric counters, `dungeonClears` as a plain record, and the two
  sets (`itemsDiscovered`, `visited`) serialized as string arrays; ClientWorld
  reconstructs the `Set`s on apply. It changes during combat ticks, the same
  cadence xp and copper already ride; worst case the arrays hold about 400
  short ids and the key is emitted only when the change-gate fires, so this is
  in-pattern.
- `renown`: a number, same name both sides (no rename entry).
- `atitle` (terse) -> `activeTitle`: string or null.

Follow the HEAVY_SELF change-tracking pattern for `deeds` and `dstats` (per
session dirty bookkeeping, full resend on reconnect for free). `renown` and
`atitle` are cheap scalars gated by plain value comparison like the existing
light fields.

`deedUnlocked` rides the existing per-player `{ t: 'events', list: [...] }`
frame untouched (the generic events passthrough already forwards it to the HUD
queue). PRESENTATION ONLY: ClientWorld must NOT mutate `deedsEarned`,
`renown`, or any mirror from the event; snapshot state is the single
authority, which makes reconnects and missed frames a non-issue. Spell this
out in a comment at the mirror site.

### ClientWorld mirror

Mirror fields on ClientWorld: `deedsEarned` (Map, initially empty), `deedStats`
(zeroed object of the `DeedStats` shape), `renown` (0), `activeTitle` (null).
`applySnapshot` applies each terse key when present (the `bankInfo` apply is
the template). The offline `Sim` satisfies the facet with getters over
`PlayerMeta` plus the `setActiveTitle` delegation; both worlds expose the SAME
member kinds (data as properties/getters, the method as a function).

### Test updates (same commit as the seam change)

`tests/world_api_parity.test.ts` (W0c):
- Append the five members to `IWORLD_MEMBERS` with correct kinds (four `data`,
  one `method`).
- Update the three literal count pins (total / data / method) to whatever the
  list now sums to AT EXECUTION TIME (read the current literals; do not assume
  packet-time values; at packet authoring they were 203 / 53 / 150 and this
  change adds 4 data + 1 method). Update the stale prose counts in the comment
  above `IWORLD_MEMBERS` and in the pinned-contract describe titles.
- Insert the five names into the THREE sorted-name `toEqual` snapshots (full,
  data-only, method-only), in correct sort position.
- Add `FACET_DEEDS` (five names, `satisfies readonly (keyof IWorldDeeds)[]`)
  plus `type _ExhaustDeeds = AssertNever<Exclude<keyof IWorldDeeds,
  (typeof FACET_DEEDS)[number]>>`, register `deeds: FACET_DEEDS` in
  `FACET_MEMBER_ARRAYS`, and bump the facet count pin by one (25 -> 26 at
  packet time; re-read the current literal).

`tests/snapshots.test.ts` (W0a):
- Add the four new keys to `ALL_DELTA_KEYS` in sorted position and bump its
  literal count pin (36 -> 40 at packet time; re-read).
- Add `deeds -> deedsEarned`, `dstats -> deedStats`, `atitle -> activeTitle`
  to `TERSE_TO_IWORLD` (sorted; `renown` is not a rename and must NOT appear).
- Extend the round-trip fixture so the self wire JSON carries a NON-EMPTY
  earned map (at least two deeds with distinct utcDays), non-zero stats, a
  renown value, and a non-null active title, and assert they survive
  `applySnapshot` into the IWorld members. An empty-map fixture would be a
  vacuous pin.
- If the entity-wire shape is pinned anywhere in this file, extend it for
  `title` (present when non-null, absent when null).

`tests/command_schema.test.ts` (W0b): `deed_set_title` joins the universe
(the COMMAND_NAMES import usually makes this automatic; verify the send-set
subset test sees the ClientWorld send and that any literal counts here are
updated).

Behavior tests (extend the deeds sim test file created in the 01 session):
- `setActiveTitle` accepts an earned title-reward deed; the entity `title`
  field updates the same tick.
- Rejects (silent no-op, state unchanged): an unearned deed id, an earned deed
  WITHOUT a title reward, an unknown/deleted id, and a non-string payload
  through the server dispatch path.
- `null` clears both `PlayerMeta.activeTitle` and the entity field.

### Golden and parity trace implications

`Entity` gains a field and `CharacterState` already changed in 01. If the
parity golden traces redden, regenerate them DELIBERATELY in this commit,
inspect the field-key churn, and say so in the commit body (they are
state-hash pins, not behavior claims). Never regenerate to silence an
unexplained diff.

## Out of scope (owned by other packet files)

- Any UI: window, nameplates rendering the title text, watchlist, toasts (03).
- `character_deeds` persistence, rarity, broadcasts (04). Leaderboards (05).
- Wiki (06). Steam (07). Mobile and a11y (08).
- Removing `unlockedMilestones` from IWorld: it stays this release
  (dual-write rollback insurance; overview section 4).

## Steps

1. Read the context list. Confirm the 01 session's surface exists (types,
   evaluator, event); if anything is missing, STOP and flag it instead of
   re-implementing.
2. Write `src/world_api/deeds.ts`; wire the aggregate (`import type`, header
   comment line, `extends`, `WorldFacet`, aux re-export if needed).
3. Append `deed_set_title` to `COMMAND_NAMES` and `COMMAND_FACETS`.
4. Sim side: title validation helper in `src/sim/deeds.ts`, `Entity.title`
   field, Sim facet members (getters + `setActiveTitle`), entity field set on
   spawn from persisted state.
5. Server side: `dispatchMessage` case; `selfWireJson` maybe-keys with
   HEAVY_SELF gating for `deeds`/`dstats`; `wireEntity` emits `title` when
   non-null.
6. Client side: ClientWorld mirrors + `applySnapshot` handling + `applyWire`
   copy + `setActiveTitle` send. Comment the events-are-presentation rule at
   the mirror site.
7. Update all three gate tests plus behavior tests, same commit.
8. `npx @biomejs/biome check --write` each touched file.

## Acceptance (all green before the session ends)

```
npx vitest run tests/world_api_parity.test.ts
npx vitest run tests/snapshots.test.ts
npx vitest run tests/command_schema.test.ts
npx vitest run tests/architecture.test.ts
npx vitest run tests/deeds.test.ts        (name as created in the 01 session)
npm run gate                              (unpiped, exit-code-safe)
```

Manual spot-check (offline dev world): earn a title deed via the dev path,
`setActiveTitle` from the console world handle, confirm the sim entity carries
the id; then the same against a local server with two clients, confirming the
second client sees the first's entity `title` after re-wire.

## Reviewer dispatch (fresh agents, at completion)

- `cross-platform-sync`: full facet + wire + event drift audit (checklist in
  the QA file).
- `test-coverage-auditor`: pin quality on the three gates and the behavior
  tests.
- The in-session `qa-checklist` self-review before handoff, per repo standard.

## Adversarial pass (answer each in the session output)

- Does any path let ClientWorld state drift from Sim state (event-derived
  mutation, missed terse key, rename gap in `TERSE_TO_IWORLD`)?
- Reconnect: does a fresh hello resend ALL four self fields (HEAVY_SELF reset)?
- Is `deedsEarned` ever exposed as a live mutable reference across the seam a
  consumer could mutate?
- JSON traps: Map/Set silently serializing to `{}`; utcDay as string vs number.
- Does the RL action layer or any dev command need `deed_set_title`
  dispatch-only handling? (Expected: no; confirm.)
- Could a malicious client set another player's title or a non-title deed via
  raw socket frames? (Server dispatch must route through the sim validator.)
- Bytes: confirm `title` is omitted when null and `deeds` is not re-sent per
  snapshot (log one snapshot in dev and eyeball the keys).

## End of session

- Update `docs/achievements/progress.md` (row 2 -> DONE with date).
- Commit touched paths EXPLICITLY (never `git add -A`), Conventional Commits,
  suggested split: `feat(deeds): expose deeds through the world seam` and
  `feat(net): wire deed state and title command` if two commits are cleaner.
  No packet vocabulary in messages.
- Name the next file, exactly: `docs/achievements/phase-02-qa.md`.
