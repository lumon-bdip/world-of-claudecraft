# 06: The Book of Deeds on the public wiki

STATUS: NOT STARTED

Packet note: this file is internal working material. Never write the word
"phase" or any packet reference into code, comments, commit messages, or PR
text. If anything here conflicts with `docs/achievements/overview.md`, the
overview wins; flag the conflict in your session output.

## Goal

Give the achievements system its public face: a spoiler-safe wiki page at
`/wiki/deeds` that explains Deeds, Renown, titles and borders, the Chronicles
(and their Chroniclers, starting with Saul), and Feats, and lists the full
non-hidden catalog by category. The deed data is emitted by the wiki content
generator from the sim source of truth so the page can never drift from the
game, and the generator structurally excludes hidden deeds so a future catalog
edit cannot leak a secret.

Preconditions: the sim catalog (`src/sim/content/deeds.ts` with `DEEDS`,
`DEED_ORDER`, and per-deed `hidden` and `feat` flags) landed in session 01, and
its QA passed. The window (03) and leaderboard (05) sessions are also done;
this page only documents them, it reads nothing live.

## Context to load first

Read, in this order:

1. `docs/achievements/overview.md` (authoritative decisions, glossary, naming).
2. `src/guide/CLAUDE.md` (the whole file: layout, generated-data policy,
   spoiler policy, i18n rules, the "keep the wiki in sync" recipe for a
   brand-new content TYPE).
3. `scripts/wiki/build_content.mjs` (the esbuild bundle pattern via
   `entrySource`, the emitted `Guide*` interfaces, and the
   `writeFileSync(outFile, ...)` tail where `GUIDE_*` constants are emitted).
4. `src/guide/routes.ts` (`GUIDE_ROUTES` shape: id, sub, navKey, group,
   descKey) and `src/guide/pages/index.ts` (the page registry).
5. One exemplar page end to end: `src/guide/pages/progression.ts` (structure:
   `GuidePage`, `titleKey`, `render()`, `lead()`, `related()`, everything
   through `t()` + `esc()`).
6. `src/ui/i18n.catalog/guide.ts` (English-only catalog domain, no per-locale
   blocks; note the existing `guide.<x>Page.intro` naming convention).
7. `tests/guide.test.ts` (freshness gate, route/page-registry/sitemap gates,
   and the "Guide bestiary spoiler safety" describe block, which you will
   mirror for deeds).
8. `src/sim/content/deeds.ts` (the real catalog: field names, categories, the
   reward union, `hidden`, `feat`).

## Design spec

### Generator extension (`scripts/wiki/build_content.mjs`)

- Add `export { DEEDS, DEED_ORDER } from './src/sim/content/deeds.ts';` to
  `entrySource` and destructure them from the bundle import.
- Emit a new typed constant following the existing pattern:

  - Interface `GuideDeed`: `id`, `name`, `desc`, `category`, `renown`,
    `feat: boolean`, and reward as OPTIONAL `rewardTitle?: string` (the English
    title text) or `rewardBorder?: true`. No trigger data of any kind is
    emitted: not the trigger object, not its type, not thresholds. The deed's
    player-facing `desc` is the only criteria surface on the wiki.
  - Constant `GUIDE_DEEDS: GuideDeed[]`, built by iterating `DEED_ORDER` and
    FILTERING OUT every def with `hidden` truthy before mapping. The filter
    lives in the generator (structural), not in the page (cosmetic), so hidden
    deeds never reach `content.generated.ts` at all.

- Names and descriptions are baked as English, exactly like the bestiary bakes
  creature names and the zones bake POI labels; the guide's stated convention
  is that proper nouns from the sim stay English. Do NOT import
  `src/ui/deed_i18n.ts` into the guide; that keeps hidden-deed text out of the
  wiki bundle entirely. (If the maintainer later wants localized deed names on
  the wiki, the talent_i18n live-resolution pattern is the upgrade path; out of
  scope now.)
- Update the generator's closing `console.log` summary with the deed count.

### Route + page

- `GUIDE_ROUTES` entry: `id: 'deeds'`, `sub: 'deeds'`,
  `navKey: 'guide.nav.deeds'`, `group: 'compendium'` (place it after
  `vale-cup`), `descKey: 'guide.deedsPage.intro'`. No `topbar`.
- Register the page in `src/guide/pages/index.ts` (the route/page-registry
  test fails if you forget).
- `src/guide/pages/deeds.ts`, modeled on `progression.ts`, rendering entirely
  from `t()` keys plus `GUIDE_DEEDS`:

  1. `<h1>` + `lead('guide.deedsPage.intro')`.
  2. "How deeds work" section: earned per character, shown account-wide,
     criteria always visible in the Book of Deeds in game, a handful of secret
     deeds reveal themselves only when earned (one sentence; do not count or
     name them).
  3. "Renown" section: what the score is, that it only ever goes up, and that
     luck-based deeds and Feats award none.
  4. "Titles and borders" section: rewards are cosmetic only; titles display
     on the nameplate; select them in the Book of Deeds.
  5. "Chronicles" section: per-zone deed sets kept by an in-world Chronicler;
     name Saul of Eastbrook Vale as the first (this is sanctioned flavor, use
     it); chapters completed in any order.
  6. "Feats" section: zero-Renown records of legacy and world-first
     accomplishments, preserved forever.
  7. The catalog listing: one subsection per category (category display order
     and labels from a small `guide.deedsPage.cat.*` key group), each a table
     of Name, Renown, Reward (title text, "Border", or empty), with feats
     rendering a Feat tag instead of a Renown number. Counts per category in
     the heading via `formatNumber`.
  8. A short "Renown standings" note pointing at the in-game leaderboard (no
     live data on the wiki).
  9. `related([...])` links: how-to-play, world, dungeons.

- All copy through `guide.deedsPage.*` and `guide.nav.deeds` English keys in
  `src/ui/i18n.catalog/guide.ts`. Match the file's existing tone: plain,
  friendly, spoiler-free, no numbers the sim does not already expose here.
- Check `src/guide/search.ts`: if sibling pages contribute search entries
  explicitly, wire the deeds page the same way; if search derives from the
  route list, no work.

### i18n procedure (do this exactly; maintainer directive)

English only, via the sanctioned pending mechanism. The `guide.*` domain is a
catalog domain, so WORDY new English values trip the M16 guard (a wordy leaf
needs real zh, zh_TW, ja, ko, ru fills in the same change). The procedure:

1. Add all English keys; run `npm run i18n:build && npm run i18n:scan`.
2. Run the gate's i18n guard (via `npm run gate`, or the specific i18n test it
   names) and let IT enumerate the M16-flagged keys. Do not build the worklist
   by eye: M16 worklists built from partial test output have missed keys
   before; the gate output is the enumeration.
3. For exactly the flagged keys and nothing more, add the five non-Latin fills
   (zh, zh_TW, ja, ko, ru) to the locale overlays in
   `src/ui/i18n.locales/<lang>.ts`. This is the forced minimum; every other
   locale stays English-pending until the end-of-project fill. Never put
   English text or placeholders into an overlay.
4. Catalog key changes require the sha256 re-baseline (`npm run i18n:hash --
   --write`, or the repo's current equivalent named by the scan output) in the
   SAME commit.

### Regeneration artifacts (all committed in the same change)

- `npm run wiki:content` regenerates `src/guide/content.generated.ts`.
- `npm run sitemap:build` regenerates the sitemap (the guide test gates that
  every route is listed).
- No model stills are involved (this page has no figures); `wiki:stills` is
  explicitly not needed.

## Out of scope (owned by other packet files)

- Any gameplay, sim, server, or window code (01 to 05).
- Rarity percentages or live leaderboard data on the wiki: the page is static
  content only.
- Steam anything (07).
- Mobile polish of the GAME window (08). Note the guide itself allows portrait
  (the landscape gate is in-game only), so the page must simply be a normal
  responsive guide article.
- Translations beyond the forced M16 minimum.

## Steps

1. Read the context files (above). Confirm `DEEDS` field names against the
   real `src/sim/content/deeds.ts` before writing the generator mapping.
2. Extend `scripts/wiki/build_content.mjs` (interface, filter, emit, log).
3. Run `npm run wiki:content`; eyeball `GUIDE_DEEDS` in the generated file:
   correct fields, no `hid_` ids present, feats present with `feat: true`.
4. Add the route, the page module, the page-registry entry, and the English
   keys. Build the page against the generated data.
5. Mirror the bestiary spoiler-safety block in `tests/guide.test.ts` with a
   "Guide deeds spoiler safety" describe: (a) for every def in the sim `DEEDS`
   with `hidden` truthy, assert its id, name, and desc appear NOWHERE in the
   generated file text; (b) assert every `GUIDE_DEEDS` entry maps back to a
   non-hidden def; (c) assert no `trigger` key is emitted. Use the sim import
   pattern the file already uses for the bestiary block.
6. Run `npm run sitemap:build`; run the i18n procedure (above).
7. Verify in a real browser: `npm run dev`, open `/wiki/deeds`, check the nav
   entry, the page in light and dark themes, and a phone-width viewport.
8. Biome the touched files individually; run `npm run gate` (unpiped).
9. Commit everything in one change: `feat(guide): add the Book of Deeds wiki
   page` (adjust wording freely, but scope `guide` and no packet vocabulary),
   staging explicit paths only.

## Acceptance

All of these, in a clean state after your commit:

- `npm run wiki:content && git diff --exit-code src/guide/content.generated.ts`
  exits 0 (freshness).
- `npm run sitemap:build` leaves no diff (sitemap committed fresh).
- `npx vitest run tests/guide.test.ts` green, including your new spoiler
  block, the route/page-registry gate, and the sitemap gate.
- The i18n scan reports no missing-key errors; M16 satisfied for exactly the
  flagged keys; sha256 baseline updated in the same commit.
- `npm run gate` green, run unpiped so the exit code is real.
- Manual: `/wiki/deeds` renders the explainer and every category section with
  correct counts; no hidden deed is visible anywhere on the page; the page is
  readable at phone width in portrait.

## Reviewer dispatch (at completion, before calling the session done)

- `qa-checklist` (fresh agent) over the full diff. Point it at the spoiler
  policy and the i18n rules specifically.
- `test-coverage-auditor` targeted at the new spoiler-safety tests: each
  assertion must be decisive (would fail if the generator filter were deleted;
  no constant-self-comparison; the hidden-exclusion check must iterate the SIM
  table, not the already-filtered guide table).

## Adversarial pass (answer each explicitly in the session output)

- If someone adds a hidden deed to the catalog tomorrow and forgets the wiki,
  does anything leak? (The generator filter plus the sim-table-driven test
  must both say no.)
- Does any emitted field smuggle trigger internals (thresholds, mob ids,
  encounter mechanics)? Check the reward and desc fields too.
- Does the generator and the page survive an EMPTY `GUIDE_DEEDS` (build must
  not crash; page renders the explainer with no catalog sections)?
- Is the deeds page reachable and rendering when `content.generated.ts` was
  built on another machine (no machine-dependent output in your emission)?
- Did the sitemap, page registry, and nav all pick up the route (the three
  distinct gates in tests/guide.test.ts)?
- Any em dash, en dash, or emoji anywhere in the new English copy or fills?
- Does any code comment or commit message mention the packet?

## End of session

1. Update `docs/achievements/progress.md` (row 6: DONE, date, one-line note).
2. Confirm the commit is on `feature/achievements` with explicit-path staging.
3. Name the next file, exactly:
   `docs/achievements/phase-06-qa.md`.
