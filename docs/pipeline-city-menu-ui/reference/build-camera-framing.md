# Build camera framing (runtime note)

Read-only work against `origin/main` at `7f56e173`. No repository file was edited.

The shot is `/workspace/menu-review/shots/bg-build-desktop-v2.png` (1920×1080 CSS @ deviceScaleFactor 1, all DOM UI hidden). The default Build camera pose (yaw, pitch, fov, orbit target) was left as `BuildStage.frameView()` produces it. Only the camera’s film / projection was changed at runtime, so the same view is shifted and scaled to sit in the new layout’s free stage.

## What was changed at runtime

After the default Build workshop had rendered (same pose as `07-build-desktop.png` / `bg-build-desktop.png`):

1. The machine’s screen box on that default frame was measured as **x 407–1543, y 209–1026** (monitor + wall plates + case, including the dark base). That came from a high-threshold pixel-diff against a bare studio, with `y1` extended to the projected `Box3` base (`y=1026`), because the base is too close to the floor colour to show up at a high threshold.

2. A similarity on the 1920×1080 film was chosen so that box maps into the padded free stage **x 485–1465, y 110–770** (the free stage x 455–1495, y 80–800 with 30 px air). Uniform scale **s = 0.8076967042783741**, centres `(975, 617.569)` → `(975, 440)`.

3. On the live Three.js `PerspectiveCamera` (and on `PerspectiveCamera.prototype.updateProjectionMatrix`, so `applyView` cannot drop it next frame):

```js
camera.setViewOffset(
  1920,                  // fullWidth
  1080,                  // fullHeight
  -232.1362862265246,    // offsetX  = cx - tx / s
  72.81026514367409,     // offsetY  = cy - ty / s
  2377.129917492233,     // width    = 1920 / s
  1337.135578589381,     // height   = 1080 / s
);
```

`setViewOffset(fullW, fullH, ox, oy, width, height)` with `width = fullW / s` zooms the picture by `s`; a screen point `p` lands at `(p - (ox, oy)) * s`. No orbit target, distance, yaw, or pitch was changed.

`BuildStage` is not on `window` in the production preview (`__build` is dev-only), so the camera was reached by hooking Three instances at runtime. Nothing in `src/` was patched.

## Where the default framing lives

- **`BuildStage.frameView()`** in `src/features/board/render/three/buildstage/scenery.ts` — the default / reset orbit. It unions `CASE_RECT` with the wall frame, shifts the target west by `WALL_SHIFT` (1400), and calls `fitRect(..., this.W / this.H, START, 0.55)`. The aspect is the **full canvas**, not the free stage, and the margin (0.55) is a fill factor of that full frame. That is why, today, the case sits around x 798–1542 with its base near y 1020 and overflows the right panel and the run-bar plate.
- **`BuildStage.resetView()` / `preset()`** in the same file reuse `frameView()`.
- **`applyView(camera, this.view, this.W / this.H)`** in `BuildStage.frame` (same file) applies that orbit every tick (`src/core/render/three/camera.ts`). It sets pose, fov, aspect, near/far, then `updateProjectionMatrix()`. It does **not** call `setViewOffset` or `clearViewOffset`; a live `camera.view` is honoured if you keep it enabled (re-stamping it after `applyView` is the safe option).
- **`fitRect` / `fitHeight`** in `src/core/render/three/camera.ts` — world box → `OrbitView.height`.
- Related, but for stills rather than the interactive stage: **`BuildStage.capture()`** plus `fitFactor` / `pictureWindow` in `src/features/board/render/three/buildshot.ts`.
- The pattern this shot is imitating already exists on the Gallery turntable: **`mountViewer` → `layout()` / `setInsets()`** in `src/core/render/three/viewer.ts`. That path calls `camera.setViewOffset(stageW, stageH, (right - left) / 2, (bottom - top) / 2, stageW, stageH)` and **`holdHeight(...)`** so the part fits the free rectangle, not the full canvas.

Build itself has no `StageInsets` today.

## How a real implementation should do it

Give `BuildStage` the same kind of stage insets the Gallery viewer already uses, in CSS pixels of the host:

```ts
// 1920×1080 example for the new layout
{ left: 455, right: 425, top: 80, bottom: 280 }
// free stage: x 455–1495, y 80–800
```

Then, each layout / resize:

1. **Slide the film so the projection is composed for the free rect**, as `viewer.ts` `layout()` does:

   `camera.setViewOffset(W, H, (right - left) / 2, (bottom - top) / 2, W, H)`

   Keep that view offset enabled across `applyView` (or re-apply it at the end of `applyView`).

2. **Fit the machine’s world bounds into that free rect with ≥ ~30 px air.** Use the case `Machine3D.bodyBox()` unioned with the monitor (and the base), not the full-canvas `fitRect(..., this.W / this.H, ..., 0.55)` plus `WALL_SHIFT`. Either:

   - pass the **free** aspect `freeW / freeH` and a fill/margin into `fitRect` / `fitHeight` so the projected box leaves ≥ 30 px on every side of the free stage, or
   - project the box’s corners (as `BuildStage.capture` and `holdHeight` already do) and scale `OrbitView.height` (and, if needed, the target) until the screen box sits in `x 455+air … 1495-air, y 80+air … 800-air`.

The Gallery’s `holdHeight(size, centre, stageW, stageH, freeW, freeH)` is the closer model: insets handle the film pan; orbit height handles the fit. `WALL_SHIFT` is a stand-in for “the free window is not centred on the canvas”; insets replace it.

## Measured box on the v2 shot

Method: pixel-diff of `bg-build-desktop-v2.png` against a bare studio (same camera, machine meshes hidden). Core silhouette at max-channel delta ≥ 48; left edge extended to the monitor bezel; bottom extended to the last dark base row (the front-right foot, lum ≤ 62), because the base is close to the floor colour.

| | CSS px (origin top-left, max exclusive) |
|---|---|
| Machine bbox | **x 516–1447, y 110–769** (931 × 659) |
| Free stage | x 455–1495, y 80–800 |
| Air (L / T / R / B) | **61 / 30 / 48 / 31** px |

The whole machine, base included, is inside the free stage with at least 30 px of air. Height is the tight axis (30 px top and bottom); leftover horizontal air is 61 / 48 px. The run-bar plate (x 489–1021, y 819 down) and the right panel (x 1495) stay clear of the machine.
