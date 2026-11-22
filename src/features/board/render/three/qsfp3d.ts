// A QSFP+ cage's face as the eye meets it (docs/render/net.md "QSFP+"): the 40G card's two ports and the edge router's four LAN ports share it. Like `rj45jack3d.ts` it is laid out as
// a wall across x (casekit3d's `wallX`): the mouth opens at x toward -x and runs on into +x. The cage is a steel box 18.95 x 10 mm with a 0.9 mm face plate, the mouth a hair over the
// 18.35 x 8.5 mm module (SFF-8436); the module's lanes meet the card-edge connector at the back, its 38 contacts in two rows (a real cage is 55 mm deep: ours stops short, its mouth and
// its walls are the part the eye meets). A cage has no lights: the card's port lights stand in a plastic block over its mouth, the router's in its front. A caller that faces it
// another way turns the group it builds in. The long side of the span is the cage's width (19 mm); the card's lies across y, the router's across z.
import { BoxGeometry, type Group, type Material } from 'three';
import { instanced, rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { wallX, type Span } from './casekit3d';
import { springGold, unshadowed, type JackLamps } from './rj45jack3d';

/** A QSFP+ module and its cage (mm): the module's size, the cage's mouth, the cage outside (its sheet is 0.2 mm at the sides, 0.6 over and under), the face plate, the light block over a card's cage. */
export const QSFP = { module: { w: 18.35, h: 8.5 }, mouth: { w: 18.55, h: 8.75 }, cage: { w: 18.95, h: 10 }, plate: 0.9, lamp: { h: 2.4, d: 8.6 } } as const;

/** The paint of a cage: its steel, the dark of its inside, the connector's plastic and its gold. */
export interface QsfpLook { shell: Material; dark: Material; housing: Material; gold: Material }
export const qsfpLook = (shell: Material): QsfpLook => ({ shell, dark: mat(0x050608, { roughness: 0.85 }), housing: mat(0x131518, { roughness: 0.6 }), gold: springGold() });

/** Which way is up on a face: a card's lying (+z, off the PCB), or a router's front (layout -y). */
export type Up = 'z' | '-y';

/** The cage's measure on a span: units a mm, whether its width lies along y, its middle (layout y, depth z). */
function measure(s: Span) {
  const dy = s.y1 - s.y0, dz = s.z1 - s.z0, wideY = dy >= dz;
  return { k: Math.max(dy, dz) / QSFP.cage.w, wideY, cy: (s.y0 + s.y1) / 2, cz: (s.z0 + s.z1) / 2 };
}

/** The half sizes along y and z of a `w` x `h` rectangle (across the cage, over it) on that span. */
const half = (wideY: boolean, w: number, h: number) => (wideY ? { hy: w / 2, hz: h / 2 } : { hy: h / 2, hz: w / 2 });

/**
 * A cage's face: the steel plate over the span `s` (its face at x), the mouth sunk through it with the dark inside behind (the cage's four walls round it, a sleeve lining them), `deep`
 * to the back, where the connector stands: its plastic housing with the two rows of gold contacts. `fine` false: no connector (its housing and 38 contacts are two draws a port).
 */
export function qsfpFace(g: Group, x: number, s: Span, deep: number, M: QsfpLook, fine = true): void {
  const { k, wideY, cy, cz } = measure(s), t = QSFP.plate * k, m = half(wideY, QSFP.mouth.w * k, QSFP.mouth.h * k);
  const mouth: Span = { y0: cy - m.hy, y1: cy + m.hy, z0: cz - m.hz, z1: cz + m.hz, r: 0.5 * k };
  g.add(wallX(x, x + t, s, [mouth], M.shell));
  // (the cage behind the plate: its walls round the mouth, and a dark sleeve in them, so the eye looks into a dark box: a cut that meets the outline breaks the faces, so the sleeve is a hair in)
  g.add(unshadowed(wallX(x + t, x + deep, s, [{ ...mouth, r: 0.4 * k }], M.shell)));
  const e = 0.12 * k, sleeve: Span = { y0: mouth.y0 + e, y1: mouth.y1 - e, z0: mouth.z0 + e, z1: mouth.z1 - e, r: 0.4 * k };
  g.add(unshadowed(wallX(x + t, x + deep - 0.6 * k, { ...mouth, r: 0.4 * k }, [sleeve], M.dark)));
  g.add(unshadowed(rectBox({ x: x + deep - 0.6 * k, y: mouth.y0, w: 0.6 * k, h: mouth.y1 - mouth.y0 }, mouth.z0, mouth.z1, M.dark)));
  if (!fine) return;
  // the connector: a plastic housing at the back with a slot between the two rows of contacts, 19 at a 0.8 mm pitch in each
  const hw = half(wideY, 17.2 * k, 4.6 * k), hd = 3.2 * k, hx = x + deep - 0.6 * k - hd;
  g.add(unshadowed(rectBox({ x: hx, y: cy - hw.hy, w: hd, h: 2 * hw.hy }, cz - hw.hz, cz + hw.hz, M.housing)));
  const slot = half(wideY, 15.6 * k, 0.8 * k), cx = hx - 0.05 * k, rows = [-1.5 * k, 1.5 * k];
  g.add(unshadowed(rectBox({ x: cx, y: cy - slot.hy, w: 0.1 * k, h: 2 * slot.hy }, cz - slot.hz, cz + slot.hz, M.dark)));
  const pins = rows.flatMap((o) => Array.from({ length: 19 }, (_, i) => {
    const a = (i - 9) * 0.8 * k;
    return wideY ? { x: cx - 0.05 * k, y: -(cy + a), z: cz + o, sx: 0.1 * k, sy: 0.4 * k, sz: 0.9 * k } : { x: cx - 0.05 * k, y: -(cy + o), z: cz + a, sx: 0.1 * k, sy: 0.9 * k, sz: 0.4 * k };
  }));
  g.add(unshadowed(instanced(new BoxGeometry(1, 1, 1), M.gold, pins)));
}

/**
 * The port's two lights on a cage whose face is at x over the span `s`, its link light (green) and its activity light (amber), 5.3 mm either side of the middle. `block`: a plastic block over the
 * cage (the card's light pipe: 2.4 mm tall, 8.6 deep, so it ends inside the bracket; the width of the cage) carries them, on the `up` side; false: they stand in the front over the cage (the router's bezel). The lenses
 * are the network's: out until it lights them (`network/render/jackleds.ts`).
 */
export function qsfpLamps(g: Group, x: number, s: Span, up: Up, lamps: JackLamps, M: QsfpLook, block: boolean): void {
  const { k, wideY, cy, cz } = measure(s), h = QSFP.lamp.h * k, gap = block ? 0 : 0.9 * k;
  // (the strip over the cage: its middle along the way up, its depth)
  const above: Span = up === 'z' ? { y0: s.y0, y1: s.y1, z0: s.z1 + gap, z1: s.z1 + gap + h } : { y0: s.y0 - gap - h, y1: s.y0 - gap, z0: s.z0, z1: s.z1 };
  if (block) g.add(rectBox({ x, y: above.y0, w: QSFP.lamp.d * k, h: above.y1 - above.y0 }, above.z0, above.z1, M.housing));
  const ay = (above.y0 + above.y1) / 2, az = (above.z0 + above.z1) / 2, off = 5.3 * k;
  for (const [side, lm] of [[-1, lamps.link], [1, lamps.act]] as const) {
    const lens = wideY
      ? rectBox({ x: x - 0.04 * k, y: cy + side * off - 1.2 * k, w: 0.4 * k, h: 2.4 * k }, az - 0.55 * k, az + 0.55 * k, lm)
      : rectBox({ x: x - 0.04 * k, y: ay - 0.55 * k, w: 0.4 * k, h: 1.1 * k }, cz + side * off - 1.2 * k, cz + side * off + 1.2 * k, lm);
    lens.receiveShadow = false;
    g.add(lens);
  }
}
