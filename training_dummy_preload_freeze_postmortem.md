## Bug: teleporting near the zone3 ogre camp freezes the client

### Symptom

`/dev tp -90 668` (near the `thornpeak_ogre` war-camp in zone3) reliably froze
the client: the first frame rendered, then the screen stopped updating
entirely while sim ticks and audio kept running in the background. Reproduced
in both Chrome and Firefox, in offline mode.

### Exact error

```
Uncaught Error: character asset not preloaded: models/creatures/training_dummy.glb
    at resolvedGltf (assets.ts:530:17)
    at prepareVisual (assets.ts:884:16)
    at new CharacterVisual (visual.ts:221:18)
    at createCharacterVisual (index.ts:29:10)
    at Renderer.createView (renderer.ts:3457:18)
    at Renderer.createCandidateViews (renderer.ts:2146:12)
    at Renderer.sync (renderer.ts:4269:26)
    at perf.trace.mode (main.ts:2872:52)
    at PerfMonitor.trace (perf.ts:428:36)
    at main.ts:2872:14
```

Repeated on every single animation frame after the freeze started (192+
occurrences observed in one session), each with an identical stack.

### Why it looks like a freeze, not a crash

`requestAnimationFrame` keeps firing every frame (visible in the trace: `frame
@ main.ts:2761` -> `requestAnimationFrame` -> repeat), so the outer loop never
actually dies. But `Renderer.sync()` throws partway through
`createCandidateViews` on every single frame, before it finishes painting.
The screen never visually updates again, while the sim tick and audio (which
run earlier in the same frame, on a separate code path from the renderer)
keep working normally. That's why sound kept firing after the "freeze."

### Root cause

`training_dummy` is a zone3 camp near the ogre war-camp
(`{ mobId: 'training_dummy', center: { x: -40, z: 648 }, radius: 0, count: 1 }`,
`src/sim/content/zone3.ts:1883`), about 54 yards from the teleport point.
Its model, `models/creatures/training_dummy.glb`, is missing from (or racing
against) the character-asset preload set built by `characterPreloadUrls()`
(`src/render/characters/manifest.ts`). The renderer's per-frame
view-creation budget is priority-ordered (`viewCandidatePriority` in
`renderer.ts`): hostile mobs within 35 yards go first, and `training_dummy`
is non-hostile (`aggroRadius: 0`), so it only gets processed once the budget
works through the ~21 hostile ogres nearby first. When the renderer finally
reaches it and calls `resolvedGltf()`, the model was never registered as
preloaded, so it throws synchronously inside the render path with no
surrounding try/catch, permanently stalling that frame's paint, every frame,
forever (the entity never gets marked as having a created view, so it
re-enters the candidate list every subsequent frame).

### How we confirmed it was pre-existing, not a regression

Initial testing was inconclusive: the bug reproduced repeatedly on the
`feature/mob-idle-sfx` branch but not on what was assumed to be a baseline,
which cast suspicion on the new idle mob-voice trigger code added on that
branch. That suspicion turned out to be a false lead: the "baseline" worktree
was accidentally still checked out at a stale commit from earlier in the same
session, dozens of commits behind the point `feature/mob-idle-sfx` actually
branched from (this repo moves fast, roughly 1000+ commits/week). The two
test servers were never running the same code, they were just at different
points in a fast-moving upstream, which is exactly the kind of gap that swallows
an unrelated fix or an unrelated regression between them.

Re-running the comparison against a baseline pinned to the EXACT commit
`feature/mob-idle-sfx` branched from (`9a5ce7a93`), with zero idle-sfx code
present, reproduced the identical error and freeze. That confirms the bug is
pre-existing in `release/v0.27.0` itself and entirely unrelated to the idle
mob-voice trigger work; no idle-sfx code appears anywhere in the stack trace.

### Fix (not yet implemented)

Two independent things worth doing:
1. Add `training_dummy` (and audit for any other creature camp with the same
   gap) to whatever set `characterPreloadUrls()` actually preloads.
2. Make `resolvedGltf` fail soft (log + skip that entity's view) instead of
   throwing synchronously inside the per-frame render path. This is the more
   robust fix: it would stop ANY future missing-preload entry from being able
   to freeze rendering the same way, rather than only patching this one model.
