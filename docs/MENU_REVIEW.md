# Menu review

A long-running pass over every menu. One menu per task. Look at the real screen (`npm run shot`), fix what confuses, record it here.

## Checklist (each menu)
1. Purpose: one sentence. Can a new player say what the menu is for in two seconds?
2. One primary action, clearly the strongest control.
3. Space: it uses the screen it needs, no more. No empty half, no clipped list.
4. Hierarchy: title, section label, tile, hint. Same tokens everywhere (`--fs-title`, `--fs-body`, `--fs-label`, `--r-tile`).
5. Labels: words over bare icons. Same word for the same thing in every menu.
6. States: owned, locked, too expensive, selected. One badge each, same look everywhere.
7. Keyboard: Esc closes (inner layer first), arrows move, focus returns.
8. Scaling: rem only, `scaling.test.ts` green. Check 1600x900 and a narrow screen (52em).
9. Screenshot looked at, dev and `--prod`.

## Status
| Menu | State | Notes |
|---|---|---|
| Shop | done 2026-11-07 | Full-screen, category rail with counts, 3D showcase over the stat bars, arrow keys. |
| Inventory shelf | done 2026-11-07 | Filter chips now carry words, not bare icons. Lock icons on tiles still have only a tooltip. |
| Picker (board bubble) | done, pass 2 | "3D view" button opens the shop on that part (`openShopAt`). Temperatures read "25 °C"; the speed chip reads "0.00x clock" (tooltip explains). |
| OS panel | done, pass 2 | Banner says the machine is off; a hint under the graph says how to start it, so the lower half is no longer empty. |
| Graphics panel | reviewed, no change | Preset row, grouped sections, one help line each. Side panel keeps the picture visible. |
| Main menu (`...`) | done 2026-11-07 | Help group, icons on every row, red New game. |
| Start menu / load screen | reviewed, no change | New game (Campaign/Sandbox) and the saved-game "Welcome back" (New game / Continue) are both clear. |
| Tutorial cards, hints | done, pass 2 | All 97 dialogue pages of the 38 steps were rendered in the real card at its real width (harness, 2026-11-07): heights 130-145 px, none overflows. The "Click to continue" cue had covered one-line pages; it now has its own row. `steps.test.ts` keeps the text short. |
| Notices, toasts, modals | reviewed | Toast fine. New game asks for a second click when a game runs. |
| Power lens, Airflow lens | done 2026-11-07 | Airflow tags that would overlap now move up until clear (`AirflowLens.tags`). Power fine. |
| Almanac | reviewed, no change | Dense but ordered: list, card, code, tips. |
| Job log | done 2026-11-07 | Panel fits its content; the chip says "N finished" (it counted only ended jobs). |
| Levels, Stats, Trace | done, pass 2 | Stats temperatures now carry the degree sign. |

## Passes
- Pass 1 (2026-11-07): every menu looked at in a 1600x900 screenshot; fixes as in the table.
- Pass 2 (2026-11-07): every menu shot again at 1600x900 and at 800x700 (shop, inventory, picker, OS, graphics, stats, trace, levels, almanac, job log, menu, new game, Power and Airflow lenses). Found and fixed: the graphics and stats side panels ran under the dock at 800x700 (`.dock` now ends above it); the OS tile list pushed the detail below the fold (tiles now wrap in two columns). The tutorial cards were rendered for all 97 pages of the 38 steps with their real titles in the real card at its real width: 130-145 px high, no title wraps, no page overflows.
- Checks run after pass 2: `npm run test:q` (246 files, 3471 tests pass, 4 skipped) and `npm run build` (ok) before the last CSS change; after it `npx vitest run src/core/ui` and `npm run build` again.
- Pass 3 (2026-11-07), after the review was challenged: the Airflow tag that ran off the screen at 800x700 (3D room) is fixed: `Lens3D` projects each tag's ends through the camera (`keepOnScreen`) and `AirflowLens.tags` slides it in; shot at 800x700 and the label "PSU CASE 30°C" is whole. The new-game dialog, the Campaign choice, the "Welcome back" dialog (with a real autosave) and the first tutorial card were shot at 800x700 and read: nothing clipped. In the real card at 800x700 I advanced through the "Welcome" pages to the first step that waits for the player (card 596 px wide, 126-141 px high, inside the screen); later steps need play and were checked only by the card-size test and the 1600x900 render. The showcase CPU now shows a die with core, cache and I/O tiles, capacitors and an open heat-spreader frame (plain geometry: the die view's floorplan is baked 2D art and is not shown). The "Welcome back" line now says "sandbox" instead of the sandbox money. The shop at 800x700 now has a shorter 3D view so the stat card shows under it; the CPU capacitors are visible in that shot.
- Pass 4 (2026-11-07, 3D default, 800x700): shot and read in the 3D room: inventory, shop, Power lens, almanac, job log, OS panel, menu, levels, graphics, stats. None clipped or overlapping. Also shot at 800x700 in 3D: the picker card (CPU) and the New game dialog from the menu; both fine. Tutorial at 800x700: the first 7 steps were read in the live card (15 pages). For all 37 steps with a card (94 pages, real titles and text) the text was put into the live card's DOM with its worst-case extras (a waiting line, the meter, Got it): every page fits on screen with no overflow (tallest 170 px, bottom at 437 of 700, clear of the shelf and the dock); the tallest page was shot and read. The injection is not live game state; the card's real step logic for steps 8 to 38 was not played. Checks after the 3D-default change: `npm run test:q` (246 files, 3471 pass, 4 skipped) and `npm run build` (ok).

## Shared patterns (from the shop)
- Rail + list + detail: three fixed zones; the detail pane is the hero (picture first, numbers below).
- 3D showcase (`shop/Showcase.tsx`, `core/render/three/viewer.ts`): drag turns, wheel zooms, double-click resets. Parts with no 3D model show their picture.
