// The renderer's drag-from-menu hook (docs/render/interact.md, `beginPartDrag`). The inventory tray calls it from a DOM
// pointerdown; the renderer starts the part drag, listens on window, and installs on a valid drop. Kept as a wrapper
// so the UI does not import the renderer directly from every component.
import { beginPartDrag as startPartDrag } from '../../features/board/render/board';

/** Start dragging an inventory part onto the board (no-op until the board is mounted). */
export function beginPartDrag(inventoryId: string, event: PointerEvent): void {
  startPartDrag(inventoryId, event);
}
