# 07 QA: Steam linking + achievement mirror

STATUS: NOT STARTED

Dedicated verification session for the work specified in
`docs/achievements/phase-07-steam.md`. Read that file and
`docs/achievements/overview.md` first, then the diff this work landed (the
commits since the row-6 QA entry in `progress.md`). This session verifies; it
fixes only what verification finds. Executing on Fable 5 xhigh with ultracode:
fan the reviewers out in parallel and verify their findings independently
before acting.

## 1. What shipped (fill in from the implement session's output)

List the commits, files, and any deviations the implement session recorded,
including whether the optional icon-export script was built or skipped, and the
result of the appid-480 manual loop (run or skipped).

## 2. Re-run acceptance (all of it, fresh)

- `npx vitest run <the steam test files named in the implement session>`
- `npx vitest run tests/api_error_code_parity.test.ts tests/architecture.test.ts`
- `npm run gate` (unpiped; do not pipe through tail, it masks the exit code)
- Flag-off boot: start the server WITHOUT `STEAM_ENABLED` and confirm by hand:
  every `/api/steam/*` route returns the stable disabled code, `/api/status`
  advertises `steam.enabled: false` on BOTH dispatch arms
  (`API_DISPATCH=new` and `API_DISPATCH=legacy`), and no link UI renders in a
  dev client.
- Flag-on boot with a FAKE key and app id: routes come alive, a garbage ticket
  is rejected with `steam.invalid_ticket`, nothing crashes, and the failed
  upstream call never prints the key.

## 3. Decisive-assertion audit

Dispatch test-coverage-auditor (fresh) over the new tests with these named
suspicions, and act on what it reports:

- The forbidden-login pin must be decisive: it fails if a steam route mints a
  token (spy-level assertion), not merely asserts a constant about route
  shapes. Constant-self-comparison pins are the known trap.
- The map pins must be literals: the 100 cap as a literal number, the regex as
  a literal, and a NEGATIVE case each (a 101st entry, a bad name, an unknown
  deed id) proving the test can fail.
- Conflict arms both tested: already-linked AND steam-id-taken, with distinct
  error codes asserted by literal string.
- Mirror tests cover the either/all split: unlinked no-op, unmapped no-op,
  retry-then-drop, dedupe, and reconcile pushing the full earned intersection.
- The disabled arm is asserted per route, not once globally.

## 4. Domain reviewers (spawn FRESH, in parallel; the implementer never reviews itself)

- privacy-security-review, pointed checklist: login stays email + Discord only
  (no steam route touches `newToken`/`auth_tokens`; no session or cookie side
  effects); `STEAM_WEB_API_KEY` absent from logs, error bodies, client
  bundles, and test snapshots; ticket verification rejects VAC/publisher bans;
  the link route is rate-limited; `ON DELETE CASCADE` verified.
- migration-safety: DDL additive + idempotent (boot twice against the same
  database), both UNIQUE constraints present in the shipped SQL, accessors
  parameterized, no realm column (account-global is intentional).
- cross-platform-sync: web and desktop behave identically with the flag on and
  off; the `/api/status` dual-arm edit is byte-equivalent in both arms; an old
  desktop shell without `steamLinkTicket` still logs in (feature detection
  requires only the login trio); website-distribution builds never initialize
  steamworks.js.

Apply every confirmed finding: blocking, should-fix, and nits.

## 5. Adversarial what-is-missing pass

Answer in the session output, with evidence:

- Grep the packaged build inputs for `steam_appid.txt`; confirm it cannot ship.
- Confirm the mirror hook lives in the persistence recorder, not as a new db
  call in `server/game.ts`; if it is in `game.ts`, verify the private
  bot-detector overlay mocks were fixed in BOTH copies.
- Link, unlink, relink a different steam id in a test: assert no write ever
  targets the old id afterward.
- Is there any await on the world-loop hot path introduced by this work?
  (Inspect the recorder-to-mirror call chain.)
- Does the client render any Steam affordance from stale capability data after
  a flag flip (cache TTLs)?
- Are the new `apiError.steam.*` wordy leaves filled in the five non-Latin
  locales (M16 green), and is that the ONLY translation this work added?

## 6. Exit criteria

All acceptance commands green; all reviewer findings applied or explicitly
refuted with evidence; the adversarial answers recorded; no em/en dashes or
emojis anywhere in the diff; no "phase" or packet wording in any shipped
artifact or commit message.

## End of session

Update `docs/achievements/progress.md` (row 7Q, with date). End your final
response by naming the next file:
`docs/achievements/phase-08-mobile-polish.md`.
