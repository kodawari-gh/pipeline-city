# PC parts: review list

The list of every PC component in the game, with the state of its review. Goal (2026-11-07): each part is the best it can be, fits the parts it meets, and has an animation for going in and coming out. Update a row when you finish a check.

One model per part: the case (`machine3d.ts`), Build my PC (`buildmode3d.ts`, which draws a `Machine3D`) and the gallery (`showcase.ts`) call the same builder with the same palette (`builtinTheme(true)`); only the level of detail differs. A part that wears 2D art bakes it through an `ArtSet` (`artset3d.ts`).

Legend: `[x]` done and checked, `[ ]` open, `[~]` partly. Columns: **Model** the 3D model, **Fit** it sits in its socket and clears its neighbours (`render/three/fit.test.ts`), **Graph** its removal blocks are in `sim/removal.ts`, **Anim** its fit/remove motion in the build mode.

## Parts

| Part | Specs | Model (file) | Model | Fit | Graph | Anim |
|---|---|---|---|---|---|---|
| Case (4 tiers) | `case0..3` | `case3d.ts`, `casedetail3d.ts`, `casetray3d.ts`, `fanhub3d.ts`, `basement3d.ts` | [x] mesh, door, top I/O panel reviewed up close; the grille shimmer is cut (see below); 2026-11-07: real air openings, board studs per tier, legacy rear ports; the empty case: tray, fixings, cable holes, hub, cage, front-panel leads ([render/case.md](render/case.md)) | [x] | [x] | [x] side panel swings; a swap lifts the case shell, door, lights and fans as pieces, the board stays |
| Motherboard (4 tiers) | `board-*` | `boardmodel3d.ts`, `boardhw3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] a swap lifts the board with its fixed parts, not the case |
| CPU (17 specs) | `cpu0..4w` | `cpu3d.ts` | [x] 2026-11-08: the substrate wears the package art with its capacitors standing; the die wears the die view's floorplan; a nickel lid, plain (tiers 0 to 1) or stepped, laser-etched with the model, cores, lot and matrix code, fades over the die view's band | [x] | [x] | [x] |
| CPU heatsink: stock, tower | `cooler0`, `cooler1` | `cooler3d.ts` | [x] stock (radial vanes) and tower (fins, heat pipes) reviewed up close, bare and with fans, 2026-11-07 | [x] | [x] | [x] |
| Liquid loop: pump and radiator | `cooler2`, `rad1..3` | `cooler3d.ts`, `fans3d.ts` | [x] close-up review 2026-11-07, bare core (fin ladder, tubes, rails) and with fans | [x] | [x] | [x] |
| RAM sticks (SDR to DDR5 ECC) | `ram0..5` | `ram3d.ts` | [x] close-up review 2026-11-07, no defect | [x] | [x] | [x] |
| Power supply | `psu0..4` | `basement3d.ts` | [x] close-up review (shroud, grille, sockets, rear plate); 2026-11-07: fan on the underside, rear screws, sticker | [x] | [x] | [x] the shroud cover comes off, the supply slides off the rear wall, then lifts out |
| Graphics cards | `gpu1..3` | `card3d.ts` | [x] backplate got rim screws and the maker's name; brackets darkened (they read white in the stage) | [x] | [x] | [x] |
| AI cards | `npu1..2` | `card3d.ts` | [x] same backplate work as the GPUs; flat face (die art) checked | [x] | [x] | [x] |
| Network cards | `nic1..3` | `card3d.ts` | [x] controller with pins, capacitors, resistors, crystal added (the face was a bare slab) | [x] | [x] | [x] |
| Drives: HDD, SATA SSD | `hdd0`, `ssd1` | `parts3d.ts`, `basement3d.ts` | [x] HDD (platter, arm, label) and SATA SSD (board, chips, label) reviewed up close, no defect | [x] | [x] | [x] |
| Drives: NVMe, RAID 1 | `nvme2`, `raid2` | `nvme3d.ts` | [x] 2026-11-08: rebuilt as real 3D (pass 4) | [x] | [x] | [x] |
| TPM module | `tpm1..2` | `parts3d.ts` | [x] close-up review, no defect (label, pads, trace) | [x] | [x] | [x] |
| VRM heat sinks | `vsink0..2` | `sink3d.ts` | [x] 2026-11-08: real size, screws through the board, the fan sunk in a housing at the rear-I/O end | [x] | [x] | [x] |
| RAM VRM heat sinks | `rsink0..2` | `sink3d.ts` | [x] 2026-11-08: real size, screws through the board, the fan sunk in a housing over the sink | [x] | [x] | [x] |
| Monitor | `display0..1` | `props3d.ts` (`Monitor`: the room's, also on the Build my PC stage) | [x] 2026-11-08: the stage's stand-in is gone; the stage shows the room's monitor on standby | [x] | [x] | [x] lifts off its desk spot, cables first |
| Fans (parts since 2026-11-07) | `fan92`, `fan92x`, `fan120`, `fan120x`, `fan140`, `fan140x`; `fan40` for fan fins | `fans3d.ts` | [x] one model `fanPart` on every host, close-up review 2026-11-07: frame, venturi, struts, hub badge, high-airflow look | [x] | [x] fan cable first | [x] a case fan moves off its wall, then out; a heatsink's fan lifts off |
| Chipset, battery, VRM chokes | board | `parts3d.ts`, `solids3d.ts` | [x] close-up review 2026-11-07, no defect | n/a | n/a | n/a (soldered) |

## Review pass 3 (2026-11-08): real size, mounts, detail parity

Goal: every part other than the case, the board and the CPU is real size, has its real fixings and its fan provisions, and has the detail of those three. The scale is the case's: 23 units a mm (its fans, screws and standoffs). The board's sockets are the reference for what plugs into them (the DIMM slot is 2400 long by the owner's choice). Measured with the gallery's models (`showcase.ts`), so the shop, the gallery, the game and Build my PC agree. Tick a row when its model is changed, shot in the gallery and in the game, and committed.

- [x] Stock heatsink `cooler0`: was 69 x 60 mm, 32 mm tall, its "92 mm" fan drawn 56 mm. Real: about 95 mm round, a 92 mm fan, 55 mm tall; four push pins at the socket's mounting holes. Done 2026-11-08: copper core, 60 swept vanes, a 95 mm shroud with the pins and two fan latches; the board has the four cooler holes (`COOLER_HOLES`).
- [x] Tower `cooler1`: was 69 x 60 x 99 mm, its "120 mm" fans drawn 53 mm. Real: 120 mm fans, a fin stack about 125 x 52 x 154 mm, offset north to clear the first card; a backplate, four standoffs, a cross bracket with two spring screws; fan clips on both ends (push-pull). Done 2026-11-08: 48 notched fins, four U pipes, wire clips per fan; the CPU fan lead leaves the fitted fan (`coolerFanLead`).
- [x] Pump `cooler2`: was 48 mm round. Real: about 70 mm round, 45 mm tall, a bracket on four standoffs with thumb nuts. Done 2026-11-08: a 68 mm pump on a housing and four bracket arms, its ports face north to the hoses. Then (it read as a toy: an impeller under a glass dome, violet rings, a blue drum): a 66 mm head 48 mm over the lid, a satin anodised body, a thin light ring in the case's RGB under a brushed cap with a diamond-cut edge, a small boss; black steel arms, knurled nuts. The impeller stays inside, unseen (2D too).
- [x] Radiators `rad1..3`: the gallery drew a 74 mm stand-in (`kitFit`), not the game's model. Real: one model per fan count (120 / 240 / 360), thickness by grade, fan screw holes, G1/4 fill port. Done 2026-11-08: one model for game, gallery and Build my PC, as long as its side's fans plus two end tanks; 27 / 36 / 45 mm cores by grade (`RAD_T`), inboard of the case fans; fan screw holes on both faces, G1/4 fittings and a fill plug, a model plate (its one violet touch). The cases grow to fit them.
- [x] Fans `fan40..fan140x`: frames 20 mm deep. Real: 25 mm (the 40 mm fan 10 mm). Done 2026-11-08: 25 mm frames at full size on every mount (`fanDepth`); the case mounts and screws match.
- [x] RAM `ram0..5`: length set by the slot; check the height (31.25 mm), the spreaders' thickness, the chip count, the detail parity (312 to 4456 triangles). Done 2026-11-08: the face keeps a real stick's proportions to the slot's length (31.25 mm; fins 37 mm, a light bar 44 mm); across, 23 units a mm: a 1.27 mm PCB, 1 mm chips, 5.5 to 7.3 mm with spreaders (a gap to the next stick). 16 chips (18 with ECC), SPD, PMIC on DDR5. A maker's sticker on bare sticks, the model printed on spreaders; the unlit bar smoked. The socket is 6 mm wide. Pins: 84 a face on SDR, 120 on DDR2/DDR3, 144 on DDR4/DDR5. No tier colours: the tiers read by how premium the metal looks (stamped steel DDR2, dark anodised fins DDR3, matte black and a silver pinstripe DDR4, brushed titanium and a diamond-cut edge DDR5); bare green PCBs on SDR and the server ECC sticks, black under spreaders.
- [x] VRM sinks `vsink0..2`, RAM VRM sinks `rsink0..2`: check the height, the screws through the board, the 40 mm fan's frame on the fan fins. Done 2026-11-08: 15.7 mm (CPU) and 10 mm (memory) wide castings on a thermal pad over the power stages, clear of the chokes; fins 24 mm (passive), 31 mm (big, a heat pipe), two screws through the board with nylon washers. The fan sink was a tiny edge fan, then a 40 mm fan on a plate over the rail (it read as silly): now, as real boards with an active regulator sink have it, a housing of the same casting at the CPU sink's rear-I/O end (over the whole memory sink), its fins flush under a grille cover, the 40 mm fan sunk in it facing the glass, the air out along the fin channels. The RAM bank of the micro-ATX moves 1 mm south for it; the mini-ITX's memory housing overhangs the board's top edge by 4 mm. The cases with top fans grow about 20 mm for the housings.
- [x] TPM `tpm1..2`: was 16 x 8 mm on a 2 x 6 header. Real (the ASUS TPM-SPI): 16 x 13 mm on a 14-1 header (2 x 7, 2.54 mm pitch, one pin left out as the key). Done 2026-11-08: the board has the keyed 2 x 7 header (the header row packs 1.7 mm apart); the module is 18 x 13 mm, flat on a 7 mm female connector, the 13 solder joints at its south end, its chip under the lid north of them with three decoupling caps.
- [x] NVMe `nvme2`, `raid2`: was 72 x 12 mm. Done 2026-11-08: real M.2 2280 sticks (80 x 22 mm, M key, controller, DRAM, two NAND, finned spreader) in a 24 mm socket, with the 2242/2260 holes and the 2280 standoff and screw; the slots end at x 2910.
- [x] GPUs `gpu1..3`, NPUs `npu1..2`, NICs `nic1..3`: they stood 70 mm and were one slot thick. Done 2026-11-08: a GPU's cooler stands 126 mm over the board (taller than its bracket, as most do), an AI card is full height (111 mm), a NIC low profile (69 mm) on a full-height bracket. Lengths: GPUs 170, 200 and 290 mm (the end fan blows through a window in the backplate), AI cards 170 and 200 mm, NICs 115, 135 and 145 mm; each ends west of the cable gutter of the smallest case that takes it. Slim coolers (20 to 24 mm): the slots are 30 mm apart and the next slot may hold a card, where a real GPU is two to three slots thick (a gameplay choice to make: a thick card would block the next slot). The NIC's parts are on its component side: real RJ45 jacks (16 x 13.5 x 22 mm), the controller under a finned sink on the 10 and 40 GbE cards; the AI card's shroud and PCB neutral.
- [ ] Power supply `psu0..4`: was 93 x 53 x 87 mm (the basement is 59 mm tall). Real ATX: 150 x 86 x 140 mm; SFX 125 x 63.5 x 100 mm. Needs a taller basement (a case change).
- [ ] HDD `hdd0`, SATA SSD `ssd1`: the gallery drew them at the 2D body's size, the game at the bay's (42 mm wide). Real: 3.5 in. 147 x 101.6 x 26 mm, 2.5 in. 100 x 69.85 x 7 mm. Needs wider bays (a case change).
- [ ] Monitor `display0..1`: built at the room's 18.7 units a mm; the stage and the gallery show it next to a machine at 23.

## Review pass 4 (2026-11-08): real 3D detail, no 2D art on boxes

The owner's call: the models from the NVMe on were low quality next to the coolers, the RAM and the VRM sinks. The 2D drawing pasted on a raised box (`Raise`) was a limit of the old 2D board; the 3D parts are now built as real hardware: real geometry and materials, at real size. The shared kit is `pcbkit3d.ts`: chip passives with tinned ends (0201 to 1206), moulded or lidded packages with their laser marking and pin-1 dimple, inductors, crystals, the PCB slab (its laminate edge), the solder-mask top (traces, vias, silkscreen, gold pads, cut-outs; also the underside), gold edge fingers, labels draped over the parts under them.

- [x] NVMe `nvme2`, `raid2` (`nvme3d.ts`): an 80 x 22 x 0.8 mm board with chamfered finger corners, the M key slot and the notch with its gold ring; 38 + 37 gold fingers at 0.5 mm; the PMIC with four inductors, a lidded 13 mm controller with its land-side caps and crystal, an 8 x 13 mm DRAM, two 12 x 18 mm NAND, about 150 passives; a maker's label draped over the DRAM and the NAND (name, capacity, interface, barcode, matrix code, serial); the underside's mask, test pads and serial sticker; an M2 pan-head screw into a brass hex standoff. The RAID 1 stick (11 W) wears a black anodised heat sink instead of the label: a thermal pad, chamfered base, edge skirts, two banks of fins and a plateau with a brushed silver insert, engraved; 9 mm over the board.
- [ ] TPM `tpm1..2`: rebuild without `Raise`: the PCB, the marked chip, its passives, the female 2 x 7 connector.
- [ ] GPUs `gpu1..3`: shroud chamfers, the fin stack and heat pipes, real power connectors, the bracket's ports, backplate detail, PCB passives.
- [ ] AI cards `npu1..2`, NICs `nic1..3`: the same kit (marked chips, passives, mask, the RJ45 shields).
- [ ] Power supply, drives, monitor: with their real-size work (pass 3).

## Cables (graph nodes `cable:<id>`)

`atx` 24-pin · `cpu` 8-pin · `pcie`..`pcie4` GPU leads · `video` · `lan` · `pcmains` · `monmains` · `cpufan` · `vrmfan` · `ramfan` · `sysfan` · `fan:<mount>` per case fan. Each unplugs before the part it feeds.

## Fit rules (checked in `fit.test.ts`)

- A GPU's or an NPU's cooler stands less than a finger's width (15 mm) from the next slot's card: it covers that slot (`COVERS`). A NIC leaves room.
- A card's cooler covers the M.2 sockets under it, by card and slot (`OVER_M2`): its stick cannot come out first.
- The cooler covers the CPU. The loop's radiator comes out before its pump.
- The board comes out bare. The case comes out last.
- Every part has a board tier with its slot (and a wide enough PCIe slot).

## Known visual defects

- [x] Holes flickered: the perforated sheets (case mesh, hex and slot grilles, the Mid's top cap) were hard alpha cuts on mipped textures, with the dark backing a few units behind. Now alpha-to-coverage plus a depth bias (`casekit3d.ts` `perfMat`, `case3d.ts`), and the same for the art tiles (`artlod.ts`). A second step: `perfMat` fades the sheet to a solid, darker average once a hole is under about 6 to 18 texels per pixel, because no filter draws a sub-pixel hole steadily. Measured (2026-11-07, dev server, front view with the grille, 11 frames each a 0.0015 rad turn apart, share of pixels changed by more than 90/765 between neighbours): Full case 12.93 % before, 10.72 % after the coverage mask, 6.53 % after the fade (3.52 % with the maps stripped, the floor of real motion); views with no grille are equal (0.637 and 1.965 %). Mid case (Mid board and Mid tower fitted in the stage): front 0.79 %, top 0.40 %, side 0.48 %. A 2x texture (10.70 %) and a blended alpha (11.82 %) did not help; both were dropped. The clean test is a sub-pixel step (0.00005 rad per frame, so real motion is nil and any change is shimmer): Full front 0.27 % old, 0.15 % new, 0.10 % with no holes at all (the floor); Full side 0.26 -> 0.02 %; Mid front 0.33 -> 0.008 %, Mid top 0.0095 -> 0.0035 %, Mid side 0.071 -> 0.0023 %. So the shimmer is down to the no-holes floor. The residual shares at larger steps are camera motion, not flicker: the same view gives 0 % with the camera still, 1.12 % at 0.0004 rad per frame, 6.5 % at 0.0015 and 15.3 % at 0.006, so they scale with the step. At the slow step (legit motion is tiny) the old material (alpha cut, no coverage, no bias, no fade, rebuilt in the page) against the new one: Full front 3.15 % -> 1.12 %, Mid front 2.44 % -> 0.13 %, other views equal within 0.1 point. The `__build` dev hook (`BuildStage.jump`) lets a script repeat it.
- [x] First review pass (2026-11-07, close-up shots in Build my PC): CPU socket and cooler, RAM bank, M.2 row, PCIe row, chipset, no clipping or gaps found. Cards read flat at that zoom by design.
- [x] Second pass (same day): the NPU over the NIC (it covers the next slot, as `COVERS` says), the TPM header, the HDD in the cage (platter, SATA sockets), the Mini case with its panel open and a CPU and stick fitted. No defect found; the Mini's panel swings where the 3D notes say it slides (a motion difference, not a fit one).

- [x] The "floating hex sheet" over the Full case's roof (2026-11-07): it is the roof's own vent panel, inset flush in the solid roof over the radiator mount, with its white trim. It looked like a sheet only in close-ups from above. Not a defect.

## Build my PC mode

- Entry: main menu, "Build my PC". Code: `render/three/buildmode3d.ts`, `board/ui/BuildMode.tsx`.
- Stage: the machine alone on a neutral floor, no room. Orbit camera.
- Remove: pick a part, press Remove. The graph gives the steps; each step plays its animation.
- Fit: pick a part from the bin, press Fit. Blocks come out, the part goes in, the blocks go back.
- Animation per kind: `render/three/buildmotion.ts` (keyframes, out and in: fitting plays the removal backwards with its own wording).
- Rules from the game stay in force: a cooler cannot go back without its CPU, a part needs a free socket that fits, the PSU must carry the load. A refusal shows in "What was done".
- Board and case swaps: the parts come out first. The door closes. The board lifts out (`Machine3D.boardRoots`), then the case pieces (`caseRoots`). The new case lowers over the board, then the new board settles in.
- The stage shows the room's monitor on standby (`Monitor`, props3d.ts).
- Tests: `sim/removal.test.ts` (graph), `sim/removal.game.test.ts` (plans run on the real game), `render/three/fit.test.ts` (rules vs geometry), `render/three/buildmotion.test.ts`.
