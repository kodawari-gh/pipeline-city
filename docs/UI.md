# UI

Preact + signals, in `src/ui`. Reads the sim only through `src/game/store.ts` (snapshot, actions, export/import, autosave offer) and the shared signals in `src/game/hover.ts` (`hover`, `selected`, `viewInset`) and `src/game/interaction.ts` (`highlight`, `dragging`). Mounted by `src/main.tsx` into `#hud`, a full-screen `pointer-events: none` layer above the board canvas (`#board`). Each panel re-enables pointer events.

The UI is for onboarding and reading the machine, and it recedes: the board is the star. Parts are placed by **dragging from the inventory shelf** (or from the board, for parts already in the world). The picker offers purchases (into the inventory), the CPU clock, power actions and key actions.

## Look

- **Glass**: every panel (HUD bar, picker, inventory shelf, tutorial card, stats drawer, menu, tooltip, toasts, modals) is a low-opacity background (`--panel`) with `backdrop-filter: blur(0.67rem)`, a 1px hairline (`--glass-line`), a 0.67rem radius and no shadow. Tokens are on `:root` (the light theme) and `:root[data-theme="dark"]`; dark is the primary theme and the page starts with `data-theme="dark"`. Text is `--ink`, secondary text `--mute`; both were checked on the glass over the board in light and dark.
- **Small type** (all rem): 0.8rem body, 0.65rem uppercase labels, 0.95rem titles.
- **Pause**: at speed 0 the root gets `class="paused"` (`state.ts`, from the speed signal). `ui.css` stops every animation that shows sim activity: the OS chip pulse (`.chip.live`) and anything marked `.sim-anim`. Hover transitions, panels, toasts and notices keep running. The tutorial's target pulse is guidance, not sim activity, so it keeps running. New sim-activity animations must use one of those hooks.
- **Fewer always-visible things**: the HUD shows money, time, reputation, the machine chip, speed and theme (the level pill sits at the top centre, the inventory and shop buttons at the bottom). Stats, export and import, the tutorial options, hints and new game are in the **menu** (`...`). Secondary numbers (demand, oldest key age) are in tooltips.
- **Part pictures** (`PartArt.tsx`): the image the renderer makes of the real board art (`src/render/board/thumbs.ts`, see RENDER.md): CPU package and die, DIMM, cooler, PSU unit, monitor, drive, heat sink, network card, router, plan plate, the whole board and the case. Until one arrives, and for what has no hardware art (an OS), the drawn icons below are shown: inline SVG drawn from the spec, classes only (`.art .ink`, `.art .plate`...), so both themes read the tokens. CPU die with the pipeline per tier (one block for unpipelined, five stages for in-order, forwarding arcs and a cache row for tier 2); RAM sticks (count from the size) with a latency gauge; cooler (fins for the stock heatsink, fan for the tower, tubes and radiator for the liquid loop); PSU with a wattage dial; board with its slot counts; monitor.
- **Icons** (`Icons.tsx`): bolt for power, flame for heat, clock for speed and latency, dollar for price, lock for blocked or later, check for fitted, box for the inventory. Each is a stroke icon in `currentColor`, sized in rem.

## Scaling (every size is relative; the test fails the build otherwise)

- **Root rule** (the only place a pixel bound appears, top of `ui.css`): `html { font-size: calc(var(--ui-scale, 1) * clamp(15px, min(0.85vw, 1.5vmin), 64px)); }`. 1rem is 0.85vw or 1.5vmin, whichever is smaller: 16.2 px at 1920x1080, 21.6 px at 2560x1440, 32 px at 4K, never below 15 px (small laptops, phones) and never above 64 px. At 1080p and 1440p every panel is the same fraction of the viewport (measured: tutorial card height 9.6 percent of the viewport height at both).
- **UI size setting**: the menu's slider (80 to 150 percent, step 5) sets `--ui-scale` (`state.ts`, `uiScale`, persisted in `localStorage['pipeline-city.uiScale']` in try/catch), which multiplies the root size.
- **Everything else** is rem/em/%/vw/vh/vmin/clamp(): panels, tiles, buttons, gaps, radii, fonts, hit targets. Inline SVG has no numeric `width`/`height` on `<svg>`: `Icon` and `PartArt` take a size in design units (1/15 rem, `units.ts`, `rem(n)`) and set it in CSS; the drawing scales through its `viewBox`; SVG text sizes are `font-size` attributes in viewBox units. Media queries use em (`@media (max-width: 48em)`, plus `max-aspect-ratio`).
- **Allowlist** (`scaling.test.ts`): `1px` / `0px` (hairline borders, outlines, strokes), and the root clamp above. Positions computed at runtime from measurements (`translate(${x}px, ...)`, an element height copied from its content) are built from variables, contain no literal pixel number and are not matched. The test scans every `.css`, `.ts` and `.tsx` under `src/ui` (tests and fixtures excluded), `src/main.tsx` and `index.html`, strips comments, and fails on a number followed by `px`, a numeric `width`/`height` on an `<svg>`, and a numeric dimension in a `style={{}}` object (Preact turns it into px). Add new components in rem and the test stays green.

## Files

| File | Role |
|---|---|
| `logic.ts` (+ `logic.test.ts`) | Pure: formatting, stats helpers, hint triggers, `describeId`, `statusChip` (HUD phase text), `queueReadout`, `friendlyError` (refusal wording), `clockWarning`. |
| `picker.ts` (+ `picker.test.ts`) | Pure: `pickerFor(id, snapshot)` builds the card model (title, lines, actions, the upgrade **ladder**, the `current` and `focus` parts). Also `statsOf` (numeric stats per part), `goodness` and `compareRows` (before/after bars), `clockZones` / `estTempC` / `zoneOf` (overclock zones). |
| `vrm.ts` (+ `vrm.test.ts`) | Pure: the VRM readout and its zones (`vrmReadout`, `vrmZone`, `vrmLines`), the motherboard tier cards (`boardCards`), `cpuVrmWarning` (a CPU the planned board's VRM cannot feed) and `liquidVrmNote` (a liquid cooler with no VRM heatsink). |
| `tutorial.ts` (+ `tutorial.test.ts`) | Pure: the tutorial steps (welcome card, 14 steps before the OS lesson, last card), `currentStep` derived from snapshot progress flags, step problems, replay baseline. `INVENTORY_ID` is the HUD button's id. |
| `regions.ts` | Plain + nerd text for region ids, world ids and die stages. `JOB_TYPES` for key jobs. |
| `state.ts` | UI signals: theme, stats drawer, the inventory shelf, the tutorial's per-viewer state, hint toasts, the stats sparkline history. Everything persisted is in try/catch. |
| `testdata.ts` | Snapshot fixtures for the tests (a fresh game by default). |
| `Hud.tsx` | Top bar, Start / Continue modal, the menu (with the UI size slider), the stats drawer, the bottom `.stack` (notices, toasts, tutorial, inventory shelf), inset reporting for the camera. |
| `NewGame.tsx`, `SandboxTools.tsx` | New game dialog (Campaign or Sandbox) and the sandbox chip with its tools (docs/SANDBOX.md). Sandbox shows an infinity for money and `free` for prices; nothing is unaffordable. Both keep their styles in `ui.css` (no inline `<style>`). |
| `ladder.test.ts` | Heatsink and upgrade rows: the next tier line, and "Nothing better" only at the top tier. |
| `place.ts` (+ `place.test.ts`) | Pure: `placePopup` (right, left, below, above, else dock; flipped, clamped, tail offset), `liftAbove` (tutorial card vs target), `comfortablyVisible`. |
| `anchor.ts`, `units.ts` | Re-export of the renderer's `anchorOf`, `flyTo`, `hasTarget`; the `rem(units)` helper. |
| `scaling.test.ts` | The scaling enforcement test. |
| `Inventory.tsx` | `InventoryButton` (HUD, count badge, pulses for tutorial steps) and `InventoryPanel` (the shelf: tiles grouped by kind). |
| `PickerCard.tsx` | The contextual popup next to the selected object: header with art and live readings, PSU load, lines, the upgrade ladder, before/after bars, the CPU clock dial, actions, details. Escape and the x close it. |
| `PartArt.tsx` | Inline SVG illustration of a part or a board tier (`PartArt({id, size})`). |
| `Icons.tsx` | The icon set (`Icon({name, size})`). `IconName` is defined in `picker.ts`. |
| `worldDrag.ts` | `beginPartDrag(invId, event)`: a thin wrapper over the renderer's hook (`src/render/board/board.ts`). |
| `TutorialCard.tsx` | The tutorial: welcome and next-lesson modals, the bottom-centre card, the camera glide, the animated pointer, the card lift. Writes `highlight`. Opens the shelf on install steps. |
| `Hover.tsx` | `Tooltip` (follows `hover`). |
| `Toasts.tsx` | `Notice` (a refused action, plain words, dismissible, clears after 6 s) and hint toasts. |
| `Stats.tsx`, `Meter.tsx` | Nerd stats drawer (CPI/IPC, stalls, cache, power, device temps, sparkline) and the small bar. |
| `ui.css` | All styles. Root size rule, glass tokens, the part-art classes, the ladder, the dial, the shelf, popups, modals. Below 48em the stats drawer becomes a bottom sheet. |

## Selection and highlight contract

- **`selected`** (written by the renderer on click, and by the UI, `null` on empty space): a slot id (`cpu0`, `dimm0`, `atx0`, `cooler0`, `display0`), a device id (`dev1`), a spec id (`cpu1`, `ram0`), `inv:<inventoryId>` (a tile in the tray, or a part in the world), `tray`, `key:<keyId>`, `usb`, `power`, `monitor`, `psu`, `cable.atx`, `cable.cpu`, `cable.video`, a region id, or a world id. The picker opens for any id it can describe. The old `crate` id still describes the inventory in words (`REGIONS.crate`) but opens no card of its own.
- **`highlight`** (written by the UI, read by the renderer): the target ids of the current tutorial step, e.g. `['inv:inv1', 'cpu0']`. The renderer rings the ids it knows and skips the rest. `inventory` is a **UI-only** id: the HUD's inventory button pulses for it (and for any `inv:` id). Cleared when the tutorial is off or the card unmounts.
- **`hover`** (renderer): the tooltip uses `describeId(id, snapshot)`, so slots and parts are named in words.
- **`dragging`** (renderer): `{kind: 'part', id}` during a drag from the shelf. The shelf slides away while it is set (`.inv.away`), so the board is visible for the drop. The camera keeps the shelf's space reserved during the drag, so the board does not re-frame under the pointer.

## Inventory shelf (`Inventory.tsx`)

- The HUD's **Inventory** button shows the count badge and toggles the shelf (`inventoryOpen`). It pulses while a tutorial step asks for the inventory or one of its parts.
- The shelf is a **large glass panel docked at the bottom** (up to 72rem wide, centred, last item of the bottom `.stack`). On tall screens (`max-aspect-ratio: 1/1` and at least 40em wide) it docks at the **right edge** as a column with wrapping tiles; on phones it is a shorter strip with smaller tiles. Parts are **grouped by kind** (processor, cooling, memory, power supply, monitor, board, drive, software); each tile is 8rem wide with the part illustration, short name and a `Tier N` label. Drag affordance: grab cursor, the tile lifts on hover and a `drag` cue appears. A tile that cannot be fitted right now is dimmed with a lock and the reason in its tooltip.
- **Press a tile** (`pointerdown`, primary button) calls `beginPartDrag(inventoryId, event)`; a drop on a valid socket installs it. **Click a tile** writes `selected = 'inv:<id>'`; the picker popup anchors to the tile (`[data-inv]`), above it. Keyboard: Enter or Space selects. Tiles set `touch-action: none`.
- While `dragging.kind === 'part'` the shelf **collapses** (slides out, `.inv.away`, keeps its layout space). A tutorial step with no inventory part, finding the shelf empty, closes it.
- **Camera**: `InsetReporter` reserves the shelf's size (bottom, or right on tall screens) through `viewInset`; the renderer eases to it and never re-frames mid-gesture. The reserved space is remembered while the shelf is collapsed for a drag, so the board does not move under the pointer.

## Picker (`PickerCard.tsx` + `picker.ts`)

Opens only when `selected` is set. Escape, the x, or a click on empty space (the renderer writes `selected = null`) closes it. It is a **popup next to the object**: `anchorOf(id)` gives the object's live screen rect, recomputed on `cameraRev` (and on size and inset changes); `placePopup` prefers the right, then left, below, above, flips and clamps inside the free area (the screen minus `viewInset`), so it never leaves the viewport or covers the object, and a small accent tail points at the object. It follows the object as the camera pans and zooms (short transition) and **glides** (position and height) when the selection changes, because the popup shell persists and only its content is keyed. For an id without a world rect (hidden at far zoom, off screen) it docks at the bottom right of the free area, next to the shelf; for `inv:<id>` it anchors to the tile in the shelf. While it is open the tutorial card and pointer fade out. Width 22rem; the content scrolls when taller than the free area. For a part it shows, top to bottom:

- **Header**: the part's illustration (80 px), its name and one plain line.
- **Live readings** (installed parts): temperature, power and effective clock as small icon chips; `slow` or `unstable` as a warning chip. For the PSU, a load bar against its budget.
- **Lines**: the socket's hint (empty socket, or "drag it onto its socket" for a spare), the PSU load, the sim's own reasons. The CPU's overclock warnings are not repeated as text: the dial shows the zone.
- **Upgrade ladder** (`ladderFor`): one rung per tier of the kind. Tiers older than the best part you own are left out.

  | State | Rung shows | Hover |
  |---|---|---|
  | `installed` | check, "Fitted" | |
  | `crate` | box, "Spare" | "In your inventory: drag it onto its socket" |
  | `ready` | a **Buy $N** button | "Buy for $N. It goes into your inventory." |
  | `poor` | dollar, the price | "Need $N more" |
  | `blocked` | lock, "Blocked" | the sim's reason (e.g. "needs a 100 W power supply") |
  | `locked` | lock, "Later" | "Not available yet" |

  Pressing a rung (not its buy button) makes it the **comparison** target.
- **Next tier** (`nextUpgrade`): under the bars, the lowest tier above the fitted part is named with what it costs or where it is: its price (or `free`), `a spare in your inventory`, `Need $N more`, the sim's block reason, or `Later`. The bars compare with it when nothing else is picked (locked tiers too, so the delta still shows). **"Nothing better to buy right now."** appears only when the fitted part is the top tier of its kind (`ladder.test.ts`; the heatsink rows had shown it over a spare tier).
- **Before/after bars** (`compareRows`): for the compared rung against the current part of the kind. Each stat has an icon, a thin grey bar (current), a coloured bar (option; green better, red worse, grey same), and a delta such as `+16 K` or `-188 ticks`. Bar length is relative to the best part of that kind (`goodness`; for lower-is-better stats the best is the lowest). Stats: CPU speed (estimate) and power; RAM memory, latency and power; PSU capacity; cooler heat removal and power; board memory slots and slots. The CPU speed is `base clock x a per-engine throughput guess`: a placeholder like the other balance numbers.
- **CPU clock dial** (installed, working CPU): a track with three zones, **safe**, **throttle** and **unstable**, from the sim's own steady-state heat model (`clockZones`, the same numbers as `thermal.ts`: the clock at which a full-load CPU with the installed cooler reaches its throttle and unstable temperatures). A knob shows the clock in its zone colour, a chip says the zone word, and the estimated temperature (`estTempC`) sits beside it. The slider is a transparent range input over the track.
- **Power card**: status line, the POST error line (`POST error: <reason>`, a missing part is never shown as a refused press: only a missing PSU or ATX cable refuses), and a note that power-off is immediate (a job in progress is lost; the key keeps its data and the job restarts at the next boot). **USB card**: a key the machine ignores says so ("ignored until the next boot") and why.
- **Actions**: Power on/off, Power cycle after a trip, Plug into USB, Remove key (get paid). Disabled actions carry the sim's reason as their tooltip.
- **Details**: the nerd text, collapsed.
- **The OS is on its drive, not the monitor.** The monitor is one object and only shows the OS text. The installed OS has an **OS badge** on the drive that hosts it (id `os`, present only while an OS is installed). Clicking the badge (`os`) or the host drive (its device id) opens the same card: the **OS section** (`osSection(s)` in `picker.ts`, rendered by `OsBlock`). It shows the name and tier, the status chip (the phase), programs at once and queue slots, the host drive's used and total space, the running job, each queue row with job type, state and how many jobs are ahead (next, 2 ahead, done waiting for you), the ladder with later tiers locked and their description, and **Uninstall OS** (two presses). Other drives show no OS section. With no OS installed, the drive bay (`bay`) shows the **Operating systems** shelf to buy from.
- **Storage and OS**: a drive shows its used and total capacity (its `sata`/`m2` socket is "drag a drive here"); a drive's stats are capacity, latency, throughput (`drivePerSecond`, bytes/s) and power. The OS shows programs, queue slots, memory and disk needed, with the later tiers locked and their description on hover. An installed OS has **Uninstall OS**, which takes two presses (the first asks, the second wipes the drive via `store.uninstallOs`). A spare that the sim will not fit shows its reason (memory, free space, no slot) in its rung.

**VRM, boards and heatsinks** (docs/VRM.md):

- **VRM readout** (the `vrm` id, and a fitted CPU's card): a load bar with three zones (safe, working hard past 60 percent, overload past 100 percent of the phases' rating), the demand in amps, then icon chips for temperature, efficiency, throttle, crash chance, heat, ripple and the heatsink. Each chip explains itself on hover: the temperature, throttle, crash and heatsink chips have their own plain line, and the efficiency, heat, ripple and load chips use the `describeId` line for their id (`vrm.efficiency`, `vrm.heat`, `vrm.ripple`, `vrm.load`). The stats drawer has the same numbers as rows.
- **Motherboard cards** (`board`, and a board in the inventory): one card per tier (smaller ones too: spares and downgrades are for sale), in a compact 2x2 grid (art 54 units, 0.3rem gaps; with the shelf open the whole picker is about 463 px of body at 1360x800 and 1024x640 and 510 px at 1920x1080, so it does not scroll above the shelf). Each shows the tier name, slot counts and features as small icons (memory, PCIe, drive bays, M.2, heatsink slot, power connector; ethernet, USB, monitor ports), the VRM strength (phases x amps, total A) as a grey (your board) and a coloured (this tier) bar, and the state: Fitted, Spare, Buy, Poor, Blocked (the sim's reason), Later. A fitted or spare card (and tile) keeps a small `+ price` button to buy another copy and counts the spares ("Fitted +1", "Spare x2"). A dead board's card reads **Replace** at the same-tier price, and the picker says why it is dead.
- **Dead board in the HUD**: the status chip reads "Board dead: replace it", and its tooltip names the same-tier replacement and its price (`statusChip`).
- **Warnings on the upgrade rows**: a CPU whose stock-clock demand is over the planned board's VRM rating gets a warning icon on its rung and the line "this board's VRM can't feed it: expect throttling or crashes" under the bars. A liquid cooler (no airflow over the VRM) gets "liquid coolers don't cool the VRM: add a VRM heatsink" while no VRM heatsink is fitted.
- **Heatsink rows** (`vrm-sink`): the three heatsinks as rungs with their own art (fins, big fins, fins and a fan), before/after bars for heat removal and power draw, and a hint on the empty `vrm-sink0` socket ("Drop a VRM heatsink here").

Buttons that the sim would refuse are disabled, with the reason in their tooltip. A press the sim still refuses shows the **Notice**.

## Tutorial (`tutorial.ts`, `TutorialCard.tsx`)

The tutorial covers the game **up to the network**: building the machine, the first jobs, storage and the OS. The last card says the next goal is Level 4, which opens the network (a Basic board for the jack, a router and a plan; no extra memory). The old network lesson is gone from the guided flow.

**Presentation.** The tutorial is a **JRPG dialogue box** at the bottom centre (`.tut`, `Dialogue` in `TutorialCard.tsx`, `dialogue.ts`): the text types out, a click completes or turns the page, a bobbing triangle marks a finished page. The welcome and the "Next lesson: the OS" offer use the same box over a dimmed backdrop, with their buttons after the last page, and pause the game while open. Every step explains **what the part does in plain, friendly words and ends with the instruction** (there is no Why? link; the text is written for someone who has never opened a computer). The box shows the chapter and position (`Build 3/6`), the title, a calm grey line when the step only waits ("No key yet") and a warning line when something is wrong (the sim's own reason), and, on waiting steps, a **progress meter** (`StepDef.meter`, the client base towards the next level). **Camera**: when a step starts and its first world target is not comfortably in view the camera flies there (`flyTo`); a press, wheel or pinch cancels the flight, and **Show me** flies again. **Guidance**: a thin dashed connector with a small dot runs from the card to the target and follows it; on the board the target gets one **yellow** breathing ring (the renderer's `highlight`, colour `T.ld`; yellow stands out from the cyan UI so nobody gets lost). No arrow, no second ring. `prefers-reduced-motion` turns the glides into jumps.

The step is derived from the snapshot's sticky `progress` flags (`src/sim/game/save.ts`), so a loaded save resumes at the right step, and an action done out of order is skipped past. Only **Start** (welcome) and **Got it** (last card) have buttons. Skip is always available; **Replay tutorial** is in the menu.

| Chapter | Step | Completes on | Highlight |
|---|---|---|---|
| - | Welcome (Start): open the inventory (the box at the bottom) | button | `inventory` |
| Build | `cpu`, `cooler`, `ram`, `psu`, `monitor` | `cpuInstalled`, `coolerInstalled`, `ramInstalled`, `psuInstalled`, `monitorInstalled` | `inv:<part>` and its socket |
| Build | `cables`: the three plugs (main power, processor power, video) in one step | all of `atxConnected`, `cpuPowerConnected`, `videoConnected` | the cables still loose and where they come from |
| Build | `wall`: the PC's and the monitor's power cords into the wall socket under the desk (the cord first, then the monitor's; the socket is lit too) | `mainsConnected` (both cords plugged) | the loose cord, and the socket |
| First jobs | `plugKey` | `firstKeyPlugged` | `usb`, the first key |
| First jobs | `power` | `poweredOn` | `power` |
| First jobs | `watch`: the key pops out by itself, pays, and the machine switches itself off | `firstKeyEjected` | `monitor` |
| First jobs | `cycle`: plug the next key, press power | `firstManualCycle` | `power`, `usb`, key |
| First jobs | `spend`, `fit` | `firstPurchase`; no bought upgrade left in the inventory | the CPU socket; the part and its socket |
| The OS | `reachLevel3` (meter), `buyDrive`, `drive`, `buyRam`, `fitRam` (only while the fitted memory is below the OS minimum), `buyOs`, `os`, `bootOs` | level 3 or a drive; drive owned; `storageInstalled`; enough memory bought, then fitted; OS owned; `osInstalled`; OS phase | the bay, parts and sockets, `power`, `os` |
| The OS | `osIngest` (plug a key and leave it), `osPaid` (wait: the key pops out by itself and pays) | the key is ingested; `firstOsJob` | `usb`, key; `os`, `monitor` |
| - | Workshop open (Got it) | button | none |

A player who finished the first twelve flags before the OS lesson existed is not forced through the rest: they get one **Next lesson: the OS** offer. `osLesson` and `offered` are persisted next to the old flags. The bot test (`tutorial.bot.test.ts`) plays the whole tutorial through public Game actions and checks that every step shows up in order, no step waits more than 10 minutes and no action is refused. 

**Resume and replay.** Persisted in `localStorage['pipeline-city.tutorial']`; the progress itself comes from the save. Replay judges steps from live state and deltas against a baseline.

**Hints wait.** Hint toasts do not appear while a tutorial step is active. A sandbox game has no tutorial.

## HUD (`Hud.tsx`)

Left to right: **money** (with game time next to it), **rep** (reputation; demand in its tooltip), **machine chip** (`statusChip`: Off, POST, Loading, Running, Writing, `Job done: remove key` or `No boot media` for the halted phase, `POST error: <reason>` for a missing part, `Error: <reason>` for run-time faults, the OS texts, and Tripped), then, on the right, the **Inventory** button with its count, the sandbox chip (sandbox games), the **speed control** (pause/play plus the current speed; hover, focus or tap opens 0.25x, 0.5x, 1x, 2x, 3x. 1x is the designed pace of 4 ticks a second, so the sim's `Speed` 1, 2, 4, 8, 12 read as 0.25x to 3x), the **theme** toggle and the **menu** (`...`): Stats, Export game, Import game, Replay tutorial, Skip tutorial (while active), Show hints again, New game (opens the Campaign or Sandbox dialog; asks again before discarding a running game).

**Refusals.** A refused action sets `lastError` in the store. `Notice` shows it in plain words ("Not now: Power the machine off first.") and clears itself after 6 s or on the x. Clearing sets `lastError` back to null so the same refusal shows again next time.

## Hints (`logic.ts`, `state.ts`)

Shown once each as a small dismissible toast, remembered in `localStorage['pipeline-city.hints']`. At most two are visible (bottom centre). The rest wait in a queue and appear when one is dismissed or auto-expires after 8 s. Hints are suppressed while a tutorial card is active; the menu's **Show hints again** clears the seen list.

| id | fires when |
|---|---|
| `stall` | any stall counter is above 0 |
| `throttle` | a working device has `throttle < 1` |
| `overheat` | a working device is `unstable` |
| `queue` | 3 or more keys waiting in the tray |
| `keyIgnored` | `snapshot.keyIgnored`: a key sits in the port of a halted no-OS machine ("the machine only looks for a program at boot: power it off and on to load it") |
| `burnt` | a device is burnt |
| `trip` | the PSU has hard-tripped |
| `brownout` | PSU overloaded (`psuFactor < 1`) but not tripped |
| `retiredKeys` | `net.usbRetired` and `net.retiredKeys > 0`: the link is up and USB keys are left in the tray |
| `portBusyKey` | `net.portBusyKey != null`: "a key is parked in the USB port" and blocks network jobs from the drive |
| `spoolFull` | the OS spool is full while the link is `link-up` or `saturated` |
| `linkDown` | `net.state === 'down'` after the link was up once (`usbFallback.state` is not `off`), not the boot-time "the OS is starting" |
| `saturated` | `net.state === 'saturated'`: every client or spool slot is busy |

## Network UI (`netui.ts`, `netdesc.ts`; docs/NETWORK.md)

Pure logic in `netui.ts` (+ `netui.test.ts`) and the words in `netdesc.ts`; every number comes from `snapshot.net`. The network exists for the UI once a router or a plan does (`hasNetwork`).

- **Shelf and picker rows** (kinds `router`, `isp`, `nic`): the ladder in `picker.ts` lists every tier (`ROUTER_SPECS`, `ISP_SPECS`, nic specs) with the usual states (`locked` by level, `ready`, `poor`, `blocked`, `crate`, `installed`). `hardwareWarn` puts a warning on each buy rung when the rest of the machine lacks an OS, 64K of RAM or a jack ("To use it you still need..."); a plan, router and cable are the player's next steps and never warned about, and a card brings its own jack. Fitted rungs read `Placed` (router) or `Active` (plan, which is applied on purchase); `effectOf` / `effectLine` give "Your download: 50 -> 100 Mbit, limited by the plan." for a candidate. `netStats` / `nicStats` feed the before/after bars (speeds on a log scale).
- **Link state chip** (`netStateChip`): `No service`, `No cable`, `Setup needed` (cable in, OS cannot run the link), `Link down` (red while powered, with the sim's reason), `Link up`, `Saturated`. `netStateLines` repeat it on the router and plan cards with the download, upload, clients and "Limited by ...". `linkChecklist` / `stillNeeds` list what a working link needs (plan, router, jack, cable, OS, 64K RAM).
- **HUD chip** (`hudNetChip`, `NetChipButton` in `Hud.tsx`): appears once a router exists. Shows the speed when up (`1 Gbit`), `... full` when saturated, otherwise `no cable`, `down`, `setup` or `no plan`; the tooltip is the state chip's plus "Click for the network panel". A click toggles `netOpen` (`state.ts`; opening it closes the stats drawer and the reverse).
- **Limiting component** (`limiterLadder`): four segments in data order, port | router | plan | drive (`netMbps` of the OS drive, `diskMbps`), with a log-scale bar each. The slowest is `binding` (the sim's `bandwidth.binding` when the link works, else found with the same tie order) and gets `.net-seg.binding` (warn colour). With no cable the port shows the best jack the machine could use, dimmed. `limiterAdvice` says what to upgrade, shown only while the link is up or saturated.
- **Panel model** (`netPanel`, null with no network): chip, reason, ladder, advice, clients busy / max, the four stage counts (offers, downloading, on the drive, uploading), offer rows (type, estimated payout, time left, late, retired), transfer rows (direction, percent, ETA, MB done of total), spooled rows (`on the drive`, `copying in`, `queued`, `running now`, `result ready`, `uploading`), the spool use with `full` from `os.spoolFull`, the USB fallback block (`usbModel`: `USB keys retired`, `Keys return in N` while waiting, `Keys are back at 1/3 rate`; null while the link never came up), `retiredKeys`, `portBusy` (a key parked in the USB port) and the delivered count.
- **Retired tag**: a client key whose client went online (`KeySnap.retired`) shows a `retired` chip next to its title on the key card (`PickerModel.tag`); it expires without a penalty.
- **Cards**: the router and plan cards (`netCard`) and the power card carry `netStateLines`; an installed network card (`nicLines`) says which jack (`eth1`...) it has, whether the cable is in it and warns of half speed when throttled.
- **Tooltips** (`describeNet`, called from `describeId`): `router`, `wall`, `cable.lan`, `eth0` (board jack, speed by tier), `eth1`... (card jacks in PCIe slot order, `jackIds`), and the router and plan spec ids, each with a plain line and a nerd line ending in `BANDWIDTH_NERD`. `jackPort` maps a jack id to the `connectCable("lan", port)` argument (`board` or the card's device id). The test in `logic.test.ts` checks every network render id has a description.
- **Hints**: the five network hints are in the Hints table above (`retiredKeys`, `portBusyKey`, `spoolFull`, `linkDown`, `saturated`).
- **Tutorial**: the network steps' targets are checked against real ids (`tutorial.test.ts`).
- **Web jobs in the panel**: a web offer row carries the SLA countdown beside its payout estimate (`slaModel` from `KeySnap.slaTick`: `full pay for 1m 00s`, then `pay is falling` in the warn colour; the estimate falls after it); the Bandwidth section has an `upload` line naming the slowest leg of the way out (`uploadLimiter`: `limited by: isp (upload)`, ties in the sim's order port, router, plan; null with no usable link); the flow chips gain `Waiting for a slot N` (`NetSnap.uploadsWaiting`, warn) when finished results wait for a client slot. All sizes are relative (`.sla`, `b.limit` in `ui.css`).
- **Network panel** (`NetPanel.tsx`): `NetDock` is mounted in `Hud.tsx` and draws a `.dock` aside while `netPanelShown(netOpen, snapshot)` (the HUD chip toggles `netOpen`; a network must exist). `NetPanel` renders the `netPanel` model: link state chip and clients, the bandwidth ladder (`.net-seg`, the limiting one `.binding`) with advice, flow stage counts, offers (with a `retired` chip), transfers with progress meters, the spool (used/slots, "Spool full"), the USB fallback state, the parked-key warning and the retired-key count. The open/close logic is tested in `netui.test.ts` (no DOM test setup exists); sizes are all relative.

## Camera inset

`InsetReporter` (in `Hud.tsx`) measures the top bar, the stats drawer, the inventory shelf and, while a tutorial step is active, the tutorial card (its layout top) and writes `viewInset` (CSS px, from live rects). It watches the HUD's `class` and `style` attributes, so a card that changes height is measured. The picker popup, toasts and modals are overlays and reserve nothing (the card also lifts away from its target when it would cover one). The shelf's reserved size is remembered while it is collapsed during a drag. The renderer eases to the new inset and never applies it mid-gesture (docs/render/interact.md).

## Theme

`data-theme="dark" | "light"` on `<html>`, from `state.ts` (saved choice, else dark). Dark is the primary, polished theme; light was reworked on 2026-10-25 (a saturated PCB-green board, darker ink and lines, a lighter page) and is still secondary. Scene tokens (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`) are read by the renderer. UI tokens (`--accent --ok --warn --bad`, `--panel --glass-line --glass-hi --art-plate`, `--ui --mono`) are for the UI.

## Tests

`npm test` runs the pure logic: `logic.test.ts` (formatting, stats, hints and toasts, HUD status text, queue readout, refusal wording, descriptions for every id the renderer writes), `picker.test.ts` (contents per id: empty socket, installed CPU, spare and upgrade ladder rungs, inventory items, keys, power after a trip, PSU, USB, cables, regions, board; stat values, bar goodness, before/after deltas, clock zones and the estimated temperature), `tutorial.test.ts` (steps from flags, resume mid-way, out-of-order actions, replay, migrated saves, step problems and targets, no step points at the crate, persisted state). Fixtures are in `testdata.ts`. `tutorial.bot.test.ts` is the headless completability test: a bot plays the whole tutorial, storage and OS included, through public Game actions (run with `npm test`, about 1 s).

## Notices, toasts and modals

Notices (refusals) and hint toasts (capped at 2) stack at the bottom centre of `.stack`, above the tutorial card. Modals (`.modal-back` + `.modal`, centred, dimmed backdrop): the tutorial welcome and offer, Welcome back, and the New game dialog (`NewGame.tsx`, which asks again before discarding a running game).

**Keyboard and names (new dialogs and tools).** The New game dialog is `role="dialog"` with `aria-labelledby`; its two choices are a `radiogroup` of `role="radio"` cards (roving `tabindex`: Arrow keys move, Enter or Space picks). It opens focused on the chosen card, Tab and Shift+Tab wrap inside it, and Escape closes it only when a game can be fallen back on; focus returns to where it was. The sandbox chip is a button named `SANDBOX` (`aria-expanded`, `aria-controls`); its popover is a `role="dialog"`, Escape closes it and gives focus back to the chip, and every control has a name (the job template, the work multiplier, the reputation slider with `aria-valuetext`). Focus rings: `:focus-visible` outlines on buttons, inputs, `[role="button"]` and the new radio cards (rem offsets). Picker: Escape or the x closes it, the rungs are `role="button"` with Enter and Space, and the popup is an `aside` with its title as the label.

**Tooltips never block clicks.** `.tooltip` is `pointer-events: none !important`: `#hud > *` (an id selector) had made a stale tooltip, left where the last world hover was, catch the clicks on the picker under it.

**Sandbox reputation slider.** A keyboard step fires `change` on every press; the slider now keeps its local value until it loses focus, so eight Arrow presses move it from 1.00 to 1.40 (it used to snap back to the last snapshot after each press).

## Verification

Checked in headless Chrome (playwright-core, software GL, dev server, screenshots read): 1360x800, 1920x1080, 2560x1440, 1024x640 and 390x844, dark and light across them: HUD, the welcome modal, the tutorial card with the pointer on a target and lifted off covered targets, the picker popup next to the CPU, a DIMM and the PSU (left of the object near the right edge, docked on a phone), the inventory shelf with parts, and a real mouse drag from a tile (shelf collapses, `dragging` set, inset kept). Measured: at 1920x1080 and 2560x1440 the tutorial card is 9.6 percent and the picker about 41 percent of the viewport height and the welcome modal 21.9 percent of its width, both times; every checked popup stayed inside the viewport. VRM and board UI (headless Chrome, software GL, 1360x800 and 390x844, dark and light): the board cards, the CPU warning and the liquid-cooler note, the heatsink rows, the VRM card and the stats VRM section, the dead-board chip and picker; no horizontal scroll at either size. A popup anchored to an inventory tile now stays above the shelf (the bottom inset is respected). Not verified: touch, a real GPU.

**Sandbox playthrough (headless Chrome, playwright-core kept outside the repo, real mouse and keyboard, 1360x800, dark):** the New game dialog from a fresh load (Tab and arrow keys, Sandbox, Assembled or Bare board, Start with Enter); the menu's New game asks "This discards the game you are playing." before a running game is replaced (Cancel keeps it), and Campaign then starts the tutorial (welcome card). Bare board: the starter CPU, cooler, RAM, PSU and monitor dragged from the shelf onto their sockets. Assembled: the Enthusiast board bought from the board picker and dragged onto the board; a better CPU bought from its picker and dropped on the socket (swap); the RAM upgrade dropped in a free DIMM slot; the liquid cooler bought and swapped in; the top VRM heatsink bought and dropped on its socket; the power object clicked (POST, then a job ran). The sandbox popover by keyboard (Enter on the chip, Escape closes and returns focus), a scan key spawned at x4, Repair all, the reputation slider (1.00 to 1.40 by eight Arrow presses, matching the sim), Run at 64x (about 210 ticks in 3 s, back to 1x), and 16x with a job done. Board sizes measured at 1280x720, 1360x800, 1366x768, 1024x640 and 1920x1080 with the shelf open: no scrolling in the board picker. **Not reached with the mouse:** drives and the OS (see Known gaps).

## Levels (docs/PROGRESSION.md "UI the level system needs")

Pure logic in `levelui.ts` (+ `levelui.test.ts`), views in `Levels.tsx`, `Jobs.tsx`, `Toasts.tsx`.

- **HUD level bar** (`LevelBar`): level badge, name, thin progress to the next threshold, `client base / next` (a `+` at level 18). Hover explains client base in plain words and names the next unlocks; a click opens the milestone screen. In the sandbox it is a `rules level N` chip.
- **Milestone screen** (`MilestoneScreen`, signal `milestones` in `state.ts`): a centred modal, `role="dialog"`, Escape and the backdrop close it, Tab is trapped, focus returns. All 18 levels as cards: passed dimmed with a check, current highlighted with progress, upcoming with unlock tiles (`PartArt`, or a kind icon for planned items, dashed), job classes arriving, wait time and payout chips with stricter/bigger arrows. Scrolls to the current (or clicked) level. Opened from the bar, the menu (Levels) and a lock badge.
- **Locked tiles**: a purchase with `locked`, or one the sim does not list that the unlock table gates (`lockOf`), is ladder state `level` (also board cards): visible, greyed, dashed, lock and `Level N` badge (a button that opens the milestone screen at that level), reason first (`lockTooltip`: level, then hardware and money). The next level's items get an accent outline. Never in the sandbox. The bay's OS shelf lists open items first (`unlockedFirst`).
- **Level-up banner** (`levelUp` in `state.ts`, rendered in `Toasts`): not modal; unlock chips and "See milestones"; shown when `leveledUpAt` is set and the level is above the viewer's `localStorage['pipeline-city.seenLevel']`; a load or new game rebases the seen level, so nothing replays. Waits behind a tutorial step and the two-toast cap (it takes one toast of room), 9 s, no animation under reduced motion.
- **Jobs**: key card and OS queue rows show need chips (red `missing`), the client's deadline (bar and time, red in the last quarter) for an unrunnable job, and **Decline**: first press arms (3 s, says the reputation cost; free in the sandbox), second confirms via `declineKey` (tray) or `declineJob` (OS rows). Plugging an unrunnable key is disabled with the reason. Stats drawer: Clients (served, expired, declined) and Boot (POST) parts; the power card states the POST time. Sandbox tools have a Rules level select (`setLevel`).
- Verified in headless Chrome (1360x800, 1920x1080, 390x844, dark and light): bar, tooltip, milestone screen, locked rungs and board cards, bay shelf, level-up banner, decline arming (3 s disarm, decline counted). Not verified: Decline button on an OS queue row (a waiting queued row was not reached; running rows show none), the stats drawer shots were not read.

## Known gaps

- The root size never goes below 15 px, so a small laptop or phone is larger relative to its screen than 1080p is. The UI size slider covers the rest.
- **Overview framing under the tutorial card.** The card is in the camera inset now (see Tutorial, "Camera reserve"), so the board's rect clears it, but the renderer's overview fit (`fits` in `src/render/board/board.ts`, applied in `applyInset` only while the camera is at the overview) does not always re-fit when the inset changes during a step start. In the check the board sat about 36 px under the top bar at 1360x800 and the chassis (`anchorOf('case')`, larger than the board) reached under the card. The fix belongs to the renderer (not UI): re-fit whenever the target inset changes, not only at the overview.
- **Drives and the OS by mouse.** In the sandbox playthrough a drag of an NVMe onto its M.2 socket (`m20`) was not accepted: no device, no notice. The renderer draws M.2 and SATA as decor (see the handover's visual gaps), so drives and the OS install could not be done with the mouse; the bay shelf (buy) and the OS rungs work.
- **Empty board region.** Clicking an empty spot on the board does not open the board picker (the clicks land on regions such as `pcie` or `atx0`); the playthrough opened it by selecting the id `board`, then bought with the real buttons.
- **The cooler sits on the CPU.** Its socket is drawn over the CPU, so a click at the cooler's centre opens the CPU; the cooler is picked at its edge.
- Touch: the tray and the ladder work with taps; the picker's dial is a range input over the track (tested with mouse only).
- On phones the picker docks above the shelf and the tutorial card hides while it is open.
- The CPU speed bar uses a throughput guess per engine (placeholder, like the other balance numbers).
- The `highlight` pulse on world ids only does something where the renderer reads it (it does, for the slots and parts it knows).

## One bubble at a time (2026-10-24 polish)

- **Click behaviour.** The power button and a key do their thing at once and open no card (a tripped or failed machine still opens the power card, which holds the power cycle). Other objects open the compact picker card.
- **Picker card.** Header art and name (the plain sentence is the name's tooltip), live readings as icon chips, warnings in words, the upgrade rungs with before/after bars (the numbers are in each bar's tooltip), actions, collapsed details. No "next tier" sentence, no explanatory notes under the sections (tooltips on the headings).
- **Tooltip.** The name and the first sentence only, and none while a card is open or something is being dragged.
- **Hints.** One toast at a time, short, an icon to dismiss. `MAX_TOASTS = 1`.
- **Level-up** (`LevelUpModal` in `Levels.tsx`): a modal over everything (z-index above the other modals) that waits for **Next** (or "All levels"). The new level swells in with rings, then each unlock pops in one after the other. It shows whatever else is on screen, the tutorial included.
- **Bar.** Money, time, reputation (star icon), the machine chip, speed, theme, menu. The level bar sits alone at the top centre (`.hud-center`); the tray count was dropped as redundant. The inventory button moved to the bottom bar (`.invbar`), next to the shelf it opens. A new game starts at 1x (`DEFAULT_SPEED` 4 in `store.ts`).
- **Inventory shelf.** Identical spares are one tile with a count (`stackItems`); kind chips filter the shelf; selecting a socket, an installed part, the PSU, the monitor or the drive bay on the PC opens the shelf with only the parts that fit there (`fitFilterFor`, `fitsFilter`, the `fitTarget` signal) and a **Show all** link.
- **Glow.** Hover is one thin outline; a selection adds none; the tutorial ring is the single yellow ring above.
- **Space** pauses and resumes at the speed the game ran at (`togglePause` in `store.ts`, `PauseKey` in `Hud.tsx`); a "Paused" pill shows. Text fields, sliders and open dialogs keep their own Space.
- **New game asks about the tutorial** (campaign only): "Guided tutorial? Yes, show me / No, I know the game" (`resetTutorial` in `state.ts`). Yes resets the tutorial to its welcome card, no hides it (the menu replays it). Continuing a saved game does not ask.
- **No held keys.** With an OS the key stays plugged while the OS works and pops out by itself when paid (`docs/OS.md`). There is no held-keys rack; the key card's Remove button is disabled with the reason while the OS has the job.

## Phones and short screens (checked 2026-10-25 in an emulated phone, 390x844 and 844x390, touch events)

- **Portrait phone** (`max-width: 48em`): the picker and stats become sheets, the shelf is a strip at the bottom, the tutorial box sits above it. The level pill drops below the bar; `InsetReporter` (`Hud.tsx`) counts it in the top inset, so cards and the camera start under it. A touch drag from a shelf tile onto a socket works (`touch-action: none` on tiles).
- **Landscape phone** (`max-height: 32em` and landscape): the shelf moves to a column on the right edge (like the tall-tablet layout), its category chips wrap into rows, the tutorial box gets smaller type and padding and stops at the shelf, so the board keeps the left of the screen. The CSS is the last block of `ui.css`.
- Not checked on a real device: pinch zoom, frame times, the shop and big cards on small screens beyond the two sizes above.

## Tutorial help for someone who is lost (2026-10-25)

- **Done pill.** When a step finishes, a green pill "Install the processor: done" sits above the card for about 2.5 s (`.tut-praise`), so progress is felt.
- **Ghost hand.** After 8 s without a drag on a drag step (a shelf tile to its socket, or a key to the USB port), a ring presses on the tile, glides to the target and lets go, over and over (`ghostPath`, `.ptr-ghost`, drawn in the pointer layer). Any drag by the player hides it; reduced motion turns it off.
- **Tip.** After 22 s on a drag step a plain-words tip bubble appears above the card ("press and hold the glowing part, move it to the glowing spot, then let go"). It floats, so the card does not grow and the camera does not re-frame.
- **Quiet shelf.** The shelf opens for steps that use it and tucks away on the others (never during a drag).
- **One steady camera.** Guided flights frame a fixed-size window (about 9500 world units wide, more for big targets) around the target, moved back inside the world, so a small part is always shown in its surroundings at the same zoom. A HUD target far from the card (the money) gets no connector line; it pulses by itself.
