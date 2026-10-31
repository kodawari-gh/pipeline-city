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
- **Shared code** `src/core/render/three/`: `init` (renderer, ACES tone mapping, shadows), `camera` (pure orbit maths: target, yaw, pitch, view height, fov; a narrow fov reads nearly orthographic, so the ortho/perspective blend is a fov tween), `materials` (palette, `partLook` state looks, `PartSkin` eases them), `geometry` (boxes over layout rects, soft boxes, tubes, instancing, canvas textures), `pick` (raycast to the 2D hover ids), `post` (outline pass, output pass).
- **Room** `src/features/room/render/three/`: `room3d.ts` (wood-slat wall, window with sky, city and blind, desk and drawers, monitor with the live screen text, keyboard, mouse, mug, drum lamp, wall clock, rug, key rack with the tray keys, router shelf, letterbox, wall plates; sun or moon by the game hour, lamp spot, screen glow), `roomplan.ts` (pure: depths, slat runs, daylight).
- **Machine** `src/features/board/render/three/`: `machine3d.ts` (glass-side case, board with its sockets, every part kind as primitives, case fans with RGB rings, ATX / CPU / video cables, wall cords, the plugged key; state looks and fan spin from the snapshot), `board3d.ts` (the mount: rebuilds on snapshot changes, camera input, picking, the same `hover` / `selected` signals and quick actions as `Interact.click`, outline on hover, selection and tutorial targets).
- **Input**: drag pans, right drag or shift drag orbits, the wheel zooms at the pointer, F the CPU, B the board, R the room.
- **Not ported yet**: dragging parts, cables and keys (install from the inventory needs the 2D view), the die view and the GPU / NPU / TPM insides, the power and airflow lenses, the mail animations, PCIe power leads, LOD and instancing beyond the repeated parts, baked textures and glTF models.

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
