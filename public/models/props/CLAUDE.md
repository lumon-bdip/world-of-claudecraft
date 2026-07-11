<!-- public/models/props/: village/dungeon/decorative prop GLBs. Root
     CLAUDE.md (asset pipeline invariants, manifest generation) already
     applies; this file is directory-local only. -->

# public/models/props/

Buildings, market stalls, graves, rocks, and other overworld/delve decoration
(`src/render/props.ts`, `src/render/mailbox.ts`, `src/render/delve_props.ts`).

## Size budget

Category average as of this writing: **~70 KB** (42 files, ~2.8 MB total).
Keep new additions in the 40-100 KB range; a hero landmark prop (a house, a
dungeon entrance) can run larger, but a small standalone decoration (a
gravestone, a crate) should land well under the average.

## Compression pipeline

Same `gltf-transform optimize` pipeline as `public/models/creatures/`, tuned
for this category's mid-size budget:

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 32 --texture-compress auto \
  --simplify true --simplify-ratio 0.01875 --simplify-error 0.01 \
  --compress draco
```

The mailbox/grave/wall/crate additions landed at 49-59 KB from raw ~15 MB
Tripo exports after 4 halving iterations starting at texture-size 256 /
simplify-ratio 0.15 (see `public/models/creatures/CLAUDE.md` for the general
iterate-until-under-budget loop).

## Naming convention

`snake_case`, named after the object (`mailbox_pillar.glb`,
`cracked_grave.glb`, `destructible_wall.glb`, `fallback_crate.glb`), matching
the existing village/dungeon-kit files (`bell_tower.glb`, `market_stand_1.glb`).

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.

- Village/overworld structures: `PROP_ASSET_DEFS` in `src/render/props.ts`
  (url + material-dedup `kit` + optional yaw/strip), preloaded in full
  regardless of graphics tier (see the P0 note above `preloadPropKeys`),
  guarded by `tests/render_asset_preload.test.ts`.
- The mailbox pillar (`src/render/mailbox.ts`): `buildMailboxPillar()`
  prefers the GLB (preloaded via `loadGltf()`/`registerPreload()`) and falls
  back to the original procedural carved-stone-and-timber build; either path
  attaches the same "unread mail" votive glow child (`group.userData.mailGlow`,
  toggled by the renderer from `IWorld.mailUnread`).
- Standalone delve props (`src/render/delve_props.ts`): `STANDALONE_PROP_URL`
  lists the cracked-grave/destructible-wall/fallback-crate GLBs;
  `buildStandaloneGlb()` clones the preloaded scene, normalizes it to the
  prop's original target height via a `Box3` measure/rescale (mirroring how
  `buildGlbChest()` normalizes the dungeon-kit reward chest), and re-seats the
  base on the floor. Each `buildX()` entry point is
  `buildStandaloneGlb(key, targetHeight) ?? buildProceduralX(entityId)`, the
  same GLB-then-procedural-fallback contract the reward/locked chest already
  used. The bell rope (`buildBellRope`) stays procedural-only: it needs two
  distinct pulled/unpulled visual states (rope length, bell tilt, a floor
  glow) that a single static GLB cannot represent without a second wired
  asset or a skeletal rig, so it was left out of this pass; a future PR could
  add a small pulled-state overlay the way the locked chest overlays a ward
  seal on top of its GLB.

`tests/render_glb_replacement_assets.test.ts` asserts every preload URL above
resolves to a real, manifested file.
