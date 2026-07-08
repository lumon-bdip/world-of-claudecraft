# 03 QA: the Book of Deeds window

STATUS: NOT STARTED

Dedicated QA session for the window slice. Run only after
`phase-03-deeds-window.md` reports DONE in `progress.md`. Read that file and
`docs/achievements/overview.md` first, then the ACTUAL diff (`git log` /
`git diff` against the previous slice's last commit); QA verifies the code
that landed, not the spec's intentions.

## 1. What shipped (fill in first)

List the commits and touched files. Confirm scope: if the diff touched
`src/sim/` or `src/world_api/` beyond imports, that is a scope breach to
investigate immediately (the window slice was forbidden from patching the
seam; a "small facet fix" hiding here is exactly what this gate exists to
catch).

## 2. Re-run acceptance (all, fresh)

- `npx vitest run tests/deeds_view.test.ts`
- `npx vitest run tests/architecture.test.ts`
- `npx vitest run tests/hud_perf_budget.test.ts`
- `npx vitest run tests/localization_fixes.test.ts`
- `npx vitest run tests/css_corpus.test.ts` plus the component test for each
  CSS file the diff touched
- `npm run gate` (unpiped)

A red here ends the QA session: file the failure, return to the implement
session, re-run this QA from the top afterward.

## 3. Visual verification (real browser, real inputs)

`npm run dev`, offline quick-start. Drive the REAL bound key and real clicks;
never window hooks (a hook proves event-to-window only, not reachability).

Walk POPULATED states, not just the empty shell (the walkthrough lesson from
the bank reviews):

1. Fresh character: summary shows 0 Renown honestly; categories render with
   zero counts; empty-state copy is localized; no hidden deed leaks in any
   category or via search.
2. Progressed character: play until at least one counter deed shows a partial
   bar and one deed unlocks. Verify banner text, gold log line, sound,
   fireworks, and that the window (if open) refreshes the earned card without
   a reopen.
3. Title equipped: earn the cheapest title deed naturally, equip it in the
   Titles section, confirm nameplate subtitle, inspect line, character panel
   line, and that No Title reverts all three.
4. Watchlist: pin 5 entries, confirm the 6th is a disabled control with the
   cap note (not a silent no-op); tracker lines show progress; earning a
   watched deed drops it from the tracker without a reload; collapse state
   survives a reload.
5. Retro path: on a character with prior history (or by replaying the join
   flow), confirm retro unlocks produce exactly ONE summary log line, zero
   banners, zero audio, zero fireworks.
6. Language switch while open: pick any non-English locale (English-filled is
   fine); confirm a full rebuild with no mixed stale text, then switch back.
7. Esc closes through the shared dispatcher; focus returns to the opener; Tab
   stays trapped while open (chrome contract floor).
8. Keybind: KeyZ toggles; the Options rebind list shows the new action; a
   rebind to another key works and persists.

Screenshot the summary header, an entry card with progress, the Titles
section, and the tracker; if a PR is open, post via the gist flow.

## 4. Decisive-assertion audit

Dispatch `test-coverage-auditor` (fresh) with this focus list, then apply
every finding:

- No constant-self-comparison pins (a crest id asserted against the exported
  resolver's own output proves nothing; pin literals).
- Hidden masking asserted through ALL three surfaces: category list, totals
  denominator, search results.
- Feat exclusion asserted in totals AND nearest.
- Watch cap: both arms (5th succeeds, 6th refuses with `full`).
- Retro batching: one line for N events AND for N=1; zero banner calls
  asserted, not just line count.
- Progress clamp: current > target renders full, never overflow.
- Unknown trigger kind: binary fallback asserted with a synthetic def.
- Sim-shaped vs ClientWorld-shaped stubs produce identical models.

## 5. Contract re-checks

- Perf: `tests/hud_perf_budget.test.ts` baseline UNTOUCHED by the diff (git
  shows no edit to `tests/hud_perf_budget.baseline.md`); the tracker painter
  routes every DOM write through `PainterHostWriters` (source scan by hand if
  the standing test does not cover the new file; if it does not, add it to
  the scan, that is a should-fix).
- Fairness: grep the diff for `governor` and `data-fx-level` usage; the
  window and tracker must read neither, and no information content varies by
  tier. Confirm the fireworks arm draws nothing for retro events.
- i18n: every player-visible string in the diff resolves through `t()`,
  `deed_i18n`, or an existing matcher; regenerated i18n artifacts are IN the
  same commits as the keys (freshness gate needs staged artifacts); no locale
  overlay file was edited.
- Security/hygiene: every interpolated name goes through `esc()`; no raw hex
  or px literals in the painters; no new dependency.

## 6. Adversarial what-is-missing pass

Answer explicitly, with evidence, in the session output:

- Earned id absent from `DEEDS`: skipped gracefully? Tested?
- Does anything break on `/play` (the second entry)? Load it in dev and open
  the window there; the missing-root trap is exactly this gate's history.
- Window open during a zone transfer or death/ghost state: any crash or
  stale-model paint?
- Is `deed_i18n.ts` reachable from the wiki or server bundles where it must
  not be (import direction check)?
- Any per-frame path introduced that the budget test does not see (a
  requestAnimationFrame or setInterval hiding in the painter)?
- Could two rapid `setActiveTitle` clicks race the round trip into a stale
  paint? (Facet-driven paint should make this a non-issue; verify.)

## 7. Exit

- All findings applied (blocking, should-fix, AND nits) and re-verified.
- `npm run gate` green at the final commit.
- Update `docs/achievements/progress.md` (row 3Q DONE with date, plus notes
  worth carrying forward).
- Name the next file: `docs/achievements/phase-04-server-persistence.md`.
