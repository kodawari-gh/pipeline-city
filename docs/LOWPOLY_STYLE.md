# Low-Poly Visual Style Guide

> Updated 2026-11-12 against `2525863`. **Approved by Khalil, 2026-11-12.** **The code is the source of truth**: each value below cites the file it comes from. Where the repo sets no rule, the guide says "Rule to set". Measured values come from `public/stills/*.webp` (see the art style guide).

## Aesthetic Goals

Pipeline City's 3D renders computing hardware with **precision, clarity, and real scale**. The style balances technical accuracy (recognizable shapes, real sizes and fixings; `docs/PC_PARTS.md`) with stylization (soft edges, few segments, a small palette).

## Look decision (owner, 2026-10-31)

**Stylised warm, not strict low-poly.** The target is the owner's reference image: a warm wood-slat wall, a desk with drawers, a drum lamp, a sunny or night city window, a wall clock, a rug, a glass-side RGB PC. Use soft edges (rounded boxes with few segments), warm light (sky fill, sun or moon through the window, the lamp's spot), soft shadows and ACES tone mapping. The state looks (emissive overlays, outline) stay as written below.

## Colour decisions (owner, 2026-11-12)

- **Cyan `#3be3ff` is a UI and room colour only. No cyan on parts, in any form:** base colours, printed art, stills and in-game glows (state glow, RGB rings, strips, accents). UI overlays over the 3D view (selection ring, build-mode marker) are UI.
- **Part glow colour: violet `#a68bff`** (`T.mul`; suggestion, the owner can override). It replaces cyan wherever a part glows. The code still uses cyan in the places marked **(to change)** below.
- **Radiators follow the dark default** (target mean still luminance 60-100). Light parts that are light in reality (`case0`, `hdd0`, `ram1`, `cooler1`) are allowed exceptions.

## Inspiration

- **Poly Haven** models (clean topology, clear silhouettes)
- **Marmoset Toolbag** renders (soft studio key + rim, bold materials)
- **A cozy lit room in a photograph** (warm lamps, a cool window; the owner, 2026-11-05)
- **Technical diagrams** (accuracy > decoration)

## Modeling Rules

### How parts are built

- **Parts are procedural.** Every PC part is built in TypeScript from three.js geometry (`src/features/board/render/three/*3d.ts`), at **23 units per mm** (`monitor3d.ts:11`, `docs/PC_PARTS.md`). The room is at **18.7 units per mm** (`chair3d.ts:14`, `props3d.ts:204`).
- **Imported models** are the exception: `public/models/hoodie.glb` (cloth bake, `hoodiecloth.ts`) and `public/models/mouse.glb` (the owner's model, converted with obj2glb).

### Polygon Count & Geometry

Budgets, **not measured or checked by any tool** (rule to set: a tri-count check per part, or drop the table). Measured for the two imported models: hoodie 15,070 tris, mouse 1,198 tris.

| Part Category | Tri Count | Detail Level |
|---|---|---|
| CPU / GPU | 200–600 | Medium: socket visible, die simplification |
| RAM / Storage | 100–300 | Low: basic block shape, connector pin |
| Cables | 50–200 | Very low: bezier curve + thin tube |
| PSU / Cooler | 300–800 | Medium-high: fan detail, vents |
| Board | 1000–2000 | High: trace outline, component pads |
| Room (desk/wall) | 2000–5000 | Medium: simple geometry, baked texture |

### Silhouette & Recognition

Each part must be **instantly recognizable** from any angle:
- **Soft edges, few segments.** Boxes are `softBox` = `RoundedBoxGeometry(w, h, d, 2 segments, radius 40 default)` (`src/core/render/three/geometry.ts:71`). Extrusions bevel with `bevelSegments: 1` (e.g. `gpu3d.ts:66`). No hard 90° box edges.
- Simplify complex sub-parts only below what reads at tile size; real fixings stay (screws, standoffs, fan clips, push pins; `docs/PC_PARTS.md` pass 3).
- Keep PCB rectangular; flatten diagonal components.
- Fine flat detail (traces, vias, labels, die floorplans) is drawn as 2D art onto the surface by the Pixi baker (`bake.ts`), not modelled. Real 3D detail, not 2D art, on box sides (`docs/PC_PARTS.md` pass 4).

### Topology (imported models)

- Triangulated, with normals. Export smooth normals (both current files carry `NORMAL`).
- UVs present when a map is used (`hoodie.glb` has `TEXCOORD_0`; `mouse.glb` has none and takes one flat colour).
- Name each material for the role code maps it to (`hoodie.glb`: `knit`, `rib`). No Blender default names (`mouse.glb` has `Material.001`…: rule to fix on its next export).
- Author in millimetres, y up (`hoodie.glb`); code sets the scale.

## Color & Material System

### Hue Assignments

**Measured base colours by component type** (median-cut over the opaque pixels of each family's stills, top colours; these are lit colours as rendered, not material inputs):

| Type | Hue | Measured (stills) |
|---|---|---|
| CPU package / die | Navy package, blue die blocks | `#2e344e`, die `#2b4877` / `#557a98`, pins gold |
| GPU (shroud) | Charcoal | `#313338`, `#212326` |
| RAM (green PCB) | Green | `#32875b` (ram0) |
| RAM (heat spreader) | Charcoal or silver | `#2a2d33`; silver `ram1` (exception) |
| SSD / NVMe | Dark grey + label | `#4d525e`, `#41444a` |
| PSU | Near-black | `#242425`, `#1c1c1e`; brass stripe `#e3cc71` |
| Motherboard | Mask by tier | green `#3d6957` (board0), blue `#2b406c` (board1), black `#1d2023` (board2-3) |
| Heatsinks (VRM, RAM, rsink) | Black anodised | `#222428` |
| Cooler | Aluminium, satin blue-grey | `#adb2bd` (cooler1, exception), pump `#647293` (cooler2) |
| Radiator | Satin aluminium → **to rework** dark | now `#9da2ac`, `#818695` |
| NIC | Teal PCB | `#3a829e` |
| Fans | Dark plastic | `#3a3a3e`; violet pads `#c19ce7` on `*x` |
| Cables | Dark grey | not in stills (rule to set) |

Saturated colour belongs to a PCB, the die art, or one small accent per part (a stripe, pads, a band).

### Material Properties

**All parts use PBR** (`MeshStandardMaterial`):

```
Default (materials.ts `mat`): metalness 0.05, roughness 0.65
Range in use: metalness 0.0–0.95, roughness 0.14–0.9
  e.g. radiator satin alu 0.45 / 0.28–0.42 (cooler3d.ts `radAlu`), polished cap 0.95 / 0.14 (cooler3d.ts)
Cloth (materials.ts `cloth`): MeshPhysicalMaterial, roughness 0.92, sheen 1
Emissive: 0x000000 (overridden by state: powered, active, throttled, burnt)
```

### State Effects (Emissive Overlays)

From `src/core/render/three/materials.ts` (`GLOW`, `partLook`):

**Powered On (idle):** emissive 0, colour unchanged.

**Powered Off:** emissive 0; base colour × 0.5 (darken, not desaturate).

**Active (running job, bus lit):** emissive 0.4, violet `#a68bff` (`GLOW.active`). **(to change:** the code has cyan `0x3be3ff` at `materials.ts:8`.)

**Throttled:** emissive 0.2, amber `#ffc247`; base × 0.8.

**Overheating (temp > 42 °C, full at 82 °C):** emissive 0.2–0.6 (scales with temp); colour violet → amber → red (`heatColor`; **to change** with `GLOW.active`).

**Burnt / Failed:** emissive 0.8, red `#ff5a78`; base × 0.3. (No overlay texture in code.)

A part's glow scales by its `gain` (wide faces glow softer). `GLOW.hot` `#ff5a30` is defined but not used by `partLook`.

**RGB (in-game, not in stills):** violet `#a68bff` where it was cyan; status colours stay amber `T.ld` and red `T.bad`; magenta `T.br` stays. **To change** in code:
- GPU fan ring: `glowMat(0x3be3ff, 0x1d6f80)`, `fixed: 0x3be3ff` → `0xa68bff` on a dark violet base (suggestion `0x1a1430`, as tier-3 parts, `parts3d.ts:75`) (`gpu3d.ts:212-214`).
- Tower cooler accent `ACCENT.tower = 0x3be3ff` → `0xa68bff` (`cooler3d.ts:25`; base colour at `:254`, fan ring at `:262`; re-bake the `cooler1` still).
- Case strip idle/working `T.alu` → `T.mul`; halt `T.ld`, error/dead `T.bad` stay (`case3d.ts:98`).
- Case accent by kind: gamer `T.mul`, show `T.br`, other kinds `T.alu` → copper `#c6874c` (suggestion; measured on `rsink1`) (`case3d.ts:133`).
- Board RGB strip `T.alu` → `T.br` fade becomes `T.mul` → `T.br` (`boardmodel3d.ts:68`).
- Printed part art that reads `T.alu` (die, GPU, NPU, TPM, disk, board art): check part by part; keep the `--alu` token itself, it is the UI accent.

### Outline / Selection

**When selected or hovered** (`src/core/render/three/post.ts:200-203`):
- three.js `OutlinePass` (`PickOutline`, with the scene depth so hidden edges show dimmer)
- Visible edge `#ffff00`, hidden edge `#8a7a00`
- `edgeThickness` **1.5**, `edgeStrength` 4
- Hover ring on the board is neutral, selected cyan, tutorial target yellow (`docs/UI.md`): UI overlays, not part colour.

## Lighting Setup

The room is lit from its window, as a real room is (`GRAPHICS_3D_OVERHAUL.md` "Light"):

- **Key:** the sky's light and the sun come in by the window only, with shadows. The room falls off away from it. On the still meshes the window's light is baked whole (`tools/bake/`; `public/bake/room/`, RGBM-sqrt, 50 texels/m, 16384 samples); a live spot stands in for it only on what moves.
- **Bounce:** the bake's lightmaps (`LightmapMix`, each light group by its live level) on the still meshes; a light probe of the room on what moves, and the reflections. No flat fill lights a face from nowhere.
- **The eye:** it adapts to the room (`src/features/room/light.md` "The eye"): the exposure, and a local adaptation that lifts the dark parts and holds back the window.
- **One rule:** in the room view every part takes the same light. Only real emitters glow (the screen, the lamps, the RGB), and they light what is near them.
- **Lamps:** at night warm lamps (2700 to 3000 K; `LANTERN = kelvin(2700)`, `palette.ts`) and a few cyan accents (`NEON #3be3ff`, wash `NEON_WASH #8fd9e6`) light the room. The lamp cap per graphics tier: `src/features/room/light.md` "The lamp cap".
- **Board view:** the same light as the room; no studio light.
- **Post:** GTAO (blend 0.85), bloom (strength 0.5, radius 0.4, threshold 1.2), ACES (`post.ts`).

### Studio (shop stills and the gallery viewer)

From `src/core/render/three/viewer.ts` `studio` / `renderStill`:
- ACES filmic, exposure 1.6; `RoomEnvironment` reflections at intensity 0.55; ambient `#ffffff` 0.25.
- Key `#fff0dc` × 2.4 at (+1.5r, +2r, +1.2r) from the part's centre, PCF shadows (2048² for stills); rim `#9ab8ff` × 1.2 at (−2r, +r, −1.5r).
- Floor disc `#1a1d26` in the gallery; hidden in stills (transparent background, no ground shadow).
- Build mode uses a dimmer copy: ambient 0.12, hemisphere `#bfd0ff`/`#1a1410` 0.3, key `#fff0dc` 0.9, rim `#8fb0ff` 0.45 (`buildmode3d.ts:148-151`).

## Camera & Framing

### Game view

- Perspective camera, FOV 30°, near 50, far 200,000 (`src/core/render/three/init.ts:39`), orbit control (`camera.ts`).

### Studio / stills

- **FOV:** 28°; start view yaw 0.6, pitch 0.4 rad (`viewer.ts`).
- **Fill:** the part's bounding-box corners fill 90 % of the tile height or width (`STILL_FILL`); measured silhouette fill 0.66–0.86, median 0.81.
- **Size:** 480 × 336 px (a 120 × 84 shop tile at 4×; `tools/stills.mjs`).
- **Near/Far:** hug the part (`aim` in `viewer.ts`).

## Texture & Baking

### Baked Elements

- **PCB traces, labels, die floorplans:** 2D art drawn by the Pixi baker (`src/features/board/render/three/bake.ts`, `src/core/render/three/artlod.ts`) onto the part's faces at runtime, in the dark theme's palette (`theme.ts` `builtinTheme`).
- **Small tiling maps:** procedural canvas textures (e.g. radiator fin ladder 64 × 64, `cooler3d.ts:60`; hoodie rib 64 × 64, `chair3d.ts:22`).
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
- **Glow**: steady emissive

### Active/Computation

- **Bus glow**: brief bright flash when transferring data
- **Heat glow**: eased (see below) as temp rises
- **Fan speed**: ramp up/down (not instant)

### State Transitions

- **All state looks** (power, thermal, active): eased over about 0.5 s (`PartSkin.frame`, `1 - 0.002^dt`).
- **Selection**: outline fade not set in code (rule to set or drop).

## Dark Mode & Light Mode

### Dark Theme (Default)

- **Background**: `#04060f` (`--bg`; the page's pre-CSS background is `#0b0f14`, `index.html`: owner to choose one)
- **Board**: `#081628`
- **Accents**: full saturation (`--alu #3be3ff`, `--mul #a68bff`, `--ld #ffc247`, `--st #6dffa6`, `--br #ff55dc`, `--bad #ff5a78`)

### Light Theme

- **Background**: `#eaeff6`
- **Board**: `#9ccdbd`
- **Accents**: darker, less saturated (`--alu #0786ab`, `--mul #6a49e0`, `--ld #c47600`, `--st #0f9a53`, `--br #c4259f`, `--bad #c81e3e`)

The 3D world's baked art always uses the dark palette (`builtinTheme`, `theme.ts`). Lighting does not change with the theme.

### Transition

- **CSS**: keep the `data-theme` binding; 2D/3D read the theme via `readTheme()` and `onThemeChange` (`theme.ts`).

## Quality Checklist (Per Part Model)

- [ ] Recognizable silhouette at shop-tile size (120 × 84)
- [ ] Real size at 23 units/mm, real fixings (`docs/PC_PARTS.md`)
- [ ] Soft edges (`softBox` / 1-segment bevels), no hard box edges
- [ ] Materials from the measured table; saturated colour only on PCB, die art or one small accent; **no cyan `#3be3ff`** in base colour, printed art or any glow; part glow violet `#a68bff`
- [ ] Still re-baked (`npm run stills -- --only <id>`): 480 × 336, fill 0.66–0.86, mean luminance ≤ 140 (exceptions: case0, hdd0, ram1, cooler1)
- [ ] One distinct still per product (no duplicate hash in the manifest)
- [ ] Outline renders correctly when selected
- [ ] Colour changes when powered off / overheating
- [ ] Rotates smoothly (no z-fighting, no flicker)

## Asset Export Checklist

**Before committing an imported model to `public/models/`:**

1. **Export**: glTF 2.0 binary (`.glb`); include normals; UVs if a map is used. (Compression and quantization: not used by the current files; rule to set.)
2. **Naming**: short lowercase noun, `<thing>.glb` (as `hoodie.glb`, `mouse.glb`).
3. **Size**: rule to set. Current: `mouse.glb` 46.8 KB, `hoodie.glb` 418 KB (the old < 200 KB rule is not met or enforced).
4. **Test load**: `loadModel()` succeeds, no console errors.
5. **Visual test**: `npm run shot` in the room or board view (`CLAUDE.md`).

## Performance Targets

Not re-checked against the benchmarks in this update (`npm run bench:*`, `src/features/room/light.md`):

| Metric | Target |
|---|---|
| Poly count (board view) | 50–100K tris |
| Texture memory | < 16 MB |
| Render time (60 FPS) | < 5 ms per frame |
| Model load time | < 100 ms per model |
| Outline post-process | < 2 ms per frame |

## Future Enhancements

- Subsurface scattering for plastic parts (cooling shrouds)
- Particle effects (thermal haze, dust)
- Animated cables (sway, drape)
