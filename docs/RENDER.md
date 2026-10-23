# Board rendering (PixiJS)

Code: `src/render/`. Entry point `mountBoard(host)` in `board.ts` (called from `main.tsx`). It reads `snapshot` and `speed` from `src/game/store` and writes `hover` / `selected` in `src/game/hover`. It never touches sim internals; the only sim import is the declarative spec table (`getSpec`, `BOARD_TIERS`) for the `visual` key and slot counts.

## Files

| File | Role |
|---|---|
| `board.ts` | scene graph, scene rebuild, LOD by zoom, hit-testing, snapshot effect, frame loop |
| `camera.ts` | pan / zoom / pinch (pointer events), tweened flights, `F` and `B` keys |
| `theme.ts` | theme tokens (below) |
| `layout.ts` | world coordinates (board, DIMMs, PSU, monitor, die floorplan), seeded PRNG, bus lanes |
| `boardArt.ts` | static motherboard (traces, SMD, hex, QR, VRM, connectors, empty sockets, bus lanes) |
| `devices.ts` | static art of installed devices: CPU package + die floorplan, DIMM, cooler, PSU, monitor |
| `live.ts` | per-snapshot and per-frame state: glow, burnt, throttle badge, fans, bus dots, monitor text, DRAM flashes |
| `pipeline.ts` | zoomed-in CPU chips and stage highlights |
| `ink.ts` | small Graphics / Text helpers |

## Layers (bottom to top)

1. **Board**: `buildBoard(theme, boardTier)`, deterministic (seed 1337), built once per (theme, tier, installed set) and never touched per frame. Retained Pixi geometry, plus a **baked texture** (0.4x) shown instead of the vector board below zoom 0.2 (this cut the overview frame in software GL from about 86 to 34 ms).
2. **Devices**: static art per installed device, placed by `slot` (`dimmN` picks the DIMM position). Empty typed slots are visible sockets (DIMM, PCIe rails, SATA ports, CPU land grid) and dashed bays (PSU, cooler, monitor). Slots beyond the board tier are drawn faint.
3. **Cooler** sits on the CPU and fades out between zoom 0.3 and 0.5 to reveal the die.
4. **Pipeline view** fades in between zoom 0.42 and 0.58.
5. **Live layer**: glows, burnt overlay, bus dots (sprite pool), DRAM chip flashes, PSU load meter, throttle badge, CLI monitor text.

Rebuild happens only when the theme, `boardTier` or the set of `spec@slot` pairs changes. Burnt, temperature, clocks etc. never rebuild anything.

## Camera

World units are pixels at zoom 1; the CPU socket is the origin. `cam {x, y, z}` is the world point at screen centre plus zoom. The camera frames the board in the area not covered by UI: `camera.inset` (CSS px) comes from the `viewInset` signal in `src/game/hover.ts`, which the HUD writes from the measured bar and dock/drawer rects (`InsetReporter` in `Hud.tsx`). The view centre and `fit()` use the free area, so the overview shows the whole board (PSU included) beside the shop; if the camera is at the overview when the free area changes (window resize, panel opened/closed) it re-fits, otherwise the view is left alone. Drag pans, wheel and two-finger pinch zoom about the cursor, any input cancels a flight. `F` flies to the die, `B` to the whole scene (board, PSU, monitor). Also exported from `board.ts`: `flyToCpu()`, `flyToBoard()` for UI buttons. In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard}` is exposed for screenshot scripts.

## Theme tokens

`readTheme()` reads CSS custom properties from `:root` (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`, the legacy names) and falls back to built-in dark/light palettes for any that are undefined. Dark or light: `data-theme="dark|light"` on `<html>` wins, else `prefers-color-scheme`. A `MutationObserver` on `data-theme` plus a `matchMedia` listener rebuilds the scene and the background colour on change. Colours must be `#rgb` / `#rrggbb` for the heat colour blend; anything else still draws but does not blend.

## Snapshot fields consumed

`boardTier` (new), `devices[]` (`id, spec, kind, slot` (new), `burnt, effectiveClock, tempC, powerW, throttle, unstable`), `power` (`totalW, budgetW, tripped, off`), `request` (running or not), `display` (monitor text), `counters` (`cycles`, `cacheMisses` for RAM and D-cache flashes), `pipe` (new).

New in `Snapshot` (`src/sim/game/game.ts`, additive, existing consumers untouched):

- `boardTier: number`
- `DeviceSnap.slot: string` (e.g. `dimm1`)
- `pipe: null | { stages: StageSnap[5] }` with `StageSnap = { kind (0 empty, 1 instruction, 2 bubble), id (dynamic instruction id, -1 for none), op (mnemonic), text (full disassembly), cause (bubble cause: 0 none, 1 load, 2 data, 3 flush, 4 struct), stalled }`. Null when no request is running. Built from `engine.view` (stage arrays plus the timeline word for the mnemonic).

## Live state mapping

- Glow colour: temperature blend cyan, amber, red (red when `unstable`); intensity from power versus the spec's `loadW` and heat. Burnt: dark overlay with a red X, no glow.
- Badge above the CPU: `THROTTLED n%`, `UNSTABLE`, `PSU TRIPPED`, `NO POWER`, `CPU BURNT OUT`.
- Fans (cooler, PSU) spin faster with CPU temperature and PSU load, and stop when burnt, tripped or off.
- Bus activity: lane dots speed and brightness follow a smoothed "request running" level scaled by the CPU's effective clock; an increase in `cacheMisses` lights the amber memory-bus dots and flashes DRAM chips and the D-cache tile.
- CLI monitor shows `snapshot.display` (`READY.` when idle and empty).
- Pipeline: chips are keyed by dynamic instruction id and coloured by class (alu cyan, mul violet, load amber, store green, branch/jump magenta). Bubbles are dashed boxes labelled by cause (flush in red, with the tile tinted). Stalled occupants get an amber ring. Chips tween from their old stage to the new one over about 0.8 of the time since the last snapshot (max 0.9 s); retired chips slide out of WB, squashed ones drop and fade. No tweening at 4x/16x or when snapshots arrive faster than 350 ms apart.

## Hover and selected contract

`hover` is `{id, x, y}` (client pixels) or null, written on pointer move (mouse only; hidden while dragging). `selected` is the id of the clicked thing or null (click on nothing). Hit order, first match wins:

1. Die tiles when zoom >= 0.45: `cpu.IF cpu.ID cpu.EX cpu.MEM cpu.WB cpu.IC cpu.BP cpu.CLK cpu.DC cpu.RF cpu.UNCORE cpu.MC cpu.IO cpu.L2`
2. Cooler spec id (zoom < 0.45), CPU package spec id, RAM spec id (per stick), PSU spec id, display spec id. Installed devices use the **spec id**, so two identical DIMMs share an id.
3. Empty slots by **slot id**: `dimm1`, `cpu0`, `cooler0`, `display0`, `atx0`, `pcie0`...
4. Decor regions: `vrm vrm2 pcie chipset io atx cpw m2 sata bat audio hex qr`.

## Performance

Static layers are cached (retained geometry, baked texture when far out). Per frame JS is the fan rotation, about 70 dot sprites, up to 12 pooled chips, and one DRAM flash Graphics only while a miss pulse is active. Per snapshot: a few glow Graphics and two Text updates (only when the string changed). Measured in headless Chrome with software GL (SwiftShader, 1360x800, so GPU-bound and pessimistic): page baseline 23 ms/frame, board overview 34 ms, CPU die 68 ms, mid zoom on DIMMs 58 ms; JS render submit 0.6 ms per frame. Real GPU numbers were not measured.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- The liquid cooler's tubes end in nothing (no radiator art). No GPU, NVMe or SATA devices exist in the sim, so those are decor.
- Chips are single-width; superscalar and out-of-order engines will need a wider stage layout and a bigger `pipe`.
- The board overview does not offset for UI panels that cover the right side.
