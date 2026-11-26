// The bed's four pillows (`bed`), each settled on what is under it and leant on what is behind it.
import { Mesh } from 'three';
import { DepthMap, bake } from '@/core/render/three/contact';
import { place } from '@/core/render/three/geometry';
import { cloth } from '@/core/render/three/materials';
import { settlePillow } from '../bedding3d';
import { DUVET, SHEET } from '../palette';
import { BED, FLOOR_Y } from '../roomplan';
import { pillow } from './shapes';
import { woven } from './textures';
import type { BufferGeometry, Group, Material, V3 } from './types';

/** Where a pillow lies before it settles: its place, its tilt round x, its turn round y and the order of the two. */
interface PillowPose {
  at: V3;
  tilt: number;
  turn: number;
  order: 'XYZ' | 'YXZ';
}

/**
 * The pillows: each set down on what is under it and leant back on what is behind it (the headboard, then the pillows behind), pressed in a
 * little and flattened where it touches; then it holds up those in front. Two in the duvet's cover stood against the headboard, leaning back;
 * two pale ones lying in front, their backs up on them.
 */
export function bedPillows(g: Group, { mattress, duvet, mw }: { mattress: Mesh; duvet: Mesh; mw: number }): void {
  const { x, w, z0, z1, head: hd, headTop } = BED,
    fl = FLOOR_Y,
    x1 = x + w,
    cx = x + w / 2,
    mTop = BED.top;
  const down = new DepthMap(1, 1, [x, 0, z0], [x1, 0, z1], 200).add(bake(mattress)).add(duvet.geometry);
  const back = new DepthMap(2, 1, [x, -fl, 0], [x1, -headTop, 0], 120).face(z0 + hd, [x, -fl, 0], [x1, -headTop, 0]);
  const press = { down: 260, back: 320, soft: 140 };
  const lay = (geo: BufferGeometry, m: Material, p: PillowPose): Mesh => {
    const o = place(new Mesh(geo, m));
    o.rotation.set(p.tilt, p.turn, 0, p.order);
    o.position.set(...p.at);
    settlePillow(o, down, back, press);
    o.name = 'pillow';
    g.add(o);
    return o;
  };
  const sham = cloth(0xff_ff_ff, { ...woven(DUVET, { repeat: [3, 3] }), roughness: 0.92 }),
    pale = cloth(0xff_ff_ff, { ...woven(SHEET, { repeat: [3, 3] }), roughness: 0.9 });
  const shams = [-1, 1].map((s, i) =>
    lay(pillow([mw * 0.48, 2500, 7600], { seed: i * 2.1 }), sham, {
      at: [cx + s * mw * 0.255, -mTop + 4500, z0 + hd + 3000],
      tilt: -Math.PI / 2 - 0.2,
      turn: s * 0.02,
      order: 'YXZ',
    }),
  );
  for (const o of shams) {
    back.add(o.geometry);
  }
  for (const [s, turn, seed] of [
    [-1, 0.03, 0.7],
    [1, -0.04, 3.3],
  ] as const) {
    lay(pillow([mw * 0.45, 3000, 7200], { seed, lumps: 0.08 }), pale, {
      at: [cx + s * mw * 0.245, -mTop + 2500, z0 + hd + 9000],
      tilt: 0.42,
      turn,
      order: 'XYZ',
    });
  }
}
