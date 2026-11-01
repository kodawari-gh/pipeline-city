# Low-Poly 3D Graphics Overhaul

## Vision

Replace PixiJS 2D isometric rendering with a low-poly 3D graphics pipeline. This enables:
- **Scalability**: Smooth zoom from micro-detail to factory overview without LOD switching artifacts
- **Depth perception**: True 3D space for hardware relationships and spatial understanding
- **Modern aesthetics**: Clean, geometric low-poly style fits computing hardware theme
- **Flexible cameras**: Orbiting views, flyovers, and custom perspectives
- **Asset reusability**: A single 3D model works at all zoom levels and angles

## Current State

**PixiJS 2D pipeline:**
- Isometric view with 2D sprites and vector graphics
- Multiple LOD layers (far bake at 0.4x, medium at 0.25x, near at full detail)
- Camera fly animations, zoom bands per device
- Text rasterization, heat/state overlays

**Render entry:** `src/core/render/board.ts` mounts the scene; `live.ts` feeds snapshots to Pixi views.

## Target Architecture

```
Worker (sim)           Main thread (render)
┌──────────────┐       ┌──────────────────────┐
│ Snapshot     │────►  │ 3D Camera & Viewport │
│ (game state) │       │ WebGL (Three.js/Babylon)
└──────────────┘       │ Low-poly models      │
                       │ Material system      │
                       │ Live overlays (UI)   │
                       └──────────────────────┘
```

**Key changes:**
1. **Graphics engine**: Replace PixiJS with Three.js or Babylon.js
2. **Asset pipeline**: Convert 2D art to low-poly 3D models (gltf/glb format)
3. **Camera system**: Orthographic for board overview, perspective for detail
4. **Shaders**: Simple flat/smooth shading, outline post-process, color-by-state
5. **UI integration**: Keep Preact UI, render 3D to canvas, overlay HTML panels

## Status (2026-10-31)

The owner chose **room first** and the **stylised warm** look (see `LOWPOLY_STYLE.md` "Look decision"). The 3D renderer runs behind a flag; Pixi stays the default.

- **Turn it on**: `?3d` in the address, or `VITE_3D_GRAPHICS=1` at build time (`src/app/main.tsx`; the Three.js code loads only then). Screenshot: `npm run shot -- out.png --3d [--view room|board|cpu]`.
- **Shared code** `src/core/render/three/`: `init` (renderer, ACES tone mapping, shadows, a studio environment map), `camera` (pure orbit maths: target, yaw, pitch, view height, fov; a narrow fov reads nearly orthographic, so the ortho/perspective blend is a fov tween), `materials` (palette, `partLook` state looks, `PartSkin` eases them), `geometry` (boxes over layout rects, soft boxes, tubes, instancing, canvas textures), `pick` (raycast to the 2D hover ids), `post` (ambient occlusion that skips glass and sprites, outline, bloom for the neon, output).
- **Room** `src/features/room/render/three/`, modelled on the owner's reference image (front-on framing, early afternoon by default, `START_HOUR_3D`): `room3d.ts` (dense dark slat wall, white window with sill, sky, low-poly city and blind, dark desk with drawers, key rack with the tray keys, router shelf with its LAN lead, letterbox, wall plates, light planks, blue triangle rug; sun or moon by the game hour, a soft front key light, lamp spot, screen glow), `props3d.ts` (architect lamp, monitor with the standby card or the live text, digital clock, mug with steam, plant, keyboard, mouse, city, sky), `roomplan.ts` (pure: depths, slat runs, daylight).
- **Case showcase**: dark PCB with traces, the shroud printed `PIPELINE CITY`, RGB strips inside. The lights glow only while the machine runs.
- **Four real cases** (`case3d.ts`, 2026-11-01): each tier is its 2D case built as a box over its side-view outline (`outlinePts`: rounded or chamfered corners, the window cut out of the side sheet). Mini: cream OEM, solid side (pressed panel, vent patch, screws, label), a plastic front with bay covers, round feet. Micro: matte black, a smoked window over the upper part, a debossed mark, rubber rails. Mid: blue-black, a mesh cap on the cut top front corner, slanted vents, a bezel round the cut-corner window, six-zone RGB under the glass, a lit plate, splayed feet. Full: chamfered graphite, silver pillars and rails, a lit edge round the glass, lit pillar slots and top fan windows, hex intake, two name plates, feet on silver plates. The shroud takes the case's tone; the plain cases have no RGB. The accent strip on the front rim follows the machine's state as in 2D (`stripLight`).
  - *Opening* (`casedoor.ts`, `Machine3D.swingDoor`): the side panel hangs from its front edge and swings out 105 degrees, toward the viewer east of the case, clear of the board view. The Mini first undoes its two thumbscrews and slides its panel back off its hooks, the Micro pops off its push latches, the Mid's glass door overshoots a little on its hinges, the Full tower's heavy glass is damped. It opens over 0.92 of the board view's zoom and shuts under 0.82; a click on the shut side (`case.side`, an unseen plate) or the O key opens or shuts it until the zoom crosses the band again; a drag into the case or a tutorial target inside opens it (`setOpen`; a key, a desk cable or an outside target do not).
  - *Details* (`casedetail3d.ts`, the kit in `casekit3d.ts`): the walls are real (`clipY` for the top and the floor, `wallX` for the rear and front walls with openings). Rear: the slot row behind a retention bar with a thumbscrew per slot (blank covers for the slots the board lacks), the exhaust fan behind a honeycomb grille (the Mini: a punched grille), the board's I/O shield with the ports it has where the LAN, video and key plugs go in (`ioShield`). Front intake: the Mid's full mesh between two light bars and the Full tower's hex mesh in a silver frame, both open in front of the fans; the Micro's solid front with a perforated gap down each side; the Mini's grille. A PSU dust filter tab under the Mid and Full. Top: a mesh filter over the top fans, and the controls of each kind (`controls`): the Mini's square button and lamps on its plastic front with its ports and reset on the face; a top I/O panel on the others (the Micro's flush button in a white ring, the Mid's hexagonal button in an RGB ring, the Full tower's machined knob in a pink ring; USB-A, USB-C and audio by tier). The `on` light is the ring, `err` a red pip, `disk` blinks while a drive is busy. Cable management: tie points beside the board, the kind's cut-outs (the Micro's rubber slot, the Mid's slanted ones, the Full tower's rimmed slots on a hex tray), and grommets finished as the kind does (`GROMMETS`: rolled steel, rubber, brushed aluminium). Painted steel has a grain bump, the showcase is brushed.
  - Dev: `__board.previewCase(t)` shows tier `t` empty, `__board.caseView(yaw, pitch)` frames the case, `__board.lookAt(x, y, z, yaw, pitch, height)` looks close, `__board.toggleDoor()`.
- **Coolers after the 2D art** (`cooler3d.ts`, `fans3d.ts`): the stock cooler's radial vanes under its fan, the tower's notched fin plates with copper heat pipes arching through them and its fan on the east end, the loop's pump head (brushed ring, ring light, impeller under a glass dome) with two stiff braided hoses (`hose`, hung as cables are) to a radiator built from the 2D slab (tanks, fin core, one fan per mount, barbs).
- **Inside the case: real parts, not flattened ones** (2026-11-01). The 2D had to lay every part flat to show its face; in 3D each part takes its real pose, and a close look brings the 2D face back:
  - *RAM* (`ram3d.ts`): a stick stands in its socket, its gold fingers in the groove, a latch hooked into the notch at each end (open on an empty socket). The look follows the generation: bare green PCB (SDR and the server ECC sticks), a low clip-on spreader (DDR2), a finned crown (DDR3), a spreader under a frosted RGB light bar (DDR4, DDR5). The chips sit where the 2D chips are. In the RAM band the camera leans about 40 degrees (`Machine3D.lean`, board3d.ts) to read the faces in a row, and the spreaders fade to the chips, which show the live memory map as the 2D sticks do (`rammap3d.ts`: the pages in their owner's colour, stronger the fuller, `pageCells`; the open rows outlined), painted on the chips' east faces at most five times a second.
  - *Cards* (`card3d.ts`): a GPU, NPU or NIC stands out of its PCIe slot on edge, the finger tab in the slot, the bracket against the back wall with its ports. A GPU's fans face down to the PSU shroud, its backplate up, its light bar and power sockets on the top edge toward the glass; the PCIe leads climb over the cards and plug in from above (`standingPlug`). The NPU has a blower shroud, the NIC its sink and RJ45 jacks. The card is built in the 2D pose and stood up on a hinge along the slot: in its 2D band (read at the card's point nearest the view's centre) the cooler, backplate, bracket and leads fade, then the card swings down flat and shows its exact 2D face (G frames the die). Empty slots show the case's vented covers (`slotCover`).
  - *Board parts* (`parts3d.ts`): the NVMe stick lies on its socket and brass standoff (thin PCB, controller, finned spreader, the screw over the notch); the chipset's low heat sink stands where the 2D draws it; the coin cell sits in its holder under its clip; the TPM module stands on a female connector over its header; a hard disk is a cast base with its lid inset and screwed, an SSD a two-part shell, both with SATA sockets; the board's mounting screws stand up (`Solid` `screw`).
  - *State looks*: wide parts (sticks, cards, coolers, PSU) glow at 0.3 of the state's level (`PartSkin` gain), so a running part keeps its own colours.
  - *Basement* (`basement3d.ts`, 3D only: the 2D keeps its column of bays): under the shroud, the power supply at a real size in the back corner by its mains inlet (rear grille, inlet and switch in the case's back wall); beside it a stepped cage, the drives standing face to the glass in two rows, the back row raised over the front one (`basementPlan`, every tier fits). The shroud's panel over the PSU carries the print and answers a click as the PSU; over the cage it is open. A drive is the 2D drive moved into its bay (`intoBay`; `ArtSurface` follows its parents' transform, so a moved or turned part keeps its art).
  - *Cables* (`wires3d.ts`, `core/render/three/rope.ts`): every cable hangs under its own weight. `hang` settles a chain of points (Verlet steps, segment lengths, a bend limit so slack makes loops and never folds into zigzags, the planes and boxes it lies on or goes round), each end leaving its plug straight. A power lead comes out of a rubber grommet in the tray beside its socket (the run from the PSU is behind the tray) as a comb of sleeved strands, one per pin column: the 24-pin into a right-angle socket on the board's east edge, the CPU 8-pin down into its socket from the glass side, the PCIe leads into the cards' top edges. A lead that is out hangs loose from its grommet with its plug at the end. The sockets are modelled with their cavities and latch ridges; each drive's red SATA cable runs from its right-angle port into the gutter, and from the drive's end back through the cage. The fans' cords run to their headers and from the slot over the hub to the hub's headers. Out of the case the video cable drapes over the desk into the monitor, the mains cords drop through the desk's grommet to the wall socket, the LAN lead hangs from the router into the rear panel.
  - *Live dies* (`chips3d.ts`): the CPU's die, a GPU's and an AI card's run as in 2D. The 2D views themselves run (`DieView`, `GpuView`, `NpuCardView` in their bare mode: only what moves; the still die is the face's baked art), fed the same snapshots and the same clock, eased by the zoom (`zoomSlow`, the HUD's slow-motion note). A card reads its zoom at its point nearest the view's centre, as its swing does (`deviceLod` `near`). Each face draws the part of it in view at the screen's density on a plane over its art (`drawLive`: the offscreen Pixi renderer, at most 30 times a second, only while the lid has faded or the card has swung down). An AI card's face is its die, not its lid (the blower is the lid). A core's access to a card shows inside it (`routeOnDie`, `npuAccess`).
- **Machine** `src/features/board/render/three/`: `machine3d.ts` (glass-side case, board with its sockets, every part kind as primitives, case fans with RGB rings, ATX / CPU / video cables, wall cords, the plugged key; state looks and fan spin from the snapshot), `board3d.ts` (the mount: rebuilds on snapshot changes, camera input, picking, the same `hover` / `selected` signals and quick actions as `Interact.click`, outline on hover, selection and tutorial targets).
- **Parts**: `drag3d.ts` drags an inventory part onto a socket (fitting sockets are outlined; the drop installs or says why not) and lifts an installed part to the inventory shelf (unmounts it). A cable drags too (a plugged one comes out at once, a loose one is dropped on the machine to plug in) and a key (tray to the unseen `usb` box, the plugged one away from it).
- **Die blocks** (`Chips3D.hitAt`): a ray meets the live face's plane and reads the 2D hit rects (`cpu.<block>`, `<slot>.<part>` of a GPU, NPU or TPM) past their hover zoom.
- **Lenses** (`lens3d.ts`, keys P and A): the 2D `PowerLens` and `AirflowLens` run on the same models; the offscreen Pixi renderer draws them onto a plane at the board's depth, over everything.
- **TPM**: its live view runs on the module's lid like the cards'.
- **Particles** (`particles3d.ts`): haze off hot parts, smoke off a burnt one, sparks round a working CPU; one additive point cloud.
- **Mail**: a key new on the rack arrives in a letter that drifts in, opens, and the key is carried to its hook, on the game's clock (`Room3D.frame`, the 2D's own `letterPose` and `keyPose`).
- **Frame rate**: `npm run shot -- x.png --3d --fps` (RTX 5080, 1600x900, dev server): room 75, board 80, CPU 108 FPS, slowest frame 25 ms.
- **Input**: drag pans, right drag or shift drag orbits, the wheel zooms at the pointer, F the CPU die, G the first graphics card's die, B the board, R the room.
- **Art and LOD** (the 2D art is reused, not redrawn): `features/board/render/three/bake.ts` runs an offscreen Pixi renderer that draws the board's own containers (`buildBoard`, `cpuArt`, the die floorplan `dieFar` + `dieNear`, `ramArt`, `cardArt`, `gpuCover`, `nicArt`, `tpmArt`, `driveArt`, `vrmSinkArt`) into canvases; it also feeds the shop's part pictures. `core/render/three/artlod.ts` puts them on faces: `ArtSurface` bakes level 0 as one small texture and each higher level as tiles of at most 2048 px, only the tiles in view and only once the camera has needed that density for 150 ms, so a flight bakes none of the levels it passes (a shared `BakeQueue`, a few ms per frame; a level is kept 2.5 s after it is no longer needed, but bakes no new tile). A bake draws on the renderer's own canvas and copies it on the GPU (an extract read the pixels back and stalled a flight for a second). Raised parts (sockets, slots, VRM phases, connectors, chips, headers) are boxes topped with the art of their own rect. The reveals use the 2D bands (`DEVICE_LOD`, read as `seenZoom` at the part): the cooler fades, then the CPU's lid, and the die floorplan shows with every name; a card's shroud and fans fade to its die; the small chips and the DRAM chips stand up only up close.
- **Finish** (`artMaterial`, `FINISH`): the material maps come from the art's own colours, per pixel in the shader, so every tile has them at no bake cost. Warm colours (gold pins, copper, plated pads) are metal, pale grey ink is matte, the rest has the solder mask's gloss, and the brightness is a bump height (traces, pads and ink stand off the mask). The relief fades where a pixel covers several texels, and the mask's reflections are held down so the board stays dark face-on.
- **Solids** (`features/board/render/three/solids3d.ts`): the 2D drawers in `boardParts.ts` report each part they draw (`Ctx.solid`, `Solid`) while the board art builds, so the 3D parts sit on their drawings: capacitor cans with a scored top and a polarity stripe, SMD passives with tinned ends, gull-wing chip legs (each knows its chip's side), header pins and the empty socket's contacts, one instanced mesh per kind. Chips, chokes and power stages stand up as moulded (rounded) bodies with their own drawing on top. The sockets get what the drawing cannot show (`buildSlots`): memory latches (open on an empty socket), PCIe armour and latch, the CPU socket's load frame and lever. A VRM heat sink stands up its drawn fin rails (`Part.fins`, `Part.pipe`: `vrmSinkArt`), with a copper heat pipe or an end fan. Fans have curved, swept blades (`fanBlade`, `fanRotor`), square frames with a round throat (`fanFrame`) and a motor on struts.
- **Sleeves and glass** (`cables3d.ts`): a lead's sleeve is braided in its 2D accent, a plug is a dark moulding with an accent collar. The side glass fades out from the board view in (its sheen would grey the parts), and the finest texture level (7 to 10 px per unit) keeps the silkscreen and the die names sharp in the closest view.
- **glTF** (`core/render/three/gltf.ts`, `models3d.ts`): a part whose `visual` or kind is in `MODEL_FILES` wears the model at `public/models/<file>` fitted to its slot's rect in place of its primitives; a model that fails to load changes nothing. No model is shipped: every part is still built from primitives.
- **Weak GPUs**: the graphics settings (docs/UI.md "Graphics panel", `app/graphics.ts`) hold the presets and each option. With auto-adjust on, frames slower than 30 FPS take the picture down a step at a time (`lowered`, `Post.apply`) until the player tries again. Software GL (SwiftShader) runs about 1 FPS, so it says nothing of a real weak GPU.
- **Frame cost** (`post.ts`): the scene is drawn once a frame, into its own multisampled target with a depth texture. The AO works its normals out from that depth and the outline compares stand-ins for the picked meshes with it, so neither draws the scene again (each stock pass did, shadow maps included). The lights do not move, so a shadow map redraws only when a caster moves, shows or hides (`casterPrint`, `Room3D.redrawShadows`), and one light every 400 ms for the rest (the fans' rotors). The main thread's draw submission was the cost, not the GPU. A plug in or out rebuilds only the cables (`cablesKey`, `Machine3D.setCables`), against the parts' boxes taken once. `hang` keeps the cables it settled by their spec, steps on flat arrays, leaves out the boxes beyond the cable's reach and stops once the points rest. Canvas textures (art tiles, live faces, the screen, the clock) upload as plain RGBA and decode sRGB in the shader (`rawSrgb`, `DECODE_SRGB`): an sRGB canvas upload held ANGLE D3D11 200 to 300 ms per 2048 px tile. A new machine links its programs ahead of need (`warmPrograms`), the hidden parts and the see-through variants of what fades too: a program first linked in a frame held it about 100 ms.
- **Benchmark** (`npm run bench:3d`, `tools/bench3d.mjs`): plays the idle views, the flights, the door, the hover, a cable, a lifted part and the running machine with the real pointer. It reports frame times, the scene and shadow passes per frame, the draw calls, the GPU time per pass, the machine rebuilds and the hottest functions. `--baseline old.json` compares two runs.
- **Checks** (`tools/e2e3d.mjs`): drives the game with the real pointer (install, unmount, key, cable), prints FPS, and compares the room, board and CPU views with baselines kept outside the repo (`--baseline dir`). Passes in Chromium, Firefox and WebKit (headless: 65, 47 and 28 FPS).
- **glTF art and weak GPUs**: the loader works (`MODEL_FILES` in `models3d.ts`) but no model ships; a test sink looked worse than the 2D art and was removed. Tested on the AMD integrated GPU (`e2e3d.mjs --lowpower`): auto-adjust ends at no AO, no bloom, no MSAA, 0.6 density and the lowest live faces, and holds about 60 FPS in the room and board, about 35 in the CPU close-up.

## Phased Approach

### Phase 1: Foundation (this branch)
- [ ] Choose 3D library (Three.js recommended)
- [ ] Stub render entry with 3D canvas
- [ ] Basic camera (orbit, zoom, pan)
- [ ] One simple part (e.g., RAM stick) as low-poly gltf
- [ ] Material system (color by state, outline)

### Phase 2: Core Hardware
- [ ] CPU with die visualization
- [ ] GPU card with simplified geometry
- [ ] RAM DIMMs array
- [ ] PSU unit
- [ ] Motherboard base

### Phase 3: Environment
- [ ] Room/desk geometry
- [ ] Monitor model
- [ ] Cables and routing
- [ ] Lighting and shadows

### Phase 4: Polish
- [ ] Performance optimization (instancing, LOD)
- [ ] Particle effects (heat, activity)
- [ ] Animations (fans, thermal, state changes)
- [ ] Camera flyovers and transitions

## Technical Decisions

### Graphics Library
**Three.js** chosen for:
- Mature low-poly workflows
- Strong gltf/glb support
- Active community (computing visualizations common)
- Tree-shakeable, smaller bundle than Babylon
- No runtime licensing

### Asset Format
- **Model format**: glTF 2.0 (gltf/glb)
  - Portable, standardized, compression friendly
  - Easy to swap materials, colors
  - Works with Blender, Babylon, three.js
- **Bake textures**: 512x512 or smaller for board overview
- **Store in**: `assets/models/<feature>/<part>.glb`

### Color & Material System
- **Base material**: MeshStandardMaterial (PBR)
- **Overrides by state**:
  - `active`: bright emissive color (no texture)
  - `powered-off`: desaturate 50%
  - `throttled`: tint overlay
  - `burnt`: dark overlay + red X
  - `selected`: outline post-process
- **Outline**: Custom post-process shader (Sobel or edge detection)

### Camera System
- **Orthographic**: Board overview (fits WORLD bounds)
- **Perspective**: Detail view (for die, GPU, flyovers)
- **Transition**: Smooth lerp between ortho and perspective
- **Speed**: Pan/zoom inherit from old system (pixels → world units)

### Rendering Loop
```js
function frame(snapshot, deltaTime) {
  // Update 3D state from snapshot
  updateDeviceGeometry(snapshot);
  updateMaterials(snapshot);
  updateCamera(snapshot, deltaTime);
  
  // Render 3D scene
  renderer.render(scene, camera);
  
  // Overlay UI (Preact remains unchanged)
  // (no compositing needed, UI floats above canvas)
}
```

## File Structure

```
src/
├── core/render/
│   ├── board.ts              (replace: init 3D scene, not Pixi)
│   ├── live.ts               (adapt: snapshot → 3D updates)
│   ├── interact.ts           (adapt: raycasting replaces Pixi hit-test)
│   ├── three/
│   │   ├── init.ts           (engine setup, scene, renderer)
│   │   ├── camera.ts         (ortho/perspective, zoom, pan)
│   │   ├── materials.ts      (color, outlines, state)
│   │   ├── geometry.ts       (reusable meshes, load gltf)
│   │   └── post.ts           (outline, effects)
│   └── lod/
│       └── (deprecated or repurposed for draw-call reduction)
├── features/<f>/render/
│   ├── geometry.ts           (load 3D model for feature)
│   ├── animator.ts           (rotations, state tweens)
│   └── (art asset references removed from render code)
└── assets/
    └── models/
        ├── cpu/cpu-package.glb
        ├── gpu/gpu-card.glb
        ├── memory/dimm.glb
        ├── psu/psu-unit.glb
        └── ...
```

## Snapshot Consumption

No changes to `Snapshot` structure. New render code reads same fields:
- `devices[]`: `spec`, `tempC`, `powerW`, `burnt`, `throttle`
- `power`: `totalW`, `off`, `tripped`
- `display`, `pipe`: for overlays

## Known Challenges & Mitigations

| Challenge | Mitigation |
|---|---|
| Asset creation (1000+ parts) | Start with primitive geometry (cubes, cylinders), bake later; prioritize visible parts |
| Text rendering in 3D | Keep as HTML overlay; 3D text only for signs that must be in world |
| Performance at overview zoom | Instanced rendering, aggressive LOD, frustum culling |
| Raycasting complexity (PCIe pins) | Simplified hit targets; high-detail raycasts only when zoomed in |
| Cables and routing | Bezier curves + tube mesh; auto-route with existing algorithm |
| Mobile support | Start desktop-only; test on iPad later with touch raycasting |

## Milestones

1. **Week 1**: Canvas boots, empty 3D scene, camera works
2. **Week 2**: One device (RAM) renders with correct colors and outline
3. **Week 3**: Snapshot drives material updates, selection feedback
4. **Week 4**: Board layout, CPU, GPU, PSU at overview zoom
5. **Week 5+**: Polish, assets, optimizations

## Testing Strategy

- **Render tests**: Snapshot → geometry/material updates deterministic
- **Performance**: 60 FPS at overview, smooth pan/zoom
- **Regression**: Screenshot comparison (same tooling as before)
- **Cross-browser**: Chrome, Firefox, Safari (WebGL 2.0)

## Rollback Plan

- Branch: `graphics-rework` (this branch)
- Old render code lives in `src/core/render/` alongside new `src/core/render/three/`
- Feature flags: `import.meta.env.VITE_3D_GRAPHICS` to switch pipelines
- Commits tagged per milestone for easy bisect
