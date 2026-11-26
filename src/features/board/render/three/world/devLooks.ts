// Dev only (board3d.ts `__board`): what the tools and the tests read of the world as it stands, and the client points they drive the pointer to.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { Box3, Vector3 } from 'three';
import type { Object3D } from 'three';
import { autoStep } from '@/app/graphics';
import { findById } from '@/core/render/three/pick';
import { roots } from './anchors';
import { idAt } from './pointer';
import type { World } from './world';

/** The object with this hover id, in any root; null: none. */
export const objectOf = (w: World, id: string): Object3D | null =>
  roots(w)
    .map((r) => findById(r, id))
    .find((o) => o !== null) ?? null;

/** The client point of a world point (tests drive the pointer there: a socket that is no object of its own). */
const project = (w: World, { x, y, z }: { x: number; y: number; z: number }): { x: number; y: number } => {
  const r = w.stage.canvas.getBoundingClientRect(),
    p = new Vector3(x, y, z).project(w.stage.camera);
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
};

/** The client point of an object's middle (tests drive the pointer there): the middle if the object is there, else a point on it found by a grid of rays over its box. */
const screenOf = (w: World, id: string): { x: number; y: number } | null => {
  const o = objectOf(w, id);
  if (!o) {
    return null;
  }
  const { canvas, camera } = w.stage;
  const r = canvas.getBoundingClientRect(),
    b = new Box3().setFromObject(o),
    mid = b.getCenter(new Vector3()).project(camera);
  const at = (nx: number, ny: number) => ({
    x: r.left + ((nx + 1) / 2) * r.width,
    y: r.top + ((1 - ny) / 2) * r.height,
  });
  const hit = (nx: number, ny: number) => {
    const p = at(nx, ny),
      got = idAt(w, { clientX: p.x, clientY: p.y });
    return got === id || (got ?? '').startsWith(id);
  };
  // (a ray meets the object off the screen too: a point the pointer cannot reach is no answer)
  if (Math.abs(mid.x) < 1 && Math.abs(mid.y) < 1 && hit(mid.x, mid.y)) {
    return at(mid.x, mid.y);
  }
  const lo = new Vector3(b.min.x, b.min.y, b.max.z).project(camera),
    hi = new Vector3(b.max.x, b.max.y, b.max.z).project(camera);
  for (let i = 1; i < 24; i++) {
    for (let j = 1; j < 24; j++) {
      const nx = Math.min(lo.x, hi.x) + (Math.abs(hi.x - lo.x) * i) / 24,
        ny = Math.min(lo.y, hi.y) + (Math.abs(hi.y - lo.y) * j) / 24;
      if (nx > -1 && nx < 1 && ny > -1 && ny < 1 && hit(nx, ny)) {
        return at(nx, ny);
      }
    }
  }
  return Math.abs(mid.x) < 1 && Math.abs(mid.y) < 1 ? at(mid.x, mid.y) : null;
};

/** The world's parts and readings for the tools (tools/bench3d.mjs times the frame's parts), and the pointer's points. */
export const devLooks = (w: World): Record<string, unknown> => {
  const { stage, held, live, hands } = w;
  return {
    three: true,
    scene: stage.scene,
    renderer: stage.renderer,
    chips: live.chips,
    quality: () => autoStep.peek(),
    eyeCamera: stage.camera,
    // the frame's parts as they stand (tools/bench3d.mjs times them)
    parts: () => ({
      post: stage.post,
      machine: held.machine,
      room: held.room,
      chips: live.chips,
      fx: live.fx,
      lens: live.lens,
      bakes: stage.bakes,
      shadows: stage.shadows,
      hand: hands.hand,
      probe: stage.probe,
    }),
    // the metered eye (the meter's reading, the exposure's factor it asks for, and where it stands now)
    eye: () => ({ reading: held.reading, metered: held.metered, seen: held.seen }),
    idAt: (x: number, y: number, raw = false) => idAt(w, { clientX: x, clientY: y }, { raw }),
    project: (x: number, y: number, z: number) => project(w, { x, y, z }),
    screenOf: (id: string) => screenOf(w, id),
  };
};
