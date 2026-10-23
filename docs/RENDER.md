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
| `live.ts` | per-snapshot and per-frame state: bus activity, cable glow, PSU readout, monitor text and NO SIGNAL, heat glow, fans, DRAM flashes, boot visuals (PCH glow, USB LED, boot bar), the VRM glow, power-good light, crash flash and the dead-board look. Two roots: `root` (interior) and `ext` (monitor screen, USB / monitor LEDs, video cable glow) |
| `exterior.ts` | the far-zoom exterior case (static art baked to one texture) and its live accent strip, `LOD` thresholds are in `board.ts` |
| `props.ts` | world props: part icons (drag ghost), USB key tray, wide key stick, power button and its lights |
| `interact.ts` | everything the pointer does: hover affordance, drag and drop of parts (`beginPartDrag`) / plugs / keys, drop-target pulses, inline messages, tutorial highlight rings and edge arrows |
| `pipeline.ts` | zoomed-in CPU chips and stage highlights |
| `case.ts` | the PC case: chassis, glass, drive bay cage, SATA data cables and power leads |
| `drives.ts` | drive art (`hdd`, `ssd-sata`, `ssd-nvme`) and their live parts (platter, head arm, activity LED) |
| `ink.ts` | small Graphics / Text helpers |

## World layout

```
 monitor ---- video cable ---- [ motherboard ] | cable gutter
 (16:9, stand)   (HDMI)        rear I/O west   |  PSU cables rise to the east-edge connectors
 key tray, power plate below the monitor
                              [ PSU shroud, full width, readout panel, output sockets ]
```

The CPU socket is the origin. West of the board: the **key tray** (under the monitor stand, 2 columns of wide keys) and the **power plate** (between the tray and the board's rear I/O). There is no crate in the world: the inventory is an HTML menu (`src/ui`) that starts part drags with `beginPartDrag`. Board `x -3400..3400, y -2500..2500`; PSU below it (`y 2750..3850`, wider than the board by the cable gutter); monitor to the west (`x -7500..-4200`, screen 3120x1755 world units, readable at overview zoom). `WORLD` in `layout.ts` is the rectangle the camera fits. On the board: rear I/O on the west edge (HDMI at the height of the video cable), chipset between I/O and CPU, VRM row north of the CPU, DIMMs and M.2 east, PCIe slots south, power connectors on the east edge.

## The case, the bay and the OS screen (storage and OS phase)

- **Case** (`CASE`, `case.ts`): a thin, low-contrast chassis around the motherboard and the PSU. West wall by the rear I/O (keys and the HDMI cable pass through), top panel with brand, vents, status lights, **the power button** (`power`) and a **disk activity LED** (lit only while a drive is busy), a quiet glass side over the board, a PSU compartment and feet. The monitor, the key tray and the held rack sit outside it. The chassis is static (a vector layer close up, one baked texture below zoom 0.14). The camera fit (`WORLD`) covers the case, the monitor and the tray.
- **Drive bay** (`BAY`, `BAY_CELLS`): a 2-cell cage east of the PSU. Cell 0 is slot `sata0`, cell 1 is `sata1`. An installed drive slides in (650 ms) and its **SATA data cable** (`sataCablePath`) runs to the board's SATA port (two ports on the bottom edge, `sataPort(i)`), plus a power lead from the PSU's east face. Slots come from `snapshot.slots` / `BOARD_TIERS` (only existing slots are drawn live; absent ones are faint).
- **Drives**: `hdd` (3.5in, label, platter and head arm), `ssd-sata` (slim 2.5in with a window onto controller and NAND), `ssd-nvme` (M.2 stick on the board's M.2 slot with a heat spreader). They animate only while `storage[].busy` (platter spin, head swing, LED blink); a bus (SATA or NVMe trace plus the cable) lights only then or in an OS flow.
- **Drop targets**: `sata0`, `sata1`, `m20` are drop targets when empty (storage) and when occupied (an OS item is dropped on an installed drive; `inventory[].freeSlots` decides). A refused OS drop on a bare socket explains it.
- **Bus flows (OS)**: `booting-os` lights the boot drive's bus and cable, DMI and memory (drive to RAM/CPU); `ingesting` runs key to drive (USB, DMI, drive bus); `flashing` runs drive to key. Idle stays dark.
- **USB LED** follows `keyActivity`: enumerating slow amber blink, ingesting fast amber, flashing fast cyan, done steady green that breathes (collect the key). Without an OS the old loading/writing blink applies.
- **Held keys** (`held`, `HELD`, `heldArt`): a small rack west of the case under the tray, holding `snapshot.held[]`. Each key shows its `stage` (`INGESTING`, `QUEUED`, `JOB RUNNING`, `DONE - PLUG AGAIN`, `WRITING RESULT`, `RESULT SAVED`) with a coloured band; a key whose result is ready gets the pulsing green ring and the rack header says `N READY - PLUG TO COLLECT`. Clicking a held key plugs it (same as a tray key).
- **OS screen** (display only): when an OS is installed, powered and the monitor is live, in `booting-os`, `idle-os`, `running-os`, `ingesting`, `flashing`, the monitor shows a terminal-style status screen built from `snapshot.os`, `storage`, `held`, `display`: OS name/tier and state, uptime, program slots and queue use, the running job with a sliding progress cue, queue rows (`+N AHEAD` / `NEXT` / `DONE`), a `PLUG KEY ... TO COLLECT` line, storage use of the boot drive, and the live POST/boot lines while booting. Missing fields are skipped. Otherwise plain CLI text, `NO SIGNAL` and POST as before. The screen is **not** a hit target: the monitor is one object (`monitor`).
- **OS badge** (`os`): a small `OS` chip with a status dot on the drive that hosts the OS (`snapshot.os.slot`; HDD or SATA SSD in the bay, NVMe on M.2; `osBadgeRect` in `drives.ts`). The dot follows the phase on the game clock: booting pulses amber, idle steady green, ingesting / flashing blink, running breathes cyan. The badge is the hover / `selected` / `highlight` / `flyTo` target `os` and exists only while an OS is installed on a present drive; clicking the drive body still selects the drive's device id.

## Game-time clock

Every animation that belongs to the machine runs on one **game clock** (`gt` in `board.ts`, milliseconds) that advances by `frame time * timeScale` with `timeScale` = 0 when paused (`speed` 0), 1 at 1x, 2 at 4x, 3 at 16x. `Live.frame`, `PipelineView.frame` (chip tweens), the LEDs, fans, the VRM glow and the exterior accent strip, platter, head, bus and cable pulses, the PCH bars, the boot bar, the OS progress cue, the done ring and the power LED blink all take `gt` instead of wall time, and snapshot-time holds (bus fade timers) use `gt` too, so a pause freezes them exactly and a resume continues without a jump. Wall time still drives: camera pan/zoom/flights, hover lift and outline, drag ghost and drop-target pulses, tutorial highlight rings, toasts and the slide-in of a new drive.

## Level of detail: interior and exterior (far zoom)

The camera scale drives one clean LOD, in multiples of the **fit zoom** (`fits.z`, the zoom of the default overview). Constants are `LOD` in `board.ts` (exported, also `window.__board.LOD` in dev):

| Zoom (x fit) | What shows |
|---|---|
| `>= 0.7` (`LOD.fadeFrom`) | the interior, exactly as before (the default overview is 1.0) |
| 0.7 to 0.5 (`fadeFrom` to `fadeTo`) | the exterior case **crossfades in** over the interior (smoothstep; the exterior alpha is the fade, the interior stays opaque below it, so there are no see-through artefacts) |
| `<= 0.5` (`LOD.fadeTo`) | exterior only: the interior group is `visible = false` and `Live.setInterior(false)` skips all interior per-frame work |
| `0.2` (`LOD.minZoom`) | how far the camera can zoom out (it used to stop at 0.7) |

**Interior group** (`interior` container): case chassis, board, devices (CPU, DIMMs, PSU, cooler, heatsink, bay, drives), SATA cables, ATX / CPU cables, glass, cooler, pipeline view, and `live.root` (bus flows, PSU readout, OS badge, VRM glow, PCH). **Always external** (outside the group, drawn at every zoom): the monitor (`monitorLayer`, one cached texture far out), the video cable (`cableExtLayer`), the tray, the held rack, the power button and its lights, the plugged key, and `live.ext` (monitor screen text and OS screen, USB LED, monitor LED, boot bar, video cable glow).

**Exterior case** (`exterior.ts`, `exteriorLayer` above the interior, below the external things): an opaque chassis on the same `CASE` rectangle, so the power button, its on / off / error / disk lights, the USB port and the video cable need no moving. Brushed steel body with a lit top edge, the top panel with vents and brand, a **smoked tempered glass** side (opaque, only two faint diagonal reflections, no internals), a perforated PSU intake and nameplate, feet, and the **drive bay front** (a faceplate per installed HDD / SATA SSD, a blanking plate for an empty cell, a flat plate for the cell this tier lacks; NVMe lives on the board and is not visible). The **rear I/O plate** shows the external connectors this board has: audio, an ethernet jack only when `features.ethernetMbps > 0`, HDMI, a second display port only when `displayPorts >= 2`, and `usbPorts` of the four USB positions (bare outlines for the rest). The static art is built once per (theme, tier, drives) and baked to one texture (0.35x). The only live part is the **accent strip** (a thin bar on the front rim, plus the drive-front activity LEDs), on the game clock: off dark; idle a dim steady cyan; working (posting, loading, running, writing, any OS phase) a bright pulse travelling down the strip; error (`phase error` or PSU trip) blinking red; dead board a steady dim red. Dark and light themes use the same structure (steel body, smoked glass in both).

**Interaction at far zoom** (exterior alpha above 0.5): only external ids can be hit: `power`, `usb`, `monitor` (hover writes the device id as before), `display0` (the empty monitor bay), `tray`, `held`, `key:<id>`, `cable.video`, and `case` (the **whole** chassis rectangle). Interior ids (slots, devices, cables, `bay`, `os`, `psu`, regions, die tiles) are not hit targets then. Below 0.5 exterior alpha the interior hits are back.

**Revealing the interior on demand.** While a part or an internal cable is being dragged (`dragging.kind` `part`, or `cable` other than `cable.video`), or while `highlight` contains an **internal** id that exists right now (anything that is not one of the external ids above), the exterior fades away (about 0.3 s, wall time) regardless of zoom, so drag and drop and the tutorial work from any distance. It fades back when the drag ends and the highlight is gone. `flyTo(id)` is unchanged (it ends at a zoom of at least the fit zoom, so the interior shows). Highlights on `monitor`, `power`, `usb`, `tray`, `key:*`, `held`, `case`, `display0`, `cable.video` do not reveal. In dev, `window.__board.lod()` returns `{extA, reveal, interior}`.

**Performance.** When fully exterior, the interior layers are neither updated nor drawn (static layers stay baked; the live interior work is skipped, only fans / drive LED levels / the disk LED keep their cheap state). Measured in headless Chrome with software GL (SwiftShader, 1360x800, a full machine with a SATA SSD, the same scene before and after this change): overview 32 ms/frame before and 33 ms after (no regression); mid-fade (x0.6) 24 ms; exterior (x0.45) 8-9 ms; far (x0.25) 8 ms (before, the camera could not go below 24 ms). Real GPU numbers were not measured.

## Layers (bottom to top)

(Everything in this list up to the live layer is inside the `interior` group; the monitor, the video cable and the props are above the exterior layer, see the LOD section.)

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

World units are pixels at zoom 1; the CPU socket is the origin. `cam {x, y, z}` is the world point at screen centre plus zoom. The camera frames the board in the area not covered by UI: `camera.inset` (CSS px) comes from the `viewInset` signal in `src/game/hover.ts`, which the HUD writes from the measured bar and dock/drawer rects (`InsetReporter` in `Hud.tsx`). The view centre and `fit()` use the free area, so the overview shows the whole scene (board, PSU, monitor) beside the shop; if the camera is at the overview when the free area changes (window resize, panel opened/closed) it re-fits, otherwise the view is left alone. Drag pans, wheel and two-finger pinch zoom about the cursor (down to 0.2x of the fit zoom, see the LOD section), any input cancels a flight. `F` flies to the die, `B` to the whole scene (board, PSU, monitor, cables). Also exported from `board.ts`: `flyToCpu()`, `flyToBoard()` for UI buttons. In dev builds `window.__board = {camera, app, flyToCpu, flyToBoard}` is exposed for screenshot scripts.

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
- Fans (cooler or liquid pump, PSU, and the VRM heatsink fan `vrm-sink-fan`) spin faster with CPU temperature, PSU load, and CPU load (VRM sink fan), and are **still unless the machine is powered**: `liveOn = snapshot.powered && !power.off && !power.tripped && !board.burnt`. A fan that loses power spins down in about a second and then rests exactly (no creep).
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
| `case` | the chassis frame (top panel, side walls, floor); the glass area belongs to the board. At far zoom (exterior view) it is the whole case rectangle |
| `vrm` | the VRM block north of the CPU (phases, PWM, power-good light); also a `highlight` / `flyTo` target now |
| `vrm-sink0` | the VRM heatsink pad (slot id), empty or filled; an installed heatsink is also hoverable by its device id |
| `dimm0`..`dimm7`, `pcie0`..`pcie3` | up to eight DIMM and four PCIe slots, a tier has the first ones |
| `bay` | the drive cage (cells are `sata0` / `sata1`) |
| `sata0`, `sata1`, `m20` | the drive cell / M.2 slot, empty or filled; an installed drive is also hoverable by its device id |
| `held` | the rack of ingested keys waiting for their result |
| `os` | the OS badge on the drive that hosts the OS (exists only while an OS is installed); the monitor screen is display only |
| `psu.readout` | the PSU's live panel |
| `tray` | the key tray |
| `key:<keyId>` | a key in the tray or in the USB port |
| `usb` | the USB port on the rear I/O |
| `power` | the power button (on the case's top panel, with the on / off / error and disk lights) |
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
- **Monitor**: shows `snapshot.display` when `monitorLive`; **NO SIGNAL** only when a monitor is installed, the machine is **powered** and it is not live (no video cable); a blank screen when live and the machine is off, and a blank screen with a dark LED when off with no cable. An empty monitor bay is drawn as `MONITOR BAY` (a dashed placeholder, never NO SIGNAL). Its power LED is green when live and powered, amber when live and off. A thin green bar under the picture follows `bootProgress` during `posting` and `loading`.

## Power-off rules (everything that moves needs power)

With the machine off, tripped or dead (`board.burnt`): every fan is still (cooler fan or pump, PSU fan and its readout fan, the VRM sink fan), no bus or cable carries pulses or glow (holds are cleared at the snapshot), no DRAM flash, drives are idle (platter, head, LED), the USB LED is dark, the case lights show only what is true (the green ON light needs power; the amber OFF standby light needs a working PSU path, so it is dark when `noPowerReason` is set (no PSU, burnt PSU, ATX unplugged, dead board); ERR is red when the phase is `error`, the PSU tripped or the board is dead), the VRM glow is off and its power-good light is dark (red blinking when dead), the monitor is blank. Heat glow stays while parts cool (it is temperature). All animation is on the game clock, so a pause freezes it. The PSU readout's temperature still cools down for a few seconds (a low-pass of the estimate).

## Board tiers and the VRM

One shared board layout; a tier **fills** it, slots it lacks stay bare (empty pads, missing socket or jack, no connector), so a board upgrade visibly fills the board in. `buildBoard(T, tier)` reads `BOARD_TIERS[tier]` (`slots`, `features`, `vrm.phases`):

- **DIMMs: up to 8**, two rows of four with the memory bus between them (`DIMM_X(i) = 1400 + (i % 4) * 220`, `DIMM_Y(i)` is -840 for `dimm0..3` and 150 for `dimm4..7`, `DIMM_H` 690, `DIMM_GAP`). Row 0 pins face down, row 1 sticks are drawn upside down so the pins face the bus; each stick shows 4 DRAM chips. Unfitted sockets are faint with a cross.
- **PCIe: up to 4** (`PCIE_RAILS`, x16 / x8 / x4 / x1 lengths), **SATA 2**, **M.2** (bare with `M.2 · not fitted` when `slots.m2` is 0), **USB up to 4** (2x2 on the rear plate, `USB_POS`; the first is the key port), **ethernet** jack only if `features.ethernetMbps > 0` (with a speed label), a **second display port** only if `displayPorts >= 2`, the **vrm-sink** slot (a dashed pad over the MOSFET strip).
- **Tier hint**: the board colour (Starter a plain grey-green, Basic the base blue, Mainstream a deeper teal, Enthusiast a dark violet), the silkscreen `MB-<n>000 · <NAME> · REV A`, a thin trim line round the plate on Mainstream and Enthusiast (a second line and `OVERCLOCK READY` on the top tier).
- **VRM** (`BR.vrm`, hover id `vrm`): a PWM controller with a power-good light, then up to 6 phase blocks (`vrmPhase(i)`; a tier draws `phases` of them, the rest are bare pads). Each block: a MOSFET pair, a choke (ferrite with copper winding) and two capacitors. **Glow** (`Live.drawVrm`, per frame): per phase, brightness `0.1 + 0.5 * loadRatio + 0.45 * heat` with `heat = (tempC - 45) / (throttleC - 45)`, colour cool cyan, amber near the throttle point, red when hot or `unstable` (which also flickers); the phases pulse one after another (interleaved), faster the harder the CPU pulls. Off with no power. The power-good light is green, an amber blink when unstable, a red blink when dead, dark when off.
- **Heatsinks** (`vrmSinkArt`, kind `vrm-sink`, slot `vrm-sink0`, covers the MOSFET strip `VRM_SINK`): `vrm-sink-fins` (thin dense fins), `vrm-sink-big` (tall fins with a copper heat pipe), `vrm-sink-fan` (fins plus a small spinning fan at the east end; speed follows the sink's own draw, 0.3 W idle to 1.5 W under load, stills with the power rules).
- **Crash flash**: a new `fault` entry in `snapshot.log` (the first snapshot only records the existing log) flashes the VRM block red and white for about 0.9 s of game time.
- **Dead board** (`board.burnt`): the whole board is dimmed, the VRM is scorched (soot blots, cracks), the power-good light blinks red, the badge over the CPU says `BOARD DEAD`, everything is dark and still (see the power-off rules), the case ERR light is red and the exterior strip is a steady dim red.

## Performance

Static layers are cached (the tray / power plate chrome is one texture below zoom 0.2, each prop node is cached as a texture below zoom 0.2, the cables are their own small layer): retained geometry, the board texture below zoom 0.2 and the device layer texture (devices, PSU, monitor, cables) below zoom 0.14. Textures are destroyed on rebuild. Per frame JS is the fan rotation, the pooled dot sprites (only lit buses and cables show pulses) and one DRAM flash Graphics only while the memory bus is lit. Per snapshot: a few Graphics (heat glow, PSU gauge) and a handful of Text updates (only when the string changed). Measured in headless Chrome with software GL (SwiftShader, 1360x800, GPU-bound and pessimistic), full machine installed: page baseline about 16 ms/frame, overview 19-23 ms (44 ms before the device bake: the device layer alone cost 28 ms), PSU mid-zoom 33 ms, DIMM mid-zoom (zoom 0.35) 62 ms, CPU die 56 ms. Real GPU numbers were not measured. With the assembly props (same setup): bare or assembled overview about 20 ms/frame (mostly 16.7 ms with an occasional 33 ms), dragging a key about 20-33 ms, boot with the PCH and buses lit about 21 ms at overview and about 56 ms at zoom 0.22 (GPU-bound, like the DIMM mid-zoom number above). Before baking the props the overview was 32 ms.

## Known gaps

- Text is rasterised at 2x once; at zoom above about 2 it softens (no SDF/bitmap font yet).
- At far zoom the monitor text is small (zoom scales it with everything else; it is readable down to about 0.5x of the fit zoom, a shape only below). The exterior is baked at 0.35x, so it is soft if forced visible at high zoom (it never is, the LOD fades it out above 0.7x). The 8 DIMM sockets use shorter sticks (4 chips) than the old single bank, and the second row's memory taps are drawn but only lit by the shared memory bus.
- The liquid cooler's tubes end in fittings (no radiator art). No GPU, NVMe, SATA or USB devices exist in the sim, so those buses never light (the PCIe cable is plumbed but never drawn).
- PSU temperature and fan rpm are renderer estimates from load (see above).
- Touch drags were verified with synthesized touch events (CDP), not on a device; there is no hover on touch. Installed parts cannot be dragged back out (the UI picker uninstalls). Loose cable plugs and tray keys are small at overview zoom (use the tutorial rings, `flyTo` or zoom).
- Bus lanes are 9-11 world units wide, about a pixel at overview zoom; the pulses carry the activity there.
- Chips are single-width; superscalar and out-of-order engines will need a wider stage layout and a bigger `pipe`.

## USB keys

A tray key is a wide stick (`keyStick` in `props.ts`, 1470 x 230 world units: a 330 plug and a 1140 body) that carries its whole label: **job id and type** (`#72 scan`), the **template** (`cli.scan`), and an **age bar against the deadline** with `age/span s` (or `LATE`), all coloured by urgency (green, amber over 65 percent of the span, red late). Text is ellipsised only when it would overflow the body (a very long template). The tray holds 2 columns by 5 rows. The plugged key is the **compact** variant (750 long: a 190 plug seated in the USB port plus a 560 body sticking out west, job id and bar, or `DONE`), so it stays clear of the monitor. Hover lift, click to plug or eject, and drag to the port work on both.
