# Pipeline City: art style guide

**Status: Approved by Khalil, 2026-11-12 (v3).**

**Base:** `bfe11c69781196ae8dfb9ba7de3553b2037edffc` (main, 2026-11-12 19:49 UTC+1). Folds the five open calls Khalil answered on 2026-11-12 into DRAFT v2. Evidence: the direction audit (2026-11-12, delivered with the v2 draft, not in the repo) and the measurements cited below. **(J)** = judgement. "Proposal" = not decided, not scheduled.
**Images:** palette [art/palette.png](art/palette.png), references [art/references.png](art/references.png), plus [art/ui-boot.png](art/ui-boot.png) (the boot screen of `index.html`, rendered headless) and [art/cpu2-die-crop.png](art/cpu2-die-crop.png) (a 2.7× crop of `public/stills/cpu2.webp`).
**Source of truth for values:** the code. Modelling and material detail: [`docs/LOWPOLY_STYLE.md`](LOWPOLY_STYLE.md) (it conflicts with this direction in places; see §12).

## 1. Direction
Pipeline City is a **neon hacker dashboard**: a near-black navy world where information glows. Neon (cyan, violet, magenta, lime, plus the status colours) arrives as **light**: emissive lines, lit traces, glowing blocks, bloom, and data that visibly moves along wires. Hardware stays **real hardware** (charcoal plastic, satin metal, PCB masks, gold and copper contacts), lit and edged by that neon rather than painted with it. Type is small and crisp, high contrast on dark glass, mono for numbers. The dark theme is the only theme.

**It is not:** a cozy warm desk scene (2700 K lamps, oak and wood as the mood); a light theme; cartoon or flat-shaded parts, stylised shapes or saturated base paint; a club rave (neon everywhere, flooding the room, glow that hides the hardware).

## 2. Palette (one set for UI, 3D parts and 2D interiors)
Every hex already exists in the repo, except store `#a8ff55`, which is new (justified under Instruction classes below). Roles are decided in this draft.
| Role | Hex | Source |
|---|---|---|
| Void / page | `#04060f` | `--bg` (`src/core/ui/ui.css:15`), `theme.ts:15` |
| Panel solid | `#0a0e22` | `--menu-solid` (`ui.css:20`) |
| Board field | `#081628` | `--board` (`ui.css:15`) |
| Sub / chip body | `#0d1636` | `--sub` (`ui.css:15`) |
| Die field | `#111b46` | `--die` (`ui.css:15`) |
| Tile | `#18245c` | `--tile` (`ui.css:16`) |
| Line / hairline | `#2a366a` | `--line` (`ui.css:16`) |
| Charcoal 1 / 2 / graphite | `#1d1e22` / `#2a2d32` / `#4e5360` | measured, part stills (median-cut) |
| Satin / bright metal | `#959aa3` / `#b9babf` | measured, part stills |
| PCB black / blue / green | `#131518` / `#16294d` / `#173d29` | `src/features/board/render/skins.ts:34-46` (dark masks) |
| Gold (one) | `#d4af5f` | `--pin` (`ui.css:15`) |
| Copper (one) | `#c0793a` | `COPPER` (`src/features/board/render/three/cooler3d.ts:24`) |
| Neon primary: active, ALU | `#3be3ff` | `--alu`/`--accent` (`ui.css:17-18`), `GLOW.active` (`src/core/render/three/materials.ts:8`) |
| Neon secondary: MUL, brand | `#a68bff` | `--mul` (`ui.css:17`); also replaces former brand `#8b5cff` |
| Neon control: branch | `#ff55dc` | `--br` (`ui.css:17`) |
| Load (instruction class) | `#9ab8ff` | already the cool key (`src/core/render/three/viewer.ts:68`); was `--ld #ffc247` |
| Store (instruction class) | `#a8ff55` | **new**; was `--st #6dffa6`. Justification below |
| Cyan cast light | `#8fd9e6` | `NEON_WASH` (`src/features/room/render/three/palette.ts:51`) |
| Status ok / warn / error | `#6dffa6` / `#ffc247` / `#ff5a78` | `--ok`/`--warn`/`--bad` (`ui.css:18`) |
| Ink / mute | `#e2eaff` / `#a6b4da` | `ui.css:16` |
| Light: cool key | `#9ab8ff` | studio rim today (`viewer.ts:68`); same hex as load |
| Light: neon rims | `#3be3ff`, `#a68bff` | tokens above |
| Light: warm practical (accent only) | `#ffc27d` | desk-lamp lightmap hue (`public/bake/room/desk.png`: alpha-weighted mean RGB, normalised; approximate) |

Pure `#000000` / `#ffffff` at alpha < 1 stay allowed for shading in 2D art (shadows, sheens).

### Instruction classes
Defined as `Theme` accents in `src/core/render/theme.ts:10-17` (`alu`, `mul`, `ld`, `st`, `br`; comment: "alu cyan, mul violet, ld amber, st green, br magenta") and as CSS tokens `--alu --mul --ld --st --br` in `ui.css:17` (dark) and `:6` (light, now dead). Live mapping: `docs/RENDER.md:82` "Pipeline: chips are keyed by dynamic instruction id and coloured by class (alu cyan, mul violet, load amber, store green, branch/jump magenta)". `bad` / `--bad` `#ff5a78` is the error accent, shared with status error, not a class.

Status green and amber are no longer used as class colours. ALU, MUL and branch keep their hues. Load and store move:

| Class | Token | Hex | Hue | Contrast vs void `#04060f` | vs die `#111b46` |
|---|---|---|---|---|---|
| ALU | `--alu` / `T.alu` | `#3be3ff` (unchanged) | 189° | 13.12:1 | 10.73:1 |
| MUL | `--mul` / `T.mul` | `#a68bff` (unchanged) | 254° | 7.47:1 | 6.11:1 |
| Load | `--ld` / `T.ld` | `#9ab8ff` (was `#ffc247`) | 222° | 10.28:1 | 8.41:1 |
| Store | `--st` / `T.st` | `#a8ff55` (**new**; was `#6dffa6`) | 91° | 16.47:1 | 13.47:1 |
| Branch | `--br` / `T.br` | `#ff55dc` (unchanged) | 312° | 7.31:1 | 5.98:1 |

WCAG: 4.5:1 is AA for normal text, 7:1 is AAA. All five clear AA against the void; ALU, load and store also clear AAA there. Against the die field (where class chips actually sit), MUL 6.11:1 and branch 5.98:1 stay AA, as they already were. Load is 34° from ALU and 32° from MUL, and is less saturated (S 0.40 vs ALU 0.77 / MUL 0.45), so it reads as a soft azure rather than a second cyan or violet. It reuses the cool-key hex already in the palette (no new colour).

**Why a new hex for store.** No remaining palette hue sits far enough from status green `#6dffa6` (143°), status amber `#ffc247` (40°) and ALU cyan (189°). The lime already in the repo, `#7dff4d` (the gamer-case RGB strip, `case3d.ts:258`, hue 104°), is only 31° from status green and would recreate the collision this change is meant to end. `#a8ff55` (hue 91°) sits nearly midway between amber (51° away) and status green (53° away), is neon at V 1.0, and contrasts 16.47:1 against the void.

### Deprecated values (replace when the file is next touched; replacements marked (J) are judgements)
| Value | Where | Replace with |
|---|---|---|
| `#8b5cff` brand / RGB | `index.html:21,32` (boot gradient); `src/features/board/render/three/fans3d.ts:106` (`glowMat` ring); `src/features/board/render/three/machine3d.ts:115,120,123` (RGB point light, spill, `accent`) | `#a68bff` |
| `--ld #ffc247`, `T.ld` | `ui.css:17`, `theme.ts:17` (class token; status `--warn` keeps `#ffc247`) | `#9ab8ff` |
| `--st #6dffa6`, `T.st` | `ui.css:17`, `theme.ts:17` (class token; status `--ok` keeps `#6dffa6`) | `#a8ff55` |
| `#8a97c2` mute | `src/core/render/theme.ts:16` | `#a6b4da` |
| `#8f9bc4` mute, `#e9eeff` ink, `#141c3f` tile, `#07101f` on | `ui.css:1249` (`.mode`) | `#a6b4da`, `#e2eaff`, `#18245c`, `#08102a` |
| `#0b0f14` page bg; `#141c30` boot glow | `index.html:10`, `:15` | `#04060f`; `#0d1636` (J) |
| `#d9b25e` gold | `boardmodel3d.ts:31`, `ram3d.ts:126`, `wires3d.ts:159` | `#d4af5f` |
| `#d8b264` gold | `pcbkit3d.ts:299` | `#d4af5f` |
| `#8a6a4a` | `src/core/render/accelart.ts:186` | `#c0793a` (J) |
| `#0d1220`, `#0b101c`, `#05070c` dark fills | `accelart.ts:45,65,98` / `:150,154` / `:73,102,105,128` | `#0d1636` or `#04060f` (J) |
| `#1b2236`, `#2a1d46` card PCB; `#1f3b2e` | `accelart.ts:89`; `:168` | `#16294d`, `#131518` (J); `#173d29` |
| `#7d89a4` fins; `#aab4c9`, `#a9afb7` metal; `#17191d` | `accelart.ts:46,66`; `:104,127`, `:177,182`; `:178` | `#959aa3`; `#b9babf`; `#1d1e22` |
| `#1d2536` fan colour (both themes) | `accelart.ts:99` | the theme's own token (J) |
| `#ffd9d0`; `#0b101c` | `src/features/tpm/render/tpmview.ts:172`; `:175-176` | `#e2eaff` (J); `#0d1636` |
| `#0b0d12` chip text | `src/features/cpu/render/die/diemulti.ts:243,302` | `--on #08102a` |
| `#9aa3ae`/`#2a2e36`, `#d9d4c7`/`#8f8a7e` screws | `src/features/board/render/boardArt.ts:281-282`, `:284-285` | `#959aa3`/`#2a2d32`, `#b9babf`/`#4e5360` (J) |
| `#a98f6c`/`#d6d9dc` header pins; `#e8ebf0` label; `#05070b` socket | `boardArt.ts:198-199`; `:299`; `:396` | `#d4af5f`/`#b9babf` (J); `#e2eaff`; `#04060f` |
| `#1d6f80` GPU ring base; `#1a1430` tier-3 glow base | `gpu3d.ts:212`; `parts3d.ts:75` | `#0d1636` (J) |
| `#fff0dc` studio key | `viewer.ts:68` | cool key `#9ab8ff` family (§3) |
| `#fff0dc` key, `#1a1410` hemisphere ground | `src/features/board/render/three/buildmode3d.ts:151`, `:150` | cool key; `#04060f` (J) |
| Room `WALL #3a404c`, `OAK #665540`, `OAK_GRAIN #38291c`, `VENEER #2f2a26`, `VENEER_GRAIN #1c1815`; `LANTERN = kelvin(2700)` | `palette.ts:8-17`, `:49` | charcoal / graphite in §3 (J); warm only as practicals |

Light-theme tokens (the whole `:root` default palette and the `LIGHT` object) are listed with the drop-the-light-theme rework in §10.11, not here: they go away rather than map onto a replacement.

## 3. Lighting
- **Key: cool.** Stills, gallery and build mode: a cool white key (`#9ab8ff` family) replaces `#fff0dc`. **Rim: neon**, cyan `#3be3ff` or violet `#a68bff`, one per shot. Exposure and ACES stay (`viewer.ts`: ACES, exposure 1.6). (Proposal; today: key `#fff0dc` ×2.4, rim `#9ab8ff` ×1.2, `viewer.ts:68`.)
- **Warm only as small accents:** a practical lamp may be warm (`#ffc27d`), never the key. Target (J): in a night room shot, warm-tinted pixels (R > B) under 20 % (the boot still has 48.0 % today).
- **Room night look:** the window (moon, city) and the neon fixtures (strips, bias light, LED halo) define the room; warm lamps are pools, not the fill. Today the lamp cap keeps lights in `LIGHT_ORDER` (`src/features/room/render/three/roomlights.ts:18`): key, sun, arc, desk, floor, bedside, sconces, … `deskLed`, `ledHalo`, `ledUnder`, `bias`, `strips` last. So at cap 4 (Low) and cap 8 every neon light is capped; their fixtures still glow and their baked bounce shows ×2.5 (`CAPPED_BOUNCE`, `roomlights.ts:36`). **Proposal:** order neon fixtures before the warm lamps.
- **Room surfaces: charcoal and graphite, not wood (decided).** Today the room is smoked oak and ash veneer: `OAK #665540` / `OAK_GRAIN #38291c` (`src/features/room/render/three/palette.ts:15`) used by `smokedOak` (roughness `OAK_ROUGH` 0.68, `furniture3d.ts:94,111`) for the floor (`room3d.ts:283-284`), the desk top (`room3d.ts:292`) and the bookcase (`furniture3d.ts:518`); `VENEER #2f2a26` / `VENEER_GRAIN #1c1815` (`palette.ts:10`) at roughness 0.5 (`furniture3d.ts:208,332,764`) for the bed, nightstand, shelf and drawer unit; walls are plaster over `WALL #3a404c` at roughness 0.92 (`palette.ts:8`, `room3d.ts:425`); ceiling `CEILING 0x4a4f59` at roughness 0.95 (`room3d.ts:438`); trim `TRIM 0x3d424c` (`palette.ts:8`). **Targets (J), all from §2:**

  | Surface | Hex | Metalness | Roughness | Notes |
  |---|---|---|---|---|
  | Floor, desk top, bookcase | `#1d1e22` (charcoal 1); grain `#04060f` | 0.00–0.08 | 0.55–0.70 | Satin stone or matte laminate, same roughness family as oiled oak (0.68). Replaces `smokedOak`. |
  | Veneer furniture (bed, nightstand, shelf, drawers) | `#2a2d32` (charcoal 2); grain `#1d1e22` | 0.00–0.08 | 0.50–0.60 | Keeps today's 0.5 sheen, loses the brown. |
  | Walls, trim | `#2a2d32` | 0.00–0.05 | 0.90–0.95 | Matte paint, as today's plaster (0.92). |
  | Ceiling | `#4e5360` (graphite) | 0.00–0.05 | 0.90–0.95 | Today's `#4a4f59` is already close; retint to the palette graphite. |

  Steel, stoneware, the charcoal rug and the duvet already sit in this family and stay. The terracotta runner (`RUNNER #7a4434`, `palette.ts:19`) may remain as a small warm practical, inside the 20 % warm-pixel budget. `LANTERN = kelvin(2700)` stays for practical bulbs only.
- **Glow and bloom:** glow belongs to emitters only (LEDs, strips, rings, screens, lit traces, die blocks). Bloom today: strength 0.5, radius 0.4, threshold 1.2 (`src/core/render/three/post.ts`). Rule: an "active" part glow and the die-class colours must visibly bloom at the default exposure. Check it with `npm run shot -- out.png --view cpu --preset Medium`. Today's active glow (0.4, `materials.ts:32`) likely stays under the threshold (J).
- Room and city shadows and the lamp-cap mechanics are unchanged by this direction (`src/features/room/light.md` "The lamp cap"; the bedside lantern always casts, `ALWAYS_CASTS`, `roomlights.ts:30`).

## 4. Parts
**Realism (holds)**
- Real scale (23 units/mm, `src/features/board/render/layout/layout.ts:151`), real fixings, soft edges: `softBox` 2 segments, radius 40 (`src/core/render/three/geometry.ts:71`), 1-segment bevels. No stylised shapes.
- Real material families only (palette §2: charcoal, graphite, satin and bright metal, PCB masks, one gold, one copper).
- PBR from the code: default metalness 0.05, roughness 0.65 (`materials.ts` `mat`). In use on parts: metalness 0–1 (gold contacts 1.0 / roughness 0.24, `pcbkit3d.ts:299`; polished cap 0.95 / 0.14, `cooler3d.ts:332`), roughness 0.03–1 (case glass 0.03, `case3d.ts:50`; printed art 1, `artlod.ts:170`).
- **C1, base saturation:** on a render with emissives off, pixels with S > 0.4 are ≤ 3.3 % on every non-PCB part (today: all non-PCB stills except `case2`, 18.1 %; PCB and die stills 48–69 %). Neon never comes from base albedo.
- **C2, brightness:** mean luminance of a still's opaque pixels ≤ 140 (all 71 stills: median 80.4, p90 137.0). Luminance = `0.2126R + 0.7152G + 0.0722B` (sRGB 0–255, pixels with alpha ≥ 250). Dark default 40–100. Radiators `rad1-3` (≈154) are to rework to 60–100. The former light-part exceptions (`case0` 231.6, `hdd0` 191.4, `ram1` 171.2, `cooler1` 166.5) are withdrawn: they get dark or anodised variants (below) and must meet the dark default.

**Dark or anodised variants (decided; no longer exceptions)**
These four stay recognisably the same hardware (OEM tower, 3.5" HDD, DDR2 clip-on spreader, air tower), just dark. Emissive only where real hardware of that kind has light. Current stills remain anti-references of the old look (§9).

| Part | Today | Target (J) | Emissive |
|---|---|---|---|
| `case0` Mini / OEM (`visual: "case-mini"`, `LOOKS.oem` in `case3d.ts:38`; 2D `STYLES[0]` in `exterior.ts:68`; id `case0` from `buildmode3d.ts:88`) | Cream painted steel: body `#dcd4b5`, metalness 0.04, roughness 0.6, inner `#cbc2a1` (`case3d.ts:38`); 2D mix `#e6dfc4` (`exterior.ts:68`); beige power button `#d9d0b0`, roughness 0.55 (`casedetail3d.ts:393`) | Charcoal painted steel, still a budget OEM (low metalness, not a gaming case). Body `#1d1e22`–`#2a2d32`, metalness 0.04–0.15, roughness 0.55–0.70. Inner `#2a2d32`. Button and bezel in the same family; drop `#d9d0b0` / `#e6dfc4` / `#dcd4b5`. | Status lamps and the front accent strip only (`casedetail3d.ts:391`, `case3d.ts:176-181`). No RGB (`LOOKS.oem.rgb` is already false). |
| `hdd0` (`visual: "hdd"`, `hddModel` in `drive3d.ts:97-100`) | Cast aluminium base `#8e949b`, metalness 0.72, roughness 0.52; brushed stainless cover `#d5d9dd`, metalness 0.92, roughness 0.27 | Dark anodised / black drive. Cover `#2a2d32`–`#4e5360`, metalness 0.60–0.85, roughness 0.35–0.50 (brushed dark stainless). Cast base `#1d1e22`–`#2a2d32`, metalness 0.50–0.75, roughness 0.50–0.65. Label ink stays dark. | None on the drive body. Activity light lives on the case bay. |
| `ram1` DDR2 (`visual: "dimm-fast"` → `stickLook` `'low'`, `ram3d.ts:35-36,204`) | Silver clip-on spreader `#8d939c`, metalness 0.55, roughness 0.50 | Dark anodised clip-on, in the same family as today's DDR3 fins (`#2b2f37`, `ram3d.ts:205`). Plate `#2a2d32`–`#4e5360`, metalness 0.55–0.70, roughness 0.40–0.55. PCB under the spreader stays navy `#171b23`. | None. DDR2 clip-ons have no RGB (RGB starts at the `'rgb'` look, DDR4/5). |
| `cooler1` tower (`visual: "cooler-tower"`, `tower()` in `cooler3d.ts:222-223`) | Bright aluminium fins `#b4bccb`, metalness 0.75, roughness 0.30; base block `#8a93a6`, roughness 0.34 (`cooler3d.ts:223,240`) | Dark anodised aluminium (the liquid pump already uses this language at `#3a3f48`, metalness 0.45, roughness 0.40, `cooler3d.ts:319-321`). Fins `#2a2d32`–`#4e5360`, metalness 0.55–0.75, roughness 0.30–0.45. Base block in the same range. Copper heat pipes stay `#c0793a` (real metal). | None on the fin stack or pipes. Fan rings, if present, follow the shared fan RGB (folded to `#a68bff`). The cyan painted accent edge (`ACCENT.tower #3be3ff`, `cooler3d.ts:254`) is albedo, not a light; leave or mute it so it does not break C1. |

**Emissive (new)**
- Emissives only where real hardware has light: status and activity LEDs, RGB strips and rings (fans, GPU shroud, cooler cap, case strip, board strip, RAM), screens, lit traces and die blocks. No glowing outlines on geometry; no emissive on bare plastic or metal.
- Colours from the neon and status roles only (§2). Existing state looks hold: active `#3be3ff` 0.4, throttled `#ffc247` 0.2, burnt `#ff5a78` 0.8, heat ramp cyan→amber→red from 42 °C to 82 °C (`materials.ts:8-33`).
- LOD stand-ins keep the same materials, so emissive state survives at a distance (`src/core/render/three/partlod.ts`; `docs/render/lod.md` "The machine's stand-ins"). New emissive materials must keep this: a stateful material joins only its own set.
- **Stills: powered-on idle (proposal).** Today `renderStill` shows parts unpowered (0 of 71 stills have a neon pixel, S > 0.6 and V > 0.85). New stills show idle emissives (LEDs, strips, rings at their idle level), with no active or heat glow.

## 5. Zoom continuity: 3D part → interior view
Rules (targets; all values are proposals (J)):
1. **Glow ramp:** as the camera closes on a die or board, the baked art's self-light rises and the scene light falls. Today: `FINISH` die `glow` 0.4 / `lit` 0.4, card 0.1 / 1, board 0.05 / 1 (`artlod.ts:129-133`). Target at the closest LOD: die `lit` ≈ 0.1, `glow` ≈ 0.8, and trace pixels glow on boards. The die's neon reaches V ≈ 1.0 (today it peaks at V 0.69, p99 of S > 0.5 pixels in `cpu2.webp`).
2. **Fade to `#04060f`:** during the last part of the zoom, surroundings fall to the void colour (vignette or depth fade plus lower exposure), so the die field sits on the same background as the 2D view.
3. **One motion system:** the 2D pulses, packets and trails (`src/features/cpu/render/die/diepulse.ts`, `TRAIL_MS` 1500) run on the 3D die and board with the same colours and timing. Board bus pulses continue into the die links. "Live dies" is on by default from Medium up.
4. **Min stroke ≈ 1 screen px:** interior art is baked so strokes never fall below about 1 px at the closest tile density (`artlod.ts` `TILE_PX` 2048).
5. **Bloom parity:** a glowing block in 3D blooms like the 2D block glow (`dieview.ts:319-325`). The lid fade (`fadeTree`) reveals an already lit die.
6. **Same hexes on both sides:** 3D finish, 2D art and UI use §2 only.

## 6. 2D interior art (die, GPU, NPU, TPM, board, accel)
- **Tokens only:** colours come from `Theme` (`T.*`), `makePalette`, or the board skins (`skins.ts`). No hex literals, except `#000000`/`#ffffff` at alpha < 1 for shading. Check: `rg -n "#[0-9a-fA-F]{6}\b" src/features/{cpu,gpu,npu,tpm}/render src/core/render/accelart.ts src/features/board/render/boardArt.ts` lists only the allowed cases (today it lists the deprecated values in §2).
- The 3D world wears the dark palette (`builtinTheme(true)`, `theme.ts:33`). There is no light-theme art path.
- Class colours: ALU cyan `#3be3ff`, MUL violet `#a68bff`, load azure `#9ab8ff`, store lime `#a8ff55`, branch magenta `#ff55dc` (§2). Blocks glow while an instruction is in them; packets leave 1.5 s trails. Changing `--ld` / `--st` (and `theme.ts`) updates token users; tests that hard-code the old amber/green class hexes must follow.
- Strokes: today 1.2–2.6 layout units in die art (`dieart.ts`, `dieview.ts`, `uncore.ts`); keep the ≥ 1 px rule (§5.4).

## 7. UI
- **Dark is the only theme.** `index.html` starts with `data-theme="dark"`. The light theme is dropped: no Light control, no `theme` value `'light'`, no light-theme tokens as a living palette. The current light path (to be removed, §10.11) is: `:root` defaults in `ui.css:3-13` (the entire light token set, including `--bg #eaeff6`, `--board #9ccdbd`, `--ok #0e7a45`, `--warn #9a5a00`, `--accent #0a6f8f`, `--menu-solid #f4f7fc`, `--art-plate #e1e9f5`, `color-scheme: light`); the `:root:not([data-theme="dark"])` glass shadow at `ui.css:53`; `:root[data-theme="light"] .modal-back` at `ui.css:523` and `.ng-back` at `ui.css:590`; the `LIGHT` palette at `theme.ts:19-23`; `isDark()`'s `'light'` branch at `theme.ts:28`; `makePalette`'s light-board mix at `theme.ts:69`; `Theme = 'dark' \| 'light'`, `initialTheme`, `toggleTheme` in `src/core/ui/state.ts:28-43`; the Settings Light button in `MainMenu.tsx:72-73`; the HUD sun/moon toggle in `Hud.tsx:270-272` (title: "Switch to the light theme (experimental)").
- Glass panels: `--panel rgba(8,12,30,.52)`, 1px `--glass-line rgba(150,170,255,.16)`, radius 1rem, `blur(1.1rem) saturate(130%)`, shadow `0 1.2rem 2.6rem rgba(0,0,0,.32)` (`ui.css`). `docs/UI.md` "Glass" still lists the older values (0.67rem, no shadow).
- Type: `--ui` `system-ui, 'Segoe UI', sans-serif`; `--mono` `ui-monospace, 'Cascadia Mono', Consolas, monospace` for numbers and code only. Root `1rem = clamp(15px, min(0.85vw, 1.5vmin), 64px) × --ui-scale`. Body 0.8rem/1.35; labels 0.667rem uppercase, 650 weight, 0.18em tracking; titles 1rem; page titles 1.2rem/750.
- Icons: 16×16 viewBox, stroke 1.5, round caps and joins, `currentColor`, line style (`src/core/ui/kit/Icons.tsx`).
- Selection outline `#ffff00` / hidden `#8a7a00`, thickness 1.5, strength 4 (`post.ts:200-203`).

## 8. Shape, scale, framing, still format (unchanged)
- Stills: 480×336 RGBA webp, q 0.9, transparent background, no ground shadow, no outline, via `npm run stills` (`tools/stills.mjs`, `renderStill`). Name = part id (`<kind><tier>[variant]`).
- Camera: FOV 28°, yaw 0.6, pitch 0.4 rad; the box corners fill 90 % (`STILL_FILL`, `viewer.ts`). Measured silhouette fill 0.66–0.86, median 0.81; bbox centre within ±30 px x, ±40 px y.
- Scale: machine 23 units/mm (`layout.ts:151`), room 18.7 units/mm (`src/features/room/render/three/chair3d.ts:14`, `props3d.ts:204`); imported models in mm (`public/models/hoodie.glb`).

## 9. References ([art/references.png](art/references.png))
**References**
1. `docs/art/ui-boot.png`: the UI at its most on-direction: navy void, glass, the brand gradient (today `#8b5cff`→`#3be3ff` in `index.html:21`; after the fold, `#a68bff`→`#3be3ff`), crisp type.
2. `docs/art/cpu2-die-crop.png`: the die art's class colours and floorplan: the interior look the zoom must reach (at full value; §5). After the class-hue change, this crop will need a refresh.
3. `public/stills/cpu2.webp`: a real package carrying neon art; the target once relit (§3).
4. `public/stills/board2.webp`: black PCB, real slots, low-saturation base: the right base for lit traces.
5. `public/stills/gpu3.webp`: charcoal shroud and modelled fans, ready for an RGB ring (§4).
6. `public/stills/vsink1.webp`: a black fin stack with one copper band: dark, plausible, mean L 55.1.

**Anti-references (the old look, including the withdrawn light-part exceptions)**
- `public/boot-still.jpg`: a sunny warm room (48.0 % warm pixels, 0 % neon, wood tones `#413124`, `#593e23`).
- `public/stills/case0.webp`: cream case, mean L 231.6: the old OEM paint, to be replaced by the charcoal variant (§4).
- `public/stills/hdd0.webp`: bright aluminium drive, mean L 191.4.
- `public/stills/ram1.webp`: silver DDR2 spreader, mean L 171.2.
- `public/stills/cooler1.webp`: bright aluminium tower, mean L 166.5.
- `public/stills/rad1.webp`: bright satin aluminium, mean L 154.9: breaks C2.

All stills are still lit warm-key and unpowered, so even the references are "partly" on-direction until §10.4–5 land (J).

## 10. Gaps and rework (proposals, ranked by visibility; nothing scheduled)
S ≈ hours, M ≈ days, L ≈ a week or more (J). The rework stays on hold until Khalil says go.
1. **Room: night light and charcoal / graphite surfaces (L).** Cool night key (moon, city), neon fixtures first in `LIGHT_ORDER`, warm lamps as one or two practicals, oak and ash veneer replaced by the charcoal/graphite specs in §3. *Touches:* `palette.ts` (`WALL`, `OAK`, `VENEER`, …), `room3d.ts`, `furniture3d.ts` (`smokedOak`), `roomlights.ts`, `room/light.md` targets, **lightmap re-bake** (`tools/bake/`), screenshots per preset (`npm run shot -- --preset Low|Medium|High`).
2. **Boot still (S, after 1).** Re-shoot at night; replace `public/boot-still.jpg`. Fold the boot gradient `#8b5cff`→`#a68bff` in `index.html:21,32` at the same time (or with item 8).
3. **Instruction-class hues (S).** `--ld #9ab8ff` and `--st #a8ff55` in `ui.css` and `theme.ts`; update tests that hard-code the old amber/green class colours. Live die and pipeline art follow the tokens. Refresh `docs/art/cpu2-die-crop.png` once a die still exists with the new hues.
4. **Dark / anodised variants of the light parts (M).** `case0`, `hdd0`, `ram1`, `cooler1` to the material specs in §4; re-render their stills; they must meet C2's dark default (40–100). *Touches:* `case3d.ts` `LOOKS.oem`, `exterior.ts` `STYLES[0]`, `casedetail3d.ts` beige button, `drive3d.ts` `hddModel`, `ram3d.ts` `'low'` plate, `cooler3d.ts` `tower` fins.
5. **Stills relight (S code + M re-render).** Cool key and neon rim in `viewer.ts` `studio`; `npm run stills` for all 71; check C1 and C2.
6. **Emissive on parts and powered-idle stills (M–L).** LEDs, strips and rings where real parts have them; a state hook in `renderStill`. *Touches:* `src/features/board/render/three/*3d.ts`, `viewer.ts`, stills.
7. **Zoom glow and motion (M).** `artlod.ts` FINISH and shader, `post.ts` bloom, presets (live dies), 2D motion on 3D (§5).
8. **Hard-coded colours (S).** Apply the deprecated-values table (§2), including `#8b5cff`→`#a68bff` in `fans3d.ts:106` and `machine3d.ts:115,120,123`.
9. **Radiators `rad1-3` (S–M, decided earlier).** To 60–100 mean L.
10. **`display1.webp` duplicate of `display0.webp` (M, decided earlier).** Needs its own model look ("monitor-gfx") and a re-rendered still.
11. **Drop the light theme (S–M).** Dark is the only theme. Remove the living light path listed in §7: `ui.css:3-13` defaults (make the dark tokens the `:root` palette), `ui.css:23-33` (`prefers-color-scheme` / `:root:not([data-theme="light"])` becomes unnecessary), `ui.css:53`, `:523`, `:590`; `theme.ts` `LIGHT` (`:19-23`) and the light branches of `isDark` / `builtinTheme` / `makePalette`; `state.ts:28-43` (`Theme`, `toggleTheme`, `THEME_KEY`); `MainMenu.tsx:72-73`; `Hud.tsx:270-272`. Tests that construct a `LIGHT` palette (`src/core/render/art.test.ts:21`, `accelart.test.ts:18`, `src/features/board/render/cooler.test.ts:20`, `src/features/room/render/shell/room.test.ts:21`). Docs that present both themes as equal (`docs/UI.md:211`, `docs/LOWPOLY_STYLE.md` "Dark Mode & Light Mode", `docs/RENDER.md:64`).

## 11. Asset checklist (new batches)
**Part still**
- [ ] Rendered with `npm run stills -- --only <id>`, not painted; 480×336 RGBA webp, q 0.9; listed in `public/stills/manifest.json` with a unique hash.
- [ ] Lit with the cool key and one neon rim (§3), once that lands; powered-on idle emissives only (§4).
- [ ] C1 on an emissive-off render: ≤ 3.3 % px with S > 0.4 (non-PCB parts).
- [ ] C2: mean L ≤ 140; dark default 40–100. No exceptions for `case0`, `hdd0`, `ram1`, `cooler1`.
- [ ] Emissive only on real light sources; colours from §2 neon and status roles.
- [ ] Fill 0.66–0.86; bbox centre within ±30 px x, ±40 px y; no ground shadow, no outline.

**3D part (code)**
- [ ] Real scale (23 u/mm), real fixings, `softBox` or 1-segment bevels.
- [ ] Materials from §2; PBR inside the ranges in §4; no hex outside §2 (except a new material named and added here). `case0` / `hdd0` / `ram1` / `cooler1` follow the dark or anodised specs in §4.
- [ ] Stateful emissive materials are their own objects (LOD stand-ins, `partlod.ts`).
- [ ] Night screenshot per preset (`npm run shot -- out.png --view board --preset Low|Medium|High`): the part reads and its glow blooms.
- [ ] No `#8b5cff`; brand / RGB uses `#a68bff`.

**2D interior art**
- [ ] Tokens only (§6 grep check); strokes ≥ 1 px at the closest LOD; class colours as in §2 (load `#9ab8ff`, store `#a8ff55`, not status green or amber).
- [ ] Dark palette only (`builtinTheme(true)`). No light-theme art.

**Room**
- [ ] Surfaces from the charcoal / graphite targets in §3, not oak or ash veneer.
- [ ] Warm practicals only; warm-tinted pixels under 20 % in a night shot (J).

**Quick check (luminance, fill, neon)**
```python
from PIL import Image; import numpy as np
a=np.asarray(Image.open(p).convert('RGBA')).astype(float); o=a[a[...,3]>=250][:,:3]
L=(o@[0.2126,0.7152,0.0722]).mean(); ys,xs=np.where(a[...,3]>8)
fill=max((np.ptp(xs)+1)/480,(np.ptp(ys)+1)/336)
mx=o.max(1)/255; S=(o.max(1)-o.min(1))/np.maximum(o.max(1),1); neon=((S>0.6)&(mx>0.85)).mean()
```

## 12. LOWPOLY_STYLE.md sections that now conflict (not edited)
- "Look decision (owner, 2026-10-31)": "Stylised warm… warm light (sky fill, sun or moon through the window, the lamp's spot)".
- "Inspiration": "A cozy lit room in a photograph (warm lamps, a cool window)".
- "Lighting Setup", **Lamps**: "warm lamps (2700 to 3000 K…) and a few cyan accents".
- "Lighting Setup", **Studio**: key `#fff0dc` ×2.4, rim `#9ab8ff` ×1.2; build mode key `#fff0dc`. Its citation `buildmode3d.ts:148-151` is also stale at `bfe11c6` (now `:150-153`).
- "Animation & Motion", **Idle/Powered State**: says "steady emissive" while stills show no emissive; this guide asks for powered-idle stills (§4).
- "Hue Assignments": room-era table is fine for materials, but gold and copper need the single values in §2. The `ram1` silver exception and the `cooler1` aluminium exception (`#adb2bd`) are withdrawn; both get dark or anodised variants (§4). Oak-era room colours conflict with the charcoal/graphite surfaces in §3.
- "Dark Mode & Light Mode": presents both themes as equal, and lists the light-theme accents (`--ld #c47600`, `--st #0f9a53`, …). Light theme is dropped; dark is the only theme. The `#0b0f14` vs `#04060f` page bg is settled here as `#04060f` (§2). Class accents in that section still show load amber and store green.
- "Colour decisions (owner, 2026-11-12)": radiators-follow-the-dark-default still holds; the sentence allowing `case0`, `hdd0`, `ram1`, `cooler1` as light exceptions is withdrawn.
- "Quality Checklist": no emissive, powered-idle or zoom-continuity items; still lists case0, hdd0, ram1, cooler1 as luminance exceptions.

## Changelog
- 2026-11-12: v1-v5: the mixed-look guide (realistic parts, warm room, neon UI) with rules C1, C2, rework of radiators and display1 (see git history of this file).
- 2026-11-12: DRAFT v2: direction "neon hacker dashboard" approved by Khalil for drafting; harmonised palette; cool key and neon rim; emissive and zoom rules; references reset. Base `bfe11c6`.
- 2026-11-12: DRAFT v3 (this file): folds Khalil's five calls — drop the light theme; instruction classes get their own hues (`--ld #9ab8ff`, `--st #a8ff55`); dark or anodised variants of `case0`, `hdd0`, `ram1`, `cooler1`; room surfaces to charcoal and graphite; brand `#8b5cff` folded into `#a68bff`. Base still `bfe11c6`.
