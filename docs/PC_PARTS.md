# PC parts: review list

The list of every PC component in the game, with the state of its review. Goal (2026-11-07): each part is the best it can be, fits the parts it meets, and has an animation for going in and coming out. Update a row when you finish a check.

Legend: `[x]` done and checked, `[ ]` open, `[~]` partly. Columns: **Model** the 3D model, **Fit** it sits in its socket and clears its neighbours (`render/three/fit.test.ts`), **Graph** its removal blocks are in `sim/removal.ts`, **Anim** its fit/remove motion in the build mode.

## Parts

| Part | Specs | Model (file) | Model | Fit | Graph | Anim |
|---|---|---|---|---|---|---|
| Case (4 tiers) | `case0..3` | `case3d.ts`, `casedetail3d.ts` | [~] | [x] | [x] | [x] side panel |
| Motherboard (4 tiers) | `board-*` | `machine3d.ts` | [~] | [x] | [x] | [x] |
| CPU (17 specs) | `cpu0..4w` | `chips3d.ts`, `showcase.ts` | [~] | [x] | [x] | [x] |
| CPU cooler: stock, tower | `cooler0`, `cooler1` | `cooler3d.ts` | [~] | [x] | [x] | [x] |
| Liquid loop: pump and radiator | `cooler2`, `rad1..3` | `cooler3d.ts`, `fans3d.ts` | [~] | [x] | [x] | [x] |
| RAM sticks (SDR to DDR5 ECC) | `ram0..5` | `ram3d.ts` | [~] | [x] | [x] | [x] |
| Power supply | `psu0..4` | `basement3d.ts` | [~] | [x] | [x] | [x] |
| Graphics cards | `gpu1..3` | `card3d.ts` | [~] | [x] | [x] | [x] |
| AI cards | `npu1..2` | `card3d.ts` | [~] | [x] | [x] | [x] |
| Network cards | `nic1..3` | `card3d.ts` | [~] | [x] | [x] | [x] |
| Drives: HDD, SATA SSD | `hdd0`, `ssd1` | `parts3d.ts`, `basement3d.ts` | [~] | [x] | [x] | [x] |
| Drives: NVMe, RAID 1 | `nvme2`, `raid2` | `parts3d.ts` | [~] | [x] | [x] | [x] |
| TPM module | `tpm1..2` | `parts3d.ts` | [~] | [x] | [x] | [x] |
| VRM heat sinks | `vsink0..2` | `machine3d.ts` | [~] | [x] | [x] | [x] |
| RAM VRM heat sinks | `rsink0..2` | `machine3d.ts` | [~] | [x] | [x] | [x] |
| Monitor | `display0..1` | `room3d` props | [~] | [x] | [x] | [ ] outside the case |
| Case fans | per case | `fans3d.ts` | [~] | [x] | [x] | [ ] |
| Chipset, battery, VRM chokes | board | `parts3d.ts`, `solids3d.ts` | [~] | n/a | n/a | n/a (soldered) |

## Cables (graph nodes `cable:<id>`)

`atx` 24-pin · `cpu` 8-pin · `pcie`..`pcie4` GPU leads · `video` · `lan` · `pcmains` · `monmains` · `cpufan` · `vrmfan` · `ramfan` · `sysfan` · `fan:<mount>` per case fan. Each unplugs before the part it feeds.

## Fit rules (checked in `fit.test.ts`)

- A GPU or NPU stands taller than the PCIe pitch: it covers the next PCIe slot (`COVERS`).
- The 32-lane GPU in `pcie0` of the Enthusiast board lies over all three M.2 sockets (`OVER_M2`).
- The cooler covers the CPU. The loop's radiator comes out before its pump.
- The board comes out bare. The case comes out last.
- Every part has a board tier with its slot (and a wide enough PCIe slot).

## Known visual defects

- [ ] Holes in the 3D models flicker (z-fighting at the cut-outs). Reproduce with `npm run shot`, find the coplanar faces, fix with offsets or `polygonOffset`.
- [ ] Review each model close up for the highest quality (second pass per part).

## Build my PC mode

- Entry: main menu, "Build my PC". Code: `render/three/buildmode3d.ts`, `board/ui/BuildMode.tsx`.
- Stage: the machine alone on a neutral floor, no room. Orbit camera.
- Remove: pick a part, press Remove. The graph gives the steps; each step plays its animation.
- Fit: pick a part from the bin, press Fit. Blocks come out, the part goes in, the blocks go back.
- Animation per kind: `render/three/buildmotion.ts`.
