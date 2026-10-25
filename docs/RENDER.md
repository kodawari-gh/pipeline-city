# Board rendering (PixiJS)

Code: `src/render/`. Entry point `mountBoard(host)` in `board.ts` (called from `main.tsx`). It reads `snapshot` and `speed` from `src/game/store` and writes `hover` / `selected` in `src/game/hover`. It never touches sim internals; the only sim import is the declarative spec table (`getSpec`, `BOARD_TIERS`) for the `visual` key and slot counts.

## Files

| File | Role |
|---|---|
| `board.ts` | scene graph, scene rebuild, LOD by zoom, hit-testing, snapshot effect, frame loop |
| `camera.ts` | pan / zoom / pinch (pointer events), tweened flights with `onDone`, the eased UI inset, `F` and `B` keys, the `onGrab` hook that lets a drag take over from panning, the pure `screenRect` transform (`camera.test.ts`) |
| `theme.ts` | theme tokens (below) |
| `layout.ts` | world coordinates (die floorplan, monitor, tray, router shelf) and the **tier-dependent** ones as live bindings (`setLayoutTier(boardTier, caseTier)`: board, DIMMs, VRMs, PSU, bay, case, world box), seeded PRNG, hover regions |
| `boardlayout.ts` | the geometry of each board tier (pure data): a form factor each (mini-ITX, micro-ATX, ATX, E-ATX), only the sockets the tier has |
| `boardParts.ts` | drawers for the board's components (VRM phases, DIMM socket, PCIe slot, connectors, chips, capacitors, chokes) |
| `thumbs.ts` | pictures of parts for the shop, inventory and picker: the real art rendered to cached data URLs |
| `routes.ts` | orderly routing: bundles of parallel lanes (0/45/90 degrees), every board bus of the current tier (one memory bundle per DIMM in a staircase, the VRM rails, the 8-pin feed), the PSU and video cables with their plugs |
| `boardArt.ts` | static motherboard (plate, dim bus traces, VRMs, connectors, rear I/O, sockets, a little quiet decoration) |
| `devices.ts` | static art of installed devices: CPU package + die floorplan, DIMM, cooler, PSU shroud, monitor, sleeved cables and plugs |
| `live.ts` | per-snapshot and per-frame state: bus activity, cable glow, PSU readout, monitor text and NO SIGNAL, heat glow, fans, DRAM flashes, boot visuals (PCH glow, USB LED, boot bar), the VRM glow, power-good light, crash flash and the dead-board look. Two roots: `root` (interior) and `ext` (monitor screen, USB / monitor LEDs, video cable glow) |
| `exterior.ts` | the far-zoom exterior case (static art baked to one texture) and its live accent strip, `LOD` thresholds are in `board.ts` |
| `props.ts` | world props: part icons (drag ghost), USB key tray, wide key stick, power button and its lights, the remove cue on a finished key (`drawKeyCue`), a glass panel for the tray |
| `interact.ts` | everything the pointer does: hover affordance, drag and drop of parts (`beginPartDrag`) / plugs / keys, drop-target pulses, inline messages, tutorial highlight rings and edge arrows |
| `pipeline.ts` | zoomed-in CPU chips and stage highlights |
| `case.ts` | the PC case: chassis, glass, drive bay cage, SATA data cables and power leads |
| `drives.ts` | drive art (`hdd`, `ssd-sata`, `ssd-nvme`) and their live parts (platter, head arm, activity LED) |
| `net.ts` | the network props: router, wall plate, ISP line, ethernet cable, NIC card art, link LEDs and traffic pulses (see Network) |
| `ink.ts` | small Graphics / Text helpers |

## World layout

```
 monitor ---- video cable ---- [ motherboard ] | cable gutter
 (16:9, stand)   (HDMI)        rear I/O west   |  PSU cables rise to the east-edge connectors
 key tray, power plate below the monitor
                              [ PSU shroud, full width, readout panel, output sockets ]
```

The CPU socket is the origin. West of the board: the **monitor** (scaled 1.6x, right edge at x -4200, so it stands next to the case at a believable size), under it the **key tray**, above it the router shelf and the wall plate (scaled 1.45x). There is no crate in the world: the inventory is an HTML menu (`src/ui`) that starts part drags with `beginPartDrag`. The board's size and everything under and around it depends on the tier (see "Board tiers, cases and the VRM"): the board's west edge is always x -3400 and its top is tier-dependent; the PSU shroud sits `250` below its south edge, the drive bay east of the shroud. `WORLD` in `layout.ts` is the content box the overview fits: tight, from the wall plate on the west to the case's east wall, from the case top to the feet; it changes with the case, and the camera glides to the new overview when the case (or board tier) changes. The overview uses `OVERVIEW_MARGIN` (0.96); the device bake uses `WORLD` as its frame. On a board: rear I/O on the west edge (HDMI at the height of the video cable), the USB hub controller between I/O and CPU, the VRM row north of the CPU, the chipset south-east of the CPU (below the memory, east of the slots' ends), the DIMMs east, the memory VRM above them, PCIe slots south, M.2 south-east, the 24-pin and SATA ports on the east edge, the 8-pin on the top edge.

## The case, the bay and the OS screen (storage and OS phase)

- **Case** (`CASE`, `case.ts`): a thin, low-contrast chassis around the motherboard and the PSU. West wall by the rear I/O (keys and the HDMI cable pass through), top panel with brand, vents, status lights, **the power button** (`power`) and a **disk activity LED** (lit only while a drive is busy), a quiet glass side over the board, a PSU compartment and feet. The monitor, the key tray sits outside it. The chassis is static (a vector layer close up, one baked texture below zoom 0.14). The camera fit (`WORLD`) covers the case, the monitor and the tray.
- **Drive bay** (`BAY`, `BAY_CELLS`): a 2-cell cage east of the PSU. Cell 0 is slot `sata0`, cell 1 is `sata1`. An installed drive slides in (650 ms) and its **SATA data cable** (`sataCablePath`) runs to the board's SATA port (two ports on the east edge, mouth east, `sataPort(i)`), plus a power lead from the PSU's east face. The cable leaves the drive's plug, runs west to its lane between the PSU and the bay (`SATA_LINK`), up the lane and west along the port's row, under the three PSU cables in the gutter, into the port. The two data cables never cross each other; they cross the short power leads in the lane. Slots come from `snapshot.slots` / `BOARD_TIERS` (only existing slots are drawn live; absent ones are faint).
- **Drives**: `hdd` (3.5in, label, platter and head arm), `ssd-sata` (slim 2.5in with a window onto controller and NAND), `ssd-nvme` (M.2 stick on the board's M.2 slot with a heat spreader). They animate only while `storage[].busy` (platter spin, head swing, LED blink); a bus (SATA or NVMe trace plus the cable) lights only then or in an OS flow.
- **Drop targets**: `sata0`, `sata1`, `m20` are drop targets when empty (storage) and when occupied (an OS item is dropped on an installed drive; `inventory[].freeSlots` decides). A refused OS drop on a bare socket explains it.
- **Bus flows (OS)**: `booting-os` lights the boot drive's bus and cable, DMI and memory (drive to RAM/CPU); `ingesting` runs key to drive (USB, DMI, drive bus); `flashing` runs drive to key. Idle stays dark.
- **USB LED** follows `keyActivity`: enumerating slow amber blink, ingesting fast amber, flashing fast cyan, done steady green that breathes (collect the key). Without an OS the old loading/writing blink applies.
- **OS screen** (display only): when an OS is installed, powered and the monitor is live, in `booting-os`, `idle-os`, `running-os`, `ingesting`, `flashing`, the monitor shows a terminal-style status screen built from `snapshot.os`, `storage`, `display`: OS name/tier and state, uptime, program slots and queue use, the running job with a sliding progress cue, queue rows (`+N AHEAD` / `NEXT` / `DONE`), a `PLUG KEY ... TO COLLECT` line, storage use of the boot drive, and the live POST/boot lines while booting. Missing fields are skipped. Otherwise plain CLI text, `NO SIGNAL` and POST as before. The screen is **not** a hit target: the monitor is one object (`monitor`).
- **OS badge** (`os`): a small `OS` chip with a status dot on the drive that hosts the OS (`snapshot.os.slot`; HDD or SATA SSD in the bay, NVMe on M.2; `osBadgeRect` in `drives.ts`). The dot follows the phase on the game clock: booting pulses amber, idle steady green, ingesting / flashing blink, running breathes cyan. The badge is the hover / `selected` / `highlight` / `flyTo` target `os` and exists only while an OS is installed on a present drive; clicking the drive body still selects the drive's device id.

## Game-time clock

Every animation that belongs to the machine runs on one **game clock** (`gt` in `board.ts`, milliseconds) that advances by `frame time * timeScale` with `timeScale` = 0 when paused (`speed` 0), 1 at 1x, 2 at 4x, 3 at 16x. `Live.frame`, `PipelineView.frame` (chip tweens), the LEDs, fans, the VRM glow and the exterior accent strip, platter, head, bus and cable pulses, the PCH bars, the boot bar, the OS progress cue, the done ring and the power LED blink all take `gt` instead of wall time, and snapshot-time holds (bus fade timers) use `gt` too, so a pause freezes them exactly and a resume continues without a jump. Wall time still drives: camera pan/zoom/flights, hover lift and outline, drag ghost and drop-target pulses, tutorial highlight rings, toasts and the slide-in of a new drive. **Flashes** (the VRM crash flash, the DRAM flash on memory traffic, the error blink of the accent strip) fade on wall time, so a paused frame never holds one on screen (about 0.9 s, or the blink). Every other machine animation still freezes with the game clock.

## Level of detail: interior and exterior (far zoom)

The camera scale drives one clean LOD, in multiples of the **fit zoom** (`fits.z`, the zoom of the default overview). Constants are `LOD` in `board.ts` (exported, also `window.__board.LOD` in dev):

| Zoom (x fit) | What shows |
|---|---|
| `>= 0.7` (`LOD.fadeFrom`) | the interior, exactly as before (the default overview is 1.0) |
| 0.7 to 0.5 (`fadeFrom` to `fadeTo`) | the exterior case **crossfades in** over the interior (smoothstep; the exterior alpha is the fade, the interior stays opaque below it, so there are no see-through artefacts) |
| `<= 0.5` (`LOD.fadeTo`) | exterior only: the interior group is `visible = false` and `Live.setInterior(false)` skips all interior per-frame work |
| `0.2` (`LOD.minZoom`) | how far the camera can zoom out (it used to stop at 0.7) |

**Interior group** (`interior` container): case chassis, board, devices (CPU, DIMMs, PSU, cooler, heatsink, bay, drives), SATA cables, ATX / CPU cables, glass, cooler, pipeline view, and `live.root` (bus flows, PSU readout, OS badge, VRM glow, PCH). **Always external** (outside the group, drawn at every zoom): the monitor (`monitorLayer`, one cached texture far out), the video cable (`cableExtLayer`), the tray, the power button and its lights, the plugged key, and `live.ext` (monitor screen text and OS screen, USB LED, monitor LED, boot bar, video cable glow).

**Exterior case** (`exterior.ts`, `exteriorLayer` above the interior, below the external things): an opaque chassis on the same `CASE` rectangle, so the power button, its on / off / error / disk lights, the USB port and the video cable need no moving. Brushed steel body with a lit top edge, the top panel with vents and brand, a **smoked tempered glass** side (opaque, only two faint diagonal reflections, no internals), a perforated PSU intake and nameplate, feet, and the **drive bay front** (a faceplate per installed HDD / SATA SSD, a blanking plate for an empty cell, a flat plate for the cell this tier lacks; NVMe lives on the board and is not visible). The **rear I/O plate** shows the external connectors this board has: audio, an ethernet jack only when `features.ethernetMbps > 0`, HDMI, a second display port only when `displayPorts >= 2`, and `usbPorts` of the four USB positions (bare outlines for the rest). The static art is built once per (theme, tier, drives) and baked to one texture (0.35x). The only live part is the **accent strip** (a thin bar on the front rim, plus the drive-front activity LEDs), on the game clock: off dark; idle a dim steady cyan; halted a steady amber (on, finished or waiting for a boot key); working (posting, loading, running, writing, any OS phase) a bright pulse travelling down the strip; error (`phase error` or PSU trip) blinking red; dead board a steady dim red. The power button and the ON / OFF / ERR lights at far zoom follow the same rules as up close (see Power). Dark and light themes use the same structure (steel body, smoked glass in both).

**Interaction at far zoom** (exterior alpha above 0.5): only external ids can be hit: `power`, `usb`, `monitor` (hover writes `monitor`), `display0` (the empty monitor bay), `tray`, `key:<id>`, `cable.video`, and `case` (the **whole** chassis rectangle). Interior ids (slots, devices, cables, `bay`, `os`, `psu`, regions, die tiles) are not hit targets then. Below 0.5 exterior alpha the interior hits are back.

**Revealing the interior on demand.** While a part or an internal cable is being dragged (`dragging.kind` `part`, or `cable` other than `cable.video`), or while `highlight` contains an **internal** id that exists right now (anything that is not one of the external ids above), the exterior fades away (about 0.3 s, wall time) regardless of zoom, so drag and drop and the tutorial work from any distance. It fades back when the drag ends and the highlight is gone. `flyTo(id)` is unchanged (it ends at a zoom of at least the fit zoom, so the interior shows). Highlights on `monitor`, `power`, `usb`, `tray`, `key:*`, `case`, `display0`, `cable.video` do not reveal. In dev, `window.__board.lod()` returns `{extA, reveal, interior}`.

**Performance.** When fully exterior, the interior layers are neither updated nor drawn (static layers stay baked; the live interior work is skipped, only fans / drive LED levels / the disk LED keep their cheap state). Measured in headless Chrome with software GL (SwiftShader, 1360x800, a full machine with a SATA SSD, the same scene before and after this change): overview 32 ms/frame before and 33 ms after (no regression); mid-fade (x0.6) 24 ms; exterior (x0.45) 8-9 ms; far (x0.25) 8 ms (before, the camera could not go below 24 ms). Real GPU numbers were not measured.

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

## Routing

`routes.ts`: a route is a centre line of horizontal, vertical and 45 degree segments; `bundle(centre, n, spacing)` copies it n times at a fixed spacing (miter offset, 90 degree corners chamfered to 45). Nothing is random, nothing is routed through a component, and no two buses cross (a bus may pass under a slot body, as traces do on a real board). `buildBuses()` builds the buses of the current tier from `GEO`:

| Bus | From to | Lit by |
|---|---|---|
| `mem` (a 6-lane bundle per DIMM, staircase) | CPU east edge to the pad row of each socket | RAM traffic (installed DIMMs only) |
| `nvme` | CPU south-east to the M.2 connector | program load |
| `dmi` | CPU south edge down onto the chipset | request start/finish, display writes |
| `usb`, `sata` | CPU west edge to the rear I/O shield (through the hub controller) / chipset east edge straight to the SATA ports | drive traffic (`sata`), never (`usb`) |
| `pcie` | CPU south edge into the x16 slot | never (GPU is decor) |
| `video` | CPU west edge, over the chipset, up to the HDMI port | display text changing |
| `pwrcpu` | the 8-pin down and along the VRM input rail | CPU current |
| `vcore` | each VRM phase down into the package edge | CPU current |
| `pwr12` | the 24-pin to the memory regulator's input rail | 55% of the total draw |
| `vdimm` | the memory regulator along the DIMM sockets (a drop into each) | RAM current |
| `audio`, `lan` | codec and PHY to the I/O shield | never (decoration) |

Cables have three states (`syncCables` in `board.ts`, a layer of its own so plugging never rebuilds the baked scene): **connected** (routed, as below), **loose** (`looseCable` in `routes.ts`: a short stub from the PSU socket / monitor port ending in a plug that lies at rest, the PSU plugs in the gutter east of the board, the HDMI plug just outside the rear I/O; no routed cable, no glow) and **held** (in the player's hand: `interact.ts` draws a rubber-band cable from the fixed end to the pointer). The source part must be installed for the cable to exist at all.

PSU cables (`buildCables`): sleeved, braided look, rounded corners, plug at both ends. They leave the PSU's top-edge sockets and rise through the cable gutter east of the case's board area. The 24-pin and the PCIe cable turn west into plugs on the east-edge connectors; the 8-pin keeps rising to the top of the case, runs west over the board and drops onto the connector on the top edge (its plug points up, the cable leaves upward). ATX 24-pin and CPU 8-pin exist whenever a PSU is installed; the PCIe 6-pin only when a device occupies a `pcie*` slot (none exists today). The HDMI cable (straight, thick, plugs on both ends) goes from the rear I/O HDMI port to the monitor's side port and exists only with a display installed.

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

World units are pixels at zoom 1; the CPU socket is the origin. `cam {x, y, z}` is the world point at screen centre plus zoom. The camera frames the board in the area not covered by UI. **Reserved space (`viewInset`)**: the UI reserves space with the `viewInset` signal in `src/game/hover.ts`, an `Inset {top, right, bottom, left}` in CSS px per side (the HUD writes it from the measured bar and dock/drawer rects, `InsetReporter` in `Hud.tsx`). The renderer keeps it as the camera target `camera.inset` and draws the **eased** value (`camera.shown`, about 0.3 s to settle), so a panel opening or closing glides. The new value is taken only when no pointer gesture (pan, pinch, grab) and no part drag is running, so **nothing re-frames under the pointer**; a change made mid-drag applies on release. The view centre (`cx`, `cy`) and `fit()` use the free area, so the overview shows the whole scene (board, PSU, monitor) beside the shop: if the camera is at the overview when the free area changes it glides to the new overview fit (450 ms). "At the overview" is judged on where the camera is **heading** (`Camera.targetView`, so a change that lands during an overview flight still refits; it used to be missed); otherwise the world point at the view centre stays put and the content moves by half the change. Window resize re-frames the same way (instant). Drag pans, wheel and two-finger pinch zoom about the cursor (down to 0.2x of the fit zoom, see the LOD section). A press, wheel, pinch, `F` / `B`, or another flight cancels a flight (see **Flights** below).

**Flights** (`flyTo(id, opts?)` in `board.ts`, `Camera.flyTo(view, dur, onDone, hold)`): defaults are `smooth: true` (1400 ms, eased pan, exponential zoom), no `zoom` (the target's rect plus about 900 world px of context is framed with margin 0.9, the zoom is then capped at 0.3 and kept at least at the overview fit zoom), `hold: false`, no `onDone`. `zoom` lands at that zoom (clamped to the camera range), `smooth: false` jumps at once, `hold: true` keeps the target: its world point stays at the centre of the free area through UI inset changes and the overview re-fit is off, until the player pans or zooms (wheel, pinch, drag) or another flight starts. `onDone(arrived)` is called exactly once: `true` when the flight lands, `false` when it is cancelled (a press on the canvas, wheel, pinch, `F`/`B`, another flight, `Camera.set`) or the id is unknown. `flyTo` returns `false` synchronously for an unknown id (and calls `onDone(false)`), otherwise `true`. Chain a tutorial step with `onDone`: `flyTo('psu', { onDone: (ok) => ok && next() })`. `F` flies to the die, `B` to the whole scene (board, PSU, monitor, cables). Also exported from `board.ts`: `flyToCpu()`, `flyToBoard()` for UI buttons. In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard}` is exposed for screenshot scripts.

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
- Fans (cooler or liquid pump, PSU, and the VRM heatsink fan `vrm-sink-fan`) spin faster with CPU temperature, PSU load, and CPU load (VRM sink fan). They run whenever the machine is **on**, including `halted` and `error` (a halted machine is still powered): `liveOn = snapshot.powered && !power.off && !power.tripped && !board.burnt`. A fan that loses that (off, tripped, dead) is still on the next frame (no coasting).
- CLI monitor shows `snapshot.display` (`READY.` when idle and empty): the last 8 lines, wrapped at 32 columns, in 150 world unit type so it reads at overview zoom.
- Pipeline: chips are keyed by dynamic instruction id and coloured by class (alu cyan, mul violet, load amber, store green, branch/jump magenta). Bubbles are dashed boxes labelled by cause (flush in red, with the tile tinted). Stalled occupants get an amber ring. Chips tween from their old stage to the new one over about 0.8 of the time since the last snapshot (max 0.9 s); retired chips slide out of WB, squashed ones drop and fade. No tweening at 4x/16x or when snapshots arrive faster than 350 ms apart.

## Hover and selected contract

`hover` is `{id, x, y}` (client pixels) or null, written on pointer move (mouse only; hidden while dragging). `selected` is the id of the clicked thing or null (click on nothing). Hit order, first match wins:

0. **Props** (new): `power`, the plugged key, tray keys (`key:<keyId>`), then `usb`, `tray`.
1. Cables and the PSU readout: `cable.atx cable.cpu cable.pcie cable.video` (sleeve, loose stub or plug) and `psu.readout`.
2. Die tiles when zoom >= 0.45: `cpu.IF cpu.ID cpu.EX cpu.MEM cpu.WB cpu.IC cpu.BP cpu.CLK cpu.DC cpu.RF cpu.UNCORE cpu.MC cpu.IO cpu.L2`
3. Installed parts: the **device instance id** from the snapshot (`dev1`...) for the CPU, each DIMM and the cooler; `psu` for the PSU body and `monitor` for the monitor. Hover and `selected` both write the stable ids `psu` and `monitor` (never the device id). `describeId` in `src/ui/logic.ts` falls back to `REGIONS` (`src/ui/regions.ts`, which has `psu` and `monitor`), so the tooltips describe both without a UI change.
   The cooler sits over the CPU, so the two ids are split by position: **the cooler body** (its `COOLER` rect) is hit first, below zoom 0.45 (the cooler fades out above that); **the CPU** (its package `PKG`) is hit at every zoom, so the exposed package ring around the cooler picks the CPU. Die tiles (item 2) still win over both at zoom 0.45 and above. Checked with real mouse events: the cooler body opens the cooler picker, the ring opens the CPU picker, and hover writes the id that the click will pick.
4. Empty slots by **slot id**: `cpu0 dimm0..3 cooler0 display0 atx0 atx-plus0 pcie0 pcie1`.
5. `chipset` (the PCH), then decor regions: `vrm vrm2 pcie io atx cpw m2 sata bat audio hex qr`.
6. **The motherboard** (`board`, the last hit): an empty area of the board writes `board` to `hover` and `selected` (the board picker). Everything above it (devices, slots, regions, cables, props) wins, so a click on those never lands on `board`.

**Full id list** (everything the renderer writes to `selected` / `hover`, and everything `highlight`, `flyTo` and `hasTarget` accept):

| id | what |
|---|---|
| slot ids (`cpu0`, `dimm0`..., `cooler0`, `display0`, `atx0`, `pcie0`) | the socket / bay, filled or empty |
| device ids (`dev1`...) | an installed CPU, DIMM or cooler |
| `psu`, `monitor` | the installed (or empty) PSU and monitor |
| `case` | the chassis frame (top panel, side walls, floor); the glass area belongs to the board. At far zoom (exterior view) it is the whole case rectangle |
| `vrm` | the VRM block north of the CPU (phases, PWM, power-good light); also a `highlight` / `flyTo` target now |
| `vrm-sink0` | the VRM heatsink pad (slot id), empty or filled; an installed heatsink is also hoverable by its device id |
| `dimm0`..`dimm7`, `pcie0`..`pcie3` | up to eight DIMM and four PCIe slots, a tier has the first ones |
| `bay` | the drive cage (cells are `sata0` / `sata1`) |
| `sata0`, `sata1`, `m20` | the drive cell / M.2 slot, empty or filled; an installed drive is also hoverable by its device id |
| `os` | the OS badge on the drive that hosts the OS (exists only while an OS is installed); the monitor screen is display only |
| `psu.readout` | the PSU's live panel |
| `tray` | the key tray |
| `key:<keyId>` | a key in the tray or in the USB port |
| `usb` | the USB port on the rear I/O |
| `power` | the power button (on the case's top panel, with the on / off / error and disk lights) |
| `chipset` | the PCH |
| `board` | the whole motherboard: the board picker, written by a click or hover on an empty area of the board (the last hit, below every device, slot, region and cable); also a highlight / flyTo target |
| `cable.atx`, `cable.cpu`, `cable.video` (`cable.pcie` is plumbed, never drawn) | a cable: the plug is what is grabbed; as a highlight target it rings the plug and, while loose, also the matching board socket |

Click behaviour on top of writing `selected`: `power` calls `powerButton()` (and shows `noPowerReason` as a message when it would do nothing); `key:<id>` in the tray calls `plugKey`, the plugged key calls `ejectKey` (not while loading, running or writing: a message explains). A refused sim action (`lastError`) is shown as a short message at the point where the player acted.

## Interaction (hover, drag and drop)

Input is pointer events only (mouse, touch, pen). `camera.onGrab` decides at pointer down whether the gesture is a drag of something (cable plug, key) or a pan; dragging empty space pans, and a second finger cancels a drag and starts a pinch. A press that moves less than 6 px is a click.

- **Hover affordance** (`interact.ts`): every interactive id (everything in the table above except decor regions, die tiles and `board`) eases a lift and 7 percent scale on movable props (keys, the power button) and an accent outline glow on everything, with a `pointer` cursor, or `grab` on draggables (`grabbing` while dragging). Installed parts and sockets are baked into textures, so they get the outline only. Decor never animates.
- **Parts**: dragging a part out of the inventory menu shows a ghost (steady on-screen size) (there is no world item to dim). Valid targets (`inventory[].freeSlots` green, `swapSlots` amber, `["board"]` for a board upgrade) pulse; every other socket is dimmed; over a valid socket the ghost settles on it. Drop on a valid socket calls `install(invId, slotId)` (the ghost fades into it); anywhere else it flies back. A refused drop shows the reason next to the pointer (`inventory[].reason`, "Power the machine off first" while powered, or "<part> does not fit the <type> socket"). While powered the whole drag shows the reason beside the ghost and the sockets are only lightly dimmed.
- **Cables**: the plug rests loose beside its source. Dragging it stretches a sagging cable from the fixed end (PSU socket / monitor port) to the pointer; the matching board socket pulses; within reach the plug snaps into the socket pose. Drop there: `connectCable(kind)`, and the routed cable appears when the snapshot confirms (the state is optimistic for up to 1.5 s). Elsewhere it falls back to its rest spot. Dragging a connected plug away calls `disconnectCable(kind)` immediately and the plug is in hand. Powered machine: a message, no drag. Dropping next to the wrong socket says so.
- **`beginPartDrag(inventoryId, event)`** (exported from `src/render/board.ts`): the inventory menu calls it from a DOM `pointerdown` (outside the canvas). It starts the part drag above immediately (no 6 px threshold), captures the pointer and listens on `window` for `pointermove` / `pointerup` / `pointercancel`, converting client coordinates to world through the camera. Drop on a valid socket installs; any other drop snaps the ghost back to where the press began (with the refusal message when over the board). Escape, `pointercancel`, window blur, or a release outside the canvas rectangle cancel (snap back, nothing installed). `dragging` becomes `{kind: 'part', id: inventoryId}` and returns to null at the end. Ids in `highlight` that do not exist are skipped silently. Give the pressed element `touch-action: none` so touch does not scroll.
- **Keys**: drag a key from the tray to the USB port (`plugKey`; the stick is held by its plug end and shrinks to the compact size over the port; the port pulses green, or red with a message when a key is already in), or click it. The plugged key is clicked or dragged away from the port to eject (`ejectKey`, payout); while loading, running or writing it refuses with a message. A finished plugged key (`stage` `done`: a no-OS job done, or a key the OS has flashed) carries the **remove cue** (see USB keys) instead of a ring.
- **Power**: click calls `powerButton()`. While powered (any phase, including halted and error) the button ring reads on (green); off is the muted ring. The case lights: ON green while powered and the power path is up (not tripped or dead); OFF amber standby when unpowered with a working PSU path; ERR red blinking in phase `error` or when the PSU tripped or the board is dead. A click while powered is a hard power-off: everything goes dark on the next frame and the key stays plugged.

`dragging` (`src/game/interaction.ts`) is `{kind: 'part' | 'cable' | 'key', id}` during a drag and null otherwise.

## Tutorial support

The UI writes `highlight` (`src/game/interaction.ts`, an array of ids from the table above). Each resolvable id gets a pulsing amber double ring and a bobbing arrow above it, sized to stay readable at any zoom. When the target is off-screen (outside the free area, see `viewInset`) a round edge indicator with an arrow sits on the border of the free area pointing at it; clicking it flies there. Ids that do not exist right now (an `inv:` part already installed, `cable.atx` before a PSU exists) are skipped silently.

Exports of `board.ts`:

- `flyTo(id, opts?): boolean` flies the camera to any id in the table with the options and defaults in **Flights** above (`smooth`, `zoom`, `hold`, `onDone`); returns false for an unknown id.
- `anchorOf(id)` and `cameraRev`: live screen positions for popups and pointers, see **Anchors** below.
- `hasTarget(id): boolean`: whether the id exists in the world right now.
- `flyToCpu()`, `flyToBoard()` as before.

In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard, flyTo, anchorOf, cameraRev, hover, interact, scene}` is exposed; `scene.rects` maps every id to its world rect and `interact.rectsFor(id)` returns the rects a highlight would ring (the screenshot scripts use it to drive real mouse events).

## Anchors (popups and pointers for the UI)

`anchorOf(id): { x, y, w, h, visible } | null` (exported from `board.ts`) is the **screen rectangle** of a world id, in client px (relative to the viewport; the canvas offset is included). It uses the same rects as hit testing (`scene.rects`, and `rectsFor` for cables: the plug rect, the seated or resting one). The stage is in CSS px (`autoDensity`), so no device-pixel-ratio factor applies. Returns `null` for an unknown id and for inventory ids (`inv:*`), which are not world objects.

- `visible` is true when the rect meets the **free area** (the canvas minus `viewInset`, as drawn) and the exterior case does not hide it. Interior ids (slots, devices, `psu`, `bay`, `os`, `vrm`, interior cables, ...) are hidden at far zoom (exterior cover above 0.5, the same rule as hit testing); external ids (`power`, `usb`, `monitor`, `tray`, `case`, `cable.video`, `key:*`, `display*`) are always visible when on screen. The rect is still returned when `visible` is false, so a pointer can point at it while the UI decides what to show.
- Empty sockets answer to their slot id (`cpu0`, `dimm2`, `atx0`, `display0`), installed parts to the device id, so `anchorOf('psu')` and `anchorOf('monitor')` are the PSU and monitor rects whether or not they are installed (hover writes `atx0` / `display0` over an empty one; see the table above).
- **`cameraRev`** (`src/game/interaction.ts`, a signal): the renderer bumps it **at most once per frame, and only when something changed**: the camera moved (pan, zoom, flight, eased inset), the canvas resized or moved, the exterior cover changed, or the layout changed (board tier, a device installed or removed, cables connected or loose, tray keys, the OS badge). Read it in an effect and recompute `anchorOf` there. It stays still when the machine idles (checked: no bumps in a second with nothing moving).
- Popups next to a part should be placed from the rect with the free area in mind; `flyTo(id, { hold: true })` keeps the part centred in the free area while the UI opens panels.

Verified in headless Chrome (software GL): `anchorOf('cpu0')`, `psu`, `monitor` and `power` against the hit position at each rect centre (`hover` as the hit result; `cpu0` hovers `cpu0`, `power` hovers `power`, the PSU and monitor hover their empty slots `atx0` / `display0`); after a zoom and after a pan the anchors moved by the camera transform and `cameraRev` bumped; at far zoom `cpu0` is `visible: false` with its rect and hover on it is not `cpu0`, while `monitor` and `power` are visible; an off-screen monitor is `visible: false`. The pure transform (`screenRect`) and the flight and inset rules are unit tested in `src/render/camera.test.ts`.

## Boot visuals

- **PCH** (`chipset`): when powered and posting (after the cold-boot wait), loading or writing it gets a violet outline glow and a row of animated activity bars; calm in every other phase.
- **Buses carry the data** (existing lanes only; a bus lights only while its phase moves data and fades about 1.7 s after): posting (after the cold-boot wait) lights DMI; loading runs USB port to PCH, PCH to CPU (DMI) and CPU to RAM (memory bus); writing runs RAM to CPU, CPU to PCH and PCH to the USB port. The video bus and cable still light when the monitor text changes (and only when `monitorLive`). **No data moves while `halted` or `error`**, nor during the cold-boot wait: those buses, drive activity and the PCH stay dark, while the fans, the lights and the power conductors keep running.
- **Cold-boot wait**: phase `posting` with `bootProgress` 0 (no POST line yet). The CPU idles, so the monitor is black (no text, no NO SIGNAL when a cable is connected), and nothing lights on the buses.
- **USB port LED**: dark with no power, while `halted` or `error`, and with no key. Steady green with a key in (powered, running); blinking amber while loading or writing. A key that the halted machine never read (`keyIgnored`) sits in the port with the LED dark and the key dimmed with a static `NOT READ` label (no blink).
- **Monitor**: shows `snapshot.display` when `monitorLive`, except during the cold-boot wait (black, the sim has no text yet) and in phase `error` unless `postFailed` (a POST error shows its text; any other error, a PSU trip or a burnt part, shows **NO SIGNAL**). **NO SIGNAL** when a monitor is installed, the machine is **powered** and it is not live (no video cable, burnt monitor) or is in a non-POST error (logic in `monitor.ts`, tested in `monitor.test.ts`); a blank screen when live and the machine is off, and a blank screen with a dark LED when off with no cable. A halted machine shows the sim's text (`NO BOOT MEDIA` / `JOB DONE` lines). After a hard power-off the screen is dark on the next frame. An empty monitor bay is drawn as `MONITOR BAY` (a dashed placeholder, never NO SIGNAL). Its power LED is green when live and powered, amber when live and off. A thin green bar under the picture follows `bootProgress` during `posting` and `loading`.

## Power-off rules (everything that moves needs power)

With the machine off, tripped or dead (`board.burnt`): every fan stops on the next frame (cooler fan or pump, PSU fan and its readout fan, the VRM sink fan), no bus or cable carries pulses or glow, no DRAM flash, drives are still (platter, head, LED), the USB LED is dark, the case lights show only what is true (the green ON light needs power and a working power path; the amber OFF standby light needs a working PSU path, so it is dark when `noPowerReason` is set (no PSU, burnt PSU, ATX unplugged, dead board); ERR is red when the phase is `error`, the PSU tripped or the board is dead), the VRM glow is off and its power-good light is dark (red blinking when dead), the monitor is blank. A powered **halted** machine is the opposite on the fans and lights: fans spin, ON is lit, the case strip is steady amber; only the data paths are quiet. A powered **error** machine (POST failed) has fans spinning, ON lit, ERR red and the strip red. Heat glow stays while parts cool (it is temperature). All animation is on the game clock, so a pause freezes it. The PSU readout snaps to the ambient value (25 C, COLD) on a hard power-off, so there is no cooling tail; while the PSU is on it follows the low-pass of the estimate.

## Board tiers, cases and the VRM

**Four boards, four form factors** (`boardlayout.ts`, `TIER_GEO`; the CPU socket is the origin on every one and the rear I/O is on the west edge):

| Tier | Form | Board (w x h) | Sockets drawn |
|---|---|---|---|
| 0 Starter | mini-ITX | 5450 x 3900 | 1 DIMM, 1 SATA, no PCIe, no M.2, no ethernet jack |
| 1 Basic | micro-ATX | 5800 x 4700 | 2 DIMM, 1 PCIe, 2 SATA, ethernet |
| 2 Mainstream | ATX | 6800 x 5000 | 4 DIMM, 2 PCIe, M.2, 2 SATA |
| 3 Enthusiast | E-ATX | 6800 x 6000 | 8 DIMM (two rows), 4 PCIe, M.2, 2 SATA |

A socket a tier lacks is **not drawn** (no ghost sockets). `src/render/boardlayout.test.ts` pins the geometry to the sim's slot and phase counts, keeps parts on the board and off each other, checks the memory bundles never cross, that every bus ends on a footprint and every plug sits on its connector. **The layout is global state**: `setLayoutTier(tier, caseTier)` (called first in `build()` and, saved and restored, by `thumbs.ts`) reassigns the live bindings (`BD`, `BR`, `PSU`, `CASE`, `WORLD`, ...). Never copy one into a module-level constant.

**How the copper is laid** (every run ends on a footprint, with pads drawn at the lane ends):
- **Memory** is point-to-point: one 6-lane bundle per DIMM from the CPU's east edge to the pad row of its socket, stacked in a staircase (the nearest DIMM takes the band nearest its pads) so nothing crosses. Row 0 pads face down, row 1 (tier 3) pads face up. Lit per installed DIMM by RAM traffic.
- **CPU power**: the 8-pin sits on the top edge (mouth up, the cable comes over the top of the board from the gutter), feeds an input rail (`pwrcpu`) along the top of the phases; each phase runs power stage, choke and output capacitors into a copper pour under the CPU's north edge (`vcore` rays, lit by CPU current).
- **Memory power**: the 24-pin feeds the memory regulator's rail (`pwr12`), whose outputs run along the pins of the DIMM sockets (`vdimm`, a drop into every socket, round the east end to a second rail under row 1), lit by RAM current.
- The package's south edge feeds three columns, west to east: PCIe x16 (into the first slot), DMI (straight down onto the chipset, `DMI_X`) and NVMe (down and east into the M.2 connector, `NVME_X`). The chipset sits south-east of the CPU, east of where the slots end, on the SATA ports' rows, so its SATA lanes run straight east to the ports. **No signal trace crosses a PCIe slot, a DIMM, the M.2 or a chip it does not end on** (`boardlayout.test.ts` checks it). USB runs from the CPU's west edge to the rear I/O under the hub controller; video goes west and up to the HDMI port. Audio and ethernet PHY traces are decoration (`audio`, `lan`: never lit).
- **Mounting holes**: drawn last, each with a clear ring of bare board, so no trim or silkscreen line runs through a screw; the test keeps every part and every lane out of their keepout. The trim lines are drawn first, under every part, and the bottom silkscreen sits above them.
- **VRM**: a PWM controller, then the tier's phases (`vrmPhase(i)`, centred over the CPU; 2, 3, 4 and 6), each a power stage, a choke, two capacitors and decoupling. **Memory VRM** (2, 2, 3, 4 phases) above the DIMM bank. Glow, power-good light and crash flash are as before (`Live.drawVrm`).
- **Heatsinks** (`vrmSinkArt`) cover the power-stage strip (`VRM_SINK`, `RAM_SINK`).
- **Tier skin** (`SKINS` in `boardArt.ts`): PCB colour (Starter grey-green, Basic blue, Mainstream teal, Enthusiast violet), trim lines, PCH heat sink style, PCIe armour from tier 2.

**Cases** are purchasable (docs/BOARD.md "Cases"): `snapshot.caseTier` picks the case, `snapshot.boardTier` the board in it. The case is as big as the biggest board it holds (`CASE_BD`): the motherboard tray (perforated, cable cut-outs), the cable gutter and the edge-on **front fans** follow the case; a smaller board sits in the top-left of a bigger case. The PSU shroud, the drive bay, the case walls, the power button and `WORLD` move with it, and the camera glides to the new overview when it changes. Looks per case (`CASE_LOOK`): name on the top panel, vent count, an accent line on the big ones. A case item is dropped on the case itself (`freeSlots ["case"]`, like `["board"]` for a board); the case is the world id `case`.
- SATA ports are on the board's east edge (mouth east); each drive cable runs east, under the PSU cables, then down the lane between the PSU and the bay (`SATA_LINK.col`) into its cell. The two cables never cross each other; both pass under the three PSU cables in the gutter (drawn beneath them).

**Scale.** The monitor is drawn at its design size (3300 x 1995) and scaled by `MONITOR_K` (1.6) around `MONITOR`; its screen text and OS screen live in a container in design units (`SCREEN_D`) scaled the same way (`Live.scr`). The router and the wall plate are drawn at design size around the shelf corner and scaled by `NET_K` (1.45); the helpers in `net.ts` (`routerRect`, `lanX`, `wanX`, `sockLed`) give the scaled world positions.

**Pictures of parts** (`thumbs.ts`): `thumbOf(id)` returns a cached data URL or null while it is being made (one part per idle slice); `thumbsVersion` is a signal that bumps when one arrives or the theme changes. The art is the real thing: `cpuArt`, `ramArt` (on its side), `coolerArt`, `psuBoxArt`, `monitorArt`, `driveArt` plus its live parts, `vrmSinkArt`, `nicArt`, `routerArt`, `wallArt` (the plan plate), the whole board (`buildBoard`) and the case (`exteriorArt`), on a soft backdrop. `PartArt` shows the picture and falls back to its drawn icon (an OS, tests without a renderer).

## Performance

Static layers are cached (the tray / power plate chrome is one texture below zoom 0.2, each prop node is cached as a texture below zoom 0.2, the cables are their own small layer): retained geometry, the board texture below zoom 0.2 and the device layer texture (devices, PSU, monitor, cables) below zoom 0.14. Textures are destroyed on rebuild. Per frame JS is the fan rotation, the pooled dot sprites (only lit buses and cables show pulses) and one DRAM flash Graphics only while the memory bus is lit. Per snapshot: a few Graphics (heat glow, PSU gauge) and a handful of Text updates (only when the string changed). Measured in headless Chrome with software GL (SwiftShader, 1360x800, GPU-bound and pessimistic), full machine installed: page baseline about 16 ms/frame, overview 19-23 ms (44 ms before the device bake: the device layer alone cost 28 ms), PSU mid-zoom 33 ms, DIMM mid-zoom (zoom 0.35) 62 ms, CPU die 56 ms. Real GPU numbers were not measured. With the assembly props (same setup): bare or assembled overview about 20 ms/frame (mostly 16.7 ms with an occasional 33 ms), dragging a key about 20-33 ms, boot with the PCH and buses lit about 21 ms at overview and about 56 ms at zoom 0.22 (GPU-bound, like the DIMM mid-zoom number above). Before baking the props the overview was 32 ms.

Text sharpness: `Camera.apply` sets every Text's resolution to `textResolutionFor(zoom, devicePixelRatio)` (whole steps, 2 up to 4, so 2 at zoom <= 2 on a 1x display and 3 above it), walking the world tree only when the step changes; `label()` in `ink.ts` starts new text at the current step. Covered by `camera.test.ts`. Frame time was not measured in a browser: below zoom 2 nothing changes (resolution stays 2), above it each step re-rasterises the labels once.

## Network (router, wall plate, ethernet cable, NIC cards)

Code: `src/render/net.ts` (`NetView`, `routerArt`, `nicArt`), geometry in `layout.ts` (`ROUTER_SPOT`, `WALL_PLATE`, `LAN_TRUNK_X`, `nicJack`, `nicRect`), the plug drag in `interact.ts` (`beginLan`, `scene.lan`), wiring in `board.ts` (`syncNet`). Data: `snapshot.net`, `cables[id=lan]`, `devices[kind=nic]`, inventory kinds `router` and `nic`. Nothing here changes the overview fit: the router shelf and the wall plate sit above the monitor, inside the existing `WORLD` box (the case did not shrink).

**Ids** (hover, `selected`, `highlight`, `flyTo`, `anchorOf`, `hasTarget`; all of them are external: hit and visible at far zoom, they never open the interior):

| id | what |
|---|---|
| `router` | the installed router, or the empty marked spot (dashed `ROUTER`) when none is; it is also the drop slot `router` (`scene.slots`) of an inventory router (`freeSlots ["router"]`; a better router is a `swapSlots` target and is amber) |
| `wall` | the wall plate: plan speed (`50 Mb` .. `20 Gb`), plan name, five tier pips, the jack and its light |
| `cable.lan` | the ethernet plug (rest spot near the router, or seated in a jack); the cable body also hits. As a highlight it rings the plug and, while loose, every valid jack |
| `eth0` | the board's own jack (only boards with `ethernetMbps > 0`; port `"board"` in `connectCable`) |
| `eth1`, `eth2`, ... | NIC jacks in PCIe slot order (the lowest slot is `eth1`); the port to pass to `connectCable("lan", port)` is the card's device id (`LanJack.port`, equal to the snapshot's `net.port.deviceId` once plugged) |
| device id (`dev9`...), `pcie0`..`pcie3` | the NIC card (hit rect = card plus bracket and jack) and its slot; the slot is the drop target of a `nic` item (free and swap slots from the inventory) |

The group is drawn only when it matters: a router or a plan exists, a router is in the inventory, or the cable is plugged. Before that the world is unchanged (calm early game).

**Looks** (`net.router.visual`, one per tier): `router-home` (small light plastic box, WAN and two LAN sockets), `router-gbe` (dark glossy box, cyan edge, WAN and four LAN), `router-10g` (brushed aluminium, SFP cage, eight LAN), `router-core` (1U rack unit with ears, vent slots, twelve LAN). All stand right-aligned on the shelf; sockets open at the bottom edge (cables leave downward), WAN left, the used LAN socket rightmost. NIC cards (`nic-gbe`, `nic-10g`, `nic-40g`): PCB with a controller chip, gold fingers on the slot, a bracket and an ethernet jack with two LED wells on the board's west edge, a finned heatsink on 10G and a bigger one with a heat pipe and a second sink on 40G. NICs get the generic heat glow. A NIC does not draw the PCIe 6-pin cable (the slot feeds it).

**Cable flow.** The plug of the `lan` cable rests near the router (a short stub from the router's LAN socket). Drag it (a press that moves more than 6 px): a rubber-band cable follows the pointer, every jack pulses (valid) or is dimmed (a burnt card), the hovered valid jack glows and the plug snaps into it. A drop on a jack calls `connectCable("lan", "board" | cardId)`; this works while the PC is on (no "power off first" message, unlike the other cables). Dragging the seated plug out calls `disconnectCable("lan")` at once and puts the plug in the hand; dropping it anywhere but on a jack leaves it at rest. A drop elsewhere on the board says `Drop the plug on an ethernet jack`; a refusal from the sim (`lastError`) shows as the usual inline message and clears the optimistic plug state (about 1.5 s, as for the other cables). The router drag uses the normal part drag with one change: a router installs while the PC is on (it has its own power), so the "Power the machine off first" refusal does not apply to it. Routed cable: down from the router's plug, east along the row above the monitor, down the trunk `LAN_TRUNK_X` (between the video plug and the case wall), west into the jack across the case wall, with rounded bends. It never meets the PSU cables or the ISP line. **Known crossing:** the trunk to a NIC jack (below the HDMI height) crosses the video cable's sleeve once at a right angle (drawn in front of it), and a key plugged into the USB port is drawn over it; the onboard jack's run is above the video cable and crosses nothing. The cable is external, so it stays visible in the far-zoom exterior view; the jack LEDs are on the exterior rear plate too (`exterior.ts` draws the NIC jack cut-outs).

**LED meanings** (game clock, from `net.state`; the router has its own power, the jack LEDs need the PC powered):

| light | meaning |
|---|---|
| router power (top left) | steady green whenever a router is installed, also with the PC off |
| router activity (next to it) | cyan flicker while transfers run |
| WAN (over the left socket) and the wall jack light | steady green once there is a plan (a little flicker with traffic), dark without a plan |
| LAN (over the used socket) and the jack link LED (left) | no cable or PC off: dark; `link-up` steady green; `saturated` pulsing green; `down` / `no-os` / `no-device` with the PC on: amber |
| jack activity LED (right) | amber flicker while transfers run |

**Traffic pulses.** Only while transfers exist and the link is up: dots travel the lan cable and the ISP line, downloads towards the PC (cyan), uploads towards the router (violet), at a speed and density that follow `net.bandwidth` of that direction (log scale, 10 Mbit to 40 Gbit); the amount eases in and out on the game clock (`gdt`), so a pause freezes them. No transfers or no power: nothing moves.

**Tray and USB fallback** (`trayArt(T, keys, mode)`, mode from `net.usbFallback.state`): `off` as before; `retired` dims the tray panel and says `LINK UP: KEYS RETIRED` (or `LINK UP: n LEFTOVER`; leftover keys stay fully visible and usable); `waiting` says `NET DOWN` in amber; `fallback` says `NET DOWN: STICKS BACK AT 1/3 RATE` and the panel is normal again. The countdown text is the UI's job (the tray is rebuilt only when the state changes, not every second).

**LOD.** The router, wall plate, cable and jack LEDs live in the always-external layer (`NetView.root`, above the exterior case), so the far-zoom view keeps them; at the overview they are small but read as a lit box with a cable. Far-zoom hit tests accept `router`, `wall`, `cable.lan` and `eth*` (`isExternalId`); NIC device ids and `pcie*` are interior ids as before.

**Verified** (headless Chrome, software GL, sandbox saves, real mouse events through `beginPartDrag` and the canvas; 1360x800 dark and light, 1920x1080 light): a router dragged from the inventory onto its spot installs (and is refused on a PCIe slot, a NIC on the router spot); all four router looks, the wall plate with plans 1 to 4; NIC cards `nic1`, `nic2`, `nic3` dropped on PCIe slots; the plug dragged onto `eth0` and onto a NIC jack, pulled out again (disconnects, plug back at rest) and re-plugged, all while the PC was on or off; power on, OS up, link up, downloads with pulses, the retired tray look; power off (router power and WAN lights stay, jack LEDs go dark, the tray says `NET DOWN`); two screenshots of a paused frame are byte-identical and differ again after the resume; far zoom with the router, cable and the NIC jack on the rear plate, and hover ids `router`, `wall`, `cable.lan`, `eth0` at far zoom; `anchorOf`, `hasTarget`, `flyTo` and a highlight for the new ids. Upload pulses and a `link-down` amber LED were checked with a spoofed snapshot (both directions drawn), not from a real upload; `saturated` came from a real run (spool full). Not verified: touch, the burnt-card dimming, the plugged-key-over-cable overlap.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- At far zoom the monitor text is small (zoom scales it with everything else; it is readable down to about 0.5x of the fit zoom, a shape only below). The exterior is baked at 0.35x, so it is soft if forced visible at high zoom (it never is, the LOD fades it out above 0.7x). The 8 DIMM sockets use shorter sticks (4 chips) than the old single bank, and the second row's memory taps are drawn but only lit by the shared memory bus.
- The liquid cooler's tubes end in fittings (no radiator art). No GPU, NVMe, SATA or USB devices exist in the sim, so those buses never light (the PCIe cable is plumbed but never drawn).
- PSU temperature and fan rpm are renderer estimates from load (see above).
- Touch was verified with synthesized touch events (CDP), not on a device: tap to select, one-finger pan, two-finger pinch, and dragging a drive from the shelf onto `sata0` (see Verification). There is no hover on touch. Installed parts cannot be dragged back out (the UI picker uninstalls). Loose cable plugs and tray keys are small at overview zoom (use the tutorial rings, `flyTo` or zoom).
- Bus lanes are 9-11 world units wide, about a pixel at overview zoom; the pulses carry the activity there.
- Two drives: the SATA data cables cross the drives' short power leads in the lane between the PSU and the bay, and all three PSU cables in the gutter (drawn beneath them).
- The OS-flow cue (`REMOVE` on an OS-flashed key) is **not verified end to end**. An OS is reachable now (the sandbox buys it and installs it on a drive), but the browser run with real clicks did not reach the state: the power button did not leave `OFF` and a click on a tray key opens the client card rather than plugging it (the card's "Plug into USB" button is the plug). It uses the same `stage` `done` path as the no-OS cue.
- The VRM crash flash and the error blink were not provoked in the browser (no fault was run); their wall-time fade is by code.
- Overview on a wide canvas: the scene is about 1.7:1 and the free height is the limit, so the sides stay empty. Tightening the bounds gained about 5%.
- Chips are single-width; superscalar and out-of-order engines will need a wider stage layout and a bigger `pipe`.

## USB keys

A tray key is a wide stick (`keyStick` in `props.ts`, 1470 x 230 world units: a 330 plug and a 1140 body) that carries its whole label: **job id and type** (`#72 scan`), the **template** (`cli.scan`), and an **age bar against the deadline** with `age/span s` (or `LATE`), all coloured by urgency (green, amber over 65 percent of the span, red late). Text is ellipsised only when it would overflow the body (a very long template). The tray holds 2 columns by 5 rows. The plugged key is the **compact** variant (750 long: a 190 plug seated in the USB port plus a 560 body sticking out west, job id and bar, or `DONE`), so it stays clear of the monitor. Hover lift, click to plug or eject, and drag to the port work on both.

**Remove cue.** A finished key in the port (`stage` `done`) gets a glow around the stick and a tag under it: `TAKE ME` on a no-OS machine, `REMOVE` once an OS is installed. Both use the key's own green accent (`T.st`, not an urgency colour). They breathe on the game clock (one slow sine, about 1.8 s; frozen when paused) and vanish with the key. The tag and the glow scale up with the camera (`drawKeyCue`, up to 2.6x) so they stay readable at the exterior view. They live in the key's node, outside its baked art, so they still animate far out. The tray is a glass panel (`glassPanel`: gradient body, a top sheen, a sunken well), the same structure in light and dark.

## Verification (last pass)

Headless Chrome (software GL), 1360x800 and 1920x1080, through `window.__board`: a no-OS job run to `JOB DONE` at 16x, then the cue checked at the overview and at 0.5x of the overview (dark and light). Paused: two frames of the key area are byte-identical 1.5 s apart, and they change again on resume. PSU readout: 27 C under load, 25 C COLD 150 ms after a hard power-off. Hover: `monitor` and `psu` write their stable ids. SATA: one drive in `sata0` routed under the PSU, checked close up. Overview: the scene is 4-6% larger than before at 1360x800. Touch (CDP): tap selects, one-finger pan moves the camera, a two-finger spread zooms 3.25x, and a drive dragged from the shelf lands on `sata0`.

**Drop targets and picks (real mouse events, headless Chrome, software GL, 1360x800; 1920x1080 for `m20`).** Each run starts from a sandbox save written by the sim: Enthusiast board with the crate parts and RAM, the drives and the OS on the shelf. Results: an NVMe drive dragged onto `m20` installs (Mainstream and Enthusiast, at both sizes); an HDD onto `sata0` and a SATA SSD onto `sata1` install (Enthusiast); the Resident OS dropped on an installed HDD (`sata0`), SATA SSD (`sata1`) and NVMe (`m20`) sets the OS badge each time. The NVMe drive cannot be bought on the Starter board ("needs an M.2 slot (bigger board)"), so the drop there never starts: the earlier report that `m20` refuses the drive is the purchase gate, not the renderer. Picks: an empty board area opens the board picker (`board`); the cooler body opens the cooler (`dev` of the cooler); the exposed CPU ring opens the CPU; hover shows the id each click picks. The inset refit: with the Enthusiast machine and the shelf open the chassis ends above the shelf (no overlap at 1360x800); with a campaign game after Start, the chassis ends above the bottom-centre `.tut` card (the reserve is 314 px there).

Not verified in this pass: the OS remove cue end to end (see Known gaps), the VRM crash flash (no fault was provoked), and the two-drive power-lead crossing (seen, not fixed).
