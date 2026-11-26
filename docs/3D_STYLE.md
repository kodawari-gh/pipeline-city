# Pipeline City 3D modelling and rendering guide

> Updated 2026-11-12 against `bfe11c6`; line citations re-checked 2026-11-14 against `b4caec1` (code changed since `bfe11c6`, so the measured counts below stay at `bfe11c6`). To match approved [`docs/art-style.md`](art-style.md) v3. This file replaces `docs/LOWPOLY_STYLE.md`. **The code is the source of truth**: each value below cites the file it comes from. Where the code still does the old look, this guide describes current behaviour and marks the target from art-style.md (the rework is on hold). Where the repo sets no rule, the guide says "Rule to set". Still measurements come from `public/stills/*.webp`. Triangle counts and on-screen sizes were measured headless from the models and cameras at this commit; they are today's measurements, not budgets or targets.

## Aesthetic Goals

Pipeline City's 3D renders computing hardware with **precision, clarity, and real scale**. Parts are smooth, soft-edged hardware — recognizable shapes, real sizes and fixings (`docs/PC_PARTS.md`) — not faceted low-poly. Neon arrives as light, on a **neon hacker dashboard** ([`docs/art-style.md`](art-style.md) §1). That direction is approved; the rework that would make the room and the stills match it is on hold. The owner confirmed (2026-11-12) that the current smooth detail stays; the game is not going back to low-poly.

## Look decision (owner, 2026-10-31)

**Current (code, from the 2026-10-31 decision):** stylised warm, smooth soft-edged hardware (the "not strict low-poly" turn of 31 Oct; the models have been smooth since). The room as built is a warm wood-slat wall, a desk with drawers, a drum lamp, a sunny or night city window, a wall clock, a rug, a glass-side RGB PC. Soft edges (rounded boxes), warm light (sky fill, sun or moon through the window, the lamp's spot), soft shadows and ACES tone mapping. The state looks (emissive overlays, outline) stay as written below.

**Target (art-style.md §1 and §3, rework items 1–2, on hold):** a neon hacker dashboard, not a cozy warm desk scene. Soft edges, ACES, and the state looks stay. Lighting and room surfaces change as marked under Lighting Setup.

**Aligned 2026-11-12.** [`art-style.md`](art-style.md) v3 is the core direction. Owner calls made before it are superseded where they conflict with it: the 2026-10-31 "stylised warm" look, the warm wood room (2026-10-31 reference image), the "cozy lit room, many warm lamps" call (2026-11-05, T149), and the wood as the one warm material (2026-10-26). Kept from those calls: soft edges, realistic light only, no fill light, room first, RGB and neon accents. The 2026-11-06 PC palette keeps its violet, but as the palette's brand violet `#a68bff` (§2, "one set").

## Colour decisions (owner, 2026-11-12)

- **Radiators follow the dark default** (target mean still luminance 60–100). Current: `rad1–3` stills are satin aluminium (measured `#9da2ac`, `#818695`). Target (art-style.md §4, rework item 9, on hold): rework to 60–100.
- **Light parts are no longer exceptions.** Current: `case0`, `hdd0`, `ram1` and `cooler1` are light (cream or bright aluminium) because that is how the hardware is modelled today. Target (art-style.md §4, rework item 4, on hold): each gets a dark or anodised variant and must meet the dark default (mean still luminance 40–100). Material specs are in art-style.md §4.

## Inspiration

- **Poly Haven** models (clean topology, clear silhouettes)
- **Marmoset Toolbag** renders (soft studio key + rim, bold materials)
- **Current, the room as built:** a cozy lit room in a photograph (warm lamps, a cool window; the owner, 2026-11-05). **Target (art-style.md §1 and §9, rework item 1, on hold):** a neon hacker dashboard — near-black navy, information glows, hardware stays real.
- **Technical diagrams** (accuracy > decoration)

## Modeling Rules

### How parts are built

- **Parts are procedural.** Every PC part is built in TypeScript from three.js geometry (`src/features/board/render/three/*3d.ts`), at **23 units per mm** (`monitor3d.ts:12`, `layout.ts:151`, `docs/PC_PARTS.md`). The room is at **18.7 units per mm** (`chair3d.ts:14`, `props3d.ts:204`).
- **Imported models** are the exception: `public/models/hoodie.glb` (cloth bake, `hoodiecloth.ts`) and `public/models/mouse.glb` (the owner's model, converted with obj2glb).

### Measured triangle counts (today, not targets)

These are drawn-triangle counts from a headless build of the showcase models, the room, a maxed machine, and the city outside the window, at `bfe11c6`. They are **reference measurements**, not budgets. Nothing in the repo checks them. The previous "low-poly" budget table (CPU/GPU 200–600, board 1,000–2,000, room 2,000–5,000) was never measured and is 10–100× below what the models actually draw.

**By part kind** (showcase model, drawn tris):

| Kind     |   n |     min |  median |     max |
| -------- | --: | ------: | ------: | ------: |
| case     |   4 | 213,954 | 259,056 | 333,206 |
| board    |   4 |  49,812 |  58,468 |  90,760 |
| gpu      |   3 |  34,274 |  45,706 |  56,578 |
| cooler   |   3 |   6,972 |   8,072 |  48,908 |
| storage  |   4 |   2,502 |   5,458 |  34,588 |
| nic      |   3 |  17,064 |  24,016 |  33,300 |
| fan      |   7 |  26,376 |  27,528 |  28,840 |
| npu      |   2 |  21,890 |  21,890 |  23,390 |
| display  |   2 |  16,938 |  16,938 |  16,938 |
| vrm-sink |   3 |   2,588 |   3,044 |  10,304 |
| psu      |   5 |   3,134 |  10,200 |  10,200 |
| tpm      |   2 |   7,518 |   7,518 |   7,518 |
| ram-sink |   3 |   2,588 |   3,044 |   6,104 |
| ram      |   7 |   2,594 |   2,996 |   5,540 |
| radiator |   3 |   5,028 |   5,028 |   5,028 |
| cpu      |  16 |   4,000 |   4,284 |   4,284 |

The heavy outliers are `cooler1` (48,908: four `TubeGeometry` 220×16 heatpipes) and `nvme2` (34,588: a 179×68 draped-label plane). At Low the cooler's heat pipes are 40×8 and the NVMe label is one flat quad (`byDetail`, `nvme3d.ts`). Fan housing cost is dominated by two `fanFlange` extrusions at `curveSegments: 48` (10,432 tris each).

**Scenes and imports:**

| Scene or file             | Drawn tris | Unique tris | Notes                                                                       |
| ------------------------- | ---------: | ----------: | --------------------------------------------------------------------------- |
| Room                      |    237,638 |     222,174 | Includes the duvet (33,248), three large lathes, 60 furniture rounded boxes |
| Maxed machine             |    845,840 |     710,936 | 1,440 meshes; eight 25,088-tri fan housings; three 24,344-tri nvme drapes   |
| City (outside the window) |  3,643,156 |   3,374,580 | Larger than the room and the maxed machine together                         |
| `hoodie.glb`              |     15,070 |      15,070 | Imported cloth bake                                                         |
| `mouse.glb`               |      1,198 |       1,198 | The owner's model                                                           |

### Modelling rules

These match the code as it is built today. Detail should go where it reads: the **silhouette**, and **edges that catch rim light or neon**. It should not go into tessellation on flat faces, or into high segment counts on features that are a few pixels across.

- **Soft edges.** Boxes are `softBox` = `RoundedBoxGeometry(w, h, d, 2 segments, radius 40 default)` (`src/core/render/three/geometry.ts:71-79`). Furniture boards use the same idea at a larger radius: `EDGE_R = 120`, `EDGE_STEPS = 4` (`furniture/shapes.ts`). Part extrusions typically bevel with `bevelSegments: 1` (e.g. `gpu3d.ts:66`). No hard 90° box edges on parts. A fillet that is narrower than about 2 px on screen does not need more than one or two segments.
- **Round parts need enough sides to look round at their typical on-screen size.** A circle looks round at about **one side per 4–8 px of circumference** (the silhouette still facets even when normals are smooth). Examples of what the code uses today: fan flanges `curveSegments: 48` and a venturi lathe of 72 (`geometry.ts:222`, `fans3d.ts:67`); fan RGB rings `TorusGeometry(..., 8, 72)`; GPU fan ducts 64 sides and rim rings 96 sides (`gpu3d.ts:109`); default cylinders `post` 16 / `drum` 24 (`geometry.ts:86-93`); cooler heatpipes `TubeGeometry` tubular 220, radial 16 (`cooler3d.ts:125`). Several of those counts are denser than the pixels at board and room size — see the visible-detail assessment. New round parts should be sized for the views in Camera & Framing, not for an unmeasured "high poly" or "low poly" budget.
- **Fine flat detail is baked 2D, not modelled.** Traces, vias, labels and die floorplans are drawn onto the surface by the Pixi baker (`bake.ts`), not built as geometry. Real 3D detail, not 2D art, belongs on box sides (`docs/PC_PARTS.md` pass 4). A tessellated plane used only to drape a label (`drape(..., step=7)` in `pcbkit3d.ts:278`, 24,344 tris on `nvme2`) is the wrong tool for this: the same idea should use a step large enough that a quad is a few pixels in a close-up, or a normal map, not a 179×68 mesh.
- **Smooth normals.** Parts and imported models use smooth vertex normals (`MeshStandardMaterial` default; both glbs carry `NORMAL`). **Flat shading is only for the tiny exceptions that already exist:** the cooler's hex standoffs and knurled nuts (`steel(true)`, `cooler3d.ts:137-138`) and the plant-pot bark chips on the soil (`plants3d.ts:314`). Do not introduce new flat-shaded hardware.
- Simplify sub-parts only below what reads at the size they appear; real fixings stay (screws, standoffs, fan clips, push pins; `docs/PC_PARTS.md` pass 3). Keep the PCB rectangular; flatten diagonal components.

### Per-tier detail and LoD

Decided 2026-11-16 (delegated by the owner). The scheme (LOD0, LOD1, LOD2, stand-in, card) and its numbers are in [render/lod.md](render/lod.md#the-scheme).

- A part's lower level is the same builder at a lower `level`: fewer sides (4 to 8 px per side at its switch), no feature under 2 px, its outline within 1 px of LOD0 (`lodreach.test.ts`). No mesh simplifier, no hand-made model.
- Only the room overview's stand-in draws LOD1. No per-part swap nearer: the frame is CPU bound, and a swap adds draws to save triangles.
- Graphics quality tiers change textures, particles, lights, AO, shadows, resolution and FPS (`TEXTURE_LEVELS`, `PARTICLE_LEVELS`, the lamp cap, scale and frame limit). They do not choose a level. The Low preset also drops segment counts and merges parts, and paints big sheets at half size (`lowDetail()`, `sheetCut`; see `docs/render/three.md` "Levels of detail" and `docs/render/load.md` "Build my PC texture memory at Low").
- `DEVICE_LOD` / `artlod.ts` fade the chips' art and its texture resolution with zoom (the reveal bands), not triangle density.
- The far city would get flat cards where parallax is under 1 px (LOD-04: not built, decided 2026-11-17, `docs/render/lod.md` "The card").

### Silhouette & Recognition

Each part must be **instantly recognizable** from any angle, including at shop-tile size (120 × 84). The silhouette and the edges that catch the rim or a neon highlight do that work. Soft edges and enough sides on round parts (above) are the means; a faceted "low-poly" reading is not the goal.

### Topology (imported models)

- Triangulated, with normals. Export smooth normals (both current files carry `NORMAL`).
- UVs present when a map is used (`hoodie.glb` has `TEXCOORD_0`; `mouse.glb` has none and takes one flat colour).
- Name each material for the role code maps it to (`hoodie.glb`: `knit`, `rib`). No Blender default names (`mouse.glb` has `Material.001`…: rule to fix on its next export).
- Author in millimetres, y up (`hoodie.glb`); code sets the scale.

## Color & Material System

### Hue Assignments

**Measured base colours by component type** (median-cut over the opaque pixels of each family's stills, top colours; these are lit colours as rendered, not material inputs):

| Type                        | Hue                                  | Measured (stills)                                                                                                                                                                   |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU package / die           | Navy package, blue die blocks        | `#2e344e`, die `#2b4877` / `#557a98`, pins gold                                                                                                                                     |
| GPU (shroud)                | Charcoal                             | `#313338`, `#212326`                                                                                                                                                                |
| RAM (green PCB)             | Green                                | `#32875b` (ram0)                                                                                                                                                                    |
| RAM (heat spreader)         | Charcoal or silver                   | `#2a2d33`; silver `ram1` (current exception). Target (art-style.md §4, rework item 4, on hold): dark anodised clip-on, same family as today's DDR3 fins (`#2b2f37`, `ram3d.ts:205`) |
| SSD / NVMe                  | Dark grey + label                    | `#4d525e`, `#41444a`                                                                                                                                                                |
| PSU                         | Near-black                           | `#242425`, `#1c1c1e`; gold stripe `#e3cc71` (lit gold; the one gold is `#d4af5f`, art-style §2)                                                                                     |
| Motherboard                 | Mask by tier                         | green `#3d6957` (board0), blue `#2b406c` (board1), black `#1d2023` (board2-3)                                                                                                       |
| Heatsinks (VRM, RAM, rsink) | Black anodised                       | `#222428`                                                                                                                                                                           |
| Cooler                      | Aluminium, satin blue-grey           | `#adb2bd` (cooler1, current exception, measured), pump `#647293` (cooler2). Target (art-style.md §4, rework item 4, on hold): dark anodised fins `#2a2d32`–`#4e5360`                |
| Radiator                    | Satin aluminium → **to rework** dark | now `#9da2ac`, `#818695`. Target (art-style.md §4, rework item 9, on hold): mean luminance 60–100                                                                                   |
| NIC                         | Teal PCB                             | `#3a829e`                                                                                                                                                                           |
| Fans                        | Dark plastic                         | `#3a3a3e`; violet pads `#7a5cc8` on `*x` (current, `fans3d.ts`; not in art-style §2; target brand violet `#a68bff`, rework item 8, on hold)                                         |
| Cables                      | Dark grey                            | not in stills (rule to set)                                                                                                                                                         |

Saturated colour belongs to a PCB, the die art, or one small accent per part (a stripe, pads, a band).

**Gold and copper (material inputs, not still measurements):** Current gold literals are `#d9b25e` (`boardmodel3d.ts:31`, `ram3d.ts:126`, `wires3d.ts:159`, also `casedetail3d.ts:256`, `rj45jack3d.ts:23`) and `#d8b264` (`pcbkit3d.ts:310`). Target (art-style.md §2, rework item 8, on hold): one gold `#d4af5f` (`--pin`). Copper is already one value: `#c0793a` (`COPPER`, `cooler3d.ts:26`).

### Material Properties

**All parts use PBR** (`MeshStandardMaterial`):

```text
Default (materials.ts `mat`): metalness 0.05, roughness 0.65
Range in use on parts: metalness 0.0–1.0, roughness 0.03–1.0
  e.g. gold contacts 1.0 / 0.24 (pcbkit3d.ts:310), polished cap 0.95 / 0.14 (cooler3d.ts:343),
  radiator satin alu 0.45 / 0.28–0.42 (cooler3d.ts `radAlu`), case glass 0 / 0.03 (case3d.ts:50), printed art 0 / 1.0 (artlod.ts:170)
Cloth (materials.ts `cloth`): MeshPhysicalMaterial, roughness 0.92, sheen 1
Emissive: 0x000000 (overridden by state: powered, active, throttled, burnt)
```

### State Effects (Emissive Overlays)

From `src/core/render/three/materials.ts` (`GLOW`, `partLook`):

**Powered On (idle):** emissive 0, colour unchanged.

**Powered Off:** emissive 0; base colour × 0.5 (darken, not desaturate).

**Running, running hot, throttled:** no glow, colour unchanged (decided 2026-11-21, at Khalil's request: the state glow was never asked for). A part's look follows only its power and a burn: `PartState` is `{ powered, burnt }`. What a part does shows elsewhere: the board's lit traces for traffic (`BoardLive3D`), the airflow lens for heat (`air/`, the `thermal()` view), the power lens for draw (`electric()`).

**Burnt / Failed:** emissive 0.8, red `#ff5a78` (`GLOW.burnt`); base × 0.3. (No overlay texture in code.)

A part's glow in a lens scales by its `gain` (wide faces glow softer).

**RGB and accents (in-game; stills are currently unpowered — see Animation):**

- GPU fan ring: `glowMat(0x3be3ff, 0x1d6f80)`, `fixed: 0x3be3ff` (`gpu3d.ts:212-214`).
- Tower cooler accent `ACCENT.tower = 0x3be3ff`: two accent lines on the top cover (`cooler3d.ts:263`) and its fans' fixed ring.
- Case strip by machine state: idle/working `T.alu` (cyan; working breathes), halt `T.ld` amber, error/dead `T.bad` red (`case3d.ts:98`).
- Case accent by kind: gamer `T.mul` violet, show `T.br` magenta, other kinds `T.alu` cyan (`case3d.ts:133`).
- Board RGB strip: 44 LEDs fading `T.alu` cyan → `T.br` magenta (`boardmodel3d.ts:68`).
- Tier-3 part glow: base `0x1a1430`, emissive the skin's accent, 0.9 (`parts3d.ts:75`).
- Brand / RGB (current): `#8b5cff` on the RGB point light, the spill and the accent colour (`machine3d.ts:117,122,125`) and on the fan ring. Target (art-style.md §2, rework item 8, on hold): `#a68bff`.

`T.ld` is also the load instruction-class token, and the POST display uses it as "the theme's amber" (`boardmodel3d.ts:54-56`). Target (art-style.md §2, rework item 3, on hold): load becomes `#9ab8ff`. A token-only swap would recolour the halt strip and the POST digits, and the many 2D `T.ld` warn/activity uses (die, uncore, disk, …), unless those move to status `--warn` `#ffc247`. The same applies to `T.st` where it is used as a status-like green rather than the store class.

### Outline / Selection

**When selected or hovered** (`src/core/render/three/post.ts:66,212`):

- three.js `OutlinePass` (`PickOutline`, with the scene depth so hidden edges show dimmer)
- Visible edge `#ffff00`, hidden edge `#8a7a00`
- `edgeThickness` **1.5**, `edgeStrength` 4
- Hover ring on the board is neutral, selected cyan, tutorial target yellow (`docs/UI.md`).

## Lighting Setup

The room is lit from its window, as a real room is (`src/features/room/light.md` "3D room light"):

- **Key:** the sky's light and the sun come in by the window only, with shadows. The room falls off away from it. On the still meshes the window's light is baked whole (`tools/bake/`; `public/bake/room/`, RGBM-sqrt, 50 texels/m, 16384 samples); a live spot stands in for it only on what moves.
- **Bounce:** the bake's lightmaps (`LightmapMix`, each light group by its live level) on the still meshes; a light probe of the room on what moves, and the reflections. No flat fill lights a face from nowhere.
- **The eye:** it adapts to the room (`src/features/room/light.md` "The eye"): the exposure, and a local adaptation that lifts the dark parts and holds back the window.
- **One rule:** in the room view every part takes the same light. Only real emitters glow (the screen, the lamps, the RGB), and they light what is near them.
- **Lamps:** Current: at night, warm lamps (2700 to 3000 K; `LANTERN = kelvin(2700)`, `palette.ts:49`; some fixtures `kelvin(3000)`, e.g. `room3d/parts.ts`, `furniture/walls.ts`) and a few cyan accents (`NEON #3be3ff`, wash `NEON_WASH #8fd9e6`) light the room. The lamp cap follows `LIGHT_ORDER` (`roomlights.ts:18`): key, sun, arc, desk, floor, bedside, sconces, screen, then the neon fixtures last (`deskLed`, `picture`, `ledHalo`, `ledUnder`, `bias`, `strips`). At cap 4 (Low) and cap 8 every neon light is capped; their fixtures still glow and their baked bounce shows ×2.5 (`CAPPED_BOUNCE`, `roomlights.ts:36`). The lamp cap: `src/features/room/light.md` "The lamp cap". Target (art-style.md §3, rework item 1, on hold): the window (moon, city) and the neon fixtures define the room; warm lamps are practical pools, not the fill; order neon fixtures before the warm lamps in `LIGHT_ORDER`. `LANTERN = kelvin(2700)` stays for practical bulbs only.
- **Room surfaces:** Current: smoked oak and ash veneer. `OAK #665540` / `OAK_GRAIN #38291c` (`palette.ts:15`), `smokedOak` (roughness `OAK_ROUGH` 0.68, `furniture/oak.ts`) for the floor (`room3d/planks.ts`), the desk top (`room3d/desk.ts`) and the bookcase (`furniture/bookcase.ts`); `VENEER #2f2a26` / `VENEER_GRAIN #1c1815` (`palette.ts:10`) at roughness 0.5 (`furniture/`, `room3d/desk.ts`) for the bed, nightstand, shelf and drawer unit; walls `WALL #3a404c` at roughness 0.92 (`palette.ts:8`); ceiling `CEILING 0x4a4f59` at roughness 0.95 (`palette.ts:8`); trim `TRIM 0x3d424c` (`palette.ts:8`). Target (art-style.md §3, rework item 1, on hold): charcoal and graphite, not wood. Floor / desk / bookcase `#1d1e22` (grain `#04060f`); veneer furniture `#2a2d32` (grain `#1d1e22`); walls and trim `#2a2d32`; ceiling `#4e5360`. Specs in art-style.md §3. The terracotta runner (`RUNNER #7a4434`, `palette.ts:19`) may remain as a small warm practical.
- **Board view:** the same light as the room; no studio light.
- **Post:** GTAO (blend 0.85, half size per axis, depth-aware upsample in `AO_UPSAMPLE`, `post.ts:190`; on at Medium and High), bloom (radius 0.4, threshold 1.2, strength 0.5 at the top level; `BLOOM_LEVELS` `[0, 0.3, 0.5]`, `post.ts:183,218`), ACES (`init.ts:21`).

### Studio (shop stills and the gallery viewer)

From `src/core/render/three/viewer.ts` `studio` / `renderStill`:

**Current:**

- ACES filmic, exposure 1.6; `RoomEnvironment` reflections at intensity 0.55; ambient `#ffffff` 0.25.
- Key `#fff0dc` × 2.4 at (+1.5r, +2r, +1.2r) from the part's centre, PCF shadows (2048² for stills); rim `#9ab8ff` × 1.2 at (−2r, +r, −1.5r).
- Floor disc `#1a1d26` in the gallery; hidden in stills (transparent background, no ground shadow).
- Build mode uses a dimmer copy: ambient 0.12, hemisphere `#bfd0ff`/`#1a1410` 0.3, key `#fff0dc` 0.9, rim `#8fb0ff` 0.45, and a warm point `#fff1dd` × 1.0 (`buildmode3d.ts:157-162`).

**Target (art-style.md §3, rework item 5, on hold):** a cool white key (`#9ab8ff` family) replaces `#fff0dc`; the rim is neon, cyan `#3be3ff` or violet `#a68bff`, one per shot. Exposure and ACES stay. Build mode follows the same cool key; the hemisphere ground goes toward `#04060f`.

## Camera & Framing

The 3D camera is a perspective orbit whose **distance follows from the world height it shows and the FOV** (`src/core/render/three/camera.ts:14`, `distanceOf`). `init.ts:39` constructs the camera at FOV 30°, near 50, far 200,000; **every game view then overwrites FOV via `applyView`**. The live values are below. Heights were measured at 1920 × 1080 with `viewInset` 0 (the title screen, and the exact `fitRect` / `inFree` math). In a running game the HUD sets `viewInset` (`Hud.tsx` `InsetReporter`) and the same rect is fitted to a smaller free area, so a given object is slightly smaller on the full 1920 × 1080 frame; those inset pixels were not measured.

### Room overview

`board3d.ts:58` `ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 }`; `:64` `LOOK_Z = 5000`; `:221` `roomRect()`; `:246` `overview = keepWhole(inFree(roomRect(), LOOK_Z, ROOM_ANGLE, 0.9), ...)` (`keepWhole` is `keepInside` that slides a target out of the desk's shadow, `docs/render/interact.md`). `keepInside` (`board3d.ts:231`, `camera.ts:114-126`) may widen FOV from 26 up to 40 to hold the height from closer. Measured: FOV **28.73°**, height **31,578**, distance **61,650**, **0.034 px per world unit** at the target plane. The mid-tower case (after `setLayoutTier(2)`) is 11,890 × 10,720, depth 4,500; a 120 mm fan (2,760 units) is **97 px** across at the front of the case in this view.

### Machine mid-shot

There is no separate sandbox camera. `board3d.ts:811` `caseView(yaw=0, pitch=0.09, margin=0.85)` frames `CASE` at `CASE_Z + CASE_D/2` with FOV 26. It is a shot-tool helper, not a named player preset, but it is the natural mid-shot between the room and the board (the player can zoom to it continuously). Measured: FOV **26°**, height **12,612**, distance **27,314**, **0.086 px/unit** at the case mid-plane. The same 120 mm fan is **258 px** across at the front of the case.

### Board view

`board3d.ts:59` `FLAT = { yaw: 0, pitch: 0, fov: 14 }`; `:250` `boardView = inFree(CASE_IN, BOARD_Z, FLAT, 0.95)`. Measured: FOV **14°**, height **10,589**, distance **43,122**, **0.102 px/unit** at the board (`BOARD_Z = 2,460`). `CASE_IN` is 11,560 × 10,060. The same 120 mm fan is **312 px** across at the front of the case. A CPU-die close-up (`:235` `cpuView`, frames `DIE` at `BOARD_Z + 200`) has height **833** and **1.30 px/unit**.

### Studio / stills and the gallery

- **FOV:** 28°; start view yaw 0.6, pitch 0.4 rad (`viewer.ts:32`).
- **Framing:** `frameView` sets height to the part's largest bbox side × 1.05 × zoom (`viewer.ts:39-41`). `renderStill` then scales so the projected bbox corners fill `STILL_FILL` 0.9 of the tile (`:33,122-129`).
- **Stills size:** 480 × 336 px (a 120 × 84 shop tile at 4×; `tools/stills.mjs:19`). Measured silhouette fill 0.66–0.86, median 0.81.
- **Gallery:** `.gal-main` is `inset: 0` since 2026-11-18: the stage fills the screen under the glass panels, and `Viewer.setInsets` keeps the part clear of them (`docs/UI.md` "Studio screens"). The earlier figures (a 1,661 × 926 stage at 1920 × 1080, a 120 mm fan about 863 px across) were for the old inset stage and are not re-measured. Zoom defaults to 1 and ranges from 0.06 to 2.5 (`VIEW_LIMITS`).
- **Shop preview:** `.showcase-host` is 16 rem tall (259 px at that font size, `ui.css:849`); its width is the shop detail column (not measured).
- **Near/Far:** hug the part (`aim` in `viewer.ts`).

## Texture & Baking

### Baked Elements

- **PCB traces, labels, die floorplans:** 2D art drawn by the Pixi baker (`src/features/board/render/three/bake.ts`, `src/core/render/three/artlod.ts`) onto the part's faces at runtime, in the dark theme's palette (`theme.ts` `builtinTheme`).
- **Small tiling maps:** procedural canvas textures (e.g. radiator fin ladder 64 × 64, `cooler3d.ts:64`; hoodie rib 64 × 64, `chair3d.ts:22`).
- **Room light:** baked lightmaps, 994 × 1152 per light group (`public/bake/room/`, `tools/bake/`).
- **Shop stills:** `npm run stills` (`tools/stills.mjs`) → `public/stills/<id>.webp` + `manifest.json`; bake again after a part's model changes.

### UV Strategy (imported models)

- **Margins**: 4 pixel gutter between islands
- **No stretching**: even texel density
- **Seams hidden**: at back/underside of parts
- (Not checked by any tool; rule to set if more models are imported.)

## Animation & Motion

### Idle/Powered State

- **Fans**: constant spin (RPM → rotation speed, scaled by load/temp)
- **Cables**: static
- **Glow (in-game, powered):** no state glow (`partLook` returns emissive 0 for every powered part that has not burnt, `materials.ts`), idle or running. Built-in RGB, strips and rings still emit.
- **Stills:** Current: `renderStill` does not power the part (`viewer.ts:110-137`); stills are unpowered and show no state glow. Target (art-style.md §4, rework item 6, on hold): stills show powered-on idle emissives (LEDs, strips, rings at their idle level), with no active or heat glow.

### Active/Computation

- **Bus traces**: a short bright packet runs the lanes between two parts that talk, the trace lit behind it for a moment (`BoardLive3D`, docs/render/live.md "Activity"; kept cheap, see "Performance" there)
- **Heat**: no glow and no haze on the part; the airflow lens shows it
- **Fan speed**: ramp up/down (not instant)

### State Transitions

- **All state looks** (power, burnt, and the lenses' views): eased over about 0.5 s (`PartSkin.frame`, `1 - 0.002^dt`).
- **Selection**: outline fade not set in code (rule to set or drop).

## Dark Mode & Light Mode

### Dark Theme (default, and the only target theme)

- **Background**: Current: `--bg #04060f` (`ui.css:15`, `theme.ts:15`); the page's pre-CSS background is `#0b0f14` (`index.html:10`). Target (art-style.md §2 and §7, rework item 11, on hold): `#04060f` is the only page background.
- **Board**: `#081628`
- **Accents (current):** full saturation (`--alu #3be3ff`, `--mul #a68bff`, `--ld #ffc247`, `--st #6dffa6`, `--br #ff55dc`, `--bad #ff5a78`) (`ui.css:17`, `theme.ts:17`). `--ld` and `--st` currently share their hues with status `--warn` and `--ok`. Target (art-style.md §2, rework item 3, on hold): instruction classes get their own hues. ALU, MUL and branch stay. Load `--ld` / `T.ld` becomes `#9ab8ff`. Store `--st` / `T.st` becomes `#a8ff55` (new). Status `--ok #6dffa6`, `--warn #ffc247` and `--bad #ff5a78` stay. See the note under State Effects on other `T.ld` / `T.st` uses.

### Light Theme

**Current:** a second, living theme. Background `#eaeff6`, board `#9ccdbd`, darker less-saturated accents (`--alu #0786ab`, `--mul #6a49e0`, `--ld #c47600`, `--st #0f9a53`, `--br #c4259f`, `--bad #c81e3e`) (`ui.css:3-13`, `theme.ts:19-23`). `:root` defaults to the light tokens; dark is `data-theme="dark"`. The 3D world's baked art always uses the dark palette (`builtinTheme()`, `theme.ts:33`). Lighting does not change with the theme.

**Target (art-style.md §7, rework item 11, on hold):** the light theme is dropped. Dark is the only theme. No Light control, no `theme` value `'light'`, no light-theme tokens as a living palette.

### Transition

- **Current:** keep the `data-theme` binding; 2D/3D read the theme via `readTheme()` and `onThemeChange` (`theme.ts`). Settings and the HUD still offer a Light toggle (`MainMenu.tsx:72-73`, `Hud.tsx:270-272`).
- **Target (art-style.md §7, rework item 11, on hold):** that toggle and the light path go away.

## Quality Checklist (Per Part Model)

- [ ] Recognizable silhouette at shop-tile size (120 × 84)
- [ ] Real size at 23 units/mm, real fixings (`docs/PC_PARTS.md`)
- [ ] Soft edges (`softBox` / 1-segment bevels), no hard box edges; round parts have enough sides to look round at the size they appear (Camera & Framing)
- [ ] Materials from the measured table; saturated colour only on PCB, die art or one small accent. Target (art-style.md §2 and §4): hexes from the art-style palette; `case0` / `hdd0` / `ram1` / `cooler1` follow the dark or anodised specs (rework item 4, on hold). No `#8b5cff`; brand / RGB uses `#a68bff` (rework item 8, on hold).
- [ ] Still re-baked (`npm run stills -- --only <id>`): 480 × 336, fill 0.66–0.86, mean luminance ≤ 140. Current: `case0`, `hdd0`, `ram1` and `cooler1` exceed 140 and are treated as exceptions. Target (art-style.md §4 and §11, rework items 4–6, on hold): those four meet the dark default 40–100; stills use the cool key and one neon rim, and show powered-on idle emissives only. C1 on an emissive-off render: ≤ 3.3 % px with S > 0.4 (non-PCB parts).
- [ ] Emissive only where real hardware has light; colours from art-style.md §2 neon and status roles. (Target; rework item 6, on hold.)
- [ ] Zoom continuity (art-style.md §5): die and board glow and motion match the 2D interior. (Target; rework item 7, on hold.)
- [ ] One distinct still per product (no duplicate hash in the manifest)
- [ ] Outline renders correctly when selected
- [ ] Colour changes when powered off / overheating
- [ ] Rotates smoothly (no z-fighting, no flicker)

## Asset Export Checklist

**Before committing an imported model to `public/models/`:**

1. **Export**: glTF 2.0 binary (`.glb`); include normals; UVs if a map is used. Then run `npm run bake:models`: meshopt with quantization ("Size and compression rule" below).
2. **Naming**: short lowercase noun, `<thing>.glb` (as `hoodie.glb`, `mouse.glb`).
3. **Size**: a room model at most 200 KB, a part model at most 60 KB a LOD (`bake:models` fails over 200 KB). Current: `mouse.glb` 18.6 KB, `hoodie.glb` 175 KB.
4. **Test load**: `loadModel()` succeeds, no console errors.
5. **Visual test**: `npm run shot` in the room or board view (`CLAUDE.md`).

### Size and compression rule

**Status: accepted 2026-11-16 (a delegated decision: the owner gave the trade-offs between cost and look to the graphics lead).** It is the rule of items 1 and 3. `npm run bake:models` (`tools/bake/models.mjs`) applies it and fails over the budget.

- **Geometry: meshopt** (`EXT_meshopt_compression`, with quantization), not Draco. Draco files are smaller, but its decoder is 345 KB (wasm and wrapper) against 29 KB for meshopt (`meshopt_decoder.module.js`, already in three). With two models, Draco saves 62 KB of files and costs 316 KB more decoder. Meshopt also decodes faster and needs no worker.
- **Size budget, per file on disk:** a room model at most **200 KB**; a part model (one LOD) at most **60 KB**; all of `public/models/` at most **1 MB**. A test would hold these (J).
- **Textures in a model:** KTX2 only. Colour and other sRGB maps in **ETC1S**; normal maps in **UASTC**; each map at most 512² (J). This matches Asset standard §6.
- **Tool:** `gltf-transform meshopt --level medium` in the bake script, so a re-export keeps the rule.

Measured effect (bytes; `gltf-transform` 4, 2026-11-15; "br" is the brotli transfer size):

| File         | Today   | br      | Quantized only | br      | Meshopt | br      | Draco  | br     |
| ------------ | ------- | ------- | -------------- | ------- | ------- | ------- | ------ | ------ |
| `mouse.glb`  | 46,800  | 13,363  | 30,200         | 10,856  | 19,076  | 10,010  | 10,652 | 7,173  |
| `hoodie.glb` | 418,444 | 249,011 | 320,644        | 168,789 | 179,396 | 132,275 | 72,932 | 67,868 |

Both files ship with meshopt since 2026-11-16 (`hoodie.glb` 179,396 bytes, `mouse.glb` 19,076) and meet the 200 KB budget; the loader has the decoder (`setMeshoptDecoder`, `gltf.ts`). The quantized hoodie was checked on a real-GPU room shot, before and after: 40 of 122,100 pixels of the chair differ by more than 8 of 255. Its `TEXCOORD_0` is not quantized (out of the 0 to 1 range). Not measured: decode time.

The map cap has two exceptions, both baked from painters and not held in a model: the room's floor (1024²) and its rug (1024×768), the two largest surfaces seen close.

## Asset standard

**Status: approved by Khalil, 2026-11-14 (LPC1), as drafted.** Tasks ASR1–ASR10, ASK1–ASK3, LOD1 and LODD1–LODD3 cite a section of this standard. Items marked (J) are judgements, not measurements. Until the owner approves, a cited value is a proposal.

### 1. Material families

Real material families only. A part uses these hexes, plus pure black or white at alpha below 1 for shading. Source: [art-style.md](art-style.md) §2 and §4.

| Family                    | Hex                             | Use                                                        |
| ------------------------- | ------------------------------- | ---------------------------------------------------------- |
| 1. Charcoal and graphite  | `#1d1e22`, `#2a2d32`, `#4e5360` | Plastic, anodised cases, dark drives and coolers           |
| 2. Satin and bright metal | `#959aa3`, `#b9babf`            | Brushed and polished metal                                 |
| 3. PCB masks              | `#131518`, `#16294d`, `#173d29` | Board and card substrate                                   |
| 4. Gold                   | `#d4af5f`                       | One gold: contacts and pins                                |
| 5. Copper                 | `#c0793a`                       | One copper: heat pipes and the cooler                      |
| 6. Nylon and PTFE         | `#d6d1c2`                       | White plastic: a standoff, a tie, a label's base (`NYLON`) |
| 7. Ceramic                | `#9a7a52`                       | A chip capacitor's body (`CERAMIC`)                        |
| 8. Laminate edge          | `#45443a`                       | A PCB's edge, side-on (`LAMINATE`)                         |

The chip body `#0d1636` (art-style §2 "Sub / chip body") is the CPU package's substrate. The room's own tones (paper, opal glass, bark, stem, soil, tea) are in `src/features/room/render/three/palette.ts`. The laminate edge is a family colour; it is not a mask.

Neon is not a family. Neon comes from emissive light only, from the status and instruction roles in art-style §2. A base colour must never be neon (art-style C1).

### 2. Material cap per case

- LOD0: at most **16** materials for the case shell and kit.
- LOD1: at most **4** materials. The machine's overview stand-in holds it (LOD-02); the case has no level of its own.
- Today (2026-11-16): 64–101 material objects and 11–16 distinct looks per case; `casemat.test.ts` holds the LOD0 cap.

### 3. Hole method

One method for patterns: a pattern of many small holes (slots, mesh, vents) is a perforation **alpha texture** (`perforation`, 256 × 444, UASTC, alpha edges), never cut as geometry. This covers the drive cage and the PSU shroud (ASR1). A single structural opening (a cage window, a screw hole, a cable cut-out) stays geometry: its outline must read near, and it costs no material (decision 2026-11-16, ASSET-02, [render/case.md](render/case.md) "The empty case"). Texture rules: [§6](#6-textures).

### 4. Segment table (ASR10)

Round parts: one side per **4–8 px** of on-screen circumference. Use **6 px** per side (J) as the design value, and clamp to the range below. Features under 2 px on screen are left out (LPC4).

| Zone                               | Rule or target                                                                       | Source |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Round fan flanges and housings     | 16 to 48 sides, by diameter; the 40 mm housing at 16 (J; was 25,088 tris, 16.5× cap) | ASR4   |
| Flange next to case walls          | 6 sides                                                                              | ASR4   |
| Teacup and bedside lantern (lathe) | 24 to 32 sides, fewer profile points                                                 | ASR7   |
| Solder joint                       | 6 sides, 3 rings (about 36 tris, was 400)                                            | ASR5   |
| Heat pipes (`TubeGeometry`)        | Under the cap; today 220 × 16, four tubes                                            | ASR6   |
| Monitor bevels                     | 10 and 6 today; one value for the room overview (J)                                  | ASR10  |
| Case and card edge bevels          | 1 to 2 segments (`softBox`)                                                          | ASR10  |
| Plugs                              | 4 today; kept                                                                        | ASR10  |
| Default `post` / `drum` / `tube`   | 16 / 24 / 7 today; set one table in `geometry.ts`                                    | ASR10  |
| RAM `curveSegments`                | 10 today; set from the table                                                         | ASR10  |

Each builder reads its count from this table. A builder does not hard-code its own count.

### 5. Budgets per view

Ceilings are today's **High** counts (`budget.test.ts`, `BUDGET`). The test fails above +5 %. A rise needs a reason in the commit.

| View                       | Draws  | Vertices  | Triangles | Note                                                     |
| -------------------------- | ------ | --------- | --------- | -------------------------------------------------------- |
| Machine and room (layer 0) | 924    | 1,172,752 | —         | Test: `budget.test.ts` (was 2,216,520 before ASR1–ASR10) |
| City (instances counted)   | —      | —         | 2,103,386 | Test: `budget.test.ts` (was 3,643,156 before ASR2)       |
| Room alone                 | —      | —         | 237,638   | Measured, no test yet                                    |
| Maxed machine alone        | —      | —         | 845,840   | Measured, no test yet                                    |
| Board view                 | to set | to set    | to set    | Owner (J) after LPC4                                     |
| Part close-up              | to set | to set    | to set    | Owner (J) after LPC4                                     |

Phones: the mobile budgets (PERF9, Review against mobile budgets) govern the draw count. Those figures are reference values, not measured limits for this game. The owner sets the phone limit (PERF9).

### 6. Textures

- City surfaces (ASK1): colour in ETC1S sRGB, normal in UASTC; the painted sizes stay.
- Tiling maps (ASK2): colour and normal maps in KTX2 after the bake; `brushed` and `grain` take a fixed seed.
- Small maps, spec-keyed labels, live canvases and `artlod` tiles stay RGBA8.
- Texture memory: the 16 MB material budget stays TBD until PERF11 reports MB.

### 7. Approval

- [ ] Owner approves this section. Until then, each blocked task marks its value as a proposal.
- Each blocked task cites the section it uses, for example "docs/3D_STYLE.md §4".

## Performance Targets

Budgets for this build are in [§ Asset standard, 5](#5-budgets-per-view). This section stays pending the Dev Lead. The previous table (board view 50–100K tris, texture memory < 16 MB, 5 ms/frame, and so on) was not re-checked and does not match today's measurements: a maxed machine alone draws 845,840 tris, the room 237,638, the city 3,643,156. Use `npm run bench:*` and `src/features/room/light.md` for performance work.

## Future Enhancements

- Subsurface scattering for plastic parts (cooling shrouds)
- Particle effects (dust). Heat haze and CPU sparks were removed on 2026-11-21 (not asked for); only a burnt part still smokes (`particles3d.ts`)
- Animated cables (sway, drape)

## Changelog

- 2026-11-21: removed the state glow (running, hot, throttled) and the heat haze and sparks, at Khalil's request; a burn keeps its charred look, red glow and smoke. The board's lit traces were made cheaper (docs/render/live.md "Performance").
- 2026-11-14: coherence pass with `art-style.md` v3 (lead doc): gold wording (no "brass"), fan pads mapped to the brand violet target, the lead doc's link fixed to this file.
- 2026-11-12: aligned the owner calls of 2026-10-26 to 2026-11-06 with `art-style.md` v3 (see "Look decision"). The room's light and surfaces are still the code of today; the targets are on hold.
- 2026-11-12: renamed from `LOWPOLY_STYLE.md` to `3D_STYLE.md`. Removed the low-poly framing (the game has been smooth, soft-edged hardware since 31 Oct). Replaced the unmeasured triangle-budget table with measured counts at `bfe11c6`. Wrote modelling rules that match the code (soft edges, sides vs on-screen size, baked 2D detail, smooth normals, where detail should go). Documented the real cameras (room 26–29°, board 14°, stills 28°) in place of the unused `init.ts` FOV 30°. Left a placeholder for per-tier geometry LoD. Performance targets deferred to Dev Lead. Current vs target on the look, the room, lighting, themes, class hues, light parts, brand violet, and stills is unchanged; the rework is still on hold.
- 2026-11-12: renamed from `LOWPOLY_STYLE.md` (the game is no longer low-poly); measured triangle counts replace the unmeasured budget table; approved by Khalil.
- 2026-11-12: updated against `bfe11c6` to match approved art-style.md v3. Current vs target on the look, the room, lighting, themes, class hues, light parts, brand violet, and stills. The rework is on hold. Fixed stale citations (`monitor3d.ts:12`, `layout.ts:151`, `buildmode3d.ts:150-155`).
- 2026-11-12: updated against `2525863` to match the code; approved by Khalil.
- 2026-11-12: cyan rule removed at Khalil's request; cyan glows and accents documented as they are in the code.
- 2026-11-12: review fixes on PR #10: room light now points to `src/features/room/light.md` "3D room light" (`GRAPHICS_3D_OVERHAUL.md` has no "Light" section); PBR ranges matched to the code.
