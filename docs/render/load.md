# Loading the 3D world

From the page's first paint to the game: the boot screen, the build, the shader link, the menu and the flight into the game. Code: `index.html` (the boot screen), `src/app/boot.ts`, `mountBoard3d` in `board3d.ts`, `src/core/render/three/compile.ts`.

## The order

| Stage (boot screen)                                                                                                                | Bar          | What happens                                                                                                                                                                                                                                                                                                                        | Holds the page?                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `Loading`                                                                                                                          | 0.04         | `index.html` paints the screen before any script runs                                                                                                                                                                                                                                                                               | no                                |
| `Loading the 3D world`                                                                                                             | 0.08         | `main.tsx` imports the 3D chunk                                                                                                                                                                                                                                                                                                     | no                                |
| `Starting the renderer`                                                                                                            | 0.10         | `createRenderContext`, `Post`, the light bake's files start to load (`preloadRoomBake`)                                                                                                                                                                                                                                             | about 0.2 s                       |
| `Building the world` (`Laying the streets`, `Merging the streets`, `Raising the towers`, `Planting the trees`, `Painting the sky`) | 0.14 to 0.28 | `prepareCity`: the city builds a step at a time (`OutsideView.make`), a paint between, so the bar and the menu stay alive; the buildings' massing runs first, while the baked maps load (`early`)                                                                                                                                   | chunks of 0.15 to 0.3 s           |
| `Starting the city shaders`                                                                                                        | 0.28         | the city's sky environment stands, then its programs start (rule 8)                                                                                                                                                                                                                                                                 | about 0.1 s                       |
| `Furnishing the room` (`Setting the desk`, `Shading the corners`, `Tidying the room`)                                              | 0.30 to 0.34 | `Room3D.make`: the room builds in slices, a turn between (no paint: the city's programs link); `Shading the corners` casts the baked occlusion on a pool of workers (`aopool.ts`, `vertexAoPooled`: 0.4 s waiting for them, not 1 s on the page's thread; none with fewer than 4 cores); `rebuild(true, made)` puts it in the scene | 1.2 s in slices of 0.28 s at most |
| `Assembling the machine`                                                                                                           | 0.34         | `rebuild()`: the first machine                                                                                                                                                                                                                                                                                                      | about 0.2 s                       |
| `Loading the light`                                                                                                                | 0.36         | waits for `Room3D.ready` (the bake's lightmap on the meshes) and `modelsIn` (the mouse and the hoodie: rule 9)                                                                                                                                                                                                                      | no                                |
| `Preparing the shaders`                                                                                                            | 0.38 to 0.90 | the first frame starts every program (`startPrograms`) and the frame draws nothing until they link                                                                                                                                                                                                                                  | no, but see "Frames stop"         |
| `Lighting the room`                                                                                                                | 0.92         | the first real frames: the probe takes its bounces                                                                                                                                                                                                                                                                                  | about 0.4 s (first draw)          |
| `Ready`                                                                                                                            | 1            | `bootDone`: the screen fades over 0.9 s; the menu has stood over it since the first paint                                                                                                                                                                                                                                           | no                                |

The bar only grows (`bootStage`). A stage that the page cannot paint before its work is not seen: `nextPaint` waits for a paint before the build. Do not wait for a paint after programs start: the paint waits for the driver. So the room's slices and the gap before the machine only take a `turn` (a timeout of 0), which lets the page breathe.

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

| Mode                                         | default                                         | low (fps unlimited)      |
| -------------------------------------------- | ----------------------------------------------- | ------------------------ |
| Menu, untouched (60 s)                       | 30 to 23                                        | 60 to 34                 |
| Menu, reduced motion (no sway, 20 s, CPU /1) | 30 to 12                                        | not measured             |
| Gallery, Spin on                             | 30 to 30 (the turntable)                        | 62 to 85 (the turntable) |
| Gallery, Spin off (CPU /1)                   | 30 to 0                                         | not measured             |
| Build my PC (15 s)                           | each tick to 5 (its first seconds only, then 0) | each tick to 5           |

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
9. **Models join the scene before the programs start.** A glTF model that comes in after the batch (the mouse and the hoodie came 20 ms after it) links its own programs at its first draw: 0.45 s for the mouse's double-sided standard material and 0.4 s for the hoodie's physical cloth. `loadModel` keeps its loads in `pending`, and `modelsIn()` (`gltf.ts`) waits for them and for their users, or 2 s at most; the boot calls it after `Room3D.ready`. A model that arrives later (a slow network) is held hidden and has its programs started by rule 12. The room's own build holds them: `Room3D.make` gives the page a turn between its slices, and a model that came in during one would reach `mergeStatic`, whose merged meshes the light bake finds by hash (`takeBake`). `mouse` and `deskChair` pass `loadModel(url, until)` the promise of the build's end, so the model joins after it (and `modelsIn` waits for that too).

10. **A first picture waits for its programs and uses each once (Build my PC).** `BuildStage.frame` draws nothing until `programsReady`. The first call starts the machine's programs, the see-through variants of its fades and the passes' (`startPrograms`, `Post.startPrograms`). The ticks after ask the driver without waiting, so the page stays alive. Once all have linked, `prime` makes the first use of each (`getUniforms`, 4 ms a tick). `BuildStage.open` waits for the first picture, so the skeleton stays up until it. A first use waits for the driver to finish every command sent before it. At the first draw those are the scene's uploads: 15 of the 74 programs took 0.41 s that way. With the queue empty the same calls take 0.04 s. After 15 s (`LINK_MAX_MS`) the draw goes on and links what is left.

11. **The shadows' depth programs start with the batch (BOOT-02).** three makes a depth material for each kind of caster when a light first draws its shadow map (`WebGLShadowMap.getDepthMaterial`), and `compile` does not: the first shadow draw linked 6 of them in the room, 4 in the Gallery and 2 more for the city's sun (it has its own lights: other keys). `startShadowPrograms` (`compile.ts`) makes the same materials in the same state (the side opposite to the material's, the maps, the alpha test) and a mesh of each kind of caster (instanced, with colours, skinned, with or without normals), and compiles them in a scene of their own that holds the lights and those meshes. Every key holds the count of lights, and the depth pass draws into a render target with no fog: the scene has none. The materials are kept for the renderer (a disposed one would free its program) and hold no texture. The room's batch, `OutsideView.startPrograms` (the city's sun, and the mirror's blacks: the room's shadow due is drawn in the mirror's render with the blacks as casters), a new machine and the viewer's gate call it. The same batch starts the bake's mix (`LightmapMix.startPrograms`: the `map` / `k` shader that lights the screen) and the probe's calm pass (`Probe.startPrograms`: the sky's `textureCube` shader).

    No program links after the batch now (a `linkProgram` patch, cold boot, the optimized build: 0 after it; 8 before: the 6 depth programs and 2 shaders). The first draw is still one task of about 0.55 s (0.54 to 0.59 s in three runs, as before): the GPU's uploads are in it, and the draw now waits on them in place of the links. Its slow driver calls (`getProgramInfoLog` over 4 ms) fell to about 10 ms in all. On a slower driver the saving should be larger: a late link took 50 to 130 ms on this one. A wake of each program's first use a few a frame (`getUniforms`) before the boot's first draw was tried: it split the first frame's task in two and saved nothing (352 to 394 ms with or without it), so the boot does not keep it. In Build my PC's first open the same step saves 0.5 s (rule 10).

12. **A model that joins late is held hidden until its programs link (BOOT-03).** A model that comes in after the batch (a throttled network: the hoodie 11 s late) linked its own programs at its first draw: one task of 419 ms for the hoodie's physical cloth. `joinModel(parent, model, { prepare, shown, alive })` (`gltf.ts`) replaces `parent.add`. It adds the model, calls `prepare` (the room's `RoomEnv.adopt`: the environment map and the box projection change a material's program key, so they go on before the start), asks the scene's warmer for the model's programs, and hides the model. A `ProgramGate` polls every 16 ms (no paint: a paint waits for the driver). When all have linked and had their first use (`prime`), the model shows and `shown` runs (the mouse hides its stand-in box then; a part's model hides the pieces it replaces). Each screen gives its scene a warmer with `warmLateModels(scene, warm)`: `board3d.ts` (the game and the menu), `viewer.ts` (the Gallery) and `buildmode3d.ts` (Build my PC). Each warms only after its own batch started (`warmed`, `ProgramGate.started`); before that the model is in the batch, and `joinModel` shows it at once. A scene with no warmer (a test) shows it at once too. `alive` stops the wait when the parent is gone (a rebuild or a closed screen). Measured (a 11 s delay on the file, the optimized build): no task over 50 ms with the hoodie or the mouse; before, 419 ms at the join.

## The city stays

`OutsideView` takes about 1.6 s to build and does not depend on the tier, so `room3d/city.ts` keeps one for every room (`theCity`). `Room3D.dispose` takes the quad out of the root, so call it before `disposeTree(room.root)`. `prepareCity` builds it first, a step at a time (`OutsideView.make` runs the constructor's generator `build` and awaits `between` after each of its five steps, which paints and sets the label), and starts its programs, which then link while the room builds. The sync constructor runs the same steps in a row (`defer` is the async path's).

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

|                                      | Before                                 | After                                       |
| ------------------------------------ | -------------------------------------- | ------------------------------------------- |
| Menu                                 | 31.4 MB, 3 contexts                    | 31.3 MB, 3 contexts                         |
| After each Gallery close             | 32.3 to 33.6 MB, 3 contexts            | 32.6 to 33.4 MB, 3 contexts                 |
| After each Build my PC close         | 101, 155, 211, 264, 215 MB; 4 contexts | 37.9, 38.3, 40.4, 40.4, 40.4 MB; 3 contexts |
| Build my PC open, first and fifth    | 6.7 s, 3.7 s                           | 6.7 s, 3.7 s                                |
| Build my PC close, longest frame     | 76 to 121 ms                           | 68 to 82 ms                                 |
| Gallery open, first and fifth; close | 352 ms, 106 ms; 40 to 43 ms            | 340 ms, 107 ms; 27 to 49 ms                 |

The 9 MB that stays after Build my PC does not grow after the third close. About 6 MB of it is V8's compiled code for the screen's modules (machine code, bytecode, feedback): 20 more idle GCs do not drop it. The objects come back to within about 1 MB of the menu. **Decided 2026-11-16 (PHONE-04): the floor is accepted.** After a close the heap is 29 % over the first menu reading (31.3 to 40.4 MB) and is flat from the third close on, so nothing leaks. The 6 MB of compiled code stays with the shared caches that make the next open faster (3.7 s against 6.7 s), and the other 3 MB are caches with a cap (Pixi's text metrics, 1,000 entries). The other way out, loading less code on the main thread (Build my PC imports the whole `Game`), is a split of the module graph with no gain a player sees. The game's start builds a second `Room3D`: `board3d.ts` disposes the first, and the GC collects it.

**Context loss (PHONE-08, 2026-11-16, NVIDIA GeForce RTX 5080, ANGLE D3D11, dev server).** Phone profile (412x915 at 2.6). `WEBGL_lose_context` on the screen's own canvas, then `restoreContext` 1 s later. Pictures taken before the loss and 5.5 s after the restore:

- Gallery: `webglcontextlost` 1, `webglcontextrestored` 1, no page error. 38.6% of pixels differ by more than 24 of 255. The turntable turns (Spin is on); a control run with no loss shows the same turn. By eye: the case draws again, lit, not black or empty.
- Build my PC: `webglcontextlost` 1, `webglcontextrestored` 1, no page error. 0.00% of pixels differ. By eye: the same picture as before the loss.

`restoreContext` is asynchronous. The restored event fired inside the 1.5 s wait. The handlers (`viewer.ts`, `buildmode3d.ts`) ask for a frame. No code change was needed.

## Measured

Chrome, ANGLE D3D11, 1600x900, an optimized build without minifying, to the end of the boot screen (`Ready` is 0.9 s before it):

|                                          | 2026-11-06         | 2026-11-07        |
| ---------------------------------------- | ------------------ | ----------------- |
| First visit (no shader cache)            | 14.5 s             | 7.6 s             |
| Chrome's shader cache kept               | 10.7 s             | 5.8 s             |
| Longest time the main thread is held     | 5.2 s (the build)  | 2.8 s (the build) |
| Programs linked                          | 136                | 118               |
| A game's start at another tier (sandbox) | 2.2 s (a new room) | not measured      |

A game's start at the same tier (a new campaign) builds no room. The dev server adds 4 to 5 s, mostly its module load, before the first stage.

Measure the 3D renderer, the game's only view. `npm run shot -- --prod` shoots the same build.

### Boot, 2026-11-18 (the menu review)

The optimized build, served with gzip like a real host, Chrome with the real GPU (RTX 5080, ANGLE D3D11), 1600x900, a fresh profile for the cold run and the same profile twice for the warm one. "Boot done" is `booted` (the screen then fades for 0.9 s):

|                                                                          | Before                 | After                                                                            |
| ------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| Cold, first visit: boot done                                             | 9.8 s                  | 7.2 s                                                                            |
| Warm, second visit (HTTP cache, shader cache, GPU process up): boot done | not measured           | 3.8 s                                                                            |
| The menu shows over the screen                                           | after the boot (9.8 s) | 1.2 to 1.5 s cold, 0.2 s warm                                                    |
| Slow driver calls (`getProgramInfoLog` over 4 ms), total                 | 3.1 s (23 calls)       | 0.38 s (13 calls)                                                                |
| Programs linked at or after the first draw                               | 18                     | 8 (6 depth programs and 2 shaders, no lit program); 0 after BOOT-02 (rule 11)    |
| Longest main-thread task                                                 | 3.3 s (the first draw) | 1.2 s (`Room3D`, `Furnishing the room`); 0.28 s in the room's step after BOOT-01 |

What bought it: rule 8 (the city's environment, 2 s), rule 9 (the mouse and the hoodie, 0.9 s on the same task), and the sliced city (the longest city task fell from 2.7 s to 0.3 s: the same total, a page that stays alive). The first long task of a cold run (1.1 s before the first paint, in the 2D canvas test of the Pixi chunk) is the browser starting its GPU process: it is absent in a warm browser (first paint at 88 ms). A real visitor has a GPU process already, so judge the cold run without it.

`npm run bench:boot` (BOOT-06, `tools/bench-boot.mjs`) prints this table. It builds the game, serves it with gzip, loads it cold (a fresh profile) and warm (the same profile again) in Chrome on the real GPU, and prints the rows above, the time of each stage and the lists behind the rows: the programs linked at or after the first draw (with their defines), the driver calls that waited, the main-thread tasks over 100 ms. `--runs 3` shows the middle run and the range, `--cpu 4` a slow laptop, `--dist <dir>` skips the build. It starts the browser's GPU process before the cold load, as a visitor's browser has one; `--no-prewarm` leaves that start (about 1.1 s) in the cold run, which is the 1.2 to 1.5 s of the menu row. It exits with 1 when a visit is no measurement (the boot failed, or a stage that it reads was renamed: `Building the world`, `Assembling the machine`, `Lighting the room`). The row to watch for BOOT-05 is `Building the world to Assembling the machine`: 3.2 s cold at `c9a3b58b` (boot done 6.8 to 7.0 s cold, 4.3 s warm, the menu at 0.15 s, 138 programs, none at or after the first draw), 2.7 s cold at `037c5ec4`, 2.3 s with the trees' spline ("The city's heavy steps").

To find which meshes use a late program: the dev server's `window.__board.scene` and `renderer.properties.get(material).currentProgram` name them. For Build my PC, `window.__build.linking` is its first batch: the programs in `__build.ctx.renderer.info.programs` that are not in it were made later.

### The room's build in slices (2026-11-18, BOOT-01)

`Room3D`'s constructor was one task of 1.45 s (`vertexAo` 0.99 s, the bed 0.17 s, `mergeStatic` 0.06 s): the menu over the screen could not answer a hover or a click meanwhile. Its body is now a generator, `assemble`: the constructor runs it in a row (the tests, the later rebuilds), `Room3D.make` runs it a slice at a time, as `OutsideView.make` does the city. A named `yield` (`Setting the desk` 0.2, `Shading the corners` 0.4, `Tidying the room` 0.95 of the step's 0.30 to 0.34) calls `between(label, share)`; a bare one calls `slice`. `board3d.ts` gives both a `turn`: no paint, as the city's programs link. `vertexAoSteps` (`vertexao.ts`) yields after each of its ten groups. The slices, in ms, from `Furnishing the room`: 59 (shell, glass wall, bench), 277 (the bed), 78 (the other furniture), 91 (desk, lamp, the column), then the occlusion groups 42, 75, 159, 210, 73, 253, 30, 20, 3, 33, then the merge and `share` (about 130).

|                                                                    | Before | After                                                             |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| Longest task from `Furnishing the room` to `Preparing the shaders` | 1.45 s | 0.28 s (the bed's builder; the largest occlusion group is 0.25 s) |
| `Furnishing the room` to `Assembling the machine`                  | 1.45 s | 1.65 s (a turn after each of 14 slices)                           |
| Long tasks over 100 ms in that window                              | 1      | 277, 138, 228, 251, 128 ms                                        |

The room is not in the scene while it builds: `rebuild(true, { room, key })` takes it in. `setLayoutTier` runs before `make` (the room reads the layout as it builds), and a made room whose key no longer fits the snapshot (it moved during the build) is disposed and built again. The mouse and the hoodie wait for the end of the build (rule 9). To slice a long occlusion group, `occlusion` (`cloth/occlusion.ts`) would need to keep its state between calls; the largest group is 0.25 s, so it is not done. The groups now run on a pool of workers instead ("The city's heavy steps").

### The city's heavy steps (2026-11-18, BOOT-05, part done)

`Building the world` to `Assembling the machine`, from `npm run bench:boot -- --runs 3` (the set-up above):

|                 | At `c9a3b58b` | At `037c5ec4` | With the spline |
| --------------- | ------------- | ------------- | --------------- |
| Cold            | 3.4 s         | 2.7 s         | 2.3 s           |
| Warm            | 3.1 s         | 2.5 s         | 2.1 s           |
| Boot done, cold | 7.9 s         | 7.0 s         | 6.2 s           |
| Boot done, warm | 4.6 s         | 4.0 s         | 3.4 s           |

The three runs were hours apart on a shared machine. `Merging the streets` read 0.20 s, then 0.15 s with no change to its code: so some of the last column's gain is the machine. The gain of the spline is measured alone: `Planting the trees` 0.32 s to 0.21 s.

The goal of BOOT-05 is under 1.5 s cold. It is not met. What was done:

- **The street merge** (`sweptMerge`, `outside/sweep.ts`): it moves the points of every mesh into shared columns, and builds no geometry for each mesh. 0.38 s to 0.17 s in node; 0.20 s as a stage. The old way stays as `sweptMergeReference`, and `sweep.test.ts` checks that both give the same bytes.
- **The room's occlusion on a pool of workers** (`aopool.ts`, `aojob.ts`, `aojob.worker.ts`, `vertexAoPooled`): the page sends each group to a worker, the largest first, and applies the answers in group order, so the result equals the sync path. A job that fails runs on the page's thread. No pool with fewer than 4 cores. `Shading the corners`: 1.1 s to 0.43 s cold.
- **The buildings' massing during the texture wait** (`massSteps`, `OutsideView.make(…, early)`): the massing runs in slices while the baked maps load, and `build()` takes its result. The net gain is 0.1 s: a part of the texture chain (the loader's import, the uploads) runs on the same thread.
- **A spline that keeps its coefficients** (`spline.ts`, used by `taperTube`): three's `CatmullRomCurve3` works the four coefficients of a piece out again at every `getPoint` (three `Math.pow` calls and the set-up of each axis), and each limb builds a length table of 200 points, so `getPoint` was the top Three cost in a node profile of the city. `Spline` works each piece out once and gives the same bits: `spline.test.ts` compares its points, lengths, tangents, frames and a tube with three's, and the High golden (`highident.expected.json`) did not change. The city build in node: 1.09 s to 0.92 s; `Planting the trees` in the browser: 0.32 s to 0.21 s.
- **The transcoder first** (`loadBaked`: `l.init()` before the 20 files): marks in the page showed the first map 0.37 to 0.41 s after the loader's import and the other 19 within 65 ms, so the wait was a start-up cost; 8 transcoder threads in place of 4 changed nothing. With the transcoder asked first, the last map stands 0.15 to 0.35 s after the loader, in place of 0.43 to 0.53 s (2 to 3 loads each, cold and warm). The stage's total is not measured again.

Where the 2.3 s cold goes now (before the transcoder change): `Building the world` 0.65 s (about 0.28 s of it massing, the rest waits for the baked maps and their loader), `Laying the streets` 0.17 s, `Merging the streets` 0.15 s, `Raising the towers` 0.03 s, `Planting the trees` 0.21 s, `Furnishing the room` 0.41 s, `Setting the desk` 0.09 s, `Shading the corners` 0.42 s, `Tidying the room` 0.15 s, `Assembling the machine` 0.21 s.

What is left, by gain:

- **Massing (0.35 to 0.45 s on the page) is now the longest part of `Building the world`.** One worker for it was built and dropped: the stage fell from 0.65 s to 0.55 s, but the total did not move. Three workers by ring (the largest ring holds a third of the vertices) would cut it to about 0.15 s. Not tried.
- **The first machine (0.21 s) beside the occlusion wait (0.42 s).** `rebuild` and `Room3D.make` would need to split.
- **The turns (not measured).** Each `await turn()` is a `setTimeout(0)` in a chain, which a browser holds for 4 ms after five nested ones; a boot has about 40. A `MessageChannel` turn has no such wait. The massing's turns must stay timers: the texture chain's tasks need the gaps.
- **`sweptMerge` with the matrix maths inline** (0.05 to 0.08 s).
- **Rejected: a baked occlusion.** The room's plants take a running seed, so two builds are not the same and a bake does not match the room; the file would also change with every art edit.
- **Not in this stretch:** a rebuild at a tier change (Low to High) is still one task of about 2.2 s (`new Room3D` is sync), and the cold `Preparing the shaders` (2.7 s) is the GPU driver (BOOT-02, BOOT-03).

### Build my PC, first open (2026-11-18, BOOT-04)

The same build and machine, from the click on the menu's button to the end of the skeleton, in a profile that has run the boot (the driver's cache is warm for the room's programs; the second open is in the same session):

|                                                   | Before                 | After                                          |
| ------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| First open, click to the first picture            | 3.5 s                  | 1.8 s                                          |
| Second open                                       | 1.4 s                  | 1.0 s                                          |
| The first draw (one task)                         | 2.1 s                  | 0.12 s                                         |
| Slow driver calls (`getProgramInfoLog` over 4 ms) | 15 calls, 0.41 s       | 2 to 3 calls, 0.04 s                           |
| Longest main-thread task                          | 2.1 s (the first draw) | 1.1 s (`BuildStage.open`: the machine's build) |

The machine's build (`Machine3D`'s constructor, 0.9 s cold, 0.5 s warm) was then the longest task. Where its time went (ms, inclusive): the cables 231 (`buildCables` 220: `settle` runs `relax` 177, the rigs 100, the room's cords 92), the devices 217 (`nvmeStick` 53, `cpuModel` 42, `cardModel` 39), `share` 187 (`mergeSiblings`' `paletteMesh` 161), the board 107, the stand-ins (`PartLod`) 76, the case 61, the loop's hoses 32. The skeleton's spinner and pulse run on the compositor, so they kept moving; the page did not answer a click meanwhile. The Gallery's first open is in the next section.

#### The machine's build in slices (BOOT-04)

`Machine3D`'s constructor body is a generator, `assemble`, as the room's is (BOOT-01): the constructor runs it in a row (the game's rebuilds, the tests), `Machine3D.make` runs it a slice at a time. A `yield` stands after the case, the board, each device, the hoses, each cable (`cablesSteps`, `buildCables`, `buildRoomCords`) and each set that `mergeSiblingsSteps` merges (`share`), and before the stand-ins. `make` awaits a turn (`setTimeout` 0) only when 30 ms (`SLICE_MS`) have passed since the last one: a fast machine gives few turns, a slow one more, and a task is the budget plus the longest step (the board's model, 0.1 s). `BuildStage.open` builds its first machine this way (`buildFirst`); a later build and the patches stay one task (see "Swap cost"). While the stage has no machine its pointer handlers answer nothing (`idAt`, `partAt`, `slotAt`, `pointerOver`), and `stop` ends the build when the player leaves (`dispose` sets `dead`; `open` returns the closed stage).

| Build my PC, optimized build, real GPU | Before                     | After                                                                                             |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| First open, click to the first picture | 1.8 s                      | 1.8 s                                                                                             |
| Second open                            | 1.0 s                      | 1.1 s                                                                                             |
| Longest main-thread task, first open   | 1.15 s (`BuildStage.open`) | 0.25 s (the WebGL context in `BuildStage`'s constructor); the machine's slices are 0.11 s at most |
| Tasks over 50 ms, first open (ms)      | 1146, 277, 90, 115         | 251, 107, 57, 55, 50, 103, 166, 89, 117                                                           |

The total did not change: the build is 0.9 s of work either way, and the turns between slices cost a few ms. The 0.9 s task is now slices of 0.11 s at most (the profile shows the main thread busy from 0.45 s to 1.45 s after the click, in steps of one device, one cable or one merged set). The next longest tasks: the WebGL context in the stage's constructor (0.25 s, which the stage needs before anything else), and the first frames (0.17 s: the art's tiles bake in them and the programs start).

### The Gallery's first open (2026-11-18, BOOT-07)

`ProgramGate` (`compile.ts`) is the wait that `BuildStage` made for its first picture, now shared: start the programs, ask the driver each tick, make the first use of each (`prime`) when all have linked, then draw. `mountViewer` (`viewer.ts`) uses it for each new part and each restored context. The click on the menu's button to the part on the stage, in a profile that has run the boot (optimized build, real GPU):

|                                                   | Before                  | After                               |
| ------------------------------------------------- | ----------------------- | ----------------------------------- |
| Longest task after the click                      | 381 ms (the first draw) | 192 ms (the context's `getContext`) |
| Other tasks over 50 ms                            | 195, 76, 58 ms          | 61, 55 ms                           |
| Slow driver calls (`getProgramInfoLog` over 4 ms) | 10 calls, 412 ms        | 3 calls, 15 ms                      |
| Part drawn                                        | +794 ms                 | +556 ms                             |

`startPrograms(…, { toCanvas: true })`: the viewer draws to the canvas, tone mapped, and the key of a program holds the tone mapping and the colour space. The default batch is made for a render target (the room's frame, `post.ts`) and has the wrong keys here: the draw then linked 7 programs of its own, 50 ms each, and the first try left 11 programs more than before. The 4 depth programs of the key light's shadow start with the batch too (`startShadowPrograms`, rule 11: they linked at the first shadow draw, 15 ms in all).

### Memory per screen (PHONE-03, 2026-11-16)

Chrome, NVIDIA GeForce RTX 5080 (the page's GL renderer string was not logged), dev build, phone profile (412x915 at 2.6, first-start Low settings). Run: `npm run bench:modes -- out.json --phone --presets default --modes menu,game,gallery,build --views idle --ms 1500`. JS heap is `performance.memory` after a gc. GPU memory is ESTIMATED from sizes (pixels x 4 bytes, x 1.33 with mips; compressed: their levels; buffers: each attribute, index and instance array once). It is not the driver's number. The driver counts come from `renderer.info.memory`.

| Screen      | JS heap MB | Textures MB (count) | Buffers MB (count) | Note                                         |
| ----------- | ---------- | ------------------- | ------------------ | -------------------------------------------- |
| Menu        | 283.0      | 44.8 (75)           | 40.6 (1647)        | the room only                                |
| Room (game) | 327.0      | 45.4 (81)           | 47.3 (1872)        | a new campaign, tutorial off                 |
| Gallery     | 293.1      | 51.2 (91)           | 45.9 (2786)        | the room is still alive behind it (2 scenes) |
| Build my PC | 442.0      | 177.0 (173)         | 99.4 (5103)        | the room is still alive behind it (2 scenes) |

Driver counts (textures, geometries): menu 74, 171; room 80, 209; Gallery 84, 467; Build my PC 148, 799.

Ten biggest textures, Build my PC (the owner is the material slot; all are canvas textures except the baked lightmap):

| #   | Size      | MB    | Owner                                                  |
| --- | --------- | ----- | ------------------------------------------------------ |
| 1   | 3480x1377 | 24.31 | Mesh, MeshStandardMaterial.map                         |
| 2   | 3480x1377 | 24.31 | Mesh, MeshStandardMaterial.map                         |
| 3   | 1360x1340 | 9.25  | Mesh, MeshStandardMaterial.map                         |
| 4   | 2184x832  | 9.22  | Mesh, MeshStandardMaterial.map                         |
| 5   | 1760x688  | 6.14  | Mesh, MeshStandardMaterial.map                         |
| 6   | 2080x572  | 6.04  | Mesh, MeshStandardMaterial.map                         |
| 7   | 2080x572  | 6.04  | Mesh, MeshStandardMaterial.map                         |
| 8   | 1280x720  | 4.68  | Mesh, MeshBasicMaterial.map                            |
| 9   | 1280x720  | 4.68  | Mesh, MeshBasicMaterial.map                            |
| 10  | 944x1219  | 4.39  | Mesh, MeshStandardMaterial.lightMap (baked room light) |

Ten biggest buffers, Build my PC (the owner is the nearest named object):

| #    | Owner   | MB        |
| ---- | ------- | --------- |
| 1-3  | standin | 1.41 each |
| 4-5  | duvet   | 1.14 each |
| 6-7  | standin | 0.94 each |
| 8-10 | standin | 0.85 each |

Baked light files, `public/bake/room` (17 files: PNG maps, `meshes.bin`, `manifest.json`): 11,716,352 bytes, 11.7 MB (11.2 MiB) to download. After PHONE-05 (below) the game downloads 12 KTX2 maps (1.69 MB), `meshes.packed` (0.44 MB) and the manifest: 2.1 MB. The estimate above does not count these maps (they are uniforms of `LightmapMix`, not a material's slot): 12 maps of 944x1219 RGBA8 are 52.7 MB (4.39 MB each) when all are on the GPU; as BC7 they are 13.2 MB (1.10 MB each, read from `mipmaps[0]` of the loaded texture; format 36492).

### First-start download (PHONE-05, 2026-11-16)

`vite build`, served by `vite preview`, a phone profile page (412x915 at 2.6), 30 s from the first request, Chrome on the RTX 5080. The tool counted the body of every response (a scratch script, not kept). "As served" is what `vite preview` sent (it does not compress); "text compressed" gzips the JS, wasm, JSON and `.bin` as a host does, and sends the KTX2 as they are.

| Part                                                     | Before (as served)                      | After (as served)               |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| Light bake: 12 maps, UVs, manifest                       | 11.7 MB                                 | 2.1 MB                          |
| Baked textures `public/tex/` (21 KTX2)                   | 2.9 MB                                  | 2.9 MB                          |
| Basis transcoder (wasm, js)                              | 0.55 MB                                 | 0.55 MB                         |
| JS (23 files; it was 31 with the drawing worker, 4.0 MB) | 4.0 MB (1.3 MB compressed)              | 3.24 MB (1.06 MB compressed)    |
| Models, css, the rest                                    | 0.4 MB                                  | 0.3 MB                          |
| Total                                                    | about 19.5 MB (16.4 MB text compressed) | 9.2 MB (6.6 MB text compressed) |

Two things changed in the second run. The first run counted 0.48 MB of `blob:` responses (the KTX2 loaders' workers hold a local copy of the transcoder: no download), so its totals were 0.5 MB too high; the Before column is rebuilt from it by that amount and the bake's change (11.7 minus 2.1 MB), as the old build was not run again. And the shop's drawing worker (`thumbs.worker`, with Pixi: 0.5 MB of JS) now starts with the first tile that has no baked still, not with the renderer (`thumbs.ts`, `startWorker`); the 72 stills cover the rest. Left toward the old 6 MB goal: the city's and the room's normal maps (UASTC, 2.2 MB), the JS and the UVs (0.44 MB; delta and brotli give 0.29 MB, but a `DecompressionStream` has no brotli). The city's normal maps at Low would be 1.35 MB of it; they give the low sun its raking light on the joints, so a Low without them is another look than High, and this decision keeps them (uniformity). RDO on the eight normal maps (tried 2026-11-16, UASTC level 2) gives 2.26 to 2.04, 1.93 or 1.87 MB at RDO levels 1, 2 and 3, and the plaster one halves at level 2: a look risk on the largest surfaces for 0.2 to 0.4 MB, so it stays off.

Doubts: the dev build adds Vite's module code to the heap, so the heap is high. The first reading of the menu heap was 141 MB; this run reads 283 MB and is not reconciled. Render targets that no scene holds (the post target) are not counted. Build my PC textures were 177 MB, above the 150 MB line in PHONE-05; see "Build my PC texture memory at Low" below for the cut to 94.8 MB. The 16 MB material texture budget in `docs/3D_STYLE.md` stays TBD; it is not set here.

### Build my PC texture memory at Low (PHONE-05, 2026-11-16)

`bench:modes --phone --presets default --modes build --views idle` (the estimate counts 4 bytes a texel and a third more for mips): 177.0 MB before, 119.9 MB with the first cut, 94.8 MB now. The 177 MB were not `ArtSurface` tiles: 18 painted canvases of over 1 Mpx held about 158 MB (the NIC top and back masks 3480x1377, 24 MB each; the NVMe masks and labels; the PSU cover; the RAM sticks' PCB face). They come from `maskTop`, `tex()` (`casekit3d.ts`) and `paint()` (`geometry.ts`).

The rule: at Low (`lowDetail()`) a painted sheet over `LOW_SHEET_PX` (300,000 px) is painted on a canvas of half its size per side, a quarter of the memory (`sheetCut` in `detail.ts`; `paintLow` in `geometry.ts` scales the context by it, so the painters keep their own w by h coordinates; `tex()` uses it, and `basement3d.ts` and `ram3d.ts` call it for the PSU cover and the RAM face). It is the art's own Low density: `TEXTURE_LEVELS[0]` is 0.5 and now the Build my PC stage applies it too, as the board's view does (`buildmode3d.ts`; before, Build asked the art for the full density at every level). A cut sheet has its own cache entry (`tex()`: `key@low`; `ram3d.ts`: the cut in the key), so a switch to High paints the full one. Other `paint()` callers (the room's, the small parts') are unchanged.

Shots at the phone profile (412x915 at 2.6, Low, real GPU): the first view and the first zoom differ from the same views before the cut by a mean of 0.002 and 0.012 of 255 (the largest 24 px cell 0.8, at the NVMe labels); a closer view of the NVMe, RAM and cooler shows the label text ("128K"), the barcode, the PCB traces and the RAM fingers sharp. The half-size sheets are 400 to 1,000 px wide for parts that are 150 to 250 px on the phone screen. What stays at the top of the list: the board's level-0 art tile (1360x1340, 9.2 MB), the two NIC masks (1740x689, 6.1 MB each, already cut), the two 1280x720 monitor canvases (4.7 MB each: the screen is drawn at that size for text).

## Asset prerequisites

- **KTX1 (the KTX2 loader) is required.** Before any `.ktx2` file is added, the KTX2 loader must be in place: `ktx2Support` in `gltf.ts` gives the GLTFLoader a `KTX2Loader`, with the Basis transcoder in `public/basis/`. The baked maps (`public/tex/`, 20 files, 3.0 MB) load at `Starting the renderer` (`loadBaked`), and `Building the world` waits for them; the boot time with them is not measured.

## What can still go faster

- **The build (2.3 s cold from `Building the world` to `Assembling the machine`).** Pure JS. The city and the room build a step at a time, the room's occlusion runs on workers, the buildings' massing overlaps the texture wait and the trees' tubes use a spline that keeps its coefficients. What is left, by gain, is in "The city's heavy steps": massing in a worker, the first machine beside the occlusion wait, the turns.
- **The link (about 2 s).** About 118 programs, each about 110 KB of GLSL: 50 of them are the physical material's variants (maps, the room's and the city's lights, `onBeforeCompile` hooks). Fewer variants or fewer lights shorten it directly. `renderer.debug.checkShaderErrors = false` gives nothing: the wait moves from `getProgramInfoLog` to `getProgramParameter`.
- **The first draw (0.55 s).** Texture and geometry uploads: no program links in it now (rule 11). `renderer.initTexture` during the link could spread it.
- **Build my PC's machine build (0.9 s cold).** It runs in slices now (BOOT-04), so the page answers meanwhile; the work is the same. The cables' `settle` (0.18 s) could be cached or baked; the second build in a session reads it from `hang`'s cache.

**Programs and precision (GFX-05). Decided 2026-11-17: not built.** Measured (real GPU, dev server, `renderer.info.programs`): the menu links 123 programs at the phone's first-start tier: 65 physical or standard, 35 shader materials (the post passes and the city's layers), 12 basic, 7 depth, 4 others. A sandbox game holds 124 at High and 102 at Low. Of the physical ones, 57 share one light set and differ only by their maps and UV channels, the lightmap, and the hooks (`box`, `ao`, `pal`, `haze`); the others take other light counts. So the target of under 60 needs the material work of MACH-01 first (which is parked, `three.md` "Merges"): no cheaper cut reaches it. `mediump` for the post passes and the city gives a gain on phone ALUs only (a desktop GPU runs it as `highp`), and the HDR chain with bloom is where banding shows, so it would need a shot on a phone GPU that this machine cannot give. Phone cost no longer constrains a decision, so neither is done. Take both up again with MACH-01.

To measure: `tools/bench3d.mjs` times frames. For the boot, poll the `.boot-stage` text and the gaps between `requestAnimationFrame`s in a fresh Chrome profile, and a kept profile for the shader cache.

## Swap cost (2026-11-17, ANIM-01 to ANIM-06)

`npm run bench:swap -- out.json` plays four swaps in Build my PC (High, RTX 5080, dev server): RAM out, RAM back, NIC out, CPU out (the cooler, radiator and fans come out first), then the 24-pin unplug. `BuildStage.cost` (`window.__build.cost`) counts full builds, their ms and skipped builds.

| Step                        | Before                       | After                             |
| --------------------------- | ---------------------------- | --------------------------------- |
| RAM out                     | 1 build (0.78 s) + 1 skipped | same                              |
| NIC out                     | 1 build                      | 1 build                           |
| CPU out (with its blockers) | 8 builds, 4.96 s             | 1 build, 0.76 s                   |
| 24-pin unplug               | 1 build (old slide)          | 0 builds, longest frame gap 31 ms |

How it works. A cable step uses the real plug hand (`PlugHand.pullOut`, `plugIn`; `autoHold` in `plughand3d.ts`): the plug pulls out against its latch, lifts, falls on its rope; plugging in carries it over an arc and pushes it in. No build. `BuildStage.rebuild` builds nothing when `machineKey` is the key of the machine on the stage. In `remove`, a blocker is hidden where it ended (`held`) and shown again, under its new id, when it goes back; only the part that really leaves forces the one build at the job's end. `fit` still builds at the install and at each put-back.

Cables with a part. A cable exists only with its part (`standing`: connected, or not blocked). When the part comes out, `PlugHand.pullOut` unplugs each plugged cable and `PlugHand.stow` takes it back into its hole (`reelAt`: the strand shortens from the plug, the plug shrinks into the slot; `reelTime`, `reelShare` set the pace), one cable after the other. When the part goes in, `BuildStage.holdReeled` keeps its cables out of sight (`Machine3D.holdBack`), and `PlugHand.feed` runs each out of its hole to its socket and plugs it (a video cable only lies where it falls). The case's front-panel leads (`panel:F_PANEL`, `panel:USB_2`, `panel:USB_3`, `panel:ARGB`; `panelRigs` in `casetray3d.ts`) are inert rigs, not sim cables: the stage keeps which are out (`panelOut`, shared with the machine by `syncPanel`) and shows them to the hand as snapshot cables. They come off and go back into the hole when a board comes out (`fitShell`), and run out to the new board's headers when it is in. Whatever the hand did, `panelHome` and `releaseReeled` put everything back at the job's end.

Programs stay at 45 to 47 across the swaps and the longest frame gap equals the build ms, so the hitch is the build, not a program link. Left: patch a single part in place (a fit still builds the whole machine, about 0.7 s).

Update (2026-11-17, later): `fit` now hides the parts in its way, puts them back in the game, forces one build and shows the new part and each restored one going in (`fit` in `buildstage/fit.ts`). CPU swap with cooler, radiator and fans: 1 build (0.71 s). `machineKey` sorts its parts, so a part put back in its socket gives the key it had.

Motion (ANIM-05): a hold presses the part in and rocks it (`poseAt`); DIMM latches and the CPU load lever swing with the part (`latchOpen`, `userData.dimm`, `leverOf`; the lever pivot adds 1 draw at High, `highident` regenerated on purpose; a PCIe latch hinge added 4 and was dropped); a card tips out of its slot (`Pose.tilt`). A transform on a named node: no build, no new material. The motion adds to the part's own turn and never replaces it (2026-11-19): `step` writes `rotation.y = baseTilt + tilt` and `rotation.z = baseTurn + turn`, and a held part (`held`, `refit`) keeps its `y` and `z`. A fan on a tower heatsink is built turned a quarter about y (its axis along the fins) and the monitor stands at a yaw; the old `rotation.y = tilt` laid the fan flat across the fins after its first motion, and the monitor lost its yaw. `buildmode3d.pose.test.ts` checks it. A bare CPU socket shows its lever lifted, as a bare memory socket shows its latches open (`LEVER_OPEN` in `boardhw3d.ts`; `boardModel` draws it so, `Machine3D.fill` follows a patch): a removal leaves the lever where its motion ended, and a build after it must agree (`machine3d.lever.test.ts`; `npm run animcheck` found a 1.3 rad jump at the next build).

## Patch, not build (2026-11-17)

`Machine3D.patch(snapshot)` (`machine/patch.ts`) changes the machine on the stage by whole sticks, M.2 drives and cards: a part that goes is hidden (not freed: `partLod` knows a part by its hiding) and its `PartBuild` leaves `parts`, the one map from part key (`spec@slot`) to what the part made (`parts.ts`: roots, reveals, fades, spins, obstacles, rails, skins, card, stick, drive, cooler); the flat lists and the machine-wide values (RAM bank rect, pump, cooler group) are made again from that map (`relist`); a part that comes is built alone (`buildPart`) and merged alone (`mergeSiblings` and `shareMaterials` on a holder); the sockets follow (`fill`: DIMM latches, drop boxes, PCIe plates, tags); the memory map and the cables are made again. Any other change (a CPU, a cooler, a radiator, fans, a PSU, a new board or case, ten hidden parts) returns false and the stage builds the machine as before. `BuildStage.rebuild` tries the patch first; `fit` stands a blocker that is still built under its new id (`refit`), so no build is needed for it. `machine3d.patch.test.ts` checks a patched machine against a built one (the same draws and verts per part, the same tagged sockets).

Measured (`bench:swap`, High, RTX 5080): RAM out 0 builds, longest frame gap 150 ms (was 700 ms, one 0.67 s build); RAM back 81 ms; NIC out 150 ms; CPU swap 81 ms; CPU out built once (688 ms) until the CPU, an air cooler, a VRM or memory sink and their fans became patchable too (CPU swap: longest gap 623 ms to 103 ms, no build; the bare socket's gold contacts and its drop box come with the patch, `Board3D.contacts`). A liquid pump, a radiator, case fans, a board or a case still build. The fade of a part now runs across its whole last lift, so a cooler rising over the CPU is gone before it hides the socket (`solidAt`). A patch costs about 50 ms (the cables are 35 ms of it); `cost.patches` and `cost.patchMs` count them.

The side panel opens once, for the first step that needs the inside, and not when it stands open (`BuildStage.door`). A job holds it (`jobOpen`); at the job's end the zoom has it (`Machine3D.setOpen`: it stays while the view is on the board, shuts when the zoom falls under its band). A build keeps its pose (`takeDoor`). The Side panel button reads the real state and shuts it (`closeDoor`).

A steel panel (the Mini's, and the Micro's window that shows only the upper part: `DOOR_SEES` in `casedoor.ts`) hides every step behind it, so the stage keeps it open (2026-11-19). A job that ends with it open leaves it to the player (`wantOpen`), a swap of the machine opens it (`swapIn`), and a step waits until it has swung clear (`doorWait`: 0.4 of its swing for the glass doors, about 0.8 for the Mini's, which first undoes its screws and slides off). The wait is the clock's first, then the panel's own position (`BuildStage.swung`, `Machine3D.doorT`): `frameDt` caps a frame at 0.1 s, so after a hitch the panel is behind the clock, and the animation matrix caught a step that began with the Full tower's glass door at 0.31 of its swing (clear at 0.40). A panel the zoom is still opening is waited for too; a stage that draws no frames gives up after three swings. The panel keeps the pace of the steps (`Machine3D.frame` gets `doorDt`). A new case or board (`fitShell`) is asked of the game first (`shellRefusal`: nothing lifts for a refusal); a glass door shuts before the board lifts, as ever; a steel one stays open for the board, shuts for the case, and opens again for the new board. A board too big for its case brings the next case with it (the sandbox lets the case follow the board), played as a case swap. The empty start is nothing (`BuildStage.shown`, `Shown` in `sim/buildspecs.ts`): `Machine3D` is built with `shown: 'nothing'` (no case, no door: every door call is a no-op; `machineKey(s, 'nothing')` is one key whatever the game holds aside). The first case is brought in from the shelf: it comes down as in a case swap, with nothing to take away, then a steel panel opens. A bare case (`shown: 'case'`) builds with `Machine3D.buildEmpty` (the case, its standoffs and the coiled leads, no board, part or cable; `machineKey(s, 'case')` keys it by the case alone, `patch` and the cable sync do nothing); a board fitted to it skips the lift-out, and its lowering is the same as a swap's.

## Pace of Build my PC (2026-11-17)

Every action plays in about 1 s (`ACTION_SECONDS` in `buildmotion.ts`; the case and the board 1.5 s); the cable hand pulls out in 0.3 s, lifts 0.3 s, falls 0.35 s at most, and carries in 0.4 s. The side panel opens once, when a step needs the inside, waits until it has swung clear (`doorWait`: 40 % of its swing for a glass door, more for a steel panel) and, when it is steel, stays open after the job: the player shuts it with its button (a case swap shuts it, it needs the room). In a chain of more than two steps the parts in the way play at 2.5x (`QUICK`); the part the player asked about plays at 1x. Space, Escape or the Skip button fast-forwards the job (6x, `skip()`). Measured with `npm run bench:swap` (wall ms, includes the single 0.5 s build): RAM out 2.1 s (door opening included), NIC out 2.7 s (its cable included), CPU out with six blockers 6.2 s (was 28 s; a fan lead in a chain is pulled 1.8x faster again, `CABLE_QUICK`), the 24-pin 1.0 s.

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
