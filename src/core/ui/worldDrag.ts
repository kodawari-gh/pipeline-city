// The renderer's drag-from-menu hook (docs/render/interact.md, `beginPartDrag`). The inventory tray calls it from a DOM
// pointerdown; the renderer starts the part drag, listens on window, and installs on a valid drop. Kept as a wrapper
// so the UI does not import the renderer directly from every component.

let override: ((inventoryId: string, event: PointerEvent) => void) | null = null;

/** The 3D renderer registers its drag handler here (`board3d.ts`). */
export function setPartDragHandler(h: ((inventoryId: string, event: PointerEvent) => void) | null): void { override = h; }

/** Start dragging an inventory part onto the board (no-op until the 3D world is mounted). */
export function beginPartDrag(inventoryId: string, event: PointerEvent): void {
  override?.(inventoryId, event);
}
