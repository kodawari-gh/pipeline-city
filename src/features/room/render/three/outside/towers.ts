// The city's buildings (`plan.ts` places them) in one mesh on one material. A building is its tiers' walls, each wall's facade painted by the
// shader (`facadeMaterial`): its windows in bays and storeys on slim mullions, the glass over a room seen in depth (interior mapping) with its
// blind or curtains, mirroring the sky and the street's far side, the walls in panels and tiles with their joints, slab edges and stains, rooms
// lit at night (an office in zones along a floor, a home room by room); far away each pattern fades to its average where its scale is under a
// pixel, so it does not shimmer. The sky's light falls off down a wall toward the street. A flat block near the window has its balconies. On
// the roofs: a parapet, a membrane, gravel, sedum or pavers, a stair and lift bulkhead with its door, plant boxes, water tanks, solar panels,
// skylights, vents, air-conditioning units; the towers' masts, spires, lit lanterns and plant screens, their LED bands, the red beacons
// blinking at night.
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, MeshStandardMaterial, Vector3 } from 'three';
import { GRID, STYLES, rng, topOf, type Building, type Rect, type Tier } from './plan';

/** What a vertex is: an office's facade, a roof, a plain surface, a beacon, a lit crown, a band of LEDs, a home's facade (lit room by room), a solar panel. */
const enum Kind { Facade = 0, Roof = 1, Plain = 2, Beacon = 3, Crown = 4, Led = 5, Home = 6, Solar = 7 }

/** The towers' LED bands: cyan, warm white, amber (the room's accent families), and how often each is picked. */
const LEDS = [0x4fd6ff, 0x4fd6ff, 0xffd8a6, 0xffd8a6, 0xffa64a] as const;

/** A parapet's height over its roof (m), how far from the window a roof gets its plant and tanks, and its smallest things. */
const PARAPET = 1.1, CLUTTER = 900, FINE = 420;

/** A water tank and its lid, a vent pipe and its cap, centred on their own middles. */
const TANK = new CylinderGeometry(1.25, 1.25, 2.4, 16), TANK_LID = new ConeGeometry(1.3, 0.4, 16), VENT = new CylinderGeometry(0.14, 0.14, 0.8, 8), VENT_CAP = new CylinderGeometry(0.24, 0.24, 0.1, 8);

type V3 = readonly [number, number, number];

/** The buildings' geometry: each vertex's place, normal, facade uv (m), frame colour, facade look (bay, storey, window share across and up), glass tint, and (seed, kind, reflection). */
class Mass {
  pos: number[] = []; nor: number[] = []; fuv: number[] = []; col: number[] = []; look: number[] = []; tint: number[] = []; aux: number[] = [];
  private c = new Color(); private t = new Color();
  /** The look the next vertices take: its bay is stretched per wall (`box`'s `fit`). */
  lk: [number, number, number, number] = [1, 1, 0, 0];
  private ax: [number, number, number] = [0, Kind.Plain, 0];

  /** What the next vertices are: their frame colour, tint, look, seed, kind and reflection. */
  set(frame: number | Color, tint: number, kind: Kind, seed = 0, look: [number, number, number, number] = [1, 1, 0, 0], refl = 0): this {
    if (typeof frame === 'number') this.c.setHex(frame); else this.c.copy(frame);
    this.t.setHex(tint);
    this.lk = look;
    this.ax = [seed, kind, refl];
    return this;
  }

  private vert(p: V3, n: V3, u: number, v: number): void {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.fuv.push(u, v);
    this.col.push(this.c.r, this.c.g, this.c.b); this.tint.push(this.t.r, this.t.g, this.t.b);
    this.look.push(...this.lk); this.aux.push(...this.ax);
  }

  /** A quad a, b, c, d (counter-clockwise seen from its front) and its uvs, as two triangles. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]): void {
    this.vert(a, n, ...ua); this.vert(b, n, ...ub); this.vert(c, n, ...uc);
    this.vert(a, n, ...ua); this.vert(c, n, ...uc); this.vert(d, n, ...ud);
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

  /** Any geometry (a cylinder, a cone) at (x, y, z), every vertex as `set` gave. */
  shape(g: BufferGeometry, x: number, y: number, z: number): void {
    const s = g.index ? g.toNonIndexed() : g, p = s.attributes.position!, n = s.attributes.normal!;
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z], [n.getX(i), n.getY(i), n.getZ(i)], 0, 0);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('fuv', new Float32BufferAttribute(this.fuv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('look', new Float32BufferAttribute(this.look, 4));
    g.setAttribute('tint', new Float32BufferAttribute(this.tint, 3));
    g.setAttribute('aux', new Float32BufferAttribute(this.aux, 3));
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

/**
 * What stands on a roof, the largest first, each where the others leave room: a bulkhead with its door and a paved way to it, solar panels, plant
 * boxes, a water tank on its stand, a row of air-conditioning units on their rail, skylights, vent pipes. `fine`: near enough for the small things.
 */
function clutter(m: Mass, r: Rect, y: number, b: Building, rand: () => number, fine: boolean): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w < 10 || d < 10) return;
  const used: Rect[] = [];
  /** A free place on the roof for pw by pd, away from the parapet and what stands there already. */
  const place = (pw: number, pd: number): Rect | null => {
    if (pw > w - 2.4 || pd > d - 2.4) return null;
    for (let i = 0; i < 8; i++) {
      const q = sized(r.x0 + 1.2 + pw / 2 + rand() * (w - 2.4 - pw), r.z0 + 1.2 + pd / 2 + rand() * (d - 2.4 - pd), pw, pd);
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
      m.set(0x24272a, 0, Kind.Plain).box({ x0: cx - 0.55, x1: cx + 0.55, z0: head.z1, z1: head.z1 + 0.05 }, y, y + 2.15, true);
      m.set(0xa39f96, 0, Kind.Plain).box(rand() < 0.5 ? { x0: r.x0 + 0.3, x1: head.x0, z0: cz - 0.5, z1: cz + 0.5 } : { x0: cx - 0.5, x1: cx + 0.5, z0: head.z1, z1: r.z1 - 0.3 }, y, y + 0.07, true);
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
    if (q) m.set(0x8d9196, 0, Kind.Plain).box(q, y, y + 1.2 + rand() * 0.8, true);
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
  const t = b.tiers[b.tiers.length - 1]!, h = topOf(b), cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, w = Math.min(t.x1 - t.x0, t.z1 - t.z0);
  let tip = h + PARAPET;
  if (b.crown === 'mast') {
    const mh = 25 + h * 0.12;
    m.set(0x9da2a8, 0, Kind.Plain).box(sized(cx, cz, 3, 3), h, h + 6, true);
    m.box(sized(cx, cz, 1.1, 1.1), h + 6, h + mh, true);
    tip = h + mh;
  } else if (b.crown === 'spire') {
    const sh = h * 0.22;
    m.set(new Color(b.frame).lerp(new Color(0xc8ccd0), 0.5), 0, Kind.Plain).shape(new ConeGeometry(w * 0.34, sh, 4).rotateY(Math.PI / 4), cx, h + sh / 2, cz);
    m.box(sized(cx, cz, 0.6, 0.6), h + sh * 0.95, h + sh + 14, false);
    tip = h + sh + 14;
  } else if (b.crown === 'lantern') {
    // a glass lantern over the roof, its ribs in the frame's colour; lit warm at night
    const lh = 10 + rand() * 6, r = inset(t, 2.5);
    m.set(0xffc98f, 0, Kind.Crown, b.seed, [2.4, h, lh, 0]).box(r, h, h + lh, true);
    m.set(b.frame, 0, Kind.Plain).box(inset(r, -0.3), h + lh, h + lh + 1.2, true);
    tip = h + lh + 1.2;
  } else if (b.style !== 'tile' && h > 70 && rand() < 0.55) {
    const sh = 4 + rand() * 4;
    screen(m, t, sh, b);
    tip = h + sh;
  }
  if (h < 110) return;
  m.set(0x400808, 0, Kind.Beacon, rand()).box(sized(cx, cz, 1.2, 1.2), tip, tip + 1.2, true);
  for (const [x, z] of [[t.x0 + 1, t.z0 + 1], [t.x1 - 1, t.z1 - 1], [t.x0 + 1, t.z1 - 1], [t.x1 - 1, t.z0 + 1]] as const) m.set(0x400808, 0, Kind.Beacon, rand()).box(sized(x, z, 0.8, 0.8), h + PARAPET, h + PARAPET + 0.8, true);
}

/** A modern tower's LEDs: a band round the top of each tier under its parapet; on a few, a strip up each corner of the shaft. */
function leds(m: Mass, b: Building): void {
  const r = rng(b.seed ^ 0x5bd1);
  if (b.style === 'tile' || topOf(b) < 60 || r() > 0.55) return;
  m.set(LEDS[Math.floor(r() * LEDS.length)]!, 0, Kind.Led, b.seed % 991);
  for (const t of b.tiers) m.box(inset(t, -0.06), t.y1 - 0.9, t.y1 - 0.35, false);
  const s = b.tiers[1];
  if (!s || r() > 0.3) return;
  for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]] as const) m.box(sized(x, z, 0.36, 0.36), s.y0, b.tiers[b.tiers.length - 1]!.y1 - 0.9, false);
}

/** Every building in one geometry. */
export function massGeometry(bs: readonly Building[]): BufferGeometry {
  const m = new Mass();
  for (const b of bs) {
    const s = STYLES[b.style], rand = rng(b.seed), away = Math.hypot(((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2 - GRID.av0), b.tiers[0]!.z1), near = away < CLUTTER;
    b.tiers.forEach((t, i) => {
      // the walls: each wall's bays stretched to fit it whole
      const home = b.style === 'tile' || (b.style === 'band' && topOf(b) < 60);
      m.set(b.frame, b.tint, home ? Kind.Home : Kind.Facade, (b.seed % 997) + i * 0.37, [s.bay, s.storey, s.win[0], s.win[1]], s.refl);
      m.box(t, t.y0, t.y1, false, false, (len) => { m.lk[0] = len / Math.max(1, Math.round(len / s.bay)); });
      // the parapet round the roof, the gravel inside it
      const frame = new Color(b.frame).multiplyScalar(b.style === 'glass' ? 1 : 0.92);
      m.set(frame, 0, Kind.Plain).box(t, t.y1, t.y1 + PARAPET, false);
      m.box(inset(t, 0.3), t.y1, t.y1 + PARAPET, false, true);
      m.set(frame.clone().multiplyScalar(1.15), 0, Kind.Plain).ring(t, 0.3, t.y1 + PARAPET);
      const floor = inset(t, 0.3);
      m.set(0x8a8780, 0, Kind.Roof, b.seed % 991, [floor.x0, floor.x1, floor.z0, floor.z1]).top(floor, t.y1);
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
  }
  return m.geometry();
}

/** The facade's light by the hour: the lit rooms' share of their full glow at night, the clock for the beacons, the sun (direction, colour) and the horizon's colour, for what the glass mirrors and the shadows on a wall. */
export interface FacadeUniforms { night: { value: number }; time: { value: number }; sun: { value: Vector3 }; sunCol: { value: Color }; hor: { value: Color } }

/** The buildings' material: a standard one whose colour, roughness, metalness and glow the facade's shader paints. */
export function facadeMaterial(): { mat: MeshStandardMaterial; u: FacadeUniforms } {
  const u: FacadeUniforms = { night: { value: 0 }, time: { value: 0 }, sun: { value: new Vector3(0, 1, 0) }, sunCol: { value: new Color(0, 0, 0) }, hor: { value: new Color(0, 0, 0) } };
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.fNight = u.night;
    sh.uniforms.fTime = u.time;
    sh.uniforms.fSun = u.sun;
    sh.uniforms.fSunCol = u.sunCol;
    sh.uniforms.fHor = u.hor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fuv;\nattribute vec4 look;\nattribute vec3 tint;\nattribute vec3 aux;\nvarying vec2 vFuv;\nflat varying vec4 vLook;\nvarying vec3 vTint;\nflat varying vec3 vAux;\nvarying vec3 vFW;\nvarying vec3 vFN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFuv = fuv; vLook = look; vTint = tint; vAux = aux;\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float fNight, fTime;
uniform vec3 fSun, fSunCol, fHor;
varying vec2 vFuv;
// flat: a wall's seed interpolated comes out a hair different from pixel to pixel, and any hash of it a different number, in specks
flat varying vec4 vLook;
varying vec3 vTint;
flat varying vec3 vAux;
varying vec3 vFW;
varying vec3 vFN;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** A band from a to b across x, its edges softened by the pixel's width w. */
float fBand(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }`)
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
  // the window; the ground floor's shop windows are taller and wider, and more of them lit
  float shop = 1.0 - step(0.5, id.y);
  vec2 win = mix(vLook.zw, vec2(0.92, 0.8), shop);
  vec2 lo = vec2(0.5 - 0.5 * win.x, (1.0 - win.y) * 0.6), hi = lo + win;
  vec2 e = mix(smoothstep(lo - fw, lo + fw, f) - smoothstep(hi - fw, hi + fw, f), win, vec2(cx, cy));
  float m = e.x * e.y;
  vec2 o = clamp((f - lo) / win, 0.0, 1.0), ow = fw / win;
  // a wide window's lites on slim dark mullions, a metre or so apart
  float wm = win.x * vLook.x, lite = wm / max(1.0, floor(wm / 1.2 + 0.5)), mpx = fw.x * vLook.x;
  float mull = smoothstep(0.035 + mpx, 0.035 - mpx, (0.5 - abs(fract(o.x * wm / lite) - 0.5)) * lite);
  mull = mix(mull, 0.07 / lite, smoothstep(0.1, 0.35, mpx / lite)) * m;
  m -= mull;
  // who is in. Each building has its share of lit rooms: an office is lit in zones of a few bays along a floor (its floors from empty to
  // full), most bays of a lit zone on; a home room by room, a room one or two bays
  float share = 0.08 + 0.4 * fHash(vec2(seed * 0.731, 5.3));
  float zw = home > 0.5 ? 1.0 + step(0.55, fHash(vec2(seed, 8.7))) : 2.0 + floor(5.0 * fHash(vec2(seed, 8.1)));
  float zone = floor(id.x / zw), cz = smoothstep(0.08, 0.25, fw.x / zw), cr = max(cz, cy);
  float rf = fHash(vec2(id.y * 0.37 + seed, 2.9)), hz = fHash(vec2(zone * 1.91 + seed, id.y * 0.83 + 4.7));
  float occ = home > 0.5 ? share : min(1.0, share * 2.6 * rf * rf);
  float lit = mix(mix(step(hz, occ), occ, cz), share * mix(0.86, 1.0, home), cy);
  lit *= mix(mix(step(h3, 0.9), 0.9, cx), 1.0, home);
  lit = mix(lit, mix(step(h3, 0.8), 0.8, cx), shop);
  // the light: an office's cool white, many warmer, a few a fluorescent green; a home's warm lamp, some paler, a few a screen's blue. A
  // curtain wall's glass tints it
  float hc = fHash(vec2(zone + seed * 3.1, id.y + 9.2)), kz = mix(0.75 + 0.4 * fHash(vec2(hc, 3.7)), 1.0, cr);
  vec3 cool = hc < 0.55 ? vec3(0.62, 0.85, 1.0) : hc < 0.92 ? vec3(1.0, 0.8, 0.55) : vec3(0.6, 1.0, 0.8);
  vec3 warm = hc < 0.6 ? vec3(1.0, 0.6, 0.3) : hc < 0.9 ? vec3(1.0, 0.74, 0.48) : vec3(0.42, 0.56, 1.0);
  vec3 lamp = mix(mix(cool, warm, home), mix(vec3(0.76, 0.84, 0.82), vec3(0.94, 0.64, 0.42), home), cr);
  lamp = mix(lamp, vec3(1.0, 0.82, 0.62), shop) * mix(vec3(1.0), vTint / max(max(vTint.r, vTint.g), max(vTint.b, 1e-3)), refl * 0.5);
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
  fRough = mix(0.8, 0.05 + 0.12 * mix(h, 0.5, max(cf, fNight)) * refl + 0.12 * (1.0 - refl), m);
  fMetal = mix(0.0, refl * 0.9, m);
  // by day a curtain wall's panes each a little out of true, so the sky they mirror breaks up pane by pane; at night they lie flat, or the
  // street lamps' glints would scatter over them in specks
  fTilt = (vec3(h, h2, h3) - 0.5) * 0.09 * m * refl * (1.0 - cf) * (1.0 - fNight);
  // the night: the lit rooms' light through their glass (a mirror glass lets less through), the frame round a lit window catching a
  // little of it, the street lamps' warm light washing the lowest floors' walls
  fGlow = lamp * kz * lit * through * m * (1.0 - 0.5 * refl) * (fNight * 2.6 + 0.02);
  fGlow += fr * lamp * lit * 0.06 * fNight * (1.0 - m);
  fGlow += fr * vec3(1.0, 0.72, 0.45) * 0.45 * exp(-vFuv.y / 6.0) * fNight * (1.0 - m);
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
  vec3 mirrorK = mix(mix(vec3(0.1 + 0.09 * h), vTint, refl * 0.9), vec3(1.0), pow(1.0 - clamp(-dot(fV, vFN), 0.0, 1.0), 5.0));
  fGlow += mirrorK * hit * mix(across, fHor * 0.09, road) * m;
  fSpec = 1.0 - hit * m;
} else if (fKind == 5) {
  // a lit band of LEDs: a thin line by day, a bright one at night
  diffuseColor.rgb = vec3(0.04);
  fRough = 0.3;
  fGlow = vColor.rgb * (0.12 + fNight * 2.1);
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
    vec2 s = rr < 0.5 ? g : g.yx;
    float q = s.x / 2.0, l = fract(q), lap = mix(smoothstep(0.08 + px * 0.5, 0.0, min(l, 1.0 - l) * 2.0), 0.05, 1.0 - sheetF);
    c = mix(vec3(0.27, 0.285, 0.29), vec3(0.42, 0.42, 0.405), rr) * (0.96 + 0.12 * mix(fHash(vec2(floor(q), seed)), 0.5, 1.0 - sheetF)) * (1.0 - 0.42 * lap);
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
  fGlow = vec3(1.0, 0.06, 0.03) * 9.0 * step(0.55, fract(fTime * 0.45 + vAux.x)) * fNight;
} else if (fKind == 4) {
  // a lit lantern: panes on slim ribs, brightest at the foot where its lamps stand, fading up
  vec2 g = vec2(vFuv.x / vLook.x, (vFuv.y - vLook.y) / 3.0), w = fwidth(g), d = abs(fract(g) - 0.5);
  float pane = mix(smoothstep(0.42 + w.x, 0.42 - w.x, d.x) * smoothstep(0.46 + w.y, 0.46 - w.y, d.y), 0.75, smoothstep(0.15, 0.4, max(w.x, w.y)));
  diffuseColor.rgb = vec3(0.32, 0.34, 0.36);
  fRough = 0.15; fMetal = 0.6;
  fGlow = vColor.rgb * pane * (0.2 + 0.9 * exp(-3.0 * clamp((vFuv.y - vLook.y) / max(vLook.z, 1.0), 0.0, 1.0))) * fNight;
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
