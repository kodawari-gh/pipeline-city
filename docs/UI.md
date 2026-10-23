# UI

Preact + signals, in `src/ui`. Reads the sim only through `src/game/store.ts` (`snapshot`, `purchase`, `setSpeed`, `setCpuClock`, `powerCycle`, `exportSave`, `importSave`, autosave offer) and `src/game/hover.ts`. Mounted by `src/main.tsx` into `#hud`, which is a full-screen `pointer-events: none` layer above the board canvas (`#board`); each panel re-enables pointer events.

## Files

- `logic.ts` (+ `logic.test.ts`): pure functions: formatting, `groupPurchases` (by kind, ready/poor/blocked + hover reason), stall/CPI/cache helpers, temperature and power levels, `clockWarning`, `HINTS` + `triggeredHints` / `newHints`, `describeId` (plain line + nerd line from `specs.ts`).
- `state.ts`: UI-only signals: `theme`, `panel` (shop/stats/none), `toasts`, `history` (per-tick retired/stall deltas for the sparkline). Theme and seen-hints are stored in localStorage inside try/catch.
- `Hud.tsx`: `InsetReporter` (publishes the area covered by the bar and the dock/drawer to the camera, see RENDER.md), top bar (money, tick, reputation + demand/min, queue with current request and a time-vs-deadline bar, speed, panel toggles, export/import, theme), the Continue/New game prompt, the dock that hosts Shop or Stats, and mounts the rest.
- `Shop.tsx`: CPU clock slider with a live thermal warning, power-cycle button when tripped, purchases by kind (including the motherboard upgrade).
- `Stats.tsx`: CPI/IPC, stalls by cause, cache, PSU load vs budget, per-device temperature bars (tick mark = throttle point) and clock/power, a sparkline of the last minute.
- `Hover.tsx`: `Tooltip` (follows `hover`) and `DevicePanel` (pinned for `selected`, with live temp/power/clock when installed).
- `Toasts.tsx`, `Meter.tsx`: dismissible hint toasts; the small bar (`role="meter"`, level shown by colour and by text).
- `ui.css`: all styles. Below 760 px the dock becomes a bottom drawer.

## Hover / selected contract

The renderer writes `hover` (`{id, x, y}` client pixels, or null) and `selected` (id or null). `id` is a spec id from `src/sim/board/specs.ts` (e.g. `cpu1`), a device instance id from the snapshot (`dev1`), or a board region id. `describeId` knows specs and the region `board`; an unknown id shows nothing (add regions to `REGIONS` in `logic.ts`). The UI closes the device panel by writing `selected = null`.

## Theme

`data-theme="dark" | "light"` on `<html>`, set by `state.ts` (saved choice, else `prefers-color-scheme`, else dark). CSS variables, defined on `:root` (light) and `:root[data-theme="dark"]` in `ui.css`:

Scene: `--bg --board --trace --sub --die --pin --tile --dot --line --ink --mute --panel` (same names and values as the legacy prototype).
Instruction colours: `--alu --mul --ld --st --br --on`.
UI: `--accent --ok --warn --bad`, fonts `--ui --mono`.

## Hints

Shown once each as a small dismissible toast, remembered in `localStorage['pipeline-city.hints']`. At most 2 are visible (bottom-left corner, away from the board centre); the rest wait in a queue (`fillToasts` in `logic.ts`) and appear when one is dismissed or auto-expires after 8 s:

| id | fires when |
|---|---|
| `stall` | any stall counter is above 0 |
| `throttle` | a working device has `throttle < 1` |
| `overheat` | a working device is `unstable` |
| `queue` | 3 or more requests waiting |
| `burnt` | a device is burnt |
| `trip` | the PSU has hard-tripped |
| `brownout` | PSU overloaded (`psuFactor < 1`) but not tripped |

No tutorial, no audio.
