// The router as a 3D model (docs/render/net.md "The router"): one builder for the gallery's showcase and its stills, the Build my PC studio's wall
// (`studiowall3d.ts`) and the room's shelf (`room3d.ts`), so a router reads the same in all three. Four tiers: the home router (two aerials, four lights),
// the gigabit one (stouter aerials, a satin front, vents), the 10G switch-router (no aerials, a lit bar, fins) and the edge router (a rack unit: ears, two
// rows of lights). Every tier has the same five front ports in a row, the first LAN east, the WAN west, so a cord's plug seats in the same place on every tier: a real
// RJ45 jack each at real size (`rj45jack3d.ts`), but the edge router's five ports, which run at 40G, are QSFP+ cages (`qsfp3d.ts`: a real edge router has no copper port,
// and its WAN takes the 20 Gbit/s backbone plan). relay makes it (docs/brands/relay.md): its lockup is debossed in the top.
// The frame: x east, y up (0 is the shelf), z toward the viewer (0 is the front); the east end of the body at x = 0. 23 units a mm (`MM`).
import { Group, Mesh, MeshStandardMaterial, SphereGeometry, type Texture } from 'three';
import { BRAND_FONT, MAKER } from '@/core/render/brands';
import { drum, place, post, rectBox, rod, SEG, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { V3 } from '@/core/render/three/rope';
import { ROUTER_SPOT } from '../layout/layout';
import { debossMat, decal, decalTop, outlinePts, shapeOf, slab, tex } from './casekit3d';
import { MM } from './pcbkit3d';
import type { PortKind } from './plugs3d';
import { QSFP, qsfpFace, qsfpLamps, qsfpLook, type QsfpLook } from './qsfp3d';
import { jackFace, jackLamp, springGold, type JackLamps, type JackLook } from './rj45jack3d';

/** An RJ45 jack's face, real size (`jackFace`: 13.75 mm over its span's depth), how deep its insert goes. */
export const RJ = { w: 13.75 * MM, h: 10.7 * MM, deep: 15.5 * MM } as const;
/** A QSFP+ cage's face on the edge router's front, real size (`qsfpFace`: 18.95 mm across, 10 tall; a real cage is longer, this one is as deep as the jacks' inserts). */
export const CAGE = { w: QSFP.cage.w * MM, h: QSFP.cage.h * MM, deep: RJ.deep } as const;
/** How many of the front's five ports (from the first LAN) are QSFP+ cages on a tier: all five of the edge router's, its WAN port too; the other tiers have RJ45 jacks. */
export const qsfpPorts = (tier: number): number => (tier === 4 ? 5 : 0);
/** The kind of a router's ports (every port of a tier is of one kind, the WAN too): the edge router's are QSFP+ cages, the other tiers' RJ45 jacks. No router: an RJ45 one. */
export const routerPort = (tier: number | null): PortKind => (qsfpPorts(tier ?? 0) > 0 ? 'qsfp' : 'rj45');
/** The body's depth in the studio and the gallery (every tier: its jacks stand in the same place), and the pitch of its jacks. */
export const ROUTER_BODY = 2240;
export const PITCH = 440;
/** The router's size by tier (1 to 4): the body's width and its height from the shelf (the feet and the rack ears in them, the aerials not). */
export const ROUTER_SIZE: Readonly<Record<number, { w: number; h: number }>> = { 1: { w: 2700, h: 620 }, 2: { w: 3000, h: 700 }, 3: { w: 3300, h: 760 }, 4: { w: 3800, h: 1000 } };

/** The router's tier of a game's router id (`router2` is 2), or null. */
export const routerTier = (id: string | null | undefined): number | null => { const k = /^router(\d+)$/.exec(id ?? ''); return k ? Number(k[1]) : null; };

/** The face of the front jack `k` (0 the first LAN, 4 the WAN) in the router's frame: its middle, and its face's z (3 behind the front). */
export const routerJack = (k: number): V3 => [-(520 + k * PITCH), 320, -3];

const NEON = 0x3be3ff, AZURE = 0x4aa8ff, LINK = 0x58e08a, ACT = 0xffb547;
/** How bright a lit status light is: above this a cyan light blooms to white. */
export const LED_ON = 1.4;
/** The shell's underside: the front bezel stands from here up (the foot and the plinth are under it). */
export const ROUTER_UNDER = 110;
/** The foot's height, the shell's underside, and how deep the front bezel is (the jacks' inserts end inside it). */
const FOOT = 40, UNDER = ROUTER_UNDER, SEAM = RJ.deep + 80;
/** The plinth's top: what the board's standoffs stand on (`routerboard3d.ts`). */
export const ROUTER_FLOOR = UNDER + 30;

/**
 * Where the room stands the router of `tier` in its spot (`room3d.ts`; the detailed view's panel lies over its front, `machine3d.ts`): the one scale that fits its box in the spot,
 * how far its front stands out of the wall, and its front bezel in the room's layout units (x east, y down).
 */
export function routerFit(tier: number, spot: RectLike = ROUTER_SPOT): { k: number; front: number; face: RectLike } {
  const t = ROUTER_SIZE[tier] ? tier : 1, size = ROUTER_SIZE[t]!, k = Math.min(spot.w / size.w, spot.h / size.h);
  return { k, front: t >= 4 ? 1500 : 1400, face: { x: spot.x + spot.w - k * size.w, y: spot.y + spot.h - k * size.h, w: k * size.w, h: k * (size.h - UNDER) } };
}

/** Where the room stands the router of `tier`: `routerFit`'s scale and front, the depth its model is built to (the wall's 300 behind it), and where its east end meets the shelf (the room's layout units, y down). */
export interface RouterStand { k: number; front: number; face: RectLike; depth: number; ox: number; oy: number }
export function routerStand(tier: number, spot: RectLike = ROUTER_SPOT): RouterStand {
  const fit = routerFit(tier, spot);
  return { ...fit, depth: (fit.front - 300) / fit.k, ox: spot.x + spot.w, oy: spot.y + spot.h };
}

/** A box of the router's frame (y up) as a layout rect (y down), for the builders of `geometry.ts`. */
const lay = (x0: number, x1: number, y0: number, y1: number): RectLike => ({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 });

/** The group the jacks of a front are built in: a jack is built as a wall across x, turned so its mouth opens toward +z. One group for all of them puts their parts under one parent, so a merge takes them in a few draws. */
const jackRow = (): Group => { const row = new Group(); row.rotation.y = Math.PI / 2; return row; };

/** A jack in a `jackRow`, its latch slot down. `face` is its face's z. */
const jackIn = (row: Group, x: number, y: number, face: number, look: JackLook, fine: boolean): void => {
  jackFace(row, -face, { y0: -(y + RJ.h / 2), y1: -(y - RJ.h / 2), z0: x - RJ.w / 2, z1: x + RJ.w / 2 }, RJ.deep, look, fine);
};

/**
 * A QSFP+ cage in a `jackRow`, its two lights over it in the bezel (lenses on the front: the bezel's face is z = 0, so they stand on it, not on the cage's face). `face` is the cage's
 * face's z.
 */
const cageIn = (row: Group, x: number, y: number, face: number, look: QsfpLook, lamps: JackLamps, fine: boolean): void => {
  const s = cageSpan(x, y);
  qsfpFace(row, -face, s, CAGE.deep, look, fine);
  qsfpLamps(row, 0, s, '-y', lamps, look, false);
};
/** The span a cage's face takes on a front, its middle at (`x`, `y`). */
const cageSpan = (x: number, y: number) => ({ y0: -(y + CAGE.h / 2), y1: -(y - CAGE.h / 2), z0: x - CAGE.w / 2, z1: x + CAGE.w / 2 });

/** A jack in a front facing the viewer, in a row of its own. `face` is its face's z. */
export function jackAt(into: Group, x: number, y: number, face: number, look: JackLook, fine = true): void {
  const row = jackRow();
  jackIn(row, x, y, face, look, fine);
  into.add(row);
}

/** A QSFP+ cage in a front facing the viewer, in a row of its own (a wall plate's: no lights). `face` is its face's z. */
export function cageAt(into: Group, x: number, y: number, face: number, look: QsfpLook, fine = true): void {
  const row = jackRow();
  qsfpFace(row, -face, cageSpan(x, y), CAGE.deep, look, fine);
  into.add(row);
}

/** How a tier is made: the shell's and the front's paint, the colour of its lights, the corner round, the lights on its front (a row of `dots` at `step`). */
interface Look { tone: number; metal: number; rough: number; plate: number; pMetal: number; pRough: number; led: number; r: number; dots: number; step: number }
const LOOK: Readonly<Record<number, Look>> = {
  // (soft-touch black plastic)
  1: { tone: 0x1d1e22, metal: 0.1, rough: 0.55, plate: 0x1d1e22, pMetal: 0.1, pRough: 0.55, led: NEON, r: 90, dots: 4, step: 330 },
  // (satin paint over a graphite front)
  2: { tone: 0x131518, metal: 0.05, rough: 0.6, plate: 0x2a2d32, pMetal: 0.4, pRough: 0.45, led: NEON, r: 90, dots: 6, step: 300 },
  // (dark anodised aluminium)
  3: { tone: 0x2a2d32, metal: 0.3, rough: 0.55, plate: 0x1d1e22, pMetal: 0.4, pRough: 0.5, led: AZURE, r: 70, dots: 8, step: 250 },
  // (a steel rack unit)
  4: { tone: 0x1d1e22, metal: 0.3, rough: 0.55, plate: 0x2a2d32, pMetal: 0.35, pRough: 0.55, led: AZURE, r: 50, dots: 8, step: 190 },
};

export interface RouterOpts {
  /** The body's depth (default `ROUTER_BODY`): the room's shelf is shallower. */
  depth?: number;
  /** The springs and the comb in the jacks' mouths (default true): Low leaves them out. */
  fine?: boolean;
  /** The back panel (default true): a router against a wall shows none of it. */
  rear?: boolean;
  /** The jacks the scene lights (index as `routerJack`; default all five). Each has a pair of lamps of its own, all out as built; the others have a plain dark lens, so a jack nothing lights costs no draw. */
  drive?: readonly number[];
}

export interface RouterModel {
  root: Group;
  /** What the room fades to show the board inside (`setRouterShell`): the shell, the front bezel with its lights and legend, the aerials, the ears. Its materials are its own. The jacks, the plinth and the feet stay. */
  shell: Group;
  /** The body's size as built: width, height (from the shelf) and depth. */
  size: { w: number; h: number; depth: number };
  /** The status lights: one material for the lights of the front and the lit bar. */
  status: MeshStandardMaterial[];
  /** The two lights of each front jack (index as `routerJack`: 0 the first LAN, 4 the WAN), null for a jack the scene does not drive (`drive`). All out as built: the scene lights them from the link's frames (`jackleds.ts`). */
  jacks: (JackLamps | null)[];
}

/** The port legend under the jacks (WAN, LAN 1 to 4): one tone on a clear ground; null where there is no canvas (the tests). */
function legend(): { t: Texture; x0: number; x1: number } | null {
  const x0 = routerJack(4)[0] - 220, x1 = routerJack(0)[0] + 220;
  const t = tex('router-legend', Math.round((x1 - x0) / 2), 48, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#8d939c'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `600 21px ${BRAND_FONT}`;
    for (let k = 0; k < 5; k++) c.fillText(k === 4 ? 'WAN' : `LAN ${k + 1}`, (routerJack(k)[0] - x0) / 2, H / 2 + 1);
  });
  return t ? { t, x0, x1 } : null;
}

/** A print: a painted sheet on a clear ground, over the surface it lies on. */
const print = (map: Texture): MeshStandardMaterial => mat(0xffffff, { map, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** The point `d` along the way from `a` to `b`. */
const along = (a: V3, b: V3, d: number): V3 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return [a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l, a[2] + ((b[2] - a[2]) * d) / l];
};

/** The router of a tier (1 to 4; any other is the home router), built in its own frame. */
export function routerModel(tier: number, o: RouterOpts = {}): RouterModel {
  const t = LOOK[tier] ? tier : 1, L = LOOK[t]!, { w, h } = ROUTER_SIZE[t]!;
  const D = Math.max(o.depth ?? ROUTER_BODY, SEAM + 500), fine = o.fine ?? true, rear = o.rear ?? true;
  const g = new Group(), sh = new Group();
  g.add(sh);

  // the materials: the shell and the front (one where they are one paint), the feet and the plinth, the dark of a slot or a lens, the steel of a jack. The shell group fades alone (`RouterModel.shell`): none of its materials is a jack's
  const shell = mat(L.tone, { metalness: L.metal, roughness: L.rough });
  const front = L.plate === L.tone && L.pMetal === L.metal && L.pRough === L.rough ? shell : mat(L.plate, { metalness: L.pMetal, roughness: L.pRough });
  const plinth = mat(0x131518, { roughness: 0.8 }), rubber = mat(0x050608, { roughness: 0.95 }), dark = mat(0x050608, { roughness: 0.8 });
  const lens = mat(0x131518, { roughness: 0.25, metalness: 0.1 }), steel = mat(0x959aa3, { metalness: 0.8, roughness: 0.44 });
  const lamp = (c: number, i: number) => mat(0x131518, { emissive: c, emissiveIntensity: i, roughness: 0.3 });
  const led = lamp(L.led, LED_ON);

  // the body: the shell behind, the front bezel (open at each jack) in front of it, the plinth and the four feet under it
  sh.add(softBox(lay(-w, 0, UNDER, h), -D, -SEAM, shell, L.r));
  // (an opening for each RJ45 jack; the edge router's QSFP+ cages stand in one, a hair apart as in a ganged cage)
  const nq = qsfpPorts(t), holes = [0, 1, 2, 3, 4].filter((k) => k >= nq).map((k) => { const [x, y] = routerJack(k); return outlinePts(lay(x - RJ.w / 2, x + RJ.w / 2, y - RJ.h / 2, y + RJ.h / 2), 0); });
  if (nq) { const a = routerJack(nq - 1), b = routerJack(0), m = 6; holes.push(outlinePts(lay(a[0] - CAGE.w / 2 - m, b[0] + CAGE.w / 2 + m, b[1] - CAGE.h / 2 - m, b[1] + CAGE.h / 2 + m), 0)); }
  sh.add(slab(shapeOf(outlinePts(lay(-w, 0, UNDER, h), L.r, undefined, SEG.cornerCoarse), holes), -SEAM, 0, front));
  g.add(softBox(lay(-w + 70, -70, FOOT, ROUTER_FLOOR), -D + 90, -70, plinth, 30));
  for (const x of [-170, -w + 170]) for (const z of [-200, -D + 200]) g.add(post(x, 0, z, 70, FOOT, rubber, SEG.smallDisc));

  // the five jacks. One the scene lights has two lamps of its own, all out as built: the link's state and its frames light them (`jackleds.ts`), never this builder.
  // One it does not has a dark lens and no lamp.
  const insert = mat(0x131518, { roughness: 0.9 }), contact = springGold(), off = mat(0x131518, { roughness: 0.3 }), driven = new Set(o.drive ?? [0, 1, 2, 3, 4]);
  const jacks = [0, 1, 2, 3, 4].map((k): JackLamps | null => (driven.has(k) ? { link: jackLamp(LINK), act: jackLamp(ACT) } : null));
  const row = jackRow(), cages = nq ? qsfpLook(steel) : null;
  jacks.forEach((j, k) => {
    const [x, y, z] = routerJack(k), lamps = { link: j?.link ?? off, act: j?.act ?? off };
    if (cages && k < nq) cageIn(row, x, y, z, cages, lamps, fine);
    else jackIn(row, x, y, z, { shell: steel, insert, contact, ...lamps }, fine);
  });
  g.add(row);
  const lg = legend();
  if (lg) sh.add(decal(lay(lg.x0, lg.x1, 118, 170), 0.8, print(lg.t)));

  // the front's status lights, in a smoked strip: a row (two on the edge router) of `dots`
  const rows = t === 4 ? [h - 210, h - 140] : [h - 100], xs = Array.from({ length: L.dots }, (_, k) => -w + 420 + k * L.step);
  const ly0 = rows[rows.length - 1]! - 46, ly1 = rows[0]! + 46;
  sh.add(softBox(lay(xs[0]! - 150, xs[xs.length - 1]! + 150, ly0, ly1), -10, 8, lens, 28));
  for (const y of rows) for (const x of xs) sh.add(drum(x, -y, 2, 12, t === 4 ? 22 : 26, led, SEG.part));
  // (the wider tiers have room west of the WAN jack: slots that breathe)
  if (t >= 2) {
    const x1 = routerJack(4)[0] - (nq > 4 ? CAGE.w : RJ.w) / 2 - 120, top = t === 2 ? 430 : t === 3 ? 520 : 640;
    for (let x = -w + 140; x + 44 <= x1; x += 90) sh.add(rectBox(lay(x, x + 44, 200, top), -3, 5, dark));
  }
  // the top: the lit bar (10G and core), the fins (10G), the vents, and the maker's lockup debossed in it
  if (t >= 3) sh.add(rectBox(lay(-w + 420, -420, h - 5, h + 3), -240, -170, led));
  const vz0 = -D + 300, vz1 = Math.min(-D + 1000, -SEAM - 100);
  if (t === 3) {
    const fz0 = -D + 220, fz1 = -0.45 * D, fin = mat(0x1d1e22, { metalness: 0.5, roughness: 0.5 });
    if (fz1 - fz0 > 300) for (let x = -w + 500; x <= -500; x += 200) sh.add(softBox(lay(x, x + 60, h - 10, h + 50), fz0, fz1, fin, 12));
  } else if (vz1 - vz0 > 250) {
    for (let x = -w + 500; x + 90 <= -500; x += 240) sh.add(rectBox(lay(x, x + 90, h - 3, h + 3), vz0, vz1, dark));
  }
  const mark = debossMat('router-top', MAKER.router, 1024, 256), zc = t >= 3 ? -520 : -250;
  if ((mark as MeshStandardMaterial).map) sh.add(decalTop(-(h + 0.8), -w / 2 - 480, -w / 2 + 480, zc - 120, zc + 120, mark));
  else mark.dispose();

  // the aerials (home and gigabit): a hinge on the back corner, a boot, the rod and its round tip, leaning out
  if (t <= 2) {
    const aerial = mat(0x2a2d32, { roughness: 0.45 }), boot = mat(0x131518, { roughness: 0.8 }), rad = t === 2 ? 105 : 85, len = t === 2 ? 2800 : 2400;
    for (const [ax, lean] of [[-w + 260, -0.14], [-260, 0.14]] as const) {
      const b: V3 = [ax, h + 40, -D + 240], tip: V3 = [ax + Math.sin(lean) * len, h + 40 + Math.cos(lean) * len, -D + 90];
      const knuckle = place(new Mesh(new SphereGeometry(rad * 1.5, SEG.part, SEG.rings), aerial)), cap = place(new Mesh(new SphereGeometry(rad, SEG.part, SEG.rings), aerial));
      knuckle.position.set(...b);
      cap.position.set(...tip);
      sh.add(softBox(lay(ax - 150, ax + 150, h - 30, h + 70), -D + 110, -D + 380, boot, 24), knuckle, rod(b, tip, rad, aerial, SEG.rod), rod(b, along(b, tip, 340), rad * 1.45, aerial, SEG.rod), cap);
    }
  }
  // (the edge router: a rack unit, ears bolted at the sides, each with its slot)
  if (t === 4) {
    for (const [a, b] of [[-w - 200, -w], [0, 200]] as const) {
      const c = (a + b) / 2, slot = outlinePts(lay(c - 55, c + 55, h / 2 - 150, h / 2 + 150), 55);
      sh.add(slab(shapeOf(outlinePts(lay(a, b, UNDER, h), 30, undefined, SEG.cornerCoarse), [slot]), -110, 0, front));
    }
  }

  // (the back panel's materials are its own too: the room fades the shell, never the back)
  if (rear) rearPanel(g, t, w, D, { dark: mat(0x050608, { roughness: 0.8 }), steel: mat(0x959aa3, { metalness: 0.8, roughness: 0.44 }), plinth });
  return { root: g, shell: sh, size: { w, h, depth: D }, status: [led], jacks };
}

/** The materials the back panel is made of. */
interface RearMats { dark: MeshStandardMaterial; steel: MeshStandardMaterial; plinth: MeshStandardMaterial }

/**
 * The back panel (seen from the gallery's turntable), the ports along y = 320 from the east: the power input, the console jack and two cages (10G and
 * core), then the reset pinhole and the power button west; the edge router adds a mains inlet and a grille over them.
 */
function rearPanel(g: Group, t: number, w: number, D: number, m: RearMats): void {
  const z = -D, y = 320;
  // the DC input: a barrel with its bore
  g.add(drum(-420, -y, z - 30, z + 6, 66, m.plinth, SEG.part), drum(-420, -y, z - 31, z - 29, 40, m.dark, SEG.part));
  // the power button (a ring and its cap) and the reset pinhole
  g.add(drum(-w + 520, -y, z - 24, z + 6, 74, m.plinth, SEG.part), drum(-w + 520, -y, z - 28, z - 20, 46, m.steel, SEG.part), drum(-w + 840, -y, z - 3, z + 2, 16, m.dark, 6));
  if (t >= 3) {
    // the console port and two cages: each a steel frame round a dark mouth (the body's back is solid: a jack's insert would have nothing to sit in)
    for (const [x, hw, hh] of [[-1100, 150, 115], [-1700, 165, 98], [-2140, 165, 98]] as const) {
      g.add(slab(shapeOf(outlinePts(lay(x - hw, x + hw, y - hh, y + hh), 14, undefined, SEG.cornerCoarse), [outlinePts(lay(x - hw + 30, x + hw - 30, y - hh + 30, y + hh - 30), 8, undefined, SEG.cornerCoarse)]), z - 6, z + 5, m.steel));
      g.add(rectBox(lay(x - hw + 30, x + hw - 30, y - hh + 30, y + hh - 30), z - 3, z - 1, m.dark));
    }
  }
  if (t === 4) {
    // the mains inlet (a shroud with its three pins), west and high, and a grille of slots along the top
    g.add(rectBox(lay(-w + 500, -w + 1120, 560, 900), z - 70, z + 10, m.dark), rectBox(lay(-w + 560, -w + 1060, 610, 850), z - 76, z - 60, m.plinth));
    for (const x of [-w + 700, -w + 810, -w + 920]) g.add(rectBox(lay(x - 25, x + 25, 660, 800), z - 90, z - 70, m.steel));
    for (let x = -400; x >= -2400; x -= 110) g.add(rectBox(lay(x, x + 50, 620, 880), z - 4, z + 4, m.dark));
  }
}
