# Level of detail (zoom and location)

> **Outdated (2026-11-14).** Most of this file describes the 2D-era zoom bands (the "pure, no Pixi" module). Do not build on it. It will be rewritten against the LOD0, LOD1, LOD2 and card scheme once the asset standard is approved (TODO LOD1). The "3D distance bands (city)" section is kept until then.

One module, `src/core/render/lod/lod.ts` (pure, no Pixi), holds the zoom bands and the location rule every piece of hardware reads. Tests: `lod.test.ts`. Not every chip uses every part:

| Chip | Zoom bands | Out-of-view cull (`deviceLod`) | Focus / `TierBudget` |
|---|---|---|---|
| GPU, NPU, TPM cards | yes | yes | yes (shared by `core/render/lod/lodcard.ts`) |
| Disks (HDD, SATA SSD, NVMe: `features/storage/render/diskview.ts`) | yes (`DEVICE_LOD.disk`: casing to capacity map over `fade`, architecture from `arch` 0.5, counter tier from `detail` 0.9) | yes | yes (the extent list, legend, wear and queue) |
| CPU die (multicore: each core tile by its own distance; deeper than `DEVICE_LOD.die.core` 3 to 4 only the core under the view centre shows, the shared part and the other tiles fade out) | yes | root hidden, and `die.frame(.., draw)` draws nothing while hidden (the replay still runs: it feeds the sticks and the interrupt hook) | no (it has no counter tier to budget) |
| RAM view | yes | yes (sticks plus magnifier margin); shown empty while the machine is off | no |
| PCH / chipset | no | yes (not redrawn; level and leg hits keep running) | no |
| Cooler | fade only | yes (layer hidden) | no |
| Other board parts | global bakes and labels | no | no |

`anchorOf` (`board.ts`) has its own on-screen test: it places popups and hit-tests, it is not LoD.

## What is shared
| Piece | What it does |
|---|---|
| `DEVICE_LOD` | the table of stages (the base ladder plus each device's extras): die, cooler, gpu, npu, tpm, disk, ram, labels, bakes. The views read it. Values are absolute camera zoom; the case exterior (`LOD` in `board.ts`) stays in multiples of the fit zoom |
| `smooth`, `bandAlpha`, `onBand` | one smoothstep; a layer that turns on at `z0` fades in over `z0` to `z0 * 1.15` (`TEXT_BAND`) and is hidden below `SHOWN` (0.01) alpha |
| `deviceLod(rect, view)` | where a device is: `onScreen` (view plus 10 % margin) and `focus` (1 where the middle of the device is at the view centre, falling to 0 by 0.8 of the half-diagonal of the view) |
| `BASE_LOD`, `seenZoom` | the one ladder every device shares (fade 0.4 to 0.6, names 0.8, counters 1.5, hover 0.45), in camera zoom. `seenZoom(zoom, focus)` = `zoom * (0.35 + 0.65 * focus)`: the only things that move a device along the ladder are the camera zoom and its distance from the view centre, never its size. Die, cooler, GPU, NPU, TPM and RAM all read it; extra stages (die wires/cells/subs, GPU lens, NPU fine, ...) stay per device |
| `zoomSlow(zoom, cyclesPerSec, scale)` | the multiplier of the visual clock: the game speed `scale` below zoom 0.3, easing (log zoom) to one cycle per second from zoom 1 up whatever the game speed (paused stays paused). `board.ts` uses it as the game clock and sets `zoomSlowdown` (store) to the share of the chosen speed left, which the HUD shows as a "Slow motion" pill (like Paused) while it is below 0.97 and the game is running |
| `TierBudget` | at most 2 devices show their counters at once (cards and disks: GPU, NPU, TPM, disk), the ones nearest the centre; a holder keeps its slot unless a challenger leads by 0.15. Drops are immediate |

## How it runs (per frame, `board.ts`)
The 2D per-frame wiring (`camera.onChange`, `lodFrame`, `onZoom`, the bake switches) was removed with the 2D board. The 3D board sets the live layer's zoom and view each frame in `three/boardlive3d.ts` (`setZoom`, `setView`, `setInterior`).

## The 3D room
Three culls each mesh by its bounds. The room's merges keep a merged mesh small enough for that: `mergePalette` keeps 2 m cells of space apart (`PALETTE_CELL`, see "The 3D room's draw cost" in [room.md](../../src/features/room/room.md)). Shadow casters are not cut by level, but they are switched off by it: Low's preset is `shadows: 0` and `SHADOW_LEVELS[0]` is `null`, so no room light casts at Low. The six casters exist and are off.

The room has no distance LOD. Its draw cut comes from the merges in [three.md](three.md#merges).

## The city at Low (`outside/`)
Only the Low tier cuts the city in the window (`isLow`, `room3d.ts`). High builds and draws the full city, and its picture does not change: `highident.test.ts` fingerprints High's city groups against `highident.expected.json` (refresh on purpose with `UPDATE_HIGH_GOLDEN=1`).
- **Swap.** `setCityDetail` (`room3d.ts`) replaces the window's city when the tier changes. One city is alive at a time: the old one is disposed, the new one built.
- **Far rings.** `towers.ts` keeps the two near rings of buildings (`LOW_NEAR_RINGS`) and merges the rest into one mesh of plain blocks. The streets are cut by 96 m cells (`LOW_CELL`, `detail.ts`). Small street furniture (drains, tree pits) is built only within 150 m of the window (`LOW_FURNITURE_M`, `street.ts`). Trees keep at least the `Coarse` detail, one mesh pair per ring (`trees.ts`).
- **Facade.** `lowfacade.ts` replaces the per-pixel facade shader with a Lambert. Its day and night maps are baked once (AO in the day map, the lit rooms in the night map, scaled live by the night). Far walls (from 150 to 300 m, `LOW_FAR`) go from the night map's texels to analytic windows (`lowFarWin`): one a bay and a storey, lit by a hash, each building and each storey with its own share, the edge as wide as the pixel, and their mean where a bay is under a pixel. A far tower reads as dark graphite with many small warm windows, with no texel to alias. A band's lit run is a row of rooms (`RIB_PANE`), not one slab. The eight lamps are an analytic term on the walls (`LOW_LAMPS`, reach 45 m); the PointLights stay for the street and the cars.
- **Sky.** `skynoise.ts` bakes the cloud and moon-sea noise once into a periodic 256 px map. `skyMaterial(true)` reads it, so the sky runs no live fbm loop.
- **Still steam and sway.** The steam and the leaves hold at `STILL_T` (0 s, `view.ts`). The sky, the facade's beacons and the haze keep the clock.
- **Fleet.** Half the cars drive (`LOW_FLEET` 0.5). A car is its full model within 100 m (`NEAR_LOW`) and the far box beyond. None is drawn past 350 m (`CLIP_LOW`), except on the window's avenue, which is kept out to 1000 m (`CLIP_AVENUE_LOW`, `cars.ts`). Within 100 m (`NEAR_LOW`) every moving car still drives. Beyond it a car drives when its key (`share(lane, place)`, fixed for the car) is under the share, so a car does not blink as others come and go. On Firefox, Low has no city cuts by default (`parseCityCuts` in `detail.ts`), so it also keeps a full fleet (main's city path at Low). The car paint has no clearcoat (`carMaterial(…, false)`): matt.
- **Cadence.** The city is drawn each `LOW_EVERY` (6) frames of a still eye at Low, `EVERY` (3) at High (`view.ts`, `detail.ts`). On Firefox, Low has no city cuts by default, so it also draws each `EVERY` (3) frames.
- **Isolation.** `?citycuts=a,b` keeps only the named cuts (`cadence`, `far`, `streets`, `furniture`, `trees`, `steam`, `fleet`, `palette`, `facade`, `sky`, `clock`; `facade` the lambert facade, `sky` the baked sky noise, `clock` the frozen steam and leaves), to measure what each costs. Without the query all cuts apply at Low, except on Firefox, which gets none (main's city path). An explicit `?citycuts=` list is still honoured on any browser. High has none.
- **Left.** Chrome at Low game max on the razr-fold-folded profile is still short of about 60 fps (official 3-round of 384106a: 50.0 idle / 52.4 zoom vs main 48.0 / 45.9; idle ahead, zoom ahead). Firefox Low skips all the Low city cuts by default; in that sitting idle was 59.0 vs main 62.0 (ranges do not overlap) and zoom was about flat (103.9 vs 104.2). Open look leftovers and the gate are in `docs/TODO.md` (LOOK28–LOOK33, PERF27). Far-block merge and impostors are not in these cuts.

## The machine's stand-ins
PERF6 (`partlod.ts`, `standIns` in `merge.ts`, `Machine3D.partLod`). The cost of the machine is CPU per draw, not pixels. Far away, its small parts draw as a few merged meshes.
- Status: two states, LOD0 and stand-in. A stand-in draws a part's level 1 geometry where the builder gives one ("Detail levels from the builders" below: every shape of 2,000 triangles or more has one, except instanced boxes); a shape with no level draws in full. The case shell has no LOD and no stand-in.
- A stand-in holds the same triangles with the same materials (but a part's level 1 geometry, where it has one). The picture, the shadows and the state looks do not change. Only the draw count falls. Hiding the small parts was tried and rejected: it removed visible parts.
- Size classes by world radius: 25, 50, 100, 200 units (`LOD_RADII`). A class is far while its greatest radius is under 8 px (`LOD_PX`), at the zoom of the case's nearest point. It goes back only over 10 px (`LOD_BAND` 0.25), so a zoom at the limit switches nothing.
- The overview's class (LPC5, 2026-11-14): a fifth class holds every larger mesh (a fan frame, a card, a panel). It is far under a zoom of 0.05 px per world unit (`LOD_OVERVIEW`), which is the room overview: the case is then under about 500 px tall. Its stand-ins hold most of the model's triangles, so they are made when the overview is first reached, not at each build (`owed`). The holds, the anchors and the sets work as for the small classes. Cost: a second copy of the still triangles in memory (not measured), and the build time of the stand-ins (about 90 to 140 ms in Node for the maxed machine, once). The triangles are the same, so the fine detail and its shimmer at the overview stay; a lower LOD (LPC4) is what removes them.
- Sets (`standInKey`): a still material joins a palette set of its program, across parts. A material with state (a skin, a ring, a strip, an LED) joins only the meshes of that same material object, so the stand-in shows the state with no code. An instanced mesh joins copy by copy.
- Anchors (`Machine3D.lodScope`): each fade (`fades`, `apart`), the board's small parts and the cables. The stand-ins of an anchor's content are its children, so its fade, its visibility and its motion reach them. Left out: `keep`, the side panel, the key, a card's own tree (it swings; its cooler is an anchor), a rotor, a cable's draggable end, a see-through mesh.
- A swap changes only layers. The part goes to `UNDRAWN` (`pick.ts`): no camera draws it, but the rays, `findById` and the outline still find it. Both stay `visible`, so the shadow scan sees no change and redraws no map.
- Guard: a part hidden after the build (a reveal nobody declared) makes its anchor build again without it. A part that moves alone must be an anchor or under `skip`.
- Rebuild: with the machine (`machineKey`), and the cables' anchor in `setCables`. The old geometry is freed there and in `dispose`.
- Holds (`heldBy`, `standInDraws`, `farClasses` `ceil`): Build my PC keeps every part in full detail from 0.8 of its own view's zoom in (`LOD_CEIL`). Its wheel's limit stays inside that at every aspect, so it holds no part by hand (no pointer or step hold).
- Off: the last argument of `Machine3D` (`buildMachine(s, true, false)` in tests).
- Census (maxed sandbox machine, headless): 632 drawn meshes to 398 in the room view, 441 in the phone board view; 273 parts in 19 stand-ins. Frame times: not measured here.
- Census with the overview's class (2026-11-14, maxed sandbox machine, High, `overview.test.ts`): 678 drawn meshes near, 270 at the overview. The 270 are the see-through meshes, the multi-material meshes, the rotors and the sets of one mesh. The test holds 270 as a ceiling.

### Detail levels from the builders (LOD-01, 2026-11-16)
The rule is accepted (a delegated decision, from the study below). It replaces the 30 % and 10 % ratios.
- **Rule.** A lower level is the same builder called with a `level`. It has fewer sides (4 to 8 px per side at its switch), no feature under 2 px, and its still parts in one mesh. Switch on the bbox diagonal on the screen: level 1 from 120 px down, level 2 from 60 px down (`FAN_LOD_PX`), the stand-in under 24 px. The outline moves at most 1 px at the switch. No mesh simplifier, no hand-made model.
- **Swap.** A hold band, as the stand-ins have (`LOD_BAND`). A dither fade on High and Ultra is not built.
- **The fan (`fanPart`, `fans3d.ts`).** Sides 32, 24, 16 for 120 mm (`fanLodSides`: all, three quarters, a half; even; 8 at least). The lower levels have a venturi of 4 and 2 steps (10 in full), one bevel step on the flanges, 6-side screw holes and a flatter hub dome. Triangles, 120 mm: 6,394, 3,452 and 2,488. Still meshes: 7, then 2 (the housing with the motor, and the light's ring, which carries state).
- **Outline.** `fanlod.test.ts` reads the outline from the vertices (its reach in 180 directions) and holds it within 1 px of the full part at 120 px and at 60 px. It also holds the round wall within 1 px of a true circle.
- **What draws it today.** Only the overview stand-in. The full housing carries its level 1 geometry (`geometry.userData.low`, `lowOf` in `merge.ts`). The sibling merge carries it on to the merged mesh, and `copiesOf` puts it in the stand-in. So the near view is the same mesh for mesh (`highident.test.ts` did not change), and the overview has no added draw. Housing triangles at the overview, per fan: 2,768 to 1,480 (40 mm), 3,680 to 1,828 (80 mm), 4,592 to 2,304 (120 mm), 5,504 to 2,716 (140 mm).
- **Check.** Real-GPU shots of the room overview at High, hour 14, before and after: the fan column differs in 201 of 30,800 pixels by more than 8 of 255 (peak 24), which is the level of the turning blades. By eye the fans are the same.
- **Limits.** A fan is 138 px wide at the overview's limit (0.05 px per unit), a little over the 120 px switch; the wall is then 0.6 px short of a circle. The stand-in's shadow comes from the level 1 triangles. The low geometry stays in memory beside the full one (not measured). Level 2 is built and tested, and nothing draws it: at 900 p and more, no camera rest shows a fan under 60 px. The other builders have a level 1 only (LOD-05, below). Frame time and the pop in real motion: not measured.

- **The shared builders (LOD-05, 2026-11-16).** `softBox`, `post`, `drum`, `rod` and `tube` (`geometry.ts`) give each geometry a level 1 at no cost to a builder: for a soft box the plain box while its corner stays within `LOW_TOL` (a radius up to 16), else a chamfer (108 triangles for 300), half the sides for a round shape (a multiple of 4, 8 at least; none when it has no fewer sides to give), half the steps and half the sides for a tube. `lowOf` returns a level only while it fits: the same attributes as its geometry (baked occlusion or a second UV set has no copy on the level) and the same bounds within 2 % of the size (a caller may move the vertices after the builder). `lowof.test.ts` checks both. The stand-ins of the maxed machine went from 469,020 to 427,176 vertices (9 % less); only the stand-in rows of `highident.expected.json` changed. Real-GPU overview shots at High, hour 14: the PC differs in 608 of 127,300 pixels by more than 12 of 255, and by eye it is the same.
- **Census (maxed machine, full detail, 2026-11-16).** 418,070 triangles in 1,387 meshes. The largest: the case 94,688 (outline extrudes, `slab`s, rings, rivets), the ATX cable 20,100 (`cableMesh`: 14 sides), the 10 GbE card 18,164 (solder fillets, pin coils), the PSU 12,124 (guard rings of 6 × 72), the cooler 10,876 (heat pipes of 96 × 12), each NVMe stick 10,308 (instanced fins), the VRM heatsink 10,304. These shapes are not from the shared builders, so each needs its own level (LOD-05). Four have one since 2026-11-16 (`partlod.low.test.ts`): the braided sleeve (`braidedTube`), the PSU's guard ring (`guardRing`), the heat pipe (`pipe`) and the pin coil (`pinCoil`, 4 steps a turn so its bounds hold).
- **The part kits (LOD-05, 2026-11-16).** The case kit's extrudes (`slab`, `wallX`, `plateY`, a thumbscrew's head) take a coarser outline (`coarse`, `casekit3d.ts`); `lathe` and `turned` carry a level; the gull-wing leads are a box, a can capacitor has half the sides, the NVMe label drape a coarser grain, a solder fillet one ring (`SEG.jointRingsLow`), and a sleeved cable (`cableMesh`) fewer steps and sides. Every shape of the maxed machine with 2,000 triangles or more now has a level; only the instanced boxes (12 triangles a copy) have none, as no shape is cheaper. The levels hold 78,618 triangles in 366 meshes. At the room overview (High, hour 14, `ovtris`), the drawn triangles fell from 368,246 to 287,498 (22 % less); the PC region of the before and after shots differs in 0.17 % of its pixels by more than 24 of 255, and by eye it is the same. The build of the maxed machine is about 25 ms slower in Node (213 to about 240 ms; the levels are made at the build, not when the overview is first reached).
- **The outline rule, by test.** `LOW_TOL` (12 units, half a millimetre, 0.6 px at `LOD_OVERVIEW`) is the most a level's outline may move. `outlineOff` (`geometry.ts`) reads it from the reach in the 26 directions of a cube. A soft box, a tube and a cable choose their level by it (`fitLow`: the cheapest that fits, else none; a fat mains cord keeps all its sides). `lodreach.test.ts` holds every level of the maxed machine within 1 px at the overview (worst now 15.7 units, 0.79 px, in the cooler `dev11`).
- **Left.** Making the levels lazily (when the overview is first reached, as the stand-ins are) would take the build cost back. The overview's cost is now its draws more than its triangles (LOD-02).
- **Not planned (a delegated decision, 2026-11-16).** A per-part swap to level 1 or 2 nearer than the overview, its dither fade on High and Ultra, and a measure of the pop in motion. The frame is CPU bound (draws, materials), and a per-part swap adds draws to save triangles. Level 2 stays built and tested for the fan only. Take it up again if a GPU-bound device shows the machine's triangles in a profile.

### LOD-01 popping study (2026-11-15, one fan)
This was the measurement for the decision above. It used a scratch override, before the fan had levels.
- **Method.** The first case fan (120 mm, 32 sides from `fanSides`) in the maxed sandbox machine, hour 14, yaw -55°, presets High and Low, real GPU (RTX 5080, ANGLE D3D11). A scratch override set the sides of every fan round to 24, 16, 12 or 8. Each count was shot 12 times, at 10 sizes: bbox diagonal 120, 90, 72, 60, 45, 36, 30, 23, 18 and 15 px. A crop on the fan was compared between two counts: share of pixels that differ by more than 12 of 255, and the peak difference. The size sweep stands in for the motion sweep: the camera moved back in steps, no video.
- **Limits.** Only the side count changed. No small feature was left out, no merged mesh, no shared material: the builder has no detail level yet. The small sizes come from a smaller viewport (480×320, 240×160, 120×80), because the camera leaves the room at the true distance. The override and the tools were scratch only and are not in the repo.
- **Noise floor.** Two runs of the same count: 0 to 0.1 % of the pixels on High (peak 14), 0 % on Low (peak 2). Each number below is far over it.

| Swap | Size | High: pixels, peak | Low: pixels, peak | By eye, still frame |
| --- | --- | --- | --- | --- |
| 32 → 24 | 120 px | 4.3 %, 87 | 2.4 %, 132 | no facets |
| 32 → 24 | 60 px | 2.8–4.0 %, 61–93 | 1.2–2.5 %, 53–98 | no facets |
| 32 → 16 | 60 px | 5.7–8.0 %, 66–84 | 3.5–7.3 %, 63–91 | no facets |
| 24 → 16 | 60 px | 4.2–6.8 %, 58–93 | 3.0–5.1 %, 63–91 | no facets |
| 24 → 12 | 60 px | 6.5–9.8 %, 76–109 | 4.9–7.9 %, 62–91 | facets just visible |
| 16 → 12 | 23 px | 6.5 %, 56 | 4.9 %, 46 | no facets |
| 16 → 8 | 23 px | 10.8 %, 79 | 12.0 %, 44 | no facets |
| 16 → 8 | 60 px | 9.2–11.9 %, 80–149 | 6.6–9.7 %, 77–108 | octagon visible |

(Two values at 60 px and 30 px: the same size from two viewports.)
- **Still frames.** 16 sides at 60 px and 8 sides at 24 px show no facets, on both presets. That is 8 px and about 6 px per side on the throat, inside the rule's 4–8 px. 8 sides is an octagon from 60 px up; 12 sides shows from about 60 px up.
- **The swap.** A hard swap is not free. Each step changes 2 to 12 % of the fan's pixels in one frame, at each size, with peaks of 40 to 150 of 255. The share does not fall with the size, because the edge pixels move with each new set of vertices. Low changes fewer pixels than High at 60 px (no shadow and less edge contrast), not at 23 px.
- **Not measured.** The silhouette error in px (needs a mask render), the pop in real motion (video or frame pairs across a live swap), the features under 2 px, the draw count and the frame time of a lower level.
- **Decision (2026-11-16).** The size rule and its switches are accepted. The swap is a hold band. The still picture is safe at the switches; the swap frame changes 2 to 12 % of the fan's pixels, which a dither fade would hide if it shows in motion.

## 3D distance bands (city)

The city has no LOD tiers. Distance changes detail or what is generated. Only the generation limits remove an object. Rings and tree levels only change detail. Code at `03fe0bc` (`main`):

| Thing | Band (m) | Constant (file) | Effect |
|---|---|---|---|
| Building rings | 150 / 300 / 600 / 900 / 1800 / 3600 / ∞ | `RINGS` (`outside/towers.ts:527`) | one geometry and one draw per ring; the detail does not step with the ring |
| Roof clutter, balconies | 900 | `CLUTTER` (`towers.ts:32`) | built only inside the band |
| Fine clutter variant | 420 | `FINE` (`towers.ts:32`) | a flag on the clutter inside the 900 band |
| Trees | 160 / 250 / 500 | `trees.ts:57-58` | four builds: Sprayed, Round, Coarse, Sparse; never dropped by distance |
| Moving and parked cars | 260 | `NEAR` (`cars.ts:19`) | full model inside; a box outside |
| Street detail | 520 (elliptical, `z × 0.7`) | `DETAIL` (`plan.ts:197`) | nothing placed beyond it |
| Signs | 1,500 / 3,400 | `SIGN_FAR`, `SIGN_TOWER` (`towers.ts:29`) | low-rise signs within 1,500; tower signs within 3,400 |

- The draft's ring set is 150 / 300 / 900 / 1800 / 3600 m. The building rings match it, plus one extra 600 step. The tree, car, street, fine-clutter and sign bands are off-ring. Snapping them needs one measurement origin first.
- Distance origin differs by system. Buildings, trees and street use the window (`av0`). Moving cars use the eye (`cars.ts:422`). Parked cars use the window (`cars.ts:326`).
- At Low, rings past 300 m merge, cars use 100 / 350 m and `CLIP_AVENUE_LOW` 1000 m, and Firefox skips the cuts unless `?citycuts=` is set. See [The city at Low](#the-city-at-low-outside) (code at `384106a`).
- Culling, merges and the occlusion gate are in [three.md](three.md#city-culling-and-the-firefox-occlusion-gate).

## Adding a view
Put its bands in `DEVICE_LOD`, fade layers with `bandAlpha(zoom, onBand(z0))`, key redraw signatures on the on/off flags (not on the raw zoom), and if it is a card give it `candidates(view)` and a `frame(..., lod?: CardLod)` like `gpuview.ts`, built on `cardCandidates` / `cardText` (`core/render/lod/lodcard.ts`).

## Debug and measuring
`window.__board.lod()` (dev) returns `{ reveal, interior, z, zs, bakes: { board, devices, props } }`. Frame times at the thresholds were **not measured in a browser** when this was written: use the setup of "Performance" in [case.md](case.md) (headless Chrome, SwiftShader) with a scripted wheel sweep and compare the worst frame at zoom 0.14, 0.2, 1, 2 and 3.

For the 3D renderer (parts, city and room), the debug toggles and the bench tools are in [three.md](three.md#debug-toggles-debug) and [three.md](three.md#measurement-and-tools). Frame times at the 3D distance bands are not measured.
