# PC parts: review list

The list of every PC component in the game, with the state of its review. Goal (2026-11-07): each part is the best it can be, fits the parts it meets, and has an animation for going in and coming out. Update a row when you finish a check.

Legend: `[x]` done and checked, `[ ]` open, `[~]` partly. Columns: **Model** the 3D model, **Fit** it sits in its socket and clears its neighbours (`render/three/fit.test.ts`), **Graph** its removal blocks are in `sim/removal.ts`, **Anim** its fit/remove motion in the build mode.

## Parts

| Part | Specs | Model (file) | Model | Fit | Graph | Anim |
|---|---|---|---|---|---|---|
| Case (4 tiers) | `case0..3` | `case3d.ts`, `casedetail3d.ts` | [x] mesh, door, top I/O panel reviewed up close; the grille shimmer is cut (see below) | [x] | [x] | [x] side panel swings; a swap lifts the case shell, door, lights and fans as pieces, the board stays |
| Motherboard (4 tiers) | `board-*` | `machine3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] a swap lifts the board with its fixed parts, not the case |
| CPU (17 specs) | `cpu0..4w` | `chips3d.ts`, `showcase.ts` | [x] socket, pins and lid reviewed up close, no defect | [x] | [x] | [x] |
| CPU cooler: stock, tower | `cooler0`, `cooler1` | `cooler3d.ts` | [x] stock (radial vanes, fan) and tower (fins, heat pipes) reviewed up close, no defect | [x] | [x] | [x] |
| Liquid loop: pump and radiator | `cooler2`, `rad1..3` | `cooler3d.ts`, `fans3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] |
| RAM sticks (SDR to DDR5 ECC) | `ram0..5` | `ram3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] |
| Power supply | `psu0..4` | `basement3d.ts` | [x] close-up review, no defect (shroud, grille, sockets, rear plate) | [x] | [x] | [x] |
| Graphics cards | `gpu1..3` | `card3d.ts` | [x] backplate got rim screws and the maker's name; brackets darkened (they read white in the stage) | [x] | [x] | [x] |
| AI cards | `npu1..2` | `card3d.ts` | [x] same backplate work as the GPUs; flat face (die art) checked | [x] | [x] | [x] |
| Network cards | `nic1..3` | `card3d.ts` | [x] controller with pins, capacitors, resistors, crystal added (the face was a bare slab) | [x] | [x] | [x] |
| Drives: HDD, SATA SSD | `hdd0`, `ssd1` | `parts3d.ts`, `basement3d.ts` | [x] HDD (platter, arm, label) and SATA SSD (board, chips, label) reviewed up close, no defect | [x] | [x] | [x] |
| Drives: NVMe, RAID 1 | `nvme2`, `raid2` | `parts3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] |
| TPM module | `tpm1..2` | `parts3d.ts` | [x] close-up review, no defect (label, pads, trace) | [x] | [x] | [x] |
| VRM heat sinks | `vsink0..2` | `machine3d.ts` | [~] | [x] | [x] | [x] |
| RAM VRM heat sinks | `rsink0..2` | `machine3d.ts` | [~] | [x] | [x] | [x] |
| Monitor | `display0..1` | stage proxy in `buildmode3d.ts` | [x] the screen was a blue slab; it now shows a console (title bar, boot lines, prompt, scan lines) | [x] | [x] | [x] lifts off its desk spot, cables first |
| Case fans | per case | `fans3d.ts` | [~] | [x] | [x] fan cable first | [x] "Swap" in the machine list |
| Chipset, battery, VRM chokes | board | `parts3d.ts`, `solids3d.ts` | [x] close-up review 2026-11-07, no defect | n/a | n/a | n/a (soldered) |

## Cables (graph nodes `cable:<id>`)

`atx` 24-pin · `cpu` 8-pin · `pcie`..`pcie4` GPU leads · `video` · `lan` · `pcmains` · `monmains` · `cpufan` · `vrmfan` · `ramfan` · `sysfan` · `fan:<mount>` per case fan. Each unplugs before the part it feeds.

## Fit rules (checked in `fit.test.ts`)

- A GPU or NPU stands taller than the PCIe pitch: it covers the next PCIe slot (`COVERS`).
- The 32-lane GPU in `pcie0` of the Enthusiast board lies over all three M.2 sockets (`OVER_M2`).
- The cooler covers the CPU. The loop's radiator comes out before its pump.
- The board comes out bare. The case comes out last.
- Every part has a board tier with its slot (and a wide enough PCIe slot).

## Known visual defects

- [x] Holes flickered: the perforated sheets (case mesh, hex and slot grilles, the Mid's top cap) were hard alpha cuts on mipped textures, with the dark backing a few units behind. Now alpha-to-coverage plus a depth bias (`casekit3d.ts` `perfMat`, `case3d.ts`), and the same for the art tiles (`artlod.ts`). A second step: `perfMat` fades the sheet to a solid, darker average once a hole is under about 6 to 18 texels per pixel, because no filter draws a sub-pixel hole steadily. Measured (2026-11-07, dev server, front view with the grille, 11 frames each a 0.0015 rad turn apart, share of pixels changed by more than 90/765 between neighbours): Full case 12.93 % before, 10.72 % after the coverage mask, 6.53 % after the fade (3.52 % with the maps stripped, the floor of real motion); views with no grille are equal (0.637 and 1.965 %). Mid case (Mid board and Mid tower fitted in the stage): front 0.79 %, top 0.40 %, side 0.48 %. A 2x texture (10.70 %) and a blended alpha (11.82 %) did not help; both were dropped. The residual shares are camera motion, not flicker: the same view gives 0 % with the camera still, 1.12 % at 0.0004 rad per frame, 6.5 % at 0.0015 and 15.3 % at 0.006, so they scale with the step. At the slow step (legit motion is tiny) the old material (alpha cut, no coverage, no bias, no fade, rebuilt in the page) against the new one: Full front 3.15 % -> 1.12 %, Mid front 2.44 % -> 0.13 %, other views equal within 0.1 point. The `__build` dev hook (`BuildStage.jump`) lets a script repeat it.
- [x] First review pass (2026-11-07, close-up shots in Build my PC): CPU socket and cooler, RAM bank, M.2 row, PCIe row, chipset, no clipping or gaps found. Cards read flat at that zoom by design.
- [x] Second pass (same day): the NPU over the NIC (it covers the next slot, as `COVERS` says), the TPM header, the HDD in the cage (platter, SATA sockets), the Mini case with its panel open and a CPU and stick fitted. No defect found; the Mini's panel swings where the 3D notes say it slides (a motion difference, not a fit one).

## Build my PC mode

- Entry: main menu, "Build my PC". Code: `render/three/buildmode3d.ts`, `board/ui/BuildMode.tsx`.
- Stage: the machine alone on a neutral floor, no room. Orbit camera.
- Remove: pick a part, press Remove. The graph gives the steps; each step plays its animation.
- Fit: pick a part from the bin, press Fit. Blocks come out, the part goes in, the blocks go back.
- Animation per kind: `render/three/buildmotion.ts` (keyframes, out and in: fitting plays the removal backwards with its own wording).
- Rules from the game stay in force: a cooler cannot go back without its CPU, a part needs a free socket that fits, the PSU must carry the load. A refusal shows in "What was done".
- Board and case swaps: the parts come out first. The door closes. The board lifts out (`Machine3D.boardRoots`), then the case pieces (`caseRoots`). The new case lowers over the board, then the new board settles in.
- Limits: the stage monitor is a plain stand-in for the room's. The model rows stay `[~]`: the close-up reviews found no defect, but no part got a new model pass.
- Tests: `sim/removal.test.ts` (graph), `sim/removal.game.test.ts` (plans run on the real game), `render/three/fit.test.ts` (rules vs geometry), `render/three/buildmotion.test.ts`.
