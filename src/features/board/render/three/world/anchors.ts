// The world's objects by id and their screen rectangles (board3d.ts): the same contract as the 2D renderer's (`anchorOf` in board.ts) for the
// tutorial and the cards: an alias or a slot's device, a cable's plug and the socket that takes it, the part of the screen the HUD leaves free.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { Box3, Vector3 } from 'three';
import type { Object3D } from 'three';
import { viewInset } from '@/app/hover';
import { snapshot } from '@/app/store';
import { findById } from '@/core/render/three/pick';
import type { Anchor } from '../../board';
import { ALIAS, MIN_TARGET_PX } from './consts';
import type { Core } from './world';

/** A client point in the canvas's normalised device coordinates. */
export const ndc = ({ stage }: Core, e: { clientX: number; clientY: number }): { nx: number; ny: number } => {
  const r = stage.canvas.getBoundingClientRect();
  return { nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: -(((e.clientY - r.top) / r.height) * 2 - 1) };
};
export const roots = ({ held }: Core): Object3D[] => {
  const out: Object3D[] = [];
  if (held.room) {
    out.push(held.room.root);
  }
  if (held.machine) {
    out.push(held.machine.root);
  }
  return out;
};
export const objOf = (c: Core, id: string): Object3D | null => {
  for (const r of roots(c)) {
    const o = findById(r, id);
    if (o) {
      return o;
    }
  }
  return null;
};
/** The scene id an id stands for: an alias, or the device that fills a slot (the 2D scene answers to both). */
export const real = (c: Core, id: string): string => {
  const a = ALIAS[id]?.find((x) => objOf(c, x));
  if (a !== undefined) {
    return a;
  }
  if (!objOf(c, id)) {
    const d = snapshot.peek()?.devices.find((x) => x.slot === id);
    if (d && objOf(c, d.id)) {
      return d.id;
    }
  }
  return id;
};
const plugOf = (o: Object3D): Object3D => {
  let p: Object3D | null = null;
  o.traverse((c) => {
    if (!p && Boolean(c.userData['plug'])) {
      p = c;
    }
  });
  return p ?? o;
};
/** The world boxes an id stands for: an object's; a cable's plug, then (loose) the socket that takes it. */
export const boxesOf = (c: Core, id: string): Box3[] => {
  const o = objOf(c, real(c, id));
  if (!o) {
    return [];
  }
  if (!id.startsWith('cable.')) {
    return [new Box3().setFromObject(o)];
  }
  const kind = id.slice(6),
    out = [new Box3().setFromObject(plugOf(o))],
    rig = c.held.machine?.rig(kind);
  if (rig?.canSeat === true && snapshot.peek()?.cables.find((x) => x.id === kind)?.connected !== true) {
    const [x, y, z] = rig.seat.at;
    out.push(new Box3(new Vector3(x - 100, y - 100, z - 100), new Vector3(x + 100, y + 100, z + 100)));
  }
  return out;
};
/** The part of the canvas the HUD leaves free, in client px. */
export const freeRect = ({ stage }: Core): { x: number; y: number; w: number; h: number } => {
  const i = viewInset.peek(),
    r = stage.canvas.getBoundingClientRect();
  return {
    x: r.left + i.left,
    y: r.top + i.top,
    w: Math.max(50, r.width - i.left - i.right),
    h: Math.max(50, r.height - i.top - i.bottom),
  };
};
/** A world box as a client rectangle; null behind the eye. `visible`: it meets the part of the screen the HUD leaves free. */
const screenBox = (c: Core, b: Box3): Anchor | null => {
  if (b.isEmpty()) {
    return null;
  }
  const r = c.stage.canvas.getBoundingClientRect(),
    f = freeRect(c),
    p = new Vector3();
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) {
        p.set(x, y, z).project(c.stage.camera);
        if (p.z >= 1) {
          return null;
        }
        const px = r.left + ((p.x + 1) / 2) * r.width,
          py = r.top + ((1 - p.y) / 2) * r.height;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    }
  }
  // (a target too small to hit counts as not seen: the tutorial then flies in to it)
  return {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    visible: x0 < f.x + f.w && x1 > f.x && y0 < f.y + f.h && y1 > f.y && Math.max(x1 - x0, y1 - y0) >= MIN_TARGET_PX,
  };
};
export const anchorsOf = (c: Core, id: string): Anchor[] =>
  boxesOf(c, id)
    .map((b) => screenBox(c, b))
    .filter((a): a is Anchor => Boolean(a));
