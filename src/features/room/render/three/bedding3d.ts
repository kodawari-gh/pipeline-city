// The bed's soft things, laid on it as cloth lies, worked out once as the room is built (`contact.ts`): the duvet over the mattress and the frame,
// round its foot corners, turned down below the pillows; a throw across it, on the duvet; the pillows set down on the sheet and leant back on what
// is behind them, each flattened where it touches. Nothing goes into what it lies on. World units (y up, z out of the back wall); no DOM.
import { BufferGeometry, Float32BufferAttribute, Mesh, type Material } from 'three';
import { DepthMap, Taut, arc, bake, type V3 } from '@/core/render/three/contact';
import { place } from '@/core/render/three/geometry';

/** The bed as the cloth sees it (world, y up): the mattress, the frame's outside (the foot at `z1`) and its top edge (`rim`) and bottom (`base`). */
export interface BedForm {
  mx0: number; mx1: number; mz0: number; mz1: number;
  /** The mattress's top (world y) and the radius of its edges. */
  top: number; r: number;
  x0: number; x1: number; z1: number; rim: number; base: number;
}

/** A point of a cloth's surface and the outward normal it takes its thickness along. */
export interface ClothPt { p: V3; n: V3 }

export const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The duvet's underside: a point of the flat cover (`u` across from the bed's middle, `v` along from the head) where it lies: on the top, over a
 * side or the foot (over the mattress's rounded edge, straight down to the frame's top edge, down the frame's face), or round a foot corner,
 * where the plan's corner runs tight round the frame's square one, the spare cloth stands out in a soft fold on the diagonal and the corner hangs
 * a little lower. `off`: its gap to the bed; `rumple`: the height of its bumps and folds, outward only (it never sinks into the bed).
 */
export class Drape {
  /** Half the flat top's width, and the z where the top ends at the foot. */
  readonly a: number;
  readonly b: number;
  private readonly s: Taut;
  private readonly cx: number;
  private readonly e0: number;
  private readonly top: number;
  /** How far out from the top's edge the cloth is past the mattress's edge, and at the frame's face. */
  private readonly hm: number;
  private readonly hf: number;

  constructor(f: BedForm, private readonly off: number, private readonly rumple: number) {
    // the section, in its own frame: 0 at the frame's outer face, the mattress's side `inset` in from it, its flat top ending `r` further in
    // (the same at the sides and at the foot); far points inward close the hull, the walk goes over the top's edge and down the face
    const inset = f.x1 - f.mx1, e = -inset - f.r;
    const pts: [number, number][] = [...arc(e, f.top - f.r, f.r, Math.PI / 2, 0, 12), [0, f.rim], [0, f.base], [e - 40000, f.base], [e - 40000, f.top]];
    this.s = new Taut(pts, [e, f.top], [0, f.base], off);
    this.cx = (f.mx0 + f.mx1) / 2;
    this.a = (f.mx1 - f.mx0) / 2 - f.r;
    this.b = f.mz1 - f.r;
    const q = this.s.at(0);
    this.e0 = q.x;
    this.top = q.y;
    this.hm = f.r + off;
    this.hf = inset + f.r + off;
  }

  /** The walk from the top's edge down to a world height: the hem there. */
  dropTo(y: number): number {
    let lo = 0, hi = 80000;
    for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (this.s.at(m).y > y) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  /** Soft bumps on the top, outward only. */
  private bump(u: number, v: number): number {
    const n = Math.sin(u / 2300 + v / 3100) * 0.55 + Math.sin(v / 1700 - u / 4100 + 1.3) * 0.35 + Math.sin(u / 900 + v / 1300 + 2.1) * 0.1;
    return this.rumple * Math.max(0, 1 + n) * 0.5;
  }

  /** Folds down the hanging cloth (`along` its edge), growing toward the hem, outward only. */
  private flute(along: number, drop: number, seed: number): number {
    const w = Math.sin(along / 1150 + seed) * 0.6 + Math.sin(along / 610 + seed * 2.3) * 0.4;
    return this.rumple * 2.2 * smooth(0, 4500, drop) * Math.max(0, 1 + w) * 0.5;
  }

  at(u: number, v: number): ClothPt {
    const side = u < 0 ? -1 : 1, du = Math.abs(u) - this.a, dv = v - this.b, cx = this.cx;
    if (du <= 0 && dv <= 0) {
      // the top: its bumps fade out toward the edges, where the cloth is pulled over them
      return { p: [cx + u, this.top + this.bump(u, v) * (1 - smooth(-2600, -400, Math.max(du, dv))), v], n: [0, 1, 0] };
    }
    if (dv <= 0) {
      const q = this.s.at(du), o = this.flute(v, du, side) * (1 - smooth(-2600, 0, dv)), h = q.x - this.e0;
      return { p: [cx + side * (this.a + h + q.nx * o), q.y + q.ny * o, v], n: [side * q.nx, q.ny, 0] };
    }
    if (du <= 0) {
      const q = this.s.at(dv), o = this.flute(u + 9000, dv, 0.7) * (1 - smooth(-2600, 0, du)), h = q.x - this.e0;
      return { p: [cx + u, q.y + q.ny * o, this.b + h + q.nx * o], n: [0, q.ny, q.nx] };
    }
    return this.corner(side, du, dv);
  }

  private corner(side: number, du: number, dv: number): ClothPt {
    const d = Math.max(du, dv), m = Math.min(du, dv), q = this.s.at(d + 0.22 * m), h = q.x - this.e0;
    // the plan's corner: round over the mattress's edge, then tightening to the frame's square corner (out by the gap)
    const rho = h + (this.off - h) * smooth(this.hm, this.hf, h), st = h - rho, arcL = (rho * Math.PI) / 2, lp = 2 * st + arcL;
    // the flat cover's way round (2d) set on the plan's: two straights and a quarter circle
    const l = (du >= dv ? dv : 2 * d - du) * (lp / (2 * d));
    let px: number, pz: number, nx: number, nz: number;
    if (l <= st) { px = h; pz = l; nx = 1; nz = 0; }
    else if (l <= st + arcL) { const t = (l - st) / rho; nx = Math.cos(t); nz = Math.sin(t); px = st + rho * nx; pz = st + rho * nz; }
    else { px = lp - l; pz = h; nx = 0; nz = 1; }
    // the spare length stands out round the diagonal: a soft fold, none on the top, growing down the hanging cloth (none where the corner
    // meets the side and the foot)
    const fold = Math.min(1500, 0.22 * (2 * d - lp)) * smooth(300, 3000, d) * Math.sin((Math.PI * l) / lp) ** 2;
    return { p: [this.cx + side * (this.a + px + nx * fold), q.y, this.b + pz + nz * fold], n: [side * nx * q.nx, q.ny, nz * q.nx] };
  }
}

/**
 * A slab of cloth: its underside on `surf` over the flat cover's grid (`us` across, `vs` along: denser where it bends), its top out by `thick`
 * along the normal, its border closed by a rounded edge. The UVs are the flat cover's (`tile` units a repeat), so its weave never stretches.
 */
export function slab(surf: (u: number, v: number) => ClothPt, us: readonly number[], vs: readonly number[], thick: (u: number, v: number) => number, tile: number, m: Material): Mesh {
  const nu = us.length, nv = vs.length, pos: number[] = [], uv: number[] = [], idx: number[] = [], under: V3[] = [], over: V3[] = [];
  for (const v of vs) for (const u of us) {
    const { p, n } = surf(u, v), t = thick(u, v);
    under.push(p);
    over.push([p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t]);
  }
  const put = (q: V3, a: number, b: number) => { pos.push(q[0], q[1], q[2]); uv.push(a / tile, b / tile); };
  // the top (facing out) and the underside (facing in)
  for (const [src, flip] of [[over, false], [under, true]] as const) {
    const base = pos.length / 3;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) put(src[j * nu + i]!, us[i]!, vs[j]!);
    for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) {
      const a = base + j * nu + i, b = a + 1, c = a + nu, e = c + 1;
      if (flip) idx.push(a, b, c, b, e, c); else idx.push(a, c, b, b, c, e);
    }
  }
  // the border, walked round: each point's underside, its top, and between them a point out by half the thickness (a rounded edge)
  const ring: [number, number][] = [];
  for (let i = 0; i < nu; i++) ring.push([i, 0]);
  for (let j = 1; j < nv; j++) ring.push([nu - 1, j]);
  for (let i = nu - 2; i >= 0; i--) ring.push([i, nv - 1]);
  for (let j = nv - 2; j > 0; j--) ring.push([0, j]);
  const rim = pos.length / 3, L = ring.length;
  ring.forEach(([i, j], k) => {
    const lo = under[j * nu + i]!, hi = over[j * nu + i]!;
    const ii = i === 0 ? 1 : i === nu - 1 ? nu - 2 : i, jj = j === 0 ? 1 : j === nv - 1 ? nv - 2 : j, inner = under[jj * nu + ii]!;
    const o = [lo[0] - inner[0], lo[1] - inner[1], lo[2] - inner[2]], ol = Math.hypot(o[0]!, o[1]!, o[2]!) || 1;
    const half = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    put(lo, us[i]!, vs[j]!);
    put([(lo[0] + hi[0]) / 2 + (o[0]! / ol) * half, (lo[1] + hi[1]) / 2 + (o[1]! / ol) * half, (lo[2] + hi[2]) / 2 + (o[2]! / ol) * half], us[i]! + half, vs[j]! + half);
    put(hi, us[i]! + 2 * half, vs[j]! + 2 * half);
    const a = rim + k * 3, b = rim + ((k + 1) % L) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return place(new Mesh(g, m));
}

/** Breaks from `a` to `b`, `coarse` apart, `fine` apart inside each of the `zones` (where the cloth bends). */
export function breaks(a: number, b: number, coarse: number, fine: number, zones: readonly (readonly [number, number])[]): number[] {
  const out = [a];
  for (let x = a; x < b - 1;) {
    x = Math.min(b, x + (zones.some(([lo, hi]) => x >= lo - 1 && x < hi) ? fine : coarse));
    out.push(x);
  }
  return out;
}

/**
 * A pillow put roughly in place: set down on the supports under it and leant back on those behind (in turns, as a move back can take it off
 * what held it), pressed in a little and flattened where it touches.
 */
export function settlePillow(m: Mesh, down: DepthMap, back: DepthMap, press: { down: number; back: number; soft: number }): BufferGeometry {
  const g = bake(m);
  for (let k = 0; k < 3; k++) { down.settle(g, -press.down); back.settle(g, -press.back); }
  back.conform(g, press.soft);
  down.conform(g, press.soft);
  return g;
}
