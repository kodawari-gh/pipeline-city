// The tower cooler's fin stack and fans (cooler3d.ts): forty-eight aluminium fins under a dark cover, and a 120 mm fan on each end held by its
// wire clips, both blowing west.
import { Shape, Vector2 } from 'three';
import { FAN_SCREW, SEG, extrude, instanced, rectBox, rounded, softBox, tube } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { brushed as streaks, tiled } from '../casekit3d';
import { fanPart } from '../fans3d';
import { ACCENT } from './look';
import { FIN0, FIN1, STACK, TOWER_FAN, TOWER_ZC, coolerFanBox, spotOf } from './plan';
import type { FanFit, Group, MeshStandardMaterial, Spin } from './types';

/** A notch for a fan's wire clip in a fin's edge at `cx`, from the edge at `yy` in to `yy + d`. */
const notch = (cx: number, yy: number, d: number): [number, number][] => [
  [cx - 12, yy],
  [cx - 12, yy + d],
  [cx + 12, yy + d],
  [cx + 12, yy],
];

/** A tower fin seen from the glass: the stack's outline, its east edge waved where the air comes in, a notch near each corner for the fans' wire clips. */
function finShape(): Shape {
  const { x, y, w, h } = STACK,
    e = x + w,
    s = y + h,
    pts: [number, number][] = [[x, y], ...notch(x + 60, y, 30), ...notch(e - 60, y, 30), [e, y]];
  for (let k = 1; k < 28; k++) {
    pts.push([k % 2 ? e - 34 : e, y + (k * h) / 28]);
  }
  pts.push([e, s], ...notch(e - 60, s, -30).toReversed(), ...notch(x + 60, s, -30).toReversed(), [x, s]);
  return new Shape(pts.map(([px, py]) => new Vector2(px, -py)));
}

/**
 * A tower fan's two wire clips (`face`: the x of the fan's outer face, `notch`: the x of the fins' clip notches): each hooks the fan's two corner
 * holes on one side, runs along that side and presses into the notches down the stack's edge.
 */
function wireClips(g: Group, at: { face: number; notch: number }, m: MeshStandardMaterial) {
  const { face, notch: nx } = at,
    { y, h } = STACK,
    yc = y + h / 2,
    a = TOWER_FAN * FAN_SCREW,
    e = Math.sign(face),
    z = TOWER_ZC,
    f = face + e * 14,
    n = nx + e * 70;
  for (const s of [-1, 1]) {
    const edge = s < 0 ? y : y + h,
      out = edge + s * 14,
      hole = yc + s * a,
      into = edge - s * 16;
    const pts: [number, number, number][] = [
      [face - e * 90, hole, z - a],
      [f, hole, z - a],
      [f, out, z - a + 60],
      [n, out, z - 70],
      [nx, into, z],
      [n, out, z + 70],
      [f, out, z + a - 60],
      [f, hole, z + a],
      [face - e * 90, hole, z + a],
    ];
    const path = rounded(
      pts.map(([px, py, pz]) => [px, -py, pz]),
      30,
      SEG.cornerTight,
    );
    g.add(tube(path, 12, m, SEG.frameBar));
  }
}

/** The fins: forty-eight plates in the board's plane, the air passing between them east to west; the cover on the top fin. */
export function towerFins(g: Group, fin: MeshStandardMaterial): void {
  const { x, y, w, h } = STACK;
  const n = 48,
    pitch = (FIN1 - FIN0 - 12) / (n - 1);
  const fins = extrude(finShape(), { depth: 12, bevelEnabled: false });
  g.add(
    instanced(
      fins,
      fin,
      Array.from({ length: n }, (_, k) => ({ x: 0, y: 0, z: FIN0 + k * pitch })),
    ),
  );
  // the cover on the top fin: dark, a brushed plate let into it, an accent line down each long edge
  g.add(
    softBox(
      { x: x - 10, y: y - 10, w: w + 20, h: h + 20 },
      FIN1,
      FIN1 + 60,
      mat(0x1d_1e_22, { metalness: 0.4, roughness: 0.42 }),
      24,
    ),
  );
  const plate = mat(0x95_9a_a3, { metalness: 0.8, roughness: 0.3, map: tiled(streaks(), 1, 4) });
  g.add(rectBox({ x: x + 90, y: y + 120, w: w - 180, h: h - 240 }, FIN1 + 60, FIN1 + 64, plate));
  const accent = mat(ACCENT.tower, { roughness: 0.4, metalness: 0.3 });
  for (const ax of [x + 34, x + w - 58]) {
    g.add(rectBox({ x: ax, y: y + 60, w: 24, h: h - 120 }, FIN1 + 60, FIN1 + 66, accent));
  }
}

/** The fans fitted on the ends, their axes along the fins (the light on the face that looks out), each held by its wire clips of `m`. */
export function towerFans(g: Group, rig: { spins: Spin[]; fans: readonly FanFit[] }, m: MeshStandardMaterial): void {
  const { x, w } = STACK;
  for (const fan of rig.fans) {
    const spot = spotOf(fan),
      b = coolerFanBox('cooler-tower', spot);
    if (!b) {
      throw new Error('the tower cooler has a box for every fan spot');
    }
    const f = fanPart(fan.spec, TOWER_FAN, b.r.w, spot ? -1 : 1);
    f.root.position.set(b.r.x + b.r.w / 2, -(b.r.y + b.r.h / 2), TOWER_ZC);
    f.root.rotation.y = Math.PI / 2;
    g.add(tag(f.root, fan.id));
    rig.spins.push({ ...f.spin, needs: 'cpufan', fixed: ACCENT.tower });
    wireClips(g, { face: spot ? b.r.x : b.r.x + b.r.w, notch: spot ? x + 60 : x + w - 60 }, m);
  }
}
