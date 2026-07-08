# 08: Mobile, accessibility, verification passes, and feature closeout

STATUS: NOT STARTED

Read `docs/achievements/overview.md` first; it is authoritative (sections 3 to 5
pin every canonical name and rule). This is the LAST implement session of the
packet: everything from sessions 01 to 07 is landed and green. This session makes
the Book of Deeds excellent on phones, closes the accessibility contract, runs
the three verification passes (fairness, perf floor, catalog balance), and
prepares the feature for the maintainer's PR. The packet directory itself is
deleted at the END of phase-08-qa.md, not here, so the QA session still has its
spec on disk.

Reminder that binds every step: the word "phase", packet references, em dashes,
en dashes, and emojis never appear in any shipped artifact (code, comments,
commit messages, PR text). English-only i18n via the pending mechanism.

## Goal

1. The Book of Deeds window, watchlist tracker, and earned banner work
   beautifully on touch phones (landscape, per the in-game orientation rule)
   and meet the HUD-chrome WCAG 2.2 AA contract.
2. Three verification passes hold with concrete oracles: gameplay-neutral
   fairness, the per-frame perf floor, and catalog balance.
3. The feature is PR-ready: full gate green, online smoke walked through,
   screenshots captured, PR title/body drafted.

## Context to load first

Read before writing any code:

- `docs/achievements/overview.md` (authoritative decisions and names)
- `src/ui/CLAUDE.md` (UI/UX + mobile + a11y standards; the HUD-chrome WCAG 2.2
  AA contract; the per-frame performance contract; the authoring recipe)
- `src/styles/CLAUDE.md` (layer order, tokens, the guards on CSS structure)
- `src/styles/hud.mobile.css`, the bank cluster region (search the banner
  comments around `body.mobile-touch #bank-window`): the standalone full-screen
  window template, the 50/50 pairing neutralizer, the chip-row nowrap scroll
  pattern, and the short-landscape `@media (max-height: 480px)` compensation
- `src/ui/touch_peek.ts` (long-press tooltip peek guard; the bank consumes it
  via a `consumePeek` dep)
- `src/game/mobile_controls.ts` (the More tray: `bindButton('mobile-<name>',
  () => this.callbacks.on<Name>())`; this is the pattern for opening the window
  on touch)
- `tests/hud_perf_budget.test.ts` (the three-arm budget; note the ARM 1
  completeness pairing: every NEW `src/ui` painter must be classified as
  facet-routed-scanned or canvas-excluded, it cannot silently escape)
- `tests/css_corpus.test.ts` (ten-dash section banners; the pinned manifest; a
  four-dash fence is NOT a section boundary), `tests/styles_extraction.test.ts`,
  `tests/css_value_validity.test.ts`, `tests/per_entry_css_wiring.test.ts`
- `docs/design/graphics-settings-fairness.md` (the actionable-vs-cosmetic test)
- The deeds modules landed by earlier sessions: `src/ui/deeds_view.ts`,
  `src/ui/deeds_window.ts`, the watchlist tracker painter, `src/ui/deed_i18n.ts`,
  and `src/sim/content/deeds.ts`

## Design spec

### 1. Mobile layout

The window follows the bank's STANDALONE mobile convention (not the 50/50
pairing; the Book of Deeds has no companion panel): on `body.mobile-touch`,
`#deeds-window` becomes a fixed full-screen panel inside the safe-area insets,
`transform: none`, `max-width: none`, `overflow: hidden`, with the card list as
the internal scroll container (the bank's `.bank-scroll` idiom). Landscape
sketch (the in-game web experience is landscape-only; portrait shows the
rotate gate):

```
+----------------------------------------------------------------+
| Book of Deeds                          1,240 Renown        [X] |
| [All] [Progress] [Combat] [Dungeons] [Chronicles] [Collec >    |
| [ search field                        ] [Earned v]             |
| +------------------------------------------------------------+ |
| | (crest) Deed Name             25 Renown   [=====   ] 3 / 5 | |
| | (crest) Earned Deed            5 Renown   earned, title    | |
| |  ...vertical scroll...                                     | |
| +------------------------------------------------------------+ |
+----------------------------------------------------------------+
```

- Category navigation collapses from the desktop sidebar to ONE horizontally
  scrollable chip row (the bank chip idiom verbatim: `flex-wrap: nowrap;
  overflow-x: auto; overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch`, chips `flex: 0 0 auto`). Nothing hidden:
  every chip reachable by scroll at full tap height (>= 40x40).
- Short landscape phones (`@media (max-height: 480px)`): keep the search/filter
  toolbar and the summary header from eating the list; the card list yields to
  a minimum of roughly one visible card and scrolls, mirroring the bank's
  grid-floor compensation. Verify with the toolbar present AND absent; the
  bank's clipped buy row was missed exactly because empty states drop the
  toolbar (see the comment in `hud.mobile.css`).
- Long-press on a deed card shows its tooltip via the existing peek machinery;
  the release click must not activate the card's action (title equip, watch
  toggle). Consume the `TouchPeekGuard` the same way the bank window does.
- Opening on touch: add a `mobile-deeds` button to the More tray following the
  existing pattern (`bindButton('mobile-deeds', () => this.callbacks.onDeeds())`
  in `src/game/mobile_controls.ts`, a new `onDeeds` callback, wired in
  `src/main.ts` to the Hud toggle). The button element must exist in BOTH
  `index.html` and `play.html` (the play.html shared-entry trap: an
  index-only element makes the shared bundle throw on /play; guard lookups
  with optional chaining regardless).
- Watchlist tracker on phones: compact rows in the quest-tracker area, capped
  so it never overlaps `#mobile-controls` (joysticks, action buttons) at 360px
  viewport height; if space is insufficient, the tracker collapses to a count
  chip that opens the window. Test at the smallest supported landscape height.
- Earned banner and the retro summary line must be legible at phone sizes and
  never cover the More tray or chat; reuse the existing banner slot and type
  scale, no new banner geometry.
- New CSS lands in the correct layers: window-body rules in `components.css`
  (or the existing deeds section from session 03), mobile overrides in
  `hud.mobile.css` (the `hud-mobile` layer wins the cascade). Every new section
  gets a ten-dash banner and its name added to the pinned manifest in
  `tests/css_corpus.test.ts`. Tokens only; no literal hex/px in TS.

### 2. Accessibility checklist (HUD-chrome WCAG 2.2 AA contract)

- Focus: opening the window traps Tab/Shift+Tab via the shared `FocusManager`
  (`Hud.windowFocus('#deeds-window')` idiom) and returns focus to the opener on
  close; Esc stays with the `closeAll` dispatcher. Match the bank's
  non-trapping-capture choice ONLY if the window is non-modal like the bank;
  the Book of Deeds is a standard modal window, so use the standard trap.
- Every control has an accessible name from a `t()` key: chips (buttons with
  `aria-pressed`, or a tablist if the existing windows use one; follow the
  dominant existing idiom), search input, filter select, watch toggles, title
  equip buttons, close button.
- The search input is >= 16px font on touch (the `base.css` coarse-pointer
  floor already enforces this; do not override it downward).
- Progress bars carry text equivalents ("3 of 5" as visible text or
  `aria-label`); rarity and Renown are plain text, not color-only.
- `:focus-visible` ring on every interactive element, token-drawn, never
  transitioned away; no `transform: scale()` on hover/focus of cards or chips.
- `prefers-reduced-motion`: the earned banner and any card cross-fades drop
  their motion; verify the retro summary respects it too.
- The earned announcement is perceivable to screen readers: match the existing
  banner semantics; if banners are visual-only today, route the earned line
  through the existing off-screen `#combat-live` status region (throttled per
  type, per the live-region conventions) rather than inventing a new region.
- Keyboard desktop pass: open with the bound key, reach every chip/card/
  control with Tab, equip a title and pin a watch entry keyboard-only.

### 3. Verification passes (concrete oracles)

Fairness (gameplay-neutral graphics):
- Structural oracle: the deeds window, tracker painter, and banner path import
  IWorld deed data and chrome only; grep the deeds modules for `governor` (must
  be zero matches) and for any read of party/target/enemy state (must be zero;
  deed progress is the only dynamic input).
- If session 03 added any tier shedding for deed toasts, it must read the
  static preset via `src/game/ui_effects_profile.ts`; run
  `npx vitest run tests/ui_effects_profile.test.ts tests/ui_tier_knobs.test.ts
  tests/architecture.test.ts` and confirm the ui_tier_knobs purity row still
  passes. Deed UI is cosmetic by construction, so a tier MAY shed it; what a
  tier must never do is shed differently per player in a way that surfaces or
  hides actionable combat information (it cannot, given the structural oracle
  holds).
- Confirm the watchlist cap and tracker never display information about OTHER
  players or enemies (progress text and deed names only).

Perf floor:
- The window stays a COLD window: no per-frame work; rebuilds only on
  open/data-change/language-switch (the bank contract). Confirm no deeds code
  is reachable from `Hud.update()` except the tracker painter.
- The tracker painter runs on the slow band, routes every write through the
  elided writers, resolves its element refs once, and is classified in the
  ARM 1 completeness pairing of `tests/hud_perf_budget.test.ts` (the scan
  fails an unclassified painter; classify it as facet-routed-scanned).
- `npx vitest run tests/hud_perf_budget.test.ts` green with NO baseline edits.
  If the budget reds, the fix is in the painter, never the baseline.

Catalog balance (operates on `src/sim/content/deeds.ts`, the shipped source of
truth; the catalog docs are packet material):
- Recompute per-category Renown subtotals and counts; compare against the
  packet budget: progression/combat ~35 deeds, dungeons/delves ~40, chronicles
  9 chapters plus their tasks, collection ~25, pvp ~25, social/economy/
  exploration ~25, feats+hidden ~20; Renown values only 0/5/10/25/50; zero
  Renown on every luck-based deed, every dynamic meta, and every feat.
- Title registry: 15 to 20 total, no duplicate title strings. The five
  milestone deeds keep their ORIGINAL reward kinds per the `MILESTONES` table
  in `src/sim/types.ts`: veteran, champion, and eternal are titles; paragon
  and mythic are BORDERS. Do not demand five title strings from them. Border
  registry: about 6, no duplicates.
- Steam map (`server/steam/achievement_map.ts`): under 100 entries, every
  mapped deed exists, no hidden-criteria leak in any mapped name/desc (Steam
  text is public), API names match `ACH_<UPPER_SNAKE>`.
- Threshold sanity: every counter deed's threshold sits where natural play
  lands (a level-cap character's plausible lifetime numbers); cut any
  telemetry-free guess that looks like a tedium wall (the 9999-to-500
  lesson). Corrections are VALUE and WORDING tweaks only: never remove or
  reorder ids in `DEED_ORDER` (append-only determinism contract; earned
  records reference ids). If a deed must go, escalate to the maintainer
  instead of deleting.
- Write the balance report (a short table: category, count, Renown subtotal,
  changes made) into the session summary, not into the repo.
- i18n consequences of corrections: name/desc edits update
  `src/ui/deed_i18n.ts` in the same change; if any catalog-backed key changed
  (guide keys), re-run `npm run wiki:content` and the i18n scan/build with the
  sha256 re-baseline in the SAME commit.

### 4. Closeout

- Full sweep: `npm run gate` (unpiped; run in the background and read the real
  exit code). The branch is a feature branch, so the gate runs PR tier;
  pending i18n rows are EXPECTED and correct (the translation fill happens
  once at project end, outside this packet). Do NOT set `I18N_RELEASE_TIER=1`.
- Online smoke: `npm run server` (rebuild after any branch flip; the bundle is
  esbuilt at START) + `npm run dev`, `ALLOW_DEV_COMMANDS=1` (dev only, never
  production) for level/teleport shortcuts. Drive the REAL bound key and the
  REAL More-tray button, never window hooks. Fresh sessions show the intro
  overlay which hides `#ui`; dismiss it (or seed its localStorage flag) before
  screenshots.
- Screenshots for the PR: puppeteer with a FIXED viewport and `page.screenshot`
  (the viewport-resize innerWidth staleness and the CDP window-surface gotchas
  are real; a fixed viewport avoids both). Capture: desktop window (populated,
  a title equipped), mobile landscape window, the watchlist tracker in-world,
  the earned banner moment, the wiki page, the leaderboard tab. Populated
  states, not empty ones. Host via the gist-push flow and embed raw URLs.
- PR preparation: draft title and body now, plain Conventional style, e.g.
  `feat(deeds): the Book of Deeds achievement system`. Describe the FEATURE
  (what players get, the cosmetic-only stance, the env-gated Steam mirror,
  board integrity), never the process. No packet vocabulary anywhere. The PR
  targets the current `release/**` branch per house practice. Do not open the
  PR yet if the maintainer has not asked for it; leave title/body in the
  session summary.
- Verify nothing OUTSIDE `docs/achievements/` references the packet:
  `rg -n "docs/achievements" src server electron scripts tests package.json`
  returns nothing, and `git log --format=%B <merge-base>..HEAD` contains no
  "phase"/"packet" wording (merge-base = the branch point of
  `feature/achievements`: `git merge-base HEAD` against the release branch it
  was cut from or currently tracks; do not assume a specific version). Fix
  any hit now. The deletion of
  `docs/achievements/` itself happens at the end of phase-08-qa.md so the QA
  session keeps its spec on disk.

## Out of scope

- New features of any kind: no new deeds surfaces, no seasons, no percentile
  bands, no admin views. ONE carved-out exception, owed to the persistence
  slice: the deed-broadcast opt-out toggle in the options window, which reads
  and writes the `accounts.deed_broadcasts` setting through the
  `POST /api/deeds/broadcasts` route that slice created (chrome key under
  `hudChrome.deeds.*`, a11y per the checklist, and an acceptance touch: the
  options test file gains the toggle round-trip).
- Anything Steam beyond the balance audit of `achievement_map.ts`; the
  integration stays dark behind `STEAM_ENABLED`.
- The i18n release fill (project-end work, not packet work).
- Deleting the packet directory (phase-08-qa.md exit step).

## Steps

1. Read the context set above. Inventory what sessions 03 and 07 actually
   shipped (window, tracker, banner, map) so this spec's assumptions are
   verified against the real tree before editing.
2. Mobile: standalone full-screen window CSS + chip row + short-landscape
   compensation; More-tray button + callback + main.ts wiring + BOTH entry
   HTMLs; touch peek consumption; tracker phone sizing/cap.
3. A11y: run the checklist above; fix every miss; extend the focus/live-region
   test suites where a new behavior needs a pin. Add the deed-broadcast
   opt-out toggle to the options window (the carved-out exception above).
4. Fairness pass, perf pass, balance pass, in that order (balance last so its
   catalog edits ride the already-verified UI).
5. CSS guard upkeep: ten-dash banners, pinned manifest additions, component
   test files for touched CSS (a CSS-only edit still needs its component test
   updated when the component contract changed).
6. Closeout: gate, smoke, screenshots, PR draft, packet-reference scan.
7. Biome on touched files; update `docs/achievements/progress.md`; commit in
   small conventional commits (likely `fix(ui)`, `feat(ui)`, `chore(deeds)`
   scopes), explicit paths only.

## Acceptance (all must pass)

```
npx vitest run tests/css_corpus.test.ts tests/styles_extraction.test.ts \
  tests/css_value_validity.test.ts tests/per_entry_css_wiring.test.ts
npx vitest run tests/hud_perf_budget.test.ts
npx vitest run tests/architecture.test.ts tests/ui_effects_profile.test.ts tests/ui_tier_knobs.test.ts
npx vitest run <the deeds suites landed by sessions 01 to 07>
node scripts/mobile_input_zoom_check.mjs        (needs npm run dev running)
npm run gate                                    (unpiped, real exit code)
```

Plus the manual oracles: the phone-landscape walkthrough (open via More tray,
browse, search, equip a title, pin a watch entry, long-press peek without
activation, close and focus returns), the keyboard-only desktop pass, and the
screenshot set captured.

## Reviewer dispatch (fresh agents, never the implementer)

- `qa-checklist` over the full diff of this session.
- `test-coverage-auditor` over the tests this session added or changed.
- Because this is the last implement session, ALSO run the full `/qa` flow over
  the whole feature diff (merge-base to HEAD) and triage every finding: fix
  every blocking, should-fix, AND nit per house rule before handing to QA.

## Adversarial pass (answer each in the session summary)

- What would embarrass us in the PR? Pending-English strings are EXPECTED and
  fine; missing aria on a control, a clipped 360px layout, a tracker covering
  the joystick, or a leaked packet reference is not. Hunt each specifically.
- Does any empty state (no deeds earned, zero watchlist, search with no hits)
  render broken or blank on phone?
- Does the window behave when the catalog grows (500 deeds): does the chip row
  and list virtualize or at least stay usable?
- Is there any path where the tracker paints during a closed-window frame with
  stale data?
- Did the balance pass change any string without its `deed_i18n.ts` and wiki
  regeneration consequences?

## End of session

Biome on touched files; `npm run gate` green (unpiped); update
`docs/achievements/progress.md` (row 8 DONE with date); commits carry no packet
vocabulary. End the session summary with the balance report, the PR draft, and
by naming the next file: `docs/achievements/phase-08-qa.md`.
