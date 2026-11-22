# Pipeline City menus and in-game UI: implementation spec

Version: handoff r3, 2026-11-21. Approved by Khalil: menus 01 to 06 and flow 13 (09:43), in-game screens 07 to 12 with neutral darks (10:20).
Repo baseline: `main` at `7f56e17`. Where the code lives and what to change: `IMPLEMENTATION.md`. How to check your work: `ACCEPTANCE.md`.

## 0. How to read this spec

### 0.1 Precedence
1. **Mock PNGs in `mocks/` win.** If this text and a mock disagree on a position, size, colour or string, build the mock.
2. **This spec wins over the reference renders** in `reference/` (layout checks I drew myself, not mocks).
3. `assets/geometry/*.json` holds the mocks' own measured boxes and trace polylines for 01 to 06 and 13 (Appendix A prints them). Treat them as part of the mocks.
4. Where neither a mock nor this text says anything, follow the rules in §1 and the component definitions in §4, then list the case in your PR description.

The in-game mocks (07 to 12, v3) are in `mocks/` and win over §5.7 to §5.12 the same way.

### 0.2 Units
- Coordinates are CSS px at two reference viewports: **desktop 1920 × 1080** and **phone 390 × 844** (the layout reference; the phone mocks were drawn at a 530 px wide layout, and their numbers are kept as rem, see below). Origin top-left, before safe-area insets. Boxes are `x, y, w × h`.
- The repo forbids px in UI code (`src/core/ui/scaling.test.ts`). Convert: **desktop px ÷ 16.2 = rem**, **phone px ÷ 15 = rem**. The root rule in `ui.css` already makes 1rem exactly 16.2 px and 15 px at those viewports. Use a token from `tokens.css` where one exists.
- Allowed px: `1px` hairlines (ornament strokes) and values computed at runtime from measured boxes (the trace overlay).
- Tolerance: ±2 px at both references.
- Mock files: desktop PNGs are 1920 × 1080 (1:1). **Phone PNGs are 1166 × 2376, drawn at 2.2× a 530 px wide layout**: divide anything you measure on a phone mock by 2.2. The phone numbers in §5 and Appendix A are the mocks' measurements at that width, already converted to rem (px ÷ 15). Check the 390 × 844 layout by screenshot.

### 0.3 Terms
| Term | Meaning |
|---|---|
| Trace | A 2 px line with 45° corners, like a PCB track. Unlit `--c-trace`, lit `--c-accent` |
| Lit path | The single cyan trace on a screen, from its source (a strip cell) to the focused item |
| Spine | A vertical trace with items on it (a menu list) |
| Rail | A horizontal trace with items on it |
| Tag | A short Mono label on the trace in a fixed cell: IF, ID, EX, MEM, WB (pipeline stages), NOP, or a part opcode |
| Chip | A tag cell filled cyan with void-coloured text: the focused item. Never used for "selected" alone |
| Strip | Five small square cells after a display title, one per pipeline stage |
| Value branch | A row whose options sit on a short rail; replaces segmented controls |
| Edge tab | An in-game backing: a rectangle of `--c-shade-86` that touches a screen edge, with 45° chamfers on its free corners |
| Scrim | A menu-screen gradient of `--c-void` (01 to 06 only) |
| Ramp | An in-game gradient of `--c-shade-86` (Paused, Controls in game, phone tutorial) |
| Via | A 6 × 6 `--c-trace` square on a rail between groups |
| Free corner | A corner of an edge tab that does not touch a screen edge |

### 0.4 Scope
Screens 01 to 13 below. No gameplay change. The in-game HUD gets a re-skin and a layout change only: every control it has today stays, with the same behaviour, except the pause pill and the fps colour, which are removed.

---

## 1. Rules (apply everywhere)
1. **The motif rule.** The focused item is always the cyan chip on the lit trace. On a focused value branch, the lit trace ends at the selected value instead.
2. **One lit path per screen.** The only cyan is the focus chip and the lit trace it sits on. Spines and category rails keep the chip on their current item, even without focus (screens 01 to 06, Paused, Controls, First frame, Build's category rail and Gallery's category spine show one chip and one lit path). The HUD has no spine: at rest (no keyboard focus, no hover) it shows no cyan at all.
3. **Selected is ink, focused is cyan.** A selected value (speed, view, tab) is `--c-ink` weight 600. Only keyboard focus or pointer hover adds the chip.
4. **Display titles.** Sub-screen titles are uppercase Plex Sans Condensed 600 with line height 0.86, followed by the strip and a Mono meta line (§4.3).
5. **No boxes.** No borders, cards, plates, pills or rounded panels. Menu screens use one scrim; in-game screens use edge tabs and ramps. Radius 4 px on chips only.
6. **No glass.** No `backdrop-filter`, no `box-shadow`, no `text-shadow`, no glow, no gradients except the scrims and ramps in `tokens.css`.
7. **Neutral in game.** Nothing navy behind the 3D view: no `--c-void`, `--c-stage` or `--c-panel` on screens 07 to 12. Backings are `--c-shade-86`; the Gallery stage is `--c-studio`.
8. **Status colours colour text only** (ok, warn, bad). Violet is strip cell 1 only.
9. **Plex only**, weights 400, 500, 600. Numbers tabular (`font-variant-numeric: tabular-nums`).
10. **Ornament frames, never encloses.** 1 px, `--c-trace`, from the K1 to K7 kit only (§4.12), never over text or the 3D subject.
11. **Text only on a solid backing**: inside an edge tab, on the solid part of a scrim or ramp, or on `--c-studio`.
12. **Targets ≥ 48 × 48 CSS px on a coarse pointer. Text contrast ≥ 4.5:1.**
13. **Facts, not flavour.** Labels are plain words in sentence case. Mono meta lines carry the "hacker" voice and state facts ("Level 4 · $12,480 · saved 2 h ago").

---

## 2. Tokens
All values are in `tokens.css`, ready to drop in. Summary:

### 2.1 Colour
| Token | Hex | Where |
|---|---|---|
| `--c-void` | `#04060f` | Menu scrims (01 to 06), text on a cyan chip |
| `--c-raised` | `#0d1636` | Pressed text button on menu screens |
| `--c-trace` | `#4e5360` | Unlit traces, ornament, pads, unlit strip cells, vias |
| `--c-ink` | `#e2eaff` | Titles, focused and selected text |
| `--c-mute` | `#a6b4da` | Idle labels, meta, silkscreen, hints |
| `--c-accent` | `#3be3ff` | The chip and the lit trace only |
| `--c-brand` | `#a68bff` | Strip cell 1 only |
| `--c-ok` / `--c-warn` / `--c-bad` | `#6dffa6` / `#ffc247` / `#ff5a78` | Status text; bad also for destructive labels |
| `--c-shade` at `--a-shade` (`--c-shade-86`) | `#0a0a0c` at 86 % | In-game edge tabs and ramps |
| `--c-studio` | `#111113` | Gallery stage, phone Build letterbox |
| `--c-build-surround` | `#49484a` | Build 3D clear colour (§5.7) |
| `--c-panel`, `--c-stage`, `--c-line` | | Reserved. Do not use in game |
Menus 01 to 06 and 13 keep the navy-tinted `--c-void` scrims as approved. Do not retint them.

### 2.2 Type
| Token | Desktop / phone px | Font | Line height | Use |
|---|---|---|---|---|
| `--t-silk` | 11 / 11 | Mono 500, caps, tracking 0.04em | 1 | Silkscreen refs (K2) |
| `--t-xs` | 13 / 12 | Mono 500 | 1.35 | Tags, meta, hints |
| `--t-sm` | 15 / 14 | Sans 400 (body) or 500 (utility labels) | 1.45 | Body, utilities, speed rail |
| `--t-md` | 19 / 18 | Sans 600 (buttons) or Cond 600 (names) | 1.3 | Part names, dock, Menu |
| `--t-lg` | 26 / 24 | Cond 600 | 1.15 | Rows, values |
| `--t-xl` | 35 / 32 | Cond 600 | 1.1 | Desktop values, money, prices |
| `--t-2xl` | 43 / 40 | Cond 600 | 1.05 | Hero row label |
| `--t-display-sm` | 52 / 48 | Cond 600 caps | 0.86 | Studio titles desktop (Build, Gallery), part name |
| `--t-display-md` | 65 / 60 | Cond 600 caps | 0.86 | Welcome desktop, phone in-game titles |
| `--t-display` | 86 / 80 | Cond 600 caps | 0.86 | In-game titles desktop (Paused, Controls), phone menu titles |
| `--t-display-lg` | 108 / 100 | Cond 600 caps | 0.86 | Wordmark and menu titles desktop |
Display text is uppercased with `text-transform: uppercase`, tracking 0. Source strings stay in sentence case ("New game"), so screen readers read words, not letters.

### 2.3 Space, edges, layers, motion
- Spacing `--s1` to `--s6` = 4.3, 8.6, 13, 17.3, 25.9, 34.6 px desktop (rem 0.267 to 2.133). Row height `--h-row` 52 / 48, hero `--h-hero` 86 / 80.
- Screen edges: menu screens x 96 desktop, 24 phone. In-game content x 32 inside edge tabs desktop (x 64 for the Paused and Controls stack), 16 to 24 phone.
- Layers (z-index): scene 0, scrim 10, HUD 20, ornament 22, trace 25, menu 30, dialog 50, toast 60, boot 70.
- Motion: ease `cubic-bezier(0.2, 0, 0, 1)`; fast 120 ms, med 160 ms, trace 240 ms, flash 80 ms.

---

## 3. Fonts
- Files in `assets/fonts/`: `IBMPlexSansCondensed-SemiBold.woff2` (600), `IBMPlexSans-Regular.woff2` (400), `IBMPlexSans-Medium.woff2` (500), `IBMPlexSans-SemiBold.woff2` (600), `IBMPlexMono-Medium.woff2` (500). Total 344 KB with the licence.
- Licence: SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`). Ship `LICENSE.txt` next to the fonts in the repo. The OFL allows bundling with a game; it forbids selling the fonts on their own and renaming modified versions with the reserved name "Plex". We ship them unmodified.
- Loading: self-hosted, `font-display: swap` (declared in `tokens.css`). Preload Condensed 600 and Mono 500 (they draw the wordmark and every tag): see `IMPLEMENTATION.md` step 2. No webfont CDN.
- Remove `system-ui`, `Segoe UI`, `ui-monospace`, `Cascadia Mono`, `Consolas` from the UI fonts (`--ui`, `--mono` in `ui.css` point to the Plex families).

---

## 4. Components

States everywhere: default, hover and keyboard focus (the same look), pressed, disabled, selected. No hover effect on `(hover: none)` devices.

### 4.1 Trace
- 2 px stroke (`--trace-w`), square ends, no glow. Unlit `--c-trace`, lit `--c-accent`.
- Corners are 45° chamfers only. A standard chamfer moves 24 px on each axis (`--trace-leg`; see `assets/ornament/trace-chamfer.svg`). Straight runs are at least 8 px. An offset under 6 px is drawn straight (no chamfer).
- Gap of 8 px (`--trace-gap`) on both sides of every tag, chip and branch value: the trace stops 8 px before the item and resumes 8 px after it.
- Via 6 × 6 square; idle pad 8 × 8 square; both `--c-trace`.
- Traces are drawn by one SVG overlay per screen that reads the live boxes of strip cells, tags, values and targets, and redraws on focus change, value change, resize and font load. Stroke width in that SVG is `Math.max(2, Math.round(0.125 * rem))` user units (px), so it stays crisp.

### 4.2 Stage tag and chip
- Tag: `--t-xs` Mono 500 `--c-mute`, centred in a cell of 43 × 26 desktop, 2.67 × 1.6 rem phone, centred on the spine.
- Names: IF, ID, EX, MEM, WB (pipeline stages, top to bottom); NOP for "do nothing" (Cancel); opcodes for part types (§4.9).
- Focus: the cell fills `--c-accent`, radius 4 px, text `--c-void` (contrast 13.1:1). This is the chip.
- Pressed: label 1 px down for 80 ms.
- Disabled: 1 px dashed `--c-trace` outline on the cell, text at 60 % opacity, the reason in the row's meta ("after loading").
- `chip-s` (16 × 24, no text) and the 8 × 8 idle pad mark items on secondary spines.

### 4.3 Display title, strip and meta
- Title text: `--t-display-lg` on desktop menu screens at x 96, top 112. Smaller sizes where each screen says. Uppercase; may wrap to two lines ("LOAD THIS / GAME?", "BUILD / MY PC") where the screen says.
- Strip: 5 square cells, 15 × 15 with 6.5 gap desktop, 0.93 rem with 0.4 rem gap phone. Bottom-aligned 10 px above the last title line's baseline, `--s4` after the last word. Cell 1 `--c-brand`. The cell of the stage you came from is `--c-accent` (IF 1, ID 2, EX 3, MEM 4, WB 5). Other cells `--c-trace`. On Loading, finished boot stages turn `--c-ink` (§5.3).
- Meta: `--t-xs` Mono `--c-mute`, `--s4` under the title. Pattern "STAGE · screen · fact", for example "ID · new game · last played: campaign".
- The lit trace leaves the lit cell (or cell 1 if none is lit) downward, runs to 16 px under the meta, chamfers to the spine column and runs down to the focused item.
- One component renders the wordmark (01 to 03) and every display title, with props: lines, size, lit cell index (or none), meta.

### 4.4 Spine and rows
- A spine is a vertical trace with tags. The primary spine is lit from the source to the focus. Below the focus it is `--c-trace` and ends in a test point (K5) 20 px under the last tag, labelled "TP1" ("TP2" on a secondary spine). Secondary spines (lists of parts) are never lit.
- Rows:

| Variant | Height | Label | Meta |
|---|---|---|---|
| Hero | 86 / 80 | `--t-2xl` ink | second line `--t-xs` Mono mute |
| Normal | 52 / 48 | `--t-lg` | inline after the label, `--s3` gap |
| Utility | 52 / 48 | `--t-sm` Sans 500, several targets 34.6 px apart | none |
| Branch | 52 / 48 | a value branch (§4.5) | Mono line under it, describing the selected value |
- Label colour: idle `--c-mute`, focus or selected `--c-ink`, hero always ink, destructive `--c-bad`. The whole row width is the hit area (504 px on menu screens at both references; Appendix A).
- Label x: 165 desktop (tag cell at x 96 + 43 + gaps), 5.87 rem phone. See Appendix A.

### 4.5 Value branch
- The options sit on a horizontal trace that leaves the row's tag (or label). Values `--t-xl` desktop, `--t-lg` phone, Cond 600. Gap between values `--s4` + 16 px, with a 2 px `--c-trace` segment in each gap.
- Selected value `--c-ink`; others `--c-mute`.
- On the focused row, the trace from the tag to the selected value is lit; it is the last leg of the lit path.
- ← → changes the value. Tap or click a value to pick it. Hit area: the value's width × 48.
- Phone: if a branch would pass x 33.73 rem, stack it under its label (indented to x 7.87 rem).

### 4.6 Rail and stage tabs
- A rail is a spine turned 90°: items on a horizontal 2 px trace with 8 px gaps.
- Stage tabs (Settings, Controls): a tag cell on the trace with its label (`--t-lg`, phone `--t-md`) 8 px under it, centred. Selected tab: chip on its tag, label ink. Pitch: tag width + 90 px desktop, + 3.4 rem phone.
- In-game rails (HUD, Build) put text items 24 to 26 px apart with a trace segment between items and a via between groups.

### 4.7 Buttons
- Primary: none on menu screens (commit actions are WB hero rows). In game, "Benchmark" is `--t-md` Cond ink text, not a chip.
- Text button: `--t-sm` Sans 500 `--c-mute`; focus ink with a 1 px cyan underline; pressed background `--c-raised` on menus, none in game.
- Back: "← Back" plus Mono "Esc" (desktop only), top-left. Positions per screen.

### 4.8 Speed rail (HUD)
- Items: "Pause" then one per speed from `SPEEDS` excluding 0, labelled with `speedLabel` (campaign: 0.25x, 0.5x, 1x, 2x, 3x). Do not hard-code labels.
- `--t-sm` Sans 500. Current state ink 600 (while paused, "Pause" is ink and the last run speed is mute). No chip unless focused by keyboard.
- Then a via, then "Zoom slow" + value "ON" / "OFF" (ink when on, mute when off), the existing `toggleZoomSlow`.
- Hit areas 48 px tall.
- Phone: "Pause" and the current speed only; tapping the speed steps to the next speed and wraps. Zoom slow moves into Paused → Tools.

### 4.9 Opcode tags for part types
CS case, MB board, CPU processor, CL cooling, FAN fan, RAD radiator, RAM memory (Gallery) / MEM memory (Build), PSU power, MON monitor, SSD drive, VRM VRM sink, RSK RAM sink, NET network, GPU graphics, AI AI card, SEC secure, ALL all parts. Tags are `aria-hidden`; the visible or hidden label carries the meaning.

### 4.10 Toast
A Mono line with no plate: "[ ok ]" / "[ !! ]" / "[ no ]" in the status colour, message `--c-ink`, "Dismiss" `--c-mute` (a text button). Menu screens: x 48, y 100 desktop; x 16, y 140 phone (on the solid scrim). In game: inside the HUD top-left tab (§5.12). One at a time, 6 s, `aria-live="polite"`.

### 4.11 Edge tab (in game)
- Fill `--c-shade-86`. It must touch at least one screen edge. No border, no radius, no blur.
- Each free corner gets a 45° chamfer via `clip-path`: 14 px (`--ch`) on small tabs, 20 px (`--ch-lg`) on large tabs (the tutorial block), 10 to 14 px on phone. Corners on a screen edge stay square. Example: `assets/ornament/edge-tab-chamfers.svg`.
- Default content inset: text starts 32 px (desktop) or 16 px (phone) from the screen edge the tab touches. The positions given per screen in §5 override this default.
- Width is the content plus the inset on each side; never wider than content + 32 px padding.

### 4.12 Ornament kit (K1 to K7)
Defaults: 1 px stroke `--c-trace`; text `--c-mute`; `aria-hidden`; never interactive; never over text or the 3D subject; never encloses content on all four sides. SVG sources: `assets/ornament/`.

| # | Element | Geometry | Where allowed |
|---|---|---|---|
| K1 | Corner brackets + pin 1 | Four L corners, arms 24 px desktop / 16 phone, 1 px. Optional pin-1 square 4 × 4, inset 4 px at the top-left | Around the 3D subject in Gallery only |
| K2 | Silkscreen ref | `--t-silk`, caps: "U3 · CASE · MID TOWER", "J1", "TP1" | Next to K1 (top-left, outside), at the dock's left end, at test points. At most 3 per screen |
| K3 | Pin row | 4 × 4 squares on an 8 px pitch, one square missing | Divider between info groups. Replaces hairlines |
| K4 | Chamfer | 45° cut on a corner | Edge tabs (§4.11) |
| K5 | Test point | Ring radius 4, 1 px, at the end of a 20 px `--c-trace` 2 px stub, K2 label 8 px right | End of every spine |
| K6 | Parallel bus | 3 lines 1 px, 4 px apart | Reserved. Do not use |
| K7 | Tick ruler | Ticks 1 px every 8 px, 4 px tall; majors 8 px tall every 80 px (40 phone) | Under the Gallery subject |
Budget per screen: one K1 set, three K2, two K3, one K7, one K5 per spine.

### 4.13 Scrims (menus) and ramps (in game)
Exact gradients are in `tokens.css`. Positions on the 1080-tall references:

| Name | Desktop (horizontal, from the left edge) | Phone (vertical) | Screens |
|---|---|---|---|
| `--scrim-menu` | `--c-void` 88 % from x 0 to 580, 0 % at 820 | 0 % at y 400, 88 % from y 580 to the bottom | 01, 02, 03, 05 |
| `--scrim-wide` | 88 % from x 0 to 760, 0 % at 1000 | 0 % at y 140, 88 % from y 300 | 04, 06 |
| `--veil-loading` | flat `--c-void` 55 % under `--scrim-menu` | same | 03 |
| `--ramp-pause` | `--c-shade` 86 % from x 0 to 560, 0 % at 680 | 0 % at y 470, 86 % from y 536 | 09 and 10 in game |
| `--ramp-tutorial` | none (desktop uses an edge tab) | 0 % at y 640, 86 % from y 700 | 11 phone |
| `--ramp-wide` | `--c-shade` 86 % with the `--scrim-wide` stops | same as `--scrim-wide` | 04 and 06 opened inside a game (§5.6a) |
| Studio stage | flat `--c-studio`, no ramp | same | 08 |
Phone gradients are anchored to the bottom edge (they are written bottom-up in `tokens.css`), because phone content is bottom-anchored (§6.3). The stops above are where they fall on a 1080 px phone.
Between two stops the opacity is linear. Linear gradients in sRGB, no easing.

---

## 5. Screens

Each screen lists: backdrop, surface (scrim, ramp or edge tabs), elements with copy and position at both references, and behaviour. Exact boxes for 01 to 06 and 13 are in Appendix A. Copy in quotes is exact; *(sample)* marks live data shown with sample values, with the source named.

Live data used on several screens:
- Save summary: `saveSummary()` (`logic.ts:557`) extended to include money: "Level 4 · $12,480 · saved 2 h ago" (sandbox saves: "Sandbox · saved 2 h ago").
- Build line: "build " + the short git hash of the build (`__BUILD__`, IMPLEMENTATION.md step 3).
- Saved builds count: "3 saved builds" (`n saved builds`, "1 saved build", or "no saved builds"). Gallery count: "75 parts" (the live count of parts in the Gallery list: 17 groups, the case and board tiers, then one group per kind, see `galleryGroups()` in `shopdata.ts`). The mocks show "64 parts"; that is an older count and the live value wins.

### 5.1 Main menu (`01-main-menu-v2-desktop.png`, `-phone.png`)
- Backdrop: the live room behind the main menu, as today. Surface: `--scrim-menu`.
- Wordmark "PIPELINE" / "CITY" on two lines, `--t-display-lg` (108 / 100) ink; strip after "CITY": cell 1 violet, cells 2 to 5 graphite, no cyan cell. The lit trace leaves the bottom of cell 1 (desktop x 447, y 281) and runs to the IF chip (Appendix A gives the polyline). Build line Mono `--t-xs` mute under the wordmark: "build 7f56e17" *(sample)*.
- Spine, desktop x 96, phone x 1.6 rem (rows 504 px wide on desktop, 33.6 rem on phone):

| Tag | Row | Copy | Desktop y | Phone y |
|---|---|---|---|---|
| IF (focused) | Hero | "Continue" + meta save summary | 622 | 50.13 |
| ID | Normal | "New game" + "campaign · sandbox" | 717 | 56 |
| EX | Normal | "Build my PC" + saved builds count | 777 | 59.73 |
| MEM | Normal | "Gallery" + Gallery count | 838 | 63.47 |
| WB | Utility | "Load file"  "Settings" | 898 | 67.2 |
- Hints (desktop only) Mono `--t-xs` mute at x 165, y 967: "↑ ↓ move   Enter open   Esc back" (three spaces between pairs).
- No test point on 01 (the approved mock has none).
- Wordmark on phone: glyph boxes from y 34.2 rem ("PIPELINE") and 38.8 rem ("CITY"), build line at y 45.67 rem (Appendix A).
- Behaviour: "Continue" resumes the autosave. "New game" opens 04. "Build my PC" opens 07, "Gallery" opens 08, "Load file" opens the file picker then 05, "Settings" opens 06. The current "Sandbox" row is removed (Sandbox lives in New game).

### 5.2 Main menu, no save (`02-main-menu-nosave-v2-*`)
Same as 01 without "Continue":
| Tag | Row | Copy | Desktop y | Phone y |
|---|---|---|---|---|
| IF (focused) | Hero | "New game" + "Campaign or sandbox" | 682 | 808 |
| ID | Normal | "Build my PC" + saved builds count | 777 | see App. A |
| EX | Normal | "Gallery" + Gallery count | 838 | see App. A |
| MEM | Utility | "Load file"  "Settings" | 898 | see App. A |
Test point rule: the spine ends in K5 "TP1" on desktop only, as on this screen's mock. Phone screens show no test point.

### 5.3 Loading (`03-loading-v2-*`)
- Shown while the 3D world boots (before `booted`). Backdrop: the boot still as today. Surfaces: `--veil-loading` then `--scrim-menu`.
- Wordmark as 01. The build line becomes the boot status: `<stage label> · <pct> %`, for example "Lighting the room · 62 %" (labels from `bootStage()` calls, then "Ready").
- Strip: cell n (2 to 5) turns `--c-ink` when the boot share ≥ (n − 1) × 0.2. At 62 %, cells 2, 3 and 4 are ink. Cell 1 stays violet.
- Rows as 01 (or 02 when there is no save). "Build my PC" and "Gallery" are disabled bubbles (§4.2) with the meta "after loading". Test point rule: desktop only, as on 02 (the spine ends in K5 "TP1"). Phone shows none.
- No progress bar, no bottom bar. `index.html` shows only the `--c-void` page and the static wordmark (same position and size as 01) before the app mounts.

### 5.4 New game (`04-new-game-v2-*`)
- Backdrop: the live room. Surface: `--scrim-wide`. Opens on the last mode played.

| Element | Copy | Desktop | Phone |
|---|---|---|---|
| Back | "← Back" + "Esc" | x 96, y 40 | x 1.6, y 27.33 |
| Title | "New game", strip cell 2 lit | x 96, top 112, `--t-display-lg` | x 1.6, top 31.33, `--t-display` |
| Meta | "ID · new game · last played: campaign" *(sample: last mode)* | under the title | under the title |
| IF branch row (focused) | "Campaign" ━ "Sandbox", lit to the selected value | y 709 | y 55.6 |
| Meta under IF | Campaign: "Bare board · starter crate · $600 · earn every part". Sandbox: "Unlimited money · every part unlocked · slots, watts and heat still count" | | |
| ID branch row | Campaign: "Tutorial" "On" ━ "Off". Sandbox: "Start with" "Assembled" ━ "Bare board" | y 783 | y 60.13 |
| WB hero | "Replace save and start" (no save: "Start") | y 843 | y 63.87 |
| Warn meta | "Overwrites your autosave: Level 4 · $12,480" in `--c-warn` (only when a save exists) | under WB | under WB |
| Hints | "↑ ↓ stage   ← → value   Enter start   Esc back" | x 165, y 967 | none |
- Behaviour: WB starts the game at once (Loading if the world is not ready, then First frame). There is no extra confirm: "New game" on 01 plus WB is the agreed 2 clicks, and the warn meta names what is replaced. Esc or Back returns to the opener.

### 5.5 Load confirm (`05-load-confirm-v2-*`)
- Opened after the file picker returns a readable file. Surface `--scrim-menu`.
- Title "Load this" / "game?" (two lines), strip cell 5 lit, meta "WB · load file · replaces your autosave".
- Facts, Mono `--t-xs`, label ink, value mute: "SAVE  Level 4 · $12,480 · saved 2 h ago" and "FILE  Level 7 · $88,200" *(sample)* at x 165, y 560 desktop (phone x 5.87 rem, y 42.67 rem). With no autosave, the SAVE line reads "SAVE  none".
- Spine: NOP "Cancel" + meta "keep your save" (focused; desktop y 803, phone 920); WB hero "Replace save and load" in `--c-bad` (desktop y 864, phone 65.07 rem). "TP1".
- Hints "↑ ↓ choose   Enter confirm   Esc cancel".
- Unreadable file: no confirm; a toast "[ no ]" with the existing `friendlyError` text.

### 5.6 Settings (`06-settings-v2-*`)
- Surface `--scrim-wide`. Opens on the Quality tab. Same screen from the main menu and from Paused (Back returns to the opener).
- Back; title "Settings", strip cell 5 lit; meta "WB · settings · kept on this device, not in the save".
- Stage tabs (§4.6), desktop rail at x 144, y 520; phone x 4.27 rem, y 33.33 rem: IF "Quality" (selected), ID "Display", EX "Light", MEM "Detail", WB "Interface". The lit trace runs from strip cell 5 down, left, and into the IF tag from above.
- Quality tab: a secondary spine from the Quality tag (unlit), desktop x 146 from y 620; phone x 4.4 rem from y 38.93 rem:
  - "Preset" + branch "Low" ━ "Medium" ━ "High" ━ "Ultra" (desktop inline; phone stacked under the label at x 7.87 rem). Meta: the selected preset's `PRESET_INFO` text ("Fastest. No shadows or glow." / "Balanced. Soft light and glow." / "The look the game is made for." / "Sharpest. Needs a strong GPU.").
  - "Device" + branch "Auto" ━ "Low" ━ "Medium" ━ "High". Meta: `tierNote()` ("Auto picked Low: software rendering." *(sample)*).
  - Idle pad, then Mono "NOW  1 fps · 1016.6 ms · 1440 × 810" *(sample: live frame stats)*. Plain mute; no fps colour.
  - "TP2".
- Display tab: the rows the code has today, each as a branch row or slider: "Render scale" (slider), "Frame limit" (branch from `FPS_ROW`), "Brightness" (slider), "Auto-adjust" ("Off" ━ "On").
- Light and Detail tabs: one branch row per entry of the code's `LIGHT` and `DETAIL` lists, label and options as in the code.
- Interface tab: "UI size" slider, 80 % to 150 % (`UI_SCALE_MIN`, `UI_SCALE_MAX`).
- Slider: a 2 px trace; the part from the start to the value is ink at rest and cyan when the row is focused; thumb 12 × 24 radius 4, ink at rest, cyan when focused; value Mono `--t-xs` ink after the trace ("100 %").
- Foot (desktop y 898, phone 67.2 rem): text buttons "Hold to peek" and "Reset to defaults". No Done button: every change applies at once; Back or Esc leaves.
- "Hold to peek": while held (pointer down, or Space or Enter held on it), the whole Settings layer including the scrim fades to 0 opacity in 120 ms, and returns on release.
- Hints: "← → category   ↑ ↓ option   Space peek   Esc back".

### 5.6a Menu screens opened inside a game
Settings (from Paused) and New game (from Paused → Files) open over the paused game, not the title room. They keep the layout of 06 and 04 exactly, with two changes: the surface is `--ramp-wide` (`--c-shade` at 86 % with the same stops as `--scrim-wide`; rule 7: no navy over the game), and the HUD tabs stay visible in their paused state. Back returns to Paused.

### 5.7 to 5.12 In-game screens: shared rules
- Backdrop: the live game (room, board or studio). Nothing navy over or behind it (§1 rule 7).
- Surfaces: edge tabs (§4.11) and, for Paused, Controls in game and the phone tutorial, one ramp (§4.13).
- Cyan: none at rest. The chip appears only on the keyboard-focused or hovered item, and the one lit path on screens that have a focus (Paused, Controls, First frame, Build's category rail, Gallery's category spine).
- Older layout renders, superseded by the v3 mocks: `reference/renders-r3/NN-*-{desktop,phone}.png`. Before and after: `reference/before-after/`.
- Coverage targets (share of the screen where the scene is not covered or dimmed, measured as in `ACCEPTANCE.md` §3): HUD desktop ≥ 88 %, Build desktop ≥ 75 % with the flyout open.

### 5.7 Build my PC (`07-build-my-pc-v3-*`)
**Scene.** The Build 3D stage, reframed so the machine is bigger (IMPLEMENTATION.md step 7). With the flyout open, the machine (case, monitor, wall plates, base) fits inside x 375 to 1446, y 140 to 898 at 1920 × 1080. The 3D clear colour is `--c-build-surround` `#49484a` (neutral; it replaces `#0e1118`). No DOM scrim, no vignette, no glass.

**Desktop**
| Element | Box | Content |
|---|---|---|
| Top-left tab | 0, 0, 440 × 150; chamfer bottom-right 20 | "← Back" + "Esc" at 32, 2. Title "Build my PC" `--t-display-sm` (52) caps at 32, top 52, one line, strip cell 3 lit. Meta two lines Mono: "EX · ready to start" ("ready to start" in `--c-ok`; other states use the readout's status text, `BuildBars.tsx:25`) / "$53,180 · 58–263 W / 1000 W · 29 parts" *(sample: budget, idle to full watts over supply, part count)* |
| Category rail tab | 0, 150, 96 × 802; no chamfers (it continues the top-left tab down the left edge) | Opcode tags only, at x 26 from y 178, 42 px pitch (48 on a coarse pointer): ALL, CS, MB, CPU, CL, FAN, RAD, MEM, PSU, SSD, GPU. The lit trace runs from strip cell 3 down to the selected category's chip (CS). Hover or focus on a tag shows its name ("Case") in the flyout header |
| Flyout tab | 96, 214, 300 × 262; chamfers top-right and bottom-right 14 | Header at 116, 224: category name `--t-md` Cond ink ("Case") + Mono "3 fit this board" *(sample)*. Parts from 116, 278, rows 62 tall: still 64 × 45, name `--t-md` Cond (ink for the picked one, else mute), Mono "T2 · $160". Height grows with the list (bottom at most y 940, then the list scrolls). Top = the selected tag's top − 6 px (CS → 214) |
| Top-right tab | 1400, 0, 520 × 64; chamfer bottom-left 14 | Lens rail at x 1432, items 16 px apart, `--t-sm`: "Power" ━ "Airflow" ━ "Graphics" (on = ink 600; Graphics opens Settings at Quality). "Benchmark" `--t-md` Cond ink at x 1690 + Mono "score —" (or "Score 1,240", "Running 3/8") |
| Machine list tab (collapsed) | 1700, 140, 220 × 88; chamfers top-left and bottom-left 14 | "In the machine" `--t-md` Cond ink at 1724, 150; Mono "29 parts · $53,180  ‹". Click or Enter opens the full list (today's `BuildMachine` content: parts in the machine, "Start from…") as a tab from the right edge, 380 wide, y 140 to 940; "›" collapses it |
| Run tab | 0, 1016, 600 × 64; chamfer top-right 14 | Rail at x 24, items 24 px apart: "Power on" `--t-md` Cond ink ▪ "OS Multicore 4.0" *(sample)* ▪ "1x" ━ "4x" ━ "16x" ━ "64x" (run speeds from `RUN_SPEEDS`; current ink 600) |
| Hint tab | 640, 1040, 540 × 40; chamfers top-left and top-right 10 | Mono centred at y 1052: the current hint ("Click the side panel to reach the parts inside."). "Skip", "Undo" or "Dismiss" text buttons at its right end when the hint offers them. Hidden when there is no hint |
| Tools tab | 1220, 1016, 700 × 64; chamfer top-left 14 | Rail at x 1244, items 24 px apart: "Side panel" + Mono "SHUT" / "OPEN" ▪ "Undo" ━ "Redo" ▪ "Steps" + Mono "1x" ▪ "View" + Mono "ANGLE" ━ "Focus". "Steps" opens an upward branch 0.5x 1x 2x 4x; "View" opens Front, Angle, Side, Top, Wall |
| Part card, tooltip, drag ghost, toasts | as today, restyled to edge tabs or Mono lines | The part card opens as an edge tab from the right edge (x 1500 to 1920), below the machine list tab |
No K1 brackets and no silkscreen on Build.
Flyout state: open while the pointer is over the rail or flyout, while a rail tag or flyout item has keyboard focus, or during a drag from it; closes 400 ms after none holds. Collapsed, only the rail shows (coverage about 83 %).

**Phone**
- Scene: the Build stage fills the screen; the camera frames the machine inside y 100 to 800 (between the two tabs). Letterbox and clear colour `#49484a`.
- Top tab 0, 0, 35.33 × 6.67 rem: "← Back" at 1.07, 0; "Benchmark" `--t-md` Cond ink at right 1.07, top 0.53; title "Build my PC" `--t-xl`-size caps (32) at 1.07, top 3.07 rem, strip cell 3 lit; Mono "EX · ready · $53,180 · 29 parts" ("ready" in ok green).
- Bottom tab 0, 53.33, 35.33 × 18.67 rem:
  - Category rail at 1.07, 53.73 rem, items 0.8 rem apart: opcode tags; the selected one is a chip followed by its name `--t-md` Cond ink ("CS Case"). Swipe to scroll.
  - Parts row at 1.07, 57.73 rem: cards 10 rem wide, 1.07 rem apart: still 6.4 × 4.47 rem, name `--t-md` Cond (ink if picked), Mono "T2 · $160". Swipe to scroll.
  - Bar at 1.07, 68.27 rem, items 1.87 rem apart, `--t-md` Cond: "Parts" ━ "Machine" ━ "Run" (selected ink, no chip). "Machine" shows the machine list in this tab; "Run" shows the run rail, step speed and view.

### 5.8 Gallery (`08-gallery-v3-*`)
**Scene.** The Gallery turntable (`Showcase.tsx`, `viewer.ts`) on flat `--c-studio`: the CSS backdrop and the 3D floor and background are neutral (IMPLEMENTATION.md step 7). The part is framed inside the K1 bracket box via the viewer's stage insets.

**Desktop**
- Back at 32, 2: "← Back" + "Esc". Title "Gallery" `--t-display-sm` (52) at 32, top 52, strip cell 4 lit; meta "MEM · gallery · 75 parts" (live count).
- Category spine at x 32 from y 190, rows 39 (48 coarse), 240 wide: opcode tag, name `--t-md` Cond (ink if selected, else mute), Mono count. Categories in the Gallery's order *(sample: CS Case 4, MB Board 4, CPU Processor 6, CL Cooling 3, FAN Fan 3, RAD Radiator 2, RAM Memory 5, PSU Power 4, MON Monitor 3, SSD Drive 4, VRM VRM sink 2, RSK RAM sink 2, NET Network 3, GPU Graphics 5, AI AI card 2, SEC Secure 2)*. Lit from strip cell 4 to the selected category's chip. No TP on this spine (it runs to the bottom).
- K1 brackets 380, 140, 1120 × 760 with pin 1. Silk "U3 · CASE · MID TOWER" at 380, 124: "U" + the part's 1-based position in its category, the kind, the part name, in caps *(sample)*. Silk "3 / 4" right-aligned inside the bottom-right corner at y 882. K7 ruler at 380, 910, 1120 wide. Viewer insets: the part fits inside the bracket box with at least 40 px air.
- Right column x 1560, top 150, 330 wide: K3 pin row; Mono "CS · case · tier 2"; part name `--t-display-sm` (52) caps ("Mid tower"); detail `--t-md` mute ("ATX case"); price `--t-xl` Cond ink ("$160"); then the part's numbers (`GalleryPart` stats) as Mono rows, label caps mute left, value ink right ("BIGGEST BOARD … ATX", "MEMORY SLOTS IT CAN HOLD … 4").
- Shelf at x 1560, top 520: the category's parts, rows 62 tall, still 64 × 45, name `--t-md` Cond (ink for the shown one), Mono "T2 · $160".
- Hints Mono at 380, 1000: "Drag pan · Right-drag turn · Scroll zoom · Double-click reset · ← → part · ↑ ↓ category · Esc back".

**Phone**
- "← Back" at 1.07, 0; Mono meta "MEM · gallery · 75 parts" right-aligned at right 1.07, top 1.07 rem. No display title (the part name is the title).
- K1 brackets 0.8, 3.73, 33.73 × 34.67 rem (arms 1.07) with pin 1; silk "U3 · CASE" at 1.07, 38.8 rem. Viewer insets frame the part inside.
- At 1.07, 40.67 rem, 33.2 rem wide: Mono "CS · case · tier 2 · ATX case"; then on one line the name `--t-display-sm` (48) caps left and the price `--t-xl` ink right.
- Category rail at 1.07, 47.07 rem: tags, the selected one a chip + name. Shelf at 1.07, 51.33 rem: cards 7.47 rem wide, 0.8 rem apart, still 6.4 × 4.47 rem, name, Mono price. K3 + numbers at 1.07, 62 rem. Hints at 1.07, 69.33 rem: "Drag to pan · Pinch to zoom · Swipe the shelf".

### 5.9 Controls (`09-controls-v3-*`)
Opened from Paused → "Controls" or the "?" key. In game it uses the Paused frame (HUD paused, `--ramp-pause`). From the main menu, there is no entry; "?" works only in game, as today.

**Desktop**
- Back at x 64, y 112: "← Back" + "Esc". Title "Controls" `--t-display` (86) at x 64, top 190, strip cell 4 lit; meta "MEM · controls · keyboard and mouse".
- Stage tabs at x 64, y 372, pitch tag + 96: IF "Mouse" (selected, chip), ID "View", EX "Game". The lit trace runs from strip cell 4 into the IF tag.
- List at x 64, y 470, 480 wide: a K3 pin row, 14 px gap, then rows 44 px tall: key Mono `--t-md` ink in a 132 px column, action `--t-sm` Sans mute.
  - Mouse: "Drag" Pan the view; "Right-drag" Turn the view; "Scroll" Zoom in or out at the pointer; "Click" Pick a part and open its card; "Drag a part" From the shelf onto the board to fit it. (No "Shift-drag" row; the binding itself stays.)
  - View: "F" Zoom to the processor; "G" Zoom to the graphics card; "B" Zoom to the board; "R or Home" Back to the whole room; "O" Open or close the side panel.
  - Game: "Space" Pause or resume; "P" Power lens; "A" Airflow lens; "N" Network lens; "Esc" Close what is open, or open the menu; "?" This list.
- Hints at x 64, y 1000: "← → group   Esc or ? back".

**Phone**: Back at x 1.6, y 36 rem; title "Controls" `--t-display-md` (60) at x 1.6, top 40.27 rem, strip cell 4 lit; meta "MEM · controls · touch". K3 pin row at y 50.67 rem, then rows 3.2 rem tall: label `--t-lg` Cond ink (9.47 rem column), action `--t-sm` mute: "Drag" Pan the view; "Pinch" Zoom in or out; "Tap a part" Pick it and open its card; "Drag a part" From the shelf onto the board to fit it. No tabs, no lit path.

Closing Controls (Back, Esc, "?") returns to Paused when opened from Paused, else to the game.

### 5.10 Paused (`10-pause-menu-v3-*`)
Opening the in-game menu (Esc or "Menu") pauses the game (§9). Same HUD tabs as 5.12, with "Pause" ink and "Menu" ink; the dock tab is hidden. Surface `--ramp-pause`.

**Desktop**
- Title "Paused" `--t-display` (86) at x 64, top 300; strip with no lit cell (cell 1 violet, others graphite). Meta: "Clock stopped at 2 s · resumes at 1x" *(sample: game time and `lastRunSpeed` label)*.
- Spine at x 64, 520 wide, bottom-anchored with its last row's bottom 150 px above the screen bottom (rows start about y 520):

| Tag | Row | Copy |
|---|---|---|
| IF (focused) | Hero | "Resume" + meta "at 1x" *(sample: speed label)* |
| ID | Normal | "Save now" + "saved 10 s ago" *(sample: time since last save; while saving "saving…"; after a manual save "saved just now")* |
| EX | Normal | "Settings" (opens 06 over the game, §9) |
| MEM | Normal | "Controls" (opens 09) |
| WB | Normal | "Main menu" + "saves first" |
| (short tag, idle pad) | Utility | "Files"  "Tools"  "Help" |
Then "TP1". The lit path runs from strip cell 1 to the IF chip.
- Utilities open a short value-branch style list to the right of the label on the same row (desktop) or a stacked list under it (phone); ↑ ↓ moves within it, Esc closes it:
  - Files: "Export game", "Import game", "New game" (`--c-bad`, opens 04).
  - Tools: "Stats", "Trace", "Levels" (with today's toggled labels, for example "Hide stats"); on phone also "Zoom slow ON/OFF" and the HUD segments that moved here (power bill, phase, net, OS).
  - Help: "Replay tutorial", "Skip tutorial" (only while the tutorial runs), "Show hints again".
  - Every item keeps today's action and title text (`Hud.tsx:228-295`).
- Hints Mono at x 64, y 1000: "↑ ↓ move   Enter open   Esc resume".
- All text ends before x 560 (the ramp's solid part).

**Phone**: title "Paused" `--t-display-md` (60) at x 1.6, top 36.53 rem; meta "Clock stopped at 2 s" (short, so the lit trace does not cross it). Spine at x 1.6, 32.13 rem wide, bottom 2.67 rem. No hints.

Today's "UI size" slider in the menu moves to Settings → Interface. "Graphics" becomes "Settings".

### 5.11 First frame (`11-first-frame-v3-*`)
The first moment of a new campaign with the tutorial on, and every tutorial popup step after it (the tutorial card, `TutorialCard.tsx`).
- Staged HUD: top-left tab 420 × 84 with "$600" only; top-right tab 150 × 64 with "Menu" only; dock tab 150 × 56 centred with "Inventory 1" only (chamfers top-left and top-right). The staged state lasts while the tutorial's first step is open; later steps show the full HUD.

**Desktop**
- Instruction tab 0, 720, 700 × 360, chamfer top-right 20.
- Mono `--t-xs` mute at 48, 752: "IF · tutorial · step 1 · new instruction" *(sample: step number)*; "Skip tutorial" text button right-aligned to x 648 on the same line.
- Title "Welcome" `--t-display-md` (65), 16 px under the meta.
- Body `--t-md` Sans ink, line height 1.4, 600 wide, 16 px under the title: the step's text ("Welcome to Pipeline City! This tiny workshop is yours now. Clients will bring you jobs on little USB sticks called keys.").
- Action at 48, 984: IF chip + "Next" `--t-lg` Cond ink (the chip shows because "Next" has focus on open).
- Lit path: from "Next" right along y 1000, then 45° down into the dock item the step is about ("Inventory 1").

**Phone**: `--ramp-tutorial`. Block at x 1.6, top 47.73 rem, 32.13 rem wide: Mono "IF · tutorial · step 1" + "Skip tutorial" right-aligned; "Welcome" `--t-display-sm` (48), 0.8 rem under; body `--t-sm` ink, 0.8 rem under. IF chip + "Next" at 1.6, 61.47 rem. Lit trace straight down from the chip into "Inventory 1" (dock tab 10 × 4.27 rem at bottom-left, chamfer top-right).

Steps with a different target draw the lit trace to that control. Steps whose target is in the 3D scene (not a HUD control) draw no trace.

### 5.12 HUD (`12-hud-v3-*`)
Shown while playing. No ramp. Keep every control and behaviour the HUD has today (`Hud.tsx:327-395`, `Inventory.tsx:121-133`); only the look and layout change.

**Desktop**
| Element | Box | Content |
|---|---|---|
| Top-left tab | 0, 0, 420 × 84 (112 with a toast); chamfer bottom-right 14 | Money `--t-xl` Cond ink at 32, 12: "$600" *(sample; "∞" in sandbox)*. Meta Mono `--t-xs` mute at 32, 54: "2 s · rep 1.00 · power $0 · machine off" *(sample)*. Segments in order: game time; "rep " + reputation (2 decimals); "power " + the power bill; "machine " + the phase chip's text in lower case ("machine off", "machine running"), coloured by the chip's status level (ok, warn, bad) or mute when it has none; then "net …" (only when the network chip exists today) and "OS 2/4" (only when an OS is installed). Each segment keeps today's action and tooltip (power opens the bill card, net and OS open their panels, rep and phase show their tooltips) and gets a 48 px tall hit area. Toast line at 32, 80: "[ ok ] Saved.  Dismiss" (§4.10) |
| Sandbox group (sandbox only) | a second line in the same tab at 32, 80; the toast line moves to 32, 108; the tab grows to 112 (140 with a toast) | A "SANDBOX" chip (`SandboxTools`; its popover holds the 64x speed, labelled "Run at 16x") and a "LEVEL n · JOBS" chip (`SandboxJobs`), `--t-sm` Sans 500 mute |
| Top-centre tab | x 770, 0, 380 × 72 (centred: left = 50 % − 190); chamfers bottom-left and bottom-right 14 | Line 1 centred, `--t-md` Cond ink: "Level 1 · Garage Bench" (level number and name). Line 2 centred, 6 px under: progress cells + Mono `--t-xs` mute label. Not shown in sandbox (today's rule). Click opens the levels (today's action) |
| Top-right tab | x 1260, 0, 660 × 64; chamfer bottom-left 14 | Speed rail (§4.8) starting at x 1288, items 26 px apart: "Pause" ━ "0.25x" ━ "0.5x" ━ "1x" ━ "2x" ━ "3x", via, "Zoom slow" + Mono "ON". "Menu" `--t-md` Cond at right 32, top 18: mute, ink while the menu is open. When the zoom slowdown is active (`zoomSlowdown < 0.97`), a Mono `--t-xs` mute line inside the tab under the rail: "slow motion 40 % · zoom out for full pace" *(sample: percentage)*; the tab grows to 88 tall |
| Dock tab | centred, 860 × 56 at y 1024; chamfers top-left and top-right 14 | Rail centred, items 26 px apart, `--t-md` Cond mute: "Inventory 1" ━ "Shop" ▪ "Power" ━ "Airflow" ▪ "Almanac" ━ "Job log" (▪ = via). "Network" joins after "Airflow" once the network lens is ready; "OS" joins after "Job log" once an OS is installed; the tab widens to fit. "Inventory" carries its count ("Inventory 1"). The open panel or active lens is ink 600. Silk "J1" at x (tab left + 18), y 1062 |
| Notice, toasts, tutorial card, inventory panel | as today in the stack, restyled to edge tabs | The inventory panel opens above the dock as an edge tab touching the bottom edge |
No pause pill: the paused state shows as "Pause" ink in the rail (and the Paused screen).

Level progress cells: `levelBar(s)` gives `pct` and `label` (client base "0 / 3"). Draw N cells of 11 × 11 with a 5 px gap, where N = the level's next threshold if it is 10 or less, else 10. Fill round(pct / 100 × N) cells `--c-ink`, the rest `--c-trace`. The label is Mono `label` followed by " clients" ("0 / 3 clients"); at the top level, `label` alone. The v3 desktop mocks show "0 / 3 clients"; phone shows "0 / 3" with no word. The r3 reference renders still say "goals" and are superseded on this point.

**Phone**
| Element | Box | Content |
|---|---|---|
| Top tab | 0, 0, 35.33 × 6.4 rem, no chamfers (it spans both edges) | Row 1: "$600" `--t-lg` Cond ink at 1.07, 0.8 rem; Mono "2 s · rep 1.00" at 5.87, 1.33 rem; speed "Pause" ━ "1x" at x 20 rem (tap the speed to step to the next, wrapping); "Menu" `--t-md` Cond at right 1.07, top 0.93 rem. Row 2 at y 3.87 rem: "Level 1 · Garage Bench" `--t-md` Cond ink, then the progress cells and Mono label without " clients" ("0 / 3"). Power, phase, net and OS segments move into Paused → Tools as text rows (same actions) |
| Toast tab | 0, 6.4 rem, 19.33 × 2.27 rem; chamfer bottom-right 0.67 rem | "[ ok ] Saved.  Dismiss" Mono at 1.07, 6.93 rem |
| Dock tab | 0, 67.73 rem, 35.33 × 4.27 rem | Rail at x 1.07 rem, items 0.93 rem apart: "Inventory 1" ━ "Shop" ▪ "Lens" ▪ "Almanac" ━ "Log" (+ "OS" when installed). "Lens" opens an upward branch with "Power", "Airflow" and (once ready) "Network"; while a lens is on, "Lens" reads its name in ink ("Power") |


### 5.13 Flow diagram (`13-flow-diagram-v2-desktop.png`, desktop only)
A design document, not a game screen. Nothing to implement; use it to check the flow in §7.

---

### 5.14 Error, empty and offline states
Proposed in this package, not in the mocks. Check each with the owner before the PR.
- Save file unreadable: no confirm; toast "[ no ]" with the existing `friendlyError` text (§5.5).
- Save file incompatible (readable, but from another version): no confirm; toast "[ no ]" with the existing `friendlyError` text. Home: the Load-confirm toast pattern (§5.5).
- Save or export failed: the save on disk is not changed; toast "[ no ]" with the existing `friendlyError` text. Home: the Load-confirm toast pattern (§5.5).
- No save: "Continue" is absent (02). With no autosave, the Continue meta reads "SAVE  none" (§5.5).
- Empty shelf for a kind: one Mono line in mute, "none yet". Wording to confirm.
- Boot failure: no design yet. The Loading screen (03) keeps its build line; the failure text and its actions are open (KNOWN-ISSUES 12).
- Offline: the menus work. The only network state is the NET chip in the HUD. Verify during the work (KNOWN-ISSUES 12).
- Crash panel and starting screen keep their current wording; only their surfaces change.

### 5.15 Not covered by this package
- Audio: no audio design is in scope. Sounds, music and volume keep their current behaviour and controls.
- Existing features that keep their behaviour: save and load, autosave, speed, pause, tutorial steps, Build run, Gallery stills, Controls bindings, Settings persistence.

Where each existing feature lives now, and where its new layout is specified. "Add" means the feature has no row or text in the named section yet; add it there before the PR.

| Feature | Current home (file or screen) | New home (spec section) |
|---|---|---|
| Controls: Double-click row, touch list | `src/core/ui/panels/Controls.tsx` (Double-click row; TOUCH list) | §5.9 Controls (Double-click: add row) |
| Build part kinds (every kind) | `src/features/board/ui/BuildMode.tsx` (KINDS from `STUDIO_KINDS` and `NET_KINDS`) | §4.9 opcode tags; §5.7 Build (kinds: add) |
| Gallery Router (last in `STUDIO_KINDS` order) | `src/features/economy/ui/shop/shopdata.ts`, `GalleryHud.tsx` | §5.8 Gallery (add) |
| Gallery stepper | `src/features/economy/ui/shop/GalleryHud.tsx` (`GalleryFoot`) | §5.8 Gallery (add) |
| Gallery Spin, Reset | `src/features/economy/ui/shop/Showcase.tsx` | §5.8 Gallery (add) |
| Gallery stat bars | `src/features/economy/ui/shop/GalleryHud.tsx` (`bld-bar`) | §5.8 Gallery, stats rows (add bar form) |
| Build Benchmark | `src/features/board/ui/BuildBench.tsx` | §5.7 top-right tab, "Benchmark" |
| Build OS sheet | `src/features/board/ui/BuildOs.tsx` | §5.7 Tools tab (add) |
| Saved builds | `src/features/board/ui/BuildStart.tsx`, `savedbuilds.ts` (key `pipeline-city.builds`) | §5.1 "Build my PC" count; §5.7 (add) |
| Build alerts | `src/features/board/ui/BuildAlerts.tsx` | §5.7 toasts row (add) |
| Network sheet | `src/features/board/ui/BuildNet.tsx` | §5.7 Lens rail or Tools (add) |
| Settings | `src/core/ui/panels/MainMenu.tsx` (`SettingsCard`), `src/core/ui/panels/Graphics.tsx` | §5.6 Settings |
| Pause | `src/core/ui/Hud.tsx` (`PauseKey`, pause pill, removed) | §5.10 Paused; §0.4 |
| Speed rail | `src/core/ui/Hud.tsx` (`speedctl`) | §4.8 speed rail; §5.12 top tab |
| Previous save | No code yet (glossary term, ADR 0001) | Add to §5.5 Load confirm (new) |

## 6. Responsive rules

Only the two reference sizes are mocked. Everything else follows these rules. Check at least 1366 × 768, 1440 × 900, 2560 × 1440, 3440 × 1440, 390 × 844 (phone reference), 360 × 800, 412 × 915, 844 × 390 (landscape phone) and 820 × 1180 (`ACCEPTANCE.md` §4).

### 6.1 Which layout
- **Phone layout** when `(max-width: 48em), (max-aspect-ratio: 3/4)` matches (48em = 768 CSS px; media-query em is always 16 px). This covers phones in portrait and portrait tablets.
- **Desktop layout** otherwise, including phones in landscape (§6.5).
- Use the same media query in CSS and in TS (`matchMedia`); never branch on user agent.

### 6.2 Scale
- The root rule (`ui.css`, unchanged) sets 1rem = `clamp(15px, min(0.85vw, 1.5vmin), 64px)` × UI size. Every length in this spec is in rem, so the whole layout scales with it.
- 16:9 desktops from 1765 × 993 up scale exactly like the reference (2560 × 1440 = 1.333×, 4K = 2×).
- Wider than 16:9 (ultrawide): rem follows the height; anchored elements stay on their edges and the extra width goes to the scene in the middle.
- Narrower than 16:9 (16:10, 4:3): rem follows the width; the extra height goes to the scene.
- Below 1765 px wide or 1000 px tall, rem stops at 15 px, so the layout is wider in screen terms than the reference: §6.4 handles collisions.

### 6.3 Anchoring
Every element is anchored to the screen edge(s) it is nearest to in the reference, and keeps its distance to that edge in rem:
- Desktop menus (01 to 06): the content column is anchored left (x 96) and top for titles. Rows, hints and foot are anchored to the bottom (distance from the bottom = 1080 − y − h at the reference). The scrim is anchored left.
- Desktop in game: each edge tab is anchored to the edges it touches. Centred tabs (HUD top-centre, dock, Build hint) use `left: 50%` and `translate: -50%`. The Paused and Controls stack is anchored left; Paused rows anchor to the bottom, its title anchors to the bottom of the rows (fixed gap as in the reference), not to the top.
- Phone: one bottom-anchored stack per screen, in the reference order with the reference gaps. Top tabs (HUD, Build) anchor to the top. Full-width tabs stretch to 100 % width; inner content keeps its left inset and right-aligned items keep their right inset.
- Safe areas: add `env(safe-area-inset-*)` to every edge distance and to every edge tab's padding on that side (the tab's fill extends under the inset to the screen edge).

### 6.4 Collisions (desktop, small screens)
When two elements would come closer than 16 px (1rem), apply these steps in order until they no longer collide:
1. HUD: the top-centre level tab moves under the top-left tab (top = top-left tab bottom + 8 px, left 0, chamfer bottom-right only).
2. HUD: the Mono meta segments in the top-left tab wrap to a second line.
3. Build: the hint tab moves up to sit on top of the run tab (left 0), chamfer top-right only.
4. Build: the tools tab folds "Undo" ━ "Redo" into the "Steps"-style branch "Edit" (opens Undo, Redo).
5. Build: the flyout overlaps the scene (it is already a tab; no change) and the machine list tab stays collapsed.
6. Menus: if the title would wrap to three lines or the rows would overlap the title, step the title down one display size; if still colliding, the content column scrolls (no scrollbar shown, wheel and keys scroll focus into view).
7. Paused and Controls: if the spine or list would overlap the title, the title steps down one size, then the stack scrolls.
The Paused and Controls ramp keeps its rem stops; text never extends past the ramp's solid part.

### 6.5 Short screens (height under 600 px, landscape phones)
- Desktop layout with rem 15 px. HUD tabs keep their sizes; the dock stays at the bottom.
- Menus, Paused, Controls and Settings: the content column scrolls; the title steps down to `--t-display-sm`.
- First frame: the instruction tab shrinks to its content height, anchored to the bottom.
- Build and Gallery: the flyout and the right column scroll inside their tabs.

### 6.6 UI size
The player's UI size (80 % to 150 %) multiplies rem. At 150 % on a 1366 × 768 screen §6.4 applies. Rows keep at least 48 px on a coarse pointer at every UI size.

---

## 7. Flow
Agreed and unchanged: Settings opens on Quality; Sandbox lives in New game; starting over a save takes 2 clicks from the main menu; loading a file over a save takes a confirm with Cancel focused; no fps alarm. The in-game menu pauses the game.
```
Main menu ─ Continue ──────────────────────────────► Game
          ├ New game ─► New game ─ WB start ─► (Loading) ─► First frame ─► Game
          ├ Build my PC ─► Build my PC ─ Back ─► Main menu
          ├ Gallery ─► Gallery ─ Back ─► Main menu
          ├ Load file ─► file picker ─► Load confirm (WB) ─► Game
          └ Settings ─► Settings (IF Quality) ─ Back ─► Main menu
Game ─ Esc / Menu ─► Paused ─┬ Resume (previous speed)
                             ├ Save now (stays in Paused)
                             ├ Settings ─► Settings ─ Back ─► Paused
                             ├ Controls ─► Controls ─ Back ─► Paused
                             ├ Main menu (saves first, then leaves)
                             └ Files / Tools / Help ─► item ─► (closes Paused unless the item says otherwise)
```
Items under Files, Tools and Help that open a panel (Stats, Trace, Levels, Import) close the menu family and resume the clock as §9 says. "Export game" and "Show hints again" act and stay in Paused.

---

## 8. Motion: the trace extends
Every screen change reads as the trace growing from where you were to where you are going.
| Moment | What moves | Timing |
|---|---|---|
| Focus moves on a spine or rail | The chip slides to the new tag; the lit trace grows or shrinks with it | 120 ms, `--ease` |
| Value changes in a branch | The lit leg retracts to the tag and extends to the new value; values swap ink and mute | 120 ms |
| Main menu → sub-screen | 1) the chosen row's chip flashes once (80 ms); 2) the lit trace runs from the chip back up the spine to the matching strip cell, which turns cyan; 3) the wordmark cross-fades into the display title in the same box (160 ms), strip and scrim stay put; 4) the new lit trace draws from that cell to the new focus (240 ms); rows fade in 40 ms apart behind the trace head | about 480 ms total |
| Sub-screen → back | The reverse: the trace retracts into the cell, the title cross-fades back to the wordmark, the cell returns to graphite | about 360 ms |
| Commit (WB) | The WB chip fills, the lit trace runs to the screen edge, then the next screen starts | 240 ms |
| Studio enter (Build, Gallery) | Title and spine as above; Gallery K1 brackets draw corner by corner (60 ms each); the 3D subject fades in | 160 ms |
| Pause open | The speed rail's ink moves to "Pause"; the clock stops; the ramp fades in; title and spine draw from cell 1 | 160 ms |
| Resume | The reverse; ink moves back to the previous speed as the clock restarts | 120 ms |
| Tutorial step | The Mono meta types in (20 ms per character, capped at 300 ms), the title fades in, then the lit trace draws from "Next" to the target | 240 ms |
| Build flyout | Opens with a 120 ms slide from the rail (transform only); closes the same | 120 ms |
| Loading | Strip cells turn ink one per boot stage | instant |
`prefers-reduced-motion: reduce`: every duration is 0, no typing, no drawing; end states appear at once (`tokens.css` sets the durations to 0). The 3D camera never moves for a menu change. Animate `opacity`, `transform` and SVG `stroke-dashoffset` only.

---

## 9. Pause behaviour (in-game menu)
1. Opening Paused (Esc when nothing else takes Esc, or "Menu") stops the game clock: if the speed is not 0, pause and remember that the menu paused it.
2. Closing the menu family resumes at the speed it had before (`lastRunSpeed`), but only if the menu paused it and no popup (level-up, tutorial) holds the pause. If the player had paused before opening, it stays paused.
3. The menu family is Paused plus Settings and Controls opened from it. Moving between them does not resume. Back from Settings or Controls returns to Paused with focus on the row that opened it.
4. Ways to close the family: "Resume", Esc on Paused, "Menu" again, a click on the scene to the right of the ramp, choosing a speed in the HUD rail (runs at the chosen speed), or an item that opens a game panel (Stats, Trace, Levels, Import).
5. "Main menu" saves, then leaves (`leaveGame`); no resume.
6. "Save now" saves and stays; its meta reads "saved just now".
7. The HUD rail shows "Pause" in ink while paused. There is no pause pill. Screen readers hear "Paused. Clock stopped." on open.
8. Space (pause toggle) is ignored while Paused is open; Esc closes it.

---

## 10. Input and focus
| Action | Keyboard | Mouse | Touch |
|---|---|---|---|
| Move focus | ↑ ↓ on spines, ← → on rails and tabs | hover moves the chip | none |
| Change a value | ← → on a branch row | click a value | tap a value |
| Activate | Enter, Space | click | tap |
| Back, cancel | Esc | Back link | Back link, system back |
| First, last | Home, End | | |
| Settings category | ← → on the tab rail | click a tab | tap a tab |
| Build category and part | ↑ ↓ on the rail, → into the flyout, ← back | click | tap, swipe |
| Studio camera | | drag pan, right-drag turn, scroll zoom (Shift-drag also turns) | drag pans, pinch zooms |
| Game camera | F, G, B, R or Home | drag pan, right-drag turn, scroll zoom | drag pans, pinch zooms |
| Peek (Settings) | hold Space on "Hold to peek" | press and hold | press and hold |
| Pause menu | Esc toggles | "Menu" | "Menu" |
| Pause toggle | Space (not while a menu is open) | "Pause" in the rail | "Pause" |
- Focus order: Back, then the primary spine top to bottom (each branch's values on ← →), then secondary content, then utilities.
- Initial focus: IF on menus and New game; NOP "Cancel" on Load confirm; the IF "Quality" tab on Settings; IF "Resume" on Paused; "Next" on a tutorial step; nothing on the HUD.
- Focus returns to the opener when a screen closes.
- Focus ring: the chip (on tagged items) or ink text with a 1 px cyan underline (text buttons, HUD items). Never the browser default outline; `:focus-visible` only.
- Hover = focus look on `(hover: hover)` devices only.
- Coarse pointer (`pointer: coarse`): every target at least 48 × 48 CSS px (rows of 39 to 44 px grow to 48; the Build rail pitch grows from 42 to 48).
- No gamepad at launch: no gamepad prompts or bindings.

---

## 11. Accessibility
### 11.1 Contrast (minimum 4.5:1 for all text; measured on the worst pixel under each surface)
| Surface | ink | mute | cyan | warn | bad | ok | violet |
|---|---|---|---|---|---|---|---|
| Menu scrim, desktop / phone | 14.0 / 14.3 | 8.1 / 8.3 | 10.9 / 11.1 | 10.4 / 10.7 | 5.6 / 5.7 | 13.2 / 13.5 | 6.2 / 6.3 |
| Wide scrim, desktop / phone | 13.8 / 14.0 | 8.1 / 8.1 | 10.8 / 10.9 | 10.4 / 10.4 | 5.5 / 5.6 | 13.1 / 13.2 | 6.1 / 6.2 |
| Loading | 15.7 | 9.1 | 12.2 | 11.7 | 6.3 | 14.8 | 7.0 |
| In-game edge tab or ramp (86 % `#0a0a0c`), over pure white | 11.5 | 6.7 | 9.0 | 8.6 | 4.6 | 10.9 | 5.1 |
| `--c-studio` `#111113` | 15.7 | 9.1 | 12.2 | 11.7 | 6.3 | 14.8 | 7.0 |
Void text on a cyan chip: 13.1:1. Silkscreen (`--c-mute`, 11 px) passes as mute. Graphite trace and ornament measure 2.0 to 2.6:1 and are decoration only, never information.
Text placed on the scene without a tab or ramp is not allowed.

### 11.2 Semantics
- Spines: `role="menu"` with `menuitem` children. Value branches: `radiogroup` / `radio`. Tab rails: `tablist` / `tab`. Load confirm: `role="dialog" aria-modal="true"`. Toasts: `aria-live="polite"`.
- Tags, opcodes, strip cells, traces and ornament: `aria-hidden="true"`.
- Disabled bubbles: `aria-disabled="true"` with the reason in the accessible name ("Build my PC, after loading").
- HUD: a `toolbar` for the speed rail and one for the dock; each HUD segment button keeps today's `aria-label` and `title`.
- On Paused open, announce "Paused. Clock stopped." (`role="status"`).

### 11.3 Scaling and zoom
UI size 80 % to 150 % scales rem. Browser zoom works the same way. Display titles step down one size rather than wrap to three lines.

---
## Appendix A. Boxes measured on the approved mocks (01 to 06, 13)

Generated from `assets/geometry/*.json`, which Asset Maker's renderer wrote while drawing the mocks, so these numbers are the mocks' own. CSS px at 1920 × 1080 (desktop). Phone values are rem (px ÷ 15) at 390 × 844, converted from the mocks' 530 px wide layout. Origin top-left, before safe-area insets. Row boxes are hit areas. Lit path = the cyan trace polyline, point by point.

#### 01-main-menu-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| row IF Continue (hero, focused) | 96 | 622 | 504 | 86 |
| row ID New game | 96 | 717 | 504 | 52 |
| row EX Build my PC | 96 | 777 | 504 | 52 |
| row MEM Gallery | 96 | 837 | 504 | 52 |
| row WB Load file · Settings | 96 | 898 | 504 | 52 |
| text "wordmark PIPELINE" | 96 | 87 | 449 | 141 |
| text "wordmark CITY" | 96 | 180 | 224 | 141 |
| text "build line" | 96 | 315 | 104 | 17 |
| text "Continue" | 165 | 624 | 163 | 56 |
| text "Continue meta" | 165 | 686 | 264 | 17 |
| text "IF (on chip)" | 110 | 644 | 16 | 17 |
| text "lab1" | 165 | 726 | 115 | 34 |
| text "meta1" | 293 | 740 | 144 | 17 |
| text "tag1" | 110 | 734 | 16 | 17 |
| text "lab2" | 165 | 786 | 134 | 34 |
| text "meta2" | 312 | 800 | 112 | 17 |
| text "tag2" | 110 | 794 | 16 | 17 |
| text "lab3" | 165 | 846 | 79 | 34 |
| text "meta3" | 257 | 860 | 64 | 17 |
| text "tag3" | 106 | 854 | 24 | 17 |
| text "WB" | 110 | 915 | 16 | 17 |
| text "Load file" | 165 | 914 | 58 | 19 |
| text "Settings" | 258 | 914 | 55 | 19 |
| text "key hints" | 165 | 967 | 256 | 17 |

Lit path: (447, 281) → (447, 325) → (423, 349) → (141, 349) → (117, 373) → (117, 632)

#### 01-main-menu-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| row IF Continue (hero, focused) | 1.6 | 50.13 | 33.6 | 5.33 |
| row ID New game | 1.6 | 56 | 33.6 | 3.2 |
| row EX Build my PC | 1.6 | 59.73 | 33.6 | 3.2 |
| row MEM Gallery | 1.6 | 63.47 | 33.6 | 3.2 |
| row WB Load file · Settings | 1.6 | 67.2 | 33.6 | 3.2 |
| text "wordmark PIPELINE" | 1.6 | 34.2 | 22.27 | 6.93 |
| text "wordmark CITY" | 1.6 | 38.8 | 11 | 6.93 |
| text "build line" | 1.6 | 45.67 | 6.07 | 1 |
| text "Continue" | 5.87 | 50.33 | 9.93 | 3.47 |
| text "Continue meta" | 5.87 | 54.13 | 15.4 | 1 |
| text "IF (on chip)" | 2.47 | 51.47 | 0.93 | 1 |
| text "lab1" | 5.87 | 56.53 | 7.07 | 2.13 |
| text "meta1" | 13.73 | 57.4 | 8.4 | 1 |
| text "tag1" | 2.47 | 57.07 | 0.93 | 1 |
| text "lab2" | 5.87 | 60.27 | 8.07 | 2.13 |
| text "meta2" | 14.73 | 61.13 | 6.53 | 1 |
| text "tag2" | 2.47 | 60.8 | 0.93 | 1 |
| text "lab3" | 5.87 | 64 | 4.8 | 2.13 |
| text "meta3" | 11.47 | 64.87 | 3.73 | 1 |
| text "tag3" | 2.27 | 64.53 | 1.4 | 1 |
| text "WB" | 2.47 | 68.27 | 0.93 | 1 |
| text "Load file" | 5.87 | 68.13 | 3.6 | 1.2 |
| text "Settings" | 11.6 | 68.13 | 3.53 | 1.2 |

Lit path: (17.8, 43.6) → (17.8, 46.27) → (16.2, 47.87) → (4.53, 47.87) → (2.93, 49.47) → (2.93, 50.73)

#### 02-main-menu-nosave-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| wordmark: PIPELINE CITY | 96 | 112 | 448 | 220 |
| stage strip: (none) | 439 | 266 | 101 | 15 |
| build/status line: build 7f56e17 | 96 | 315 | 448 | 17 |
| vertical rail: IF New game Campaign or sandbox ID Build my PC 3 saved build | 96 | 682 | 504 | 268 |
| row (selected): IF New game Campaign or sandbox | 96 | 682 | 504 | 86 |
| row: ID Build my PC 3 saved builds | 96 | 777 | 504 | 52 |
| row: EX Gallery 64 parts | 96 | 838 | 504 | 52 |
| row: MEM Load file Settings | 96 | 898 | 504 | 52 |
| cyan cell (chip or lit strip cell) | 96 | 700 | 43 | 26 |
| violet strip cell 1 | 439 | 266 | 15 | 15 |

Lit trace: (446, 281) → (446, 324) → (422, 348) → (141, 348) → (117, 372) → (117, 692)

#### 02-main-menu-nosave-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| wordmark: PIPELINE CITY | 1.6 | 35.4 | 22.13 | 11.33 |
| stage strip: (none) | 17.27 | 42.67 | 6.27 | 0.93 |
| build/status line: build 7f56e17 | 1.6 | 45.67 | 22.13 | 1.07 |
| vertical rail: IF New game Campaign or sandbox ID Build my PC 3 saved build | 1.6 | 53.87 | 32.13 | 16.53 |
| row (selected): IF New game Campaign or sandbox | 1.6 | 53.87 | 32.13 | 5.33 |
| row: ID Build my PC 3 saved builds | 1.6 | 59.73 | 32.13 | 3.2 |
| row: EX Gallery 64 parts | 1.6 | 63.47 | 32.13 | 3.2 |
| row: MEM Load file Settings | 1.6 | 67.2 | 32.13 | 3.2 |
| cyan cell (chip or lit strip cell) | 1.6 | 54.93 | 2.67 | 1.6 |
| violet strip cell 1 | 17.27 | 42.67 | 0.93 | 0.93 |

Lit trace: (17.67, 43.6) → (17.67, 46.2) → (16.07, 47.8) → (4.53, 47.8) → (2.93, 49.4) → (2.93, 54.4)

#### 03-loading-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| wordmark: PIPELINE CITY | 96 | 112 | 448 | 220 |
| stage strip: (none) | 439 | 266 | 101 | 15 |
| build/status line: Lighting the room · 62 % | 96 | 315 | 448 | 17 |
| vertical rail: IF Continue Level 4 · $12,480 · saved 2 h ago ID New game ca | 96 | 622 | 504 | 328 |
| row (selected): IF Continue Level 4 · $12,480 · saved 2 h ago | 96 | 622 | 504 | 86 |
| row: ID New game campaign · sandbox | 96 | 717 | 504 | 52 |
| row (disabled): EX Build my PC after loading | 96 | 777 | 504 | 52 |
| row (disabled): MEM Gallery after loading | 96 | 838 | 504 | 52 |
| row: WB Load file Settings | 96 | 898 | 504 | 52 |
| cyan cell (chip or lit strip cell) | 96 | 640 | 43 | 26 |
| violet strip cell 1 | 439 | 266 | 15 | 15 |

Lit trace: (446, 281) → (446, 324) → (422, 348) → (141, 348) → (117, 372) → (117, 632)

#### 03-loading-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| wordmark: PIPELINE CITY | 1.6 | 35.4 | 22.13 | 11.33 |
| stage strip: (none) | 17.27 | 42.67 | 6.27 | 0.93 |
| build/status line: Lighting the room · 62 % | 1.6 | 45.67 | 22.13 | 1.07 |
| vertical rail: IF Continue Level 4 · $12,480 · saved 2 h ago ID New game ca | 1.6 | 50.13 | 32.13 | 20.27 |
| row (selected): IF Continue Level 4 · $12,480 · saved 2 h ago | 1.6 | 50.13 | 32.13 | 5.33 |
| row: ID New game campaign · sandbox | 1.6 | 56 | 32.13 | 3.2 |
| row (disabled): EX Build my PC after loading | 1.6 | 59.73 | 32.13 | 3.2 |
| row (disabled): MEM Gallery after loading | 1.6 | 63.47 | 32.13 | 3.2 |
| row: WB Load file Settings | 1.6 | 67.2 | 32.13 | 3.2 |
| cyan cell (chip or lit strip cell) | 1.6 | 51.2 | 2.67 | 1.6 |
| violet strip cell 1 | 17.27 | 42.67 | 0.93 | 0.93 |

Lit trace: (17.67, 43.6) → (17.67, 46.2) → (16.07, 47.8) → (4.53, 47.8) → (2.93, 49.4) → (2.93, 50.67)

#### 04-new-game-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: NEW GAME ID · new game · last played: campaign | 96 | 112 | 636 | 126 |
| vertical rail: IF Campaign Sandbox Bare board · starter crate · $600 · earn | 96 | 709 | 760 | 241 |
| back: ← Back Esc | 96 | 40 | 86 | 52 |
| row (selected): IF Campaign Sandbox | 96 | 709 | 760 | 52 |
| horizontal rail: Campaign Sandbox | 182 | 709 | 305 | 52 |
| row: ID Tutorial On Off | 96 | 783 | 760 | 52 |
| horizontal rail: On Off | 292 | 783 | 97 | 52 |
| row: WB Replace save and start | 96 | 843 | 760 | 86 |
| cyan cell (chip or lit strip cell) | 653 | 173 | 15 | 15 |
| cyan cell (chip or lit strip cell) | 96 | 722 | 43 | 26 |
| violet strip cell 1 | 631 | 173 | 15 | 15 |

Lit trace: (147, 735) → (174, 735)

Lit trace: (660, 188) → (660, 230) → (636, 254) → (141, 254) → (117, 278) → (117, 714)

#### 04-new-game-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: NEW GAME ID · new game · last played: campaign | 1.6 | 31.33 | 32.93 | 6.73 |
| vertical rail: IF Campaign Sandbox Bare board · starter crate · $600 · earn | 1.6 | 55.6 | 32.13 | 14.8 |
| back: ← Back | 1.6 | 27.33 | 3.13 | 3.2 |
| row (selected): IF Campaign Sandbox | 1.6 | 55.6 | 32.13 | 3.2 |
| horizontal rail: Campaign Sandbox | 6.93 | 55.6 | 14.73 | 3.2 |
| row: ID Tutorial On Off | 1.6 | 60.13 | 32.13 | 3.2 |
| horizontal rail: On Off | 13.73 | 60.13 | 6.07 | 3.2 |
| row: WB Replace save and start | 1.6 | 63.87 | 32.13 | 5.33 |
| cyan cell (chip or lit strip cell) | 29.6 | 34 | 0.93 | 0.93 |
| cyan cell (chip or lit strip cell) | 1.6 | 56.4 | 2.67 | 1.6 |
| violet strip cell 1 | 28.27 | 34 | 0.93 | 0.93 |

Lit trace: (4.8, 57.2) → (6.4, 57.2)

Lit trace: (30, 34.93) → (30, 37.53) → (28.4, 39.13) → (4.53, 39.13) → (2.93, 40.73) → (2.93, 55.87)

#### 05-load-confirm-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: LOAD THIS GAME? WB · load file · replaces your autosave | 96 | 112 | 498 | 219 |
| vertical rail: NOP Cancel keep your save WB Replace save and load | 96 | 803 | 760 | 147 |
| row (selected): NOP Cancel keep your save | 96 | 803 | 760 | 52 |
| row: WB Replace save and load | 96 | 864 | 760 | 86 |
| cyan cell (chip or lit strip cell) | 521 | 266 | 15 | 15 |
| cyan cell (chip or lit strip cell) | 96 | 816 | 43 | 26 |
| violet strip cell 1 | 435 | 266 | 15 | 15 |

Lit trace: (528, 281) → (528, 323) → (504, 347) → (141, 347) → (117, 371) → (117, 808)

#### 05-load-confirm-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: LOAD THIS GAME? WB · load file · replaces your autosave | 1.6 | 28 | 24.6 | 11.33 |
| vertical rail: NOP Cancel keep your save WB Replace save and load | 1.6 | 61.33 | 32.13 | 9.07 |
| row (selected): NOP Cancel keep your save | 1.6 | 61.33 | 32.13 | 3.2 |
| row: WB Replace save and load | 1.6 | 65.07 | 32.13 | 5.33 |
| cyan cell (chip or lit strip cell) | 23.87 | 35.27 | 0.93 | 0.93 |
| cyan cell (chip or lit strip cell) | 1.6 | 62.13 | 2.67 | 1.6 |
| violet strip cell 1 | 18.53 | 35.27 | 0.93 | 0.93 |

Lit trace: (24.33, 36.2) → (24.33, 38.8) → (22.73, 40.4) → (4.53, 40.4) → (2.93, 42) → (2.93, 61.6)

#### 06-settings-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: SETTINGS WB · settings · kept on this device, not in the sav | 96 | 112 | 591 | 126 |
| horizontal rail: IF Quality ID Display EX Light MEM Detail WB Interface | 144 | 520 | 578 | 26 |
| vertical rail: Preset Low Medium High Ultra Fastest. No shadows or glow. De | 146 | 620 | 700 | 200 |
| back: ← Back Esc | 96 | 40 | 86 | 52 |
| row: Preset Low Medium High Ultra | 146 | 620 | 700 | 52 |
| horizontal rail: Low Medium High Ultra | 328 | 620 | 335 | 52 |
| row: Device Auto Low Medium High | 146 | 694 | 700 | 52 |
| horizontal rail: Auto Low Medium High | 328 | 694 | 332 | 52 |
| row: NOW 1 fps · 1016.6 ms · 1440 × 810 | 146 | 768 | 700 | 52 |
| cyan cell (chip or lit strip cell) | 672 | 173 | 15 | 15 |
| cyan cell (chip or lit strip cell) | 144 | 520 | 43 | 26 |
| violet strip cell 1 | 586 | 173 | 15 | 15 |

Lit trace: (679, 188) → (679, 230) → (655, 254) → (189, 254) → (165, 278) → (165, 512)

#### 06-settings-phone

| Element | x | y | w | h |
|---|---|---|---|---|
| display title: SETTINGS WB · settings · kept on this device, not in the sav | 1.6 | 20 | 30.67 | 6.73 |
| horizontal rail: IF Quality ID Display EX Light MEM Detail WB Interface | 4.27 | 33.33 | 26.93 | 1.6 |
| vertical rail: Preset Low Medium High Ultra Fastest. No shadows or glow. De | 4.4 | 38.93 | 32.13 | 17.07 |
| back: ← Back | 1.6 | 16 | 3.13 | 3.2 |
| row: Preset | 4.4 | 38.93 | 32.13 | 2.4 |
| horizontal rail: Low Medium High Ultra | 7.87 | 41.33 | 28.67 | 3.2 |
| row: Device | 4.4 | 45.87 | 32.13 | 2.4 |
| horizontal rail: Auto Low Medium High | 7.87 | 48.27 | 28.67 | 3.2 |
| row: NOW 1 fps · 1016.6 ms · 1440 × 810 | 4.4 | 52.8 | 32.13 | 3.2 |
| cyan cell (chip or lit strip cell) | 31.33 | 22.67 | 0.93 | 0.93 |
| cyan cell (chip or lit strip cell) | 4.27 | 33.33 | 2.67 | 1.6 |
| violet strip cell 1 | 26 | 22.67 | 0.93 | 0.93 |

Lit trace: (31.8, 23.6) → (31.8, 26.2) → (30.2, 27.8) → (7.2, 27.8) → (5.6, 29.4) → (5.6, 32.8)

#### 13-flow-diagram-desktop

| Element | x | y | w | h |
|---|---|---|---|---|
| violet strip cell 1 | 383 | 56 | 15 | 15 |

Lit trace: (440, 254) → (552, 254)

Lit trace: (904, 254) → (1016, 254)

Lit trace: (1368, 254) → (1480, 254)

