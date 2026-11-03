# Low-Poly Visual Style Guide

## Aesthetic Goals

Pipeline City's low-poly 3D renders computing hardware with **precision, clarity, and geometric beauty**. The style balances technical accuracy (recognizable shapes) with stylization (clean angles, minimal tris).

## Look decision (owner, 2026-10-31)

**Stylised warm, not strict low-poly.** The target is the owner's reference image: a warm wood-slat wall, a desk with drawers, a drum lamp, a sunny or night city window, a wall clock, a rug, a glass-side RGB PC. Keep the triangle budgets below, but use soft edges (rounded boxes with few segments), warm light (sky fill, sun or moon through the window, the lamp's spot), soft shadows and ACES tone mapping. Where this guide asks for sharp edges, flat shading or neutral white light, the decision wins. The state looks (emissive overlays, outline) stay as written.

## Inspiration

- **Poly Haven** low-poly models (clean topology, clear silhouettes)
- **Marmoset Toolbag** renders (flat lighting, bold materials)
- **Low Poly Office** aesthetic (neutral, purposeful, approachable)
- **Technical diagrams** (accuracy > decoration)

## Modeling Rules

### Polygon Count & Geometry

| Part Category | Tri Count | Detail Level |
|---|---|---|
| CPU / GPU | 200–600 | Medium: socket visible, die simplification |
| RAM / Storage | 100–300 | Low: basic block shape, connector pin |
| Cables | 50–200 | Very low: bezier curve + thin tube |
| PSU / Cooler | 300–800 | Medium-high: fan detail, vents |
| Board | 1000–2000 | High: trace outline, component pads |
| Room (desk/wall) | 2000–5000 | Medium: simple geometry, baked texture |

### Silhouette & Recognition

Each part must be **instantly recognizable** from any angle:
- Omit bevels; use sharp edges
- Simplify complex sub-parts (heatsinks → flat planes, pins → single mesh)
- Keep PCB rectangular; flatten diagonal components
- Use extrusion + baking for fine detail (traces, vias) rather than geometry

### Topology Best Practices

- **Hard edges**: No smoothing groups; bake with multiple materials per face
- **Quads where possible**: Easier to subdivide later; tris for complex shapes
- **No n-gons**: Triangulate final export
- **Seams**: Hide UV seams in creases (back of parts, interior)
- **Normals**: Recalculate after cleanup; export smoothed normals (90° hard edges)

## Color & Material System

### Hue Assignments

**By component type (base colors, before state effects):**

| Type | Hue | Example RGB |
|---|---|---|
| CPU (silicon) | Cool navy | #1a1a2e |
| GPU (silicon) | Deep blue | #0f3460 |
| RAM (green PCB) | Forest green | #228b22 |
| SSD (dark PCB) | Charcoal | #2a2a2a |
| PSU (metal/black) | Black + metallic | #1a1a1a |
| Motherboard | Teal / green | #0d3b3b |
| Cooler (aluminum) | Light gray | #c0c0c0 |
| Cables (generic) | Dark gray | #333333 |

### Material Properties

**All parts use PBR (Physically Based Rendering):**

```
Metalness: 0.0–0.3 (0.0 = plastic/silicon, 0.2 = brushed metal)
Roughness: 0.5–0.8 (0.6 typical for electronics)
Emissive: 0x000000 (overridden by state: powered, active, throttled, burnt)
```

### State Effects (Emissive Overlays)

**Powered On (normal):**
- Emissive intensity: 0.0
- Color: unchanged

**Powered Off:**
- Emissive intensity: 0.0
- Color: multiply by 0.5 (desaturate)

**Active (running job, bus lit):**
- Emissive intensity: 0.4
- Color: bright cyan (#3be3ff) or feature accent

**Throttled:**
- Emissive intensity: 0.2
- Color: amber (#ffc247)
- Base color: multiply by 0.8

**Overheating (temp > 42°C):**
- Emissive intensity: 0.2–0.6 (scales with temp)
- Color: cyan → amber → red (gradient by temp)

**Burnt / Failed:**
- Emissive intensity: 0.8
- Color: red (#ff5a78)
- Base color: multiply by 0.3 (darken)
- Effect: overlay semi-transparent dark texture

### Outline / Selection

**When selected or hovered:**
- Post-process edge detection shader (Sobel filter)
- Outline color: bright yellow (#ffff00)
- Thickness: 2–4 pixels

## Lighting Setup

The room is lit from its window, as a real room is (`GRAPHICS_3D_OVERHAUL.md` "Light"):

- **Key:** the sky's light and the sun come in by the window only, with shadows. The room falls off away from it.
- **Bounce:** a light probe of the room is the ambient light and the reflections. No flat fill lights a face from nowhere.
- **One rule:** in the room view every part takes the same light, the machine and the dies' art too. Only real emitters glow (the screen, the lamps, the RGB), and they light what is near them.
- **Board view:** the parts take back a studio light, so they read at any hour.

## Camera & Framing

### Orthographic View (Board Overview)

- **Frustum:** See entire board + room (WORLD bounds)
- **Position:** Slightly above board (z = 5000 world units)
- **Near/Far:** 0.1 to 100,000 units
- **Aspect:** Match canvas (no black bars)

### Perspective View (Detail Zoom, Future)

- **FOV:** 45°
- **Near/Far:** 1 to 10,000 units
- **Transition:** Smooth lerp (ortho → perspective) when zoom > 5x

## Texture & Baking

### Baked Elements (Not Real-Time Textures)

For performance, pre-bake details into 512×512 textures:
- **PCB traces** (motherboard top): copper lines on green
- **Component labels**: Silk-screen text (simplified to readable size)
- **Heatsink fins**: Normal map or baked geometry
- **Cable sleeve texture**: Subtle weave pattern

### Baking Process

1. **High-poly source**: Blender with fine detail
2. **Low-poly target**: Simplified geometry (matching tri budget)
3. **Bake maps**:
   - Diffuse (color)
   - Normal (surface detail)
   - Roughness (varies per material)
4. **Export**: glTF 2.0 with embedded textures (512×512 or smaller)

### UV Strategy

- **Efficient packing**: Atlas 2–3 UV sets per model
- **Margins**: 4 pixel gutter between islands
- **No stretching**: Even texel density (avoid distortion)
- **Seams hidden**: Place at back/underside of parts

## Animation & Motion

### Idle/Powered State

- **Fans**: Constant spin (RPM → rotation speed, scaled by load/temp)
- **Cables**: Static (no sway yet)
- **Glow**: Steady emissive (no pulse yet)

### Active/Computation

- **Bus glow**: Brief bright flash when transferring data
- **Heat glow**: Smooth transition (lerp over 0.5s) as temp rises
- **Fan speed**: Ramp up/down over 2s (smooth not instant)

### State Transitions

- **Power-on/off**: 1s fade (emissive → 0)
- **Thermal transition**: 0.5s lerp (color interpolation)
- **Selection**: Outline fades in 0.3s

## Dark Mode & Light Mode

### Dark Theme (Default)

- **Background**: #04060f (near-black)
- **Board**: #081628 (dark blue-gray)
- **Accents**: Full saturation (bright cyan, red, etc.)
- **Lighting**: Brighter (ambient 0.8, directional 0.6)

### Light Theme

- **Background**: #eaeff6 (off-white)
- **Board**: #9ccdbd (muted teal)
- **Accents**: Desaturated 40% (softer colors)
- **Lighting**: Dimmer (ambient 0.6, directional 0.4)

### Transition

- **On toggle**: Renderer rebuilds materials (0.3s crossfade)
- **CSS**: Keep `data-theme` binding; 3D reads theme via `readTheme()`

## Quality Checklist (Per Part Model)

- [ ] Recognizable silhouette (shadow readable)
- [ ] Tri budget met (see table above)
- [ ] No UV stretching or overlaps
- [ ] Normals recalculated and smooth
- [ ] Materials assigned (PBR values set)
- [ ] Seams hidden (or baked over)
- [ ] Tested at 0.5x and 2x zoom
- [ ] Outline renders correctly when selected
- [ ] Color changes when powered off / overheating
- [ ] Rotates smoothly (no z-fighting, no flicker)

## Asset Export Checklist

**Before committing a model to `assets/models/`:**

1. **Blender export**:
   ```
   File → Export as glTF 2.0 (.glb)
   - Format: glTF Binary (.glb)
   - Include: Animations, Normals, Tangents
   - Compression: ON
   - Output format: Quantized
   ```

2. **Naming**: `<feature>-<part>-<detail>.glb` (e.g., `cpu-package-low.glb`)

3. **Size**: < 200 KB per part (compress if > 500 KB)

4. **Test load**: `loadModel()` succeeds, no console errors

5. **Visual test**: Renders in board at 1x zoom, outline works

## Performance Targets

| Metric | Target |
|---|---|
| Poly count (board view) | 50–100K tris |
| Texture memory | < 16 MB |
| Render time (60 FPS) | < 5 ms per frame |
| Model load time | < 100 ms per model |
| Outline post-process | < 2 ms per frame |

## Future Enhancements

- Metallic shader variant (shiny heatsinks, connectors)
- Specular highlights on polished surfaces
- Subsurface scattering for plastic parts (cooling shrouds)
- Particle effects (thermal haze, dust)
- Animated cables (sway, drape)
- Screen reflections (monitor displays text overlay)
