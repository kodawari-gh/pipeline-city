# Acceptance checklist

Check every item with screenshots of the real game (`npm run shot -- out.png --size WxH`, plus `--prod` before a push), compared against `mocks/`. Where a v3 mock is not in `mocks/` yet, compare 07 to 12 against `reference/renders-r3/` for layout and against SPEC.md for numbers.

## 1. How to compare
- Capture at **1920 × 1080** (desktop reference) and **390 × 844** (phone reference), UI size 100 %, plus the extra sizes in §4. Desktop at device scale factor 1. The phone mocks are 1166 × 2376 (2.2× a 530 px wide layout). To compare 01 to 06 and 13 with the phone mocks, compare the rem numbers (SPEC §0.2), not pixels; the 390 × 844 check is by screenshot. For 01 to 06, use a game state matching the mock's sample data where you can (a save at Level 4 with $12,480 for 01; no save for 02).
- Overlay the mock at 50 % opacity (or diff it) and measure the boxes in SPEC Appendix A (01 to 06) and SPEC §5.7 to §5.12 (07 to 12). **Tolerance ±2 px** for position and size of every listed box, title line, tag, chip and lit-path vertex.
- Live 3D content (room, machine, part) will differ from the mocks' captured frames. Compare UI only; for the scene, check the framing rules (Build machine box, Gallery bracket box).
- Colour checks: sample pixels from the screenshot. Contrast: compute WCAG contrast between each text colour and the worst (lightest) backing pixel under it.

## 2. Every screen
- [ ] Copy matches SPEC exactly (case, punctuation, the three spaces between hint pairs, "·" separators, "–" in watt ranges, "×" in sizes).
- [ ] Only Plex fonts render (DevTools > Rendered fonts), weights 400, 500, 600.
- [ ] Only token colours in UI CSS for in-scope screens; no `backdrop-filter`, `box-shadow`, `text-shadow`; no radius above 4 px.
- [ ] **One lit path** per screen, from its source strip cell to the focused item (or the selected value on a focused branch). Count cyan regions: the lit trace plus at most one chip.
- [ ] **Cyan per screen** (SPEC §1 rule 2): 01 to 06 one chip and one lit path; 07 and 08 none at rest (cyan only on focus and its lit trace); 09 one chip on the stage tab; 10 one chip on the focused spine item; 11 one chip on "Next"; 12 none at rest. Any other cyan fails.
- [ ] **Selected is ink, focused is cyan** (SPEC §1 rule 3). Selected values are ink 600. HUD at rest (no keyboard focus, no hover): zero pixels within ΔE 10 of `#3be3ff`.
- [ ] Traces 2 px, 45° corners only, 8 px gaps around tags and values; spines end in a test point where SPEC says.
- [ ] Ornament only from K1 to K7, within the per-screen budget, 1 px graphite, never over text or the 3D subject.
- [ ] Text contrast ≥ 4.5:1 against the lightest pixel under it, except the text marked as an exception in SPEC §11.1. Every exception is listed there before the PR; none is accepted by default. Known open points are in KNOWN-ISSUES 13.
- [ ] On a coarse pointer (DevTools touch emulation), every target ≥ 48 × 48 CSS px (check with the element's box, including hit-area padding).
- [ ] Keyboard only: every action reachable; focus order and initial focus as SPEC §10; focus returns to the opener on close.
- [ ] Reduced motion (`prefers-reduced-motion: reduce`): no animation, no typing, end states at once.
- [ ] `scaling.test.ts`, `npm run typecheck` and touched tests green.

## 3. Per screen
### 01 Main menu
- [ ] Rows at desktop y 622 / 717 / 777 / 838 / 898, phone 752 / 840 / 896 / 952 / 1008; x 96 / 24.
- [ ] Wordmark, strip (cell 1 violet, no cyan cell) and lit path vertices as Appendix A.
- [ ] Build line shows the real short hash. No "Sandbox" row. No test point.
- [ ] `--scrim-menu` stops at 580 / 820 desktop.
### 02 Main menu, no save
- [ ] Hero "New game" + "Campaign or sandbox" at desktop y 682, phone 808. TP1 at the spine end (desktop).
### 03 Loading
- [ ] Build line "<stage> · <pct> %". Strip cells 2 to 5 turn ink at 20/40/60/80 %. Build my PC and Gallery disabled with "after loading". Before mount: void page and static wordmark only.
### 04 New game
- [ ] Opens on the last mode. Branch rows switch with ← →; meta lines change with the selection. WB "Replace save and start" with the warn meta when a save exists, "Start" without. Two clicks from 01 to a started game.
### 05 Load confirm
- [ ] Cancel focused on open. "Replace save and load" in bad red. Unreadable file → "[ no ]" toast, no confirm (SPEC §5.14).
### 06 Settings
- [ ] Opens on Quality. Five tabs. No fps colour. No Done button; changes apply at once. Hold to peek fades the whole layer. Back returns to the opener (main menu or Paused). In game: `--ramp-wide`, HUD paused.
### 07 Build my PC
- [ ] Desktop tabs at the SPEC §5.7 boxes. No navy pixels behind the machine (clear colour `#49484a`, no vignette).
- [ ] With the flyout open, the machine box (case, monitor, plates, base) lies inside x 375 to 1446, y 140 to 898. No tab overlaps it.
- [ ] **Coverage ≥ 75 %** unobstructed with the flyout open (method in §5); about 83 % with it closed.
- [ ] Flyout does not re-frame the camera during a drag.
- [ ] Run speeds 1x 4x 16x 64x; step speeds 0.5x to 4x behind "Steps"; views behind "View".
### 08 Gallery
- [ ] Stage flat `#111113` (sample 5 points outside the part: all within ±2 of 17,17,19). No navy.
- [ ] Count reads "75 parts" (live count, 17 groups; SPEC §5.8). The mocks' "64 parts" is an older count and does not fail the check.
- [ ] Drag pans, right-drag turns (pad.ts, shared with game and Build). Hints match.
- [ ] Part inside the K1 box with ≥ 40 px air. **Coverage ≥ 85 %** desktop.
### 09 Controls
- [ ] No "Shift-drag" row; Shift-drag still turns the view in game. Tabs Mouse, View, Game. Closing returns to Paused when opened from it. Coverage ≥ 60 % desktop.
### 10 Paused
- [ ] Opening stops the clock; "Pause" ink in the rail; no pause pill.
- [ ] Resume, Esc, "Menu" again, or a click on the scene right of the ramp restarts at the previous speed. A HUD speed click runs at that speed and closes Paused.
- [ ] Paused before opening → still paused after closing.
- [ ] **Pause** (player stop) and **Hold** (a popup or menu holder): a Hold ends when its popup closes. If the clock was running before Hold, it resumes at the same speed. Pause is kept until the player resumes it.
- [ ] Settings and Controls from Paused keep the clock stopped and return to Paused.
- [ ] All text ends before x 560 desktop. Coverage ≥ 60 % desktop.
### 11 First frame
- [ ] Staged HUD on step 1 only. Desktop instruction tab 0, 720, 700 × 360 with a 20 px chamfer top-right. Lit trace from "Next" into "Inventory 1". Coverage ≥ 84 % desktop.
### 12 HUD
- [ ] Four desktop tabs at the SPEC §5.12 boxes; phone top tab and dock.
- [ ] Speeds read Pause, 0.25x, 0.5x, 1x, 2x, 3x; Zoom slow toggles and persists (`localStorage`).
- [ ] Every control the HUD had still works (money tooltip, rep tooltip, power bill card, phase, net, OS, sandbox tools and jobs, levels, menu, every dock item, the network lens once ready, OS once installed).
- [ ] `InsetReporter` gets the new tab boxes: the board overview frames inside the free area.
- [ ] **Coverage ≥ 88 %** desktop, ≥ 80 % phone, Level 1 state with a toast.

## 3a. Error and empty states
- [ ] Each state in SPEC §5.14 renders with its toast or line, and nothing else changes. Items marked "proposed" need owner sign-off before they count as passed.

## 4. Responsive
At 1366 × 768, 1440 × 900, 2560 × 1440, 3440 × 1440, 390 × 844 (phone reference), 360 × 800, 412 × 915, 844 × 390 (landscape phone) and 820 × 1180, for 01, 04, 06, 07, 10 and 12:
- [ ] No overlaps (16 px minimum between elements); SPEC §6.4 collision steps applied in order.
- [ ] Phone layout at 390 × 844, 360 × 800, 412 × 915, 820 × 1180 and 844 × 390 (landscape: reflows, does not scale the 530 px numbers); content scrolls at 844 × 390 (SPEC §6.1, §6.5).
- [ ] Notched phone: nothing under the safe-area insets except tab fills.

## 5. Coverage method (in-game screens)
1. Take two screenshots of the same frame: with the UI, and with the UI hidden (add a dev-only `?noui` flag or toggle `#hud { visibility: hidden }` plus the studio overlays; pause the game so the frame matches).
2. A pixel is covered when it differs from the no-UI frame by more than 6 in any channel.
3. Dilate the covered mask by 12 px (so gaps inside text and between rail items count as covered).
4. Coverage % = 100 − covered %. Reference implementation: `python3 reference/coverage.py with-ui.png without-ui.png` (Pillow and NumPy). On the r3 renders it gives HUD 90.6 %, Build 78.5 %, Paused 61.3 %.
