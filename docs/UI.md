# UI

Preact + signals, in `src/ui`. Reads the sim only through `src/game/store.ts` (snapshot, actions, export/import, autosave offer) and the shared signals in `src/game/hover.ts` (`hover`, `selected`, `viewInset`) and `src/game/interaction.ts` (`highlight`, `dragging`). Mounted by `src/main.tsx` into `#hud`, a full-screen `pointer-events: none` layer above the board canvas (`#board`). Each panel re-enables pointer events.

The UI is for onboarding and reading the machine, and it recedes: the board is the star. Parts are placed by **dragging from the inventory tray** (or from the board, for parts already in the world). The picker offers purchases (into the inventory), the CPU clock, power actions and key actions.

## Look

- **Glass**: every panel (HUD bar, picker, inventory tray, tutorial card, stats drawer, menu, tooltip, toasts) is a low-opacity background (`--panel`) with `backdrop-filter: blur(10px)`, a 1 px hairline (`--glass-line`), a 10 px radius and no shadow. Tokens are on `:root` (light) and `:root[data-theme="dark"]` (plus the `prefers-color-scheme` fallback). Text is `--ink`, secondary text `--mute`; both were checked on the glass over the board in light and dark.
- **Small type**: 11 to 12 px body, 9.5 px uppercase labels, 13.5 px picker titles. Padding is 5 to 10 px.
- **Pause**: at speed 0 the root gets `class="paused"` (`state.ts`, from the speed signal). `ui.css` stops every animation that shows sim activity: the OS chip pulse (`.chip.live`) and anything marked `.sim-anim`. Hover transitions, panels, toasts and notices keep running. The tutorial's target pulse is guidance, not sim activity, so it keeps running. New sim-activity animations must use one of those hooks.
- **Fewer always-visible things**: the HUD shows money, time, reputation, keys (with `+N held` for held keys), the machine chip, the inventory button (count badge), speed and theme. Stats, export and import, the tutorial options, hints and new game are in the **menu** (`...`). Secondary numbers (demand, oldest key age) are in tooltips.
- **Part illustrations** (`PartArt.tsx`): inline SVG drawn from the spec, classes only (`.art .ink`, `.art .plate`...), so both themes read the tokens. CPU die with the pipeline per tier (one block for unpipelined, five stages for in-order, forwarding arcs and a cache row for tier 2); RAM sticks (count from the size) with a latency gauge; cooler (fins for the stock heatsink, fan for the tower, tubes and radiator for the liquid loop); PSU with a wattage dial; board with its slot counts; monitor.
- **Icons** (`Icons.tsx`): bolt for power, flame for heat, clock for speed and latency, dollar for price, lock for blocked or later, check for fitted, box for the inventory. Each is a 16 px stroke icon in `currentColor`.

## Files

| File | Role |
|---|---|
| `logic.ts` (+ `logic.test.ts`) | Pure: formatting, stats helpers, hint triggers, `describeId`, `statusChip` (HUD phase text), `queueReadout`, `friendlyError` (refusal wording), `clockWarning`. |
| `picker.ts` (+ `picker.test.ts`) | Pure: `pickerFor(id, snapshot)` builds the card model (title, lines, actions, the upgrade **ladder**, the `current` and `focus` parts). Also `statsOf` (numeric stats per part), `goodness` and `compareRows` (before/after bars), `clockZones` / `estTempC` / `zoneOf` (overclock zones). |
| `tutorial.ts` (+ `tutorial.test.ts`) | Pure: the tutorial steps (welcome card, 14 steps before the OS lesson, last card), `currentStep` derived from snapshot progress flags, step problems, replay baseline. `INVENTORY_ID` is the HUD button's id. |
| `regions.ts` | Plain + nerd text for region ids, world ids and die stages. `JOB_TYPES` for key jobs. |
| `state.ts` | UI signals: theme, stats drawer, the inventory tray, the tutorial's per-viewer state, hint toasts, the stats sparkline history. Everything persisted is in try/catch. |
| `testdata.ts` | Snapshot fixtures for the tests (a fresh game by default). |
| `Hud.tsx` | Top bar, Start / Continue prompt, the menu, the stats drawer, inset reporting for the camera. |
| `Inventory.tsx` | `InventoryButton` (HUD, count badge, pulses for tutorial steps) and `InventoryPanel` (the tray and its tiles). |
| `PickerCard.tsx` | The contextual card (left side): header with art and live readings, PSU load, lines, the upgrade ladder, before/after bars, the CPU clock dial, actions, details. Escape and the x close it. |
| `PartArt.tsx` | Inline SVG illustration of a part or a board tier (`PartArt({id, size})`). |
| `Icons.tsx` | The icon set (`Icon({name, size})`). `IconName` is defined in `picker.ts`. |
| `worldDrag.ts` | `beginPartDrag(invId, event)`: a thin wrapper over the renderer's hook (`src/render/board.ts`). |
| `TutorialCard.tsx` | The tutorial card (bottom left). Writes `highlight`. Opens the inventory tray on install steps. |
| `Hover.tsx` | `Tooltip` (follows `hover`). |
| `Toasts.tsx` | `Notice` (a refused action, plain words, dismissible, clears after 6 s) and hint toasts. |
| `Stats.tsx`, `Meter.tsx` | Nerd stats drawer (CPI/IPC, stalls, cache, power, device temps, sparkline) and the small bar. |
| `ui.css` | All styles. Glass tokens, the part-art classes, the ladder, the dial, the tray. Below 760 px the side cards become bottom sheets. |

## Selection and highlight contract

- **`selected`** (written by the renderer on click, and by the UI, `null` on empty space): a slot id (`cpu0`, `dimm0`, `atx0`, `cooler0`, `display0`), a device id (`dev1`), a spec id (`cpu1`, `ram0`), `inv:<inventoryId>` (a tile in the tray, or a part in the world), `tray`, `key:<keyId>`, `usb`, `power`, `monitor`, `psu`, `cable.atx`, `cable.cpu`, `cable.video`, a region id, or a world id. The picker opens for any id it can describe. The old `crate` id still describes the inventory in words (`REGIONS.crate`) but opens no card of its own.
- **`highlight`** (written by the UI, read by the renderer): the target ids of the current tutorial step, e.g. `['inv:inv1', 'cpu0']`. The renderer rings the ids it knows and skips the rest. `inventory` is a **UI-only** id: the HUD's inventory button pulses for it (and for any `inv:` id). Cleared when the tutorial is off or the card unmounts.
- **`hover`** (renderer): the tooltip uses `describeId(id, snapshot)`, so slots and parts are named in words.
- **`dragging`** (renderer): `{kind: 'part', id}` during a drag from the tray. The tray slides away while it is set (`.inv.away`), so the board is visible for the drop. The camera keeps the tray's space reserved during the drag, so the board does not re-frame under the pointer.

## Inventory tray (`Inventory.tsx`)

- The HUD's **Inventory** button shows the count badge and toggles the tray (`inventoryOpen`). It pulses while a tutorial step asks for the inventory or one of its parts.
- The tray is a glass strip along the **bottom right** edge. Each part is a tile: illustration, short name, kind. A tile that cannot be fitted right now (the machine is on, or no free socket) is dimmed with a lock and the reason in its tooltip.
- **Press a tile** (`pointerdown`, primary button) calls `beginPartDrag(inventoryId, event)`; the renderer starts the drag at once, and a drop on a valid socket installs it. **Click a tile** (no drag) writes `selected = 'inv:<id>'`, which opens the picker on that part. Keyboard: Enter or Space selects. The tile sets `touch-action: none` so touch drags do not scroll the tray.
- While `dragging.kind === 'part'`, the tray slides out (`.inv.away`, `pointer-events: none`).

## Picker (`PickerCard.tsx` + `picker.ts`)

Opens only when `selected` is set. Escape or the x closes it. For a part it shows, top to bottom:

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
- **Before/after bars** (`compareRows`): for the compared rung against the current part of the kind. Each stat has an icon, a thin grey bar (current), a coloured bar (option; green better, red worse, grey same), and a delta such as `+16 K` or `-188 ticks`. Bar length is relative to the best part of that kind (`goodness`; for lower-is-better stats the best is the lowest). Stats: CPU speed (estimate) and power; RAM memory, latency and power; PSU capacity; cooler heat removal and power; board memory slots and slots. The CPU speed is `base clock x a per-engine throughput guess`: a placeholder like the other balance numbers.
- **CPU clock dial** (installed, working CPU): a track with three zones, **safe**, **throttle** and **unstable**, from the sim's own steady-state heat model (`clockZones`, the same numbers as `thermal.ts`: the clock at which a full-load CPU with the installed cooler reaches its throttle and unstable temperatures). A knob shows the clock in its zone colour, a chip says the zone word, and the estimated temperature (`estTempC`) sits beside it. The slider is a transparent range input over the track.
- **Power card**: status line, the POST error line (`POST error: <reason>`, a missing part is never shown as a refused press: only a missing PSU or ATX cable refuses), and a note that power-off is immediate (a job in progress is lost; the key keeps its data and the job restarts at the next boot). **USB card**: a key the machine ignores says so ("ignored until the next boot") and why.
- **Actions**: Power on/off, Power cycle after a trip, Plug into USB, Remove key (get paid). Disabled actions carry the sim's reason as their tooltip.
- **Details**: the nerd text, collapsed.
- **The OS is on its drive, not the monitor.** The monitor is one object and only shows the OS text. The installed OS has an **OS badge** on the drive that hosts it (id `os`, present only while an OS is installed). Clicking the badge (`os`) or the host drive (its device id) opens the same card: the **OS section** (`osSection(s)` in `picker.ts`, rendered by `OsBlock`). It shows the name and tier, the status chip (the phase), programs at once and queue slots, the host drive's used and total space, the running job, each queue row with job type, state and how many jobs are ahead (next, 2 ahead, done waiting for you), held keys with plug key X again to collect, the ladder with later tiers locked and their description, and **Uninstall OS** (two presses). Other drives show no OS section. With no OS installed, the drive bay (`bay`) shows the **Operating systems** shelf to buy from.
- **Storage and OS**: a drive shows its used and total capacity (its `sata`/`m2` socket is "drag a drive here"); a drive's stats are capacity, latency, throughput (`drivePerSecond`, bytes/s) and power. The OS shows programs, queue slots, memory and disk needed, with the later tiers locked and their description on hover. An installed OS has **Uninstall OS**, which takes two presses (the first asks, the second wipes the drive via `store.uninstallOs`). A spare that the sim will not fit shows its reason (memory, free space, no slot) in its rung.

Buttons that the sim would refuse are disabled, with the reason in their tooltip. A press the sim still refuses shows the **Notice**.

## Tutorial (`tutorial.ts`, `TutorialCard.tsx`)

The step is derived from the snapshot's sticky `progress` flags (`src/sim/game/save.ts`), so a loaded save resumes at the right step, and an action done out of order is simply skipped past when its flag is already set. Nothing advances on a Next button: only **Start** (welcome) and **Got it** (last card) have buttons. Skip is always available; **Replay tutorial** is in the menu. The cooler step refuses clearly: dragging it before the CPU shows the sim's reason (`install the CPU first: the cooler mounts on it`), and pressing power without it leaves the cooler step active with the PCH reason (`no CPU cooler installed`). The picker and tooltip call the slot a `cooler mount: mounts on the CPU`. Test fixtures (`testdata.ts`): the bare board has no cooler device and the crate has `inv5` the stock cooler (not installable until a CPU is in).

| # | Step | Flag that completes it | Highlight |
|---|---|---|---|
| - | Welcome (Start): open the inventory | none (button) | `inventory` (the HUD button) |
| 1 | Install the processor | `cpuInstalled` | `inv:<cpu>`, `cpu0` |
| 2 | Install the cooler: the fan sits on the CPU to carry heat away and spins only while powered | `coolerInstalled` | `inventory`, `inv:<cooler>`, `cooler0` |
| 3 | Install the memory | `ramInstalled` | `inv:<ram>`, `dimm0`, `dimm1` |
| 4 | Install the power supply | `psuInstalled` | `inv:<psu>`, `atx0` |
| 5 | Install the monitor | `monitorInstalled` | `inv:<display>`, `display0` |
| 6 | Connect the main power cable | `atxConnected` | `cable.atx`, `psu` |
| 7 | Connect the processor power cable | `cpuPowerConnected` | `cable.cpu`, `psu` |
| 8 | Connect the video cable | `videoConnected` | `cable.video`, `monitor` |
| 9 | Plug in a client key **first, while the machine is off**: "the machine only looks for a program at boot" | `firstKeyPlugged` | `usb`, `key:<first in tray>` |
| 10 | Press the power button (POST, one look at the USB port, load) | `poweredOn` (a real boot started) | `power` |
| 11 | Watch it work (it halts when the job is done) | `firstJobDone` | `monitor` |
| 12 | Remove the key (paid on removal) | `firstKeyEjected` | `usb` |
| 13 | Power off and on for the next job: plug the next key, then power off and on; "this manual loop is why an OS is worth buying" | `firstManualCycle` | `power`, `usb`, `key:` |
| 14 | Spend your first money | `firstPurchase` | the CPU's slot, or `inventory` |
| 15 | Fit your new part | no bought upgrade still in the inventory (`pendingUpgrade`: a higher tier than the best installed of its kind; a swap counts) | `inv:` item and its socket (free or swap) |
| 16 | Buy a drive | live: a storage item owned or installed | `bay` |
| 17 | Install the drive | `storageInstalled` | `inv:` storage item and its `sata`/`m2` slot |
| 18 | Buy an operating system | live: an OS owned or installed | `bay` (the systems are listed on the bay's shelf) |
| 19 | Install the OS on the drive | `osInstalled` | `inv:` OS item and the drive's slot |
| 20 | Boot the OS from the drive | live: phase `booting-os`, `idle-os`, `ingesting`, `running-os` or `flashing`, or `firstOsJob` | `power`, `monitor` (boot text), `os` (the badge) |
| 21 | Plug in a key: the OS takes it | live: `held` non-empty, or the plugged key is `queued`, `running`, `result`, `flashing` or `done` | `usb`, `key:` |
| 22 | Unplug it: the OS keeps the job | live: `held` non-empty, or the plugged key is `result`, `flashing` or `done` | `usb`, `key:` |
| 23 | Wait for the job | live: a held key is `result`, or the plugged key is `result`, `flashing` or `done` | `os` (the badge), `held` |
| 24 | Plug the key back in to collect | live: the plugged key is `flashing` or `done` | `usb`, `key:` |
| 25 | Remove the key to get paid | `firstOsJob` | `usb`, `key:` |
| - | Workshop open (Got it): the OS runs jobs; a network card and a router will replace the USB keys | none (button) | none |

Steps 15 to 25 are the storage and OS lesson. A player who finished the first twelve (`OLD_FLAGS` deliberately excludes `coolerInstalled`, which loading derives, and `firstManualCycle`, which loading derives too) (or a migrated save with those flags) is **not** forced through them: the card becomes one offer, **Next lesson: the OS** (Start the lesson, or Not now, which never comes back). Taking it sets `osLesson` and starts at the drive. `osLesson` and `offered` are persisted next to the old flags.

**Order and resume.** The key goes in first (the machine is off), then power. If the player presses power first, the plug step stays current but its problem line says the running machine will not look at the key (power off, plug, power on); if the key was plugged into a running machine, the watch step's problem line explains why nothing happens (`keyIgnored` or `haltReason: "no-boot-media"`). The power step also warns when the port is empty ("the machine would halt with NO BOOT MEDIA"). `firstManualCycle` is the one flag added for this lesson.

**Live steps** have no flag: `isDone(step, snapshot, progress)` reads the sim's own state (owned items, the phase, `KeySnap.stage`, `held[]`). Nothing completes a step with a Next button. The bot test (`tutorial.bot.test.ts`) plays the whole lesson through public Game actions, in order, with each step under 600 s of game time, and checks that no action is refused. It serves the queue with the manual loop (remove the key, power off, plug the next key while off, power on) until the OS is installed, because the first purchase needs money. **Every step is reached within 10 minutes of game time, and no action is ever refused** (the test asserts the refusal list is empty).

An install step **opens the inventory tray** by itself (any `inv:` target), so the part to drag is on screen. Each card shows a **problem line** when the step is stuck, taken from the sim's own reasons: `noPowerReason`, the cable's `blocked`, `postBlocker`, `phaseReason`, "No key yet", "The machine is off", "No cpu in the inventory".

**Resume and replay.** Persisted in `localStorage['pipeline-city.tutorial']` (try/catch): `welcomed`, `skipped`, `finished`, and a `replay` baseline. The progress itself is never stored here: it comes from the save. Replay sets a baseline (completed count, owned count) and judges steps from live state, because the flags are already true in an old save. A save where every flag is already set (a migrated v1 save) shows only the last card.

**Hints wait.** Hint toasts do not appear while a tutorial step is active. The cap of two visible toasts is unchanged.

## HUD (`Hud.tsx`)

Left to right: **money** (with game time next to it), **rep** (reputation; demand in its tooltip), **keys** (tray count out of the cap; red when a key is late; oldest age in its tooltip), **machine chip** (`statusChip`: Off, POST, Loading, Running, Writing, `Job done: remove key` or `No boot media` for the halted phase, `POST error: <reason>` for a missing part, `Error: <reason>` for run-time faults, the OS texts, and Tripped), then, on the right, the **Inventory** button with its count, the **speed** segment (II, 1x, 4x, 16x), the **theme** toggle and the **menu** (`...`): Stats, Export game, Import game, Replay tutorial, Skip tutorial (while active), Show hints again, New game (asks twice).

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

## Camera inset

`InsetReporter` (in `Hud.tsx`) measures the bar, the picker, the tutorial card, the stats drawer and the inventory tray, and writes `viewInset` (CSS px). The renderer frames the board in the free area. A MutationObserver on `#hud` (children and `class` attributes) re-measures whenever a card opens or closes, changes content or is slid away. The tray's reserved strip is remembered while it is slid away during a drag, so the camera does not re-frame mid-drag.

## Theme

`data-theme="dark" | "light"` on `<html>`, from `state.ts` (saved choice, else `prefers-color-scheme`, else dark). Scene tokens (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`) are read by the renderer. UI tokens (`--accent --ok --warn --bad`, `--panel --glass-line --glass-hi --art-plate`, `--ui --mono`) are for the UI.

## Tests

`npm test` runs the pure logic: `logic.test.ts` (formatting, stats, hints and toasts, HUD status text, queue readout, refusal wording, descriptions for every id the renderer writes), `picker.test.ts` (contents per id: empty socket, installed CPU, spare and upgrade ladder rungs, inventory items, keys, power after a trip, PSU, USB, cables, regions, board; stat values, bar goodness, before/after deltas, clock zones and the estimated temperature), `tutorial.test.ts` (steps from flags, resume mid-way, out-of-order actions, replay, migrated saves, step problems and targets, no step points at the crate, persisted state). Fixtures are in `testdata.ts`. `tutorial.bot.test.ts` is the headless completability test: a bot plays the whole tutorial, storage and OS included, through public Game actions (run with `npm test`, about 1 s).

## Verification

Checked in headless Chrome (playwright-core, software GL, dev server) with screenshots in dark and light: the HUD with the board behind, the picker for the CPU (empty and installed), RAM, cooler, PSU and board, the inventory tray open with several items, the tray during a drag, the tutorial's welcome and install steps, the menu, the stats drawer, and a phone-width layout. A real mouse drag from a tray tile onto the CPU socket installed the CPU (`dragging` set during the drag, tray away, cleared after the drop).

## Known gaps

- Text is small by design (11 to 12 px). Not tuned for accessibility zoom beyond the browser's own.
- Touch: the tray and the ladder work with taps; the picker's dial is a range input over the track (tested with mouse only).
- Narrow screens (below 760 px) stack the picker, stats and inventory as bottom sheets. The picker and the tray can overlap when both are open on a phone.
- The CPU speed bar uses a throughput guess per engine (placeholder, like the other balance numbers).
- The `highlight` pulse on world ids only does something where the renderer reads it (it does, for the slots and parts it knows).
