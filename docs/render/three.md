# 3D renderer (Three.js): state and tools

The 3D renderer is the game's view. `?2d` opens the Pixi board instead (`src/app/main.tsx`). Shared code is in `src/core/render/three/`. The room and the city are in `src/features/room/render/three/` (`outside/` holds the city). The machine is in `src/features/board/render/three/`.

This file says what the engine does today. The look and the design rules are in [`3D_STYLE.md`](../3D_STYLE.md). Graphics panel and tiers are in [`UI.md`](../UI.md#graphics-panel-panelsgraphicstsx-the-model-is-appgraphicsts). Level-of-detail rules are in [`lod.md`](lod.md).

Figures are for `03fe0bc` (origin/main, 2026-11-14), on an RTX 5080 at 1920x1080, unless a line says otherwise.

## Presets

`PRESETS` in `src/app/graphics.ts`. High is the default.

| Option | Low | Medium | High | Ultra |
|---|---|---|---|---|
| `scale` (render size) | 0.75 | 0.75 | 1 | 1 |
| `msaa` | 0 | 2 | 4 | 8 |
| `ao` | 0 | 0 | 2 | 3 |
| `bloom` | 0 | 1 | 2 | 2 |
| `shadows` (sun map, room maps) | 0 (off) | 2 | 3 | 4 |
| `lights` (room lamp cap; 0 = all) | 4 | 0 | 0 | 0 |
| `lightShadows` | 0 | 0 | 1 | 1 |
| `textures` | 0 | 1 | 2 | 3 |
| `filtering` (anisotropy) | 2 | 4 | 8 | 16 |
| `live` | 0 | 1 | 2 | 3 |
| `particles` | 0 | 1 | 2 | 2 |

Rules:

- **No tier changes geometry.** Low, Medium, High and Ultra use the same triangles. `docs/3D_STYLE.md` says the same. The part and city builders read no tier. The only graphics reads are shadow levels and the material swap.
- A tier changes: render scale, MSAA, AO, bloom, shadow maps, the room lamp cap, the Lambert swap (Low only, see below), and texture filtering.
- The preset does not change frame limit, brightness or auto-adjust.
- Medium was not benched on the RTX. Only High and Low have numbers.

## Lights and shadows by tier

- The room has 20 real lights (6 spots, 2 points, 12 area). Low keeps 4: `key`, `sun`, `arc`, `desk`. A manual cap of 8 adds `floor`, `bedside`, `sconceUp` and `sconceDown`. Medium and up keep all 20 (`roomlights.ts`).
- A capped light is hidden (`visible = false`). Its fixture still glows. Its bounce is lifted (`CAPPED_BOUNCE` 2.5, `roomlights.ts:36`).
- Room shadow maps by level (`SHADOW_LEVELS`, `room3d.ts:63-65`), in px: key / sun / desk / bedside (cube) / floor (cube) / arc.

| Level | key | sun | desk | bedside | floor | arc | Used by |
|---|---|---|---|---|---|---|---|
| 0 Off | none | none | none | none | none | none | Low |
| 2 Med | 2048 | 1024 | 1024 | 512 | 512 | 1024 | Medium |
| 3 High | 4096 | 2048 | 1024 | 1024 | 1024 | 2048 | High |
| 4 Ultra | 8192 | 4096 | 2048 | 2048 | 2048 | 4096 | Ultra |

- The city has one shadow caster, the sun. Its map is 0 / 2048 / 4096 / 4096 for Low / Medium / High / Ultra (`SHADOW_LEVELS`, `outside/view.ts:42`). The city has no other tier hook.
- Lightmaps: 12 room maps, each 994x1152, RGBM, no mips, nearest filter. The machine and the city have no lightmaps. No `LightProbe` or SH grid exists.

## Levels of detail and detail tiers

Parts, the room and the city each use a different method. Full bands are in [`lod.md`](lod.md#3d-distance-bands-city) and [`lod.md`](lod.md#the-machines-stand-ins).

- **Machine parts** (`partlod.ts`): a stand-in set replaces the detail of far parts. Two states only: LOD0 and stand-in. The stand-in keeps the LOD0 triangles. Stand-ins cut draws (632 to 398 meshes in the room view), not triangles.
- **No LOD1 (30 %) or LOD2 (10 %) exists** for any part, the case shell or the room. The case shell has no LOD and no stand-in.
- **Build my PC** keeps every part at full detail (`LOD_CEIL`, see `lod.md`).
- **Room**: no distance LOD. The room's draw cut comes from merges only.
- **City**: distance changes detail and generation. Only generation limits remove objects (see the table in `lod.md`). Rings do not drop objects, and buildings have no distance cull (the far ring keeps every far building).

## Merges

| Merge | Where | Effect |
|---|---|---|
| `mergeStatic` | room, at build (`room3d.ts:742`, `merge.ts:47`) | one mesh per material |
| `mergePalette` | room (`PALETTE_CELL` 2 m, `room3d.ts:138`) | per-cell meshes, so the frustum can still cull them |
| `mergeSiblings` + `shareMaterials` | machine, once at build (`machine3d.ts:262-266`) | still meshes of one parent become one palette mesh; gated by the `merge` flag only, not by tier |
| stand-ins (`standIns`, `merge.ts`) | far machine parts | a stand-in set of merged meshes |
| `Sweep` | city buildings and trees (`sweep.ts`) | one draw per ring, cut to the camera's frustum |
| `sweptMerge` | city street (`CELL` 24 m, `sweep.ts`) | street pieces merged per material, in bearing order |
| instancing | room books, city cars, signal lamps, swept rings, machine fixings | no `BatchedMesh` is used anywhere |

What stays unmerged on the machine: meshes that are named or have `userData`, glow, fade or are transparent, are owned by a writer (`own`, `PartSkin`), are instanced or skinned or morphed, are mirrored, sit directly under the root, or are under `skip`. Shared materials differ by colour, roughness and metalness only, so they read those from vertex colours. Emissive and mapped meshes do not share a program, so "one draw" is one draw plus its emissive draw.

Measured:

- Maxed sandbox machine: 1,440 meshes to 724, and 808 materials to 436 (figures from the retired overhaul plan, no SHA stated).
- Menu at Low, machine: 487 meshes to 238, 239 materials to 102 (same doc).
- Per-part and per-case draws after merge: not measured at `03fe0bc`. The case had 462 meshes and about 950 draws in Build my PC (geo run at `bfe11c6`).

## Cheap materials (Low)

`cheapMaterials` (`src/core/render/three/cheapmaterials.ts`) runs at Low only.

- Each unpatched `MeshStandardMaterial` becomes one `MeshLambertMaterial` (`cheapmaterials.ts:22`).
- It strips `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap` and `bumpMap` (`cheapmaterials.ts:5`).
- Patched Standards stay Standard.
- The source Standard is not disposed (`cheapmaterials.ts:60-74`). Three.js drops a program only when its material is disposed or rebuilt.
- The room probe is captured once at Low and not again (`probePlan`, `cheapmaterials.ts:119-120`).
- Mesh counts do not change. The swap changes programs. Its effect on material counts is not checked.

Effect, measured on the RTX 5080:

- Low has more compiled programs than High: 203 to 206 against 127 to 134. The cause is not tested. The leading estimate is that the source Standard programs stay in the renderer cache.
- Low is faster than High: room idle 4.3 ms GPU against 9.0 ms, with 930 against 968 calls.
- Possible cuts (not done): fold Physical into Standard; move AO to vertex colours so Low can still swap; dispose Standard after the swap.

Code inventory (grep, `03fe0bc`): 20 Standard sites, about 440 `mat()` calls, 3 Physical, 1 Lambert, 11 Basic, 13 `ShaderMaterial` plus 1 Raw, 14 patch definitions.

## Textures

- There is no atlas, KTX2, Basis, Draco or meshopt on main. `gltf.ts` is a plain `GLTFLoader`. Both shipped GLBs carry 0 textures.
- Runtime canvases carry the maps: 64 to 512 px, art tiles up to 2048 px. Anisotropy is the `filtering` option (default 8).
- Texture counts (`renderer.info.memory.textures`): High 265, Low 219 in the main scenario. Counts are per page, not per view. Textures in MB and VRAM are not measured. No tool reports them.
- The lightmap size is not settled. The lighting section gives 9.8 MB on disk. A derived unpacked RGBA8 figure is about 52.4 MiB. Docs also disagree on the atlas size (991x1153 against 994x1152).

## City culling and the Firefox occlusion gate

Culling layers, in order:

1. **Frustum, per mesh** (three.js bounds). Room, machine and city.
2. **`Sweep.cut`** (`outside/sweep.ts`). Each city mesh draws only the run of pieces from the first to the last one the frustum touches. A sweep run still draws the whole run.
3. **Car cut** (`cars.ts`). Moving cars use `reach()` on each route. Parked cars use 48 m cells with a per-car test.
4. **Occlusion query** (`outside/sight.ts`). One `ANY_SAMPLES_PASSED_CONSERVATIVE` query on the window quad. While the eye is still and the answer says hidden, the city is not drawn.
5. **Cadence** (`view.ts:108`). While the eye moves under 1 px (`HOLD_PX`), the city draws every 3rd frame (`EVERY`).
6. **Window-box crop** (`view.ts`, `setViewOffset`). The city camera is cropped to the window's screen box.

**The Firefox gate.** `sight.ts` reads the query only two frames after it ends (`age >= 2`). The code comment says Firefox blocks on a query that is not done. The gate has three effects:

- The answer is always late. A tiny window sliver can keep the whole city drawn.
- The answer counts only while the eye stands still. Any eye move clears `hidden` and redraws at once, so nothing pops.
- With a lost GL context, no call reaches the GPU.

There is no browser sniffing. No per-building occlusion exists. A tower behind another tower still draws if the frustum sees it.

Firefox numbers (desktop geo run, 4K, `bfe11c6`):

- Cutting 570k triangles at the same draws did not help. Chrome Low 9.2 to 10.5 ms, Firefox Low 19.4 to 22.3 ms. The gap is inside Chrome's about 3 ms noise.
- Hiding the city helped Firefox: Low −2.3 ms, Medium −5.9 ms. It also removed about 100 draws, so the cause is not split.

## Debug toggles (`?debug`)

The overlay is in `src/app/debug/` (`overlay.ts`, `controls.ts`, `city-layers.ts`, `stats.ts`). The toggles exist only with `?debug`. Nothing they set is saved. **Auto** turns them all off.

| Toggle | Hides | How |
|---|---|---|
| Hide city | the whole city | window quad `visible = false`, so `outsideDraws()` is false |
| Hide machine | the machine root | `setRootHidden` |
| No city lights | lamps, windows, sign light, glow, emissives | lamps hidden, sign layer moved, `key = -1` |
| No buildings | streets, buildings, land **and trees** | moved to layer 30 |
| Freeze city | clock stops: traffic, leaves, clouds, steam | `off` flag |
| No cars | cars and signal lamps | layer 30 |
| No city sky | sky dome | layer 30 |
| No glow | glow chain | `key = -1` |
| No steam | steam mesh | layer 30 |
| No mirror | room in the glass | `key = -1` |
| City 1x | not a hide: draws the city at 1 px per screen pixel instead of `SUPER` (2) | `flat` flag |

Notes:

- Layer 30 (`HIDDEN_LAYER`) is used so sweep writes to `mesh.visible` do not undo a hide. Hidden objects stay in the scene. Whether their CPU cut work still runs is not verified.
- `No buildings` cannot answer "buildings against trees". It hides both, plus land.
- `view.off` takes `lights`, `glow`, `freeze` and `flat`.
- Hide city may not subtract the city triangle count. The stats overlay still reported about 868k city triangles with Hide city on (Razr sweep).

The stats overlay shows fps, average and p95 frame time, draw calls, and city triangles and calls. City triangles are an estimate from mesh draw ranges (`city-layers.ts:36`).

## Measurement and tools

| Command | File | What it does |
|---|---|---|
| `npm run bench:3d` | `tools/bench3d.mjs` | Plays the idle views, the flights, the door, the hover, a cable, a lifted part and the running machine with the real pointer. Reports frame times, GPU time per pass, scene and shadow passes per frame, draw calls, programs, textures (count), CPU time per part, rebuilds and hot functions. |
| `npm run bench:4k` | `tools/bench3d.mjs` | 2560x1355 at DPR 1.5, Medium, `room night hover`. |
| `npm run bench:modes` | `tools/bench-modes.mjs` | Same runs in Firefox (`--firefox`) or on a phone profile. Reports only. |
| `npm run shot` | `tools/shot.mjs` | Headless Chrome on the real GPU. Flags: `--view cpu\|board\|x,y,z`, `--clip hud`, `--preset`, `--prod`, `--2d`, `--hour`, `--look`. Stops if the GL renderer is SwiftShader (unless `SOFTWARE=1`). |
| `npm run stills` | `tools/stills.mjs` | Renders parts headless to `public/stills/` with a hash manifest. |
| (no npm script) | `tools/bench-costs.mjs` | Phone sweeps (Razr, Low) used for the toggle numbers above. |

`bench:3d` flags: `--preset High|Low`, `--only "a,b"` (scenario names such as `room idle`, `board idle`, `cpu idle`, `door first open`, `running room`, `room night hover`), `--size`, `--dpr`, `--gpu <regex>`, `--need-timers`, `--no-profile`, `--baseline old.json`, `--2d`, `--lowpower`. It starts its own dev server on port 5197. `shot` uses port 5199. Both take `PORT`.

`bench:3d` does not run the city toggles. It loads `?3d`, not `?debug`. City GPU cost on the RTX is not measured.

Last RTX 5080 run (`03fe0bc`, Chrome / ANGLE D3D11, GPU timers on, Auto-adjust off):

| View | High GPU ms | High calls | High programs | Low GPU ms | Low calls | Low programs |
|---|---|---|---|---|---|---|
| Room idle | 9.0 | 968 | 127 | 4.3 | 930 | 203 |
| Board idle | 7.9 | 891 | 127 | 3.9 | 866 | 203 |
| CPU idle | 2.8 | 163 | 127 | 0.6 | 130 | 202 |
| Door first open | 9.7 | 1,057 | 128 | 4.4 | 923 | 203 |

Room idle, High: 1,715k triangles drawn, 3.16 shadow maps per frame. Low: 1,611k triangles, no shadow maps. GTAO takes about 1.5 ms of High room time. Low has no GTAO.

Program counts are cumulative per page. Textures are the same in every view (the scene is shared).

The city in the window costs 0.7 ms GPU at High and 0.1 ms at Low on the RTX (door first open minus room idle). That is a lower bound.

Razr (motorola razr fold, Low, 485x997 at DPR 2.225, frame time under the 60 Hz cap, `03fe0bc`):

| Setting | Mean fps | Avg ms | City tris |
|---|---|---|---|
| Base | 45.8 | 21.9 | 869,016 |
| No city lights | 58.6 | 17.0 | 867,109 |
| No buildings | 60.1 | 16.6 | 93,679 |
| No cars | 49.9 | 20.1 | 781,146 |
| Hide city | 59.9 | 16.7 | 868,338 |
| City 1x | 41.0 | 26.7 | 871,062 |

The same commit read 16.8 fps in a later bake session. The two sessions are not averaged. The cause is not known.

## Not on main

- **PR #23** (`perf/low-city-draws`, `3cf8755`). At Low it merges every building ring past 300 m into one mesh, and adds `lowfacade.ts`, `detail.ts` and a 96 m street cell. It cuts city triangles 864k to 452k and draws 221 to 168 on the Razr. It also changes shading, so the cut is not triangles alone. Car distances at Low are 100 m (full model) and 350 m (clip). Main has none of this.
- **Far-city cards and night-window layer.** Designed, not built. No card path exists for buildings or trees.
- **KTX2 loader.** Not present. Prerequisite: `KTX2Loader` and transcoder path in `gltf.ts`, plus a copied Basis transcoder (about 585 KB). About 60 to 90 lines (estimated).

## Known gaps

- Texture MB and VRAM are not measured. No tool reports them.
- Medium is not benched on the RTX.
- Draws per part and per case after merge are not measured at `03fe0bc`.
- Phone triangle cost with the same draws is not measured.
- Per-ring city cost is not measured.
- The cause of Low's extra programs is not known.
- The Razr sessions on `03fe0bc` read 45.8 fps and 16.8 fps. The cause is not known.
- Parked cars take the distance from the window (`cars.ts:326`). Moving cars take it from the eye (`cars.ts:422`).
