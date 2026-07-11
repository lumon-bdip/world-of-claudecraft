<!-- public/models/creatures/: mob and ambient-wildlife GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/creatures/

Mob bodies (`src/render/characters/`) plus small ambient-wildlife GLBs
(`src/render/critters.ts`, `src/render/fish.ts`).

## Size budget

Category average as of this writing: **~185 KB** (33 files, ~5.9 MB total).
Keep new additions within roughly 100-300 KB unless the model is a raid boss
or otherwise a genuine visual centerpiece; small ambient critters/fish should
land well under the average (100-200 KB), not at it.

## Compression pipeline

New GLBs (e.g. Tripo-generated ambient wildlife) are produced raw (10-15 MB,
1M+ vertices, 2K+ textures) and MUST be compressed before committing. Pipeline
used for the rabbit/squirrel/songbird/leaping-fish additions:

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size <128|256> --texture-compress auto \
  --simplify true --simplify-ratio <0.05-0.15> --simplify-error 0.01 \
  --compress draco
```

Start at `--texture-size 256 --simplify-ratio 0.15`; if the result is still
above budget, halve `texture-size` and `simplify-ratio` and retry (2-3
iterations is typical to land in the 150-200 KB range from a raw 13-15 MB
Tripo export). `gltf-transform inspect <file>.glb` shows the resulting
vertex/texture footprint if you need to tune further.

## Naming convention

`snake_case`, named after the creature (`rabbit_critter.glb`,
`leaping_fish.glb`), matching the existing mob files (`wolf_basic.glb`,
`crabenemy.glb`, ...).

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.

- Mob bodies: registered in `src/render/characters/assets.ts` /
  `src/render/characters/manifest.ts`.
- Ambient critters (rabbit/squirrel/songbird): `src/render/critters.ts` loads
  each species GLB via `loadGltf()` + `registerPreload()` at module import
  time, clones the loaded scene per pool instance, and falls back to the
  original merged-primitive body if the GLB has not finished loading yet
  (headless/test hosts, or a slow preload race online).
- Ambient fish: `src/render/fish.ts` follows the same load/clone/fallback
  pattern for the single leaping-fish species.

Both preload sets are asserted against the manifest + filesystem by
`tests/render_glb_replacement_assets.test.ts`.
