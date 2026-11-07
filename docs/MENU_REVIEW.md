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
| Picker (board bubble) | reviewed 2026-11-07 | "3D view" button opens the shop on that part (`openShopAt`). Readings are icon chips with tooltips only; a first-time player may not know what "0.00x" means. |
| OS panel | done 2026-11-07 | Banner now says the machine is off instead of "nothing holds it back". Lower half stays empty while off. |
| Graphics panel | reviewed, no change | Preset row, grouped sections, one help line each. Side panel keeps the picture visible. |
| Main menu (`...`) | done 2026-11-07 | Help group, icons on every row, red New game. |
| Start menu / load screen | reviewed, no change | New game (Campaign/Sandbox) and the saved-game "Welcome back" (New game / Continue) are both clear. |
| Tutorial cards, hints | done 2026-11-07 | Dialogue card says "Click to continue". All 38 steps have a title and text, and no page is over 140 characters (`steps.test.ts`), so each fits the card. Hint toast readable. |
| Notices, toasts, modals | reviewed | Toast fine. New game asks for a second click when a game runs. |
| Power lens, Airflow lens | done 2026-11-07 | Airflow tags that would overlap now move up until clear (`AirflowLens.tags`). Power fine. |
| Almanac | reviewed, no change | Dense but ordered: list, card, code, tips. |
| Job log | done 2026-11-07 | Panel fits its content; the chip says "N finished" (it counted only ended jobs). |
| Levels, Stats, Trace | reviewed, no change | Stats rows lack degree signs ("25 C"); minor. |

## Shared patterns (from the shop)
- Rail + list + detail: three fixed zones; the detail pane is the hero (picture first, numbers below).
- 3D showcase (`shop/Showcase.tsx`, `core/render/three/viewer.ts`): drag turns, wheel zooms, double-click resets. Parts with no 3D model show their picture.
