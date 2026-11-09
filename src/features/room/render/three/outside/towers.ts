// The city's buildings (`plan.ts` places them) on one material, a mesh for each ring round the window (`sweep.ts` cuts each to what the camera
// sees). A building is its tiers' walls, each wall's facade painted by the
// shader (`facadeMaterial`): its windows in bays and storeys on slim mullions, the glass over a room seen in depth (interior mapping) with its
// blind or curtains, mirroring the sky, the street's far side and the city's skyline beyond, with the sun's glare and a rare pane's short glint (under the bloom's threshold) on it; the
// walls in panels and tiles with their joints, slab edges and stains. At night its rooms are lit by each building's own habit (whole floors, zones,
// desks or stacks; a home room by room), gathered in patches, each in its lamp's colour, and some turn on or off as the night goes. Far away each
// pattern fades to its average where its scale is under a pixel, so it does not shimmer. The sky's light falls off down a wall toward the street.
// A flat block near the window has its balconies. On the roofs: a parapet, a membrane, gravel, sedum or pavers, a stair and lift bulkhead with its
// door, plant boxes, water tanks, solar panels, skylights, vents, air-conditioning units. The near roofs have the room's detail: the membrane's
// seams and its flashing up the parapet, the rain's ponds and grime, a framed steel door on a step with a lamp and a canopy over it, plant boxes
// on kerbs with their grilles, vent pipes in their boots and mushroom vents; the towers' masts, spires, lit lanterns and plant
// screens, their LED bands, the red beacons blinking at night. The tall landmarks wear their own light after dark (a floodlit head, lit edges, a
// lit crown; the tallest's a stepped spire), so the skyline is known by its shapes. A quiet few signs of abstract glyphs (no real words), neon or lit boxes, and shop fronts
// each in its own light. A thin lit thing keeps a pixel's width far off, or it would flash as the view moves.
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, MeshStandardMaterial, Vector3, type Sphere } from 'three';
import { GRID, STYLES, rng, topOf, type Building, type Rect, type Tier } from './plan';
import type { SignWash } from './signlight';
import { ballOf, bearing } from './sweep';

/** What a vertex is: an office's facade, a roof, a plain surface, a beacon, a lit crown, a band of LEDs, a home's facade (lit room by room), a solar panel, a sign, a spire in its floodlights. */
const enum Kind { Facade = 0, Roof = 1, Plain = 2, Beacon = 3, Crown = 4, Led = 5, Home = 6, Solar = 7, Sign = 8, Flood = 9 }
/** How a thin thing (a plain mast, a beacon, a line of LEDs) holds a pixel's width far off: `look` is its middle and this, the axes it grows on. */
const enum Wide { Across = 1, Up = 2, All = 3 }

/** The towers' LED bands: cyan, warm white, amber (the room's accent families), and how often each is picked. */
const LEDS = [0x4fd6ff, 0x4fd6ff, 0xffd8a6, 0xffd8a6, 0xffa64a] as const;

/** The signs' colours: cyan, amber, terracotta red (the room's accents) and a rare magenta, and how far from the window a low block has any, a tower. */
const SIGNS = [0x4fd6ff, 0x4fd6ff, 0xffb15a, 0xffb15a, 0xff5a3c, 0xff5a3c, 0xff3f9e] as const, SIGN_FAR = 1500, SIGN_TOWER = 3400;

/** A parapet's height over its roof (m), how far from the window a roof gets its plant and tanks, and its smallest things. */
const PARAPET = 1.1, CLUTTER = 900, FINE = 420;

/** A water tank and its lid, a vent pipe and its cap, the boot that seals a pipe to the membrane, a mushroom vent and its hood, centred on their own middles. */
const TANK = new CylinderGeometry(1.25, 1.25, 2.4, 16).toNonIndexed(), TANK_LID = new ConeGeometry(1.3, 0.4, 16).toNonIndexed(), VENT = new CylinderGeometry(0.14, 0.14, 0.8, 8).toNonIndexed(), VENT_CAP = new CylinderGeometry(0.24, 0.24, 0.1, 8).toNonIndexed();
const BOOT = new CylinderGeometry(0.2, 0.27, 0.14, 8).toNonIndexed(), MUSH = new CylinderGeometry(0.26, 0.3, 0.42, 10).toNonIndexed(), MUSH_CAP = new ConeGeometry(0.5, 0.24, 10).toNonIndexed();

type V3 = readonly [number, number, number];

/** The buildings' geometry: each vertex's place, normal, facade uv (m), frame colour, facade look (bay, storey, window share across and up), glass tint, (seed, kind, reflection), and a head's floodlight (colour, and the heights it runs between). */
class Mass {
  /** The vertices so far, and how many the arrays hold before they grow (the city has millions: plain arrays took most of its build). */
  private n = 0; private room = 4096;
  private pos = new Float32Array(3 * this.room); private nor = new Float32Array(3 * this.room); private fuv = new Float32Array(2 * this.room);
  private col = new Float32Array(3 * this.room); private look = new Float32Array(4 * this.room); private tint = new Float32Array(3 * this.room);
  private aux = new Float32Array(3 * this.room); private wash = new Float32Array(3 * this.room); private washY = new Float32Array(2 * this.room);
  private c = new Color(); private t = new Color();
  /** The look the next vertices take: its bay is stretched per wall (`box`'s `fit`). */
  lk: [number, number, number, number] = [1, 1, 0, 0];
  private ax: [number, number, number] = [0, Kind.Plain, 0];
  /** The floodlight on the next vertices: its colour, and from where to where it grows. */
  fl: [number, number, number] = [0, 0, 0];
  flY: [number, number] = [0, 0];
  /** The signs that light the wall they hang on. */
  washes: SignWash[] = [];

  /** What the next vertices are: their frame colour, tint, look, seed, kind and reflection. */
  set(frame: number | Color, tint: number, kind: Kind, seed = 0, look: [number, number, number, number] = [1, 1, 0, 0], refl = 0): this {
    if (typeof frame === 'number') this.c.setHex(frame); else this.c.copy(frame);
    this.t.setHex(tint);
    this.lk = look;
    this.ax = [seed, kind, refl];
    return this;
  }

  private grow(): void {
    const more = (a: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> => { const b = new Float32Array(2 * a.length); b.set(a); return b; };
    this.room *= 2;
    this.pos = more(this.pos); this.nor = more(this.nor); this.fuv = more(this.fuv); this.col = more(this.col); this.look = more(this.look);
    this.tint = more(this.tint); this.aux = more(this.aux); this.wash = more(this.wash); this.washY = more(this.washY);
  }

  private vert(p: V3, n: V3, u: number, v: number): void {
    if (this.n === this.room) this.grow();
    const i = this.n++, i2 = 2 * i, i3 = 3 * i, i4 = 4 * i, { pos, nor, fuv, col, tint, look, aux, wash, washY, c, t, lk, ax, fl, flY } = this;
    pos[i3] = p[0]; pos[i3 + 1] = p[1]; pos[i3 + 2] = p[2];
    nor[i3] = n[0]; nor[i3 + 1] = n[1]; nor[i3 + 2] = n[2];
    fuv[i2] = u; fuv[i2 + 1] = v;
    col[i3] = c.r; col[i3 + 1] = c.g; col[i3 + 2] = c.b;
    tint[i3] = t.r; tint[i3 + 1] = t.g; tint[i3 + 2] = t.b;
    look[i4] = lk[0]; look[i4 + 1] = lk[1]; look[i4 + 2] = lk[2]; look[i4 + 3] = lk[3];
    aux[i3] = ax[0]; aux[i3 + 1] = ax[1]; aux[i3 + 2] = ax[2];
    wash[i3] = fl[0]; wash[i3 + 1] = fl[1]; wash[i3 + 2] = fl[2];
    washY[i2] = flY[0]; washY[i2 + 1] = flY[1];
  }

  /** A quad a, b, c, d (counter-clockwise seen from its front) and its uvs, as two triangles. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]): void {
    this.vert(a, n, ua[0], ua[1]); this.vert(b, n, ub[0], ub[1]); this.vert(c, n, uc[0], uc[1]);
    this.vert(a, n, ua[0], ua[1]); this.vert(c, n, uc[0], uc[1]); this.vert(d, n, ud[0], ud[1]);
  }

  /** A box's walls from y0 to y1 (outward, or inward for a parapet's inner face) and its top if `top`. Each wall's u runs along it from its left. */
  box(r: Rect, y0: number, y1: number, top: boolean, inward = false, fit?: (len: number) => void): void {
    const { x0, x1, z0, z1 } = r;
    const walls: [V3, V3, V3][] = [
      [[x0, 0, z1], [x1, 0, z1], [0, 0, 1]], [[x1, 0, z1], [x1, 0, z0], [1, 0, 0]],
      [[x1, 0, z0], [x0, 0, z0], [0, 0, -1]], [[x0, 0, z0], [x0, 0, z1], [-1, 0, 0]],
    ];
    for (const [a, b, n] of walls) {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      fit?.(len);
      const [p, q, nn]: [V3, V3, V3] = inward ? [b, a, [-n[0], 0, -n[2]]] : [a, b, n];
      const [u0, u1] = inward ? [len, 0] : [0, len];
      this.quad([p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]], nn, [u0, y0], [u1, y0], [u1, y1], [u0, y1]);
    }
    if (top) this.top(r, y1);
  }

  /** A rect's flat top at height y, its uvs the ground's metres. */
  top(r: Rect, y: number): void {
    const { x0, x1, z0, z1 } = r;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
  }

  /** A flat ring at height y between a rect and the rect set in by k: a parapet's top. */
  ring(r: Rect, k: number, y: number): void {
    const i = inset(r, k), up: V3 = [0, 1, 0], o: [number, number] = [0, 0];
    this.quad([r.x0, y, r.z1], [r.x1, y, r.z1], [i.x1, y, i.z1], [i.x0, y, i.z1], up, o, o, o, o);
    this.quad([r.x1, y, r.z1], [r.x1, y, r.z0], [i.x1, y, i.z0], [i.x1, y, i.z1], up, o, o, o, o);
    this.quad([r.x1, y, r.z0], [r.x0, y, r.z0], [i.x0, y, i.z0], [i.x1, y, i.z0], up, o, o, o, o);
    this.quad([r.x0, y, r.z0], [r.x0, y, r.z1], [i.x0, y, i.z1], [i.x0, y, i.z0], up, o, o, o, o);
  }

  /** A geometry with no index (a cylinder, a cone) at (x, y, z), every vertex as `set` gave. */
  shape(g: BufferGeometry, x: number, y: number, z: number): void {
    const p = g.attributes.position!, n = g.attributes.normal!;
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z], [n.getX(i), n.getY(i), n.getZ(i)], 0, 0);
  }

  /**
   * A skin through rings of corners, each ring turning the way a box's walls do, its faces flat. Each face's u runs along its lower edge, v is the
   * height. `mids`: each ring's own middle, round which it holds a pixel's width far off.
   */
  skin(rings: readonly (readonly V3[])[], mids?: readonly V3[]): void {
    for (let k = 0; k + 1 < rings.length; k++) {
      const lo = rings[k]!, hi = rings[k + 1]!;
      for (let i = 0; i < lo.length; i++) {
        const j = (i + 1) % lo.length, a = lo[i]!, b = lo[j]!, c = hi[j]!, d = hi[i]!;
        const n = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).cross(new Vector3(d[0] - b[0], d[1] - b[1], d[2] - b[2])).normalize();
        const nn: V3 = [n.x, n.y, n.z], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const at = (p: V3, r: number, u: number): void => {
          if (mids) this.lk = [mids[r]![0], 0, mids[r]![2], Wide.Across];
          this.vert(p, nn, u, p[1]);
        };
        at(a, k, 0); at(b, k, len); at(c, k + 1, len);
        at(a, k, 0); at(c, k + 1, len); at(d, k + 1, 0);
      }
    }
  }

  /** The vertices so far, and their places. */
  get vertices(): number { return this.n; }
  get positions(): Float32Array { return this.pos; }

  geometry(): BufferGeometry {
    const g = new BufferGeometry(), at = (a: Float32Array, k: number) => new BufferAttribute(a.slice(0, k * this.n), k);
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

const inset = (r: Rect, k: number): Rect => ({ x0: r.x0 + k, x1: r.x1 - k, z0: r.z0 + k, z1: r.z1 - k });
const sized = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

/** A field of solar panels in rows, tilted to the south (+z) on dark frames. */
function solar(m: Mass, r: Rect, y: number): void {
  const dep = 1.7, rise = 0.5, foot = 0.22, l = Math.hypot(dep, rise), n: V3 = [0, dep / l, rise / l];
  for (let z1 = r.z1; z1 - dep >= r.z0; z1 -= dep + 1.1) {
    const z0 = z1 - dep;
    m.set(0x40444a, 0, Kind.Plain).box({ x0: r.x0 + 0.1, x1: r.x1 - 0.1, z0: z0 + 0.1, z1: z1 - 0.1 }, y, y + foot + rise * 0.4, false);
    m.set(0, 0, Kind.Solar).quad([r.x0, y + foot, z1], [r.x1, y + foot, z1], [r.x1, y + foot + rise, z0], [r.x0, y + foot + rise, z0], n, [r.x0, 0], [r.x1, 0], [r.x1, l], [r.x0, l]);
  }
}

/** A roof's membrane turned up the inner face of the rect r's walls (`out`: up the outer face) to h over y, under a metal bar: its flashing. */
function flashing(m: Mass, r: Rect, y: number, h: number, out = false): void {
  const k = out ? -0.04 : 0.04, face = inset(r, k), bar = inset(r, k * 1.25);
  m.set(0x505356, 0, Kind.Plain).box(face, y, y + h, false, !out);
  m.set(0x9fa3a6, 0, Kind.Plain).box(bar, y + h, y + h + 0.05, false, !out);
  if (out) m.ring(bar, -k * 1.25, y + h + 0.05); else m.ring(r, k * 1.25, y + h + 0.05);
}

/**
 * What stands on a roof, the largest first, each where the others leave room: a bulkhead with its door and a paved way to it, solar panels, plant
 * boxes, a water tank on its stand, a row of air-conditioning units on their rail, skylights, vent pipes. `fine`: near enough for the small things:
 * then the bulkhead has its flashing, a framed door on a step, a lamp over it under a canopy, and the roof its mushroom vents.
 */
function clutter(m: Mass, r: Rect, y: number, b: Building, rand: () => number, fine: boolean): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w < 10 || d < 10) return;
  const used: Rect[] = [];
  /** A free place on the roof for pw by pd, away from the parapet and what stands there already (placed by `pick`, by default the roof's own stream). */
  const place = (pw: number, pd: number, pick = rand): Rect | null => {
    if (pw > w - 2.4 || pd > d - 2.4) return null;
    for (let i = 0; i < 8; i++) {
      const q = sized(r.x0 + 1.2 + pw / 2 + pick() * (w - 2.4 - pw), r.z0 + 1.2 + pd / 2 + pick() * (d - 2.4 - pd), pw, pd);
      if (used.every((u) => q.x1 + 0.7 < u.x0 || q.x0 - 0.7 > u.x1 || q.z1 + 0.7 < u.z0 || q.z0 - 0.7 > u.z1)) { used.push(q); return q; }
    }
    return null;
  };
  const shade = new Color(b.frame).lerp(new Color(0x9a968e), 0.6);
  const head = place(4 + rand() * 4, 4 + rand() * 3);
  if (head) {
    const cx = (head.x0 + head.x1) / 2, cz = (head.z0 + head.z1) / 2;
    m.set(shade, 0, Kind.Plain).box(head, y, y + 3.4 + rand() * 1.5, true);
    m.set(shade.clone().multiplyScalar(1.1), 0, Kind.Plain).ring(inset(head, -0.12), 0.12, y + 3.42);
    if (fine) {
      // the steel door over the flashing's sill, in a frame, its lever; a step up to it; a lamp over it, warm at night, under a canopy
      const at = (x0: number, x1: number, out: number): Rect => ({ x0: cx + x0, x1: cx + x1, z0: head.z1, z1: head.z1 + out });
      flashing(m, head, y, 0.28, true);
      m.set(0x74787c, 0, Kind.Plain).box(at(-0.66, 0.66, 0.07), y + 0.26, y + 2.5, true);
      m.set(0x2b3033, 0, Kind.Plain).box(at(-0.52, 0.52, 0.1), y + 0.33, y + 2.4, true);
      m.set(0xb5b8ba, 0, Kind.Plain).box({ x0: cx + 0.26, x1: cx + 0.42, z0: head.z1 + 0.1, z1: head.z1 + 0.16 }, y + 1.22, y + 1.27, true);
      m.set(0x9c9890, 0, Kind.Plain).box(at(-0.8, 0.8, 0.62), y, y + 0.18, true);
      m.set(0x3a3d40, 0, Kind.Plain).box(at(-0.15, 0.15, 0.13), y + 2.6, y + 2.84, true);
      m.set(0xffd8a6, 0, Kind.Led, 0, [0, 0, 0, 0], 0.85).box({ x0: cx - 0.11, x1: cx + 0.11, z0: head.z1 + 0.13, z1: head.z1 + 0.145 }, y + 2.63, y + 2.81, false);
      m.set(0x7d8186, 0, Kind.Plain).box(at(-0.9, 0.9, 0.6), y + 2.94, y + 3.02, true);
      m.set(0xa39f96, 0, Kind.Plain).box(rand() < 0.5 ? { x0: r.x0 + 0.3, x1: head.x0, z0: cz - 0.5, z1: cz + 0.5 } : { x0: cx - 0.5, x1: cx + 0.5, z0: head.z1 + 0.62, z1: r.z1 - 0.3 }, y, y + 0.07, true);
    }
  }
  // a roof's share of things grows with its size
  const large = Math.floor((w * d) / 350);
  for (let i = 0, n = (rand() < 0.5 ? 1 : 0) + Math.min(1, large); i < n; i++) {
    const q = place(Math.min(w - 3, 7 + rand() * 16), Math.min(d - 3, 6 + rand() * 12));
    if (q) solar(m, q, y);
  }
  // a duct along the roof, on a plant box at its end
  for (let i = 0, n = Math.floor(rand() * 2) + Math.min(2, large); i < n; i++) {
    const along = rand() < 0.5, l = (along ? w : d) * (0.25 + rand() * 0.4), q = along ? place(l, 0.5) : place(0.5, l);
    if (q) {
      m.set(0x9a9ea2, 0, Kind.Plain).box(q, y + 0.15, y + 0.6, true);
      const e = sized(along ? q.x1 : (q.x0 + q.x1) / 2, along ? (q.z0 + q.z1) / 2 : q.z1, 1.5, 1.5);
      m.set(0x7d8186, 0, Kind.Plain).box(e, y, y + 1.3, true);
    }
  }
  for (let i = 0, n = 1 + Math.floor(rand() * 3) + Math.min(3, large); i < n; i++) {
    const s = 1.6 + rand() * 1.8, q = place(s * 1.4, s);
    if (!q) continue;
    const top = y + 1.2 + rand() * 0.8;
    m.set(0x8d9196, 0, Kind.Plain).box(q, y + (fine ? 0.16 : 0), top, true);
    if (fine) {
      // near, a plant box stands on a dark kerb, its intake grille on the window's side, its fan's grille on top
      const cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2, fan = Math.min(q.x1 - q.x0, q.z1 - q.z0) * 0.3;
      m.set(0x3d4043, 0, Kind.Plain).box(inset(q, 0.08), y, y + 0.16, false);
      m.set(0x4a4e52, 0, Kind.Plain).box({ x0: q.x0 + 0.18, x1: q.x1 - 0.18, z0: q.z1, z1: q.z1 + 0.025 }, y + 0.4, top - 0.22, true);
      m.box(sized(cx, cz, fan * 2, fan * 2), top, top + 0.05, true);
    }
  }
  if (rand() < 0.35) {
    const q = place(2.8, 2.8);
    if (q) {
      const x = (q.x0 + q.x1) / 2, z = (q.z0 + q.z1) / 2, tint = rand() < 0.5 ? 0xa8acae : 0x6d7a80;
      m.set(0x303336, 0, Kind.Plain).box(sized(x, z, 1.9, 1.9), y, y + 1.1, true);
      m.set(tint, 0, Kind.Plain).shape(TANK, x, y + 2.3, z);
      m.shape(TANK_LID, x, y + 3.7, z);
    }
  }
  if (rand() < 0.7) {
    // the outdoor units in a row, pale grey boxes on a dark rail
    const n = 3 + Math.floor(rand() * 5), run = Math.min(n * 1.25, w - 6), q = place(run + 0.4, 1.0);
    if (q) {
      const x = (q.x0 + q.x1) / 2, z = (q.z0 + q.z1) / 2;
      m.set(0x3a3d40, 0, Kind.Plain).box(q, y, y + 0.25, true);
      m.set(0xc7c9c8, 0, Kind.Plain);
      for (let i = 0; i < n && (i + 1) * 1.25 <= run + 0.01; i++) m.box(sized(x - run / 2 + 0.62 + i * 1.25, z, 0.95, 0.42), y + 0.25, y + 0.95, true);
    }
  }
  if (!fine) return;
  // the skylights over a stairwell or a top floor's rooms, a little warm at night
  if (rand() < 0.45) for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
    const q = place(1.7, 2.8);
    if (q) {
      m.set(0x40444a, 0, Kind.Plain).box(inset(q, -0.1), y, y + 0.3, false);
      m.set(0xb9915f, 0, Kind.Crown, b.seed % 991, [0.85, y, 1, 0]).box(q, y + 0.3, y + 0.55, true);
    }
  }
  for (let i = 0, n = Math.floor(rand() * 6); i < n; i++) {
    const q = place(0.5, 0.5);
    if (q) {
      const x = (q.x0 + q.x1) / 2, z = (q.z0 + q.z1) / 2;
      m.set(0x6a6e72, 0, Kind.Plain).shape(VENT, x, y + 0.4, z);
      m.shape(VENT_CAP, x, y + 0.84, z);
      m.set(0x3d4043, 0, Kind.Plain).shape(BOOT, x, y + 0.07, z);
    }
  }
  // the mushroom vents, from their own stream, so all that stands before them keeps its place
  const more = rng(b.seed * 31 + 7);
  for (let i = 0, n = 2 + Math.floor(more() * 3); i < n; i++) {
    const q = place(1, 1, more);
    if (q) {
      const x = (q.x0 + q.x1) / 2, z = (q.z0 + q.z1) / 2;
      m.set(0x3d4043, 0, Kind.Plain).shape(BOOT, x, y + 0.07, z);
      m.set(0x8e9296, 0, Kind.Plain).shape(MUSH, x, y + 0.35, z);
      m.shape(MUSH_CAP, x, y + 0.68, z);
    }
  }
}

/** A flat block's balconies on its street side (z1): a slab out from each storey, its front of frosted glass. */
function balconies(m: Mass, t: Tier, storey: number, b: Building): void {
  const rail = new Color(0x5d666e).lerp(new Color(b.frame), 0.25), x0 = t.x0 + 0.5, x1 = t.x1 - 0.5;
  for (let y = t.y0 + storey; y < t.y1 - 0.5; y += storey) {
    m.set(b.frame, 0, Kind.Plain).box({ x0, x1, z0: t.z1, z1: t.z1 + 1.3 }, y - 0.18, y, true);
    m.set(rail, 0, Kind.Plain).box({ x0, x1, z0: t.z1 + 1.22, z1: t.z1 + 1.3 }, y, y + 1.05, true);
  }
}

/** A tower's screen round its roof's plant: its walls carried on up past the roof, open inside, capped. */
function screen(m: Mass, t: Tier, h: number, b: Building): void {
  const c = new Color(b.frame).lerp(new Color(0x8a9096), 0.4);
  m.set(c, 0, Kind.Plain).box(t, t.y1 + PARAPET, t.y1 + h, false);
  m.box(inset(t, 0.4), t.y1 + PARAPET, t.y1 + h, false, true);
  m.set(c.clone().multiplyScalar(1.15), 0, Kind.Plain).ring(t, 0.4, t.y1 + h);
}

/** A tower's crown on its top tier: a mast, a spire, a lit lantern; a red beacon at its tip and on the roof's corners. */
function crown(m: Mass, b: Building, rand: () => number): void {
  const t = b.tiers[b.tiers.length - 1]!, h = topOf(b), cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
  let tip = h + PARAPET;
  if (b.crown === 'mast') {
    const mh = 25 + h * 0.12;
    if (b.light) m.set(b.light, 0, Kind.Flood, 0, [0, h, 6, 0]);
    else m.set(0x9da2a8, 0, Kind.Plain);
    m.box(sized(cx, cz, 3, 3), h, h + 6, true);
    m.set(0x9da2a8, 0, Kind.Plain, 0, [cx, 0, cz, Wide.Across]).box(sized(cx, cz, 1.1, 1.1), h + 6, h + mh, true);
    tip = h + mh;
    // a landmark's mast: rings of light up it
    if (b.light) for (let k = 1; k <= 5; k++) {
      const y = h + 6 + ((mh - 8) * k) / 5;
      m.set(b.light, 0, Kind.Led, b.seed % 991, [cx, y + 0.45, cz, Wide.All]).box(sized(cx, cz, 2.2, 2.2), y, y + 0.9, true);
    }
  } else if (b.crown === 'spire') {
    tip = spire(m, b, t, h);
  } else if (b.crown === 'lantern') {
    // a glass lantern over the roof, its ribs in the frame's colour; lit warm at night, a landmark's the brighter in its own light
    const lh = 10 + rand() * 6, r = inset(t, 2.5);
    m.set(b.light ?? 0xffc98f, 0, Kind.Crown, b.seed, [2.4, h, lh, b.light ? 1.5 : 0]).box(r, h, h + lh, true);
    m.set(b.frame, 0, Kind.Plain).box(inset(r, -0.3), h + lh, h + lh + 1.2, true);
    if (b.light) m.set(b.light, 0, Kind.Led, b.seed % 991, [0, h + lh + 0.6, 0, Wide.Up]).box(inset(r, -0.36), h + lh + 0.25, h + lh + 0.95, false);
    tip = h + lh + 1.2;
  } else if (b.style !== 'tile' && h > 70 && rand() < 0.55) {
    const sh = 4 + rand() * 4;
    screen(m, t, sh, b);
    tip = h + sh;
  }
  if (h < 110) return;
  m.set(0x400808, 0, Kind.Beacon, rand(), [cx, tip + 0.6, cz, Wide.All]).box(sized(cx, cz, 1.2, 1.2), tip, tip + 1.2, true);
  // a spire's corners hold its blades
  if (b.crown === 'spire') return;
  for (const [x, z] of [[t.x0 + 1, t.z0 + 1], [t.x1 - 1, t.z1 - 1], [t.x0 + 1, t.z1 - 1], [t.x1 - 1, t.z0 + 1]] as const) m.set(0x400808, 0, Kind.Beacon, rand(), [x, h + PARAPET + 0.4, z, Wide.All]).box(sized(x, z, 0.8, 0.8), h + PARAPET, h + PARAPET + 0.8, true);
}

/** A spire's stages from the foot up: each one's height as a share of the spire's. */
const STAGES = [0.3, 0.24, 0.19, 0.15, 0.12] as const;

/**
 * A spire on a tower's top tier, in the tower's own lines: four blades carry its corners up past the roof and lean in; between them eight-sided
 * stages of glass rise, each slimmer and shorter than the one below, under a thin eave with a line of light; a needle with rings of light tops
 * them. A stage glows brightest at its foot. Its tip's height.
 */
function spire(m: Mass, b: Building, t: Tier, h: number): number {
  const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, w = Math.min(t.x1 - t.x0, t.z1 - t.z0), metal = new Color(b.frame).lerp(new Color(0xc8ccd0), 0.5), seed = b.seed % 991;
  /** A band of eight sides through these radii and heights, its flats facing the tower's walls. */
  const lathe = (...profile: readonly (readonly [number, number])[]): void => m.skin(profile.map(([r, y]) => Array.from({ length: 8 }, (_, i): V3 => {
    const a = -(i + 0.5) * (Math.PI / 4);
    return [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  })));
  for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) blade(m, t, sx, sz, h, h * 0.065, metal, b.light, seed);
  const sh = h * 0.16;
  let y = h, r = w * 0.38;
  for (const share of STAGES) {
    const y1 = y + sh * share, top = r * 0.87, eave = top + 1.7;
    if (b.light) m.set(b.light, 0, Kind.Crown, seed, [2.4, y, y1 - y, 1.5]);
    else m.set(metal, 0, Kind.Plain);
    lathe([r, y], [top, y1]);
    // the eave: its soffit, its edge, and its slope in to the next stage
    const next = top * 0.76;
    m.set(metal, 0, Kind.Plain);
    lathe([top, y1], [eave, y1 + 0.5], [eave, y1 + 1.3], [next, y1 + 3]);
    if (b.light) {
      m.set(b.light, 0, Kind.Led, seed, [0, y1 + 0.9, 0, Wide.Up]);
      lathe([eave + 0.08, y1 + 0.5], [eave + 0.08, y1 + 1.3]);
    }
    y = y1 + 3;
    r = next;
  }
  // the last slope, the light going on up it; then the needle, fainter, and its rings of light
  if (b.light) m.set(b.light, 0, Kind.Flood, 0, [0, y - 2, 18, 0]);
  else m.set(metal, 0, Kind.Plain);
  lathe([r, y], [1.4, y + 5]);
  y += 5;
  const needle = 20;
  if (b.light) m.set(new Color(b.light).multiplyScalar(0.45), 0, Kind.Led, seed, [cx, 0, cz, Wide.Across], 1);
  else m.set(metal, 0, Kind.Plain, 0, [cx, 0, cz, Wide.Across]);
  lathe([1.1, y], [0.3, y + needle]);
  if (b.light) for (const [k, s] of [[0.12, 2.6], [0.3, 2], [0.48, 1.5]] as const) {
    const ry = y + needle * k;
    m.set(b.light, 0, Kind.Led, seed, [cx, ry + 0.4, cz, Wide.All]).box(sized(cx, cz, s, s), ry, ry + 0.8, true);
  }
  return y + needle;
}

/** A blade on a tier's corner (sx, sz: which one) from y0 up `high`, narrowing to a point and leaning a little in toward the spire: metal by day, lit at night. Diamond in section. */
function blade(m: Mass, t: Tier, sx: number, sz: number, y0: number, high: number, metal: Color, light: number | undefined, seed: number): void {
  const x = sx > 0 ? t.x1 - 2.4 : t.x0 + 2.4, z = sz > 0 ? t.z1 - 2.4 : t.z0 + 2.4, dx = sx * Math.SQRT1_2, dz = sz * Math.SQRT1_2;
  const mids: V3[] = [], rings: V3[][] = [];
  for (const s of [0, 1]) {
    const pull = 3.5 * s, half = 0.12 + 2.2 * (1 - s);
    const c: V3 = [x - dx * pull, y0 + high * s, z - dz * pull];
    const at = (a: number, e: number): V3 => [c[0] + dz * a + dx * e, c[1], c[2] - dx * a + dz * e];
    mids.push(c);
    rings.push([at(0, half), at(half, 0), at(0, -half), at(-half, 0)]);
  }
  if (light) m.set(new Color(light).multiplyScalar(0.6), 0, Kind.Led, seed, [0, 0, 0, 0], 1);
  else m.set(metal, 0, Kind.Plain);
  m.skin(rings, mids);
}

/** A line of LEDs round a tier, under its parapet. */
function band(m: Mass, t: Tier): void {
  m.lk = [0, t.y1 - 0.625, 0, Wide.Up];
  m.box(inset(t, -0.06), t.y1 - 0.9, t.y1 - 0.35, false);
}

/** A strip of LEDs up a tier's corners. */
function corners(m: Mass, t: Rect, y0: number, y1: number, w: number): void {
  for (const [x, z] of [[t.x0, t.z0], [t.x1, t.z0], [t.x1, t.z1], [t.x0, t.z1]] as const) {
    m.lk = [x, 0, z, Wide.Across];
    m.box(sized(x, z, w, w), y0, y1, false);
  }
}

/** A modern tower's LEDs: a band round the top of each tier under its parapet; on a few, a strip up each corner of the shaft. A landmark has them all, in its own light. */
function leds(m: Mass, b: Building): void {
  const r = rng(b.seed ^ 0x5bd1);
  if (b.light) {
    m.set(b.light, 0, Kind.Led, b.seed % 991);
    for (const [i, t] of b.tiers.entries()) {
      band(m, t);
      if (i > 0) corners(m, t, t.y0, t.y1 - 0.9, 0.5);
    }
    return;
  }
  if (b.style === 'tile' || topOf(b) < 60 || r() > 0.55) return;
  m.set(LEDS[Math.floor(r() * LEDS.length)]!, 0, Kind.Led, b.seed % 991);
  for (const t of b.tiers) band(m, t);
  const s = b.tiers[1];
  if (!s || r() > 0.3) return;
  corners(m, s, s.y0, b.tiers[b.tiers.length - 1]!.y1 - 0.9, 0.36);
}

/** A tall tower's head in floodlights at night: a landmark's always, in its own light; a few others', fainter. Its colour (linear), and the height it starts from. */
function headLight(b: Building): { c: [number, number, number]; from: number } | null {
  const h = topOf(b), r = rng(b.seed ^ 0x3ead), col = (hex: number, k: number): [number, number, number] => { const c = new Color(hex); return [c.r * k, c.g * k, c.b * k]; };
  if (b.light) return { c: col(b.light, 1.05), from: h * 0.62 };
  if (h < 130 || b.style === 'tile' || r() > 0.28) return null;
  return { c: col(LEDS[Math.floor(r() * LEDS.length)]!, 0.5), from: h * (0.78 + r() * 0.12) };
}

/**
 * A sign's board, its glyphs on its south face (and its north one if `both`), its other faces a dark case. `lit`: a lit box with dark glyphs, not
 * neon on a dark board. `on`: the wall it hangs from, which takes its light.
 */
function board(m: Mass, r: Rect, y0: number, y1: number, colour: number, seed: number, lit: boolean, both: boolean, on?: { fixed: 'x' | 'z'; at: number; out: number }): void {
  const look: [number, number, number, number] = [r.x1 - r.x0, y1 - y0, y0, lit ? 1 : 0];
  let wall = 0;
  if (on) {
    const xs = on.fixed === 'z';
    m.washes.push({ ...on, mid: xs ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2, half: xs ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2, y0, y1, colour, seed, box: lit });
  }
  m.set(colour, 0, Kind.Sign, seed);
  m.box(r, y0, y1, true, false, () => { m.lk = wall === 0 || (both && wall === 2) ? look : [1, 1, 0, -1]; wall++; });
}

/**
 * A building's signs, seen from the window up its street, nearest the most: a tall one out from a wall over an avenue, one flat on a south
 * wall over a street, a board on legs on the roof's south edge, a tower's tall board high on its shaft. Quiet: most have none. Its own generator:
 * the others' draws stay as they were.
 */
function signs(m: Mass, b: Building, away: number): void {
  const t = b.tiers[0]!, r = rng(b.seed ^ 0x51a6), share = away < 700 ? 1 : 0.5, storey = STYLES[b.style].storey;
  const colour = (): number => SIGNS[Math.floor(r() * SIGNS.length)]!, seed = (): number => Math.floor(r() * 991) + 0.37;
  if (away < SIGN_TOWER && topOf(b) >= 60 && b.style !== 'tile' && r() < 0.11) {
    const s = b.tiers[Math.min(1, b.tiers.length - 1)]!, w = 3.5 + r() * 3, h = Math.min((s.y1 - s.y0) * 0.7, w * (4 + Math.floor(r() * 6))), x = s.x0 + w + r() * (s.x1 - s.x0 - 2 * w), y1 = s.y1 - 2 - r() * (s.y1 - s.y0 - h - 2);
    board(m, { x0: x - w / 2, x1: x + w / 2, z0: s.z1 + 0.1, z1: s.z1 + 0.5 }, y1 - h, y1, colour(), seed(), r() < 0.3, false, { fixed: 'z', at: s.z1, out: 1 });
  }
  if (away > SIGN_FAR || t.y1 < 9) return;
  const onGrid = (v: number, pitch: number): boolean => Math.abs(v / pitch - Math.round(v / pitch)) < 1e-6;
  const y0 = storey + 0.6, tall = (w: number): number => Math.min(t.y1 - y0 - 0.8, w * (3 + Math.floor(r() * 6)));
  for (const [on, x, out] of [[onGrid(t.x1 - GRID.av0 + GRID.avenue / 2, GRID.px), t.x1, 1], [onGrid(t.x0 - GRID.av0 - GRID.avenue / 2, GRID.px), t.x0, -1]] as const) {
    if (!on || r() > 0.5 * share) continue;
    const w = 1.9 + r() * 1, h = tall(w), z = t.z0 + 2 + r() * (t.z1 - t.z0 - 4), near = x + out * 0.2, far = near + out * w;
    if (h < w * 2) continue;
    board(m, { x0: Math.min(near, far), x1: Math.max(near, far), z0: z - 0.14, z1: z + 0.14 }, y0, y0 + h, colour(), seed(), r() < 0.25, true, { fixed: 'x', at: x, out });
    m.set(0x26282b, 0, Kind.Plain);
    for (const y of [y0 + 0.4, y0 + h - 0.6]) m.box({ x0: Math.min(x, near), x1: Math.max(x, near), z0: z - 0.05, z1: z + 0.05 }, y, y + 0.14, true);
  }
  const south = onGrid(-t.z1 - GRID.street, GRID.pz), width = t.x1 - t.x0;
  if (south && b.tiers.length === 1 && b.style !== 'band' && r() < 0.28 * share) {
    const w = 1.9 + r() * 1, h = tall(w), x = t.x0 + w + r() * (width - 2 * w);
    if (h >= w * 2) board(m, { x0: x - w / 2, x1: x + w / 2, z0: t.z1 + 0.06, z1: t.z1 + 0.34 }, y0, y0 + h, colour(), seed(), r() < 0.25, false, { fixed: 'z', at: t.z1, out: 1 });
  }
  if (south && b.tiers.length === 1 && t.y1 < 45 && width > 9 && r() < 0.18 * share) {
    const w = Math.min(width - 3, 5 + r() * 10), h = Math.max(1.6, w / (3 + Math.floor(r() * 3))), x = t.x0 + 1.5 + w / 2 + r() * (width - 3 - w);
    const z = t.z1 - 1, foot = t.y1, up = foot + PARAPET + 0.5;
    m.set(0x303336, 0, Kind.Plain);
    for (let k = 0, n = Math.max(2, Math.round(w / 3.5)); k < n; k++) {
      const lx = x - w / 2 + 0.3 + ((w - 0.6) * k) / (n - 1);
      m.box(sized(lx, z - 0.12, 0.12, 0.12), foot, up + h - 0.2, false);
      m.box(sized(lx, z - 1.1, 0.1, 0.1), foot, up + h * 0.4, false);
    }
    board(m, { x0: x - w / 2, x1: x + w / 2, z0: z - 0.06, z1: z + 0.16 }, up, up + h, colour(), seed(), r() < 0.4, false);
  }
}

/** The rings round the window (m: each one's outer edge) whose buildings make one geometry each: a draw, cut to what the camera sees (`sweep.ts`). */
const RINGS = [150, 300, 600, CLUTTER, 1800, 3600, Infinity] as const;

/** A ring's buildings: their geometry, each building's ball, and where each one's vertices start in it (then their end). */
export interface MassRing { geometry: BufferGeometry; balls: Sphere[]; at: number[] }

/** The buildings, one geometry for each ring round the window, each ring's buildings in their bearing's order. `washes` takes the signs that light a wall (`signlight.ts`). */
export function massGeometries(bs: readonly Building[], washes: SignWash[] = []): MassRing[] {
  const away = (b: Building): number => Math.hypot((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2 - GRID.av0, b.tiers[0]!.z1);
  const mid = (b: Building): number => bearing((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2, (b.tiers[0]!.z0 + b.tiers[0]!.z1) / 2);
  const rings = RINGS.map(() => [] as Building[]);
  for (const b of bs) rings[RINGS.findIndex((r) => away(b) < r)]!.push(b);
  return rings.filter((r) => r.length).map((ring) => {
    const m = new Mass(), balls: Sphere[] = [], at = [0];
    m.washes = washes;
    for (const b of ring.sort((p, q) => mid(p) - mid(q))) {
      building(m, b, away(b));
      balls.push(ballOf(m.positions, at[at.length - 1]!, m.vertices));
      at.push(m.vertices);
    }
    return { geometry: m.geometry(), balls, at };
  });
}

/** A building into `m`, `away` from the window (m). */
function building(m: Mass, b: Building, away: number): void {
  const s = STYLES[b.style], rand = rng(b.seed), near = away < CLUTTER, head = headLight(b);
  b.tiers.forEach((t, i) => {
    // the walls: each wall's bays stretched to fit it whole
    const home = b.style === 'tile' || (b.style === 'band' && topOf(b) < 60);
    m.set(b.frame, b.tint, home ? Kind.Home : Kind.Facade, (b.seed % 997) + i * 0.37, [s.bay, s.storey, s.win[0], s.win[1]], s.refl);
    if (head) { m.fl = head.c; m.flY = [head.from, topOf(b)]; }
    m.box(t, t.y0, t.y1, false, false, (len) => { m.lk[0] = len / Math.max(1, Math.round(len / s.bay)); });
    m.fl = [0, 0, 0];
    m.flY = [0, 0];
    // the parapet round the roof, the gravel inside it
    const frame = new Color(b.frame).multiplyScalar(b.style === 'glass' ? 1 : 0.92);
    m.set(frame, 0, Kind.Plain).box(t, t.y1, t.y1 + PARAPET, false);
    m.box(inset(t, 0.3), t.y1, t.y1 + PARAPET, false, true);
    m.set(frame.clone().multiplyScalar(1.15), 0, Kind.Plain).ring(t, 0.3, t.y1 + PARAPET);
    const floor = inset(t, 0.3);
    m.set(0x8a8780, 0, Kind.Roof, b.seed % 991, [floor.x0, floor.x1, floor.z0, floor.z1]).top(floor, t.y1);
    if (near) flashing(m, floor, t.y1, 0.32);
    // an office grid's stone cap under its parapet's top and its string course over the shop fronts; any other's slim metal cap
    if (b.style === 'grid') {
      const stone = new Color(b.frame).multiplyScalar(1.06), out = 0.25;
      m.set(stone, 0, Kind.Plain).box(inset(t, -out), t.y1 + PARAPET - 0.75, t.y1 + PARAPET + 0.12, false);
      m.ring(inset(t, -out), out + 0.3, t.y1 + PARAPET + 0.12);
      if (i === 0 && t.y1 > s.storey * 2) {
        m.box(inset(t, -0.18), s.storey - 0.35, s.storey, false);
        m.ring(inset(t, -0.18), 0.18, s.storey);
      }
    } else {
      m.set(frame.clone().lerp(new Color(0xb4b9be), 0.5), 0, Kind.Plain).box(inset(t, -0.12), t.y1 + PARAPET - 0.25, t.y1 + PARAPET + 0.05, false);
      m.ring(inset(t, -0.12), 0.42, t.y1 + PARAPET + 0.05);
    }
    // a flat block's balconies; the plant on the roof (on a podium, in the strip in front of the shaft, the side the window sees)
    const next = b.tiers[i + 1];
    if (near && b.style === 'band' && b.tiers.length === 1) balconies(m, t, s.storey, b);
    if (near) {
      const free = next ? { ...t, z0: next.z1 + 1 } : t;
      if (free.z1 - free.z0 > 10) clutter(m, free, t.y1, b, rand, away < FINE);
    }
  });
  crown(m, b, rand);
  leds(m, b);
  signs(m, b, away);
}

/** The facade's light by the hour: the lit rooms' share of their full glow at night, the clock for the beacons, the sun (direction, colour) and the horizon's colour, for what the glass mirrors and the shadows on a wall; and a picture's pixel in metres for each metre away. */
export interface FacadeUniforms { night: { value: number }; time: { value: number }; sun: { value: Vector3 }; sunCol: { value: Color }; hor: { value: Color }; pixel: { value: number } }

/** The buildings' material: a standard one whose colour, roughness, metalness and glow the facade's shader paints. */
export function facadeMaterial(): { mat: MeshStandardMaterial; u: FacadeUniforms } {
  const u: FacadeUniforms = { night: { value: 0 }, time: { value: 0 }, sun: { value: new Vector3(0, 1, 0) }, sunCol: { value: new Color(0, 0, 0) }, hor: { value: new Color(0, 0, 0) }, pixel: { value: 0 } };
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.fNight = u.night;
    sh.uniforms.fTime = u.time;
    sh.uniforms.fSun = u.sun;
    sh.uniforms.fSunCol = u.sunCol;
    sh.uniforms.fHor = u.hor;
    sh.uniforms.fPixel = u.pixel;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fuv;\nattribute vec4 look;\nattribute vec3 tint;\nattribute vec3 aux;\nattribute vec3 wash;\nattribute vec2 washY;\nuniform float fPixel;\nvarying vec2 vFuv;\nflat varying vec4 vLook;\nvarying vec3 vTint;\nflat varying vec3 vAux;\nflat varying vec3 vWash;\nflat varying vec2 vWashY;\nvarying float vWide;\nvarying vec3 vFW;\nvarying vec3 vFN;')
      // a thin thing far off holds a whole pixel of the window's (two of the picture's), or it would come and go as the view moves; a lit one dims as it grows
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFuv = fuv; vLook = look; vTint = tint; vAux = aux; vWash = wash; vWashY = washY; vWide = 1.0;
int fk = int(aux.y + 0.5);
if (look.w > 0.5 && (fk == ${Kind.Plain} || fk == ${Kind.Beacon} || fk == ${Kind.Led})) {
  vec3 wo = transformed - look.xyz, wa = abs(wo), wm = look.w < 1.5 ? vec3(1.0, 0.0, 1.0) : look.w < 2.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0);
  vec3 wg = mix(wa, max(wa, vec3(distance(transformed, cameraPosition) * fPixel)), wm);
  transformed += sign(wo) * (wg - wa);
  vWide = dot(wa / wg, wm) / dot(wm, wm);
}
vFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float fNight, fTime;
uniform vec3 fSun, fSunCol, fHor;
varying vec2 vFuv;
// flat: a wall's seed interpolated comes out a hair different from pixel to pixel, and any hash of it a different number, in specks
flat varying vec4 vLook;
varying vec3 vTint;
flat varying vec3 vAux;
flat varying vec3 vWash;
flat varying vec2 vWashY;
varying float vWide;
varying vec3 vFW;
varying vec3 vFN;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** A band from a to b across x, its edges softened by the pixel's width w. */
float fBand(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
/** How much the rooms in use gather at a place on a wall: in patches up it and along it. */
float fGather(vec2 p, float seed) { return (0.35 + 1.3 * fNoise(vec2(seed * 3.3, p.y / 34.0))) * (0.55 + 0.9 * fNoise(p / vec2(23.0, 16.0) + seed * 5.1)); }
/** A lamp's colour by its warmth, from 0 (a cold daylight tube) through a neutral white to 1 (an old warm bulb). */
vec3 fLampCol(float t) {
  vec3 c = mix(vec3(0.74, 0.87, 1.0), vec3(1.0, 0.87, 0.68), smoothstep(0.0, 0.5, t));
  return mix(c, vec3(1.0, 0.62, 0.32), smoothstep(0.5, 1.0, t));
}
/**
 * The city as a pane's ray r sees it past the street's far side: two rows of towers round the horizon, the far one paler in the haze, each its own
 * height, against the sky; by day the hour's haze on them, one side of each in the sun; at night dark, their lit rooms and now and then a sign.
 * px: how far r turns over a pixel. Its colour, and how much of the ray it stops.
 */
vec4 fCityMirrored(vec3 r, float px) {
  float az = atan(r.x, r.z), el = r.y;
  vec4 o = vec4(0.0);
  for (int k = 0; k < 2; k++) {
    float fk = 1.0 - float(k), nz = mix(26.0, 47.0, fk), ny = mix(310.0, 520.0, fk), c = az * nz + fk * 3.7, cid = floor(c), cu = c - cid, th = fHash(vec2(cid, 4.1 + fk));
    float top = mix(0.03 + 0.2 * th * th, 0.012 + 0.085 * th * th * th, fk), a = smoothstep(top + px, top - px, el);
    a *= mix(smoothstep(0.0, 0.05, cu) * smoothstep(1.0, 0.95, cu), 0.9, smoothstep(0.03, 0.2, px * nz)) * step(0.14, fHash(vec2(cid, 7.7 + fk)));
    float roomLit = smoothstep(0.42, 0.8, fNoise(vec2(c * 1.7, el * ny * 0.13 + cid))) * (0.12 + 0.5 * fHash(vec2(cid, 2.3)));
    vec3 wall = fHor * mix(0.2 + 0.25 * th, 0.5 + 0.2 * th, fk) + fSunCol * 0.05 * (1.0 - fk) * smoothstep(0.35, 0.75, cu);
    vec3 col = wall * (1.0 - 0.5 * fNight) + fLampCol(fHash(vec2(cid, 11.3))) * roomLit * fNight * mix(1.0, 0.6, fk);
    float sn = fHash(vec2(cid, 23.9));
    if (sn > 0.9) col += (sn > 0.97 ? vec3(1.0, 0.25, 0.62) : sn > 0.935 ? vec3(0.3, 0.84, 1.0) : vec3(1.0, 0.68, 0.34)) * smoothstep(0.1, 0.0, abs(el - top * (0.55 + 0.3 * sn)) / max(top, 0.01)) * 1.2 * fNight;
    o = mix(o, vec4(col, 1.0), a);
  }
  return o;
}
/** How far a point in a sign's glyph's box (0 to 1) is from the nearest stroke: up to three across and three up, each whole or part way. No real letters. */
float fGlyph(vec2 c, float gh) {
  float d = 9.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k), a = fHash(vec2(gh, fk + 0.5)), b = fHash(vec2(gh, fk + 3.5));
    if (fHash(vec2(gh, fk + 6.5)) > 0.35) d = min(d, length(max(abs(c - vec2(a < 0.5 ? 0.5 : a < 0.75 ? 0.28 : 0.72, 0.5 * fk)) - vec2(a < 0.5 ? 0.5 : 0.28, 0.0), 0.0)));
    if (fHash(vec2(gh, fk + 9.5)) > 0.45) d = min(d, length(max(abs(c - vec2(0.5 * fk, b < 0.5 ? 0.5 : b < 0.75 ? 0.28 : 0.72)) - vec2(0.0, b < 0.5 ? 0.5 : 0.28), 0.0)));
  }
  return d;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fRough = 0.85, fMetal = 0.0, fVis = 1.0, fSpec = 1.0;
vec3 fGlow = vec3(0.0), fTilt = vec3(0.0);
int fKind = int(vAux.y + 0.5);
// the sky's light falls off down a wall: at the street's level the blocks across hide most of it
float fAo = 0.4 + 0.6 * smoothstep(0.0, 26.0, vFW.y);
if (fKind == 0 || fKind == 6) {
  vec2 g = vFuv / vLook.xy, id = floor(g), f = fract(g), fw = fwidth(g);
  float home = fKind == 6 ? 1.0 : 0.0, seed = vAux.x, refl = vAux.z;
  float h = fHash(id + seed), h2 = fHash(id * 1.37 + seed + 7.1), h3 = fHash(id * 2.71 + seed * 0.13 + 3.3);
  // how much of each scale a pixel covers: a bay across, a floor up; the detail in a window (its room, its blind's edge) goes first. Each
  // pattern fades to its average where its scale is under the pixel, so the far city does not shimmer
  float cx = smoothstep(0.1, 0.35, fw.x), cy = smoothstep(0.1, 0.35, fw.y), cf = max(cx, cy);
  float fine = smoothstep(0.05, 0.18, max(fw.x, fw.y));
  // the window; the ground floor's shop windows are wider and down to the pavement, a fascia over them, and more of them lit
  float shop = 1.0 - step(0.5, id.y);
  vec2 win = mix(vLook.zw, vec2(0.94, 0.66), shop);
  vec2 lo = vec2(0.5 - 0.5 * win.x, mix((1.0 - win.y) * 0.6, 0.05, shop)), hi = lo + win;
  vec2 e = mix(smoothstep(lo - fw, lo + fw, f) - smoothstep(hi - fw, hi + fw, f), win, vec2(cx, cy));
  float m = e.x * e.y;
  vec2 o = clamp((f - lo) / win, 0.0, 1.0), ow = fw / win;
  // a wide window's lites on slim dark mullions, a metre or so apart
  float wm = win.x * vLook.x, lite = wm / max(1.0, floor(wm / 1.2 + 0.5)), mpx = fw.x * vLook.x;
  float mull = smoothstep(0.035 + mpx, 0.035 - mpx, (0.5 - abs(fract(o.x * wm / lite) - 0.5)) * lite);
  mull = mix(mull, 0.07 / lite, smoothstep(0.1, 0.35, mpx / lite)) * m;
  m -= mull;
  // who is in. Each building has its share of lit rooms and its own habit: an office lit in whole floors, in zones of a few bays, desk by
  // desk, or in stacks a few floors high; a home room by room. The rooms in use gather in patches up and along a wall. A zone now and then
  // turns its lights on or off, each on its own slow clock. Far off a zone's ends soften into its neighbours
  float habit = fHash(vec2(floor(seed) * 0.37, 21.7));
  float share = 0.06 + 0.42 * fHash(vec2(seed * 0.731, 5.3));
  float zw = home > 0.5 ? 1.0 + step(0.55, fHash(vec2(seed, 8.7))) : habit < 0.2 ? 7.0 + floor(8.0 * fHash(vec2(seed, 8.1))) : habit < 0.55 ? 2.0 + floor(4.0 * fHash(vec2(seed, 8.1))) : habit < 0.8 ? 1.0 : 2.0 + floor(2.0 * fHash(vec2(seed, 8.1)));
  float zh = home < 0.5 && habit >= 0.8 ? 3.0 + floor(6.0 * fHash(vec2(seed, 19.3))) : 1.0;
  float zone = floor(id.x / zw), fl = floor(id.y / zh), cz = smoothstep(0.08, 0.25, fw.x / zw), cv = smoothstep(0.1, 0.35, fw.y / zh), cr = max(cz, cv);
  float gather = fGather(vFuv, seed), gatherZ = fGather(vec2(zone * zw * vLook.x, fl * zh * vLook.y), seed);
  float rf = fHash(vec2(fl * 0.37 + seed, 2.9)), zlit, zt = fract(vFuv.x / (vLook.x * zw)), zs = 0.5 * smoothstep(0.04, 0.16, fw.x / zw);
  float occ = home > 0.5 ? share * gatherZ : min(1.0, share * 2.6 * rf * rf * gatherZ);
  float swN = floor(fTime / (70.0 + 170.0 * fHash(vec2(zone + seed, fl + 1.7))) + fHash(vec2(fl + seed, zone + 2.3)));
  zlit = abs(step(fHash(vec2(zone * 1.91 + seed, fl * 0.83 + 4.7)), occ) - step(0.94, fHash(vec2(zone * 3.1 + seed + swN * 0.77, fl * 1.3 + 6.1))));
  if (zs > 0.0) zlit = mix(zlit, 0.5 * (zlit + step(fHash(vec2((zt < 0.5 ? zone - 1.0 : zone + 1.0) * 1.91 + seed, fl * 0.83 + 4.7)), occ)), smoothstep(zs, 0.0, min(zt, 1.0 - zt)));
  float lit = mix(mix(zlit, occ, cz), share * gather * mix(0.86, 1.0, home), cv);
  lit *= mix(mix(step(h3, 0.9), 0.9, cx), 1.0, home);
  // a dark room still shows a little: a corridor's light, an exit sign, a standby lamp
  lit = max(lit, 0.05);
  // a shop, a few bays wide: open or shut as one, in its own light, most of them warm, some the city's neon
  float sw = 1.0 + floor(3.0 * fHash(vec2(seed, 13.7))), sid = floor(id.x / sw), hs = fHash(vec2(sid + seed * 2.3, 11.3)), sOpen = step(fHash(vec2(sid + seed, 17.1)), 0.8);
  vec3 sCol = hs < 0.5 ? vec3(1.0, 0.8, 0.58) : hs < 0.64 ? vec3(0.3, 0.8, 1.0) : hs < 0.78 ? vec3(1.0, 0.58, 0.2) : hs < 0.92 ? vec3(1.0, 0.32, 0.2) : vec3(1.0, 0.26, 0.64);
  sCol = mix(sCol, vec3(1.0, 0.7, 0.5), cx);
  lit = mix(lit, mix(sOpen, 0.8, cx), shop);
  // the light: each building has its own warmth, an office's from cold to neutral, a home's from neutral to a warm bulb, each zone a little off
  // it and at its own brightness; a few a fluorescent green or a screen's blue. A curtain wall's glass tints it. Far off, the building's own
  float hc = fHash(vec2(zone + seed * 3.1, fl + 9.2)), bt = fHash(vec2(floor(seed) * 0.61, 33.1));
  float kz = mix(0.55 + 0.7 * fHash(vec2(hc, 3.7)), 1.0, cr) * (0.72 + 0.56 * fHash(vec2(floor(seed) * 0.43, 41.9)));
  vec3 lamp = fLampCol(mix(0.68 * bt, 0.55 + 0.45 * bt, home) + (hc - 0.5) * 0.55 * (1.0 - cr));
  lamp = mix(lamp, mix(vec3(0.7, 1.0, 0.82), vec3(0.42, 0.56, 1.0), home), step(0.95, hc) * (1.0 - cr));
  lamp = mix(lamp, sCol, shop) * mix(vec3(1.0), vTint / max(max(vTint.r, vTint.g), max(vTint.b, 1e-3)), refl * 0.5 * (1.0 - shop));
  // the room behind the pane in depth (interior mapping): the eye's ray goes on into a box the room's size (its bays wide, a storey high, a
  // few metres deep) and meets its back wall, a side wall, the floor or the ceiling, an office's desks, a home's sofa or its lamp's shade.
  // Its colour by day (dark, lit from the window), its light at night (where the room's lamps put it); far off, their averages
  float rw = zw * vLook.x, rc = hi.y * vLook.y + 0.12, hr = fHash(vec2(zone + seed, id.y + 0.5));
  float dep = home > 0.5 ? 3.4 + 1.8 * fHash(vec2(seed, 1.9)) : 7.0 + 5.0 * fHash(vec2(seed, 1.9));
  vec3 inDay = vec3(0.035);
  float inLit = mix(0.36, 0.4, home);
  if (fine < 0.999 && m > 0.0) {
    vec3 V = normalize(vFW - cameraPosition), rd = vec3(dot(V, vec3(vFN.z, 0.0, -vFN.x)), V.y, max(-dot(V, vFN), 0.02));
    rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x;
    rd.y = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    vec3 p = vec3(clamp(vFuv.x - zone * rw, 0.0, rw), clamp(f.y * vLook.y, 0.01, rc - 0.01), 0.0);
    vec3 tt = (vec3(rd.x > 0.0 ? rw : 0.0, rd.y > 0.0 ? rc : 0.0, dep) - p) / rd;
    float t = min(min(tt.x, tt.y), tt.z), level = step(tt.y, min(tt.x, tt.z)), alb, L;
    vec3 q = p + rd * t;
    if (home < 0.5) {
      // an office: carpet that dims away from the window's row of lamps, pale walls darker below the desks' line, a ceiling of light panels.
      // A panel's edge softens with the pixel, more along the depth a low view squeezes
      float s = 0.04 + fw.x * vLook.x, sz = s + fw.y * vLook.y * rd.z / abs(rd.y);
      if (level > 0.5 && rd.y > 0.0) {
        float pnl = smoothstep(0.3 + s, 0.3 - s, abs(fract(q.x / 2.4) - 0.5) * 2.4) * smoothstep(0.6 + sz, 0.6 - sz, abs(fract(q.z / 2.4 + 0.25) - 0.5) * 2.4);
        alb = 0.7; L = 0.2 + 2.8 * pnl;
      } else if (level > 0.5) { alb = 0.3; L = 0.75 * (0.55 + 0.45 * exp(-q.z / 5.0)); }
      else { alb = 0.6; L = 0.55 * (1.0 - 0.45 * smoothstep(1.1, 0.9, q.y)); }
    } else {
      // a home: a wooden floor, painted walls, the lamp's shade hanging in the middle, a sofa along the back wall, a picture over it
      vec3 lp = vec3(rw * (0.3 + 0.4 * hr), rc - 0.55, dep * 0.55), oc = p - lp;
      float tf = rd.y < 0.0 ? (0.48 - p.y) / rd.y : 1e9;
      vec3 qd = p + rd * tf;
      if (tf < t && qd.z > dep - 0.95 && qd.x > rw * 0.2 && qd.x < rw * 0.8) { q = qd; alb = 0.14; }
      else if (level > 0.5) alb = rd.y > 0.0 ? 0.7 : 0.32;
      else alb = (0.5 + 0.25 * hr) * (tt.z <= tt.x && abs(q.x - rw * 0.5) < rw * 0.12 && abs(q.y - 1.6) < 0.3 ? 0.4 : 1.0);
      L = 0.14 + 0.8 / (1.0 + dot(q - lp, q - lp) * 0.3);
      float b = dot(oc, rd), c = dot(oc, oc) - 0.05;
      if (b < 0.0 && b * b > c) { alb = 1.0; L = 3.0; }
    }
    inDay = mix(inDay, vec3(alb * (0.15 + 0.85 * exp(-q.z / 2.5)) * 0.12), 1.0 - fine);
    inLit = mix(inLit, alb * L, 1.0 - fine);
  }
  // a blind part way down an office's pane; a home's curtains drawn to the sides, a few closed. Fabric: pale by day, glowing with the
  // room's light at night
  float drop = step(0.55, h2) * fract(h2 * 13.7), cw = 0.06 + 0.22 * fract(h2 * 7.3), sheer = step(0.84, h2);
  float cov = home > 0.5
    ? max(sheer, max(smoothstep(cw + ow.x, cw - ow.x, o.x), smoothstep(1.0 - cw - ow.x, 1.0 - cw + ow.x, o.x)))
    : step(0.01, drop) * smoothstep(1.0 - drop - ow.y, 1.0 - drop + ow.y, o.y);
  cov = mix(cov, mix(0.22, 0.44, home), cf) * (1.0 - shop);
  float fold = mix(home > 0.5 ? 0.82 + 0.18 * sin(o.x * win.x * vLook.x * 22.0) : 0.86 + 0.14 * o.y, 1.0, fine);
  vec3 room = mix(inDay, mix(vec3(0.42, 0.43, 0.44), vec3(0.62, 0.57, 0.5), home) * fold, cov);
  float through = mix(inLit, mix(0.3, 0.4, home) * fold, cov);
  float deep = 1.0 - smoothstep(0.5, 0.8, refl);
  // a punched window sits back in the wall: its reveal's shadow along the head and down one side
  float reveal = max(smoothstep(hi.y - 0.14 * win.y - fw.y, hi.y - 0.14 * win.y + fw.y, f.y), 1.0 - smoothstep(lo.x + 0.07 * win.x - fw.x, lo.x + 0.07 * win.x + fw.x, f.x));
  vec3 glass = mix(room, vTint, refl) * (1.0 - mix(reveal, 0.1, cf) * 0.6 * deep);
  // the frame: each floor a touch different, rain streaks down it, a little grime toward the street
  vec3 fr = vColor.rgb * (0.92 + 0.14 * mix(fHash(vec2(id.y, seed)), 0.5, cy)) * (0.84 + 0.16 * smoothstep(0.0, 20.0, vFuv.y));
  fr *= 0.86 + 0.22 * fNoise(vec2(vFuv.x * 0.45, vFuv.y * 0.03 + seed));
  // a wall's own make, anything but a curtain wall's: panels a bay wide and a storey high, each a little off, their joints; a stone
  // office's piers paler than its spandrels; a tiled front's courses; a slab's edge at each floor, the stain under each sill. Each goes where a
  // pixel covers it
  float solid = 1.0 - smoothstep(0.6, 0.8, refl), trim = 1.0 - step(0.2, refl), stone = fBand(0.3, 0.4, refl, 0.001), pxm = max(fw.x * vLook.x, fw.y * vLook.y);
  float fade = smoothstep(0.08, 0.3, pxm), tiled = trim * (1.0 - smoothstep(0.04, 0.12, pxm));
  float grain = fNoise(vFuv * vec2(1.7, 3.1) + seed);
  float joint = mix(smoothstep(0.03 + mpx, 0.03 - mpx, min(f.x, 1.0 - f.x) * vLook.x), 0.06 / vLook.x, cx);
  float pier = mix(1.0 - fBand(lo.x, hi.x, f.x, fw.x), 1.0 - win.x, cx);
  vec2 tq = vec2(vFuv.x / 0.42 + 0.5 * mod(floor(vFuv.y / 0.21), 2.0), vFuv.y / 0.21), tf = abs(fract(tq) - 0.5);
  float drip = fBand(lo.x, hi.x, f.x, fw.x) * (1.0 - step(lo.y, f.y)) * smoothstep(0.0, lo.y, f.y) * fNoise(vec2(vFuv.x * 4.3 + seed, id.y * 3.1));
  fr *= 1.0 + (grain - 0.5) * 0.14 * (1.0 - fade) + solid * (1.0 - trim) * (mix(h, 0.5, cf) - 0.5) * 0.14;
  fr *= 1.0 - solid * joint * 0.3 * (1.0 - trim);
  fr *= 1.0 + stone * (pier * 0.18 - 0.08);
  fr *= mix(1.0, (0.88 + 0.24 * fHash(floor(tq) + seed)) * (1.0 - 0.3 * max(smoothstep(0.42, 0.5, tf.x), smoothstep(0.38, 0.5, tf.y))), tiled);
  fr *= 1.0 - solid * mix(drip * 0.42, 0.04, cf);
  fr *= 1.0 + solid * 0.16 * mix(fBand(-0.01, 0.045, f.y, fw.y), 0.045, cy);
  // the sun's shadow under a slab's edge, as deep as the sun is high against this wall
  float under = 0.16 * max(fSun.y, 0.0) / max(dot(fSun, vFN), 0.08) / vLook.y;
  fVis = 1.0 - solid * mix(fBand(1.0 - min(under, 0.5), 1.1, f.y, fw.y), min(under, 0.5), cy);
  // a tiled front's stone sills and lintels
  float sill = fBand(lo.x - 0.04, hi.x + 0.04, f.x, fw.x) * (fBand(lo.y - 0.07, lo.y, f.y, fw.y) + fBand(hi.y, hi.y + 0.08, f.y, fw.y));
  fr = mix(fr, vec3(0.62, 0.58, 0.51) * (0.9 + 0.2 * mix(h, 0.5, cf)), mix(sill, 0.08, cf) * trim * (1.0 - shop));
  diffuseColor.rgb = mix(mix(fr, vec3(0.03, 0.033, 0.036), mull / max(1.0 - m, 1e-3)), glass, m);
  // a shop's fascia over its window, the whole of its width: painted in its colour, lit when it is open
  float fasc = shop * mix(fBand(hi.y + 0.03, 0.9, f.y, fw.y), 0.17, cy) * mix(fBand(0.04 / sw, 1.0 - 0.04 / sw, (mod(id.x, sw) + f.x) / sw, fw.x / sw), 1.0, cx);
  diffuseColor.rgb = mix(diffuseColor.rgb, sCol * 0.3 + 0.015, fasc);
  fRough = mix(0.8, 0.05 + 0.12 * mix(h, 0.5, max(cf, fNight)) * refl + 0.12 * (1.0 - refl), m);
  fMetal = mix(0.0, refl * 0.9, m);
  // by day a curtain wall's panes each a little out of true, so the sky they mirror breaks up pane by pane; at night they lie flat, or the
  // street lamps' glints would scatter over them in specks
  fTilt = (vec3(h, h2, h3) - 0.5) * 0.09 * m * refl * (1.0 - cf) * (1.0 - fNight);
  // the night: the lit rooms' light through their glass (a mirror glass lets less through), the frame round a lit window catching a
  // little of it, the street lamps' warm light washing the lowest floors' walls. A building's rooms come on at its own time as the night
  // comes (its place in the ramp: one early, one late), a shop with the street. In the room's units (a unit is about 700 cd/m2): a lit
  // room's window about 150 cd/m2, a shop's about 300, so the city's windows do not outshine the room's lamps
  float bNight = mix(smoothstep(0.0, 0.2, fNight - 0.8 * fHash(vec2(floor(seed) * 0.29, 51.3))), fNight, shop);
  fGlow = lamp * kz * lit * through * m * (1.0 - 0.5 * refl * (1.0 - shop)) * (bNight * mix(0.6, 1.2, shop) + 0.02);
  fGlow += sCol * fasc * mix(sOpen, 0.8, cx) * 0.7 * fNight;
  fGlow += fr * lamp * lit * 0.06 * bNight * (1.0 - m);
  fGlow += fr * vec3(1.0, 0.72, 0.45) * 0.45 * exp(-vFuv.y / 6.0) * fNight * (1.0 - m);
  // a tall tower's head in its floodlights: brightest under its crown, fading down the wall, the walls taking more of it than the glass
  if (vWashY.y > 0.0) {
    float washK = clamp((vFW.y - vWashY.x) / (vWashY.y - vWashY.x), 0.0, 1.0);
    fGlow += vWash * washK * washK * mix(1.0, 0.4, m) * fNight;
  }
  // what the pane mirrors under the sky, where the sky's cube knows nothing: the eye's ray goes on, turned by the glass, to the far side of the
  // street, to a roof line that wanders along it. Under that line it meets the walls across (in shade or in the sun, as they face), their
  // windows, lit at night, or the road. Each pane is a little out of true, so the picture breaks at its edges
  vec3 fV = normalize(vFW - cameraPosition), fR = reflect(fV, vFN);
  float rn = max(dot(fR, vFN), 0.1);
  vec2 rs = vec2(dot(fR, vec3(vFN.z, 0.0, -vFN.x)), fR.y) / rn + (vec2(h, h2) - 0.5) * (0.01 + 0.025 * refl) * (1.0 - cf);
  vec2 rp = vec2(vFuv.x, vFW.y) + rs * (abs(vFN.x) > 0.5 ? 32.0 : 24.0), rg = rp / vec2(3.0, 3.4), rc2 = fract(rg);
  float rtop = 13.0 + 32.0 * fNoise(vec2(rp.x / 34.0, seed * 0.37)), hit = 1.0 - smoothstep(rtop - 0.7, rtop + 0.7, rp.y);
  float road = 1.0 - smoothstep(-0.4, 0.4, rp.y), pane = mix(fBand(0.18, 0.82, rc2.x, 0.1) * fBand(0.22, 0.78, rc2.y, 0.1), 0.34, cf);
  vec3 across = (fHor * 0.3 + fSunCol * max(dot(fSun, -vFN), 0.0) * 0.26) * (1.0 - 0.3 * pane);
  across += vec3(1.0, 0.76, 0.5) * pane * mix(step(0.74, fHash(floor(rg) + seed)), 0.26, cf) * 0.55 * fNight;
  vec3 mirrorK = mix(mix(vec3(0.1 + 0.09 * h), vTint * 1.7, refl * 0.9), vec3(1.0), pow(1.0 - clamp(-dot(fV, vFN), 0.0, 1.0), 5.0));
  fGlow += mirrorK * hit * mix(across, fHor * 0.09, road) * m;
  // over that line, the rest of the city, and only then the sky: a coated pane's sky bright by day, dim at night, under the lights it mirrors
  vec4 cityIn = fCityMirrored(normalize(fR + fTilt * 2.0), max(length(fwidth(fR)), 0.0012));
  fGlow += mirrorK * (1.0 - hit) * cityIn.a * cityIn.rgb * m;
  fSpec = (1.0 - max(hit, cityIn.a) * m) * mix(1.0, mix(2.0, 0.7, fNight), refl * m);
  // the sun on the glass: panes bow a little, so its image spreads to a wide glare over a wall turned toward it, broken pane by pane; one pane
  // in twenty-five, opened or set out of true, glints in turn as the eye or the sun moves: short, in the sun's colour, at most 0.6 over the
  // pane, so it stays under the bloom's threshold (1.2) and never reads as a white pane
  float sunFace = smoothstep(0.0, 0.15, dot(vFN, fSun));
  if (sunFace > 0.0 && refl > 0.2) {
    float gS = max(dot(reflect(fV, normalize(vFN + (vec3(h, h2, h3) - 0.5) * 0.16 * (1.0 - cf))), fSun), 0.0);
    float flash = step(0.96, h3) * step(0.6, refl) * pow(abs(fract(h2 * 17.0 + fTime * 0.02 + (cameraPosition.x + cameraPosition.y) * 0.013) * 2.0 - 1.0), 40.0);
    fGlow += fSunCol * m * sunFace * (refl * (0.16 * pow(gS, 10.0) + 1.2 * pow(gS, 90.0)) + (1.0 - cf) * 0.6 * flash * (0.25 + 0.75 * o.y * o.y));
  }
} else if (fKind == 5) {
  // a lit band of LEDs: a thin dark line by day, a bright one at night. On a spire's metal (vAux.z) it is that metal by day
  diffuseColor.rgb = mix(vec3(0.04), vec3(0.55, 0.58, 0.6), vAux.z);
  fRough = 0.3;
  fGlow = vColor.rgb * (0.12 + fNight * 2.1) * pow(vWide, 0.6);
} else if (fKind == 9) {
  // a spire in its floodlights: pale metal, bright at its foot where they stand, fading up. vLook: from where, how high
  diffuseColor.rgb = vec3(0.55, 0.58, 0.6);
  fRough = 0.5;
  fGlow = vColor.rgb * (0.12 + 1.5 * exp(-3.0 * clamp((vFW.y - vLook.y) / max(vLook.z, 1.0), 0.0, 1.0))) * fNight;
} else if (fKind == 1) {
  // a roof, each of its own make: a pale membrane in lapped sheets, gravel, a sedum garden inside a gravel margin, or dark bitumen with its
  // pavers. Water marks over them all, grime and the sky's shade along the parapet. Vlook: the roof's rect
  vec2 g = vFuv, gw = fwidth(g);
  float px = max(gw.x, gw.y), seed = vAux.x, make = fHash(vec2(seed, 3.3)), rr = fHash(vec2(seed, 6.1));
  float edge = min(min(g.x - vLook.x, vLook.y - g.x), min(g.y - vLook.z, vLook.w - g.y));
  float sheetF = 1.0 - smoothstep(0.25, 0.8, px), grainF = 1.0 - smoothstep(0.1, 0.4, px);
  float big = mix(fNoise(g * 0.09 + seed), 0.5, smoothstep(2.0, 8.0, px)), mid = mix(fNoise(g * 0.41 + seed * 1.7), 0.5, smoothstep(0.5, 2.0, px));
  float grit = mix(fNoise(g * 3.7 + seed) * 0.6 + fNoise(g * 11.0) * 0.4, 0.5, grainF < 0.01 ? 1.0 : 1.0 - grainF);
  vec3 c;
  if (make < 0.42) {
    // sheets two metres wide, each row's ends lapped where the rolls ran out; a welded seam is a dark line with its lip's bright edge beside it
    vec2 s = rr < 0.5 ? g : g.yx;
    float q = s.x / 2.0, l = fract(q), row = floor(q), roll = 7.0 + 5.0 * fHash(vec2(row, seed * 1.3)), e = fract(s.y / roll + fHash(vec2(row, seed + 2.7)));
    float sd = min(min(l, 1.0 - l) * 2.0, min(e, 1.0 - e) * roll);
    float lap = mix(smoothstep(0.08 + px * 0.5, 0.0, sd), 0.05, 1.0 - sheetF), lip = mix(smoothstep(0.05 + px * 0.5, 0.0, abs(sd - 0.12)), 0.0, 1.0 - sheetF);
    c = mix(vec3(0.27, 0.285, 0.29), vec3(0.42, 0.42, 0.405), rr) * (0.96 + 0.12 * mix(fHash(vec2(row, seed)), 0.5, 1.0 - sheetF)) * (1.0 - 0.42 * lap + 0.12 * lip);
    c *= 0.66 + 0.52 * smoothstep(0.25, 0.7, big * 0.6 + mid * 0.4);
  } else if (make < 0.74) {
    c = vColor.rgb * (0.66 + 0.6 * big) * (0.74 + 0.52 * grit);
  } else if (make < 0.9) {
    float bloom = smoothstep(0.34, 0.66, mid * 0.6 + big * 0.4);
    c = mix(vec3(0.06, 0.082, 0.035), vec3(0.135, 0.115, 0.05), bloom) * (0.65 + 0.7 * grit);
    c = mix(vColor.rgb * (0.74 + 0.52 * grit), c, smoothstep(0.85, 1.15, edge));
  } else {
    vec2 pv = g / vec2(1.2, 0.8), pf = abs(fract(pv) - 0.5);
    float slab = mix(smoothstep(0.5, 0.44, max(pf.x, pf.y)), 0.8, 1.0 - sheetF);
    c = mix(vec3(0.05), vec3(0.19, 0.185, 0.17) * (0.88 + 0.24 * mix(fHash(floor(pv) + seed), 0.5, 1.0 - sheetF)), slab * step(make, 0.95));
    c *= 0.8 + 0.4 * big;
  }
  // where the rain lies after a storm: a pond a little darker, its tide line darker still; streaks of grime run from it
  float pond = fNoise(g * 0.13 + seed * 2.9), pw = fwidth(pond);
  float tide = mix(smoothstep(0.012 + pw, 0.0, abs(pond - 0.63)), 0.0, 1.0 - sheetF), wet = smoothstep(0.62, 0.64, pond);
  float grime = mix(smoothstep(0.55, 0.8, fNoise(vec2(g.x * 1.6, g.y * 0.09) + seed * 4.3)), 0.25, 1.0 - sheetF) * smoothstep(0.45, 0.6, pond);
  c *= (1.0 - 0.14 * wet) * (1.0 - 0.3 * tide) * (1.0 - 0.18 * grime);
  diffuseColor.rgb = c * (0.78 + 0.22 * smoothstep(0.0, 3.0, edge));
  fRough = 0.94;
  fAo = 0.45 + 0.55 * smoothstep(0.0, 1.5, edge);
} else if (fKind == 7) {
  // a solar panel: dark blue cells on fine silver lines, smooth enough to mirror the sky
  vec2 g = vFuv * 2.0, gw = fwidth(g), d = abs(fract(g) - 0.5);
  float l = mix(max(smoothstep(0.44 - gw.x, 0.44 + gw.x, d.x), smoothstep(0.44 - gw.y, 0.44 + gw.y, d.y)), 0.2, smoothstep(0.2, 0.6, max(gw.x, gw.y)));
  diffuseColor.rgb = mix(vec3(0.012, 0.022, 0.06), vec3(0.3, 0.32, 0.34), l * 0.6);
  fRough = 0.16 + 0.3 * l;
  fMetal = 0.3 * (1.0 - l);
  fAo = 1.0;
} else if (fKind == 2) {
  // plain metal and cement, weathered a little
  diffuseColor.rgb *= 0.88 + 0.24 * fNoise(vFW.xz * 0.4 + vFW.y * 0.7);
  fAo = max(fAo, 0.72);
} else if (fKind == 3) {
  diffuseColor.rgb = vColor.rgb;
  fGlow = vec3(1.0, 0.06, 0.03) * 9.0 * vWide * step(0.55, fract(fTime * 0.45 + vAux.x)) * fNight;
} else if (fKind == 4) {
  // a lit lantern: panes on slim ribs, brightest at the foot where its lamps stand, fading up
  vec2 g = vec2(vFuv.x / vLook.x, (vFuv.y - vLook.y) / 3.0), w = fwidth(g), d = abs(fract(g) - 0.5);
  float pane = mix(smoothstep(0.42 + w.x, 0.42 - w.x, d.x) * smoothstep(0.46 + w.y, 0.46 - w.y, d.y), 0.75, smoothstep(0.15, 0.4, max(w.x, w.y)));
  diffuseColor.rgb = vec3(0.32, 0.34, 0.36);
  fRough = 0.15; fMetal = 0.6;
  fGlow = vColor.rgb * pane * (1.0 + vLook.w) * (0.2 + 0.9 * exp(-3.0 * clamp((vFuv.y - vLook.y) / max(vLook.z, 1.0), 0.0, 1.0))) * fNight;
} else if (fKind == 8) {
  // a sign: its glyphs in a stack or a row, neon tubes on a dark board (a white core, a halo on the board), or dark on a lit box. A few
  // stutter, a few glyphs are dead. By day they are paint. Far off, their average. vLook: its size, its foot, lit or not (under 0: its case)
  diffuseColor.rgb = vec3(0.022, 0.024, 0.027);
  fRough = 0.45;
  if (vLook.w > -0.5) {
    vec2 sz = vLook.xy, p = vec2(vFuv.x, vFuv.y - vLook.z), pw = fwidth(p);
    float seed = vAux.x, cell = min(sz.x, sz.y), box = vLook.w;
    vec2 cnt = floor(sz / cell + 0.001), q = (p - (sz - cnt * cell) * 0.5) / cell, gid = clamp(floor(q), vec2(0.0), cnt - 1.0), c = (q - gid - 0.15) / 0.7;
    float px = max(pw.x, pw.y) / (cell * 0.7), far = smoothstep(0.12, 0.45, px), d = fGlyph(c, fHash(gid + seed * 1.31));
    float dead = step(0.94, fHash(gid * 3.7 + seed)), stutter = 1.0 - step(fHash(vec2(seed, 31.7)), 0.16) * 0.65 * step(0.7, fHash(vec2(floor(fTime * 9.0), seed)));
    float th = mix(0.05, 0.085, box), tube = mix(smoothstep(th + px, th - px, d), 0.3, far), halo = mix(exp(-d * d * 30.0), 0.55, far) * (1.0 - tube);
    float edge = min(min(p.x, sz.x - p.x), min(p.y, sz.y - p.y)), rim = smoothstep(0.05 - pw.x, 0.05 + pw.x, edge);
    vec3 col = vColor.rgb, neon = (col * 1.75 + vec3(0.22)) * tube * (1.0 - dead) + col * 0.3 * halo * (1.0 - dead);
    vec3 boxed = col * 0.72 * (1.0 - tube) * (0.72 + 0.28 * smoothstep(0.0, cell * 0.5, edge));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, col * 0.5, tube * (1.0 - dead)), mix(col * 0.62 + 0.1, vec3(0.03), tube), box) * mix(0.3, 1.0, rim);
    fGlow = mix(neon, boxed, box) * rim * stutter * fNight;
    fRough = mix(0.5, 0.3, box);
  }
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + fTilt);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fGlow;')
      // the sky's light, a little less blue than the sky: the clouds and the city's own walls send some of it
      .replace('#include <aomap_fragment>', 'reflectedLight.directDiffuse *= fVis;\nreflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.3, 0.55, 0.15))), 0.45) * fAo;\nreflectedLight.indirectSpecular *= fAo * fSpec;\n#include <aomap_fragment>');
  };
  mat.customProgramCacheKey = () => 'outside-facade';
  return { mat, u };
}
