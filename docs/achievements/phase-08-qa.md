# 08 QA: the final gate of the Book of Deeds feature

STATUS: NOT STARTED

Read `docs/achievements/overview.md` first (authoritative). This is the LAST
session of the packet: it verifies the 08 implement session AND gates the whole
feature end to end, then deletes the packet directory as its exit act. Nothing
ships after this except the maintainer's own PR review.

House rules still bind: no em dashes, en dashes, or emojis anywhere; no
"phase"/packet wording in anything that ships (including the deletion commit
message); English-only i18n with pending rows expected.

## 1. What shipped (fill in from the 08 session summary)

List the commits since the 07 QA session with one line each. Confirm the 08
session's balance report and PR draft exist in its summary.

## 2. Re-run acceptance

Re-run every command in the 08 implement file's Acceptance section verbatim and
record real exit codes. `npm run gate` runs UNPIPED (a `| tail` masks the exit
code). Do NOT set `I18N_RELEASE_TIER=1`; pending i18n rows are correct here.

## 3. Full-feature end-to-end walkthrough (online, two clients)

Setup: `npm run server` freshly rebuilt on this branch + `npm run dev`;
`ALLOW_DEV_COMMANDS=1` (dev only) for level/teleport shortcuts; drive REAL
keybinds and the REAL More-tray button, never window hooks; dismiss the intro
overlay before judging `#ui`.

Walk every row and record pass/fail:

1. Fresh character: earn a first deed live (first kill); the banner, log line,
   audio sting, and VFX fire once; the deed shows earned in the window with
   today's date; Renown increments.
2. Veteran character (a save with quests/levels/arena history): on world join,
   retro grants arrive as ONE batched summary line, no banner spam; the window
   shows the earned set; Renown matches the sum of earned non-feat deeds.
3. Titles: equip a title on client A via the window; client B sees it on A's
   nameplate and inspect within one snapshot cycle; clearing it works;
   `deed_set_title` on an unearned or titleless deed is rejected server-side.
4. Watchlist: pin an entry, progress ticks in the tracker as its counter
   advances, unpin works, the pin survives a reload (localStorage), and the
   tracker never overlaps mobile controls at 360px landscape.
5. Mobile viewport (touch-emulated landscape phone): open via the More tray,
   browse chips, search, long-press peek without activating, close; the 16px
   input floor holds (no iOS zoom); every tap target >= 40x40.
6. Wiki: `/wiki` deeds page renders populated; grep the generated content
   artifact for every `hid_` id: ZERO hits (hidden deeds excluded
   structurally).
7. Leaderboard: the deeds board tab renders; the test account appears once with
   its highest-Renown character; the entry floor holds (a sub-floor account is
   absent); the self row shows rank.
8. Delisting: ban a throwaway account via the admin path; delisting is
   IMMEDIATE via the cache-bust hook (no TTL wait): its row is gone from every
   board on the next request (deeds, lifetime XP realm and global, arena,
   guilds, daily rewards); unban relists without stale cache.
9. Steam stays dark: with `STEAM_ENABLED` unset, no link UI is reachable
   anywhere (desktop bridge included), and the steam routes answer with the
   stable `steam.disabled` error code (they exist but are hard-disabled);
   grep the client bundle for any steam link string leaking into the
   non-desktop UI.
10. Offline sandbox: the offline quick-start world grants deeds in-session
    (banner works), and nothing offline ever reaches `character_deeds`, the
    boards, or Steam.
11. Determinism spot check: two headless runs of the same seed produce
    identical deed grant sequences (reuse the parity harness idiom from the 01
    QA session).

## 4. Whole-feature review dispatch (fresh agents)

- `qa-checklist` over the WHOLE feature diff: `git diff <branch-point>..HEAD`
  where `<branch-point>` = `git merge-base HEAD` against the release branch
  `feature/achievements` was cut from or currently tracks (do not assume a
  specific version; the release train may have advanced). Triage every
  finding; house rule: fix blocking, should-fix, AND nits.
- `test-coverage-auditor` over the full feature's test surface: every claimed
  behavior has a DECISIVE assertion (no constant-self-comparison pins; wire
  tokens, SQL, and count pins are literals; negative cases exist per trigger
  kind, per board exclusion, per command rejection).
- One targeted `architecture-reviewer` pass over `src/sim/` deed files as a
  final determinism sweep (zero rng draws, tick-tail placement unchanged,
  append-only seam).

## 5. Adversarial what-is-missing pass

Answer explicitly in the summary:

- Is there ANY deed a player can permanently miss? (The contract says no.)
- Can any deed be earned twice, or Renown drift from the earned set on
  reload? (Recompute-on-load must equal the stored denormalized value.)
- Does any shipped artifact mention the packet? Oracles:
  `rg -n "docs/achievements" src server electron scripts tests package.json`
  is empty, and `git log --format=%B <branch-point>..HEAD` (same merge-base
  as section 4) contains no packet vocabulary.
- Is any string hand-written into a locale overlay? (`git diff` on
  `src/ui/i18n.locales/` since merge-base shows only the forced M16 fills from
  the wiki session, nothing else.)
- Would a brand-new contributor understand the feature from the PR body alone?

## 6. Exit criteria, then the deletion

All of the following, in order:

1. Sections 2 to 5 pass with every finding fixed and re-verified.
2. Update nothing in `progress.md` (it is about to be deleted); the final
   status lives in this session's summary instead. This is the one sanctioned
   exception to the packet's update-progress-every-session rule, sanctioned
   because the file dies in the next step.
3. Delete the packet: `git rm -r docs/achievements/` in its own commit with a
   process-free message (e.g. `chore(docs): remove internal working notes`).
   The memory file `achievements-system-design.md` (assistant memory, outside
   the repo) remains the durable record of the maintainer's calls.
4. Re-run `npm run gate` once more after the deletion commit (the wiki
   freshness and corpus guards must not have depended on packet files).
5. Push the branch to origin (never the fork).

End the session summary with: the walkthrough table, the final feature stats
(deed count, Renown total, titles, Steam map size), the PR title/body ready to
paste, and the statement that the Book of Deeds feature is ready for the
maintainer's PR review. There is no next packet file.
