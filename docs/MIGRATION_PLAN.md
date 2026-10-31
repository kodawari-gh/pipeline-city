# Migration Plan: PixiJS → Three.js

## Overview

This plan phases the transition from PixiJS 2D rendering to Three.js 3D rendering. The goal is to maintain a playable game at each milestone while progressively replacing render code.

## Phase Structure

### Phase 1: Scaffolding (Week 1)
**Goal:** Three.js canvas renders, old Pixi code disabled.

**Tasks:**
1. Install three, types/three
2. Create `src/core/render/three/` folder structure
3. Implement init.ts, camera.ts, materials.ts, geometry.ts
4. Replace `mountBoard()` to create 3D scene instead of Pixi
5. Stub render loop (no snapshot updates yet)
6. Disable Pixi layers in `src/app/main.tsx`

**Commit:** "render: bootstrap Three.js scene and camera"

**Testing:**
- [ ] Canvas renders black (correct lighting, no geometry)
- [ ] Camera zoom/pan responds to keyboard/mouse
- [ ] No console errors

**Blocker:** If canvas doesn't render, debug WebGL context setup

---

### Phase 2: One Part (Week 2)
**Goal:** RAM stick renders with correct colors and reacts to state.

**Tasks:**
1. Create primitive DIMM mesh in geometry.ts
2. Add DIMM to scene in board.ts
3. Implement live.ts updates for device state (powered, throttled, burnt)
4. Test selection outline via raycasting in interact.ts
5. Add heat glow (temp-based emissive)

**Commit:** "render: DIMM renders and responds to state"

**Testing:**
- [ ] DIMM visible in scene with correct green color
- [ ] Outline appears on click
- [ ] Color darkens when powered off
- [ ] Glow brightens as temp increases
- [ ] No jitter or Z-fighting

**Blocker:** If raycasting fails, debug hit detection

---

### Phase 3: Core Devices (Week 3)
**Goal:** CPU, GPU, PSU visible and interactive.

**Tasks:**
1. Add primitive CPU (navy box with die texture)
2. Add primitive GPU (blue box with label)
3. Add primitive PSU (black box with fan)
4. Update live.ts to color all three by state
5. Add board base geometry (motherboard rectangle)
6. Test overview zoom (all parts fit in view)

**Commit:** "render: CPU, GPU, PSU with materials"

**Testing:**
- [ ] All three devices render in correct positions
- [ ] Zoom out → overview fits all parts
- [ ] Zoom in → see detail
- [ ] Throttle / overheat → glow visible
- [ ] 60 FPS at overview zoom (basic perf baseline)

**Blocker:** If performance drops below 30 FPS, profile and disable shadows

---

### Phase 4: Layout & Positioning (Week 4)
**Goal:** Board with all sockets/slots positioned correctly.

**Tasks:**
1. Load board layout from existing `layout.ts` (reuse positioning math)
2. Place 8× RAM slots in correct world coords
3. Add PCIe slots and M.2 socket (primitives)
4. Add VRM heatsinks (simplified geometry)
5. Add cables (bezier curves + thin cylinders)
6. Verify hover/selection works per slot

**Commit:** "render: complete board layout with all sockets"

**Testing:**
- [ ] Hover RAM slot → shows correct slot ID
- [ ] Select CPU socket → outlined
- [ ] Cables don't occlude important components
- [ ] Performance still 60 FPS at overview

**Blocker:** If cable routing breaks, revert to simpler cable model

---

### Phase 5: Room & Environment (Week 5)
**Goal:** Desk, monitor, cables, room context visible.

**Tasks:**
1. Add desk plane (brown/gray quad with baked wood texture)
2. Add monitor frame and stand (primitives)
3. Add monitor screen (black quad, will show CLI text via overlay)
4. Add power cord and video cable (bezier + tube)
5. Add room walls/floor (far background, low detail)
6. Test camera framing (show full scene at overview)

**Commit:** "render: room and monitor"

**Testing:**
- [ ] Room grounds the hardware (feels situated)
- [ ] Monitor text still readable (overlay, not 3D text)
- [ ] Cables route correctly (no pass-through geometry)
- [ ] Zoom to monitor detail works

**Blocker:** If room occludes board, adjust layer ordering or camera

---

### Phase 6: Polish & Optimization (Week 6+)
**Goal:** High-quality, performant, production-ready.

**Tasks:**
1. Add baked textures (PCB traces, silk-screen labels)
2. Implement LOD (simplified mesh at overview, full detail at close zoom)
3. Instancing for repeated parts (RAM sticks)
4. Post-process outline pass (custom shader)
5. Particle effects for heat/activity (optional)
6. Performance profiling and optimization
7. Cross-browser testing (Chrome, Firefox, Safari)

**Commit (per task):**
- "render: add baked PCB textures"
- "render: implement LOD system"
- "render: add outline post-process"
- "perf: optimize draw calls with instancing"

**Testing:**
- [ ] 60 FPS on i5 + GTX 1060 (desktop)
- [ ] 30 FPS on iPad Pro (mobile, stretch goal)
- [ ] No artifacts in dark/light themes
- [ ] Screenshot regression tests pass

---

## Parallel Work (Ongoing)

### Asset Creation
Start immediately; does not block scaffolding phases.

**Timeline:**
- Week 1: Design CPU, GPU, RAM low-poly models (ref images)
- Week 2–3: Model and texture in Blender
- Week 4–5: Iterate based on render feedback
- Week 6: Final exports and integration

**Assigned to:** Designer (parallel track)

### Testing Framework
Adapt existing screenshot tools.

**Changes:**
- Update `shot.mjs` to use Three.js renderer
- Regenerate baseline images (one per view: overview, CPU detail, GPU detail, room)
- Add regression test to CI

### Documentation
Keep MAP.md and feature docs in sync.

**Updates needed:**
- `GRAPHICS_3D_OVERHAUL.md` ✓ (created)
- `THREE_SETUP.md` ✓ (created)
- `LOWPOLY_STYLE.md` ✓ (created)
- `MIGRATION_PLAN.md` ✓ (this file)
- `src/features/<f>/render/*.md` (update asset loading)

---

## Branch Strategy

**Main branch:** `main` (stable, PixiJS)
**Work branch:** `graphics-rework` (this branch, WIP Three.js)

**Commits per phase:** Tag stable milestones (`v0.graphics-phase-1`, etc.)

**Revert point:** If Phase 3 doesn't reach 60 FPS, revert to Phase 1 and re-architect camera/LOD.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Three.js API changes | Lock version in package.json; test on major upgrades |
| Asset pipeline delays | Use primitives throughout; swap for real models later |
| Performance regression | Profile early and often; LOD is our fallback |
| Browser incompatibility | Test on Chrome, Firefox, Safari canary; polyfill if needed |
| Raycasting complexity (2D→3D) | Simplify hit targets; use bounding spheres for far zoom |
| Snapshot schema mismatch | No snapshot changes; 3D reads same fields as Pixi |

---

## Success Criteria

**Phase 1 (Scaffolding):**
- [ ] Three.js canvas renders without error
- [ ] Camera responds to input
- [ ] No console errors in dev/prod

**Phase 2 (One Part):**
- [ ] DIMM renders correctly
- [ ] State changes visible (power, throttle, temp)
- [ ] Outline selection works
- [ ] Frame rate ≥ 60 FPS

**Phase 3 (Core Devices):**
- [ ] CPU, GPU, PSU visible
- [ ] Overview zoom fits all
- [ ] Detail zoom works (>2x)
- [ ] Frame rate ≥ 60 FPS at all zoom levels

**Phase 4 (Layout):**
- [ ] All sockets/slots positioned correctly
- [ ] Hover/select per slot works
- [ ] Cables route correctly
- [ ] Frame rate ≥ 60 FPS

**Phase 5 (Room):**
- [ ] Room grounds the hardware
- [ ] Monitor and cables visible
- [ ] Camera framing appropriate
- [ ] Frame rate ≥ 60 FPS

**Phase 6 (Polish):**
- [ ] Baked textures applied
- [ ] LOD working correctly
- [ ] Post-process outline renders
- [ ] Frame rate ≥ 60 FPS
- [ ] Screenshots match expected output
- [ ] Cross-browser testing ✓

---

## Rollback Trigger

If any phase fails to meet **60 FPS at overview** or **core functionality broken**, revert:

```bash
git revert HEAD~<n>  # Pop failing commits
git reset --hard origin/main  # Full reset to PixiJS
```

Then re-branch and try a different approach.
