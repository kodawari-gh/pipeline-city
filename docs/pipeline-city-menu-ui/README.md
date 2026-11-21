# Pipeline City: menu and in-game UI handoff

This folder is everything needed to implement the new menus and in-game UI of Pipeline City, a CPU-pipeline city builder, in its repo (`main` at `7f56e17`). The look is "Pipeline": a neon motherboard style where every screen is a stage of a CPU pipeline, navigation runs along PCB traces, and the focused item is a cyan instruction chip on the one lit trace. In game, the UI shrinks to small neutral tabs at the screen edges so the game stays visible.

You need only the repo and this folder.

## Scope
- **Menus, approved:** 01 Main menu, 02 Main menu without a save, 03 Loading, 04 New game, 05 Load confirm, 06 Settings.
- **Flow, approved:** 13 Flow diagram (a reference picture, nothing to build).
- **In-game, approved:** 07 Build my PC, 08 Gallery, 09 Controls, 10 Paused (the in-game menu), 11 First frame (tutorial), 12 HUD.

## Out of scope
- No gameplay changes. Speeds, prices, rules, tutorial steps and save format stay as they are.
- The HUD gets a re-skin and a new layout only: every control keeps its behaviour. Two things go: the pause pill (the speed rail shows the paused state) and the fps alarm colour in Settings.
- One behaviour change, decided by Khalil: opening the in-game menu pauses the game (SPEC §9).
- Shift-drag stays bound in the game; it just leaves the Controls list.
- No gamepad support.
- Other panels (Shop, Almanac, Log, OS, Trace, Stats, level-up, picker card) keep their current look.
- 3D content is not redesigned. Only the studio background, floor and rim-light colours and the Build camera framing change (IMPLEMENTATION.md step 7).

## Reading order
1. `README.md` (this file).
2. `SPEC.md`: what to build. §0 explains precedence, units and terms; read it first.
3. `mocks/`: the approved pictures. `mocks/SLOTS.md` lists the in-game v3 mocks still to arrive.
4. `IMPLEMENTATION.md`: where each screen lives in the code, what to replace, delete and add, the pause code, and a PR order.
5. `tokens.css`: drop-in design tokens and font faces.
6. `ACCEPTANCE.md`: the checks, per screen.
7. `KNOWN-ISSUES.md`: gaps and open points.

## Precedence
Mock PNGs win over the spec text. The spec text wins over the reference renders. `assets/geometry/*.json` is part of the mocks (their measured boxes).

## Folder
```
README.md            this file
SPEC.md              the spec
IMPLEMENTATION.md    code map and PR order
ACCEPTANCE.md        checklist
KNOWN-ISSUES.md      open points
tokens.css           tokens and @font-face, ready to drop in
mocks/               approved mocks (01-06, 13 now; 07-12 v3 slots in SLOTS.md)
assets/fonts/        IBM Plex WOFF2 files + LICENSE.txt (SIL OFL 1.1)
assets/geometry/     the mocks' measured boxes and trace polylines (JSON)
assets/mock-sources/ the HTML the menu mocks were rendered from (exact CSS values; open in a browser)
assets/ornament/     SVG sources: brackets, pin row, test point, ruler, edge tab, trace chamfer
reference/           lower-precedence material (see reference/README.md): r3 layout renders, before/after images,
                     the renderer source, the coverage script, the Build camera framing note
```
