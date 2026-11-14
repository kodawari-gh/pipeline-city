# Level of detail (zoom and location)

> **Outdated (2026-11-14).** Most of this file describes the 2D-era zoom bands (the "pure, no Pixi" module). Do not build on it. It will be rewritten against the LOD0, LOD1, LOD2 and card scheme once the asset standard is approved (TODO LOD1). The "3D distance bands (city)" section is kept until then.

One module, `src/core/render/lod/lod.ts` (pure, no Pixi), holds the zoom bands and the location rule every piece of hardware reads. Tests: `lod.test.ts`. Not every chip uses every part:

| Chip | Zoom bands | Out-of-view cull (`deviceLod`) | Focus / `TierBudget` |
|---|---|---|---|
| GPU, NPU, TPM cards | yes | yes | yes (shared by `board/lodcard.ts`) |
| Disks (HDD, SATA SSD, NVMe: `board/diskview.ts`) | yes (`DEVICE_LOD.disk`: casing to capacity map over `fade`, architecture from `arch` 0.5, counter tier from `detail` 0.9) | yes | yes (the extent list, legend, wear and queue) |
| CPU die (multicore: each core tile by its own distance; deeper than `DEVICE_LOD.die.core` 3 to 4 only the core under the view centre shows, the shared part and the other tiles fade out) | yes | root hidden, and `die.frame(.., draw)` draws nothing while hidden (the replay still runs: it feeds the sticks and the interrupt hook) | no (it has no counter tier to budget) |
| RAM view | yes | yes (sticks plus magnifier margin); shown empty while the machine is off | no |
| PCH / chipset | no | yes (not redrawn; level and leg hits keep running) | no |
| Cooler | fade only | yes (layer hidden) | no |
| Other board parts | global bakes and labels | no | no |

`anchorOf` (`board.ts`) and `anyVisible` (`interact.ts`) have their own on-screen tests: they place popups and hit-test, they are not LoD.

## What is shared
| Piece | What it does |
|---|---|
| `LodClock` | the zoom every LoD decision reads (`zs`). It follows `camera.z` once per frame in log space (about 80 ms), so a wheel flick crosses a threshold over a few frames. The camera itself is untouched. `board.ts` owns it (`lod`), `snap` on a jump (`camera.set`) |
| `DEVICE_LOD` | the table of stages (the base ladder plus each device's extras): die, cooler, gpu, npu, tpm, disk, ram, labels, bakes. The views and the hover gates in `board.ts` (`Z_DIE`, `Z_GPU`, ...) read it. Values are absolute camera zoom; the case exterior (`LOD` in `board.ts`) stays in multiples of the fit zoom |
| `smooth`, `bandAlpha`, `onBand` | one smoothstep; a layer that turns on at `z0` fades in over `z0` to `z0 * 1.15` (`TEXT_BAND`) and is hidden below `SHOWN` (0.01) alpha |
| `deviceLod(rect, view)` | where a device is: `onScreen` (view plus 10 % margin) and `focus` (1 where the middle of the device is at the view centre, falling to 0 by 0.8 of the half-diagonal of the view) |
| `BASE_LOD`, `seenZoom` | the one ladder every device shares (fade 0.4 to 0.6, names 0.8, counters 1.5, hover 0.45), in camera zoom. `seenZoom(zoom, focus)` = `zoom * (0.35 + 0.65 * focus)`: the only things that move a device along the ladder are the camera zoom and its distance from the view centre, never its size. Die, cooler, GPU, NPU, TPM and RAM all read it; extra stages (die wires/cells/subs, GPU lens, NPU fine, ...) stay per device |
| `zoomSlow(zoom, cyclesPerSec, scale)` | the multiplier of the visual clock: the game speed `scale` below zoom 0.3, easing (log zoom) to one cycle per second from zoom 1 up whatever the game speed (paused stays paused). `board.ts` uses it as the game clock and sets `zoomSlowdown` (store) to the share of the chosen speed left, which the HUD shows as a "Slow motion" pill (like Paused) while it is below 0.97 and the game is running |
| `TierBudget` | at most 2 devices show their counters at once (cards and disks: GPU, NPU, TPM, disk), the ones nearest the centre; a holder keeps its slot unless a challenger leads by 0.15. Drops are immediate |
| `ZoomSwitch` | a bake switch with a dead band (8 %): `on` below the threshold, plus a `warm` ring (15 % above it) |

## How it runs (per frame, `board.ts`)
- `camera.onChange` only marks `lodDirty`. `lodFrame` (before `live.frame`) calls `lod.update(dt, camera.z)` and, while the clock moves or the camera changed, `onZoom()` once, whatever the number of wheel events.
- `onZoom` reads `lod.zs`: exterior crossfade and `live.setInterior` (`LOD.*` times the fit zoom), cooler and die alpha, labels, `die.setZoom`, `live.setZoom`, and the bakes through three `ZoomSwitch` (board 0.2, devices 0.14, props 0.2). It also tells `live.setView(view)` the world rectangle on screen.
- Detail layers fade (alpha band) instead of popping: the die's layers (`dieview.setZoom`), the card names and counters (`gpuview`, `npuview`, `tpmview`), the RAM view, both magnifiers.
- Location: a card out of view is hidden and not drawn (`RectCache` in `board/lodrect.ts`, its rect found once from its bounds). Its replay keeps advancing (the sim side is untouched). The die root is hidden when the die is out of view (or faded out, or the exterior covers the board) and its frame then only runs the replay, since that feeds the RAM view and the interrupt hook; the drawing resumes from fresh signatures when it is back. A card gets its counters only if it is in `live.ts`'s `TierBudget` top set.
- Bakes: baked sprites are drawn at 1 % in the warm ring so their texture is uploaded before the swap (`stageBake`); the cached layers (monitor, props) are made in the warm ring too; the room bake (`room.ts setView`) has an 8 % dead band. The one-off bake itself still costs a frame, it is moved off the swap, not removed.
- Text: see "Text sharpness" in [live.md](live.md): the resolution step has hysteresis and a new step is applied 250 texts a frame; the label size rule runs once per frame, not per input event (`Camera.apply(defer)`).
- RAM outlines redraw per quarter octave of zoom (about 19 %), not per 0.25 of zoom.

## The 3D room
Three culls each mesh by its bounds. The room's merges keep a merged mesh small enough for that: `mergePalette` keeps 2 m cells of space apart (`PALETTE_CELL`, see "The 3D room's draw cost" in [room.md](../../src/features/room/room.md)). Shadow casters are not cut by level: at Low all six room lights still cast.

The room has no distance LOD. Its draw cut comes from the merges in [three.md](three.md#merges).

## The machine's stand-ins
PERF6 (`partlod.ts`, `standIns` in `merge.ts`, `Machine3D.partLod`). The cost of the machine is CPU per draw, not pixels. Far away, its small parts draw as a few merged meshes.
- Status at `03fe0bc`: two states only, LOD0 and stand-in. LOD1 (30 %) and LOD2 (10 %) are planned and not present. No part or case item has either. The case shell has no LOD and no stand-in.
- A stand-in holds the same triangles with the same materials. The picture, the shadows and the state looks do not change. Only the draw count falls. Hiding the small parts was tried and rejected: it removed visible parts.
- Size classes by world radius: 25, 50, 100, 200 units (`LOD_RADII`). A larger mesh has no stand-in. A class is far while its greatest radius is under 8 px (`LOD_PX`), at the zoom of the case's nearest point. It goes back only over 10 px (`LOD_BAND` 0.25), so a zoom at the limit switches nothing.
- Sets (`standInKey`): a still material joins a palette set of its program, across parts. A material with state (a skin, a ring, a strip, an LED) joins only the meshes of that same material object, so the stand-in shows the state with no code. An instanced mesh joins copy by copy.
- Anchors (`Machine3D.lodScope`): each fade (`fades`, `apart`), the board's small parts and the cables. The stand-ins of an anchor's content are its children, so its fade, its visibility and its motion reach them. Left out: `keep`, the side panel, the key, a card's own tree (it swings; its cooler is an anchor), a rotor, a cable's draggable end, a see-through mesh.
- A swap changes only layers. The part goes to `UNDRAWN` (`pick.ts`): no camera draws it, but the rays, `findById` and the outline still find it. Both stay `visible`, so the shadow scan sees no change and redraws no map.
- Guard: a part hidden after the build (a reveal nobody declared) makes its anchor build again without it. A part that moves alone must be an anchor or under `skip`.
- Rebuild: with the machine (`machineKey`), and the cables' anchor in `setCables`. The old geometry is freed there and in `dispose`.
- Holds (`heldBy`, `standInDraws`, `farClasses` `ceil`): Build my PC keeps every part in full detail from 0.8 of its own view's zoom in (`LOD_CEIL`). Its wheel's limit stays inside that at every aspect, so it holds no part by hand (no pointer or step hold).
- Off: the last argument of `Machine3D` (`buildMachine(s, true, false)` in tests).
- Census (maxed sandbox machine, headless): 632 drawn meshes to 398 in the room view, 441 in the phone board view; 273 parts in 19 stand-ins. Frame times: not measured here.

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
- **Not on main:** PR #23 (`perf/low-city-draws`, `3cf8755`) merges every building ring past 300 m into one mesh at Low, and moves the car full model to 100 m and the car clip to 350 m. Main has none of this.
- Culling, merges and the occlusion gate are in [three.md](three.md#city-culling-and-the-firefox-occlusion-gate).

## Adding a view
Put its bands in `DEVICE_LOD`, fade layers with `bandAlpha(zoom, onBand(z0))`, key redraw signatures on the on/off flags (not on the raw zoom), and if it is a card give it `candidates(view)` and a `frame(..., lod?: CardLod)` like `gpuview.ts`, built on `cardCandidates` / `cardText` (`board/lodcard.ts`).

## Debug and measuring
`window.__board.lod()` (dev) returns `{ extA, reveal, interior, z, zs, bakes: { board, devices, props } }`. Frame times at the thresholds were **not measured in a browser** when this was written: use the setup of "Performance" in [case.md](case.md) (headless Chrome, SwiftShader) with a scripted wheel sweep and compare the worst frame at zoom 0.14, 0.2, 1, 2 and 3.

For the 3D renderer (parts, city and room), the debug toggles and the bench tools are in [three.md](three.md#debug-toggles-debug) and [three.md](three.md#measurement-and-tools). Frame times at the 3D distance bands are not measured.
