# 01: Deeds sim core (catalog, evaluator, persisted state, events)

STATUS: NOT STARTED
Packet: read `docs/achievements/overview.md` FIRST; it is authoritative for names
and product decisions. This file is self-contained beyond that. Reminder: the word
"phase" and any packet reference must never appear in code, comments, commit
messages, or PR text.

## Goal

The deterministic core of the achievements system, complete and tested, with no
consumer-facing surface yet: the `DeedDef` content schema, the full v1 catalog
transcribed into `src/sim/content/deeds.ts`, the `src/sim/deeds.ts` evaluator
behind `SimContext`, persisted per-character earned state and lifetime counters,
the `deedUnlocked` event, milestone unification, and retroactive evaluation on
join. After this session the sim grants deeds correctly in all three hosts; no
window, wire, database, or Steam work happens here.

## Context to load first

- `docs/achievements/overview.md` (all sections) and `docs/achievements/catalog/`
  (README + every category file; it is the content source of truth).
- `src/sim/CLAUDE.md` in full: the coordinator map, the SimContext seam rules
  (append-only), "Adding a mechanic here", determinism, and the player-facing
  text rules (S3).
- `src/sim/content/CLAUDE.md` (content conventions).
- Source anchors (read the symbol, do not trust line numbers): `RewardCounters`,
  `PlayerMeta`, `CharacterState`, `addPlayer`, `serializeCharacter`, and the
  `tick()` tail (the block from `updateDuels` through `drainDelayedEvents`) in
  `src/sim/sim.ts`; `accrueLifetimeXp` + `checkMilestones` and the
  `counters.kills` / `counters.deaths` / `damageDealt` / `damageTaken` sites in
  `src/sim/combat/damage.ts`; `MILESTONES` and the `SimEvent` union in
  `src/sim/types.ts`; `src/sim/quests/quest_credit.ts` (the seam-callback shape
  to copy, including its `meta.wireRev++` dirty signal); `turnInQuestCore` in
  `src/sim/quests/quest_commands.ts`; the heroic final-boss award site in
  `src/sim/instances/dungeons.ts`; `applyHeal` in `src/sim/combat/heal.ts`;
  the `counters.lootCopper` site in `src/sim/loot/loot_roll.ts`; the
  `addItem` inventory hub in `src/sim/sim.ts`; `resolveHarvest` in
  `src/sim/professions/gathering.ts`; duel resolution in `src/sim/social/duel.ts`;
  trade completion in `src/sim/social/trade.ts`; mail send in
  `src/sim/mail/post_office.ts`.
- `tests/parity/CLAUDE.md` (what the goldens pin and why they will move).

Worktree note: this branch may live in a git worktree. Run `npm ci` there before
anything else. Targeted vitest and tsc are reliable in a worktree; if the FULL
suite or the gate misbehaves, run those from a normal clone of the branch.

## Design spec

### Types (`src/sim/types.ts`)

`DeedCategory`: a string union matching the catalog prefixes: `progression`,
`combat`, `dungeon`, `delve`, `chronicle`, `collection`, `pvp`, `social`,
`exploration`, `feat`, `hidden`.

`DeedTrigger`, a discriminated union of DATA records (content is data-as-code;
no functions in content). Kinds, matching the catalog README vocabulary:

- `{ kind: 'level'; level: number }`: `Entity.level` at or above.
- `{ kind: 'lifetimeXp'; amount: number }`: `PlayerMeta.lifetimeXp` at or above
  (the milestone unification kind).
- `{ kind: 'quest'; questId: string }` and `{ kind: 'quests'; questIds: string[] }`:
  membership in `questsDone` (all of, for the plural form).
- `{ kind: 'stat'; stat: DeedStatKey; count: number }`: a lifetime counter from
  `deedStats` at or above `count`.
- `{ kind: 'dungeonClears'; dungeonId: string; difficulty?: 'normal' | 'heroic'; count: number }`:
  reads the NEW `deedStats.dungeonClears` record (keys `<dungeonId>` and
  `<dungeonId>:heroic`).
- `{ kind: 'delveClears'; delveId: string; count: number }`: reads the EXISTING
  persisted `PlayerMeta.delveClears`.
- `{ kind: 'arenaRating'; bracket: '1v1' | '2v2'; rating: number }`: reads the
  existing persisted standings.
- `{ kind: 'craftSkill'; craftId: string; level: number }` and
  `{ kind: 'gathering'; professionId: string; amount: number }`: existing
  persisted records.
- `{ kind: 'collectItems'; itemIds: string[]; count?: number }`: at least
  `count` (default all) of the listed ids present in `deedStats.itemsDiscovered`.
- `{ kind: 'visit'; markId: string }` and `{ kind: 'visits'; markIds: string[]; count?: number }`:
  membership in `deedStats.visited` (stable string marks like `npc:saul` or
  `poi:eastbrook_falls`; each mark is fed by an explicit site).
- `{ kind: 'meta'; deedIds: string[] }`: all listed deeds earned.
- `{ kind: 'manual' }`: granted only by an explicit `grantDeed` call at a bespoke
  sim site (encounter mechanical/perfection/restriction/speed tasks, hidden
  easter eggs). Never satisfied by the generic evaluator.

`DeedReward`: `{ kind: 'title'; text: string } | { kind: 'border'; slug: string }`.
The title `text` (and border `slug`) is English content carried on the def, the
same way `name`/`desc` are; the client localizes it via `deed_i18n.ts` like the
other deed strings. `DeedDef`:
`{ id, name, desc, category, renown: 0 | 5 | 10 | 25 | 50, trigger, reward?,
hidden?, feat? }` with `name`/`desc` English (localized at the client boundary in
a later session; the S3 contract is unaffected because no deed text is EMITTED
by the sim).

New `SimEvent` member: `{ type: 'deedUnlocked'; deedId: string; retro?: boolean }`
(personal: always emitted with `pid`). It carries ids only, never English.

### Content (`src/sim/content/deeds.ts`, merged by `data.ts`)

Transcribe every entry from `docs/achievements/catalog/*.md` into `DEEDS` plus
`DEED_ORDER` (append-only, the `QUEST_ORDER` determinism contract; a comment says
so). Keep ids, names, descs, renown, triggers, rewards, hidden/feat flags exactly
as the catalog states. If a catalog entry's trigger cannot be implemented without
invasive new tracking, DO NOT silently drop or approximate it: implement the
cheap majority, and list every deferred entry with the reason in the session
output so the maintainer can rule. `data.ts` re-exports `DEEDS`/`DEED_ORDER`.
Do not edit the catalog files themselves and do not delete anything in
`docs/achievements/`.

Also transcribe the three Chronicler NpcDefs defined in
`docs/achievements/catalog/chronicles.md` into their zone content files:
`chronicler_saul` (zone 1), `chronicler_osric_fenn` (zone 2),
`chronicler_edda_hartwell` (zone 3). Interaction-only NPCs: no quests, no
vendor. The SIM interact arm for these templateIds feeds `markVisited` and the
Saul consecutive-talk counter here (this slice owns the sim sites); the
client-side arm that opens the Book of Deeds window is the window session's
work. Entity ADDITIONS red the parity golden traces; that is expected and part
of this slice's deliberate golden regeneration (step 9).

### Persisted state

`PlayerMeta` additions (state on `Sim`, never module globals):

- `deedsEarned: Map<string, string>` (deed id to utcDay string, '' when unknown).
- `deedStats: DeedStats`: numeric lifetime counters PLUS two string sets:
  `itemsDiscovered: Set<string>` and `visited: Set<string>`, plus
  `dungeonClears: Record<string, number>`. Implement EXACTLY the numeric
  counters the transcribed catalog references, chosen from this anchored menu
  (site in parentheses): `kills`, `deaths`, `damageDealt`, `damageTaken`
  (the four existing `counters.*` sites in `combat/damage.ts`), `healingDone`
  (`applyHeal`), `lootCopper` (`loot_roll.ts`), `questsCompleted`
  (`turnInQuestCore`), `duelsWon` (duel resolution), `tradesCompleted` (trade
  completion), `mailSent` (post office send), `gatherHarvests`
  (`resolveHarvest`), `craftsPerformed` (the craft command site). Do not add
  counters no deed reads. `RewardCounters` stays untouched (it is the session
  RL/reward surface; deedStats is the persisted lifetime surface; they double
  up at some sites by design).
- `activeTitle: string | null` (persist/load only here; the setter command is
  the next session's work).
- `renown: number`: incrementally maintained sum of earned deeds' renown.

`CharacterState` additions, ALL optional and written conditionally (absent when
empty/null/zero) so pre-deed saves and parity samples stay byte-equal until the
system actually engages: `deeds?: Record<string, string>`,
`deedStats?: { ...numeric fields; itemsDiscovered: string[]; visited: string[]; dungeonClears: Record<string, number> }`,
`activeTitle?: string | null`, `renown?: number`. On load, `renown` is
RECOMPUTED from the earned set (the sim is authoritative; the saved number
exists for a later SQL sort index only). `itemsDiscovered` and `visited` are
bounded by construction (item ids and authored marks); assert in a test that no
unbounded key source feeds them.

### The evaluator (`src/sim/deeds.ts`)

A system module behind `SimContext`, the `quest_credit.ts` shape: pure functions,
zero rng, state on `Sim`. New `Sim` field `deedDirtyPids: Set<number>` exposed as
a live primitive view on the seam. Seam callbacks (append-only additions to
`sim_context.ts`, bound in `buildSimContext()`):

- `bumpDeedStat(meta, stat, delta)`: increments a numeric counter and marks dirty.
- `markItemDiscovered(meta, itemId)` (call from the `addItem` hub) and
  `markVisited(meta, markId)`: set adds, mark dirty only when newly added.
- `markDeedsDirty(pid)`: for sites that mutate existing persisted state a
  trigger reads (quest turn-in, delve clear, arena result, craft/gather grants,
  lifetime-XP accrual).
- `grantDeed(meta, deedId, opts?)`: idempotent manual grant, same path as
  evaluator grants.

`updateDeeds(ctx)` runs at the `tick()` tail. Placement: immediately after
`drainDelayedEvents(this.ctx)` and before the grid refresh. This satisfies the
overview (it is after `updateValeCup`) and sees same-tick delayed-event results;
because the evaluator draws ZERO rng, its position cannot fork the draw order
(the Vale Cup precedent comment applies; write the same style of comment).
For each dirty pid: skip if `meta.fiestaRestore` is non-null (a Fiesta bout
standardizes the character to level 20, which can move `Entity.level` UP for a
low-level player and must never satisfy level deeds; the player re-evaluates
after restore, so mark them dirty again on bout exit), otherwise check every
unearned deed's trigger, grant, then re-check `meta` deeds to a fixpoint within
the same pass (bounded: each iteration must grant at least one deed). A static
index from trigger dependency to deed ids is an allowed optimization, not a
requirement; the naive full scan of a catalog this size for the handful of
dirty players per tick is within budget.

Granting: set `deedsEarned[id] = ctx.utcDay` (may be ''), add the deed's renown
to `meta.renown`, `meta.wireRev++`, emit `{ type: 'deedUnlocked', deedId, pid }`
(plus `retro: true` on the join pass). Feats and 0-renown deeds grant normally
and add nothing to renown.

### Milestone unification

- The five `MILESTONES` become `prog_` deeds with `lifetimeXp` triggers and
  title/border rewards (the catalog carries them; verify the thresholds match
  `MILESTONES` exactly).
- `checkMilestones` in `combat/damage.ts` is replaced by `markDeedsDirty` at the
  `accrueLifetimeXp` tail, and the legacy `milestoneUnlocked` EMIT is removed
  entirely in this slice: `deedUnlocked` is the single grant event (the
  `SimEvent` union member may remain temporarily; the window session deletes it
  and the dead HUD arm). The grant path still dual-writes `unlockedMilestones`
  so the character panel keeps working. Accepted gap on this unreleased branch:
  between this slice and the window session, crossing a milestone shows no
  banner; the five `prog_` milestone deeds regain their banner via the
  `deedUnlocked` arm the window session adds.
- Load path: union `savedState.deeds` with the mapping of
  `savedState.unlockedMilestones` to their `prog_` deed ids.
  `serializeCharacter` writes both fields (dual-write for one release, the
  forward-only bank precedent).

### Retro on join

At the end of `addPlayer` (after the saved state is fully restored), run the
evaluator once for that player with `retro: true`. This is how veterans get
credit: predicates over persisted state (quests done, level, lifetime XP, delve
clears, arena rating, craft/gathering) grant immediately; counters start at
zero, so counter deeds do not retro-grant. Events emitted here drain with the
next tick and reach only that player. Determinism note for tests: the retro
pass is a pure function of the loaded state and the catalog.

## Out of scope (owned by later packet files; do not touch)

IWorld facet, wire, commands, ClientWorld, parity-test member pins (02); any
UI, HUD, keybind, renderer, audio, `deed_i18n.ts` (03); server persistence,
`character_deeds`, broadcasts, rarity (04); leaderboards (05); wiki/guide (06);
Steam (07); mobile/a11y (08). Also out: the `deed_set_title` command and any
validation of `activeTitle` beyond persist/load.

## Steps

1. `npm ci` in the worktree; confirm `npx vitest run tests/architecture.test.ts`
   is green before touching anything.
2. Types: `DeedCategory`, `DeedTrigger`, `DeedReward`, `DeedDef`, the
   `deedUnlocked` event member, `DeedStats`, `CharacterState` additions.
3. Content: transcribe the catalog into `src/sim/content/deeds.ts`; merge in
   `data.ts`; transcribe the three Chronicler NpcDefs into the zone content
   files and wire their sim interact sites; write the content-integrity test
   (step 8) alongside.
4. Module: `src/sim/deeds.ts` (evaluator, grant path, retro pass, the stat/mark
   helpers); `Sim` fields (`deedsEarned` et al on `PlayerMeta` init in
   `addPlayer`, `deedDirtyPids` on `Sim`); seam callbacks appended in
   `sim_context.ts` + bound in `buildSimContext()`; the `tick()` tail call.
5. Sites: wire the increment/mark/dirty calls listed in the design spec.
   Replace `checkMilestones` per the milestone unification spec (single-emit
   `deedUnlocked`; legacy emit removed).
6. Persistence: `serializeCharacter` conditional writes; `addPlayer` restore
   (including the milestone union) and the retro pass at its end.
7. Biome the touched files individually.
8. Tests (`tests/deeds.test.ts`, plus `tests/deeds_content.test.ts`):
   - Content integrity: every id matches its category prefix; renown values in
     the allowed set; every `feat` has renown 0; every `meta`/`quest`/
     `dungeonClears`/`delveClears`/`collectItems` reference resolves against
     `DEEDS`/`QUESTS`/`DUNGEONS`/`DELVES` (delve list)/`ITEMS`; `DEED_ORDER`
     covers exactly the `DEEDS` keys; hidden and feat sets are disjoint from
     each other where the catalog says so. Pin the total deed count and total
     renown as LITERALS (update deliberately when the catalog changes).
   - Per-trigger-kind grant tests with a negative case each (threshold minus
     one does not grant; grant fires exactly once; already-earned never
     re-fires).
   - Meta fixpoint in one pass; 0-renown grants add no renown.
   - Fiesta standardization does not grant level deeds; the player evaluates
     after restore.
   - Retro pass: a synthetic `CharacterState` with quests/lifetimeXp/delve
     clears grants on `addPlayer` with `retro: true`; counters do not.
   - Legacy save with `unlockedMilestones` maps to the `prog_` deeds; new saves
     dual-write; the five thresholds equal `MILESTONES` literally.
   - Serialize/load round-trip for all new fields; a pre-deed save (fixture
     without the new keys) loads clean and serializes without them until the
     system engages.
   - Determinism: two sims, same seed, same scripted actions, identical
     `deedsEarned` and event streams.
9. Parity goldens: they WILL move (new sampled `PlayerMeta` fields, the three
   Chronicler entity additions, and `deedUnlocked` in the event digest).
   Regenerate with
   `UPDATE_PARITY=1 npx vitest run tests/parity/parity.test.ts`, then re-run
   without the flag. Review the golden diff: field additions and deed events
   only; anything else is a real regression. Do NOT add the new fields to
   `META_EXCLUDE` (they are deterministic persisted state and deserve pinning).
   Explain the regeneration in the commit body.

## Acceptance

All of the following, exit codes checked (never piped through tail):

- `npx vitest run tests/deeds.test.ts tests/deeds_content.test.ts`
- `npx vitest run tests/architecture.test.ts`
- `npx vitest run tests/localization_fixes.test.ts` (the S3 guard; this slice
  emits no new player English, so it must stay green with zero matcher changes.
  If you added ANY `notice`/`error` text, you also added its `sim_i18n.ts`
  matcher in the same change per `src/sim/CLAUDE.md`.)
- `npx vitest run tests/parity/parity.test.ts` (post-regeneration)
- `npx vitest run tests/xp.test.ts tests/snapshots.test.ts` (milestone touchers)
- `npm run gate` (full, unpiped; from a normal clone if the worktree fights the
  full suite)

## Reviewer dispatch (fresh agents, never the implementer)

- `architecture-reviewer` over the full diff: rng draw-order neutrality (the
  evaluator must have zero draws), tick-phase placement, SimContext append-only
  contract, sim purity, state-on-Sim.
- `test-coverage-auditor`: decisive assertions per trigger kind, literal pins
  (never constant-self-comparison), negative cases, the fixture quality of the
  pre-deed save.

Apply every finding: blocking, should-fix, and nits alike.

## Adversarial pass (answer each in the session output)

- Which catalog entries were deferred and why? (List or state "none".)
- Can any trigger be satisfied by dev cheats in production? (`ALLOW_DEV_COMMANDS`
  must be the only path; confirm.)
- Can `renown` drift from the earned set under any sequence? What re-syncs it?
- Do the two string sets have any unbounded key source?
- Does any new site run per-frame work for non-dirty players?
- What happens to deeds earned during a Vale Cup seat or a delve run; any
  standardization hazards besides Fiesta?
- Is any emit English? Is any new string player-visible?

## End of session

Biome the touched files; run the acceptance list; update
`docs/achievements/progress.md` (row 1 DONE with date); commit with explicit
paths, scope `feat(deeds):` (subject describes the system, e.g. "add deed
catalog, evaluator, and persisted lifetime stats"; body explains the golden
regeneration; no packet vocabulary); push to origin only. End your final
response by naming the next file:
`docs/achievements/phase-01-qa.md`.
