# Rendering: camera, hover, interaction, tutorial support

Part of the renderer docs; the hub (layers, theme, snapshot fields, known gaps) is [`RENDER.md`](../RENDER.md).

The 2D Pixi camera, hit order and hover rings are removed. The 3D renderer (`src/features/board/render/three/board3d.ts`) now does this job. `board.ts` is the bridge the HTML UI calls. Until the 3D board registers with it (`setWorldAnchors`), no id has a screen rectangle and no flight starts.

## Files

| File | Role |
|---|---|
| `src/features/board/render/board.ts` | the bridge: `anchorOf`, `anchorsOf`, `flyTo`, `hasTarget`; forwards to the 3D world |
| `src/features/board/render/three/board3d.ts` | the 3D world: its flights, its screen anchors and its outlines of the drag targets |
| `src/core/render/three/pick.ts` | raycast picking: the nearest object with an id (`userData.id`) answers the hover id |
| `src/features/board/render/three/drag3d.ts` | the drag gestures in 3D: parts, installed parts back to the shelf, keys, cable plugs |
| `src/core/render/camera.ts` | keeps the `View`, `Inset`, `Rect` and `FlyOpts` types, `currentTextResolution`, and the label sweep (`registerLabel`, `sweepLabels`) (`camera.test.ts`); the 2D `Camera` class was removed |
| `src/core/render/shape.ts`, `capture.ts` | a `Shape` read from an object's own art (`captureShape`) |

## Camera

The 2D camera was removed. The 3D camera is in `src/core/render/three/camera.ts` and `board3d.ts`.

## Hover and selected contract

`hover` and `selected` are signals in `src/app/hover.ts`. The 3D pick (`three/pick.ts`) writes the ids that the HUD tooltips and cards read.

## Interaction (hover, drag and drop)

- **Parts**: `beginPartDrag(inventoryId, event)` (`src/core/ui/worldDrag.ts`) starts a part drag from the inventory menu. The drag itself is in `three/drag3d.ts`. The targets are outlined by `board3d.ts`.
- **Cables and keys**: a cable plug is held by `three/plughand3d.ts` while `drag3d.ts` keeps the gesture and its messages.
- **Dragging state**: `dragging` in `src/app/interaction.ts`.

## Flights

`flyTo(id, opts)` in `board.ts` calls the 3D world. It returns `false` for an unknown id and calls `opts.onDone(false)`. The options type is `FlyOpts` in `camera.ts`.

## Anchors (popups and pointers for the UI)

`anchorOf(id)` returns the first screen rectangle `{ x, y, w, h, visible }` of a world id, in client px. `anchorsOf(id)` returns all of them. Recompute them when `cameraRev` (`src/app/interaction.ts`) changes. `hasTarget(id)` tells whether the id exists now.

`viewInset` (`src/app/hover.ts`) is the space the HUD panels take. `InsetReporter` in `src/core/ui/Hud.tsx` writes it.

## Tutorial support

The UI sets `highlight` (`src/app/interaction.ts`). `src/features/tutorial/ui/anchor.ts` re-exports `anchorOf`, `anchorsOf`, `flyTo` and `hasTarget` from `board.ts`, so the UI imports the renderer through one place.

In dev builds, `board3d.ts` exposes `window.__board`.
