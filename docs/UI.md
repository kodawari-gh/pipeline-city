# UI

Preact + signals, in `src/ui`. Reads the sim only through `src/game/store.ts` (snapshot, actions, export/import, autosave offer) and the shared signals in `src/game/hover.ts` (`hover`, `selected`, `viewInset`) and `src/game/interaction.ts` (`highlight`, `dragging`). Mounted by `src/main.tsx` into `#hud`, a full-screen `pointer-events: none` layer above the board canvas (`#board`). Each panel re-enables pointer events.

The UI is for onboarding and reading the machine. Parts and cables are placed by **dragging in the world** (the renderer), never from buttons. The picker only offers purchases (into the crate), the CPU clock, power actions and key actions.

## Files

| File | Role |
|---|---|
| `logic.ts` (+ `logic.test.ts`) | Pure: formatting, stats helpers, hint triggers, `describeId`, `statusChip` (HUD phase text), `queueReadout`, `friendlyError` (refusal wording), `clockWarning`. |
| `picker.ts` (+ `picker.test.ts`) | Pure: `pickerFor(id, snapshot)` builds the card model (title, lines, rows, actions) for any selected id. |
| `tutorial.ts` (+ `tutorial.test.ts`) | Pure: the tutorial steps (welcome card, 12 steps, last card), `currentStep` derived from snapshot progress flags, step problems, replay baseline. |
| `regions.ts` | Plain + nerd text for region ids, world ids and die stages. `JOB_TYPES` for key jobs. |
| `state.ts` | UI signals: theme, stats drawer, the tutorial's per-viewer state, hint toasts, the stats sparkline history. Everything persisted is in try/catch. |
| `testdata.ts` | Snapshot fixtures for the tests (a fresh game by default). |
| `Hud.tsx` | Top bar, Start / Continue prompt, the menu, the stats drawer, inset reporting for the camera. |
| `PickerCard.tsx` | The contextual card (left side). Escape and the x close it. Holds the CPU clock control. |
| `TutorialCard.tsx` | The tutorial card (bottom left). Writes `highlight`. |
| `Hover.tsx` | `Tooltip` (follows `hover`). |
| `Toasts.tsx` | `Notice` (a refused action, plain words, dismissible, clears after 6 s) and hint toasts. |
| `Stats.tsx`, `Meter.tsx` | Nerd stats drawer (CPI/IPC, stalls, cache, power, device temps, sparkline) and the small bar. |
| `ui.css` | All styles. Tokens on `:root` (light) and `:root[data-theme="dark"]`. Below 760 px the side cards become bottom sheets. |

## Selection and highlight contract

- **`selected`** (written by the renderer on click, `null` on empty space): a slot id (`cpu0`, `dimm0`, `atx0`, `cooler0`, `display0`), a device id (`dev1`), a spec id (`cpu1`, `ram0`), `inv:<inventoryId>` (crate item), `crate`, `tray`, `key:<keyId>`, `usb`, `power`, `monitor`, `psu`, `cable.atx`, `cable.cpu`, `cable.video`, a region id, or a world id. The picker opens for any id it can describe. The UI also writes `selected` (Escape, the close button, the crate badge, the picker close).
- **`highlight`** (written by the UI, read by the renderer): the target ids of the current tutorial step, e.g. `['inv:inv1', 'cpu0']`. Cleared when the tutorial is off or the card unmounts.
- **`hover`** (renderer): the tooltip uses `describeId(id, snapshot)`, so slots and parts are named in words.
- **`dragging`** (renderer): not read yet.

## Picker (`PickerCard.tsx` + `picker.ts`)

Opens only when `selected` is set. Escape or the x closes it. Shows:

- **Socket** (empty slot): "Empty socket" plus crate items of that kind and upgrades. Each upgrade row has tier, key stats, price and **Buy** (`purchase`), or the reason it cannot be bought: `Need $N more` (poor, disabled) or the board's blocked reason (blocked, disabled).
- **Installed part**: live temperature, power and clock, the upgrades, CPU throttle/unstable warnings (`clockWarning`), the CPU clock slider (`setCpuClock`).
- **PSU**: load against budget, power cycle after a trip, upgrades.
- **Crate**: the contents, a drag hint, "Parts only change while the machine is off".
- **Key** (`key:<id>`): job type, due or late, payout estimate, tries, result when done; **Plug into USB** (`plugKey`) or **Remove key (get paid)** (`ejectKey`). Plug and remove are fallbacks: the drag path is the normal way.
- **Power button**: status, the sim's reason when power is refused (`noPowerReason`), POST blocker, error reason; **Power on/off** and **Power cycle** after a trip.
- **USB port**: the plugged key and its state, or "port is free".
- **Cable**: connected, or the blocked reason.
- **Region / world id** (`vrm`, `chipset`, `atx`, `cpw`, `io`, `bat`...): plain and nerd text only.

Buttons that the sim would refuse are disabled, with the reason in their tooltip and in the card’s lines. A press the sim still refuses shows the **Notice**.

## Tutorial (`tutorial.ts`, `TutorialCard.tsx`)

The step is derived from the snapshot's sticky `progress` flags (`src/sim/game/save.ts`), so a loaded save resumes at the right step, and an action done out of order is simply skipped past when its flag is already set. Nothing advances on a Next button: only **Start** (welcome) and **Got it** (last card) have buttons. Skip is always available; **Replay tutorial** is in the menu.

| # | Step | Flag that completes it | Highlight |
|---|---|---|---|
| - | Welcome (Start) | none (button) | `crate` |
| 1 | Install the processor | `cpuInstalled` | `inv:<cpu>`, `cpu0` |
| 2 | Install the memory | `ramInstalled` | `inv:<ram>`, `dimm0`, `dimm1` |
| 3 | Install the power supply | `psuInstalled` | `inv:<psu>`, `atx0` |
| 4 | Install the monitor | `monitorInstalled` | `inv:<display>`, `display0` |
| 5 | Connect the main power cable | `atxConnected` | `cable.atx`, `psu` |
| 6 | Connect the processor power cable | `cpuPowerConnected` | `cable.cpu`, `psu` |
| 7 | Connect the video cable | `videoConnected` | `cable.video`, `monitor` |
| 8 | Press the power button | `poweredOn` (a real boot started) | `power` |
| 9 | Plug in a client key | `firstKeyPlugged` | `usb`, `key:<first in tray>` |
| 10 | Watch it work | `firstJobDone` | `monitor` |
| 11 | Remove the key (paid on removal) | `firstKeyEjected` | `usb` |
| 12 | Spend your first money | `firstPurchase` | the CPU's slot |
| - | Workshop open (Got it) | none (button) | the first crate item |

Each card shows a **problem line** when the step is stuck, taken from the sim's own reasons: `noPowerReason`, the cable's `blocked`, `postBlocker`, `phaseReason`, "No key yet", "The machine is off".

**Resume and replay.** Persisted in `localStorage['pipeline-city.tutorial']` (try/catch): `welcomed`, `skipped`, `finished`, and a `replay` baseline. The progress itself is never stored here: it comes from the save. Replay sets a baseline (completed count, owned count) and judges steps from live state, because the flags are already true in an old save. A save where every flag is already set (a migrated v1 save) shows only the last card.

**Hints wait.** Hint toasts do not appear while a tutorial step is active. The cap of two visible toasts is unchanged.

## HUD (`Hud.tsx`)

Left to right: **money**, **time** (game time), **reputation** (with the demand per minute), **queue** (keys waiting out of the tray cap, and the oldest key's age, red when a key is late), **machine chip** (`statusChip`: Off, POST, Waiting for key, Loading, Running, Writing, Remove key, Error: reason, and Tripped), then the **crate** badge (item count, click to open the crate card), **speed** (II, 1x, 4x, 16x), **Stats** (drawer), **Export** and **Import**, **theme**, and a **menu** (`...`): Replay tutorial, Skip tutorial (while active), Show hints again, New game (asks twice).

The HUD does not repeat the tray or the monitor; those are in the world.

**Refusals.** A refused action sets `lastError` in the store. `Notice` shows it in plain words ("Not now: Power the machine off first.") and clears itself after 6 s or on the x. Clearing sets `lastError` back to null so the same refusal shows again next time.

## Hints (`logic.ts`, `state.ts`)

Shown once each as a small dismissible toast, remembered in `localStorage['pipeline-city.hints']`. At most two are visible (bottom centre). The rest wait in a queue and appear when one is dismissed or auto-expires after 8 s. Hints are suppressed while a tutorial card is active; the menu's **Show hints again** clears the seen list.

| id | fires when |
|---|---|
| `stall` | any stall counter is above 0 |
| `throttle` | a working device has `throttle < 1` |
| `overheat` | a working device is `unstable` |
| `queue` | 3 or more keys waiting in the tray |
| `burnt` | a device is burnt |
| `trip` | the PSU has hard-tripped |
| `brownout` | PSU overloaded (`psuFactor < 1`) but not tripped |

## Camera inset

`InsetReporter` (in `Hud.tsx`) measures the bar, the picker, the tutorial card and the stats drawer, and writes `viewInset` (CSS px). The renderer frames the board in the free area. A MutationObserver on `#hud` re-measures whenever a card opens or closes or changes content.

## Theme

`data-theme="dark" | "light"` on `<html>`, from `state.ts` (saved choice, else `prefers-color-scheme`, else dark). Scene tokens (`--bg --board --trace --sub --die --pin --tile --dot --line --ink --mute --panel`), instruction colours (`--alu --mul --ld --st --br --on`), and UI (`--accent --ok --warn --bad`, `--ui --mono`) are defined in `ui.css` and read by the renderer.

## Tests

`npm test` runs the pure logic: `logic.test.ts` (formatting, stats, hints and toasts, HUD status text, queue readout, refusal wording, descriptions for every id the renderer writes), `picker.test.ts` (contents per id: empty socket, installed CPU, crate, keys, power after a trip, PSU, USB, cables, regions), `tutorial.test.ts` (steps from flags, resume mid-way, out-of-order actions, replay, migrated saves, step problems and targets, persisted state). Fixtures are in `testdata.ts`.

## Known gaps

- Keys, parts and cables are dragged in the world. Until the renderer's drag lands, the picker's Plug and Remove buttons are the only way to handle keys from the UI, and parts cannot be placed from the UI at all.
- The `highlight` pulse only does something once the renderer reads it.
- Hint gating while a tutorial step is active is covered by reading the code, not by a browser test.
- Narrow screens (below 760 px) stack the picker, the stats drawer and the tutorial card as bottom sheets. They can overlap; not tuned.
- The `Notice` text keeps the sim's own wording after the call name, so a reason with a colon reads a little stiffly ("Not now: No power: no PSU installed.").

## Renderer requirements

- Write `selected` on click, `null` on empty space (already done in `board.ts`).
- Read `highlight` and pulse each id (slot ids, device ids, `inv:<id>`, `cable.*`, `key:<id>`, `usb`, `power`, `monitor`, `psu`, `crate`, `tray`).
- Write `hover` with client pixel coordinates, so the tooltip follows the pointer.
- Optionally write `dragging` (`{kind, id}`) and clear it on drop.
