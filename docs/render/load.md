# Loading the 3D world

From the page's first paint to the game: the boot screen, the build, the shader link, the menu and the flight into the game. Code: `index.html` (the boot screen), `src/app/boot.ts`, `mountBoard3d` in `board3d.ts`, `src/core/render/three/compile.ts`.

## The order

| Stage (boot screen) | Bar | What happens | Holds the page? |
|---|---|---|---|
| `Loading` | 0.04 | `index.html` paints the screen before any script runs | no |
| `Loading the 3D world` | 0.08 | `main.tsx` imports the 3D chunk | no |
| `Starting the renderer` | 0.10 | `createRenderContext`, `Post`, the light bake's files start to load (`preloadRoomBake`) | about 0.2 s |
| `Building the world` | 0.14 | `prepareCity`, then the first `rebuild`: the city, the room and the machine | about 2.8 s |
| `Loading the light` | 0.36 | waits for `Room3D.ready`: the bake's lightmap on the meshes | no |
| `Preparing the shaders` | 0.38 to 0.90 | the first frame starts every program (`startPrograms`) and the frame draws nothing until they link | no, but see "Frames stop" |
| `Lighting the room` | 0.92 | the first real frames: the probe takes its bounces | about 0.6 s (first draw) |
| `Ready` | 1 | `bootDone`: the screen fades over 0.9 s, the menu shows under it | no |

The bar only grows (`bootStage`). A stage that the page cannot paint before its work is not seen: `nextPaint` waits for a paint before the build. Do not wait for a paint after programs start: the paint waits for the driver.

The screen goes when the probe has settled, or at the latest `REVEAL_MS` after the link. The new game dialog waits for `booted`, so it never shows behind the boot screen.

## The boot screen

- Four cells; one lights at a time and hops along (0.2 s a step), over a boot log of the stages done. All CSS: only transform and opacity move, so it runs while the build holds the main thread. It stops in the driver's link gaps (see below).
- The still: `saveStill` (`boot.ts`) copies the canvas (480 px JPEG) into `localStorage` `pc.bootStill` every 30 s while a game runs, from the overview's fixed angle (its own draw, whatever the player looks at). The next boot shows it, blurred, behind the screen. First visit: the shipped `public/boot-still.jpg`; if that is missing, no still.

## Menu and flight

- Without a snapshot the camera holds the room's overview and sways slowly (`menuView`, `MENU_SWAY`, `MENU_S`; no sway with `prefers-reduced-motion`).
- `.title` (`Hud.tsx`) stands where the boot screen's title stands, in the same type, so the name stays while the screen fades. It fades out as the game starts.
- At the game's start the camera flies from the menu's view to the overview (`flyToRoom`), and the HUD fades in (`hud-in`).
- Gallery and Build my PC cover the whole screen with their own context: the room's frame is skipped meanwhile (`covered` in `board3d.ts`). The canvas keeps its last picture and the room's time stands still, so the room is the same on return. A new picture's programs (a graphics change made there) still link while it is covered.

## Draw on demand

The menu, the Gallery and Build my PC run their frame logic each tick, but draw only when the picture changes. A skipped frame keeps the canvas's last picture. The game itself draws every tick. Code: `ondemand.ts` (`src/core/render/three`).

- **`DrawGate`.** `want(now, busy)` is true when something asked (`ask`, one frame), when `busy` is true (and one frame after it ends), for a time after `keep`, or after any `sceneChanged()`.
- **`ViewWatch`.** The camera "moved" when a 3x3 grid of screen points, at two depths of the view, moves `STILL_PX` (0.5 device px) or more from the last drawn frame. So the menu's sway draws only the frames it moves the picture by, and a settled tween stops.
- **`sceneChanged()`**, global: a baked art tile (`BakeQueue.run`), a tile dropped (`ArtSurface.dropTile`), a model loaded (`loadModel`). Each view draws one frame after it.
- **Asks.** A new size (`ResizeObserver`, the viewer's `resize`), new graphics settings, `webglcontextrestored`, a new picture (`rebuild`), a theme, a part installed, a shown part (`setObject`), a target shown, a probe face done, shadows cast, and the uncovered frame after Gallery or Build my PC.
- **Busy, in the menu** (`board3d.ts`): the machine moves (`Machine3D.moving`: a fan turns, the panel swings, the strip pulses, the disk LED blinks, a part's look eases), the probe works, the eye adapts, the sway moves the picture. The city's beat (`Room3D.ambientDue`: each `EVERY` ticks, as the city draws) asks for one frame: it carries the cars, the cup's steam, the clock and the hour's light.
- **Busy, in Build my PC** (`buildmode3d.ts`): a part's motion, the busy status, the machine moves, a lens, the snap marker's pulse, the eye, a camera move. **The Gallery** (`viewer.ts`): the turntable and a drag move the camera; a still part draws nothing.

Phone (412x915 at dpr 2.6, CPU /4, `npm run bench:modes -- --phone`), frames drawn per second, before and after:

| Mode | default | low (fps unlimited) |
|---|---|---|
| Menu, untouched (60 s) | 30 to 23 | 60 to 34 |
| Menu, reduced motion (no sway, 20 s, CPU /1) | 30 to 12 | not measured |
| Gallery, Spin on | 30 to 30 (the turntable) | 62 to 85 (the turntable) |
| Gallery, Spin off (CPU /1) | 30 to 0 | not measured |
| Build my PC (15 s) | each tick to 5 (its first seconds only, then 0) | each tick to 5 |

The menu cannot draw less than the city's beat: the cars never stop (10 Hz at 30 fps, a third of the ticks when the fps is unlimited). The sway adds the frames it moves the picture by (about 11 a second). The cup's steam steps on the beat: at the menu's distance a wisp moves under 0.5 px a beat.

## Rules for the programs

A program first drawn before it has linked holds the frame and the page. On ANGLE D3D11 a lit program of the room takes about 0.3 s. These rules keep each program linked once, before its first draw:

1. **Start them, do not draw them.** `startPrograms` compiles for a render target (linear, no tone mapping), as the frame draws into the composer's. It covers the hidden parts, and the see-through variant of each material under `fades`.
2. **Keep the count of lights constant.** A light shown, hidden, or one that starts or stops casting a shadow makes every lit program again. Intensity 0 does not. So a light that goes with a part stays in the scene at 0 (`Monitor.bias`: the room holds it, not the monitor's root). Each machine has the same 2 point lights.
3. **The bake before the programs.** The lightmap changes the room's programs, so the first frame waits for `Room3D.ready`.
4. **The post passes too.** `Post.startPrograms` starts each pass's materials. The AO's shader alone took 4.8 s at its first draw. The last pass (`LocalEye`) gets the renderer's tone mapping and colour space first (`setOutput`), so its program is started too. `startPassPrograms` draws a quad with the attributes of `FullScreenQuad`'s triangle: a geometry with normals makes another program, and the pass would link its own at its first draw.
5. **A wait for one program is a wait for all before it.** A status query of one program waits for the driver to finish what was queued first. So link the small programs that three uses inside a compile before the batch: `createRenderContext` keeps its `PMREMGenerator` and prefilters a small cube, as a cube target in `scene.environment` (the city's sky) prefilters inside `compile`. This wait took 4.2 s.
6. **A new machine links behind the old one.** `rebuild` holds it in `next`, and the frame swaps them once its programs have linked. A new room or new graphics settings set `warmed = false`: the frame holds the last picture until they link.
7. **The area lights in a plain loop.** three writes a light's shading out once per light. The area lights' shading is long, and with the room's 12 lights the D3D compiler took about 1 s on each lit program. `arealoop.ts` makes it a loop: the same sums, a third of the time. Import it before a program reads `lights_fragment_begin`.

Some programs still link inside the first frame: the `LightmapMix` quad, and the shadows' depth and distance programs, which three makes at the first shadow draw for the lights of that moment. Together they take about 250 ms.

## The city stays

`OutsideView` takes about 1.6 s to build and does not depend on the tier, so `room3d.ts` keeps one for every room (`theCity`). `Room3D.dispose` takes the quad out of the root, so call it before `disposeTree(room.root)`. `prepareCity` builds it first and starts its programs, which then link while the room builds.

## Frames stop while the driver links

The main thread stays free, but the page can get no frames for about 1 s of the link: there is no long task, only a gap between `requestAnimationFrame`s. The driver seems to hold the GPU process's main thread for part of the work. The CSS shimmer also waits then. The bar's stage text still updates between the gaps.

## Measured

Chrome, ANGLE D3D11, 1600x900, an optimized build without minifying, to the end of the boot screen (`Ready` is 0.9 s before it):

| | 2026-11-06 | 2026-11-07 |
|---|---|---|
| First visit (no shader cache) | 14.5 s | 7.6 s |
| Chrome's shader cache kept | 10.7 s | 5.8 s |
| Longest time the main thread is held | 5.2 s (the build) | 2.8 s (the build) |
| Programs linked | 136 | 118 |
| A game's start at another tier (sandbox) | 2.2 s (a new room) | not measured |

A game's start at the same tier (a new campaign) builds no room. The dev server adds 4 to 5 s, mostly its module load, before the first stage.

The 3D renderer is behind a flag (`?3d`, `VITE_3D_GRAPHICS=1`), so measure with it: without it the page opens the 2D board at once. `npm run shot -- --prod` needs `--3d` for the same reason.

## What can still go faster

- **The build (2.8 s).** Pure JS: `plantTrees` and `vertexAo` take about 0.6 s each, `mergeStatic` and `massGeometries` about 0.35 s each. It could store its results, or run in a worker.
- **The link (about 2 s).** About 118 programs, each about 110 KB of GLSL: 50 of them are the physical material's variants (maps, the room's and the city's lights, `onBeforeCompile` hooks). Fewer variants or fewer lights shorten it directly. `renderer.debug.checkShaderErrors = false` gives nothing: the wait moves from `getProgramInfoLog` to `getProgramParameter`.
- **The first draw (0.6 s).** Texture uploads and first uniforms. `renderer.initTexture` during the link could spread it.

To measure: `tools/bench3d.mjs` times frames. For the boot, poll the `.boot-stage` text and the gaps between `requestAnimationFrame`s in a fresh Chrome profile, and a kept profile for the shader cache.
