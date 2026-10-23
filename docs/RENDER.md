# Board rendering (PixiJS)

Code: `src/render/`. Entry point `mountBoard(host)` in `board.ts` (called from `main.tsx`). It reads `snapshot` and `speed` from `src/game/store` and writes `hover` / `selected` in `src/game/hover`. It never touches sim internals; the only sim import is the declarative spec table (`getSpec`, `BOARD_TIERS`) for the `visual` key and slot counts.

## Files

| File | Role |
|---|---|
| `board.ts` | scene graph, scene rebuild, LOD by zoom, hit-testing, snapshot effect, frame loop |
| `camera.ts` | pan / zoom / pinch (pointer events), tweened flights, `F` and `B` keys |
| `theme.ts` | theme tokens (below) |
| `layout.ts` | world coordinates (board, DIMMs, PSU, monitor, die floorplan), seeded PRNG, hover regions |
| `routes.ts` | orderly routing: bundles of parallel lanes (0/45/90 degrees), every board bus, power conductors, the PSU and video cables with their plugs |
| `boardArt.ts` | static motherboard (plate, dim bus traces, VRMs, connectors, rear I/O, sockets, a little quiet decoration) |
| `devices.ts` | static art of installed devices: CPU package + die floorplan, DIMM, cooler, PSU shroud, monitor, sleeved cables and plugs |
| `live.ts` | per-snapshot and per-frame state: bus activity, cable glow, PSU readout, monitor text, heat glow, fans, DRAM flashes |
| `pipeline.ts` | zoomed-in CPU chips and stage highlights |
| `ink.ts` | small Graphics / Text helpers |

## World layout

```
 monitor ---- video cable ---- [ motherboard ] | cable gutter
 (16:9, stand)   (HDMI)        rear I/O west   |  PSU cables rise to the east-edge connectors
                              [ PSU shroud, full width, readout panel, output sockets ]
```

The CPU socket is the origin. Board `x -3400..3400, y -2500..2500`; PSU below it (`y 2750..3850`, wider than the board by the cable gutter); monitor to the west (`x -7500..-4200`, screen 3120x1755 world units, readable at overview zoom). `WORLD` in `layout.ts` is the rectangle the camera fits. On the board: rear I/O on the west edge (HDMI at the height of the video cable), chipset between I/O and CPU, VRM row north of the CPU, DIMMs and M.2 east, PCIe slots south, power connectors on the east edge.

## Layers (bottom to top)

1. **Board**: `buildBoard(theme, boardTier)`, deterministic, built once per (theme, tier, installed set) and never touched per frame. Retained Pixi geometry plus a **baked texture** (0.4x) shown instead of the vector board below zoom 0.2.
2. **Devices**: static art per installed device (CPU, DIMMs by `slot`, PSU, monitor, cables). Empty typed slots are visible sockets and dashed bays. Below zoom 0.14 the whole layer is one **baked texture** (0.25x). The PSU fan (blades plus grill) lives in a separate `fanLayer` above the bake so it keeps spinning; the cooler has its own layer.
3. **Cooler** sits on the CPU and fades out between zoom 0.3 and 0.5 to reveal the die.
4. **Pipeline view** fades in between zoom 0.42 and 0.58.
5. **Live layer**: lit buses and pulses, cable glow, PSU readout, heat glow, burnt overlay, throttle badge, CLI monitor text, DRAM flashes.

Rebuild happens only when the theme, `boardTier` or the set of `spec@slot` pairs changes. Temperature, clocks, power etc. never rebuild anything.

## Visual hierarchy

Working parts (CPU, DIMMs, cooler, PSU, monitor, the cables) use the full theme tokens at full contrast. Passive parts (VRM, chipset, M.2, SATA, I/O, connectors, PCIe slots) and all dim traces use `makePalette(theme)` in `theme.ts`, which mixes the tokens toward the board colour. Decoration (a few SMD rows, a tiny QR sticker and hex patch, silkscreen) is quieter still. The board base colour is `mix(board, bg)` (dark) or `mix(board, white)` (light), so it recedes behind the parts.

## Routing

`routes.ts`: a route is a centre line of horizontal, vertical and 45 degree segments; `bundle(centre, n, spacing)` copies it n times at a fixed spacing (miter offset, 90 degree corners chamfered to 45). Nothing is random, nothing is routed through a component, and no two buses cross (the DIMM taps are a comb of equal-length stubs ending above the bus):

| Bus | From to | Lit by |
|---|---|---|
| `mem` (10 lanes + a comb per installed DIMM) | CPU east edge, down the channel west of the DIMMs, under the DIMM bank | RAM traffic |
| `nvme` | CPU east edge, over the DIMM tops, into the M.2 slot | program load |
| `dmi` | CPU west edge straight to the chipset | request start/finish, display writes |
| `usb`, `sata` | chipset to the rear I/O / SATA port 1 | never (no such devices yet) |
| `pcie` | CPU south edge straight into the x16 slot | never (GPU is decor) |
| `video` | CPU west edge, jog up, to the HDMI port | display text changing |
| `pwr12` | ATX 24-pin to the VRM row | current (see below) |
| `pwrcpu` | CPU 8-pin along the top into the VRM row | CPU current |
| `pwr5` | ATX 24-pin down the east side to the DRAM VRM | RAM current |
| `vcore` | VRM row straight down to the package | CPU current |

PSU cables (`buildCables`): sleeved, braided look, rounded corners, plug at both ends. They leave the PSU's top-edge sockets, rise through the cable gutter east of the board and turn west into plugs that sit on the board connectors. The cable that turns lowest is innermost, so no cable crosses another. ATX 24-pin and CPU 8-pin exist whenever a PSU is installed; the PCIe 6-pin only when a device occupies a `pcie*` slot (none exists today). The HDMI cable (straight, thick, plugs on both ends) goes from the rear I/O HDMI port to the monitor's side port and exists only with a display installed.

## Activity (what lights up)

Idle is calm: everything is a dim base stroke. A bus lights (colour overlay plus pulses flowing along the exact lanes, speed scaled by the CPU clock) only on real events from the snapshot, and fades about a second after the last one:

- **Memory bus** (cyan) and DRAM chip flashes: a data-cache miss (`counters.cacheMisses` or `stallCache` grew since the previous snapshot; RAM answers the CPU, pulses run toward the CPU), or a store in the MEM stage (`pipe.stages[3].op` is `sw` or `sb`; stores go out to RAM, pulses run outward). Cache hits and plain instruction fetch (there is no I-cache, every fetch reads RAM) do not light the bus; that would keep it always busy.
- **NVMe + DMI** (violet): a new request id (program loaded from storage). DMI also when a request finishes or the display text changes.
- **Video** (green) and the HDMI cable: `snapshot.display` changed.
- **PCIe / GPU / USB / SATA**: always dark, there is no device on them.
- **Power conductors and cables** glow in proportion to current, only while power flows (not off, not tripped): `sqrt(W / budget)` for the conductor's load (CPU watts for the 8-pin and vcore, 55-60% of the total for the 12 V / 24-pin, RAM watts for the 5 V rail). A fully idle machine shows a faint glow.
- **Heat glow** around the CPU / DIMMs only above about 42 C (heat, not load); burnt parts get a dark overlay with a red X.

## PSU face

Label plate (model, rated watts), vent slots, fan grill, output sockets, and a readout panel: **load** (watts drawn, "of N W", percentage, 20-segment gauge with the 100% mark, red over budget, `TRIPPED` / `OFF` states), **temperature** (value, COOL/WARM/HOT, bar) and **fan** (spinning icon, rpm, `STOPPED`). Data: `power.totalW` and `power.budgetW`, and the PSU fan speed, which follows load. **The temperature is an estimate**: the sim does not model PSU heat (its `tempC` stays ambient), so the renderer low-pass filters `25 + 34 * load^1.5` C; the fan rpm is likewise derived from the load-driven fan speed. If the sim grows a PSU temperature, replace `psuTemp` in `live.ts` with it. No snapshot fields were added.

## Camera

World units are pixels at zoom 1; the CPU socket is the origin. `cam {x, y, z}` is the world point at screen centre plus zoom. The camera frames the board in the area not covered by UI: `camera.inset` (CSS px) comes from the `viewInset` signal in `src/game/hover.ts`, which the HUD writes from the measured bar and dock/drawer rects (`InsetReporter` in `Hud.tsx`). The view centre and `fit()` use the free area, so the overview shows the whole scene (board, PSU, monitor) beside the shop; if the camera is at the overview when the free area changes (window resize, panel opened/closed) it re-fits, otherwise the view is left alone. Drag pans, wheel and two-finger pinch zoom about the cursor, any input cancels a flight. `F` flies to the die, `B` to the whole scene (board, PSU, monitor, cables). Also exported from `board.ts`: `flyToCpu()`, `flyToBoard()` for UI buttons. In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard}` is exposed for screenshot scripts.

## Theme tokens

`readTheme()` reads CSS custom properties from `:root` (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`, the legacy names) and falls back to built-in dark/light palettes for any that are undefined. Dark or light: `data-theme="dark|light"` on `<html>` wins, else `prefers-color-scheme`. A `MutationObserver` on `data-theme` plus a `matchMedia` listener rebuilds the scene and the background colour on change. Colours must be `#rgb` / `#rrggbb` for the heat colour blend; anything else still draws but does not blend.

## Snapshot fields consumed

`boardTier` (new), `devices[]` (`id, spec, kind, slot` (new), `burnt, effectiveClock, tempC, powerW, throttle, unstable`), `power` (`totalW, budgetW, tripped, off`), `request` (an id change means a program load), `display` (monitor text; a change lights the video path), `counters` (`cycles`, `cacheMisses`, `stallCache` for RAM traffic), `pipe` (MEM stage op for stores).

New in `Snapshot` (`src/sim/game/game.ts`, additive, existing consumers untouched):

- `boardTier: number`
- `DeviceSnap.slot: string` (e.g. `dimm1`)
- `pipe: null | { stages: StageSnap[5] }` with `StageSnap = { kind (0 empty, 1 instruction, 2 bubble), id (dynamic instruction id, -1 for none), op (mnemonic), text (full disassembly), cause (bubble cause: 0 none, 1 load, 2 data, 3 flush, 4 struct), stalled }`. Null when no request is running. Built from `engine.view` (stage arrays plus the timeline word for the mnemonic).

## Live state mapping

- Heat glow colour: temperature blend cyan, amber, red (red when `unstable`), only above about 42 C. Burnt: dark overlay with a red X, no glow.
- Badge above the CPU: `THROTTLED n%`, `UNSTABLE`, `PSU TRIPPED`, `NO POWER`, `CPU BURNT OUT`.
- Fans (cooler, PSU) spin faster with CPU temperature and PSU load, and stop when burnt, tripped or off.
- CLI monitor shows `snapshot.display` (`READY.` when idle and empty): the last 8 lines, wrapped at 32 columns, in 150 world unit type so it reads at overview zoom.
- Pipeline: chips are keyed by dynamic instruction id and coloured by class (alu cyan, mul violet, load amber, store green, branch/jump magenta). Bubbles are dashed boxes labelled by cause (flush in red, with the tile tinted). Stalled occupants get an amber ring. Chips tween from their old stage to the new one over about 0.8 of the time since the last snapshot (max 0.9 s); retired chips slide out of WB, squashed ones drop and fade. No tweening at 4x/16x or when snapshots arrive faster than 350 ms apart.

## Hover and selected contract

`hover` is `{id, x, y}` (client pixels) or null, written on pointer move (mouse only; hidden while dragging). `selected` is the id of the clicked thing or null (click on nothing). Hit order, first match wins:

0. Cables and the PSU readout (new, checked first): `cable.atx cable.cpu cable.pcie cable.video` (sleeve and both plugs) and `psu.readout`.
1. Die tiles when zoom >= 0.45: `cpu.IF cpu.ID cpu.EX cpu.MEM cpu.WB cpu.IC cpu.BP cpu.CLK cpu.DC cpu.RF cpu.UNCORE cpu.MC cpu.IO cpu.L2`
2. Cooler spec id (zoom < 0.45), CPU package spec id, RAM spec id (per stick), PSU spec id, display spec id. Installed devices use the **spec id**, so two identical DIMMs share an id.
3. Empty slots by **slot id**: `dimm1`, `cpu0`, `cooler0`, `display0`, `atx0`, `pcie0`...
4. Decor regions: `vrm` (core VRM row), `vrm2` (DRAM VRM), `pcie chipset io atx cpw m2 sata bat audio hex qr`.

The PSU face, fan, label and sockets hit as the PSU spec id; the whole monitor (bezel, screen, stand) hits as the display spec id. Ids the UI does not know yet (`describeId` in `src/ui/logic.ts` returns null, so no tooltip): `cable.atx cable.cpu cable.pcie cable.video psu.readout` and all the region ids above (`board` is the only region it describes today).

## Performance

Static layers are cached: retained geometry, the board texture below zoom 0.2 and the device layer texture (devices, PSU, monitor, cables) below zoom 0.14. Textures are destroyed on rebuild. Per frame JS is the fan rotation, the pooled dot sprites (only lit buses and cables show pulses) and one DRAM flash Graphics only while the memory bus is lit. Per snapshot: a few Graphics (heat glow, PSU gauge) and a handful of Text updates (only when the string changed). Measured in headless Chrome with software GL (SwiftShader, 1360x800, GPU-bound and pessimistic), full machine installed: page baseline about 16 ms/frame, overview 19-23 ms (44 ms before the device bake: the device layer alone cost 28 ms), PSU mid-zoom 33 ms, DIMM mid-zoom (zoom 0.35) 62 ms, CPU die 56 ms. Real GPU numbers were not measured.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- The liquid cooler's tubes end in fittings (no radiator art). No GPU, NVMe, SATA or USB devices exist in the sim, so those buses never light (the PCIe cable is plumbed but never drawn).
- PSU temperature and fan rpm are renderer estimates from load (see above).
- Bus lanes are 9-11 world units wide, about a pixel at overview zoom; the pulses carry the activity there.
- Chips are single-width; superscalar and out-of-order engines will need a wider stage layout and a bigger `pipe`.
