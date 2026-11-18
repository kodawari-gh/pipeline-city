# Loading the 3D world

From the page's first paint to the game: the boot screen, the build, the shader link, the menu and the flight into the game. Code: `index.html` (the boot screen), `src/app/boot.ts`, `mountBoard3d` in `board3d.ts`, `src/core/render/three/compile.ts`.

## The order

| Stage (boot screen) | Bar | What happens | Holds the page? |
|---|---|---|---|
| `Loading` | 0.04 | `index.html` paints the screen before any script runs | no |
| `Loading the 3D world` | 0.08 | `main.tsx` imports the 3D chunk | no |
| `Starting the renderer` | 0.10 | `createRenderContext`, `Post`, the light bake's files start to load (`preloadRoomBake`) | about 0.2 s |
| `Building the world` (`Laying the streets`, `Merging the streets`, `Raising the towers`, `Planting the trees`, `Painting the sky`) | 0.14 to 0.28 | `prepareCity`: the city builds a step at a time (`OutsideView.make`), a paint between, so the bar and the menu stay alive | chunks of 0.15 to 0.3 s |
| `Starting the city shaders` | 0.28 | the city's sky environment stands, then its programs start (rule 8) | about 0.1 s |
| `Furnishing the room` | 0.30 | `rebuild(true)`: `Room3D`, one task | about 1.2 s |
| `Assembling the machine` | 0.34 | `rebuild()`: the first machine | about 0.2 s |
| `Loading the light` | 0.36 | waits for `Room3D.ready` (the bake's lightmap on the meshes) and `modelsIn` (the mouse and the hoodie: rule 9) | no |
| `Preparing the shaders` | 0.38 to 0.90 | the first frame starts every program (`startPrograms`) and the frame draws nothing until they link | no, but see "Frames stop" |
| `Lighting the room` | 0.92 | the first real frames: the probe takes its bounces | about 0.4 s (first draw) |
| `Ready` | 1 | `bootDone`: the screen fades over 0.9 s; the menu has stood over it since the first paint | no |

The bar only grows (`bootStage`). A stage that the page cannot paint before its work is not seen: `nextPaint` waits for a paint before the build. Do not wait for a paint after programs start: the paint waits for the driver. Between the room and the machine only a `turn` (a timeout of 0) lets the page breathe.

The screen goes when the probe has settled, or at the latest `REVEAL_MS` after the link. **The menu does not wait for it.** `main.tsx` calls `bootMenu` after `render`: `#boot.menu` (`index.html`) drops the screen's z-index, hides its title, cells and log, and puts its bar at the foot, and the HUD, which follows it in the markup, paints over it. Build my PC, Gallery and the graphics settings stay off until `booted` (`MainMenu`'s `ready`). A game chosen before `booted` waits in `startSim` (`store.ts`): `starting` shows "Getting the room ready…", the last choice wins, and it starts when `booted` turns true (its first machine would be built twice, and the page is busy). `bootFail` takes `menu` off, so the failure covers the menu.

## The boot screen

- Four cells; one lights at a time and hops along (0.2 s a step), over a boot log of the stages done. All CSS: only transform and opacity move, so it runs while the build holds the main thread. It stops in the driver's link gaps (see below).
- If the world cannot start (no WebGL, or the renderer throws), `main.tsx` calls `bootFail` (`boot.ts`): the screen stays, the bar and cells go, and it says why ("WebGL is not available" with help) and offers Try again. It used to fade out onto a black view with a HUD and no board. Tested with `--disable-3d-apis`.
- The still: `saveStill` (`boot.ts`) copies the canvas (480 px JPEG) into `localStorage` `pc.bootStill` every 30 s while a game runs, from the overview's fixed angle (its own draw, whatever the player looks at). The next boot shows it, blurred, behind the screen. First visit: the shipped `public/boot-still.jpg`; if that is missing, no still.

## Menu and flight

- Without a snapshot the camera holds the room's overview and sways slowly (`menuView`, `MENU_SWAY`, `MENU_S`; no sway with `prefers-reduced-motion`).
- `.title` (`Hud.tsx`) stands where the boot screen's title stands, in the same type, so the name stays while the screen fades. It fades out as the game starts.
- At the game's start the camera flies from the menu's view to the overview (`flyToRoom`), and the HUD fades in (`hud-in`).
- Between Start and that flight the page is busy for about 2 s: the worker's first snapshot sets `snapshot`, and the effect in `mountBoard3d` rebuilds the machine (a sandbox at another tier also the room) inside that one task. The menu's buttons give way to `Starting…` (`starting` in `store.ts`) at the click, before the work. Its ring turns by transform, so the compositor keeps it going. Main menu from a game needs no reload: `leaveSim` stops the worker and sets `snapshot` to null, and the room goes back to its sway.
- Gallery and Build my PC cover the whole screen with their own context: the room's frame is skipped meanwhile (`covered` in `board3d.ts`). The canvas keeps its last picture and the room's time stands still, so the room is the same on return. A new picture's programs (a graphics change made there) still link while it is covered.

## Draw on demand

The menu, the Gallery and Build my PC run their frame logic each tick, but draw only when the picture changes. A skipped frame keeps the canvas's last picture. The game itself draws every tick. Code: `ondemand.ts` (`src/core/render/three`).

- **`DrawGate`.** `want(now, busy)` is true when something asked (`ask`, one frame), when `busy` is true (and one frame after it ends), for a time after `keep`, or after any `sceneChanged()`. With `more` (Build my PC's bake queue has jobs) and no other reason, the scene changes draw as one frame each `BATCH_MS` (`docs/render/case.md` "Build my PC's frame").
- **`ViewWatch`.** The camera "moved" when a 3x3 grid of screen points, at two depths of the view, moves `STILL_PX` (0.5 device px) or more from the last drawn frame. So the menu's sway draws only the frames it moves the picture by, and a settled tween stops.
- **`sceneChanged()`**, global: a baked art tile (`BakeQueue.run`), a tile dropped (`ArtSurface.dropTile`), a model loaded (`loadModel`). Each view draws one frame after it.
- **Asks.** A new size (`ResizeObserver`, the viewer's `resize`), new graphics settings, `webglcontextrestored`, a new picture (`rebuild`), a theme, a part installed, a shown part (`setObject`), a target shown, a probe face done, shadows cast, and the uncovered frame after Gallery or Build my PC.
- **Busy, in the menu** (`board3d.ts`): the machine moves (`Machine3D.moving`: a fan turns, the panel swings, the strip pulses, the disk LED blinks, a part's look eases), the probe works, the eye adapts, the sway moves the picture. The city's beat (`Room3D.ambientDue`: each `LOW_EVERY` ticks at Low, each `EVERY` at High, as the city draws) asks for one frame: it carries the cars, the cup's steam, the clock and the hour's light.
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

**The sway's frames (PHONE-06, 2026-11-17).** The sway used to count as a busy source, so each frame it moved the picture was followed by one trailing frame, and that frame showed the same picture within `STILL_PX`. Now it asks for one frame and draws no trailing frame (`board3d.ts`, `moved && swaying`). Without the sway (reduced motion) a settling view keeps its trailing frame. Untouched menu, phone profile (412x915, dpr 2.6, CPU /4, 30 s, headless Chrome, real GPU), frames a second: default tier 29.1 to 25.8, Low 30.8 to 23.6; reduced motion is unchanged (20.7 default, 12.6 Low). A shot of the menu matches. What is left is the city's beat (16 to 20 a second at the default tier, 10 at Low) and the sway's own frames (13 a second). **Decided: the rest is not built.** Frames shared between the beat and the sway gain nothing: at Low a beat that waited 110 ms for a sway frame drew 30.0 frames a second against 30.8, because the window draws on any frame when it is due, so the two already merge. A time floor under the beat changes the cars' rate at High (a look change). A scissored redraw of the window's box needs the scene colour kept between frames (an MSAA target is invalidated after its resolve), and the bloom and the AO spread past the box, so it needs its own path in `Post`: much risk for the 12 to 20 frames a second of a screen that is not the player's work. The phone tasks were dropped by the owner (2026-11-17); a real-device run showing that the menu's heat or battery matters would reopen this.

**The still view's refinement (LPC10, `Post.refine`).** Build my PC uses its ticks with no draw: each of the first 16 draws the chain once more with the projection moved by a part of a pixel (`jitter`: a Halton point; the first has no offset, so the picture does not jump), mixes the finished frame into a half-float mean (weight 1/n) and shows the mean. After 16 ticks each pixel holds 16 samples: smooth edges at Low, which has no multisampling, and finer ones above. Then the view draws nothing again. Any real frame (`Post.render`) starts it over, so nothing that moves can leave a trail. Checked on a Low shot (the RAM, the ATX lead and the case's edges read smooth; they were stepped). Cost: 16 more frames after each stop, and one half-float target of the picture's size. Not used where the picture never stands: the game draws every frame, and the menu draws on the city's beat, so a mean there would start over 10 times a second. Those views need motion vectors first (not planned). **Decided 2026-11-16 (GFX-03):** the Build my PC result is accepted (the Low shot above), and the game view and the menu do not get it. Neither view is ever still (fans, the city's beat), so the mean would never reach 16 samples; reprojecting it with motion vectors would add a velocity pass and a history pass to every frame (not measured), and Low is the tier that gives up smooth edges for its frame time while High has 4x multisampling already. A Low game view that must be smooth in motion is a different tool (FXAA or SMAA, one pass): not planned.

## Rules for the programs

A program first drawn before it has linked holds the frame and the page. On ANGLE D3D11 a lit program of the room takes about 0.3 s. These rules keep each program linked once, before its first draw:

1. **Start them, do not draw them.** `startPrograms` compiles for a render target (linear, no tone mapping), as the frame draws into the scene's own target (`post.ts`). It covers the hidden parts, and the see-through variant of each material under `fades`.
2. **Keep the count of lights constant.** A light shown, hidden, or one that starts or stops casting a shadow makes every lit program again. Intensity 0 does not. So a light that goes with a part stays in the scene at 0 (`Monitor.bias`: the room holds it, not the monitor's root). Each machine has the same 2 point lights.
3. **The bake before the programs.** The lightmap changes the room's programs, so the first frame waits for `Room3D.ready`.
4. **The post passes too.** `Post.startPrograms` starts each pass's materials. The AO's shader alone took 4.8 s at its first draw. The finish (`LocalEye.draw`: the eye, the tone mapping, the screen's colour space) is a raw shader, so the program linked for a target is the one the screen uses; `LocalEye.output` sets its defines first. `startPassPrograms` draws a quad with the attributes of `FullScreenQuad`'s triangle: a geometry with normals makes another program, and the pass would link its own at its first draw.
5. **A wait for one program is a wait for all before it.** A status query of one program waits for the driver to finish what was queued first. So link the small programs that three uses inside a compile before the batch: `createRenderContext` keeps its `PMREMGenerator` and prefilters a small cube, as a cube target in `scene.environment` (the city's sky) prefilters inside `compile`. This wait took 4.2 s.
6. **A new machine links behind the old one.** `rebuild` holds it in `next`, and the frame swaps them once its programs have linked. A new room or new graphics settings set `warmed = false`: the frame holds the last picture until they link.
7. **The area lights in a plain loop.** three writes a light's shading out once per light. The area lights' shading is long, and with the room's 12 lights the D3D compiler took about 1 s on each lit program. `arealoop.ts` makes it a loop: the same sums, a third of the time. Import it before a program reads `lights_fragment_begin`.

8. **Start a lit program as it will be drawn, environment map and all.** Three keys a lit program by its environment (`envMapMode`, its size). A program started with none is made again at its first draw, when the scene has one, and that link holds the page: the city's sky environment (`OutsideView.draw` filters it at the first draw) made about 10 lit programs, a 3 s task at the end of the wait. `OutsideView.startPrograms` calls `standEnv` first: the PMREM target stands on the (still blank) sky cube and sits on `scene.environment`, so the keys match, and `draw` refills the same target later. The same holds for anything that changes a key: a light, a fog, the shadows, a material's `side`.
9. **Models join the scene before the programs start.** A glTF model that comes in after the batch (the mouse and the hoodie came 20 ms after it) links its own programs at its first draw: 0.45 s for the mouse's double-sided standard material and 0.4 s for the hoodie's physical cloth. `loadModel` keeps its loads in `pending`, and `modelsIn()` (`gltf.ts`) waits for them and for their users, or 2 s at most; the boot calls it after `Room3D.ready`. A model that arrives later still links at its first draw (a slow network): there is no start for it yet.

10. **A first picture waits for its programs and uses each once (Build my PC).** `BuildStage.frame` draws nothing until `programsReady`. The first call starts the machine's programs, the see-through variants of its fades and the passes' (`startPrograms`, `Post.startPrograms`). The ticks after ask the driver without waiting, so the page stays alive. Once all have linked, `prime` makes the first use of each (`getUniforms`, 4 ms a tick). `BuildStage.open` waits for the first picture, so the skeleton stays up until it. A first use waits for the driver to finish every command sent before it. At the first draw those are the scene's uploads: 15 of the 74 programs took 0.41 s that way. With the queue empty the same calls take 0.04 s. After 15 s (`LINK_MAX_MS`) the draw goes on and links what is left.

Some programs still link inside the first frame: the shadows' depth programs (6, made at the first shadow draw: three makes them, `compile` does not), the `map` / `k` shader that lights the screen, and the sky's `textureCube` pass. Together they take about 0.2 s. A wake of each program's first use a few a frame (`getUniforms`) before the boot's first draw was tried: it split the first frame's task in two and saved nothing (352 to 394 ms with or without it), so the boot does not keep it. In Build my PC's first open the same step saves 0.5 s (rule 10).

## The city stays

`OutsideView` takes about 1.6 s to build and does not depend on the tier, so `room3d.ts` keeps one for every room (`theCity`). `Room3D.dispose` takes the quad out of the root, so call it before `disposeTree(room.root)`. `prepareCity` builds it first, a step at a time (`OutsideView.make` runs the constructor's generator `build` and awaits `between` after each of its five steps, which paints and sets the label), and starts its programs, which then link while the room builds. The sync constructor runs the same steps in a row (`defer` is the async path's).

## Frames stop while the driver links

The main thread stays free, but the page can get no frames for about 1 s of the link: there is no long task, only a gap between `requestAnimationFrame`s. The driver seems to hold the GPU process's main thread for part of the work. The CSS shimmer also waits then. The bar's stage text still updates between the gaps.

## A closed screen frees what it owns

Gallery (`viewer.ts`) and Build my PC (`BuildStage`) each have a WebGL context of their own. A close frees it all (PERF12):

- `disposeRenderContext` (`init.ts`) loses the context first (`forceContextLoss`: the browser frees its GPU memory now, not at a garbage collection that may never come). Then it frees the environment map, the prefilter, the renderer and the canvas.
- `Post.dispose` frees each pass's targets and materials. three's `GTAOPass` and `UnrealBloomPass` keep three materials when they dispose; `Post` frees them.
- `BuildStage.dispose` frees the context at once and its meshes 20 ms later. All in one task held a phone's frame for about 90 ms. A material shared with the room holds the dead renderer's listener until its `dispose`, so the meshes are disposed after the renderer too.
- The art baker is a second Pixi renderer that stays. `ArtBaker.dispose` destroys each `Graphics` with its context. `freeBakePools` (`bake.ts`) empties Pixi's pools: each pooled `GraphicsContextRenderData` has a batcher with 7 to 14 MB of buffers.
- `registerLabel` (`camera.ts`) lists each label for the size rule. The list now sweeps itself each time it doubles, and a close calls `sweepLabels`.
- A closed stage drops its machine, game and snapshots: Preact's effect closure holds the stage object until the next open.
- Shared caches stay: `roomGeo`, the shared materials, the cached textures. A reopened screen looks the same.
- A canvas outlives what listens to it. Take each handler off the canvas in the owner's `dispose`.

**A preset change (Low to High) rebuilds the room and the city (2026-11-18).** The change builds a new `Room3D` and city, and frees the old ones. Measured (dev server and optimized build, real GPU, the menu and a running game, heap after a forced GC, the hour pinned with `roomDebug.hour`):

- The GPU did not leak. Each GL count (textures, programs, framebuffers, renderbuffers) is the same after the 2nd and the 10th change.
- The JS heap did: about 230 MB per change (441 MB at the start, 3.7 GB after 12 changes). `OutsideView.draw` added two anonymous `webglcontextlost` and `webglcontextrestored` handlers to the page's canvas, and `dispose` never took them off. The canvas lives as long as the page, so each dead view kept its whole city.
- Now the handlers are fields, `dispose` removes them and frees the occlusion query (`Sight.dispose`). Ten changes leave the heap flat: 496 to 501 MB on High, 423 to 429 MB on Low (+5 MB in the first five changes, then none).
- What still grows is small and Pixi's: `CanvasTextSystem._activeTextures` keeps a null key for each text style ever drawn (about 130 per rebuild), and `CanvasTextMetrics` keeps up to 1000 measurements.
- Pin the hour before you compare counts. At night the lamps' shadow maps, the city's glow and the mirror add targets, and the new light counts add programs: 221 textures and 120 programs at noon, 243 and 128 later.
- To find an owner, take a heap snapshot after the 2nd change and one after the 8th, and read the retaining path of each class that grew. `Runtime.queryObjects` gives wrong counts: its result array holds the instances.

The menu has 3 contexts that stay: the room, Pixi's 1x1 shader probe and the Pixi art baker.

**One context for all screens (PHONE-07). Decided 2026-11-17: not built.** The task assumed that a second context repeats the room's programs and textures. Measured (phone profile, dev server, real GPU, programs compared by `cacheKey`, 40 s after the open): the menu's room has 123 programs, 116 textures and 218 geometries. The Gallery's context adds 16 programs (3 are in the room's set), 12 textures and 300 geometries. Build my PC's context adds 47 programs (3 in the room's set), 119 textures and 627 geometries. A single context would still link 13 and 44 programs: the screens use other materials (the viewer's, the machine's painted dies). Only 3 programs would link once instead of twice; the textures are other art, so one context would not share their memory either. The room stays resident behind both screens in either design. It costs: two post stacks and two sizes and pixel ratios drawn into one canvas, a loss handler for the room's context, `setLowDetail` and the other module-level state of a renderer, and the close that frees the context at once (PHONE-04) would free nothing. The gain is small and the risk is high, so each screen keeps its own context. The phone tasks were dropped by the owner (2026-11-17); a real phone that runs out of contexts or of GPU memory with the room, the stage and Pixi alive would reopen this.

Phone profile (412x915 at 2.6), 4x CPU throttle, the optimized build, heap after a forced GC; 5 opens and closes of each screen:

| | Before | After |
|---|---|---|
| Menu | 31.4 MB, 3 contexts | 31.3 MB, 3 contexts |
| After each Gallery close | 32.3 to 33.6 MB, 3 contexts | 32.6 to 33.4 MB, 3 contexts |
| After each Build my PC close | 101, 155, 211, 264, 215 MB; 4 contexts | 37.9, 38.3, 40.4, 40.4, 40.4 MB; 3 contexts |
| Build my PC open, first and fifth | 6.7 s, 3.7 s | 6.7 s, 3.7 s |
| Build my PC close, longest frame | 76 to 121 ms | 68 to 82 ms |
| Gallery open, first and fifth; close | 352 ms, 106 ms; 40 to 43 ms | 340 ms, 107 ms; 27 to 49 ms |

The 9 MB that stays after Build my PC does not grow after the third close. About 6 MB of it is V8's compiled code for the screen's modules (machine code, bytecode, feedback): 20 more idle GCs do not drop it. The objects come back to within about 1 MB of the menu. **Decided 2026-11-16 (PHONE-04): the floor is accepted.** After a close the heap is 29 % over the first menu reading (31.3 to 40.4 MB) and is flat from the third close on, so nothing leaks. The 6 MB of compiled code stays with the shared caches that make the next open faster (3.7 s against 6.7 s), and the other 3 MB are caches with a cap (Pixi's text metrics, 1,000 entries). The other way out, loading less code on the main thread (Build my PC imports the whole `Game`), is a split of the module graph with no gain a player sees. The game's start builds a second `Room3D`: `board3d.ts` disposes the first, and the GC collects it.

**Context loss (PHONE-08, 2026-11-16, NVIDIA GeForce RTX 5080, ANGLE D3D11, dev server).** Phone profile (412x915 at 2.6). `WEBGL_lose_context` on the screen's own canvas, then `restoreContext` 1 s later. Pictures taken before the loss and 5.5 s after the restore:

- Gallery: `webglcontextlost` 1, `webglcontextrestored` 1, no page error. 38.6% of pixels differ by more than 24 of 255. The turntable turns (Spin is on); a control run with no loss shows the same turn. By eye: the case draws again, lit, not black or empty.
- Build my PC: `webglcontextlost` 1, `webglcontextrestored` 1, no page error. 0.00% of pixels differ. By eye: the same picture as before the loss.

`restoreContext` is asynchronous. The restored event fired inside the 1.5 s wait. The handlers (`viewer.ts`, `buildmode3d.ts`) ask for a frame. No code change was needed.

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

Measure the 3D renderer, the game's only view. `npm run shot -- --prod` shoots the same build.

### Boot, 2026-11-18 (the menu review)

The optimized build, served with gzip like a real host, Chrome with the real GPU (RTX 5080, ANGLE D3D11), 1600x900, a fresh profile for the cold run and the same profile twice for the warm one. "Boot done" is `booted` (the screen then fades for 0.9 s):

| | Before | After |
|---|---|---|
| Cold, first visit: boot done | 9.8 s | 7.2 s |
| Warm, second visit (HTTP cache, shader cache, GPU process up): boot done | not measured | 3.8 s |
| The menu shows over the screen | after the boot (9.8 s) | 1.2 to 1.5 s cold, 0.2 s warm |
| Slow driver calls (`getProgramInfoLog` over 4 ms), total | 3.1 s (23 calls) | 0.38 s (13 calls) |
| Programs linked at or after the first draw | 18 | 8 (6 depth programs and 2 shaders, no lit program) |
| Longest main-thread task | 3.3 s (the first draw) | 1.2 s (`Room3D`, `Furnishing the room`) |

What bought it: rule 8 (the city's environment, 2 s), rule 9 (the mouse and the hoodie, 0.9 s on the same task), and the sliced city (the longest city task fell from 2.7 s to 0.3 s: the same total, a page that stays alive). The first long task of a cold run (1.1 s before the first paint, in the 2D canvas test of the Pixi chunk) is the browser starting its GPU process: it is absent in a warm browser (first paint at 88 ms). A real visitor has a GPU process already, so judge the cold run without it.

To find a late program: patch `linkProgram`, `shaderSource` and `attachShader` before the page runs, read `#define SHADER_TYPE` and the defines of each program, and diff those linked after the batch against the early program of the same type. The dev server's `window.__board.scene` and `renderer.properties.get(material).currentProgram` then name the meshes that use it. For Build my PC, `window.__build.linking` is its first batch: the programs in `__build.ctx.renderer.info.programs` that are not in it were made later.

### Build my PC, first open (2026-11-18, BOOT-04)

The same build and machine, from the click on the menu's button to the end of the skeleton, in a profile that has run the boot (the driver's cache is warm for the room's programs; the second open is in the same session):

| | Before | After |
|---|---|---|
| First open, click to the first picture | 3.5 s | 1.8 s |
| Second open | 1.4 s | 1.0 s |
| The first draw (one task) | 2.1 s | 0.12 s |
| Slow driver calls (`getProgramInfoLog` over 4 ms) | 15 calls, 0.41 s | 2 to 3 calls, 0.04 s |
| Longest main-thread task | 2.1 s (the first draw) | 1.1 s (`BuildStage.open`: the machine's build) |

The machine's build (`Machine3D`'s constructor, 0.9 s cold, 0.5 s warm) is now the longest task. Where its time goes: the cables (0.23 s: `settle` runs `relax` 0.18 s), `mergeSiblings` (0.19 s), the devices (0.2 s), the rigs (0.13 s). The skeleton's spinner and pulse run on the compositor, so they keep moving; the page does not answer a click meanwhile. The Gallery's first open is in the next section.

### The Gallery's first open (2026-11-18, BOOT-07)

`ProgramGate` (`compile.ts`) is the wait that `BuildStage` made for its first picture, now shared: start the programs, ask the driver each tick, make the first use of each (`prime`) when all have linked, then draw. `mountViewer` (`viewer.ts`) uses it for each new part and each restored context. The click on the menu's button to the part on the stage, in a profile that has run the boot (optimized build, real GPU):

| | Before | After |
|---|---|---|
| Longest task after the click | 381 ms (the first draw) | 192 ms (the context's `getContext`) |
| Other tasks over 50 ms | 195, 76, 58 ms | 61, 55 ms |
| Slow driver calls (`getProgramInfoLog` over 4 ms) | 10 calls, 412 ms | 3 calls, 15 ms |
| Part drawn | +794 ms | +556 ms |

`startPrograms(…, { toCanvas: true })`: the viewer draws to the canvas, tone mapped, and the key of a program holds the tone mapping and the colour space. The default batch is made for a render target (the room's frame, `post.ts`) and has the wrong keys here: the draw then linked 7 programs of its own, 50 ms each, and the first try left 11 programs more than before. The 4 depth programs of the key light's shadow still link at the first shadow draw (15 ms in all; BOOT-02).

### Memory per screen (PHONE-03, 2026-11-16)

Chrome, NVIDIA GeForce RTX 5080 (the page's GL renderer string was not logged), dev build, phone profile (412x915 at 2.6, first-start Low settings). Run: `npm run bench:modes -- out.json --phone --presets default --modes menu,game,gallery,build --views idle --ms 1500`. JS heap is `performance.memory` after a gc. GPU memory is ESTIMATED from sizes (pixels x 4 bytes, x 1.33 with mips; compressed: their levels; buffers: each attribute, index and instance array once). It is not the driver's number. The driver counts come from `renderer.info.memory`.

| Screen | JS heap MB | Textures MB (count) | Buffers MB (count) | Note |
|---|---|---|---|---|
| Menu | 283.0 | 44.8 (75) | 40.6 (1647) | the room only |
| Room (game) | 327.0 | 45.4 (81) | 47.3 (1872) | a new campaign, tutorial off |
| Gallery | 293.1 | 51.2 (91) | 45.9 (2786) | the room is still alive behind it (2 scenes) |
| Build my PC | 442.0 | 177.0 (173) | 99.4 (5103) | the room is still alive behind it (2 scenes) |

Driver counts (textures, geometries): menu 74, 171; room 80, 209; Gallery 84, 467; Build my PC 148, 799.

Ten biggest textures, Build my PC (the owner is the material slot; all are canvas textures except the baked lightmap):

| # | Size | MB | Owner |
|---|---|---|---|
| 1 | 3480x1377 | 24.31 | Mesh, MeshStandardMaterial.map |
| 2 | 3480x1377 | 24.31 | Mesh, MeshStandardMaterial.map |
| 3 | 1360x1340 | 9.25 | Mesh, MeshStandardMaterial.map |
| 4 | 2184x832 | 9.22 | Mesh, MeshStandardMaterial.map |
| 5 | 1760x688 | 6.14 | Mesh, MeshStandardMaterial.map |
| 6 | 2080x572 | 6.04 | Mesh, MeshStandardMaterial.map |
| 7 | 2080x572 | 6.04 | Mesh, MeshStandardMaterial.map |
| 8 | 1280x720 | 4.68 | Mesh, MeshBasicMaterial.map |
| 9 | 1280x720 | 4.68 | Mesh, MeshBasicMaterial.map |
| 10 | 944x1219 | 4.39 | Mesh, MeshStandardMaterial.lightMap (baked room light) |

Ten biggest buffers, Build my PC (the owner is the nearest named object):

| # | Owner | MB |
|---|---|---|
| 1-3 | standin | 1.41 each |
| 4-5 | duvet | 1.14 each |
| 6-7 | standin | 0.94 each |
| 8-10 | standin | 0.85 each |

Baked light files, `public/bake/room` (17 files: PNG maps, `meshes.bin`, `manifest.json`): 11,716,352 bytes, 11.7 MB (11.2 MiB) to download. After PHONE-05 (below) the game downloads 12 KTX2 maps (1.69 MB), `meshes.packed` (0.44 MB) and the manifest: 2.1 MB. The estimate above does not count these maps (they are uniforms of `LightmapMix`, not a material's slot): 12 maps of 944x1219 RGBA8 are 52.7 MB (4.39 MB each) when all are on the GPU; as BC7 they are 13.2 MB (1.10 MB each, read from `mipmaps[0]` of the loaded texture; format 36492).

### First-start download (PHONE-05, 2026-11-16)

`vite build`, served by `vite preview`, a phone profile page (412x915 at 2.6), 30 s from the first request, Chrome on the RTX 5080. The tool counted the body of every response (a scratch script, not kept). "As served" is what `vite preview` sent (it does not compress); "text compressed" gzips the JS, wasm, JSON and `.bin` as a host does, and sends the KTX2 as they are.

| Part | Before (as served) | After (as served) |
|---|---|---|
| Light bake: 12 maps, UVs, manifest | 11.7 MB | 2.1 MB |
| Baked textures `public/tex/` (21 KTX2) | 2.9 MB | 2.9 MB |
| Basis transcoder (wasm, js) | 0.55 MB | 0.55 MB |
| JS (23 files; it was 31 with the drawing worker, 4.0 MB) | 4.0 MB (1.3 MB compressed) | 3.24 MB (1.06 MB compressed) |
| Models, css, the rest | 0.4 MB | 0.3 MB |
| Total | about 19.5 MB (16.4 MB text compressed) | 9.2 MB (6.6 MB text compressed) |

Two things changed in the second run. The first run counted 0.48 MB of `blob:` responses (the KTX2 loaders' workers hold a local copy of the transcoder: no download), so its totals were 0.5 MB too high; the Before column is rebuilt from it by that amount and the bake's change (11.7 minus 2.1 MB), as the old build was not run again. And the shop's drawing worker (`thumbs.worker`, with Pixi: 0.5 MB of JS) now starts with the first tile that has no baked still, not with the renderer (`thumbs.ts`, `startWorker`); the 72 stills cover the rest. Left toward the old 6 MB goal: the city's and the room's normal maps (UASTC, 2.2 MB), the JS and the UVs (0.44 MB; delta and brotli give 0.29 MB, but a `DecompressionStream` has no brotli). The city's normal maps at Low would be 1.35 MB of it; they give the low sun its raking light on the joints, so a Low without them is another look than High, and this decision keeps them (uniformity). RDO on the eight normal maps (tried 2026-11-16, UASTC level 2) gives 2.26 to 2.04, 1.93 or 1.87 MB at RDO levels 1, 2 and 3, and the plaster one halves at level 2: a look risk on the largest surfaces for 0.2 to 0.4 MB, so it stays off.

Doubts: the dev build adds Vite's module code to the heap, so the heap is high. The first reading of the menu heap was 141 MB; this run reads 283 MB and is not reconciled. Render targets that no scene holds (the post target) are not counted. Build my PC textures were 177 MB, above the 150 MB line in PHONE-05; see "Build my PC texture memory at Low" below for the cut to 94.8 MB. The 16 MB material texture budget in `docs/3D_STYLE.md` stays TBD; it is not set here.

### Build my PC texture memory at Low (PHONE-05, 2026-11-16)

`bench:modes --phone --presets default --modes build --views idle` (the estimate counts 4 bytes a texel and a third more for mips): 177.0 MB before, 119.9 MB with the first cut, 94.8 MB now. The 177 MB were not `ArtSurface` tiles: 18 painted canvases of over 1 Mpx held about 158 MB (the NIC top and back masks 3480x1377, 24 MB each; the NVMe masks and labels; the PSU cover; the RAM sticks' PCB face). They come from `maskTop`, `tex()` (`casekit3d.ts`) and `paint()` (`geometry.ts`).

The rule: at Low (`lowDetail()`) a painted sheet over `LOW_SHEET_PX` (300,000 px) is painted on a canvas of half its size per side, a quarter of the memory (`sheetCut` in `detail.ts`; `paintLow` in `geometry.ts` scales the context by it, so the painters keep their own w by h coordinates; `tex()` uses it, and `basement3d.ts` and `ram3d.ts` call it for the PSU cover and the RAM face). It is the art's own Low density: `TEXTURE_LEVELS[0]` is 0.5 and now the Build my PC stage applies it too, as the board's view does (`buildmode3d.ts`; before, Build asked the art for the full density at every level). A cut sheet has its own cache entry (`tex()`: `key@low`; `ram3d.ts`: the cut in the key), so a switch to High paints the full one. Other `paint()` callers (the room's, the small parts') are unchanged.

Shots at the phone profile (412x915 at 2.6, Low, real GPU): the first view and the first zoom differ from the same views before the cut by a mean of 0.002 and 0.012 of 255 (the largest 24 px cell 0.8, at the NVMe labels); a closer view of the NVMe, RAM and cooler shows the label text ("128K"), the barcode, the PCB traces and the RAM fingers sharp. The half-size sheets are 400 to 1,000 px wide for parts that are 150 to 250 px on the phone screen. What stays at the top of the list: the board's level-0 art tile (1360x1340, 9.2 MB), the two NIC masks (1740x689, 6.1 MB each, already cut), the two 1280x720 monitor canvases (4.7 MB each: the screen is drawn at that size for text).

## Asset prerequisites

- **KTX1 (the KTX2 loader) is required.** Before any `.ktx2` file is added, the KTX2 loader must be in place: `ktx2Support` in `gltf.ts` gives the GLTFLoader a `KTX2Loader`, with the Basis transcoder in `public/basis/`. The baked maps (`public/tex/`, 20 files, 3.0 MB) load at `Starting the renderer` (`loadBaked`), and `Building the world` waits for them; the boot time with them is not measured.

## What can still go faster

- **The build (2.8 s).** Pure JS: `plantTrees` and `vertexAo` take about 0.6 s each, `mergeStatic` and `massGeometries` about 0.35 s each. It could store its results, or run in a worker. The city builds a step at a time now; the room does not: `Room3D`'s constructor is one 1.2 s task (the menu, over the screen, cannot answer a hover or a click meanwhile). Its tail (`vertexAo`, `mergeStatic`) could be a generator as the city's `build` is (its fields are `readonly`: they need `!`, as `OutsideView`'s got).
- **The link (about 2 s).** About 118 programs, each about 110 KB of GLSL: 50 of them are the physical material's variants (maps, the room's and the city's lights, `onBeforeCompile` hooks). Fewer variants or fewer lights shorten it directly. `renderer.debug.checkShaderErrors = false` gives nothing: the wait moves from `getProgramInfoLog` to `getProgramParameter`.
- **The first draw (0.6 s).** Texture uploads and first uniforms. `renderer.initTexture` during the link could spread it.
- **Build my PC's machine build (0.9 s cold).** One task, `Machine3D`'s constructor, at the first open (numbers under "Build my PC, first open"). The cables' `settle` (0.18 s) could run in a later task: the cables would hang straight for a frame or two.

**Programs and precision (GFX-05). Decided 2026-11-17: not built.** Measured (real GPU, dev server, `renderer.info.programs`): the menu links 123 programs at the phone's first-start tier: 65 physical or standard, 35 shader materials (the post passes and the city's layers), 12 basic, 7 depth, 4 others. A sandbox game holds 124 at High and 102 at Low. Of the physical ones, 57 share one light set and differ only by their maps and UV channels, the lightmap, and the hooks (`box`, `ao`, `pal`, `haze`); the others take other light counts. So the target of under 60 needs the material work of MACH-01 first (which is parked, `three.md` "Merges"): no cheaper cut reaches it. `mediump` for the post passes and the city gives a gain on phone ALUs only (a desktop GPU runs it as `highp`), and the HDR chain with bloom is where banding shows, so it would need a shot on a phone GPU that this machine cannot give. Phone cost no longer constrains a decision, so neither is done. Take both up again with MACH-01.

To measure: `tools/bench3d.mjs` times frames. For the boot, poll the `.boot-stage` text and the gaps between `requestAnimationFrame`s in a fresh Chrome profile, and a kept profile for the shader cache.

## Swap cost (2026-11-17, ANIM-01 to ANIM-06)

`npm run bench:swap -- out.json` plays four swaps in Build my PC (High, RTX 5080, dev server): RAM out, RAM back, NIC out, CPU out (the cooler, radiator and fans come out first), then the 24-pin unplug. `BuildStage.cost` (`window.__build.cost`) counts full builds, their ms and skipped builds.

| Step | Before | After |
|---|---|---|
| RAM out | 1 build (0.78 s) + 1 skipped | same |
| NIC out | 1 build | 1 build |
| CPU out (with its blockers) | 8 builds, 4.96 s | 1 build, 0.76 s |
| 24-pin unplug | 1 build (old slide) | 0 builds, longest frame gap 31 ms |

How it works. A cable step uses the real plug hand (`PlugHand.pullOut`, `plugIn`; `autoHold` in `plughand3d.ts`): the plug pulls out against its latch, lifts, falls on its rope; plugging in carries it over an arc and pushes it in. No build. `BuildStage.rebuild` builds nothing when `machineKey` is the key of the machine on the stage. In `remove`, a blocker is hidden where it ended (`held`) and shown again, under its new id, when it goes back; only the part that really leaves forces the one build at the job's end. `fit` still builds at the install and at each put-back.

Programs stay at 45 to 47 across the swaps and the longest frame gap equals the build ms, so the hitch is the build, not a program link. Left: patch a single part in place (a fit still builds the whole machine, about 0.7 s).

Update (2026-11-17, later): `fit` now hides the parts in its way, puts them back in the game, forces one build and shows the new part and each restored one going in (`fit` in `buildmode3d.ts`). CPU swap with cooler, radiator and fans: 1 build (0.71 s). `machineKey` sorts its parts, so a part put back in its socket gives the key it had.

Motion (ANIM-05): a hold presses the part in and rocks it (`poseAt`); DIMM latches and the CPU load lever swing with the part (`latchOpen`, `userData.dimm`, `leverOf`; the lever pivot adds 1 draw at High, `highident` regenerated on purpose; a PCIe latch hinge added 4 and was dropped); a card tips out of its slot (`Pose.tilt`). A transform on a named node: no build, no new material.

## Patch, not build (2026-11-17)

`Machine3D.patch(snapshot)` (`machine3d.ts`) changes the machine on the stage by whole sticks, M.2 drives and cards: a part that goes is hidden (not freed: `partLod` knows a part by its hiding) and its entries leave the shared lists (`owned`: what each part added to reveals, fades, spins, obstacles, rails); a part that comes is built alone (`build`) and merged alone (`mergeSiblings` and `shareMaterials` on a holder); the sockets follow (`fill`: DIMM latches, drop boxes, PCIe plates, tags); the memory map and the cables are made again. Any other change (a CPU, a cooler, a radiator, fans, a PSU, a new board or case, ten hidden parts) returns false and the stage builds the machine as before. `BuildStage.rebuild` tries the patch first; `fit` stands a blocker that is still built under its new id (`refit`), so no build is needed for it. `machine3d.patch.test.ts` checks a patched machine against a built one (the same draws and verts per part, the same tagged sockets).

Measured (`bench:swap`, High, RTX 5080): RAM out 0 builds, longest frame gap 150 ms (was 700 ms, one 0.67 s build); RAM back 81 ms; NIC out 150 ms; CPU swap 81 ms; CPU out built once (688 ms) until the CPU, an air cooler, a VRM or memory sink and their fans became patchable too (CPU swap: longest gap 623 ms to 103 ms, no build; the bare socket's gold contacts and its drop box come with the patch, `Board3D.contacts`). A liquid pump, a radiator, case fans, a board or a case still build. The fade of a part now runs across its whole last lift, so a cooler rising over the CPU is gone before it hides the socket (`solidAt`). A patch costs about 50 ms (the cables are 35 ms of it); `cost.patches` and `cost.patchMs` count them.

The side panel opens once, for the first step that needs the inside, and not when it stands open (`BuildStage.door`). A job holds it (`jobOpen`); at the job's end the zoom has it (`Machine3D.setOpen`: it stays while the view is on the board, shuts when the zoom falls under its band). A build keeps its pose (`takeDoor`). The Side panel button reads the real state and shuts it (`closeDoor`).

## Pace of Build my PC (2026-11-17)

Every action plays in about 1 s (`ACTION_SECONDS` in `buildmotion.ts`; the case and the board 1.5 s); the cable hand pulls out in 0.3 s, lifts 0.3 s, falls 0.35 s at most, and carries in 0.4 s. The side panel opens once, when a step needs the inside, waits only for the first 40 % of its swing (`DOOR_WAIT`) and stays open after the job: the player shuts it with its button (a shell or board swap shuts it, it needs the room). In a chain of more than two steps the parts in the way play at 2.5x (`QUICK`); the part the player asked about plays at 1x. Space, Escape or the Skip button fast-forwards the job (6x, `skip()`). Measured with `npm run bench:swap` (wall ms, includes the single 0.5 s build): RAM out 2.1 s (door opening included), NIC out 2.7 s (its cable included), CPU out with six blockers 6.2 s (was 28 s; a fan lead in a chain is pulled 1.8x faster again, `CABLE_QUICK`), the 24-pin 1.0 s.

## Clipping (2026-11-17)

`npm run clip:check` plays each part's way out in small steps and lists the parts whose boxes grow into another part's box (axis-aligned boxes: a slanted part can show a false hit, so look with `npm run shot`). It lists, it does not fail. It skips parts the removal plan takes out first, so a hit is a rule the graph lacks (add it to `COVERS`, `OVER_M2` or `OVER_COOLER` in `sim/removal.ts`). `--preset level,ram,storage,gpus,npus` checks another machine than the maxed one (2026-11-17: the biggest card over the biggest cooler was found this way; cards no longer press down during a hold, they rock).

- A radiator leaves with its fans as one piece (motion `assembly`: screws out through the panel, then all of them along the side opening). The fans sit between the panel and the radiator and are screwed through both, so a fan alone on a radiator's mount uses `fan-rad`: it slides out along the radiator, never through it. `takeOutRadiator`, `putBackAssembly` and the group restore in `fit` play the assembly in both directions.
- The cooler has no twist (even 0.18 rad swung it into the rear fan) and the rear fan pulls straight along the panel, not toward the cooler.
- A twist or a hold's rock turns the part about the centre of its box (`placed`, the pivot in `playAll`; `clipcheck.mjs` does the same). Before, the turn was about the machine's origin and swung the part sideways. The pump (`pump`) twists 0.2 rad about its centre and passes the check.

## Motion curves and fades (2026-11-17)

- `poseAt` runs a monotone cubic (Fritsch–Carlson) per channel through the keys: a part flows through keys on one line and stops only where the path turns. One segment is the old smoothstep.
- A part leaves with a fade over the last 0.3 s of its way (at most 35 % of the motion) and comes in from see-through (`solidAt`, `PartFade`). The 'out' motion ends at its far pose and hides there: no frame at the seat.
- The see-through programs link at each build (`startPrograms` with `fades`, one frame after the build): 20 to 30 ms a build. `bench:swap` now counts 63 to 66 programs (45 to 47 in the table above, before the fades and the brands). The longest frame gap is still the build (+25 ms).
- The loop's hoses (`LoopHoses`) stay live only in Build my PC (`keep`). In the room they join the cooler's group, its merges and its stand-ins: the overview stays at 136 draws, and the cooler draws 9 meshes at High, not 11 (`highident` regenerated on purpose).
- `npm run clip:check` lists no clip over 4% now. It does not test case walls or cables yet.
