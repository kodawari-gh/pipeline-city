# Rendering: network props

Part of the renderer docs; the hub is [`RENDER.md`](../RENDER.md). Code: `src/render/room/net.ts`, `room/netvis.ts`. The network itself: [`NETWORK.md`](../NETWORK.md).

## Files

| File | Role |
|---|---|
| `net.ts` | the network props: router, wall plate, ISP line, ethernet cable, NIC card art, link LEDs and traffic pulses (see Network) |

## Network (router, wall plate, ethernet cable, NIC cards)

Code: `src/render/room/net.ts` (`NetView`, `routerArt`, `nicArt`), geometry in `layout.ts` (`ROUTER_SPOT`, `WALL_PLATE`, `LAN_TRUNK_X`, `nicJack`, `nicRect`), the plug drag in `interact.ts` (`beginLan`, `scene.lan`), wiring in `board.ts` (`syncNet`). Data: `snapshot.net`, `cables[id=lan]`, `devices[kind=nic]`, inventory kinds `router` and `nic`. Nothing here changes the overview fit: the router shelf and the wall plate sit above the monitor, inside the existing `WORLD` box (the case did not shrink).

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

**Tray and USB fallback** (`trayArt(T, keys, mode)`, mode from `net.usbFallback.state`): `off` as before; `retired` dims the rack and says `LINK UP: KEYS RETIRED` (or `LINK UP: n LEFTOVER`; leftover keys stay fully visible and usable); `waiting` says `NET DOWN` in amber; `fallback` says `NET DOWN: STICKS BACK AT 1/3 RATE` and the panel is normal again. The countdown text is the UI's job (the tray is rebuilt only when the state changes, not every second).

**Where things are.** The router stands on a shelf above the monitor (`SHELF_Y` = 700 above the monitor's top, so it follows the desk; its east end is 300 west of the monitor's, `ROUTER_EAST`). The ISP's wall plate (`WALL_PLATE`, jack at its bottom edge `WALL_Y`) is **under the desk, level with the power socket plate and just west of it** (`POWER_PLATE`). The ISP lead runs from the jack down a little (`ISP_ROW_Y`), along, and **up behind the desk, the monitor** to the router's WAN socket, like the monitor's power cord: its body is drawn in the room's back layer (`NetView.behind`, put into `RoomView.behind` by `board.ts`), so only the stretch under the desk, the stretch between the desk and the monitor's underside and the stretch above the monitor show; the plugs are in the net layer; the traffic pulses on it are skipped where it is hidden (`hiddenBehind`). The ethernet cable is as before (down the trunk `LAN_TRUNK_X` in the gap, now a longer run).

**LOD.** The router, wall plate, cable and jack LEDs live in the always-external layer (`NetView.root`, above the exterior case), so the far-zoom view keeps them; at the overview they are small but read as a lit box with a cable. Far-zoom hit tests accept `router`, `wall`, `cable.lan` and `eth*` (`isExternalId`); NIC device ids and `pcie*` are interior ids as before.

**Verified** (headless Chrome, software GL, sandbox saves, real mouse events through `beginPartDrag` and the canvas; 1360x800 dark and light, 1920x1080 light): a router dragged from the inventory onto its spot installs (and is refused on a PCIe slot, a NIC on the router spot); all four router looks, the wall plate with plans 1 to 4; NIC cards `nic1`, `nic2`, `nic3` dropped on PCIe slots; the plug dragged onto `eth0` and onto a NIC jack, pulled out again (disconnects, plug back at rest) and re-plugged, all while the PC was on or off; power on, OS up, link up, downloads with pulses, the retired tray look; power off (router power and WAN lights stay, jack LEDs go dark, the tray says `NET DOWN`); two screenshots of a paused frame are byte-identical and differ again after the resume; far zoom with the router, cable and the NIC jack on the rear plate, and hover ids `router`, `wall`, `cable.lan`, `eth0` at far zoom; `anchorOf`, `hasTarget`, `flyTo` and a highlight for the new ids. Upload pulses and a `link-down` amber LED were checked with a spoofed snapshot (both directions drawn), not from a real upload; `saturated` came from a real run (spool full). Not verified: touch, the burnt-card dimming, the plugged-key-over-cable overlap.

