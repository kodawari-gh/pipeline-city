// Thin wrapper around the renderer's drag-from-menu hook (docs/RENDER.md, `beginPartDrag`). It is read through a
// namespace import with a runtime check, so the UI builds and runs before the hook lands. Adjust this one file when
// the renderer's signature settles.
import * as Board from '../render/board';

type BeginPartDrag = (inventoryId: string, event: PointerEvent) => void;

/** Start dragging an inventory part onto the board. Returns false while the renderer does not offer the hook. */
export function beginPartDrag(inventoryId: string, event: PointerEvent): boolean {
  const fn = (Board as unknown as { beginPartDrag?: BeginPartDrag }).beginPartDrag;
  if (typeof fn !== 'function') return false;
  fn(inventoryId, event);
  return true;
}
