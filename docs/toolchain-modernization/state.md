# Toolchain Modernization: cross-phase state

## Current phase

Phase 1 (Degit the i18n aggregate artifacts): NOT STARTED.

## Locked design decisions (record once, reference forever)

- D1: TypeScript 7 adoption is GO, via the official dual-alias install:
  "typescript": "npm:@typescript/typescript6@^6.0.2" plus
  "@typescript/native": "npm:typescript@^7.0.2". svelte-check stays on the TS6 wrapper
  until the TS 7.1 API ships AND sveltejs/language-tools adopts it.
- D2: TranslationKey becomes a build-generated flat literal union
  (src/ui/i18n.catalog/translation_keys.generated.ts, emitted by scripts/i18n_build.mjs),
  replacing the Leaves-based computation in src/ui/i18n.catalog/index.ts. The Leaves type
  stays exported (it has zero other instantiations). tests/i18n_overlay_key_membership.test.ts
  retires in the same change (tsc now enforces strictly more than it did).
- D3: baseUrl is deleted from tsconfig.json; the #bot-detector paths entries stay as-is
  (already ./-relative; verified to resolve without baseUrl on TS 5.9.3, 6.0.3, 7.0.2).
- D4: src/ui/i18n.resolved.sha256 is deleted outright (redundant with the committed
  slices + CI freshness diff + determinism tests). src/ui/i18n.status.summary.json is
  gitignored but still generated. The audit trail moves out-of-band: scan counts posted
  to the CI job summary (and optionally a sticky PR comment via the existing
  scripts/gh_sticky_comment.mjs pattern). Owner approved reopening the two closed
  decisions in docs/i18n-scaling/lazy-locales-and-contributor-workflow.md on 2026-07-14.
- D5: Five separate PRs, one per implementation phase, each branched off the LATEST
  release/** branch in its own git worktree, landed in phase order. Never fold phases
  into one long-lived branch.
- D6: Generated-artifact policy (the rule Workstream B proved): committed generated
  artifacts must be LINE-ITEM (sorted, one item per line, no counts, no hashes, no
  timestamps anywhere in the file). Global aggregates are never committed; they are
  generated on demand and checked by regeneration in CI. Apply this to every future
  generated artifact.
- D7: CI target: PR gate wall time at or under 4 minutes on free standard runners, via a
  4-shard test matrix (npm test -- --shard=i/4, NEVER bare npx vitest in CI: pretest must
  run per shard) plus a parallel checks job (typecheck, builds, freshness, malware gate).
  The job id pr-gate is load-bearing (pinned by tests/ci_workflow.test.ts). Phase 4 may
  amend the shard count with a recorded measurement rationale.
- D8: FFmpeg in CI comes from the ffmpeg-static/ffprobe-static npm packages (already
  devDependencies with allowlisted install scripts; verify their binaries by execution,
  a scripts-skipped install leaves them missing), preferably by repointing the two
  hardcoded PATH spawns in
  scripts/sfx_studio/audio_io.mjs and scripts/sfx_studio/export_bundle.mjs (pattern:
  scripts/sfx_conform.mjs). Contingent on the Phase 3 loudness go/no-go; fallback is a
  CI-only symlink step.

## Non-negotiable constraints for every phase

- This packet is toolchain work: NO runtime behavior change. The resolved i18n output
  must stay byte-identical except where a phase explicitly changes artifact policy.
- No em dashes, en dashes, or emojis in any file (the repo Stop hook scans for them).
- Never hand-edit generated files; regenerate via the owning build step.
- Never run a whole-repo biome --write; format only changed files.
- Shared working tree: commit with EXPLICIT paths, never git add -A. A concurrent
  session may share the checkout; there are unrelated untracked coop files present.
- Branch off the LATEST release/** branch (release/v0.26.0 as of 2026-07-14; check for
  newer at phase start) in a separate worktree, per the root CLAUDE.md workflow.
- Packet bootstrap: fresh worktrees lack this directory until Phase 1's PR (which
  commits the packet) merges; copy docs/toolchain-modernization/ from the main checkout
  when absent.
- Packet-doc conflict rule: progress.md and state.md are append-per-phase; on a merge
  conflict take both sides (each phase touches only its own checklist rows and the
  status line).
- Pinned tests must be updated in the SAME commit as the surface they pin (list below).

## Validation matrix by change type (this packet's variants)

- i18n artifact/policy change (Phases 1, 2): npm run i18n:gen twice (second run leaves a
  clean tree, the determinism proof) + npx vitest run tests/i18n_resolved_equivalence.test.ts
  tests/i18n_status_registry.test.ts tests/localization_fixes.test.ts + npx tsc --noEmit.
- Type-system change (Phase 2): npx tsc --noEmit (record wall time against baselines
  below) + npx -y -p typescript@7.0.2 tsc --noEmit -p tsconfig.json (the forward probe)
  + npx vitest run tests/server/new_endpoint.test.ts.
- CI workflow change (Phases 1, 3, 4): npx vitest run tests/ci_workflow.test.ts + a real
  test PR observing the run (step list, timings, freshness failure still legible).
- SFX tooling change (Phase 3): npx vitest run tests/sfx_conform.test.ts
  tests/sfx_studio.test.ts tests/sfx_studio_server_security.test.ts
  tests/sfx_export_bundle.test.ts tests/sfx_gate_preflight.test.ts.
- Toolchain flip (Phase 5): npm run check:types + npx vitest run
  tests/server/new_endpoint.test.ts + the pre-push hook dry run
  (bash .githooks/pre-push under a no-op push) + full npm run gate.
- Any code change: npm run ci:changed; fix formatting with a SCOPED
  npx @biomejs/biome check --write <file>.
- Pre-merge, every phase: npm run gate (release-tier automatically on release/**).

## Measured baselines (2026-07-14; re-measure, do not assume)

- tsc --noEmit (TS 5.9.3): 26 to 35s local, ~71s CI. Target after Phase 2: ~12s local.
- Target after Phase 5: <= 5s local (measured ~1.8 to 4s in probes).
- PR gate job median: 658s total; vitest step 502s; Typecheck 66.5s; apt FFmpeg 22s.
- Target after Phases 3+4: <= 4 minutes wall over 3 consecutive runs.
- Slowest test files: vale_cup.test.ts 58.5s, sfx_studio_server_security.test.ts 42.2s,
  sfx_export_bundle.test.ts 30.8s, parity/parity.test.ts 21.9s.

## Key file paths

Workstream B (Phase 1 touch set):
- src/ui/i18n.resolved.sha256 (delete), src/ui/i18n.status.summary.json (gitignore)
- scripts/i18n_resolved_hash.mjs (reduce to print-only diagnostics), scripts/i18n_scan.mjs
  (header comment only), package.json (i18n:hash script)
- .github/workflows/ci.yml (freshness diff lines in BOTH pr-gate and release-gate + new
  audit-summary step), scripts/gate.mjs (I18N_ARTIFACTS + hint string)
- tests/i18n_resolved_equivalence.test.ts (drop the sha256 baseline block; KEEP the
  slices-tracked, regen-byte-identical, and perturbed-determinism blocks)
- tests/i18n_status_registry.test.ts (drop tracked/git-diff assertions; keep all four
  remaining blocks, the counts cross-check, the perLocale tally, the universeHash
  re-derivation, and determinism, which read the pretest-generated file)
- .gitignore, biome.json
- Docs/skills text sweep: src/ui/CLAUDE.md, scripts/CLAUDE.md, tests/CLAUDE.md,
  .claude/skills/review-pr/SKILL.md, .claude/skills/release-merge-audit/SKILL.md,
  .claude/skills/i18n-locale-fill/SKILL.md, docs/i18n-scaling/translation-workflow.md,
  docs/prd/FRONTIER_PHASE1_HANDOFF.md,
  docs/i18n-scaling/lazy-locales-and-contributor-workflow.md. Historical program
  records (ip-refactor/, docs/api-pipeline/) are exempt: leave unedited.

Workstream A (Phases 2, 5 touch set):
- scripts/i18n_build.mjs (+ scripts/i18n_flatten.mjs, read-only reuse)
- src/ui/i18n.catalog/index.ts (the TranslationKey definition), NEW
  src/ui/i18n.catalog/translation_keys.generated.ts
- tsconfig.json (baseUrl line), .gitattributes, biome.json
- tests/i18n_overlay_key_membership.test.ts (retire in Phase 2)
- package.json + package-lock.json (Phase 5 dual alias), .githooks/pre-push (Phase 5
  probe-by-execution), CONTRIBUTING.md, root CLAUDE.md (Phase 5 docs)

Workstream C (Phases 3, 4 touch set):
- .github/workflows/ci.yml (pr-checks job, shard matrix, FFmpeg step removal)
- scripts/sfx_studio/audio_io.mjs, scripts/sfx_studio/export_bundle.mjs (ffmpeg-static
  repoint), scripts/gate.mjs (preflight)
- tests/vale_cup.test.ts (split into 2 to 3 files along describe boundaries)
- Pinned: tests/ci_workflow.test.ts, tests/sfx_gate_preflight.test.ts

## Pinned tests (update in the SAME commit as the pinned surface)

- tests/ci_workflow.test.ts: pr-gate job id + three if fragments + no I18N_RELEASE_TIER
  string in the job; exactly 2 occurrences of "run: npm run check:types"; no inline
  "npx tsc --noEmit" in ci.yml; browser-gate install/test lines; gate.mjs step tuples;
  release-gate tier pins.
- tests/sfx_gate_preflight.test.ts: gate.mjs PATH-ffmpeg preflight error text.
- tests/i18n_resolved_equivalence.test.ts and tests/i18n_status_registry.test.ts:
  committed-artifact assertions (Phase 1 rewrites specific blocks).
- tests/server/new_endpoint.test.ts: spawns node_modules/.bin/tsc against a config that
  extends the root tsconfig (exercises baseUrl removal and the TS7 binary end to end).

## New files created per phase

(Planned entries below; confirm or amend as phases complete.)
- Phase 2: src/ui/i18n.catalog/translation_keys.generated.ts (committed, line-item).
- Phase 4: the tests/vale_cup.test.ts split files (2 to 3, names chosen at split time)
  plus a possible shared local test util.

## OPEN research items and gotchas

1. Vitest "setup" aggregate bucket (~351s across workers) unexplained given zero
   setupFiles; Phase 4 measures before finalizing shard count.
2. FFmpeg-static loudness go/no-go is Phase 3 step 1; fallback: CI symlink only.
3. Phase 1 merge timing: at a release-branch cut, announced in advance; resolution rule
   for open PRs is take-the-deletion then npm run i18n:gen. Owner action.
4. No branch protection / rulesets currently enforced on GitHub (probed 2026-07-14);
   re-approval is process-level. Nothing here depends on it; owner may want to confirm.
5. At Phase 5 execution: if typescript 7.0.3+ exists, re-run the Phase 2 forward probe
   against it before flipping (the plan assumes 7.0.2 semantics).
6. jgyy's issue #1868 comment reproduces at --checkers 8; the discrepancies are explained
   and recorded in brainstorm.md (7 vs 8 files, timing, leaf counts).
7. The i18n:gen output is deterministic; running it twice must leave a clean tree. Any
   phase that sees a dirty tree after a second regen has found a real bug: stop and report.
