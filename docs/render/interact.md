# Rendering: camera, hover, interaction, tutorial support

Part of the renderer docs; the hub (layers, theme, snapshot fields, known gaps) is [`RENDER.md`](../RENDER.md).

The 2D Pixi camera, hit order and hover rings are removed. The 3D renderer (`src/features/board/render/three/board3d.ts`) now does this job. `board.ts` is the bridge the HTML UI calls. Until the 3D board registers with it (`setWorldAnchors`), no id has a screen rectangle and no flight starts.

## Files

| File | Role |
|---|---|
| `src/features/board/render/board.ts` | the bridge: `anchorOf`, `anchorsOf`, `flyTo`, `hasTarget`; forwards to the 3D world |
| `src/features/board/render/three/board3d.ts` | the 3D world: its flights, its screen anchors and its outlines of the drag targets |
| `src/core/render/three/pick.ts` | raycast picking: the nearest object with an id (`userData.id`) answers the hover id |
| `src/core/render/three/pad.ts`, `gesture.ts` | the pointers of every stage: mouse, touch, wheel into pan, turn, zoom, twist, tap and focus calls on the stage (`Camera` below) |
| `src/features/board/render/three/drag3d.ts` | the drag gestures in 3D: parts, installed parts back to the shelf, keys, cable plugs |
| `src/core/render/camera.ts` | keeps the `View`, `Inset`, `Rect` and `FlyOpts` types, `currentTextResolution`, and the label sweep (`registerLabel`, `sweepLabels`) (`camera.test.ts`); the 2D `Camera` class was removed |
| `src/core/render/shape.ts`, `capture.ts` | a `Shape` read from an object's own art (`captureShape`) |

## Camera

One camera model on every stage: the game's board (`board3d.ts`), Build my PC (`buildmode3d.ts`) and the Gallery's viewer (`viewer.ts`). The view is an orbit (`three/camera.ts`). The pointers are read by one pad (`three/pad.ts`, the maths in `three/gesture.ts`), so they mean the same everywhere. A stage only decides what a drag that starts on a part lifts.

| | mouse | touch |
|---|---|---|
| pan | drag, middle-drag | one finger |
| turn | right-drag, shift-drag | two fingers swiped together; a twist turns the yaw |
| zoom | wheel, trackpad pinch (ctrl + wheel), toward the surface under the pointer | pinch, toward the surface under the fingers (they drag the view along) |
| focus | double-click | double-tap |
| lift a part | drag from it | hold 400 ms on it, then drag |

- **Surface under the pointer.** A pan holds the surface it started on (the content follows the pointer at that depth); a zoom goes toward the surface under the pointer (`zoomOn`; the Gallery's `zoomAbout`, which turns all the way round). A zoom never goes against the way asked at a height limit (a plain clamp backed off from a surface in front of the target's plane).
- **Turn.** It pivots about the surface in the middle of the free window and puts back the height and field of view it started with, so turning does not shrink the room view. A wall or a piece of furniture **stops** a turn (`turnReach` in `three/camera.ts`, used by `turnStep` in `board3d.ts`): it goes on while the room leaves the view within 20 % of its height and moves the eye like a plain orbit (no jump); past that it stops where it was and slides on the other angle. Each step stops at the end of the one before, so a turn never snaps back, never shrinks into a wall and never throws the eye to the far side of a piece.
- **Focus.** A double click on a part with a detailed view (the die, a card, the TPM, the memory map, a drive) flies to it, centred in the free window (`focusPart`, `focusDevice`): head on for a part that faces the glass; for a card, which stands on edge with its face looking up, from the front and above as far as the camera tilts (`Rail.lie`); for the memory sticks, whose chips look east, from the east and above (`Rail.angle`, `RAM_FACE_YAW`, `RAM_FACE_PITCH`). It is the player's own flight, and the only one. On empty space it frames the room, the board or the machine again (the Gallery: its first view).
- **Zoom stays moving.** A zoom toward a surface that a piece of furniture shuts off goes as far as the room lets the eye (`zoomHeld` in `board3d.ts`), then on about the middle of the view. It is never held where it is, and never thrown back out to the far wall.
- **Nothing moves the view by itself.** Zooming toward a stick, a card or the die only brings its detail in (the layers read the zoom at the face they sit on); nothing leans, swings or pans the camera, and no card or stick turns to meet it. The player turns the view to read a face. (A lean over the RAM and a swing of the cards flat existed until 2026-11-22; they moved the view and the parts against the player's hand and are gone.)
- **The glass is no surface.** The plate that takes a click on the shut glass side (`case.side`) is skipped by the pick that sets a zoom or a pan's depth (`pickPoint(..., skip)`): the zoom goes toward the board behind the glass, and a pan moves the board with the pointer (at the plate's depth it moved slower and a zoom stopped at the glass).
- **Wheel.** One notch (100 px) takes 17 % off the height (`WHEEL_K` 0.0018 in `three/gesture.ts`).
- **Lift.** In the game and in Build, a part lifts as the pointer moves when it is not big on screen (a larger side over 0.7 of the stage, or over 0.3 of its area) and, in the game, the machine is off. Otherwise a drag on it pans, and a hold lifts it. Plugs and keys always lift as they move. A refused lift (it says why) falls back to a pan.
- **Nothing holds the view.** There are no rails and no head-on tilt lock: the view stays where the player leaves it, at any angle and depth, inside the room (`keepInside`) and the machine's stage. A `Rail` (`three/rails.ts`) is only the framing data of a detail that a double click flies to. The first touch of the view catches a flight (`flying`).
- **No page zoom.** `index.html` (viewport `maximum-scale=1, user-scalable=no`), `ui.css` (`touch-action: manipulation`, `overscroll-behavior: none`), `src/app/touchguard.ts` (`guardPage`: the iOS gesture events and any move of two fingers) and the pad (`touch-action: none` on a stage) keep a pinch the camera's.
- Tests: `gesture.test.ts`, `pad.test.ts`, `camera.test.ts`, `touchguard.test.ts`. The key texts: `Controls.tsx` (the dialog) and `kit/ModeKit.tsx` (the studio screens' key bar).

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
