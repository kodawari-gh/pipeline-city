# Board rendering (PixiJS)

Code: `src/render/` (`board/`, `die/`, `room/` and a few files at the top; the file tables give bare names). Entry point `mountBoard(host)` in `board.ts` (called from `main.tsx`). It reads `snapshot` and `speed` from `src/game/store` and writes `hover` / `selected` in `src/game/hover`. It never touches sim internals; the only sim import is the declarative spec table (`getSpec`, `BOARD_TIERS`) for the `visual` key and slot counts.

This file is the hub: world layout, layers, theme, snapshot fields, known gaps and the last verification. Read the area file for the topic, not all of them:

| Topic | File |
|---|---|
| camera and flights, hover / selected ids, hit testing, drag and drop, tutorial rings, anchors | [`render/interact.md`](render/interact.md) |
| bus activity, boot visuals, power-off look, performance, trace and stepping | [`render/live.md`](render/live.md) |
| orderly routing, pin map, board tiers, cases and the VRM | [`render/board.md`](render/board.md) |
| the case, the bay and the OS screen, far-zoom exterior (LOD), installed devices, rear I/O, PSU face | [`render/case.md`](render/case.md) |
| router, wall plate, ethernet cable, NIC cards | [`render/net.md`](render/net.md) |
| the room: desk props, key rack and mail, USB keys, wall cords, power lens | [`render/room/room.md`](render/room/room.md) |
| the room's wall, floor, ceiling, desk, perspective, camera cap, baking | [`render/room/shell.md`](render/room/shell.md) |
| the window, game-time clock, time of day, the room's light | [`render/room/light.md`](render/room/light.md) |
| zoom bands of every device, smoothed zoom, off-screen skipping, bake switches | [`render/lod.md`](render/lod.md) |
| the CPU die and the memory map | [`DIE.md`](DIE.md) |

## Files

| File | Role |
|---|---|
| `board.ts` | scene graph, scene rebuild, LOD by zoom, hit-testing, snapshot effect, frame loop |
| `theme.ts` | theme tokens (below) |
| `layout.ts` | world coordinates (die floorplan, monitor, tray, router shelf) and the **tier-dependent** ones as live bindings (`setLayoutTier(boardTier, caseTier)`: board, DIMMs, VRMs, PSU, bay, case, world box), seeded PRNG, hover regions |
| `thumbs.ts` | pictures of parts for the shop, inventory and picker: the real art rendered to cached data URLs |
| `cpuplan.ts`, `cpufloor.ts`, `cpuplans.ts` | the **CPU die floorplans as data** (blocks, links, cell grids per architecture; pure geometry, tested), see [`DIE.md`](DIE.md) |
| `dieart.ts` | the static art of a die from its plan: `dieFar` (blocks, stage frames, bond pads; baked with the CPU by `cpuArt`) and `dieNear` (trace bundles, cell arrays, names) |
| `dieview.ts` | the die in motion (`DieView`): instruction chips in their blocks per lane and unit, the out-of-order structures as cells coloured by state, event flashes and link pulses, the levels of detail by zoom |
| `ink.ts` | small Graphics / Text helpers |

## World layout

```
 monitor ---- video cable ---- [ motherboard ] | cable gutter
 (16:9, stand)   (HDMI)        rear I/O west   |  PSU cables rise to the east-edge connectors
 key tray, power plate below the monitor
                              [ PSU shroud, full width, readout panel, output sockets ]
```

The CPU socket is the origin. West of the board: the **monitor** (a 24 inch: scaled `MONITOR_K` 3.0x, about as wide as the case is deep, its east edge `MONITOR_EAST` 2,300 west of the case's rear wall; it stands on its foot on the desk, so it **follows the desk top**, that is the case tier: `MONITOR`, `SCREEN`, the video socket and the router shelf are live bindings set by `setLayoutTier`), the **key rack** (`TRAY`: two rails of hooks with the USB sticks hanging on lanyards) on the wall above it, above it the router shelf (scaled 1.45x). The ISP's wall plate is under the desk by the power socket. There is no crate in the world: the inventory is an HTML menu (`src/ui`) that starts part drags with `beginPartDrag`. The board's size and everything under and around it depends on the tier (see "Board tiers, cases and the VRM" in [render/board.md](render/board.md)): the board's west edge is always x -3400 and its top is tier-dependent; the PSU shroud sits `250` below its south edge, the drive bay east of the shroud. `WORLD` in `layout.ts` is the content box the overview fits: tight, from the monitor on the west to the case's east wall, from the router shelf (above the monitor) to the feet; it changes with the case, and the camera glides to the new overview when the case (or board tier) changes. The overview uses `OVERVIEW_MARGIN` (0.96); the device bake uses `WORLD` as its frame. On a board: rear I/O on the west edge (HDMI at the height of the video cable), the USB hub controller between I/O and CPU, the VRM row north of the CPU, the chipset south-east of the CPU (below the memory, east of the slots' ends), the DIMMs east, the memory VRM above them, PCIe slots south, M.2 south-east, the 24-pin and SATA ports on the east edge, the 8-pin on the top edge.

## Layers (bottom to top)

(Everything in this list up to the live layer is inside the `interior` group; the monitor, the video cable and the props are above the exterior layer, see the LOD section.)

1. **Board**: `buildBoard(theme, boardTier)`, deterministic, built once per (theme, tier, installed set) and never touched per frame. Retained Pixi geometry plus a **baked texture** (0.4x) shown instead of the vector board below zoom 0.2.
2. **Devices**: static art per installed device (CPU, DIMMs by `slot`, PSU, monitor, cables). Empty typed slots are visible sockets and dashed bays. Below zoom 0.14 the whole layer is one **baked texture** (0.25x). The PSU fan (blades plus grill) lives in a separate `fanLayer` above the bake so it keeps spinning; the cooler has its own layer.
3. **Cooler** sits on the CPU and fades out between zoom 0.3 and 0.5 to reveal the die. An **empty cooler slot** (`cooler0`, the normal start state until the cooler is mounted after the CPU) is a dashed outline in this same layer, above the package, so it reads as the drop target; it fades with the cooler. The `NO CPU COOLER` POST error shows on the monitor when the cable is connected.
4. **Pipeline view** fades in between zoom 0.42 and 0.58.
5. **Live layer**: lit buses and pulses, cable glow, PSU readout, heat glow, burnt overlay, throttle badge, CLI monitor text, DRAM flashes.

Rebuild happens only when the theme, `boardTier` or the set of `spec@slot` pairs changes. Temperature, clocks, power etc. never rebuild anything.

## Visual hierarchy

Working parts (CPU, DIMMs, cooler, PSU, monitor, the cables) use the full theme tokens at full contrast. Passive parts (VRM, chipset, M.2, SATA, I/O, connectors, PCIe slots) and all dim traces use `makePalette(theme)` in `theme.ts`, which mixes the tokens toward the board colour. Decoration (a few SMD rows, a tiny QR sticker and hex patch, silkscreen) is quieter still. The board base colour is `mix(board, bg)` (dark) or `mix(board, white)` (light), so it recedes behind the parts.

## Theme tokens

`readTheme()` reads CSS custom properties from `:root` (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`, the legacy names) and falls back to built-in dark/light palettes for any that are undefined. Dark or light: `data-theme="dark|light"` on `<html>` wins, else `prefers-color-scheme`. A `MutationObserver` on `data-theme` plus a `matchMedia` listener rebuilds the scene and the background colour on change. Colours must be `#rgb` / `#rrggbb` for the heat colour blend; anything else still draws but does not blend.

## Snapshot fields consumed

`boardTier` (new), `devices[]` (`id, spec, kind, slot` (new), `burnt, effectiveClock, tempC, powerW, throttle, unstable`), `power` (`totalW, budgetW, tripped, off`), `request` (an id change means a program load), `display` (monitor text; a change lights the video path), `counters` (`cycles`, `cacheMisses`, `stallCache` for RAM traffic), `pipe` (MEM stage op for stores).

New in `Snapshot` (`src/sim/game/types.ts`, additive, existing consumers untouched):

- `boardTier: number`
- `DeviceSnap.slot: string` (e.g. `dimm1`)
- `pipe: null | PipeSnap` (`src/sim/game/pipesnap.ts`): `{ width, stages: StageSnap[width * 5] (index stage * width + lane; empty for the out-of-order engine), ooo?: OooSnap }`. `StageSnap = { kind (0 empty, 1 instruction, 2 bubble), id (dynamic instruction id, -1 for none), op (mnemonic), text (full disassembly), cause (bubble cause: 0 none, 1 load, 2 data, 3 flush, 4 struct), stalled }`. Null when no request is running. Built from `engine.view` (stage arrays plus the timeline word for the mnemonic). `OooSnap` = `{ fetchQ (mnemonics, oldest first), decode (per lane), rob (the physical ring: op + RobState), robHead, robCount, sched (op + SchedWhy per slot), units (ALU0 ALU1 MUL LSU: op, left, total), stall [fetch, dispatch, commit] }`; about 1 KB.

## Live state mapping

- Heat glow colour: temperature blend cyan, amber, red (red when `unstable`), only above about 42 C. Burnt: dark overlay with a red X, no glow.
- Badge above the CPU: `THROTTLED n%`, `UNSTABLE`, `PSU TRIPPED`, `NO POWER`, `CPU BURNT OUT`.
- Fans (cooler or liquid pump, PSU, and the VRM heatsink fan `vrm-sink-fan`) spin faster with CPU temperature, PSU load, and CPU load (VRM sink fan). They run whenever the machine is **on**, including `halted` and `error` (a halted machine is still powered): `liveOn = snapshot.powered && !power.off && !power.tripped && !board.burnt`. A fan that loses that (off, tripped, dead) is still on the next frame (no coasting).
- CLI monitor shows `snapshot.display` (`READY.` when idle and empty): the last 8 lines, wrapped at 32 columns, in 150 world unit type so it reads at overview zoom.
- Pipeline: chips are keyed by dynamic instruction id and coloured by class (alu cyan, mul violet, load amber, store green, branch/jump magenta). Bubbles are dashed boxes labelled by cause (flush in red, with the tile tinted). Stalled occupants get an amber ring. Chips tween from their old stage to the new one over about 0.8 of the time since the last snapshot (max 0.9 s); retired chips slide out of WB, squashed ones drop and fade. No tweening at 4x/16x or when snapshots arrive faster than 350 ms apart.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- At far zoom the monitor text is small (zoom scales it with everything else; it is readable down to about 0.5x of the fit zoom, a shape only below). The exterior is baked at 0.35x, so it is soft if forced visible at high zoom (it never is, the LOD fades it out above 0.7x). The 8 DIMM sockets use shorter sticks (4 chips) than the old single bank, and the second row's memory taps are drawn but only lit by the shared memory bus.
- The liquid cooler is an AIO (no reservoir): two tubes run from the pump on the CPU to a radiator the player bolted along the front or the top of the case, spanning every fan of that side (`radiatorSpan(side)` in `room/case.ts` is the one box round them, `ids` the mounts; those mounts' own fans are not drawn then), drawn by `radiatorArt` (a slab with one live `EdgeFan` per mount) / `tubeRoutes` in `board/cooler.ts`. The rear has no radiator. Every fan has a cable (`board/fancords.ts`, plugs the player drags to their headers; a fan spins only with its cable in, `live.ts`). No GPU, NVMe, SATA or USB devices exist in the sim, so those buses never light (the PCIe cable is plumbed but never drawn).
- PSU temperature and fan rpm are renderer estimates from load (see above).
- Touch was verified with synthesized touch events (CDP), not on a device: tap to select, one-finger pan, two-finger pinch, and dragging a drive from the shelf onto `sata0` (see Verification). There is no hover on touch. Installed parts cannot be dragged back out (the UI picker uninstalls). Loose cable plugs and tray keys are small at overview zoom (use the tutorial rings, `flyTo` or zoom).
- Bus lanes are 9-11 world units wide, about a pixel at overview zoom; the pulses carry the activity there.
- Two drives: the SATA data cables cross the drives' short power leads in the lane between the PSU and the bay, and all three PSU cables in the gutter (drawn beneath them).
- The OS-flow cue (`REMOVE` on an OS-flashed key) is **not verified end to end**. An OS is reachable now (the sandbox buys it and installs it on a drive), but the browser run with real clicks did not reach the state: the power button did not leave `OFF` and a click on a tray key opens the client card rather than plugging it (the card's "Plug into USB" button is the plug). It uses the same `stage` `done` path as the no-OS cue.
- The VRM crash flash and the error blink were not provoked in the browser (no fault was run); their wall-time fade is by code.
- Overview on a wide canvas: the scene is about 1.7:1 and the free height is the limit, so the sides stay empty. Tightening the bounds gained about 5%.
- The die view shows no cache lines, register writes or interrupt-controller activity yet (the snapshot does not carry them): the D-cache flashes on a miss, the register file on a retire.

## Verification (last pass)

Headless Chrome (software GL), 1360x800 and 1920x1080, through `window.__board`: a no-OS job run to `JOB DONE` at 16x, then the cue checked at the overview and at 0.5x of the overview (dark and light). Paused: two frames of the key area are byte-identical 1.5 s apart, and they change again on resume. PSU readout: 27 C under load, 25 C COLD 150 ms after a hard power-off. Hover: `monitor` and `psu` write their stable ids. SATA: one drive in `sata0` routed under the PSU, checked close up. Overview: the scene is 4-6% larger than before at 1360x800. Touch (CDP): tap selects, one-finger pan moves the camera, a two-finger spread zooms 3.25x, and a drive dragged from the shelf lands on `sata0`.

**Drop targets and picks (real mouse events, headless Chrome, software GL, 1360x800; 1920x1080 for `m20`).** Each run starts from a sandbox save written by the sim: Enthusiast board with the crate parts and RAM, the drives and the OS on the shelf. Results: an NVMe drive dragged onto `m20` installs (Mainstream and Enthusiast, at both sizes); an HDD onto `sata0` and a SATA SSD onto `sata1` install (Enthusiast); the Resident OS dropped on an installed HDD (`sata0`), SATA SSD (`sata1`) and NVMe (`m20`) sets the OS badge each time. The NVMe drive cannot be bought on the Starter board ("needs an M.2 slot (bigger board)"), so the drop there never starts: the earlier report that `m20` refuses the drive is the purchase gate, not the renderer. Picks: an empty board area opens the board picker (`board`); the cooler body opens the cooler (`dev` of the cooler); the exposed CPU ring opens the CPU; hover shows the id each click picks. The inset refit: with the Enthusiast machine and the shelf open the chassis ends above the shelf (no overlap at 1360x800); with a campaign game after Start, the chassis ends above the bottom-centre `.tut` card (the reserve is 314 px there).

Not verified in this pass: the OS remove cue end to end (see Known gaps), the VRM crash flash (no fault was provoked), and the two-drive power-lead crossing (seen, not fixed).

