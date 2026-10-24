# UI

Preact + signals, in `src/ui`. Reads the sim only through `src/game/store.ts` (snapshot, actions, export/import, autosave offer) and the shared signals in `src/game/hover.ts` (`hover`, `selected`, `viewInset`) and `src/game/interaction.ts` (`highlight`, `dragging`). Mounted by `src/main.tsx` into `#hud`, a full-screen `pointer-events: none` layer above the board canvas (`#board`). Each panel re-enables pointer events.

The UI is for onboarding and reading the machine, and it recedes: the board is the star. Parts are placed by **dragging from the inventory shelf** (or from the board, for parts already in the world). The picker offers purchases (into the inventory), the CPU clock, power actions and key actions.

## Look

- **Glass**: every panel (HUD bar, picker, inventory shelf, tutorial card, stats drawer, menu, tooltip, toasts, modals) is a low-opacity background (`--panel`) with `backdrop-filter: blur(0.67rem)`, a 1px hairline (`--glass-line`), a 0.67rem radius and no shadow. Tokens are on `:root` (light) and `:root[data-theme="dark"]` (plus the `prefers-color-scheme` fallback). Text is `--ink`, secondary text `--mute`; both were checked on the glass over the board in light and dark.
- **Small type** (all rem): 0.8rem body, 0.65rem uppercase labels, 0.95rem titles.
- **Pause**: at speed 0 the root gets `class="paused"` (`state.ts`, from the speed signal). `ui.css` stops every animation that shows sim activity: the OS chip pulse (`.chip.live`) and anything marked `.sim-anim`. Hover transitions, panels, toasts and notices keep running. The tutorial's target pulse is guidance, not sim activity, so it keeps running. New sim-activity animations must use one of those hooks.
- **Fewer always-visible things**: the HUD shows money, time, reputation, keys (with `+N held` for held keys), the machine chip, the inventory button (count badge), speed and theme. Stats, export and import, the tutorial options, hints and new game are in the **menu** (`...`). Secondary numbers (demand, oldest key age) are in tooltips.
- **Part illustrations** (`PartArt.tsx`): inline SVG drawn from the spec, classes only (`.art .ink`, `.art .plate`...), so both themes read the tokens. CPU die with the pipeline per tier (one block for unpipelined, five stages for in-order, forwarding arcs and a cache row for tier 2); RAM sticks (count from the size) with a latency gauge; cooler (fins for the stock heatsink, fan for the tower, tubes and radiator for the liquid loop); PSU with a wattage dial; board with its slot counts; monitor.
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
| `worldDrag.ts` | `beginPartDrag(invId, event)`: a thin wrapper over the renderer's hook (`src/render/board.ts`). |
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
- **The OS is on its drive, not the monitor.** The monitor is one object and only shows the OS text. The installed OS has an **OS badge** on the drive that hosts it (id `os`, present only while an OS is installed). Clicking the badge (`os`) or the host drive (its device id) opens the same card: the **OS section** (`osSection(s)` in `picker.ts`, rendered by `OsBlock`). It shows the name and tier, the status chip (the phase), programs at once and queue slots, the host drive's used and total space, the running job, each queue row with job type, state and how many jobs are ahead (next, 2 ahead, done waiting for you), held keys with plug key X again to collect, the ladder with later tiers locked and their description, and **Uninstall OS** (two presses). Other drives show no OS section. With no OS installed, the drive bay (`bay`) shows the **Operating systems** shelf to buy from.
- **Storage and OS**: a drive shows its used and total capacity (its `sata`/`m2` socket is "drag a drive here"); a drive's stats are capacity, latency, throughput (`drivePerSecond`, bytes/s) and power. The OS shows programs, queue slots, memory and disk needed, with the later tiers locked and their description on hover. An installed OS has **Uninstall OS**, which takes two presses (the first asks, the second wipes the drive via `store.uninstallOs`). A spare that the sim will not fit shows its reason (memory, free space, no slot) in its rung.

**VRM, boards and heatsinks** (docs/VRM.md):

- **VRM readout** (the `vrm` id, and a fitted CPU's card): a load bar with three zones (safe, working hard past 60 percent, overload past 100 percent of the phases' rating), the demand in amps, then icon chips for temperature, efficiency, throttle, crash chance, heat, ripple and the heatsink. Each chip explains itself on hover: the temperature, throttle, crash and heatsink chips have their own plain line, and the efficiency, heat, ripple and load chips use the `describeId` line for their id (`vrm.efficiency`, `vrm.heat`, `vrm.ripple`, `vrm.load`). The stats drawer has the same numbers as rows.
- **Motherboard cards** (`board`, and a board in the inventory): one card per tier the machine can still use, in a compact 2x2 grid (art 54 units, 0.3rem gaps; with the shelf open the whole picker is about 463 px of body at 1360x800 and 1024x640 and 510 px at 1920x1080, so it does not scroll above the shelf). Each shows the tier name, slot counts and features as small icons (memory, PCIe, drive bays, M.2, heatsink slot, power connector; ethernet, USB, monitor ports), the VRM strength (phases x amps, total A) as a grey (your board) and a coloured (this tier) bar, and the state: Fitted, Spare, Buy, Poor, Blocked (the sim's reason, e.g. "powered off required"), Later. A dead board's card reads **Replace** at the same-tier price, and the picker says why it is dead.
- **Dead board in the HUD**: the status chip reads "Board dead: replace it", and its tooltip names the same-tier replacement and its price (`statusChip`).
- **Warnings on the upgrade rows**: a CPU whose stock-clock demand is over the planned board's VRM rating gets a warning icon on its rung and the line "this board's VRM can't feed it: expect throttling or crashes" under the bars. A liquid cooler (no airflow over the VRM) gets "liquid coolers don't cool the VRM: add a VRM heatsink" while no VRM heatsink is fitted.
- **Heatsink rows** (`vrm-sink`): the three heatsinks as rungs with their own art (fins, big fins, fins and a fan), before/after bars for heat removal and power draw, and a hint on the empty `vrm-sink0` socket ("Drop a VRM heatsink here").

Buttons that the sim would refuse are disabled, with the reason in their tooltip. A press the sim still refuses shows the **Notice**.

## Tutorial (`tutorial.ts`, `TutorialCard.tsx`)

**Presentation.** The welcome and the "Next lesson: the OS" offer are **centred modals** over a dimmed backdrop (`.modal-back`, also used by the Welcome back prompt and the New game dialog). Every other step is a **card at the bottom centre** (34rem wide, above the shelf, below notices and toasts in the `.stack`). Between steps the old text fades out while the new one slides in, and the card height glides. **Camera**: when a step starts and its first world target is not comfortably in view (centre inside the inner 80 percent of the free area), the camera flies there (`flyTo`, smooth); a press, wheel or pinch by the player cancels the flight and nothing re-flies, and a **Show me** link (shown whenever the target is not comfortably visible) flies again. **Pointer**: a thin glowing dashed connector with a pulsing dot runs from the card's nearest edge to the target's on-screen anchor (`anchorOf`, falling back to the inventory tile, then the HUD button); it glides from the previous target to the next, follows the object every frame while the camera moves, and hides when no target is visible. **Card lift**: if the card would cover any visible target it lifts above it (`liftAbove`). The existing `highlight` rings stay. The pointer and the glides are interactive guidance, so they keep running while the game is paused. `prefers-reduced-motion` turns the glides, the cross-fade and the pointer animation into jumps (the camera flight becomes `smooth: false`); checked in Chrome with the media emulated: the pointer line and dot, the card and its text, the picker shell and its content have `animation: none` and `transition: none` (computed style), and the picker moves at once.
**Camera reserve**: while a step is active the card is part of the camera inset. `InsetReporter` reserves the card's layout box (its `offsetTop` in the fixed stack, so its lift never moves the camera) down to its top edge, which also covers the shelf below it. At 1360x800 and 1920x1080 the board's rect (`anchorOf('board')`) stays above the card's top edge in the overview (board bottom 421 px vs card top 494 px at 1360x800). The chassis (`anchorOf('case')`) can still reach under the card, and the overview's fit is the renderer's (see Known gaps).

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

An install step **opens the inventory shelf** by itself (any `inv:` target), so the part to drag is on screen. Each card shows a **problem line** when the step is stuck, taken from the sim's own reasons: `noPowerReason`, the cable's `blocked`, `postBlocker`, `phaseReason`, "No key yet", "The machine is off", "No cpu in the inventory".

**Resume and replay.** Persisted in `localStorage['pipeline-city.tutorial']` (try/catch): `welcomed`, `skipped`, `finished`, and a `replay` baseline. The progress itself is never stored here: it comes from the save. Replay sets a baseline (completed count, owned count) and judges steps from live state, because the flags are already true in an old save. A save where every flag is already set (a migrated v1 save) shows only the last card.

**Hints wait.** Hint toasts do not appear while a tutorial step is active. The cap of two visible toasts is unchanged. A sandbox game has no tutorial and no "Next lesson" offer (`currentStep` and `offerNextLesson` return nothing for it; see `docs/SANDBOX.md`).

## HUD (`Hud.tsx`)

Left to right: **money** (with game time next to it), **rep** (reputation; demand in its tooltip), **keys** (tray count out of the cap; red when a key is late; oldest age in its tooltip), **machine chip** (`statusChip`: Off, POST, Loading, Running, Writing, `Job done: remove key` or `No boot media` for the halted phase, `POST error: <reason>` for a missing part, `Error: <reason>` for run-time faults, the OS texts, and Tripped), then, on the right, the **Inventory** button with its count, the sandbox chip (sandbox games), the **speed** segment (II, 1x, 4x, 16x), the **theme** toggle and the **menu** (`...`): Stats, Export game, Import game, Replay tutorial, Skip tutorial (while active), Show hints again, New game (opens the Campaign or Sandbox dialog; asks again before discarding a running game).

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
- **Not built yet**: the panel itself. `netPanel` and the `.net-seg` styles exist and are tested, and the HUD chip toggles `netOpen`, but no component renders the panel yet.

## Camera inset

`InsetReporter` (in `Hud.tsx`) measures the top bar, the stats drawer, the inventory shelf and, while a tutorial step is active, the tutorial card (its layout top) and writes `viewInset` (CSS px, from live rects). It watches the HUD's `class` and `style` attributes, so a card that changes height is measured. The picker popup, toasts and modals are overlays and reserve nothing (the card also lifts away from its target when it would cover one). The shelf's reserved size is remembered while it is collapsed during a drag. The renderer eases to the new inset and never applies it mid-gesture (docs/RENDER.md).

## Theme

`data-theme="dark" | "light"` on `<html>`, from `state.ts` (saved choice, else `prefers-color-scheme`, else dark). Scene tokens (`--bg --board --trace --sub --die --pin --tile --ink --mute --line --dot --on --alu --mul --ld --st --br --bad`) are read by the renderer. UI tokens (`--accent --ok --warn --bad`, `--panel --glass-line --glass-hi --art-plate`, `--ui --mono`) are for the UI.

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
- **Overview framing under the tutorial card.** The card is in the camera inset now (see Tutorial, "Camera reserve"), so the board's rect clears it, but the renderer's overview fit (`fits` in `src/render/board.ts`, applied in `applyInset` only while the camera is at the overview) does not always re-fit when the inset changes during a step start. In the check the board sat about 36 px under the top bar at 1360x800 and the chassis (`anchorOf('case')`, larger than the board) reached under the card. The fix belongs to the renderer (not UI): re-fit whenever the target inset changes, not only at the overview.
- **Drives and the OS by mouse.** In the sandbox playthrough a drag of an NVMe onto its M.2 socket (`m20`) was not accepted: no device, no notice. The renderer draws M.2 and SATA as decor (see the handover's visual gaps), so drives and the OS install could not be done with the mouse; the bay shelf (buy) and the OS rungs work.
- **Empty board region.** Clicking an empty spot on the board does not open the board picker (the clicks land on regions such as `pcie` or `atx0`); the playthrough opened it by selecting the id `board`, then bought with the real buttons.
- **The cooler sits on the CPU.** Its socket is drawn over the CPU, so a click at the cooler's centre opens the CPU; the cooler is picked at its edge.
- Touch: the tray and the ladder work with taps; the picker's dial is a range input over the track (tested with mouse only).
- On phones the picker docks above the shelf and the tutorial card hides while it is open.
- The CPU speed bar uses a throughput guess per engine (placeholder, like the other balance numbers).
- The `highlight` pulse on world ids only does something where the renderer reads it (it does, for the slots and parts it knows).
