// The pad (`core/render/three/pad.ts`) on the game's canvas (board3d.ts), and the hover: the name and the outline of what the mouse is over
// (nothing while a press runs or a part is carried).
import { hover } from '@/app/hover';
import { attachPad } from '@/core/render/three/pad';
import type { Drag3D } from '../drag3d';
import { gestures } from './gestures';
import { idAt } from './pointer';
import type { Scope } from './world';

/** The pad's pointers on the canvas, the hover with them. */
export function openPointers(s: Scope, lift: Drag3D): ReturnType<typeof attachPad> {
  const { canvas } = s.stage;
  const pointers = attachPad(canvas, gestures(s, lift));
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.core.busy || lift.busy) {
      return;
    }
    const id = idAt(s, e, { raw: false, grab: true });
    const on = id !== null && id !== '';
    hover.value = on ? { id, x: e.clientX, y: e.clientY } : null;
    let cursor = '';
    if (on) {
      cursor = id.startsWith('cable.') || id.startsWith('key:') ? 'grab' : 'pointer';
    }
    canvas.style.cursor = cursor;
  });
  canvas.addEventListener('pointerleave', () => {
    if (!pointers.core.busy) {
      hover.value = null;
    }
  });
  return pointers;
}
