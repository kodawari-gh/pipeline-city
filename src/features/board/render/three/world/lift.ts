// A cable's plug held in the scene (plughand3d.ts), and the parts dragged in from the inventory or lifted off the board (drag3d.ts): board3d.ts's hands.
import { snapshot } from '@/app/store';
import { findById } from '@/core/render/three/pick';
import { Drag3D } from '../drag3d';
import { PlugHand } from '../plughand3d';
import { anchorsOf } from './anchors';
import { idAt } from './pointer';
import type { Scope } from './world';

/** A drop near the USB port is a drop on it (a key is small and the port smaller). */
const onPort = (s: Scope, cx: number, cy: number): boolean => {
  const [a] = anchorsOf(s, 'usb');
  return (
    a !== undefined &&
    Math.hypot(cx - (a.x + a.w / 2), cy - (a.y + a.h / 2)) <= Math.max(36, Math.max(a.w, a.h) / 2 + 16)
  );
};

/** The plug hand and the drag, each telling the other (the hand's toasts are the drag's). */
export function newHands(s: Scope): { hand: PlugHand; lift: Drag3D } {
  const box: { lift?: Drag3D } = {};
  const { canvas, scene } = s.stage;
  const hand = new PlugHand(
    { machine: () => s.held.machine, snapshot: () => snapshot.peek(), toast: (t, x, y) => box.lift?.toast(t, x, y) },
    canvas,
  );
  scene.add(hand.root);
  const lift = new Drag3D(
    (cx, cy, raw) => idAt(s, { clientX: cx, clientY: cy }, { raw: raw === true }),
    canvas,
    (id) => {
      const { machine } = s.held;
      return (
        machine !== null && (findById(machine.root, id) !== null || (id.includes('.') && !id.startsWith('cable.')))
      );
    },
    hand,
    (cx, cy) => onPort(s, cx, cy),
    (id) => anchorsOf(s, id)[0] ?? null,
  ); // (a die's block is `cpu.fetch`: not an object of its own)
  box.lift = lift;
  return { hand, lift };
}
