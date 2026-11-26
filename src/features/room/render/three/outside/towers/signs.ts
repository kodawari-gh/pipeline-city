// A building's signs of abstract glyphs (no real words), neon or lit boxes: a board's geometry, and where a building hangs its few.
import { GRID, rng, STYLES, topOf } from '../plan';
import { footOf, Kind, sized } from './basics';
import type { Mass } from './mass';
import { PARAPET } from './roof';
import type { Building, Look, Rect, Tier } from './types';

/** The signs' colours: cyan, amber, terracotta red (the room's accents) and a rare magenta, and how far from the window a low block has any, a tower. */
const SIGNS = [0x4f_d6_ff, 0x4f_d6_ff, 0xff_b1_5a, 0xff_b1_5a, 0xa6_8b_ff, 0xa6_8b_ff, 0xff_55_dc] as const,
  SIGN_FAR = 1500,
  SIGN_TOWER = 3400;

/**
 * A sign's board: its rect and heights, colour and seed. `lit`: a lit box with dark glyphs, not neon on a dark board. `both`: its glyphs on its
 * north face too. `on`: the wall it hangs from, which takes its light.
 */
interface Sign {
  rect: Rect;
  y: readonly [number, number];
  colour: number;
  seed: number;
  lit: boolean;
  both?: boolean;
  on?: { fixed: 'x' | 'z'; at: number; out: number };
}

/** A building's signs being hung: its foot tier, its own stream, how many it has (`share`), the shop fronts' top, and its draws. */
interface Signing {
  m: Mass;
  b: Building;
  t: Tier;
  r: () => number;
  share: number;
  y0: number;
  colour: () => number;
  seed: () => number;
  tall: (w: number) => number;
}

/** Whether v is on the grid of this pitch. */
const onGrid = (v: number, pitch: number): boolean => Math.abs(v / pitch - Math.round(v / pitch)) < 1e-6;

/** A sign's board, its glyphs on its south face (and its north one if `both`), its other faces a dark case. */
function board(m: Mass, { rect: r, y: [y0, y1], colour, seed, lit, both = false, on }: Sign): void {
  const look: Look = [r.x1 - r.x0, y1 - y0, y0, lit ? 1 : 0];
  let wall = 0;
  if (on) {
    const xs = on.fixed === 'z';
    m.washes.push({
      ...on,
      mid: xs ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2,
      half: xs ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2,
      y0,
      y1,
      colour,
      seed,
      box: lit,
    });
  }
  m.set(colour, Kind.Sign, { seed });
  m.box(r, [y0, y1], {
    top: true,
    fit: () => {
      m.lk = wall === 0 || (both && wall === 2) ? look : [1, 1, 0, -1];
      wall++;
    },
  });
}

/** A tower's tall board high on its shaft. */
function towerSign({ m, b, r, colour, seed }: Signing): void {
  const s = b.tiers[1] ?? footOf(b),
    w = 3.5 + r() * 3,
    h = Math.min((s.y1 - s.y0) * 0.7, w * (4 + Math.floor(r() * 6))),
    x = s.x0 + w + r() * (s.x1 - s.x0 - 2 * w),
    y1 = s.y1 - 2 - r() * (s.y1 - s.y0 - h - 2);
  board(m, {
    rect: { x0: x - w / 2, x1: x + w / 2, z0: s.z1 + 0.1, z1: s.z1 + 0.5 },
    y: [y1 - h, y1],
    colour: colour(),
    seed: seed(),
    lit: r() < 0.3,
    on: { fixed: 'z', at: s.z1, out: 1 },
  });
}

/** A tall sign out from a wall over an avenue, on its brackets. */
function avenueSigns({ m, t, r, share, y0, colour, seed, tall }: Signing): void {
  for (const [on, x, out] of [
    [onGrid(t.x1 - GRID.av0 + GRID.avenue / 2, GRID.px), t.x1, 1],
    [onGrid(t.x0 - GRID.av0 - GRID.avenue / 2, GRID.px), t.x0, -1],
  ] as const) {
    if (!on || r() > 0.5 * share) {
      continue;
    }
    const w = 1.9 + r(),
      h = tall(w),
      z = t.z0 + 2 + r() * (t.z1 - t.z0 - 4),
      near = x + out * 0.2,
      far = near + out * w;
    if (h < w * 2) {
      continue;
    }
    board(m, {
      rect: { x0: Math.min(near, far), x1: Math.max(near, far), z0: z - 0.14, z1: z + 0.14 },
      y: [y0, y0 + h],
      colour: colour(),
      seed: seed(),
      lit: r() < 0.25,
      both: true,
      on: { fixed: 'x', at: x, out },
    });
    m.set(0x26_28_2b, Kind.Plain);
    for (const y of [y0 + 0.4, y0 + h - 0.6]) {
      m.box({ x0: Math.min(x, near), x1: Math.max(x, near), z0: z - 0.05, z1: z + 0.05 }, [y, y + 0.14], { top: true });
    }
  }
}

/** A sign flat on a south wall over a street. */
function wallSign({ m, t, r, y0, colour, seed, tall }: Signing): void {
  const w = 1.9 + r(),
    h = tall(w),
    x = t.x0 + w + r() * (t.x1 - t.x0 - 2 * w);
  if (h < w * 2) {
    return;
  }
  board(m, {
    rect: { x0: x - w / 2, x1: x + w / 2, z0: t.z1 + 0.06, z1: t.z1 + 0.34 },
    y: [y0, y0 + h],
    colour: colour(),
    seed: seed(),
    lit: r() < 0.25,
    on: { fixed: 'z', at: t.z1, out: 1 },
  });
}

/** A board on legs on the roof's south edge. */
function roofSign({ m, t, r, colour, seed }: Signing): void {
  const width = t.x1 - t.x0,
    w = Math.min(width - 3, 5 + r() * 10),
    h = Math.max(1.6, w / (3 + Math.floor(r() * 3))),
    x = t.x0 + 1.5 + w / 2 + r() * (width - 3 - w);
  const z = t.z1 - 1,
    foot = t.y1,
    up = foot + PARAPET + 0.5;
  m.set(0x30_33_36, Kind.Plain);
  for (let k = 0, n = Math.max(2, Math.round(w / 3.5)); k < n; k++) {
    const lx = x - w / 2 + 0.3 + ((w - 0.6) * k) / (n - 1);
    m.box(sized([lx, z - 0.12], [0.12, 0.12]), [foot, up + h - 0.2]);
    m.box(sized([lx, z - 1.1], [0.1, 0.1]), [foot, up + h * 0.4]);
  }
  board(m, {
    rect: { x0: x - w / 2, x1: x + w / 2, z0: z - 0.06, z1: z + 0.16 },
    y: [up, up + h],
    colour: colour(),
    seed: seed(),
    lit: r() < 0.4,
  });
}

/**
 * A building's signs, seen from the window up its street, nearest the most: a tall one out from a wall over an avenue, one flat on a south
 * wall over a street, a board on legs on the roof's south edge, a tower's tall board high on its shaft. Quiet: most have none. Its own generator:
 * the others' draws stay as they were.
 */
export function signs(m: Mass, b: Building, away: number): void {
  const t = footOf(b),
    r = rng(b.seed ^ 0x51_a6),
    share = away < 700 ? 1 : 0.5,
    y0 = STYLES[b.style].storey + 0.6;
  const s: Signing = {
    m,
    b,
    t,
    r,
    share,
    y0,
    colour: () => SIGNS[Math.floor(r() * SIGNS.length)] ?? SIGNS[0],
    seed: () => Math.floor(r() * 991) + 0.37,
    tall: (w) => Math.min(t.y1 - y0 - 0.8, w * (3 + Math.floor(r() * 6))),
  };
  if (away < SIGN_TOWER && topOf(b) >= 60 && b.style !== 'tile' && r() < 0.11) {
    towerSign(s);
  }
  // (a far block keeps its boards too, as High's: `lightsOnly` drops only their brackets and legs, under a pixel that far)
  if (away > SIGN_FAR || t.y1 < 9) {
    return;
  }
  avenueSigns(s);
  const south = onGrid(-t.z1 - GRID.street, GRID.pz);
  if (south && b.tiers.length === 1 && b.style !== 'band' && r() < 0.28 * share) {
    wallSign(s);
  }
  if (south && b.tiers.length === 1 && t.y1 < 45 && t.x1 - t.x0 > 9 && r() < 0.18 * share) {
    roofSign(s);
  }
}
