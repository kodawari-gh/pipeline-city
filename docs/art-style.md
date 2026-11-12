# Pipeline City: art style guide

**Status: approved by Khalil, 2026-11-12.**

**Base:** `kodawari-gh/pipeline-city` at `2525863c5a87cf4815c3202612b1246a069324ca` (origin/main, merged 2026-11-12 10:21 UTC+1). `public/` is byte-identical to `c117331`; the 10 files that changed after `c117331` are graphics tiers and lamp cap only (`docs/UI.md`, `room/light.md`, `graphics.ts`, `roomlights.ts` …), so no art changed.
**Sources measured:** 86 stills (`public/stills/*.webp`), 12 room lightmaps (`public/bake/room/*.png`), `public/boot-still.jpg`, 2 models (`public/models/*.glb`), `src/core/ui/ui.css`, `index.html`, `src/core/render/theme.ts`, `src/features/room/render/three/palette.ts`, `src/core/render/three/viewer.ts` (still studio), `src/core/render/three/post.ts`. **Source of truth: the code.** Modelling, material and lighting rules: [`docs/LOWPOLY_STYLE.md`](LOWPOLY_STYLE.md) (updated 2026-11-12 to match the code). `docs/UI.md` "Look" was read for context only.
Values marked *(obs.)* are visual observations, not measurements.

## 1. Overview
Real-scale PC hardware rendered as clean, softly bevelled 3D models: mostly dark charcoal plastic and satin metal, PBR, ACES tone mapping, a warm key light and a cool rim, on a transparent ground. The parts sit in a cozy, warm-lit room (smoked oak, slate walls, a city window) with a few cyan "tech" glows. A dark navy glass UI with neon accents frames everything; the UI accents are much more saturated than the hardware itself.

## 2. Palette (full swatches: [art/palette.png](art/palette.png))
| Role | Hex | Where measured |
|---|---|---|
| **Backgrounds (UI)** | `#04060f` `--bg` dark · `#081628` `--board` · `#0a0e22` `--menu-solid` · `#0e1a3c` `--art-plate` · `#18245c` `--tile` | `ui.css` `:root[data-theme="dark"]` |
| | `#0b0f14` page bg, boot gradient `#141c30`→`#0b0f14` | `index.html` |
| | studio stage `#222a45`→`#0d1122`→`#06080f` (radial) | `ui.css` `.mode` |
| **Room** | WALL `#3a404c`, OAK `#665540` / grain `#38291c`, VENEER `#2f2a26`, STEEL `#1c1d20`, DUVET `#434a5c`, RUNNER (terracotta) `#7a4434`, RUG `#3b3d42` | `room/render/three/palette.ts` |
| | boot still top tones `#413124` 16.5 %, `#7a92a9` (sky) 14.0 %, `#593e23` 12.7 % | median-cut, `boot-still.jpg` |
| **Primary: hardware** | `#222427` 11.8 %, `#2a2d32` 10.9 %, `#34373c` 9.9 %, `#4e5360` 7.9 %, `#40444b` 7.2 %, `#1d1e22` 5.8 % | median-cut 16 over opaque px of all 86 stills |
| Metals / light parts | `#959aa3` 6.5 %, `#b9babf` 6.5 %, `#e9e9e6` 3.7 % | same |
| PCBs / die | green `#32875b` (ram0) / `#3d6957` (board0); blue `#2b406c` (board1); teal `#3a829e` (nic1-3); die blues `#2b4877`, `#557a98`; package `#2e344e` | per-family / per-still median-cut |
| **Accents in stills** (small areas) | copper `#c6874c` (rsink1), `#a2602b` (cooler1), `#8c5c3d` (gpu1); violet `#c19ce7` (fan*x corners); brass `#e3cc71` (psu0 stripe); blue-grey anodised `#647293` (cooler2) | saturated px only (s>0.3) |
| **UI ink + accents** | ink `#e2eaff`, mute `#a6b4da`, line `#2a366a`; accent/alu cyan `#3be3ff`, mul violet `#a68bff`, br magenta `#ff55dc`, pin gold `#d4af5f`; brand gradient `#8b5cff`→`#3be3ff` | `ui.css`, `index.html` `.boot-bar` |
| **Status** | ok `#6dffa6`, warn `#ffc247`, bad `#ff5a78` (light theme: `#0e7a45`, `#9a5a00`, `#c81e3e`); select outline `#ffff00`, hidden edge `#8a7a00` | `ui.css`, `post.ts` |
| **Light colours** | still key `#fff0dc` (2.4), rim `#9ab8ff` (1.2), ambient `#ffffff` 0.25; NEON `#3be3ff`, NEON_WASH `#8fd9e6`; lamps 2700 K (`LANTERN`) | `viewer.ts`, `palette.ts` |
| | lightmap hues: desk `#ffc27d`, arc `#ffaf62`, sconce `#ffbd74`, led `#affffd`, screen `#9ec6ff`, sun-20 `#c7d9ff` | alpha-weighted mean RGB of each RGBM map, normalised; approximate hue only |

**Rule C1:** hardware stays low-saturation (pixels with saturation > 0.4: ≤ 3.3 % on every non-PCB still except `case2` at 18.1 %; PCB/die stills 48-69 %). Saturated colour on a part belongs to its PCB, die art, or one small accent (a strip, a corner, a plate).

**Cyan `#3be3ff` today (as in the code):** the UI accent (`--accent`/`--alu`), the room's tech glow (`NEON`, `palette.ts`), and on parts: the active-part glow, intensity 0.4, which is also the start of the heat ramp cyan → amber → red (`GLOW.active`, `materials.ts:8`); the GPU fan ring (`gpu3d.ts:212-214`); the tower cooler's accent lines and fan ring (`ACCENT.tower`, `cooler3d.ts:25`, `:254`, `:262`); the case strip when idle or working (`case3d.ts:98`; amber on halt, red on error); the case accent for kinds other than gamer (`T.mul` violet) and show (`T.br` magenta) (`case3d.ts:133`); the board RGB strip, cyan → magenta (`boardmodel3d.ts:68`). Stills are unpowered, so these glows do not show in them.

**Rule C2, brightness:** mean luminance of a still's opaque pixels ≤ 140 (all-stills p90 = 137.0; median 80.4). Only the allowed realistic exceptions in §9 may exceed it. Luminance = `0.2126R + 0.7152G + 0.0722B` on sRGB 0-255, over pixels with alpha ≥ 250.

## 3. Shape language and line weight
- Real-size, real-fixings hardware (scale `23 units/mm`, `docs/PC_PARTS.md` pass 3). Recognisable silhouettes; detail is modelled (fins, screws, standoffs), not painted on boxes (pass 4).
- Soft edges, few segments: `softBox` = `RoundedBoxGeometry(…, 2 segments, radius 40 default)` (`src/core/render/three/geometry.ts:71`); extrusions use `bevelSegments: 1` (e.g. `gpu3d.ts:66`). No hard-edged boxes.
- **No outline in stills** (`renderStill` has no post pass). Silhouette edges are anti-aliased only: partial-alpha px = 1.2-5.7 % of opaque px.
- In-game selection outline: `#ffff00` visible / `#8a7a00` hidden, `edgeThickness 1.5`, `edgeStrength 4` (`src/core/render/three/post.ts:200-203`, a three.js `OutlinePass`). Hover ring is neutral, selected cyan, tutorial yellow (`docs/UI.md`).
- UI icons: 16×16 viewBox, stroke 1.5, round caps/joins, `currentColor`, outline style (only `bolt` and `menu` filled) (`kit/Icons.tsx`). Part-art SVGs (120×84 viewBox): strokes 0.5-2.4, mostly 0.8.

## 4. Lighting and shading (stills)
- Studio (`viewer.ts` `studio`): `ACESFilmicToneMapping`, exposure 1.6; `RoomEnvironment` reflections at 0.55; ambient 0.25.
- Key: warm `#fff0dc` ×2.4 from upper-right-front (`+1.5r, +2r, +1.2r` from centre), casts PCF shadows, 2048² map for stills. Rim: cool `#9ab8ff` ×1.2 from back-left-above (`-2r, +r, -1.5r`).
- Shadows: self-shadowing only. Floor disc hidden in stills → **no ground or drop shadow**; transparent background.
- *(obs.)* Top faces read lightest, right/front mid, left darkest; cool blue rim catches left edges; metals show soft broad speculars, no hard hotspots.
- Camera: perspective FOV 28°, yaw 0.6 rad, pitch 0.4 rad (3/4 view from above-front-right). Parts shown "open" (CPU lid off, die visible).
- Room: window is the key light; warm 2700-3000 K lamps at night plus few cyan accents; baked lightmaps (RGBM-sqrt, 50 texels/m, 16384 samples) + GTAO + bloom (0.5, 0.4, 1.2).

## 5. Scale and proportions
- Stills: **480×336 px** (a 120×84 shop tile at 4×), RGBA webp, quality 0.9 (`tools/stills.mjs`).
- Framing rule in code: bbox corners fill 90 % of tile height or width (`STILL_FILL`). Measured silhouette fill (max of w/480, h/336): median **0.81**, range 0.66 (rsink2) to 0.86 (rad1-3).
- Centring: bbox centre offset x −20…+30 px, y −9…+39 px (flat parts sit low: cpu* +39).
- Opaque coverage of frame: 11 % (nvme2) to 36 % (case0), typical 0.21-0.33.
- Model units: machine 23 units/mm; room 18.7 units/mm (`chair3d.ts`, `props3d.ts`); `hoodie.glb` authored in mm (x −286…278, y 317…989) and scaled ×18.7; `mouse.glb` in arbitrary units (≈3.5 long) and rescaled to `MOUSE_LEN = 1800`.
- Boot still: 480×270 (16:9) JPEG.

## 6. Texture and detail density
- Parts: procedural/baked canvas art (PCB traces, die floorplans, labels) drawn by the Pixi baker; mostly flat colour PBR otherwise. Webp file size 4.8-24.2 KB per still; CPUs are the densest (22-24 KB), cases/displays the lightest (4.8-6 KB).
- *(obs.)* Detail clusters on the hero face (die blocks, fan blades, fin stacks); side faces are plain.
- Room: lightmaps 994×1152 RGBA; meshes in `meshes.bin` (1.53 MB). Fabrics use procedural weave maps (`#4b5443` knit, `#434b3a` rib on the hoodie).
- GLB: `hoodie.glb` 15,070 tris, 2 materials (`knit`, `rib`) with no PBR values (assigned in code), UVs + baked `_AO` attribute, no textures, 418 KB. `mouse.glb` 1,198 tris, 5 materials (sRGB base `#1e2025`, `#ffffff`, `#000000`×2, `#e7e7e7`; metallic 0, roughness 0.4, double-sided), no UVs, no textures, 46.8 KB; all its materials are replaced in code by one shell `#9d9b96`, roughness 0.6.

## 7. UI type and iconography
- Fonts: `--ui: system-ui, 'Segoe UI', sans-serif`; `--mono: ui-monospace, 'Cascadia Mono', Consolas, monospace` (numbers and code only). No web fonts shipped.
- Root: `1rem = clamp(15px, min(0.85vw, 1.5vmin), 64px) × --ui-scale (0.8-1.5)`; all sizes rem, 1px hairlines only.
- Sizes: body 0.8rem/1.35; `--fs-label` 0.667rem (uppercase, 650 weight, 0.18em tracking); `--fs-title` 1rem; page titles 1.2rem/750/−0.01em; money 1.133rem mono 700; boot title 6vmin/750/0.04em.
- Panels: glass `--panel rgba(8,12,30,.52)`, 1px `--glass-line rgba(150,170,255,.16)`, radius 1rem, `blur(1.1rem) saturate(130%)`, shadow `0 1.2rem 2.6rem rgba(0,0,0,.32)`; tile radius `--r-tile` 0.7rem. Selected = accent at 55 % border + 0.9rem glow.
- Icons: line icons, 14 design units (0.933rem) default, stroke 1.5.

## 8. Approved references ([art/references.png](art/references.png))
1. `public/stills/cpu2.webp`: the signature look: dark package, die floorplan in muted blues `#2b4877`/`#557a98`, gold pins, soft key/rim light.
2. `public/stills/board1.webp`: PCB as the one saturated surface (`#2b406c`), real-scale slots, clean silhouette.
3. `public/stills/gpu3.webp`: charcoal `#222427`-`#313338` shroud, modelled fans, rounded edges, fills 0.79 of frame.
4. `public/stills/psu2.webp`: near-black box with one brass accent stripe (`#dfcd7a`); "one small accent" rule.
5. `public/stills/fan120x.webp`: neutral dark plastic, violet accent `#c19ce7` limited to corner pads.
6. `public/stills/cooler2.webp`: satin anodised blue-grey `#647293`, brushed cap, knurled hardware; good metal treatment.
7. `public/stills/vsink1.webp`: black fin stack with a single copper band; strong 3/4 silhouette, typical low-key value (mean L 55).
8. `public/boot-still.jpg`: the room target: smoked oak, slate, warm lamps, cool city window, dark glass PC.

## 9. Inconsistencies / rework needed
### Rework (decided by Khalil, 2026-11-12)
| File | Issue (measured) | Rule | Fix / target |
|---|---|---|---|
| `public/stills/rad1.webp`, `rad2.webp`, `rad3.webp` | Mean luminance 154.9 / 154.4 / 153.6 (≈1.9× the all-stills median 80.4); top colours `#9da2ac`, `#818695`, `#abb3c9` (satin aluminium). Source materials `cooler3d.ts:379-413`: plate `0x6a6f79`, tank `0x7b808a`, tube `0x858a94`, edge `0xa3a8b2`, strip `0x9297a1`, fin texture `#7f8bb3` on `#0b0f1c` (`cooler3d.ts:60-63`). | C3; radiators follow the dark default | **Target mean L 60-100** (median 80.4 ± 20) on each of rad1-3, and ≤ 2 % of px with L > 200 (now 3.3-4.0 %). Pass/fail check: mean L ≤ 100. Suggested route *(obs., not decided)*: move the radiator's satin aluminium toward the pump body it is plumbed to (`cooler3d.ts` pump side `0x3a3f48`, metalness 0.45, roughness 0.4), then rebake with `npm run stills -- --only rad1,rad2,rad3`. |
| `public/stills/display1.webp` | Byte-identical to `display0.webp` (md5 `23136082…`); the two are different products: `display0` "CLI monitor", `visual: "monitor-cli"`; `display1` "Graphics display", `visual: "monitor-gfx"` (`specs.ts:410-413`). | One still per product | **Asset request for Asset Maker**, spec below. |

**Asset request: `display1.webp` (Graphics display)**
- Rendered by the stills pipeline (`npm run stills -- --only display1`, `renderStill`), not painted: same studio (FOV 28°, yaw 0.6, pitch 0.4, key `#fff0dc`×2.4, rim `#9ab8ff`×1.2, ACES, exposure 1.6), so it matches the other 85.
- 480×336 px, RGBA webp, q 0.9, transparent background, no ground shadow, no outline; name `display1.webp`; new hash in `public/stills/manifest.json`.
- Must differ from `display0` at shop-tile size (120×84): different md5 and a visible difference that says "graphics" (it shows the OS dashboard / GPU picture per `specs.ts`), not the CLI screen.
- Frame fill 0.66-0.86 (display0: 0.70); bbox centre within ±30 px x, ±40 px y (display0: +8, +3).
- Mean L ≤ 140 (C2; display0: 56.0); C1 saturation.
- Needs a model change (the still is rendered from `buildShowcaseModel("display1")`), so it is code work, not a drop-in image.

### Allowed realistic exceptions (not addressed by Khalil, so they stay as they are)
Light-coloured because the real part is. They are exempt from C2; do not use them as references for new dark parts.
- `case0.webp`: cream/beige `#eeebe4`/`#d7d3c5`, mean L 231.6, 97.4 % px L > 200.
- `hdd0.webp`: white label `#f1f1f1` 35.7 %, mean L 191.4.
- `ram1.webp`: silver spreader, mean L 171.2.
- `cooler1.webp`: aluminium fin tower + copper pipes, mean L 166.5.

### Noted, no action decided
- Framing spread: `nvme2` covers 11 % of frame (h-fill 0.39); `rsink2` max fill 0.66 vs median 0.81; `ram*` bbox centre +26…+30 px right, `hdd0`/`ssd1` −20 px left. All inside the §10 tolerances.
- `mouse.glb`: Blender default names (`Material.001`…), arbitrary units, pure `#000000`/`#ffffff`, no UVs. All values are replaced in code (`props3d.ts`, shell `0x9d9b96`), so nothing shows; it breaks only the §10 model rules.

### For Khalil (flagged, not changed; `docs/UI.md` untouched)
- `docs/UI.md` "Glass" bullet says radius 0.67rem, blur 0.67rem, no shadow; `ui.css` has radius 1rem, `blur(1.1rem) saturate(130%)`, shadow `0 1.2rem 2.6rem rgba(0,0,0,.32)`. It also says labels 0.65rem / titles 0.95rem vs tokens `--fs-label` 0.667rem / `--fs-title` 1rem.
- Three dark secondary-text colours: `theme.ts` `mute #8a97c2` (Pixi fallback), `ui.css` `--mute #a6b4da`, `.mode` `--mute #8f9bc4`.
- Two page backgrounds: `index.html` `#0b0f14` (pre-CSS/boot), `ui.css` `--bg #04060f`.

## 10. Asset spec checklist (new batches)
**Part stills** (`public/stills/`)
- [ ] Rendered with `npm run stills` (`renderStill`), not by hand; listed in `public/stills/manifest.json`.
- [ ] 480×336 px, RGBA webp, q 0.9, transparent background, no ground shadow, no outline.
- [ ] Name = part id from `specs.ts` (`<kind><tier>[variant]`, e.g. `cpu3m`, `fan120x`, `ram1b`), lowercase, no separators.
- [ ] Silhouette max fill 0.66-0.86 (target ≈0.81); bbox centre within ±30 px x, ±40 px y.
- [ ] Mean luminance of opaque px ≤ 140 (C2); dark default band 40-100. Only `case0`, `hdd0`, `ram1`, `cooler1` are exempt. Radiators: 60-100.
- [ ] Saturated colour (s>0.4) only on PCB, die art, or one small accent (C1).
- [ ] Distinct still per distinct product (no duplicate hashes in the manifest).
- [ ] Studio unchanged: FOV 28°, yaw 0.6, pitch 0.4, key `#fff0dc`×2.4, rim `#9ab8ff`×1.2, ACES, exposure 1.6.

**Models** (`public/models/*.glb`)
- [ ] glTF 2.0 binary; authored in mm (as `hoodie.glb`), y up; scale set in code (machine 23 u/mm, room 18.7 u/mm).
- [ ] Named materials that code can map (`knit`, `rib`), no Blender defaults; UVs present if a map is used.
- [ ] Name: short lowercase noun (`hoodie.glb`, `mouse.glb`), as the repo does today.
- [ ] Size: no rule is enforced; current files are 46.8 KB and 418 KB. Rule to set (see [`docs/LOWPOLY_STYLE.md`](LOWPOLY_STYLE.md)).
- [ ] PBR range from existing materials: metalness 0-0.9 (steel 0.85-0.9), roughness 0.25-0.9; check against `palette.ts`.

**UI art**
- [ ] Colours from `ui.css` tokens only (both themes); sizes in rem; icons 16×16 viewBox, stroke 1.5, round caps, `currentColor`.

**Quick check (luminance, fill)**
```python
from PIL import Image; import numpy as np
a=np.asarray(Image.open(p).convert('RGBA')).astype(float); o=a[a[...,3]>=250][:,:3]
L=(o@[0.2126,0.7152,0.0722]).mean(); ys,xs=np.where(a[...,3]>8)
fill=max((np.ptp(xs)+1)/480,(np.ptp(ys)+1)/336)
```

## Changelog
- 2026-11-12 (v2): Khalil's answers. Added rules C1-C3 (C2 was the cyan rule, since removed; C3, brightness, is now C2); radiators and display1 to rework; case0/hdd0/ram1/cooler1 as allowed exceptions; code named as source of truth, LOWPOLY_STYLE.md replacement drafted; UI.md glass, `--mute` and page-bg splits flagged for Khalil; open questions removed; in-game cyan emissives flagged.
- 2026-11-12 (v3): approved by Khalil.
- 2026-11-12 (v4): cyan rule removed at Khalil's request. Cyan documented as it is in the code (UI, room, active-part glow and heat ramp, RGB accents); the brightness rule is now C2; the rework list is radiators + display1 only. Repo paths: links to `docs/LOWPOLY_STYLE.md`, `art/palette.png`, `art/references.png`.
