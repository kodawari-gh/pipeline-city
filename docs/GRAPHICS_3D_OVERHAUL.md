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
- **Coolers after the 2D art** (`cooler3d.ts`, `fans3d.ts`): the stock cooler's radial vanes under its fan, the tower's notched fin plates with copper heat pipes arching through them and its fan on the east end, the loop's pump head (brushed ring, ring light, impeller under a glass dome) with two braided tubes along the 2D routes (`tubeRoutes`, lifted over the parts) to a radiator built from the 2D slab (tanks, fin core, one fan per mount, barbs).
- **Inside the case: real parts, not flattened ones** (2026-11-01). The 2D had to lay every part flat to show its face; in 3D each part takes its real pose, and a close look brings the 2D face back:
  - *RAM* (`ram3d.ts`): a stick stands in its socket, its gold fingers in the groove, a latch hooked into the notch at each end (open on an empty socket). The look follows the generation: bare green PCB (SDR and the server ECC sticks), a low clip-on spreader (DDR2), a finned crown (DDR3), a spreader under a frosted RGB light bar (DDR4, DDR5). The chips sit where the 2D chips are. In the RAM band the camera leans about 40 degrees (`Machine3D.lean`, board3d.ts) to read the faces in a row, and the spreaders fade to the chips.
  - *Cards* (`card3d.ts`): a GPU, NPU or NIC stands out of its PCIe slot on edge, the finger tab in the slot, the bracket against the back wall with its ports. A GPU's fans face down to the PSU shroud, its backplate up, its light bar and power sockets on the top edge toward the glass; the PCIe leads climb over the cards and plug in from above (`standingPlug`). The NPU has a blower shroud, the NIC its sink and RJ45 jacks. The card is built in the 2D pose and stood up on a hinge along the slot: in its 2D band (read at the card's point nearest the view's centre) the cooler, backplate, bracket and leads fade, then the card swings down flat and shows its exact 2D face (G frames the die). Empty slots show the case's vented covers (`slotCover`).
  - *Board parts* (`parts3d.ts`): the NVMe stick lies on its socket and brass standoff (thin PCB, controller, finned spreader, the screw over the notch); the chipset's fins stand where the 2D draws them; the coin cell sits in its holder under its clip; the TPM module stands on a female connector over its header; a hard disk is a cast base with its lid inset and screwed, an SSD a two-part shell, both with SATA sockets; the board's mounting screws stand up (`Solid` `screw`).
  - *State looks*: wide parts (sticks, cards, coolers, PSU) glow at 0.3 of the state's level (`PartSkin` gain), so a running part keeps its own colours.
  - *Still flat*: the 24-pin and 8-pin connectors (boxes with their drawing on top), the SATA ports; no SATA cables (the sim has none), no tray grommets; the live memory map on the chips and the live card views.
- **Machine** `src/features/board/render/three/`: `machine3d.ts` (glass-side case, board with its sockets, every part kind as primitives, case fans with RGB rings, ATX / CPU / video cables, wall cords, the plugged key; state looks and fan spin from the snapshot), `board3d.ts` (the mount: rebuilds on snapshot changes, camera input, picking, the same `hover` / `selected` signals and quick actions as `Interact.click`, outline on hover, selection and tutorial targets).
- **Input**: drag pans, right drag or shift drag orbits, the wheel zooms at the pointer, F the CPU die, G the first graphics card's die, B the board, R the room.
- **Art and LOD** (the 2D art is reused, not redrawn): `features/board/render/three/bake.ts` runs an offscreen Pixi renderer that draws the board's own containers (`buildBoard`, `cpuArt`, the die floorplan `dieFar` + `dieNear`, `ramArt`, `cardArt`, `gpuCover`, `nicArt`, `tpmArt`, `driveArt`, `vrmSinkArt`) into canvases; it also feeds the shop's part pictures. `core/render/three/artlod.ts` puts them on faces: `ArtSurface` bakes level 0 as one small texture and each higher level as tiles of at most 2048 px, only the tiles in view and only when the camera needs that density (a shared `BakeQueue`, a few ms per frame, levels kept 2.5 s after they are no longer needed). Raised parts (sockets, slots, VRM phases, connectors, chips, headers) are boxes topped with the art of their own rect. The reveals use the 2D bands (`DEVICE_LOD`, read as `seenZoom` at the part): the cooler fades, then the CPU's lid, and the die floorplan shows with every name; a card's shroud and fans fade to its die; the small chips and the DRAM chips stand up only up close.
- **Finish** (`artMaterial`, `FINISH`): the material maps come from the art's own colours, per pixel in the shader, so every tile has them at no bake cost. Warm colours (gold pins, copper, plated pads) are metal, pale grey ink is matte, the rest has the solder mask's gloss, and the brightness is a bump height (traces, pads and ink stand off the mask). The relief fades where a pixel covers several texels, and the mask's reflections are held down so the board stays dark face-on.
- **Solids** (`features/board/render/three/solids3d.ts`): the 2D drawers in `boardParts.ts` report each part they draw (`Ctx.solid`, `Solid`) while the board art builds, so the 3D parts sit on their drawings: capacitor cans with a scored top and a polarity stripe, SMD passives with tinned ends, gull-wing chip legs (each knows its chip's side), header pins and the empty socket's contacts, one instanced mesh per kind. Chips, chokes and power stages stand up as moulded (rounded) bodies with their own drawing on top. The sockets get what the drawing cannot show (`buildSlots`): memory latches (open on an empty socket), PCIe armour and latch, the CPU socket's load frame and lever. A VRM heat sink stands up its drawn fin rails (`Part.fins`, `Part.pipe`: `vrmSinkArt`), with a copper heat pipe or an end fan. Fans have curved, swept blades (`fanBlade`, `fanRotor`), square frames with a round throat (`fanFrame`) and a motor on struts.
- **Cables and cage** (`cables3d.ts`): the PSU leads (PCIe leads included, dealt as the sim deals them) are braided sleeves in their 2D accent along the 2D routes, a plug at each end, ties in the gutter. The drive cage wears `bayArt` on its back plate, with uprights and rails; the drives lie on the rails. The side glass fades out from the board view in (its sheen would grey the parts), and the finest texture level (7 to 10 px per unit) keeps the silkscreen and the die names sharp in the closest view.
- **Not ported yet**: dragging parts, cables and keys (install from the inventory needs the 2D view), the live die and card animation (the floorplans are still pictures), the NPU / TPM insides, the power and airflow lenses, the mail animations, glTF models.

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
