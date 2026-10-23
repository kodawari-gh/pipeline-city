# Board rendering (PixiJS)

Code: `src/render/`. Entry point `mountBoard(host)` in `board.ts` (called from `main.tsx`). It reads `snapshot` and `speed` from `src/game/store` and writes `hover` / `selected` in `src/game/hover`. It never touches sim internals; the only sim import is the declarative spec table (`getSpec`, `BOARD_TIERS`) for the `visual` key and slot counts.

## Files

| File | Role |
|---|---|
| `board.ts` | scene graph, scene rebuild, LOD by zoom, hit-testing, snapshot effect, frame loop |
| `camera.ts` | pan / zoom / pinch (pointer events), tweened flights, `F` and `B` keys, the `onGrab` hook that lets a drag take over from panning |
| `theme.ts` | theme tokens (below) |
| `layout.ts` | world coordinates (board, DIMMs, PSU, monitor, die floorplan), seeded PRNG, hover regions |
| `routes.ts` | orderly routing: bundles of parallel lanes (0/45/90 degrees), every board bus, power conductors, the PSU and video cables with their plugs |
| `boardArt.ts` | static motherboard (plate, dim bus traces, VRMs, connectors, rear I/O, sockets, a little quiet decoration) |
| `devices.ts` | static art of installed devices: CPU package + die floorplan, DIMM, cooler, PSU shroud, monitor, sleeved cables and plugs |
| `live.ts` | per-snapshot and per-frame state: bus activity, cable glow, PSU readout, monitor text and NO SIGNAL, heat glow, fans, DRAM flashes, boot visuals (PCH glow, USB LED, boot bar) |
| `props.ts` | world props: part icons (drag ghost), USB key tray, wide key stick, power button and its lights |
| `interact.ts` | everything the pointer does: hover affordance, drag and drop of parts (`beginPartDrag`) / plugs / keys, drop-target pulses, inline messages, tutorial highlight rings and edge arrows |
| `pipeline.ts` | zoomed-in CPU chips and stage highlights |
| `ink.ts` | small Graphics / Text helpers |

## World layout

```
 monitor ---- video cable ---- [ motherboard ] | cable gutter
 (16:9, stand)   (HDMI)        rear I/O west   |  PSU cables rise to the east-edge connectors
 key tray, power plate below the monitor
                              [ PSU shroud, full width, readout panel, output sockets ]
```

The CPU socket is the origin. West of the board: the **key tray** (under the monitor stand, 2 columns of wide keys) and the **power plate** (between the tray and the board's rear I/O). There is no crate in the world: the inventory is an HTML menu (`src/ui`) that starts part drags with `beginPartDrag`. Board `x -3400..3400, y -2500..2500`; PSU below it (`y 2750..3850`, wider than the board by the cable gutter); monitor to the west (`x -7500..-4200`, screen 3120x1755 world units, readable at overview zoom). `WORLD` in `layout.ts` is the rectangle the camera fits. On the board: rear I/O on the west edge (HDMI at the height of the video cable), chipset between I/O and CPU, VRM row north of the CPU, DIMMs and M.2 east, PCIe slots south, power connectors on the east edge.

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

Cables have three states (`syncCables` in `board.ts`, a layer of its own so plugging never rebuilds the baked scene): **connected** (routed, as below), **loose** (`looseCable` in `routes.ts`: a short stub from the PSU socket / monitor port ending in a plug that lies at rest, the PSU plugs in the gutter east of the board, the HDMI plug just outside the rear I/O; no routed cable, no glow) and **held** (in the player's hand: `interact.ts` draws a rubber-band cable from the fixed end to the pointer). The source part must be installed for the cable to exist at all.

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

0. **Props** (new): `power`, the plugged key, tray keys (`key:<keyId>`), then `usb`, `tray`.
1. Cables and the PSU readout: `cable.atx cable.cpu cable.pcie cable.video` (sleeve, loose stub or plug) and `psu.readout`.
2. Die tiles when zoom >= 0.45: `cpu.IF cpu.ID cpu.EX cpu.MEM cpu.WB cpu.IC cpu.BP cpu.CLK cpu.DC cpu.RF cpu.UNCORE cpu.MC cpu.IO cpu.L2`
3. Installed parts: the **device instance id** from the snapshot (`dev1`...) for the CPU, each DIMM and the cooler (the cooler wins below zoom 0.45); `psu` for the PSU body and `monitor` for the monitor. For `hover` only, those two are written as the device id so the existing tooltips keep working; `selected` gets `psu` / `monitor`.
4. Empty slots by **slot id**: `cpu0 dimm0..3 cooler0 display0 atx0 atx-plus0 pcie0 pcie1`.
5. `chipset` (the PCH), then decor regions: `vrm vrm2 pcie io atx cpw m2 sata bat audio hex qr`.

**Full id list** (everything the renderer writes to `selected` / `hover`, and everything `highlight`, `flyTo` and `hasTarget` accept):

| id | what |
|---|---|
| slot ids (`cpu0`, `dimm0`..., `cooler0`, `display0`, `atx0`, `pcie0`) | the socket / bay, filled or empty |
| device ids (`dev1`...) | an installed CPU, DIMM or cooler |
| `psu`, `monitor` | the installed (or empty) PSU and monitor |
| `psu.readout` | the PSU's live panel |
| `tray` | the key tray |
| `key:<keyId>` | a key in the tray or in the USB port |
| `usb` | the USB port on the rear I/O |
| `power` | the power button |
| `chipset` | the PCH |
| `board` | the whole motherboard (a highlight / flyTo target only; not clickable) |
| `cable.atx`, `cable.cpu`, `cable.video` (`cable.pcie` is plumbed, never drawn) | a cable: the plug is what is grabbed; as a highlight target it rings the plug and, while loose, also the matching board socket |

Click behaviour on top of writing `selected`: `power` calls `powerButton()` (and shows `noPowerReason` as a message when it would do nothing); `key:<id>` in the tray calls `plugKey`, the plugged key calls `ejectKey` (not while loading, running or writing: a message explains). A refused sim action (`lastError`) is shown as a short message at the point where the player acted.

## Interaction (hover, drag and drop)

Input is pointer events only (mouse, touch, pen). `camera.onGrab` decides at pointer down whether the gesture is a drag of something (cable plug, key) or a pan; dragging empty space pans, and a second finger cancels a drag and starts a pinch. A press that moves less than 6 px is a click.

- **Hover affordance** (`interact.ts`): every interactive id (everything in the table above except decor regions, die tiles and `board`) eases a lift and 7 percent scale on movable props (keys, the power button) and an accent outline glow on everything, with a `pointer` cursor, or `grab` on draggables (`grabbing` while dragging). Installed parts and sockets are baked into textures, so they get the outline only. Decor never animates.
- **Parts**: dragging a part out of the inventory menu shows a ghost (steady on-screen size) (there is no world item to dim). Valid targets (`inventory[].freeSlots` green, `swapSlots` amber, `["board"]` for a board upgrade) pulse; every other socket is dimmed; over a valid socket the ghost settles on it. Drop on a valid socket calls `install(invId, slotId)` (the ghost fades into it); anywhere else it flies back. A refused drop shows the reason next to the pointer (`inventory[].reason`, "Power the machine off first" while powered, or "<part> does not fit the <type> socket"). While powered the whole drag shows the reason beside the ghost and the sockets are only lightly dimmed.
- **Cables**: the plug rests loose beside its source. Dragging it stretches a sagging cable from the fixed end (PSU socket / monitor port) to the pointer; the matching board socket pulses; within reach the plug snaps into the socket pose. Drop there: `connectCable(kind)`, and the routed cable appears when the snapshot confirms (the state is optimistic for up to 1.5 s). Elsewhere it falls back to its rest spot. Dragging a connected plug away calls `disconnectCable(kind)` immediately and the plug is in hand. Powered machine: a message, no drag. Dropping next to the wrong socket says so.
- **`beginPartDrag(inventoryId, event)`** (exported from `src/render/board.ts`): the inventory menu calls it from a DOM `pointerdown` (outside the canvas). It starts the part drag above immediately (no 6 px threshold), captures the pointer and listens on `window` for `pointermove` / `pointerup` / `pointercancel`, converting client coordinates to world through the camera. Drop on a valid socket installs; any other drop snaps the ghost back to where the press began (with the refusal message when over the board). Escape, `pointercancel`, window blur, or a release outside the canvas rectangle cancel (snap back, nothing installed). `dragging` becomes `{kind: 'part', id: inventoryId}` and returns to null at the end. Ids in `highlight` that do not exist are skipped silently. Give the pressed element `touch-action: none` so touch does not scroll.
- **Keys**: drag a key from the tray to the USB port (`plugKey`; the stick is held by its plug end and shrinks to the compact size over the port; the port pulses green, or red with a message when a key is already in), or click it. The plugged key is clicked or dragged away from the port to eject (`ejectKey`, payout); while loading, running or writing it refuses with a message. While the machine waits for the key to be removed (`done-remove-key`) a green ring pulses around it.
- **Power**: click calls `powerButton()`. Its lights show on (green), off (amber) and error (red, blinking; also a PSU trip).

`dragging` (`src/game/interaction.ts`) is `{kind: 'part' | 'cable' | 'key', id}` during a drag and null otherwise.

## Tutorial support

The UI writes `highlight` (`src/game/interaction.ts`, an array of ids from the table above). Each resolvable id gets a pulsing amber double ring and a bobbing arrow above it, sized to stay readable at any zoom. When the target is off-screen (outside the free area, see `viewInset`) a round edge indicator with an arrow sits on the border of the free area pointing at it; clicking it flies there. Ids that do not exist right now (an `inv:` part already installed, `cable.atx` before a PSU exists) are skipped silently.

Exports of `board.ts`:

- `flyTo(id): boolean` flies the camera to any id in the table (some context around it, zoom capped at 0.3); returns false for an unknown id. Also `window.__board.flyTo` in dev.
- `hasTarget(id): boolean`: whether the id exists in the world right now.
- `flyToCpu()`, `flyToBoard()` as before.

In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard, flyTo, interact, scene}` is exposed; `scene.rects` maps every id to its world rect and `interact.rectsFor(id)` returns the rects a highlight would ring (the screenshot scripts use it to drive real mouse events).

## Boot visuals

- **PCH** (`chipset`): when powered and posting, loading or writing it gets a violet outline glow and a row of animated activity bars; calm in every other phase.
- **Buses carry the data** (existing lanes only; a bus lights only while its phase moves data and fades about 1.7 s after): posting lights DMI; loading runs USB port to PCH, PCH to CPU (DMI) and CPU to RAM (memory bus); writing runs RAM to CPU, CPU to PCH and PCH to the USB port. The video bus and cable still light when the monitor text changes (and only when `monitorLive`).
- **USB port LED**: dark with no key, steady green with a key in, blinking amber while loading or writing.
- **Monitor**: shows `snapshot.display` when `monitorLive`; **NO SIGNAL** when a monitor is installed but not live (no video cable); a blank screen when live and the machine is off. Its power LED is green when live and powered, amber when live and off. A thin green bar under the picture follows `bootProgress` during `posting` and `loading`.

## Performance

Static layers are cached (the tray / power plate chrome is one texture below zoom 0.2, each prop node is cached as a texture below zoom 0.2, the cables are their own small layer): retained geometry, the board texture below zoom 0.2 and the device layer texture (devices, PSU, monitor, cables) below zoom 0.14. Textures are destroyed on rebuild. Per frame JS is the fan rotation, the pooled dot sprites (only lit buses and cables show pulses) and one DRAM flash Graphics only while the memory bus is lit. Per snapshot: a few Graphics (heat glow, PSU gauge) and a handful of Text updates (only when the string changed). Measured in headless Chrome with software GL (SwiftShader, 1360x800, GPU-bound and pessimistic), full machine installed: page baseline about 16 ms/frame, overview 19-23 ms (44 ms before the device bake: the device layer alone cost 28 ms), PSU mid-zoom 33 ms, DIMM mid-zoom (zoom 0.35) 62 ms, CPU die 56 ms. Real GPU numbers were not measured. With the assembly props (same setup): bare or assembled overview about 20 ms/frame (mostly 16.7 ms with an occasional 33 ms), dragging a key about 20-33 ms, boot with the PCH and buses lit about 21 ms at overview and about 56 ms at zoom 0.22 (GPU-bound, like the DIMM mid-zoom number above). Before baking the props the overview was 32 ms.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- The liquid cooler's tubes end in fittings (no radiator art). No GPU, NVMe, SATA or USB devices exist in the sim, so those buses never light (the PCIe cable is plumbed but never drawn).
- PSU temperature and fan rpm are renderer estimates from load (see above).
- Touch drags were verified with synthesized touch events (CDP), not on a device; there is no hover on touch. Installed parts cannot be dragged back out (the UI picker uninstalls). Loose cable plugs and tray keys are small at overview zoom (use the tutorial rings, `flyTo` or zoom).
- Bus lanes are 9-11 world units wide, about a pixel at overview zoom; the pulses carry the activity there.
- Chips are single-width; superscalar and out-of-order engines will need a wider stage layout and a bigger `pipe`.

## USB keys

A tray key is a wide stick (`keyStick` in `props.ts`, 1470 x 230 world units: a 330 plug and a 1140 body) that carries its whole label: **job id and type** (`#72 scan`), the **template** (`cli.scan`), and an **age bar against the deadline** with `age/span s` (or `LATE`), all coloured by urgency (green, amber over 65 percent of the span, red late). Text is ellipsised only when it would overflow the body (a very long template). The tray holds 2 columns by 5 rows. The plugged key is the **compact** variant (750 long: a 190 plug seated in the USB port plus a 560 body sticking out west, job id and bar, or `DONE`), so it stays clear of the monitor. Hover lift, click to plug or eject, and drag to the port work on both.
