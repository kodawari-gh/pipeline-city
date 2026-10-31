import type { Graphics } from 'pixi.js';
import type { Theme } from './theme';

// One look and one physics for every cable in the game (PSU leads, drive cables, fan cords, wall cords, the ISP lead, the ethernet and
// video cables). A cable is a sleeve with a shadow, a faint tint of its accent and a lit streak. A cable that is not routed along the
// board hangs from its fixed end the way a real one does: a stiff stub, then a catenary of fixed length (`hangCable`). A plug that is let
// go falls, swings on its tether and settles (`stepFall`). Nothing here is random. docs/render/board.md "Cable look and physics".

export type Pt = [number, number];

/** The sleeve colour. Over the wall (dark theme) it is paler, with a halo, so it stays readable on the dark slats. */
export const sleeveOf = (T: Theme, wall = false) => (wall && T.dark ? '#2a3554' : T.dark ? '#171d29' : '#2a313d');
const HALO = '#8fa3d6';

export interface CableLook {
  /** Sleeve width in world units. */
  w: number;
  /** The accent of the cable's family (power: yellow, drive: muted, ...): a faint tint over the sleeve. */
  accent: string;
  /** The cable runs over the wall (outside the case): a pale halo in the dark theme. */
  wall?: boolean;
  /** Short diagonal braid ticks across the sleeve (the fat PSU leads). */
  braid?: boolean;
  /** Draw the shadow (default true); a cable that lies on top of its own shadow layer turns it off. */
  shadow?: boolean;
}

const trace = (g: Graphics, pts: readonly Pt[], dx = 0, dy = 0) => {
  g.moveTo(pts[0]![0] + dx, pts[0]![1] + dy);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0] + dx, pts[i]![1] + dy);
};

/** A parallel copy of a dense polyline at distance d (left of travel), for the lit streak. */
function shifted(pts: readonly Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d] as Pt;
  });
}

/** Paint a cable's body along a dense centre line: shadow, halo, sleeve, accent tint, braid, lit streak and shade streak. */
export function paintCable(g: Graphics, T: Theme, pts: readonly Pt[], look: CableLook) {
  if (pts.length < 2) return;
  const { w, accent } = look, wall = !!look.wall;
  if (look.shadow !== false) { trace(g, pts, w * 0.14, w * 0.2); g.stroke({ width: w + Math.max(4, w * 0.08), color: '#000000', alpha: 0.28, cap: 'round', join: 'round' }); }
  if (wall && T.dark) {
    trace(g, pts); g.stroke({ width: w * 2, color: HALO, alpha: 0.1, cap: 'round', join: 'round' });
    trace(g, pts); g.stroke({ width: w * 1.4, color: HALO, alpha: 0.2, cap: 'round', join: 'round' });
  }
  trace(g, pts); g.stroke({ width: w, color: sleeveOf(T, wall), cap: 'round', join: 'round' });
  trace(g, pts); g.stroke({ width: w, color: accent, alpha: 0.14, cap: 'round', join: 'round' });
  if (look.braid) {
    for (let i = 2; i < pts.length - 2; i += 2) {
      const a = pts[i - 1]!, b = pts[i + 1]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, tx = dx / l, ty = dy / l, h = w * 0.46;
      g.moveTo(pts[i]![0] + nx * h - tx * w * 0.16, pts[i]![1] + ny * h - ty * w * 0.16).lineTo(pts[i]![0] - nx * h + tx * w * 0.16, pts[i]![1] - ny * h + ty * w * 0.16);
    }
    g.stroke({ width: Math.max(3, w * 0.05), color: '#ffffff', alpha: T.dark ? 0.1 : 0.14 });
  }
  if (w >= 20) {
    trace(g, shifted(pts, -w * 0.24)); g.stroke({ width: Math.max(3, w * 0.12), color: '#ffffff', alpha: T.dark ? 0.12 : 0.16, cap: 'round', join: 'round' });
    if (w >= 40) { trace(g, shifted(pts, w * 0.3)); g.stroke({ width: w * 0.1, color: '#000000', alpha: 0.22, cap: 'round', join: 'round' }); }
  }
}

/** The length of a polyline. */
export const pathLen = (pts: readonly Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

// ---------------------------------------------------------------- hanging

/** Chaikin corner cutting that keeps both ends (smooths the join of the stub and the catenary). */
function smooth(pts: Pt[], rounds: number): Pt[] {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    const out: Pt[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!, b = cur[i + 1]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(cur[cur.length - 1]!);
    cur = out;
  }
  return cur;
}

/**
 * A hanging cable of length `len` between two points, sagging under gravity (screen down): sampled `n` + 1 points. It is a catenary:
 * the curve a rope takes. A rope no longer than the chord is a straight line. Two points one above the other make the rope hang as a loop
 * to the side, which is what a real cable does there.
 */
export function catenary(a: Pt, b: Pt, len: number, n = 28): Pt[] {
  const sign = b[0] >= a[0] ? 1 : -1, dx = Math.abs(b[0] - a[0]), dyu = a[1] - b[1]; // dyu: how far the far end is above the near end
  const chord = Math.hypot(dx, dyu);
  const line = (): Pt[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);
  if (len <= chord * 1.002) return line();
  if (dx < 6) {
    // a loop to the side, as wide as the slack needs
    const dy = b[1] - a[1], bulge = 0.5 * Math.sqrt(Math.max(0, len * len - dy * dy));
    return Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [a[0] + (b[0] - a[0]) * t + Math.sin(Math.PI * t) * bulge * (sign || 1), a[1] + dy * t] as Pt; });
  }
  const need = Math.sqrt(Math.max(0, len * len - dyu * dyu));
  // solve 2 k sinh(dx / 2k) = need for the sag parameter k: the left side falls from infinity (slack) to dx (taut) as k grows
  let lo = dx / 1400, hi = 1e7;
  for (let i = 0; i < 90; i++) { const k = Math.sqrt(lo * hi); if (2 * k * Math.sinh(dx / (2 * k)) > need) lo = k; else hi = k; }
  const k = Math.sqrt(lo * hi), xm = (dx - k * Math.log((len + dyu) / Math.max(1e-6, len - dyu))) / 2;
  const h = (x: number) => k * Math.cosh((x - xm) / k), h0 = h(0);
  return Array.from({ length: n + 1 }, (_, i) => { const x = (dx * i) / n; return [a[0] + sign * x, a[1] - (h(x) - h0)] as Pt; });
}

export interface HangOpts {
  /** Cable length from the fixed end to the plug tip; default a little more than the distance (a loose, relaxed cable). */
  len?: number;
  /** How far the cable runs straight out of the fixed end before it bends (the stiffness of the sleeve). */
  stub?: number;
  /** Samples. */
  n?: number;
  /** A surface the cable lies on (screen y; the cable cannot go below it): the roof of the PSU, the desk. */
  floor?: number;
}

/**
 * A cable hanging from its fixed end `anchor` (leaving it along `dir`) to its plug at `tip`: a short stiff stub, then a catenary. If the
 * cable is shorter than the distance it is pulled taut (a straight line). Use it for every cable that is not routed along the board:
 * the one in the hand, the plugs that lie loose, the PSU leads that hang from their sockets.
 */
export function hangCable(anchor: Pt, dir: Pt, tip: Pt, o: HangOpts = {}): Pt[] {
  const d = Math.hypot(tip[0] - anchor[0], tip[1] - anchor[1]);
  const len = o.len ?? Math.max(d * 1.12, d + 90);
  const stub = Math.min(o.stub ?? 90, len * 0.3, d * 0.6 + 1);
  const s1: Pt = [anchor[0] + dir[0] * stub, anchor[1] + dir[1] * stub];
  const body = catenary(s1, tip, Math.max(0, len - stub), o.n ?? 28);
  const out = smooth([anchor, ...body], 2);
  return o.floor === undefined ? out : out.map(([x, y]) => [x, Math.min(y, o.floor!)] as Pt);
}

// ---------------------------------------------------------------- falling

export interface Fall {
  /** The plug's centre, and its speed (world units per second). */
  p: Pt; v: Pt;
  /** Turn of the plug (radians) and its spin. */
  rot: number; spin: number;
  /** The plug has come to rest. */
  done: boolean;
}

/** A plug let go at `p`. It keeps the speed the pointer had (`v`). */
export const startFall = (p: Pt, v: Pt = [0, 0]): Fall => ({ p: [p[0], p[1]], v: [v[0], v[1]], rot: 0, spin: v[0] * 0.0006, done: false });

const GRAVITY = 9000, BOUNCE = 0.32, DRAG = 0.8;

/**
 * Advance a falling plug by `dt` seconds. It falls under gravity on the cable's tether (`anchor`, `len`: the cable pulls it back when it
 * goes taut, and the swing follows), lands on the floor level `floorY` (`rest[1]`), bounces a little, slides toward `rest` and stops there.
 */
export function stepFall(f: Fall, dt: number, anchor: Pt, len: number, rest: Pt, floorY = rest[1]): Fall {
  if (f.done) return f;
  const h = Math.min(dt, 1 / 30);
  f.v[1] += GRAVITY * h;
  f.v[0] *= Math.exp(-DRAG * h); f.v[1] *= Math.exp(-DRAG * 0.3 * h);
  f.p[0] += f.v[0] * h; f.p[1] += f.v[1] * h;
  f.rot += f.spin * h; f.spin *= Math.exp(-3 * h);
  // the tether: past the cable's length the plug is held on a circle round the anchor and loses its outward speed
  const dx = f.p[0] - anchor[0], dy = f.p[1] - anchor[1], d = Math.hypot(dx, dy);
  if (d > len && d > 0) {
    const nx = dx / d, ny = dy / d, vn = f.v[0] * nx + f.v[1] * ny;
    f.p[0] = anchor[0] + nx * len; f.p[1] = anchor[1] + ny * len;
    if (vn > 0) { f.v[0] -= nx * vn * 1.3; f.v[1] -= ny * vn * 1.3; }
  }
  if (f.p[1] >= floorY) {
    f.p[1] = floorY;
    if (f.v[1] > 260) f.v[1] = -f.v[1] * BOUNCE; else f.v[1] = 0;
    f.v[0] += (rest[0] - f.p[0]) * 14 * h; f.v[0] *= Math.exp(-9 * h); // slides to where it lies
    f.spin += (0.3 - f.rot) * 30 * h;
  }
  if (f.p[1] >= floorY - 0.5 && Math.abs(f.v[1]) < 1 && Math.abs(f.v[0]) < 4 && Math.abs(rest[0] - f.p[0]) < 6) { f.p = [rest[0], rest[1]]; f.v = [0, 0]; f.rot = 0.3; f.spin = 0; f.done = true; }
  return f;
}

// ---------------------------------------------------------------- management (visual only)

/** A cable tie or a velcro strap round a cable at a point, square to it: a short dark band with a lit edge. */
export function paintTie(g: Graphics, T: Theme, at: Pt, dir: Pt, w: number, accent: string) {
  const l = Math.hypot(dir[0], dir[1]) || 1, tx = dir[0] / l, ty = dir[1] / l, nx = -ty, ny = tx, h = w * 0.62, t = Math.max(8, w * 0.2);
  const quad = (o: number, th: number) => {
    const cx = at[0] + tx * o, cy = at[1] + ty * o;
    g.poly([cx + nx * h - tx * th, cy + ny * h - ty * th, cx + nx * h + tx * th, cy + ny * h + ty * th, cx - nx * h + tx * th, cy - ny * h + ty * th, cx - nx * h - tx * th, cy - ny * h - ty * th]);
  };
  quad(0, t); g.fill({ color: T.dark ? '#0b0f18' : '#1b2230' });
  quad(0, t); g.stroke({ width: 3, color: accent, alpha: 0.7 });
  quad(-t * 0.2, t * 0.28); g.fill({ color: '#ffffff', alpha: T.dark ? 0.16 : 0.22 });
}

/** Ties along a dense path: one at every sharp bend (where the cable would spring away) and one every `every` units on a long run. */
export function tiePoints(pts: readonly Pt[], every = 1500, margin = 260): { at: Pt; dir: Pt }[] {
  const out: { at: Pt; dir: Pt }[] = [];
  const total = pathLen(pts);
  let s = 0, next = margin;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= s + d && next < total - margin) {
      const f = d ? (next - s) / d : 0;
      out.push({ at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir: [b[0] - a[0], b[1] - a[1]] });
      next += every;
    }
    s += d;
  }
  return out;
}
