# Implementation map

How `SPEC.md` maps onto the code. Every `file:line` is from `main` at `7f56e17` (2026-11-20 21:41 Europe/Zurich). If `main` has moved, find the symbol named next to each reference; the names are stable, the lines may drift.

Read the repo's own rules first: `CLAUDE.md` (root) and `src/core/ui/CLAUDE.md`. The ones that matter most here:
- Every UI length is relative (rem, em, %, vw, vh, clamp). `src/core/ui/scaling.test.ts` fails on any px literal except `1px` and the root clamp. Convert spec px as SPEC.md §0.2 says.
- Look at UI work before calling it done: `npm run shot -- <out.png> [--size WxH] [--view …] [--clip hud]` (`tools/shot.mjs`), then read the PNG. Before a push also run `npm run build` and `npm run shot -- <out.png> --prod`.
- Test only what you touched (`npx vitest run <path>`), `npm run typecheck`, then commit with explicit paths.
- Use Edit, not scripted rewrites. UI docs: `docs/UI.md` (grep `^## `, read one section).

## 1. Who owns what today

| Screen | Files and functions (main `7f56e17`) |
|---|---|
| Boot screen, before mount (03 first frame) | `index.html:6` viewport (`width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no` today), `:9` theme colour, `:13-51` boot styles (`.boot-title`, `.boot-bar`, `.boot-stage`, `.boot-pipe`), boot markup below; `src/app/boot.ts:12` `bootStage(label, at)`, `:80` `bootMenu`, `:86` `bootDone` ("Ready" at `:90`) |
| Boot stages (03 build line, strip) | `src/app/main.tsx:15`; `src/features/board/render/three/board3d.ts:110, 243, 246, 248, 253, 254, 704, 724, 878, 882` (`bootDone` at 885) |
| 01, 02, 03 Main menu | `src/core/ui/panels/MainMenu.tsx:16` `MainMenu` (rows 40-51; "Sandbox" row at `:44`); `Hud.tsx:308` `Hud()` mounts it when there is no snapshot (`:313-324`), with `Title` (`Hud.tsx:80`) and `Starting` (`Hud.tsx:299`) |
| 04 New game | `src/core/ui/panels/NewGame.tsx:19` `NewGameDialog` (`newGameOpen` `:12`, `newGameMode` `:14`, `openNewGame` `:15`; choices `:87-104`, note `:105`, actions and warning `:106-109`) |
| 05 Load confirm | `src/core/ui/panels/loadgame.ts` (file read), `src/core/ui/panels/LoadConfirm.tsx` (`LoadConfirm`: NOP Cancel, WB "Replace save and load") |
| 06 Settings | `MainMenu.tsx:58` `SettingsCard` (local `settingsOpen` `:13`), `src/core/ui/panels/Graphics.tsx:197` `GraphicsModal` (`Tabs` `:140`, `Options` `:161`, `Peek` `:178`, `Numbers` `:101` with `fpsTone` at `:105`, `TierPicker` `:113`); `src/core/ui/panels/graphicsui.ts:20` `fpsTone`, `PRESET_INFO`, `tierNote`; `src/core/ui/state.ts:27-32` UI size (`UI_SCALE_MIN`, `UI_SCALE_MAX`, `uiScale`, `setUiScale`), `:50` `graphicsOpen` |
| 07 Build my PC | `src/features/board/ui/BuildMode.tsx:46` `BuildMode` (layout `:181-205`); `BuildBars.tsx:13` step `SPEEDS`, `:14` `VIEWS`, `:25` `Readout`, `:55` `ViewOptions`, `:73` `RunControls`, `:90` `RunBar`, `:107` `Foot`; `BuildShelf.tsx:15`; `BuildMachine.tsx:53`; `BuildStart.tsx:56`; `BuildCard.tsx:16`; run speeds `src/features/board/sim/buildrun.ts:43` `RUN_SPEEDS`; 3D stage `src/features/board/render/three/buildmode3d.ts` (`createRenderContext(host, '#0e1118')` `:342`, size `:334` and `:373`, `frameView()` `:489-494`, `WALL_SHIFT` `:102`, `resetView` `:894`) |
| 08 Gallery | `src/features/economy/ui/shop/Gallery.tsx:14` `Gallery`; `GalleryHud.tsx:17` `GalleryRead`, `:37` `GalleryPart`, `:69` `GalleryFoot`; `Showcase.tsx:32` (calls `vw.setInsets(clearance(…))`); viewer `src/core/render/three/viewer.ts` (`setInsets` `:23` and `:353`, `frameView` `:48`, `studio()` `:104`, rim light `0x9ab8ff` `:118`, floor colour `0x0c0f18` `:124`) |
| 09 Controls | `src/core/ui/panels/Controls.tsx:56` `Controls`, lists `MOUSE` `:10-15` (Shift-drag at `:12`) and `KEYS` `:17-29`; `state.ts:59` `controlsOpen`; "?" key in `Hud.tsx` `MenuKeys` (`:205-222`) |
| 10 Paused (in-game menu) | `Hud.tsx:228` `Menu` (open state `:229`, `close` `:233`, focus and keys `:234-249`, items `:256-292`, Controls hand-off `:288`); `MenuKeys` Esc `:216`; `state.ts:57` `gameMenuOpen`; `src/core/ui/leave.ts:11` `leaveGame` |
| 11 First frame / tutorial | `src/features/tutorial/ui/TutorialCard.tsx:264` `TutorialCard`; tutorial popup pause `state.ts:207-215` `pauseForTutorialPopup` |
| 12 HUD | `Hud.tsx:327-395` render tree: `.hud-left` (`hud-econ`: money, time, `Reputation`, `PowerBill`; `hud-sys`: `PhaseChip` `:174`, `NetChipButton` `:181`, `OsChipButton` `:192`; sandbox group), `.hud-center` `LevelBar`, `.hud-right` `SpeedControl` `:53` + `Menu`; `.stack` with `Notice`, `Toasts` (`panels/Toasts.tsx:13, 30`), `TutorialCard`, `InventoryPanel`, `InventoryBar`. `speedLabel` `Hud.tsx:46`; `PauseKey` `:86` (Space); pause pill `:106-109`; `InsetReporter` `:116-170`. Dock `src/features/economy/ui/shop/Inventory.tsx:121-133` (`NetLensButton` gate `:75-77`). Level bar `src/features/economy/ui/progress/Levels.tsx:14` with `levelBar()` in `levelui.ts:36-55` |
| Speed and pause state | `src/worker/protocol.ts:17` `SPEEDS = [0,1,2,4,8,12]`, `:19` `SANDBOX_SPEEDS`; `src/app/store.ts:10-13` `DEFAULT_SPEED`, `speed`, `lastRunSpeed`; `:15-22` `zoomSlowdown`, `zoomSlowOn`, `toggleZoomSlow`; `:221` `setSpeed`; `:228` `togglePause`; `:132` `saveNow`; `:246` `exportSave` |
| Popup pause | `src/core/ui/state.ts:194-215`: `pausedByLevelUp`, `pausedByTutorial`, `popupPause`, `syncPopupPause`, `dismissLevelUp`, `pauseForTutorialPopup` |
| Save summary | `src/core/ui/logic.ts:541` `fmtAgo`, `:555` `saveSummary` |
| Styles | `src/core/ui/ui.css`: tokens `:4-16`; root rule `:18-22` (keep as is); glass block `:30-35`; HUD bar `:65-77`; menu pop `:104-114`; dock `:133-139`; tutorial `:355-366`; toasts and notice `:490-497`; level pill `:499-506` and `:616-623`; title `:532-540`; main menu `:543-566`; starting `:551-552`; controls `:555-562`; new game `:598-613`; pause pill `:875`; studio `.mode` tokens and glass `:1310-1324` (radial backdrop `:1320-1322`, `.mode::after` vignette `:1323`, `.mode-panel`/`.mode-bar` glass `:1324`); Gallery `:1348-1368`; Build `:1386-1425`; graphics modal `:1809-1817`; phone overrides `:1920-1985` |

## 2. Replace, delete, add

### Replace
- `:root` tokens in `ui.css:4-16`: import `tokens.css` first, then point the old names at the new ones where the old names are used by in-scope screens (`--ink: var(--c-ink)` etc.). `--ui` → `var(--f-sans)`, `--mono` → `var(--f-mono)`. Keep `--trace: #1e4270`, `--board`, `--pin`, `--die`, `--tile`, `--dot`, `--alu`, `--mul`, `--ld`, `--st`, `--br`: the board renderer reads them (`ui.css:1` says so); they are not UI colours.
- Each in-scope screen's markup and CSS, as SPEC.md §5 says. Keep every signal, action, title and aria-label the code has.
- `saveSummary` (`logic.ts:555`): add money ("Level 4 · $12,480 · saved 2 h ago"). Update `logic.test.ts`.
- The in-game menu gains "Resume" as its first item (there is no such item today). Its "Graphics" entry becomes "Settings". `SettingsCard` and the separate `GraphicsModal` become one Settings screen (06) with five tabs; the UI size slider moves from the in-game menu into its Interface tab.
- Controls `MOUSE` (`Controls.tsx:12`): `[['Right-drag'], 'Turn the view']` (drop `'Shift-drag'`). Do not touch the binding in `src/core/render/three/pad.ts:82`; it is shared by game, Build and Gallery.
- `SpeedControl` (`Hud.tsx:53-78`): a speed rail (SPEC §4.8). Labels from `speedLabel`. Speeds from the list the HUD already uses (`SPEEDS`); the sandbox speed stays in the SANDBOX popover (`src/features/sandbox/ui/SandboxTools.tsx`, speed 64, labelled "Run at 16x"); do not move it to the rail.

### Delete (in-scope selectors only)
- Glass, blur and shadow on in-scope surfaces: `.hud-side`, `.dockbar`, `.invbar`, `.tut`, `.menu-pop`, `.notice`, `.toast`, `.mm-*`, `.ng*`, `.ctl`, `.starting`, `.title`, `.gfx-back`, `.mode-panel`, `.mode-bar`, `.mode::after`. Do not edit the shared glass rule at `ui.css:30-35` for out-of-scope panels (Shop, Almanac, Log, OS, Trace, Stats, level-up, picker card): remove the in-scope selectors from its selector list instead.
- The pause pill (`Hud.tsx:106-109` and `ui.css:881`). Keep the slow-motion information: it moves into the top-right tab (SPEC §5.12).
- fps colouring: `fpsTone` use in `Graphics.tsx:105` (the function and its test may stay; nothing calls it for colour).
- The main menu "Sandbox" row (`MainMenu.tsx:44`).
- `system-ui`, `Segoe UI`, `ui-monospace`, `Cascadia Mono`, `Consolas` from in-scope styles and `index.html`.
- Pills and radii above 4 px on in-scope screens (`--m-r-pill`, `99rem`).

### Add
- `src/core/ui/tokens.css` (this folder's file) and `src/core/ui/fonts/` with the five WOFF2 files and `LICENSE.txt`.
- One `DisplayTitle` component (wordmark and titles: lines, size, lit cell, meta).
- One `TraceLayer` (SVG overlay) per screen: reads boxes of elements marked `data-trace="source|tag|value|target"`, draws spines, branches, rails and the lit path with 45° chamfers, redraws on focus, value change, resize (`ResizeObserver`) and `document.fonts.ready`. `aria-hidden`.
- One `Ornament` set (K1, K2, K3, K5, K7) as small SVG components from `assets/ornament/`.
- One `EdgeTab` component: props `edges` (which screen edges it touches) and `chamfer` size; computes the `clip-path` for free corners.
- `pausedByMenu` in `state.ts` (§4 below).
- `__BUILD__` (step 3).

## 3. Suggested PR order (small, each verifiable)

Each step ends with `npx vitest run` on the touched tests, `npm run typecheck`, screenshots at 1920 × 1080 and 390 × 844 (`npm run shot -- out.png --size 1920x1080`), and a commit. Phone test sizes: 390 × 844 (reference), 360 × 800, 412 × 915, and landscape 844 × 390 (SPEC §6).

1. **Tokens and fonts.** Add `tokens.css` and fonts; import before `ui.css`; map `--ui`, `--mono`. No visual change except the font. Check: `scaling.test.ts` green; `document.fonts.check('600 16px "Plex Cond"')` true after load.
2. **Font preload and boot page.** In `src/app/main.tsx`, import the Condensed 600 and Mono 500 URLs with `?url` and insert `<link rel="preload" as="font" type="font/woff2" crossorigin>` before render; or add the preload to `index.html` pointing at the built asset. Restyle the boot screen (`index.html:13-51`) to the void page with the static wordmark at the 01 position (vmin sizes are allowed there today; keep them, or move the wordmark into the app's first paint). `theme-color` and body background `#04060f`. Add `viewport-fit=cover`.
3. **Build hash.** `vite.config.ts`: `define: { __BUILD__: JSON.stringify(<git rev-parse --short HEAD> or 'dev') }` plus a `declare const __BUILD__: string` in a `.d.ts`. Used by the build line on 01 to 03.
4. **Shared components.** `DisplayTitle`, `TraceLayer`, `Ornament`, `EdgeTab`, stage tag and chip, value branch, rail and tabs, text button. Add a dev-only route or story to see them; unit-test the chamfer and trace routing maths.
5. **Main menu 01 to 03.** Rebuild `MainMenu` on the spine; remove the Sandbox row; loading strip from `bootStage` share (SPEC §5.3); `saveSummary` with money. Compare with `mocks/01-*`, `02-*`, `03-*` at ±2 px.
6. **New game, load confirm, Settings (04 to 06).** One Settings screen replacing `SettingsCard` + `GraphicsModal` (tabs Quality, Display, Light, Detail, Interface); no fps colour; Peek; Back returns to the opener. In game they use `--ramp-wide` (SPEC §5.6a).
7. **3D stage neutralisation and Build camera.**
   - `ui.css:1319-1322`: `.mode` background → flat `var(--c-studio)` (Gallery). Delete `.mode::after` (`:1329`) and the glass on `.mode` (check the block at `:1319-1322`, not `.mode-panel` at `:1330`).
   - `buildmode3d.ts:342` (`createRenderContext`): `createRenderContext(host, '#49484a')` (the `--c-build-surround` value; a literal is fine in render code, which the scaling test does not scan).
   - `viewer.ts:124`: floor colour `0x0c0f18` → `0x1c1c1e`. `viewer.ts:118`: rim light `0x9ab8ff` → `0xc8d0e0` (warmer, so the part stops reading blue). Note: older notes cited `viewer.ts:68/72` and `buildmode3d.ts:152`; those lines are from an older checkout. The lines above are the ones on `main`.
   - Build camera: give `BuildStage` stage insets like the Gallery viewer (`viewer.ts` `setInsets` → `layout()` → `camera.setViewOffset(W, H, (right − left) / 2, (bottom − top) / 2, W, H)`, plus a fit of the machine box into the free rect). `applyView` (`src/core/render/three/camera.ts:256`) sets the projection and needs no change. `post.refine()` (`src/core/render/three/post.ts:416`) clears the view offset at `post.ts:425`; Build calls it at `buildmode3d.ts:739`. So re-apply the stage inset after every `refine()`. Replace `fitRect(…, this.W / this.H, START, 0.55)` and `WALL_SHIFT` (`buildmode3d.ts:107`) in `frameView()` (`buildmode3d.ts:500`) with a fit of `Machine3D.bodyBox()` ∪ monitor ∪ base into the free rect with ≥ 30 px air. Insets at 1920 × 1080: about `{ left: 400, right: 240, top: 160, bottom: 90 }` with the flyout open, `{ left: 110, … }` with it closed; compute them from the live tab boxes (as `InsetReporter` and `Showcase.tsx:32` do), not from constants. Do not re-frame while a drag is in progress (same rule as `InsetReporter`'s `invKept`). Background and measurement notes: `reference/build-camera-framing.md`.
   - Check: machine inside x 375 to 1446, y 140 to 898 at 1920 × 1080 with the flyout open; no navy (`B − R > 6` and luminance < 0.06) in more than 2 % of a Build or Gallery screenshot.
8. **Build my PC UI (07).** Edge tabs per SPEC §5.7: top-left (Back, title, `Readout` facts), category rail + flyout (`BuildShelf`), top-right (`ViewOptions` lenses + Benchmark), collapsed machine list (`BuildMachine`), run tab (`RunBar` / `RunControls`), hint tab (`Foot` hint), tools tab (`Foot` tools, `SPEEDS` steps, `VIEWS`). Update the `avoid()` selectors (`BuildMode.tsx:171`) to the new tab classes so `BuildCard` still avoids them. Phone layout per §5.7.
9. **Gallery (08).** Flat `--c-studio`, K1 brackets and K7 ruler around the viewer's free rect; set the viewer insets from the bracket box. Category spine, right column from `GalleryPart`, shelf from the category list.
10. **HUD (12).** Re-skin `Hud.tsx:327-395` into the four tabs. Report the new tab boxes to `InsetReporter` (`Hud.tsx:116-170`): replace `.hud` / `.hud-center` with the top tabs and `.invbar` with the dock tab. Speed rail (SPEC §4.8) with Zoom slow. Remove the pause pill. Level progress cells (SPEC §5.12). Phone: one top tab, dock with "Lens" branch.
11. **Paused (10) and pause behaviour.** See §4. Rebuild `Menu` as the Paused screen with the `--ramp-pause`; Files, Tools, Help branches from today's items; phone Tools gains Zoom slow and the HUD segments.
12. **Controls (09).** Tabs Mouse, View, Game; no Shift-drag row; phone list. Closing returns to Paused when opened from it.
13. **First frame (11).** Restyle `TutorialCard` into the instruction tab (desktop) or the ramp block (phone); staged HUD on step 1; lit trace from "Next" to the step's target control.
14. **Motion and reduced motion.** SPEC §8. Last, so the layout is stable first.
15. **Responsive pass.** SPEC §6 at the sizes in ACCEPTANCE.md §4.
16. **Docs.** Update `docs/UI.md` sections "Look", "HUD", "Studio screens", "Theme" to point at the new tokens and components.

## 4. Pause implementation (SPEC §9)
In `src/core/ui/state.ts` beside the popup pause (`:194-215`):
```ts
let pausedByMenu = false;
const syncPopupPause = () => { popupPause.value = pausedByLevelUp || pausedByTutorial || pausedByMenu; };

/** The in-game menu family (Paused, and Settings or Controls opened from it) holds the clock while open. */
export function pauseForMenu(open: boolean) {
  if (open && !pausedByMenu && speed.peek() !== 0) { togglePause(); pausedByMenu = true; }
  else if (!open && pausedByMenu) {
    if (speed.peek() === 0 && !levelUp.peek() && !pausedByTutorial) togglePause(); // resumes at lastRunSpeed (store.ts:228)
    pausedByMenu = false;
  }
  syncPopupPause();
}
```
- Add a `menuFamilyOpen` computed (or explicit signal) that is true while `gameMenuOpen`, or Settings or Controls opened from the menu, is open. Call `pauseForMenu(menuFamilyOpen)` from one effect, not from each button, so every way of closing is covered.
- Today `Hud.tsx:288` closes the menu before opening Controls. Change the hand-off so the family stays open across it (open Controls with a `from: 'menu'` flag; on close, reopen Paused).
- A HUD speed click while paused by the menu: set `pausedByMenu = false` first, then `setSpeed(x)`, then close the family, so the close does not toggle again.
- `PauseKey` (`Hud.tsx:86-104`) already ignores Space while `.menu-pop` exists; keep that guard working with the new Paused root (give it the same class or update the selector).
- `leaveGame` (`leave.ts:11`) already closes `gameMenuOpen`; make sure `pausedByMenu` resets there too (no resume on leave).
- Tests: add `state.test.ts` cases: open → speed 0; close → previous speed; paused before open → still paused after close; level-up open during the menu → stays paused after close; speed click while open → runs at the clicked speed, menu closed.

## 5. HUD speeds (correction)
The v2 mocks showed "1x 4x 16x" in the HUD. Those are Build's run speeds (`buildrun.ts:43` `RUN_SPEEDS = [1, 4, 16, 64]`). The HUD runs `SPEEDS = [0, 1, 2, 4, 8, 12]` (`protocol.ts:17`), shown through `speedLabel = s / 4` as 0.25x, 0.5x, 1x, 2x, 3x. Build keeps its own run speeds (run tab) and step speeds (`BuildBars.tsx:13`, 0.5x to 4x).
