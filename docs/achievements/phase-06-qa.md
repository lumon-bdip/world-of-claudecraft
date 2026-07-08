# 06 QA: The Book of Deeds on the public wiki

STATUS: NOT STARTED

Dedicated verification session for `phase-06-wiki-guide.md`. Run this AFTER
that session reports done and BEFORE starting `phase-07-steam.md`. This is a
fresh-eyes audit: re-verify, do not trust the implement session's claims.
Never write packet vocabulary into anything you ship (including fixes made
during this QA).

## 0. Orient

Read `docs/achievements/overview.md`, then `phase-06-wiki-guide.md`, then the
diff of the session's commit(s) on `feature/achievements`
(`git log --oneline -5` and `git show --stat` to find them, then the full
diff). List what shipped in one paragraph in your output.

## 1. Re-run acceptance (all of it, from a clean tree)

- `npm run wiki:content && git diff --exit-code src/guide/content.generated.ts`
- `npm run sitemap:build` followed by `git diff --exit-code` on its output file
- `npx vitest run tests/guide.test.ts`
- `npm run i18n:build && npm run i18n:scan` (expect no errors, no unexpected
  diff; if a diff appears, the implement session forgot a regeneration and
  that is a finding)
- `npm run gate`, unpiped, in the worktree (targeted vitest and tsc are safe
  here; if the FULL suite misbehaves in a symlinked worktree, run the gate
  from a proper clone as the known limitation dictates, and say which you did)

## 2. Browser verification (the page must actually be good, not just green)

With `npm run dev` running:

- `/wiki/deeds` from a cold load AND via the sidebar nav (SPA route + deep
  path fallback both work).
- Light and dark themes: headings, tables, and the Feat tags legible in both.
- Phone-width viewport in PORTRAIT (the guide allows portrait; the in-game
  landscape gate must NOT trigger here): no horizontal page scroll; tables
  scroll inside their own container if wide.
- The explainer names Saul as the Chronicler of Eastbrook Vale, the Renown
  section states the score never decreases, and the rewards section says
  cosmetic only. These are locked product statements; wrong copy is a finding.
- Spot-check three deeds of different categories against
  `src/sim/content/deeds.ts` (name, Renown, reward all match the sim).

## 3. Spoiler-safety audit (the load-bearing check)

- Enumerate every `hidden` deed id from `src/sim/content/deeds.ts`, then grep
  `src/guide/content.generated.ts` for each id, each name, and a distinctive
  desc fragment. Zero hits required. Do this by hand even though the test
  exists; you are auditing the test too.
- Confirm no `trigger` data of any shape is present in the generated file
  (grep for `trigger`, and eyeball one `GuideDeed` entry).
- Confirm the guide bundle does not import `src/ui/deed_i18n.ts` (grep
  `src/guide/` for `deed_i18n`); hidden-deed text must stay out of the wiki
  bundle.
- Mutation-test the guard: temporarily blank the hidden filter in
  `scripts/wiki/build_content.mjs` IN MEMORY ONLY (do not commit; the tree has
  uncommitted-revert hazards, so make the edit, run
  `npx vitest run tests/guide.test.ts`, confirm it FAILS, then restore the
  file with a fresh checkout of that one path from HEAD since the file has no
  other local edits, and re-run to green). If the test stays green under the
  mutation, the pin is vacuous: file it as a blocking finding.

## 4. Test decisiveness audit

Dispatch `test-coverage-auditor` (fresh) scoped to the new tests in
`tests/guide.test.ts`. It must confirm:

- The hidden-exclusion test iterates the SIM `DEEDS` table (a filter deleted
  upstream would flip it red), not the already-filtered `GUIDE_DEEDS`.
- No constant-self-comparison pins; literals pinned where load-bearing
  (route sub `deeds`, the nav key string).
- Both arms covered: hidden deeds absent AND non-hidden deeds present (an
  empty `GUIDE_DEEDS` must not pass the suite silently).

## 5. i18n audit

- Every new player-visible string on the page resolves through `t()` (view
  the page with the debug locale if one exists, else grep the page module for
  string literals that bypass `t()`; the esc()-wrapped t() pattern is the only
  sanctioned shape).
- M16: confirm the five non-Latin fills exist for exactly the keys the gate
  flags, and that NO other locale was touched (the maintainer directive is
  minimum-only; extra fills are a finding, as is any English text pasted into
  an overlay).
- sha256 baseline updated in the same commit as the key adds.
- No em dashes, en dashes, or emojis in any new English value or fill
  (the Stop hook catches these late; catch them now).

## 6. Reviewer dispatch

- `qa-checklist` (fresh) over the session diff, if the implement session's own
  run reported findings, verify each was fixed rather than acknowledged.

## 7. Adversarial what-is-missing pass

Answer explicitly:

- Is the deeds page discoverable (sidebar group, sitemap, search) or only
  reachable by URL?
- Does the page degrade sanely if a category has zero non-hidden deeds?
- Did the implement session touch anything outside its scope (sim, server,
  window code)? Out-of-scope edits are findings even when correct.
- Are the generated-file and sitemap diffs pure regeneration (no hand edits)?
- Is there any copy on the page that promises features this packet does not
  ship (seasons, rarity percentages on the wiki, Steam)?

## Exit criteria

All acceptance commands green from a clean tree; browser verification passed
in both themes and portrait phone width; the mutation test proved the spoiler
pin bites; test-coverage-auditor and qa-checklist findings fixed (all
severities, nits included); i18n audit clean.

## End of session

1. Update `docs/achievements/progress.md` (row 6Q: DONE, date, note).
2. If you made fixes, they are committed with scope `guide` (or `test`),
   explicit paths, no packet vocabulary.
3. Name the next file, exactly:
   `docs/achievements/phase-07-steam.md`.
