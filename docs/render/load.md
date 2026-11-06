# Loading the 3D world

From the page's first paint to the game: the boot screen, the build, the shader link, the menu and the flight into the game. Code: `index.html` (the boot screen), `src/app/boot.ts`, `mountBoard3d` in `board3d.ts`, `src/core/render/three/compile.ts`.

## The order

| Stage (boot screen) | Bar | What happens | Holds the page? |
|---|---|---|---|
| `Loading` | 0.04 | `index.html` paints the screen before any script runs | no |
| `Loading the 3D world` | 0.08 | `main.tsx` imports the 3D chunk | no |
| `Starting the renderer` | 0.10 | `createRenderContext`, `Post`, the light bake's files start to load (`preloadRoomBake`) | about 0.2 s |
| `Building the world` | 0.14 | `prepareCity`, then the first `rebuild`: the city, the room and the machine | about 5 s |
| `Loading the light` | 0.36 | waits for `Room3D.ready`: the bake's lightmap on the meshes | no |
| `Preparing the shaders` | 0.38 to 0.90 | the first frame starts every program (`startPrograms`) and the frame draws nothing until they link | no, but see "Frames stop" |
| `Lighting the room` | 0.92 | the first real frames: the probe takes its bounces | about 1.3 s (first draw) |
| `Ready` | 1 | `bootDone`: the screen fades over 0.9 s, the menu shows under it | no |

The bar only grows (`bootStage`). A stage that the page cannot paint before its work is not seen: `nextPaint` waits for a paint before the build. Do not wait for a paint after programs start: the paint waits for the driver.

The screen goes when the probe has settled, or at the latest `REVEAL_MS` after the link. The new game dialog waits for `booted`, so it never shows behind the boot screen.

## Menu and flight

- Without a snapshot the camera holds the room's overview and sways slowly (`menuView`, `MENU_SWAY`, `MENU_S`; no sway with `prefers-reduced-motion`).
- `.title` (`Hud.tsx`) stands where the boot screen's title stands, in the same type, so the name stays while the screen fades. It fades out as the game starts.
- At the game's start the camera flies from the menu's view to the overview (`flyToRoom`), and the HUD fades in (`hud-in`).

## Rules for the programs

A program first drawn before it has linked holds the frame and the page. On ANGLE D3D11 a lit program of the room takes about 1 s. These rules keep each program linked once, before its first draw:

1. **Start them, do not draw them.** `startPrograms` compiles for a render target (linear, no tone mapping), as the frame draws into the composer's. It covers the hidden parts, and the see-through variant of each material under `fades`.
2. **Keep the count of lights constant.** A light shown, hidden, or one that starts or stops casting a shadow makes every lit program again. Intensity 0 does not. So a light that goes with a part stays in the scene at 0 (`Monitor.bias`: the room holds it, not the monitor's root). Each machine has the same 2 point lights.
3. **The bake before the programs.** The lightmap changes the room's programs, so the first frame waits for `Room3D.ready`.
4. **The post passes too.** `Post.startPrograms` starts each pass's materials. The AO's shader alone took 4.8 s at its first draw. `OutputPass` is left out: it sets its defines as it draws.
5. **A wait for one program is a wait for all before it.** A status query of one program waits for the driver to finish what was queued first. So link the small programs that three uses inside a compile before the batch: `createRenderContext` keeps its `PMREMGenerator` and prefilters a small cube, as a cube target in `scene.environment` (the city's sky) prefilters inside `compile`. This wait took 4.2 s.
6. **A new machine links behind the old one.** `rebuild` holds it in `next`, and the frame swaps them once its programs have linked. A new room or new graphics settings set `warmed = false`: the frame holds the last picture until they link.

## The city stays

`OutsideView` takes about 3 s to build and does not depend on the tier, so `room3d.ts` keeps one for every room (`theCity`). `Room3D.dispose` takes the quad out of the root, so call it before `disposeTree(room.root)`. `prepareCity` builds it first and starts its programs, which then link while the room builds.

## Frames stop while the driver links

The main thread stays free, but the page can get no frames for about 4 s of the link: there is no long task, only a gap between `requestAnimationFrame`s. The driver seems to hold the GPU process's main thread for part of the work. The CSS shimmer also waits then. The bar's stage text still updates between the gaps.

## Measured

2026-11-06, Chrome, ANGLE D3D11, 1600x900, one run each, to the end of the boot screen. The code before this work was measured on the dev server only, so compare the first two columns:

| | Before (dev server) | Now (dev server) | Now (optimized build) |
|---|---|---|---|
| First visit (no shader cache) | 41 s, one frozen page | 19.2 s | 14.3 s |
| Chrome's shader cache kept | about 19 s | not measured | 10.7 s |
| Longest time the main thread is held | 42 s | 5.7 s (the build) | 5.2 s (the build) |
| A game's start at another tier (sandbox) | 2 + 1 + 7 + 1 s | 2.3 s (a new room) | 2.2 s (a new room) |

The dev server's extra 4 to 5 s is mostly its module load, before the first stage. A game's start at the same tier (a new campaign) builds no room.

The 3D renderer is behind a flag (`?3d`, `VITE_3D_GRAPHICS=1`), so measure with it: without it the page opens the 2D board at once. `npm run shot -- --prod` needs `--3d` for the same reason.

The room's bake is stale at the time of this measure (`the room light bake is old`, 13 baked meshes not found). The warning was there before this work; `npm run bake` clears it.

## What can still go faster

- **The build (5 s).** Pure JS: the city's trees and towers, the cloth's occlusion (`cloth/occlusion.ts`, about 1.5 s) and `vertexAo`. It could store its results, or run in a worker.
- **The link (5 to 8 s).** About 127 programs, each about 110 KB of GLSL: 50 of them are the physical material's variants (maps, the room's and the city's lights, `onBeforeCompile` hooks). Fewer variants or fewer lights shorten it directly.
- **The first draw (1.3 s).** Texture uploads and first uniforms. `renderer.initTexture` during the link could spread it.

To measure: `tools/bench3d.mjs` times frames. For the boot, poll the `.boot-stage` text and the gaps between `requestAnimationFrame`s in a fresh Chrome profile, and a kept profile for the shader cache.
