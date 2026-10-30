# Level of detail (zoom and location)

One module, `src/render/lod.ts` (pure, no Pixi), holds the zoom bands and the location rule every piece of hardware reads. Tests: `lod.test.ts`. Not every chip uses every part:

| Chip | Zoom bands | Out-of-view cull (`deviceLod`) | Focus / `TierBudget` |
|---|---|---|---|
| GPU, NPU, TPM cards | yes | yes | yes (shared by `board/lodcard.ts`) |
| CPU die | yes | root hidden, and `die.frame(.., draw)` draws nothing while hidden (the replay still runs: it feeds the sticks and the interrupt hook) | no (it has no counter tier to budget) |
| RAM view | yes | yes (sticks plus magnifier margin); shown empty while the machine is off | no |
| PCH / chipset | no | yes (not redrawn; level and leg hits keep running) | no |
| Cooler | fade only | yes (layer hidden) | no |
| Other board parts | global bakes and labels | no | no |

`anchorOf` (`board.ts`) and `anyVisible` (`interact.ts`) have their own on-screen tests: they place popups and hit-test, they are not LoD.

## What is shared
| Piece | What it does |
|---|---|
| `LodClock` | the zoom every LoD decision reads (`zs`). It follows `camera.z` once per frame in log space (about 80 ms), so a wheel flick crosses a threshold over a few frames. The camera itself is untouched. `board.ts` owns it (`lod`), `snap` on a jump (`camera.set`) |
| `DEVICE_LOD` | the table of stages (the base ladder plus each device's extras): die, cooler, gpu, npu, tpm, ram, labels, bakes. The views and the hover gates in `board.ts` (`Z_DIE`, `Z_GPU`, ...) read it. Values are absolute camera zoom; the case exterior (`LOD` in `board.ts`) stays in multiples of the fit zoom |
| `smooth`, `bandAlpha`, `onBand` | one smoothstep; a layer that turns on at `z0` fades in over `z0` to `z0 * 1.15` (`TEXT_BAND`) and is hidden below `SHOWN` (0.01) alpha |
| `deviceLod(rect, view)` | where a device is: `onScreen` (view plus 10 % margin) and `focus` (1 where the middle of the device is at the view centre, falling to 0 by 0.8 of the half-diagonal of the view) |
| `BASE_LOD`, `seenZoom` | the one ladder every device shares (fade 0.4 to 0.6, names 0.8, counters 1.5, hover 0.45), in camera zoom. `seenZoom(zoom, focus)` = `zoom * (0.35 + 0.65 * focus)`: the only things that move a device along the ladder are the camera zoom and its distance from the view centre, never its size. Die, cooler, GPU, NPU, TPM and RAM all read it; extra stages (die wires/cells/subs, GPU lens, NPU fine, ...) stay per device |
| `zoomSlow(zoom, cyclesPerSec)` | the share of its pace the visual clock runs at: 1 below zoom 0.3, falling (log zoom) to the pace of 0.5 s per cycle at the closest zoom (6). `board.ts` multiplies the game clock by it and sets `zoomSlowdown` (store), which the HUD shows as a "Slow motion" pill (like Paused) while it is below 0.97 and the game is running |
| `TierBudget` | at most 2 devices show their counters at once (cards: GPU, NPU, TPM), the ones nearest the centre; a holder keeps its slot unless a challenger leads by 0.15. Drops are immediate |
| `ZoomSwitch` | a bake switch with a dead band (8 %): `on` below the threshold, plus a `warm` ring (15 % above it) |

## How it runs (per frame, `board.ts`)
- `camera.onChange` only marks `lodDirty`. `lodFrame` (before `live.frame`) calls `lod.update(dt, camera.z)` and, while the clock moves or the camera changed, `onZoom()` once, whatever the number of wheel events.
- `onZoom` reads `lod.zs`: exterior crossfade and `live.setInterior` (`LOD.*` times the fit zoom), cooler and die alpha, labels, `die.setZoom`, `live.setZoom`, and the bakes through three `ZoomSwitch` (board 0.2, devices 0.14, props 0.2). It also tells `live.setView(view)` the world rectangle on screen.
- Detail layers fade (alpha band) instead of popping: the die's layers (`dieview.setZoom`), the card names and counters (`gpuview`, `npuview`, `tpmview`), the RAM view, both magnifiers.
- Location: a card out of view is hidden and not drawn (`RectCache` in `board/lodrect.ts`, its rect found once from its bounds). Its replay keeps advancing (the sim side is untouched). The die root is hidden when the die is out of view (or faded out, or the exterior covers the board) and its frame then only runs the replay, since that feeds the RAM view and the interrupt hook; the drawing resumes from fresh signatures when it is back. A card gets its counters only if it is in `live.ts`'s `TierBudget` top set.
- Bakes: baked sprites are drawn at 1 % in the warm ring so their texture is uploaded before the swap (`stageBake`); the cached layers (monitor, props) are made in the warm ring too; the room bake (`room.ts setView`) has an 8 % dead band. The one-off bake itself still costs a frame, it is moved off the swap, not removed.
- Text: see "Text sharpness" in [live.md](live.md): the resolution step has hysteresis and a new step is applied 250 texts a frame; the label size rule runs once per frame, not per input event (`Camera.apply(defer)`).
- RAM outlines redraw per quarter octave of zoom (about 19 %), not per 0.25 of zoom.

## Adding a view
Put its bands in `DEVICE_LOD`, fade layers with `bandAlpha(zoom, onBand(z0))`, key redraw signatures on the on/off flags (not on the raw zoom), and if it is a card give it `candidates(view)` and a `frame(..., lod?: CardLod)` like `gpuview.ts`, built on `cardCandidates` / `cardText` (`board/lodcard.ts`).

## Debug and measuring
`window.__board.lod()` (dev) returns `{ extA, reveal, interior, z, zs, bakes: { board, devices, props } }`. Frame times at the thresholds were **not measured in a browser** when this was written: use the setup of "Performance" in [case.md](case.md) (headless Chrome, SwiftShader) with a scripted wheel sweep and compare the worst frame at zoom 0.14, 0.2, 1, 2 and 3.
