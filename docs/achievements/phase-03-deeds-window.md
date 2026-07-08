# 03: The Book of Deeds window (desktop UI, tracker, earned moment)

STATUS: NOT STARTED

Read `docs/achievements/overview.md` FIRST; it is authoritative and its sections
2 (glossary), 3 (canonical identifiers), and 5 (binding rules) apply verbatim
here. The `deeds` keybind is `KeyZ` per the overview (free across
`BIND_ACTIONS` and the action-bar `SLOT_DEFAULTS` at packet authoring); if
`KeyZ` has been claimed since, pick the nearest free letter and note it in the
session output.

## Goal

Ship the desktop Book of Deeds: a beautiful, cold, event-driven window where a
player browses the deed catalog, tracks progress, equips a title, and pins a
watchlist; plus the celebration path when a deed unlocks (banner, sound,
fireworks) and the quiet path when retro credit arrives. Everything renders
from `IWorldDeeds` (landed in the previous slice) and the static `DEEDS`
catalog; nothing here talks to a concrete world.

By the end of this session a player on the offline quick-start can press KeyZ,
browse every visible deed with live progress bars, earn one, see the banner and
fireworks, equip its title, and watch the title appear on their nameplate.

## Context to load before writing code

- `docs/achievements/overview.md` (authoritative design)
- `src/ui/CLAUDE.md` in full: the window recipe, the per-frame performance
  contract, the HUD-chrome WCAG contract, the i18n contributor workflow, and
  the icons.ts recipe guide
- `src/styles/CLAUDE.md` (layer order, tokens, per-entry CSS wiring)
- The template pair: `src/ui/bank_view.ts` + `src/ui/bank_window.ts` (cold
  window conventions: grace handling, filter persistence, prompt hygiene,
  chrome-key reuse) and `src/ui/bag_filter.ts` / `src/ui/bank_filter.ts`
- `src/ui/painter_host.ts` (PainterHostPresentation, PainterHostWriters)
- `src/ui/quest_tracker.ts` (pure tracker core family) and the `#quest-tracker`
  wiring in `src/ui/hud.ts` (click/keydown delegation, `questTrackerCollapsed`)
- `src/ui/quest_progress_banner.ts` (stacked transient lines pattern)
- `src/ui/talent_i18n.ts` and `src/ui/entity_i18n.ts` (the entity-style
  localization pattern `deed_i18n.ts` follows)
- `src/ui/i18n.catalog/hud_chrome.ts` (find the `bank:` and `dailyRewards:`
  sections; `deeds:` lands as a sibling)
- `src/ui/icons.ts`: `CREST_RECIPES`, the `r(bg, pal, prims, fx?)` helper,
  `PALETTES` / `BACKGROUNDS` / `PRIMITIVES`, `iconDataUrl(kind, id, size)`
- `src/game/keybinds.ts` (`BIND_ACTIONS`) and the `onUiKey` dispatch switch in
  `src/main.ts`
- `src/render/vfx.ts` (`fireworkBurst`, `levelUpPillar`) and the sim-event
  switch in `src/render/renderer.ts` (the `case 'levelup'` arm is the model)
- `src/render/nameplate_painter.ts` (title subtitle lands here)
- `src/ui/hud.ts` regions: the window-construction field cluster (search for
  `new MailboxWindow(` / `new BankWindow(`), `handleEvents` (search
  `case 'milestoneUnlocked'`), the slow-band refresh block (search
  `bankWindow.isOpen) this.bankWindow.refreshIfChanged`), `openInspect`, and
  the character panel milestone-badge builder (search `cp-milestones`)
- `tests/architecture.test.ts` (`UI_PURE_CORES` + the completeness sweep)
- `tests/hud_perf_budget.test.ts` and `tests/hud_perf_budget.baseline.md`
- `index.html` AND `play.html`: window root divs (search `bank-window`; the
  deeds root must land in BOTH entries, the /play wiring trap is real)

## Design spec

### Module layout (all new files unless marked)

| File | Role |
|---|---|
| `src/ui/deeds_view.ts` | Pure core (UI_PURE_CORES). Builds the whole window model and the tracker model. DOM/Three/i18n-free. |
| `src/ui/deeds_window.ts` | Cold painter owning `#deeds-window`. Bank conventions throughout. |
| `src/ui/deed_i18n.ts` | English name/desc/title resolution for deed ids (talent_i18n pattern; translations arrive at project end). |
| `src/ui/deed_tracker_painter.ts` | Small slow-band painter for the watchlist HUD section `#deed-tracker`. |
| `src/ui/hud.ts` (edit) | Window construction, open/close/toggle, handleEvents arms, slow-band refresh, char panel active-title line. |
| `src/ui/icons.ts` (edit) | Category base crests + bespoke marquee crests. |
| `src/ui/i18n.catalog/hud_chrome.ts` (edit) | `deeds:` chrome section. |
| `src/game/keybinds.ts` + `src/main.ts` (edit) | `deeds` action on `KeyZ`, dispatch to `hud.toggleDeeds()`. |
| `src/render/renderer.ts` + `src/render/nameplate_painter.ts` (edit) | Unlock fireworks; nameplate title subtitle. |
| `index.html` + `play.html` (edit) | `<div id="deeds-window" class="window panel"></div>` in both. |
| `src/styles/components.css` (edit) | Window body styles, tokens only. |

### The view core (`deeds_view.ts`)

Model builder `buildDeedsView(input): DeedsViewModel` where `input` carries the
facet reads (`deedsEarned`, `deedStats`, `renown`, `activeTitle`), the static
catalog (`DEEDS`, `DEED_ORDER` imported from `../sim/content/deeds` and
`../sim/data` re-exports; importing sim data into ui is the bank precedent),
the filter state, the search string (pre-lowercased by the painter with locale
rules, bank_filter precedent), and the watch set. Instance-parameterized: no
element ids, no singletons.

- `DeedsViewModel`:
  - `summary`: renown total, earned count, visible total (hidden unearned and
    all feats EXCLUDED from the denominator), completion fraction, recent
    unlocks (last 5 by earned day, newest first), nearest (top 3 unearned
    counter-trigger deeds by progress fraction, feats excluded).
  - `categories`: fixed order derived from the id prefix table in the overview
    (Progression, Combat, Dungeons, Delves, Chronicles, Collection, PvP and
    Sport, Social, Exploration, Feats), each with earned/visible counts.
  - `entries`: for the selected category and filter (`all` / `earned` /
    `unearned` / `nearly`, where nearly means progress >= 0.5), each entry:
    deed id, earned flag, earned day (or null), renown, progress
    (`{ current, target } | null`), watchable flag, watched flag, feat flag,
    title-reward flag, crest icon id (resolution below).
  - `titles`: the picker model: every EARNED deed whose reward is a title,
    plus the none option, with the active one marked.
  - Hidden masking: a `hidden` deed contributes NOTHING (no entry, no counts,
    no search hits) until earned; once earned it appears in its home category
    with an earned-only badge. Feats always render, marked, and never count
    toward completion or appear in `nearest`.
- Progress: a counter trigger reads `deedStats` for `{ current, target }`
  (clamped, never over target). A predicate or meta trigger the client cannot
  cheaply evaluate renders progress `null` (binary earned/unearned). The core
  must tolerate unknown trigger kinds (forward compat) by treating them as
  binary.
- Watchlist logic in the core: `toggleWatch(set, id)` enforcing the cap of 5
  (returns the unchanged set plus a `full` flag when at cap), and
  `buildDeedTrackerView(...)`: watched, unearned deeds with name id + progress,
  earned ones auto-dropped.
- Crest icon resolution (pure): bespoke `deed_<id>` when the id is in the
  bespoke set, else `deed_cat_<category>`, exported so the painter and any
  future consumer agree.
- Allocation discipline: this is a COLD window, so per-call allocation is fine
  in the window model; the TRACKER view is the one slow-band path, keep it
  allocation-light (reused container, the quest_tracker shape).

### The painter (`deeds_window.ts`)

Cold, event-driven, the bank/mailbox shape exactly: innerHTML rebuild on open,
on a real data change (diff a compact refresh key: renown + earned count +
active title + filter + search + category + watch revision), and on language
switch; scroll offset of the entry list preserved across rebuilds; nothing runs
in the per-frame hot path. Compose `PainterHostPresentation` in its deps and
keep window-specific members on top (root, world, closeOthers, windowFocus
capture/return, hideTooltip, onWatchChanged). All interpolated names route
through `esc()`; colors and metrics come from tokens, never literals in TS.

Layout (desktop):

```
+--------------------------------------------------------------+
| Book of Deeds                                    [Search] [x] |
|  Renown 615        123 / 178 deeds        [=====----] 69%     |
|  Recent: [crest] [crest] [crest] [crest] [crest]              |
+-------------+------------------------------------------------+
| Progression |  [crest] First Steps                 5 Renown   |
| Combat      |          Reach level 5.                         |
| Dungeons    |          [############------------] 3/10        |
| Delves      |          earned 2026-07-08          [Watch]     |
| Chronicles  |  ...entry cards...                              |
| Collection  |                                                 |
| PvP & Sport |                                                 |
| Social      |                                                 |
| Exploration |                                                 |
| Feats       |                                                 |
| Titles      |  (picker: earned titles + No Title)             |
+-------------+------------------------------------------------+
| Filter: All | Earned | Unearned | Nearly done                 |
+--------------------------------------------------------------+
```

- Entry card: crest `<img>` (via `iconDataUrl('crest', crestId, size)`), name,
  desc, Renown chip, progress bar (a width-styled div rendered at build time;
  no per-frame writes), earned date line (derive a UTC date from the earned
  utcDay and format with `formatDateTime`, date-only options), rarity line
  RESERVED: render only when a rarity value is present on the facet surface
  (the data source lands in a later slice; absent means omit the node
  entirely, no placeholder text).
  - Unearned card: desaturated crest (CSS filter via class, not inline style).
  - Feat card: a Feats ribbon, no Renown chip (they are zero Renown).
- Titles section: radio-style list; selecting calls
  `world.setActiveTitle(deedId | null)`; paint state straight from the facet
  on the next refresh (no optimistic local copy; the round trip is a tick).
- Watch button per unearned entry; at cap the button renders disabled with a
  full note (chrome key), never a silent no-op.
- Keyboard/a11y floor for this slice: `windowFocus` trap + focus return, Esc
  through the shared closeAll dispatcher, aria-labels from `t()`, search input
  16px+ font. The deep audit and mobile layout are the final slice's job.
- Open/close: `Hud.openDeeds()/closeDeeds()/toggleDeeds()` orchestrates
  (closeOthers, capture/restore focus); the slow band gets
  `if (slowHud && this.deedsWindow.isOpen) this.deedsWindow.refreshIfChanged();`
  next to the bank line.

### Watchlist HUD tracker (`deed_tracker_painter.ts`)

A `#deed-tracker` container in both entry HTMLs directly below
`#quest-tracker`, aria-hidden decoration (the chat log carries durable copies
of unlock lines; the tracker is glanceable chrome). Painted on the slow band
through `PainterHostWriters` ONLY (this is a hot-adjacent path: elided
setText/setWidth per line, keyed line pool capped at 5, no innerHTML per
refresh). Collapsible mirroring the `questTrackerCollapsed` settings
convention under its own key. Persistence: watched ids in localStorage under
`woc_deed_watch` (follow the bank filter key style); scope it per character
the way existing per-character UI prefs do it if such a convention exists in
`src/game/settings.ts`, else global with the character name folded into the
key. Earned deeds drop off the list automatically (core rule).

### The earned moment

The sim no longer emits `milestoneUnlocked` (the sim-core slice removed the
emit). In `Hud.handleEvents`, DELETE the dead `case 'milestoneUnlocked'` arm
and the vestigial `SimEvent` union member (a types-only `src/sim/types.ts`
edit, explicitly sanctioned here), and add the new arm where the old case
lived:

- `case 'deedUnlocked'` with `retro` falsy: `showBanner` with
  `t('hudChrome.deeds.unlockedBanner')` + the localized deed name, a gold log
  line, `audio.levelUp()`, and bump the window refresh key. If the deed
  rewards a title, append a second log line hinting the Titles section
  (chrome key).
- `retro: true`: NO banner, NO audio. Accumulate a counter across the current
  event drain and after the loop emit ONE summary log line, chrome key shaped
  like: "Your chronicle catches up: {n} deeds recorded." Localized count via
  `formatNumber`.
- Renderer: in the sim-event switch of `src/render/renderer.ts`, add a
  `deedUnlocked` arm: non-retro and `ev.pid` is the local player, fire
  `this.vfx.fireworkBurst(...)` at the player position with the gold/white
  celebratory palette already used by existing bursts (reuse an existing
  exported color set or the levelUp pillar colors; add no new raw palette in
  the renderer if one exists to share). Retro events draw nothing.

### Titles on nameplates, inspect, character panel

- `src/render/nameplate_painter.ts`: player nameplates render the entity's
  `title` wire field (a deed id; empty means none) as a subtitle line under
  the name, resolved through `deed_i18n.deedTitleText(id)`, cached per
  nameplate by (entity id, title id) so no per-frame string work. Honors the
  existing nameplate tier/interval knobs untouched.
- Inspect window (`openInspect`) and the character panel milestone-badge
  region: show the active title line; the char panel line links (button) to
  `openDeeds()`.
- Borders: earned border rewards render in v1 on the character panel and the
  inspect badge row through the existing milestone-badge plumbing (the
  `ms-badge` style family). Nameplate BORDER display is deferred by design (a
  deliberate v1 cut, stated here so no session "fixes" it); titles are the
  nameplate surface.
- Chronicler NPCs: this slice owns the CLIENT interact arm for the three
  chronicler templateIds (`chronicler_saul`, `chronicler_osric_fenn`,
  `chronicler_edda_hartwell`): interacting opens the Book of Deeds at that
  zone's Chronicles section (the banker-opens-bank pattern in the hud
  interaction handler). The sim-side visit/talk marks landed with the sim-core
  slice.

### deed_i18n.ts

The talent_i18n shape scoped to deeds: exports `deedName(id)`, `deedDesc(id)`,
`deedTitleText(id)` (the title string for a title-reward deed). English source
is the `DEEDS` table itself (`name`/`desc` on `DeedDef`; title text on its
`reward`); the module
adds the translation-kind plumbing and a newlocales hook table so the
end-of-project fill lands without touching call sites. English-only now; never
edit locale overlays; no `t()` on dynamic ids.

### Chrome strings

New section `deeds:` in `src/ui/i18n.catalog/hud_chrome.ts` (English-only
domain; an English-only add compiles): window title, search placeholder and
aria, filter labels, category labels, column/summary labels, watch/unwatch
labels + cap-full note, titles-section labels + none option, unlocked banner
prefix, retro summary line, title-hint line, earned-date label, feat ribbon,
tracker header. Reuse existing generic keys where the bags/bank precedent
applies (the bank reused `hudChrome.bags.filter*`); add deeds-specific aria
where wording names the window.

### Fairness note (binding)

Everything this slice renders is player-chosen cosmetic information: own
deeds, own progress, own title, other players' titles. It must never surface
combat-actionable data (enemy state, positions, cooldowns), and none of it may
vary with the graphics tier in a way that changes information content: a tier
may soften the fireworks, never the banner or log line. The tracker reads
static preset knobs only if it sheds anything, never the governor.

## Out of scope (owned elsewhere in the packet)

- Mobile layout, touch pairing, and the full a11y audit (final slice).
- Rarity data source, guild broadcast toasts, public sheet (server slice).
- Leaderboard window changes (leaderboard slice).
- Any sim/facet change: if the facet surface is missing something this window
  needs, STOP and flag it; do not patch `src/sim/` or `src/world_api/` here.
  (One sanctioned exception: deleting the vestigial `milestoneUnlocked`
  `SimEvent` union member, a types-only edit per the earned-moment spec.)
- Steam anything.

## Steps

1. Window roots + CSS shell: add `#deeds-window` and `#deed-tracker` to BOTH
   `index.html` and `play.html`; body styles in `src/styles/components.css`
   under the components layer with tokens (follow the bank window section
   banner conventions; the CSS corpus test cares about banners).
2. `deed_i18n.ts`, then `deeds_view.ts` with `tests/deeds_view.test.ts`
   written alongside: same-input-same-output against BOTH a Sim-shaped and a
   ClientWorld-shaped stub (bank_view test precedent), covering: hidden
   masking in and out of search, feat exclusion from totals and nearest,
   progress clamping, unknown trigger kind tolerated as binary, watch cap 5
   with full flag, tracker view drops earned, crest resolution order, recent
   ordering, filter arms, empty states (fresh character; everything earned).
3. Register `src/ui/deeds_view.ts` in `UI_PURE_CORES` in
   `tests/architecture.test.ts` (the completeness sweep fails without it).
4. `deeds_window.ts` painter + `Hud` wiring (construction cluster, open/close/
   toggle, slow-band refresh line, closeOtherWindows registration, Esc
   integration) + `handleEvents` arms + retro batch.
5. `deed_tracker_painter.ts` + hud slow-band call + collapse setting +
   localStorage persistence.
6. Keybind: `deeds` action (`KeyZ`, Interface, edge) in `BIND_ACTIONS`; the
   `onUiKey` case in `src/main.ts`; verify the rebind UI picks it up for free
   (it iterates `BIND_ACTIONS`).
7. Icons: `deed_cat_<category>` base crests (10) + bespoke `deed_<id>` crests
   for a roughly 20-deed HIGHLIGHT SUBSET of the Steam marquee list in
   `docs/achievements/catalog/` (every other deed uses its category base crest
   plus the deterministic fallback); new PRIMITIVES only if an existing motif
   cannot express a badge; verify unknown deed ids fall back and never break.
8. Renderer fireworks arm + nameplate title subtitle + inspect/char-panel
   title and border lines + the chronicler interact arm opening the window.
9. i18n: chrome keys, `npm run i18n:scan` + `npm run i18n:build` (+
   `npm run i18n:hash -- --write` if the resolved table changed), regenerated
   artifacts committed in the SAME commit; confirm the S3 guard is untouched
   (no new sim/server emits here).
10. Self-review pass, then reviewers (below), then the gate.

## Acceptance (all must pass, run from the worktree root)

- `npx vitest run tests/deeds_view.test.ts` (new, decisive: every claim above
  has an assertion that fails on regression)
- `npx vitest run tests/architecture.test.ts` (core registered, purity scans
  green, no DOM/nondeterminism in the core, ui_tier_knobs row untouched)
- `npx vitest run tests/hud_perf_budget.test.ts` (budget UNCHANGED: the
  tracker painter goes through the writer facet; the cold window adds zero
  hot writes; do not touch the committed baseline)
- `npx vitest run tests/localization_fixes.test.ts` (S3 green)
- `npx vitest run tests/css_corpus.test.ts` and the component test file for
  any CSS file touched (the PR CI lesson: CSS edits need the component test)
- `npm run gate` (unpiped, exit-code honest)
- Manual (offline, `npm run dev`): quick-start a character; press the REAL
  KeyZ (not a window.__game hook); browse categories; earn a low deed (kill a
  mob for a counter, or level to 2); observe banner + sound + fireworks + log;
  pin a watchlist entry and watch the tracker; equip a title after earning a
  title deed (dev: pick the lowest title deed reachable, or temporarily earn
  via natural play only, no state editing); confirm the nameplate subtitle.

## Reviewer dispatch (fresh agents, never the implementer)

- `qa-checklist` over the full diff (it will pull in the ui/styles CLAUDE.md
  contracts and the fairness invariant).
- `test-coverage-auditor` focused on `tests/deeds_view.test.ts` and the
  handleEvents arms: hunt constant-self-comparison pins, assert the retro
  batch has a negative case (a lone retro event still produces exactly one
  line and zero banners), the cap-5 boundary has both arms, and hidden
  masking is asserted through search too.
- Apply EVERY finding: blocking, should-fix, and nits.

## Adversarial pass (answer each in the session output)

- What happens when `deedsEarned` references an id absent from `DEEDS`
  (content removed or renamed)? The core must tolerate and skip, tested.
- Language switch while the window is open: full rebuild, no stale English?
- A deed unlocks while its category is filtered out: refresh key must still
  change (earned count moved).
- Two unlocks in one tick: two banners queue or coalesce? Pick one, assert it.
- The offline quick-start (ephemeral character): watchlist localStorage key
  collides across offline sessions? Acceptable, but state it.
- Does anything here import a concrete world, read the governor, or write DOM
  outside the writers on a slow-band path? (Must be no; the scans check most
  of it, verify the rest by hand.)
- Is any player-facing string missing its `t()` key or hardcoded English in a
  painter?

## End of session

- Biome on touched files only; `npm run gate` green; commit in Conventional
  Commits (scopes `ui`, `render`, `game` as touched; suggested lead commit
  `feat(ui): add the Book of Deeds window`), staging EXPLICIT paths.
- No "phase"/packet words in any shipped artifact.
- Update `docs/achievements/progress.md` (row 3 DONE with date).
- Name the next file: `docs/achievements/phase-03-qa.md`.
