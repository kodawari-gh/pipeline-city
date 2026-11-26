// The buildings' geometry (`building.ts` fills it, `rings.ts` makes a mesh of each ring): a vertex's place, normal, facade uv and the facade's
// look, kept in typed arrays that grow as they fill.
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { inset, Kind, Wide, wallsOf } from './basics';
import type { BoxSides, Look, Paint, Rect, SignWash, UV, V3 } from './types';

/** The uv of a shape's or a ring's vertex: none. */
const NO_UV: UV = [0, 0];

/** A copy of a twice longer array. */
function doubled(a: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const b = new Float32Array(2 * a.length);
  b.set(a);
  return b;
}

/** The buildings' geometry: each vertex's place, normal, facade uv (m), frame colour, facade look (bay, storey, window share across and up), glass tint, (seed, kind, reflection), and a head's floodlight (colour, and the heights it runs between). */
export class Mass {
  /** The vertices so far, and how many the arrays hold before they grow (the city has millions: plain arrays took most of its build). */
  private n = 0;
  private room = 4096;
  private pos = new Float32Array(3 * this.room);
  private nor = new Float32Array(3 * this.room);
  private fuv = new Float32Array(2 * this.room);
  private col = new Float32Array(3 * this.room);
  private look = new Float32Array(4 * this.room);
  private tint = new Float32Array(3 * this.room);
  private aux = new Float32Array(3 * this.room);
  private wash = new Float32Array(3 * this.room);
  private washY = new Float32Array(2 * this.room);
  private readonly c = new Color();
  private readonly t = new Color();
  /** The look, (seed, kind, reflection) and floodlight (colour, from, to) the next vertices take, kept as numbers for `vert`. */
  private l0 = 1;
  private l1 = 1;
  private l2 = 0;
  private l3 = 0;
  private a0 = 0;
  private a1: number = Kind.Plain;
  private a2 = 0;
  private f0 = 0;
  private f1 = 0;
  private f2 = 0;
  private w0 = 0;
  private w1 = 0;
  /** The signs that light the wall they hang on. */
  washes: SignWash[] = [];
  /** Only the night pieces: while on, a plain or roof vertex is dropped (a far Low block's lights, not its roof). */
  lightsOnly = false;
  /** While on (with `lightsOnly`), a plain vertex is kept: a far block's mast and spire, the silhouette a tip's beacon sits on. */
  silhouette = false;
  /** While on, no vertex is kept: a piece's draws from a building's stream still run, so what comes after it (the crown) is the same. */
  dry = false;
  private hidden = false;

  /** The look the next vertices take: its bay is stretched per wall (`box`'s `fit`). */
  get lk(): Look {
    return [this.l0, this.l1, this.l2, this.l3];
  }
  set lk(v: Look) {
    [this.l0, this.l1, this.l2, this.l3] = v;
  }

  /** The floodlight on the next vertices: its colour, and from where to where it grows. */
  get fl(): readonly [number, number, number] {
    return [this.f0, this.f1, this.f2];
  }
  set fl(v: readonly [number, number, number]) {
    [this.f0, this.f1, this.f2] = v;
  }
  get flY(): readonly [number, number] {
    return [this.w0, this.w1];
  }
  set flY(v: readonly [number, number]) {
    [this.w0, this.w1] = v;
  }

  /** What the next vertices are: their frame colour, kind, and tint, look, seed and reflection. */
  set(frame: number | Color, kind: Kind, { tint = 0, seed = 0, look = [1, 1, 0, 0], refl = 0 }: Paint = {}): this {
    if (typeof frame === 'number') {
      this.c.setHex(frame);
    } else {
      this.c.copy(frame);
    }
    this.t.setHex(tint);
    this.lk = look;
    this.a0 = seed;
    this.a1 = kind;
    this.a2 = refl;
    this.hidden = this.lightsOnly && !this.silhouette && (kind === Kind.Plain || kind === Kind.Roof);
    return this;
  }

  private grow(): void {
    this.room *= 2;
    this.pos = doubled(this.pos);
    this.nor = doubled(this.nor);
    this.fuv = doubled(this.fuv);
    this.col = doubled(this.col);
    this.look = doubled(this.look);
    this.tint = doubled(this.tint);
    this.aux = doubled(this.aux);
    this.wash = doubled(this.wash);
    this.washY = doubled(this.washY);
  }

  private vert(p: V3, n: V3, uv: UV): void {
    if (this.hidden || this.dry) {
      return;
    }
    if (this.n === this.room) {
      this.grow();
    }
    const i = this.n++,
      i2 = 2 * i,
      i3 = 3 * i,
      i4 = 4 * i,
      { pos, nor, fuv, col, tint, look, aux, wash, washY, c, t } = this;
    for (let k = 0; k < 3; k++) {
      pos[i3 + k] = p[k] ?? 0;
      nor[i3 + k] = n[k] ?? 0;
    }
    for (let k = 0; k < 2; k++) {
      fuv[i2 + k] = uv[k] ?? 0;
    }
    col[i3] = c.r;
    col[i3 + 1] = c.g;
    col[i3 + 2] = c.b;
    tint[i3] = t.r;
    tint[i3 + 1] = t.g;
    tint[i3 + 2] = t.b;
    look[i4] = this.l0;
    look[i4 + 1] = this.l1;
    look[i4 + 2] = this.l2;
    look[i4 + 3] = this.l3;
    aux[i3] = this.a0;
    aux[i3 + 1] = this.a1;
    aux[i3 + 2] = this.a2;
    wash[i3] = this.f0;
    wash[i3 + 1] = this.f1;
    wash[i3 + 2] = this.f2;
    washY[i2] = this.w0;
    washY[i2 + 1] = this.w1;
  }

  /** A quad a, b, c, d (counter-clockwise seen from its front) and its uvs, as two triangles. */
  quad(ps: readonly [V3, V3, V3, V3], n: V3, uvs: readonly [UV, UV, UV, UV]): void {
    this.vert(ps[0], n, uvs[0]);
    this.vert(ps[1], n, uvs[1]);
    this.vert(ps[2], n, uvs[2]);
    this.vert(ps[0], n, uvs[0]);
    this.vert(ps[2], n, uvs[2]);
    this.vert(ps[3], n, uvs[3]);
  }

  /** A box's walls from y0 to y1 (outward, or inward for a parapet's inner face) and its top if `top`. Each wall's u runs along it from its left. */
  box(r: Rect, [y0, y1]: readonly [number, number], { top = false, inward = false, fit }: BoxSides = {}): void {
    for (const [a, b, n] of wallsOf(r)) {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      fit?.(len);
      const [p, q, nn]: [V3, V3, V3] = inward ? [b, a, [-n[0], 0, -n[2]]] : [a, b, n];
      const [u0, u1] = inward ? [len, 0] : [0, len];
      this.quad(
        [
          [p[0], y0, p[2]],
          [q[0], y0, q[2]],
          [q[0], y1, q[2]],
          [p[0], y1, p[2]],
        ],
        nn,
        [
          [u0, y0],
          [u1, y0],
          [u1, y1],
          [u0, y1],
        ],
      );
    }
    if (top) {
      this.top(r, y1);
    }
  }

  /** A rect's flat top at height y, its uvs the ground's metres. */
  top({ x0, x1, z0, z1 }: Rect, y: number): void {
    this.quad(
      [
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
        [x0, y, z0],
      ],
      [0, 1, 0],
      [
        [x0, z1],
        [x1, z1],
        [x1, z0],
        [x0, z0],
      ],
    );
  }

  /** A flat ring at height y between a rect and the rect set in by k: a parapet's top. */
  ring(r: Rect, k: number, y: number): void {
    const i = inset(r, k),
      up: V3 = [0, 1, 0],
      uvs = [NO_UV, NO_UV, NO_UV, NO_UV] as const,
      at = (x: number, z: number): V3 => [x, y, z];
    this.quad([at(r.x0, r.z1), at(r.x1, r.z1), at(i.x1, i.z1), at(i.x0, i.z1)], up, uvs);
    this.quad([at(r.x1, r.z1), at(r.x1, r.z0), at(i.x1, i.z0), at(i.x1, i.z1)], up, uvs);
    this.quad([at(r.x1, r.z0), at(r.x0, r.z0), at(i.x0, i.z0), at(i.x1, i.z0)], up, uvs);
    this.quad([at(r.x0, r.z0), at(r.x0, r.z1), at(i.x0, i.z1), at(i.x0, i.z0)], up, uvs);
  }

  /** A geometry with no index (a cylinder, a cone) at (x, y, z), every vertex as `set` gave. */
  shape(g: BufferGeometry, [x, y, z]: V3): void {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      this.vert([p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z], [n.getX(i), n.getY(i), n.getZ(i)], NO_UV);
    }
  }

  /**
   * A skin through rings of corners, each ring turning the way a box's walls do, its faces flat. Each face's u runs along its lower edge, v is the
   * height. `mids`: each ring's own middle, round which it holds a pixel's width far off.
   */
  skin(rings: readonly (readonly V3[])[], mids?: readonly V3[]): void {
    for (let k = 0; k + 1 < rings.length; k++) {
      const lo = rings[k],
        hi = rings[k + 1];
      if (lo && hi) {
        this.skinBand([lo, hi], mids && [mids[k], mids[k + 1]]);
      }
    }
  }

  /** One band of `skin` between a ring and the next (and their middles, if given). */
  private skinBand(
    [lo, hi]: readonly [readonly V3[], readonly V3[]],
    ends?: readonly [V3 | undefined, V3 | undefined],
  ): void {
    for (const [i, a] of lo.entries()) {
      const j = (i + 1) % lo.length,
        b = lo[j],
        c = hi[j],
        d = hi[i];
      if (!b || !c || !d) {
        continue;
      }
      const n = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
        .cross(new Vector3(d[0] - b[0], d[1] - b[1], d[2] - b[2]))
        .normalize();
      const nn: V3 = [n.x, n.y, n.z],
        len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const at = (p: V3, mid: V3 | undefined, u: number): void => {
        if (mid) {
          this.lk = [mid[0], 0, mid[2], Wide.Across];
        }
        this.vert(p, nn, [u, p[1]]);
      };
      at(a, ends?.[0], 0);
      at(b, ends?.[0], len);
      at(c, ends?.[1], len);
      at(a, ends?.[0], 0);
      at(c, ends?.[1], len);
      at(d, ends?.[1], 0);
    }
  }

  /** The vertices so far, and their places. */
  get vertices(): number {
    return this.n;
  }
  get positions(): Float32Array {
    return this.pos;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry(),
      at = (a: Float32Array, k: number) => new BufferAttribute(a.slice(0, k * this.n), k);
    g.setAttribute('position', at(this.pos, 3));
    g.setAttribute('normal', at(this.nor, 3));
    g.setAttribute('fuv', at(this.fuv, 2));
    g.setAttribute('color', at(this.col, 3));
    g.setAttribute('look', at(this.look, 4));
    g.setAttribute('tint', at(this.tint, 3));
    g.setAttribute('aux', at(this.aux, 3));
    g.setAttribute('wash', at(this.wash, 3));
    g.setAttribute('washY', at(this.washY, 2));
    g.computeBoundingSphere();
    return g;
  }
}
