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
