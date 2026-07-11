<!-- public/models/resources/: gatherable-node and material GLBs. Root
     CLAUDE.md (asset pipeline invariants, manifest generation) already
     applies; this file is directory-local only. -->

# public/models/resources/

Gatherable world-node markers (`src/render/gather_nodes.ts`) and other small
harvestable/crafting-material GLBs.

## Size budget

Category average as of this writing: **~19.6 KB** (135 files, ~2.6 MB total).
This is the tightest budget of any model category: these are tiny, distant,
often-repeated static props, so keep new additions in the 15-45 KB range.
Below ~30 KB the container overhead (Draco tables, glTF JSON) starts to
dominate a small mesh, so do not fight for byte-for-byte parity with the
average if a further texture-size halving stops moving the needle; land as
close as the compressor's diminishing returns allow and document the actual
result here.

## Compression pipeline

Same `gltf-transform optimize` pipeline as `public/models/creatures/`, but
iterate texture-size down further (this category has the smallest budget):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size <16|32|64> --texture-compress auto \
  --simplify true --simplify-ratio 0.01 --simplify-error 0.01 \
  --compress draco
```

The ore/wood/herb gather-node GLBs landed at 32-46 KB from raw ~15 MB Tripo
exports (texture-size 8-16, simplify-ratio floored at 0.01); that floor is the
practical minimum this pipeline reaches for a PBR-textured mesh, not a bug.

## Naming convention

`snake_case`, prefixed `gather_` for world-node markers
(`gather_ore_vein.glb`, `gather_wood_pile.glb`, `gather_herb_cluster.glb`) to
distinguish them from other resource-category assets.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.

`src/render/gather_nodes.ts` maps each `GatherNodeType` (`ore`/`wood`/`herb`,
defined in `src/sim/data.ts`) to a GLB URL in `NODE_ASSET_URL`, preloads all
three via `loadGltf()` + `registerPreload()` at module import time, and clones
the loaded scene per `GATHER_NODES` placement (`src/sim/content/gather_nodes.ts`).
Falls back to the original tiny primitive geometry (`NODE_FALLBACK_GEOMETRY`)
if a GLB has not finished loading yet. `tests/gather_nodes.test.ts` asserts
`gather_nodes_lookup.ts`'s `NODE_GEOMETRY_KEYS` still covers every node type
used in content; `tests/render_glb_replacement_assets.test.ts` asserts every
`NODE_ASSET_URL` entry resolves to a real, manifested file.
