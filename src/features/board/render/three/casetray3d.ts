// The inside of the 3D cases (case3d.ts), as a case looks with nothing in it (docs/render/case.md "The empty case"). The tray: a sheet with real holes
// in it (the CPU cut-out, punched vents and lacing slots) over a thin back panel, a stamped panel under the board with its standoff marks, stiffening
// beads, tie-down bridges, Velcro straps, and rubber cable holes where the leads come through. The frame: riveted flanges round the tray, a rolled lip
// round the side opening with rubber bumpers and the receivers of the door's hooks, and the door's own hem and hooks. All at real scale, by kind.
import { Color, CylinderGeometry, Group, Mesh, PlaneGeometry, Shape, Vector2 } from 'three';
import type * as threeTypes from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEG, extrude, instanced, rectBox, softBox } from '@/core/render/three/geometry';
import type * as geometryTypes from '@/core/render/three/geometry';
import { NYLON, mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import type { RopeEnd, V3 } from '@/core/render/three/rope';
import { BOARD_Z, CASE_Z } from '@/features/room/render/three/roomplan';
import { standoffs } from '@/features/room/render/desk/props/case';
import type { CaseKind, Cuts } from '@/features/room/render/shell/casedecor';
import { geoOf, TIER_GEO } from '../layout/boardlayout';
import { CASE, CASE_BD, FAN_SLOT, GEO, LAYOUT_CASE, PSU, WALL_T } from '../layout/layout';
import { GROMMETS, kindTone } from './casedetail3d';
import type * as casedetail3dTypes from './casedetail3d';
import { baseCagePlan, cageGrommet, cagePlan } from './drivecage3d';
import {
  FRONT,
  NONE,
  outlinePts,
  pads,
  perforated,
  rivets,
  ring,
  screws,
  shapeOf,
  SIDE_T,
  slab,
  tex,
} from './casekit3d';
import type * as casekit3dTypes from './casekit3d';
import type { CableRig } from './cablerig3d';
import { cableMesh, fanPlug, fromSlot, grommet, hangPts, TRAY_Z } from './wires3d';
import type * as wires3dTypes from './wires3d';

/** A strap's pull tab: the case's accent, muted 70 % toward black, so the band reads as a strap and not a colour. */
export const strapTone = (acc: number): number => new Color(acc).lerp(new Color(0x10_11_14), 0.7).getHex();

/** How far the stamped panel under the board stands off the tray's sheet. */
const PANEL = 10;
/** The back panel's thickness: the tray's holes show it, dark, behind the sheet. */
const BACK_T = 16;

/** A kind's fixings: bare zinc in the Mini, black in the Micro and the Mid, polished in the Full tower; its rivets take the paint of the sheet. */
export const screwM = (k: CaseKind): threeTypes.Material =>
  k === 'oem'
    ? mat(0x95_9a_a3, { metalness: 0.8, roughness: 0.36 })
    : k === 'show'
      ? mat(0x4e_53_60, { metalness: 0.8, roughness: 0.34 })
      : mat(0x2a_2d_32, { metalness: 0.65, roughness: 0.38 });
export const rivetM = (k: CaseKind): threeTypes.Material =>
  mat({ oem: 0xc6_bd_9c, matte: 0x25_26_2c, gamer: 0x2b_31_42, show: 0x34_37_3e }[k], {
    metalness: 0.45,
    roughness: 0.42,
  });

/** A keyhole: a round hole with a slot rising from it (layout centre of the round part), as a world outline. */
function keyhole(x: number, y: number, r: number, slot: number, n = 14): Vector2[] {
  const out: Vector2[] = [],
    w = r * 0.48,
    a0 = Math.asin(w / r);
  // (round from the slot's east side by the south to its west side; the angle runs clockwise from north)
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * (Math.PI * 2 - 2 * a0);
    out.push(new Vector2(x + Math.sin(a) * r, -y + Math.cos(a) * r));
  }
  out.push(new Vector2(x - w, -(y - slot)), new Vector2(x + w, -(y - slot)));
  return out;
}

/** The real holes through the tray's sheet (world outlines): the CPU cut-out behind the socket, the Mini's punched vents and keyholes, the lacing slots. */
function sheetHoles(f: casedetail3dTypes.Frame): Vector2[][] {
  const bd = CASE_BD,
    east = bd.x + bd.w,
    out: Vector2[][] = [];
  if (f.kind === 'oem') {
    // two columns of punched vents, and keyholes for a board's snap-in feet
    for (const x of [east + 1150, east + 1400]) {
      for (let y = bd.y + 1500; y + 300 < bd.y + bd.h - 60; y += 430) {
        out.push(outlinePts({ x, y, w: 80, h: 300 }, 40));
      }
    }
    for (const [x, y] of [
      [east + 420, bd.y + 900],
      [east + 420, bd.y + 2100],
      [east + 420, bd.y + 3300],
    ] as const) {
      out.push(keyhole(x, y, 62, 150));
    }
  } else {
    out.push(outlinePts(CPU_CUT, 140));
    // pairs of lacing slots, to tie a bundle down through the tray
    for (let y = bd.y + 240; y + 300 < bd.y + bd.h; y += 760) {
      for (const dy of [0, 170]) {
        out.push(outlinePts({ x: east + 1500, y: y + dy, w: 130, h: 44 }, 22));
      }
    }
  }
  return out;
}

/** The hole behind the CPU's socket, clear of every standoff position (the CPU sits on the origin of every board). */
const CPU_CUT: geometryTypes.RectLike = { x: -1500, y: -1600, w: 3000, h: 2600 };

/** The back of the case: a thin back panel and, on it, the tray's sheet with its real holes. */
export function traySheet(f: casedetail3dTypes.Frame, outer: Vector2[], m: threeTypes.Material): Group {
  const g = new Group(),
    back = CASE_Z + BACK_T,
    holes = sheetHoles(f);
  g.add(slab(shapeOf(outer), CASE_Z, back, m, 6), slab(shapeOf(outer, holes), back, TRAY_Z, m, 6));
  // (a hole shows the back panel in the dark: nothing behind the sheet is lit)
  const dark = mat(0x05_06_08, { roughness: 0.95 });
  for (const h of holes) {
    g.add(seeThrough(slab(shapeOf(h), back, back + 2, dark)));
  }
  return g;
}

/** The stamped marks of the form factors a standoff position serves: I (the Mini's board), M (the Micro's), A (the Mid's), E (the Full's). */
function standoffMark(x: number, y: number): string {
  return ['I', 'M', 'A', 'E']
    .filter((_, t) => t <= LAYOUT_CASE && TIER_GEO[t]!.holes.some(([a, b]) => a === x && b === y))
    .join('');
}
function markMat(word: string, ink: string): threeTypes.Material {
  const t = tex(`stamp-${word}-${ink}`, 128, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = ink;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = '700 52px system-ui, sans-serif';
    c.fillText(word, 2, h / 2 + 2);
  });
  return mat(0xff_ff_ff, { map: t, transparent: true, depthWrite: false, roughness: 0.7 });
}

/** The tray under the board: a brass hex stud up to the board's underside at each of `used` (the fitted board's holes), a threaded hole at the case's other positions, and each position's stamped mark. */
function mounts(used: readonly (readonly [number, number])[], kind: CaseKind): Group {
  const g = new Group(),
    h = BOARD_Z - 60 - TRAY_Z,
    z = TRAY_Z + PANEL,
    on = (x: number, y: number) => used.some(([a, b]) => a === x && b === y);
  const up = (r: number, n: number, len: number) => new CylinderGeometry(r, r, len, n).rotateX(Math.PI / 2);
  g.add(
    instanced(
      up(58, 6, h),
      mat(0xd4_af_5f, { metalness: 0.65, roughness: 0.5 }),
      used.map(([x, y]) => ({ x, y: -y, z: TRAY_Z + h / 2 })),
    ),
  );
  g.add(
    instanced(
      up(24, SEG.part, 2),
      mat(0x1d_1e_22, { roughness: 0.8 }),
      used.map(([x, y]) => ({ x, y: -y, z: TRAY_Z + h + 1 })),
    ),
  );
  const free = standoffs().filter(([x, y]) => !on(x, y));
  if (free.length > 0) {
    g.add(
      instanced(
        up(46, SEG.post, 3),
        mat(0x95_9a_a3, { metalness: 0.75, roughness: 0.42 }),
        free.map(([x, y]) => ({ x, y: -y, z: z + 1 })),
      ),
    );
    g.add(
      instanced(
        up(26, SEG.part, 3),
        mat(0x05_06_08, { roughness: 0.85 }),
        free.map(([x, y]) => ({ x, y: -y, z: z + 3 })),
      ),
    );
  }
  const ink = kind === 'oem' ? '#959aa3' : '#8d929c';
  // (one mesh a word, not one a position: the marks of one word share a texture)
  const marks = new Map<string, threeTypes.BufferGeometry[]>();
  for (const [x, y] of standoffs()) {
    const word = standoffMark(x, y),
      at = marks.get(word) ?? [];
    marks.set(word, at);
    at.push(new PlaneGeometry(104, 52).translate(x + 128, -y, z + 1));
  }
  for (const [word, at] of marks) {
    if (!word) {
      continue;
    }
    const o = new Mesh(mergeGeometries(at), markMat(word, ink));
    o.receiveShadow = true;
    g.add(seeThrough(o));
  }
  return g;
}

/** A tie-down bridge stamped up out of the sheet: two feet and an arch a strap goes under, standing along +z, centred on its spot. */
function tieBridge(): Shape {
  const s = new Shape();
  for (const [i, [x, y]] of (
    [
      [-100, 0],
      [-64, 0],
      [-50, 44],
      [50, 44],
      [64, 0],
      [100, 0],
      [100, 12],
      [72, 12],
      [60, 62],
      [-60, 62],
      [-72, 12],
      [-100, 12],
    ] as const
  ).entries()) {
    if (i) {
      s.lineTo(x, y);
    } else {
      s.moveTo(x, y);
    }
  }
  s.closePath();
  return s;
}

/**
 * The tray: the stamped panel under the board (over the CPU's cut-out), stiffening beads, tie-down bridges in two columns, the cable holes of the
 * kind's gutter (the Mini's rolled holes, the Micro's long slot, the Mid's slanted cut-outs, the Full tower's ringed slots), the leads' own rubber holes
 * where a board of the case's size takes them, the straps of the better cases, and the Full tower's vented cable cover.
 */
export function trayDetail(f: casedetail3dTypes.Frame, inner: threeTypes.Material): Group {
  const g = new Group(),
    k = f.kind,
    bd = CASE_BD,
    east = bd.x + bd.w,
    geo = geoOf(LAYOUT_CASE),
    style = GROMMETS[k],
    z = TRAY_Z + PANEL;
  const panel: geometryTypes.RectLike = { x: bd.x + 80, y: bd.y - 90, w: bd.w + 40, h: bd.h + 170 },
    cut = k === 'oem' ? [] : [outlinePts(CPU_CUT, 140)];
  g.add(slab(shapeOf(outlinePts(panel, 70), cut), TRAY_Z - 1, z, inner, 5));
  if (k !== 'oem') {
    g.add(ring(CPU_CUT, 140, NONE, 26, TRAY_Z - 1, z + 6, inner));
  }
  g.add(mounts(GEO.holes, k));

  // stiffening beads pressed into the gutter and over the board's top
  const beadTop = f.yTop + 220,
    beadBot = PSU.y - 180;
  for (const x of [east + 1730, east + 1900]) {
    g.add(softBox({ x, y: beadTop, w: 70, h: beadBot - beadTop }, TRAY_Z - 1, TRAY_Z + 9, inner, 4));
  }

  // the tie-downs: two columns, the first against the board's east edge, the second past the cable holes
  const bridges: { x: number; y: number; z: number; rz: number }[] = [],
    straps: { x: number; y: number }[] = [];
  for (let y = bd.y + 360; y < bd.y + bd.h - 240; y += 900) {
    bridges.push({ x: east + 190, y: -y, z: TRAY_Z, rz: 0 }, { x: east + 1250, y: -y, z: TRAY_Z, rz: 0 });
    straps.push({ x: east + 1250, y });
  }
  const bridge = extrude(tieBridge(), {
    depth: 84,
    bevelEnabled: true,
    bevelSize: 3,
    bevelThickness: 3,
    bevelSegments: SEG.bevelFlat,
  })
    .translate(0, 0, -42)
    .rotateX(Math.PI / 2);
  g.add(instanced(bridge, mat(kindTone(k), { metalness: 0.5, roughness: 0.45 }), bridges));

  // the cable holes: the kind's own column in the gutter, and the leads' holes (a board of the case's size brings its leads out of these, `buildCables`)
  const x = east + 820;
  if (k === 'oem') {
    for (const y of [bd.y + 700, bd.y + 2000]) {
      g.add(grommet({ x, y, w: 180, h: 560 }, style));
    }
  }
  if (k === 'matte') {
    g.add(grommet({ x, y: bd.y + 500, w: 220, h: bd.h * 0.5 }, style));
  }
  if (k === 'gamer') {
    for (let i = 0; i < 3; i++) {
      g.add(grommet({ x, y: bd.y + 400 + i * (bd.h * 0.27), w: 220, h: bd.h * 0.2 }, style, 120));
    }
  }
  if (k === 'show') {
    for (let i = 0; i < 3; i++) {
      g.add(grommet({ x, y: bd.y + 400 + i * (bd.h * 0.3), w: 240, h: bd.h * 0.22 }, style));
    }
  }
  const { atx, cpw } = geo;
  g.add(
    grommet({ x: east + 620, y: atx.y + atx.h / 2 - 340, w: 60, h: 680 }, style),
    grommet({ x: cpw.x - 60, y: bd.y - 270, w: cpw.w + 120, h: 60 }, style),
    grommet(FAN_SLOT, style),
  );
  // the drives' cables go back through a slot behind each drive cage (drivecage3d.ts)
  g.add(grommet(cageGrommet(cagePlan()), style), grommet(cageGrommet(baseCagePlan()), style));
  if (geo.sata.length > 0) {
    const s0 = geo.sata[0]!,
      sn = geo.sata.at(-1)!;
    g.add(grommet({ x: east + 390, y: s0.y - 60, w: 60, h: sn.y + sn.h - s0.y + 120 }, style));
  }
  g.add(grommet(leadHole(), style));

  // the Velcro straps of the better cases, waiting open under their bridges: a black band down from the bridge with its pull tab
  if (k === 'gamer' || k === 'show') {
    const band = mat(0x13_15_18, { roughness: 1 }),
      tab = mat(strapTone(f.acc), { roughness: 0.75 });
    straps.forEach((s, i) => {
      const o = new Group(),
        lean = (i % 2 ? 1 : -1) * 0.05;
      o.position.set(s.x, -s.y, TRAY_Z);
      o.rotation.z = lean;
      o.add(
        rectBox({ x: -40, y: -40, w: 80, h: 400 }, 16, 24, band),
        rectBox({ x: -40, y: 360, w: 80, h: 44 }, 16, 25, tab),
      );
      o.add(rectBox({ x: -40, y: 60, w: 80, h: 110 }, 24, 26, mat(0x1d_1e_22, { roughness: 1 })));
      // (its meshes go straight into the tray's group, in its frame: the straps then merge with the tray's still meshes, `mergeSiblings`)
      o.updateMatrix();
      for (const c of [...o.children]) {
        c.applyMatrix4(o.matrix);
        g.add(c);
      }
    });
  }

  // the Full tower's cable cover: a vented plate standing on the tray over the gutter's east side, on four screws
  if (k === 'show') {
    const c: geometryTypes.RectLike = { x: east + 1660, y: f.yTop + 260, w: 400, h: PSU.y - f.yTop - 520 },
      zc = TRAY_Z + 90;
    g.add(ring(c, 30, NONE, 26, zc - 6, zc + 8, mat(0x2a_2d_32, { metalness: 0.55, roughness: 0.4 })));
    perforated(g, c, zc, 'hex', 60, 0x2a_2d_33, { metal: 0.55, rough: 0.45 });
    const posts: casekit3dTypes.Spot[] = [];
    for (const yy of [c.y + 80, c.y + c.h - 80]) {
      for (const xx of [c.x + 60, c.x + c.w - 60]) {
        posts.push({ x: xx, y: -yy, z: TRAY_Z });
      }
    }
    g.add(
      instanced(
        new CylinderGeometry(26, 26, 90, SEG.rod).rotateX(Math.PI / 2).translate(0, 0, 45),
        mat(0x2a_2d_32, { metalness: 0.55, roughness: 0.4 }),
        posts,
      ),
    );
    g.add(
      screws(
        posts.map((p) => ({ ...p, z: zc + 8 })),
        'z+',
        40,
        screwM(k),
      ),
    );
  }
  return g;
}

/** The hole under the board's south edge that the case's own front-panel leads come through. */
export function leadHole(): geometryTypes.RectLike {
  const bd = CASE_BD,
    h = geoOf(LAYOUT_CASE).hdrs.find((q) => q.name === 'F_PANEL')!;
  return { x: h.x - 140, y: bd.y + bd.h + 70, w: 560, h: 60 };
}

/** The case's front-panel leads: the switch and LED wires in their colours, USB 2.0, USB 3.0 (a thick blue cable), the lights of a board with an ARGB header. */
const LEADS: Readonly<Record<string, { looks: readonly wires3dTypes.Look[]; plug: string }>> = {
  F_PANEL: {
    plug: '#8d929c',
    looks: ['#b3262f', '#e4e6ea', '#2a57b0', '#16171b'].map((base) => ({ r: 6, base, accent: null })),
  },
  USB_2: { plug: '#16171b', looks: [{ r: 13, base: '#101116', accent: null }] },
  USB_3: { plug: '#1f4fa8', looks: [{ r: 22, base: '#1f4fa8', accent: null }] },
  ARGB: { plug: '#d9d9d9', looks: [{ r: 9, base: '#d8dade', accent: null }] },
};
/** The rig ids of every lead the case has (a board has the ones its headers take: `panelRigs`). */
export const PANEL_IDS: readonly string[] = Object.keys(LEADS).map((h) => `panel:${h}`);

/** The id of a front-panel lead's rig, by the header it plugs into (`panelRigs`). */
export const panelId = (header: string): string => `panel:${header}`;
/** Is this rig id one of the case's front-panel leads? They are the case's, not the game's: the sim has no such cable. */
export const isPanelId = (id: string): boolean => id.startsWith('panel:');

/** What a lead's hand-run sleeve wears where its wires differ (the switch and LED wires: a mid grey between their colours). */
const BUNDLE: wires3dTypes.Look = { r: 6, base: '#6b6f78', accent: null };

/**
 * The case's front-panel leads, one rig each (`panel:F_PANEL`, `panel:USB_2`, `panel:USB_3`, `panel:ARGB`, west to east as they hang), each from its share of
 * the hole under the board's south edge to its header on the fitted board. Rigs, so that Build my PC's hand runs them out and plugs them when the board goes
 * in, and pulls them and takes them back when it comes out (`BuildStage.plugPanel`); the sim has no such cables, the stage keeps which are plugged.
 * A board has the headers its tier has: a lead with no header has no rig.
 */
export function panelRigs(env: wires3dTypes.Env): CableRig[] {
  const hole = leadHole(),
    hdrs = GEO.hdrs.filter((h) => LEADS[h.name]).sort((a, b) => a.x - b.x),
    deck = { n: [0, 0, 1] as V3, d: BOARD_Z };
  const from = fromSlot(
    hole,
    hdrs.reduce((n, h) => n + LEADS[h.name]!.looks.length, 0),
  );
  let i = 0;
  return hdrs.map((h): CableRig => {
    const { looks, plug } = LEADS[h.name]!,
      fixed = from.slice(i, (i += looks.length)),
      rect = { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 };
    const look = looks.length > 1 ? BUNDLE : looks[0]!,
      o = { slack: 1.25, extra: 120, n: 16 };
    return {
      id: panelId(h.name),
      name: `the ${h.name.replace('_', ' ')} header`,
      target: null,
      look,
      looks,
      env,
      fixed,
      canSeat: true,
      deck,
      n: o.n,
      stiff: 0.5,
      lead: look.r * 2.5,
      engage: 70,
      inert: true,
      // (the plug on its header, pushed in from the glass side, its wires spread across its top: where the build always had them)
      model: () => {
        const p = fanPlug(rect, plug);
        return {
          root: p.root,
          strands: looks.map((_, k): RopeEnd => ({
            at: [p.end.at[0] + (k - (looks.length - 1) / 2) * 26, p.end.at[1], p.end.at[2]],
            dir: p.end.dir,
          })),
        };
      },
      seat: { at: [rect.x + rect.w / 2, -(rect.y + rect.h / 2), BOARD_Z + 150], axis: [0, 0, 1] },
      seated: (ex) => ex.map((e, k) => hangPts(fixed[k]!, e, looks[k]!, env, o)),
    };
  });
}

/** The leads as a new case ships them, with no board to plug into: two turns on the tray over their hole, tied, their plugs hanging at the ends. */
export function leadCoil(): Group {
  const g = new Group(),
    hole = leadHole(),
    cx = hole.x + hole.w / 2,
    cy = hole.y - 340,
    all = [...LEADS['F_PANEL']!.looks, ...LEADS['USB_2']!.looks, ...LEADS['USB_3']!.looks],
    from = fromSlot(hole, all.length);
  all.forEach((look, i) => {
    const pts: V3[] = [from[i]!.at, [from[i]!.at[0], from[i]!.at[1], TRAY_Z + 60]],
      r = 200 + (i % 3) * 22,
      turns = 2.25,
      n = 44,
      zc = TRAY_Z + 60 + (i % 3) * 22;
    for (let k = 0; k <= n; k++) {
      const a = -Math.PI / 2 + (k / n) * turns * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, -cy + Math.sin(a) * r, zc]);
    }
    const end = pts.at(-1)!,
      tail: V3 = [end[0] + (i - all.length / 2) * 36, end[1] - 240 - i * 30, zc + 8];
    pts.push(tail);
    g.add(cableMesh(pts, look));
    g.add(
      softBox({ x: tail[0] - 36, y: -tail[1], w: 72, h: 90 }, zc - 26, zc + 34, mat(0x1d_1e_22, { roughness: 0.5 }), 6),
    );
  });
  // the tie
  g.add(rectBox({ x: cx - 34, y: cy - 280, w: 68, h: 100 }, TRAY_Z + 30, TRAY_Z + 134, mat(NYLON, { roughness: 0.6 })));
  g.traverse(seeThrough);
  return g;
}

/**
 * The frame round the tray: a riveted flange along the top, the rear and the front of the tray, rows of rivets on the walls that meet it, and the side
 * opening's finish: a rolled lip inside it, the rubber bumpers the door closes on and the receivers of its hooks.
 */
export function frameDetail(f: casedetail3dTypes.Frame, ex: number, hooks: readonly number[], hookY: number): Group {
  const g = new Group(),
    k = f.kind,
    x0 = CASE.x + WALL_T,
    x1 = ex - 160,
    m = f.body,
    w = 120,
    floor = PSU.y,
    z1 = FRONT - SIDE_T,
    bottom = CASE.y + CASE.h;
  g.add(softBox({ x: x0, y: f.yTop, w: x1 - x0, h: w }, TRAY_Z - 1, TRAY_Z + 10, m, 4));
  g.add(softBox({ x: x0, y: f.yTop + w, w, h: floor - f.yTop - w }, TRAY_Z - 1, TRAY_Z + 10, m, 4));
  g.add(softBox({ x: x1 - w, y: f.yTop + w, w, h: floor - f.yTop - w }, TRAY_Z - 1, TRAY_Z + 10, m, 4));
  // the rivets: the flanges' faces, and a row on each wall just off the tray
  const flat: casekit3dTypes.Spot[] = [],
    rear: casekit3dTypes.Spot[] = [],
    front: casekit3dTypes.Spot[] = [],
    top: casekit3dTypes.Spot[] = [],
    rv = rivetM(k),
    step = 620;
  for (let x = x0 + 300; x < x1 - 200; x += step) {
    flat.push({ x, y: -(f.yTop + w / 2), z: TRAY_Z + 10 });
    top.push({ x, y: -f.yTop, z: TRAY_Z + 90 });
  }
  for (let y = f.yTop + 400; y < floor - 150; y += step) {
    flat.push({ x: x0 + w / 2, y: -y, z: TRAY_Z + 10 }, { x: x1 - w / 2, y: -y, z: TRAY_Z + 10 });
    rear.push({ x: x0, y: -y, z: TRAY_Z + 90 });
    front.push({ x: x1, y: -y, z: TRAY_Z + 90 });
  }
  g.add(rivets(flat, 'z+', 40, rv), rivets(rear, 'x+', 40, rv), rivets(front, 'x-', 40, rv), rivets(top, 'y-', 40, rv));

  // the opening: the lip rolled in round it, and on its rim the door's bumpers and receivers
  const open: geometryTypes.RectLike = { x: x0, y: f.yTop, w: x1 - x0, h: f.yBot - f.yTop };
  g.add(ring(open, 18, NONE, 0, z1 - 26, z1, m, 38));
  const rubber = mat(0x05_06_08, { roughness: 0.92 }),
    rim: casekit3dTypes.Spot[] = [],
    zr = z1 - 1;
  for (const x of hooks) {
    rim.push({ x: x - 380, y: -hookY, z: zr }, { x: x + 380, y: -hookY, z: zr });
  }
  const lowY = (f.yBot + bottom) / 2;
  for (const x of hooks) {
    rim.push({ x, y: -lowY, z: zr });
  }
  for (const y of [f.yTop + 500, (f.yTop + f.yBot) / 2, f.yBot - 500]) {
    rim.push({ x: (CASE.x + x0) / 2, y: -y, z: zr }, { x: (x1 + ex) / 2, y: -y, z: zr });
  }
  g.add(pads(rim, 'z+', 34, rubber));
  const dark = mat(0x05_06_08, { roughness: 0.9 }),
    lipM = rivetM(k);
  for (const x of hooks) {
    g.add(seeThrough(rectBox({ x: x - 96, y: hookY - 28, w: 192, h: 56 }, z1 - 1, z1 + 1, lipM)));
    g.add(seeThrough(rectBox({ x: x - 76, y: hookY - 15, w: 152, h: 30 }, z1, z1 + 2, dark)));
  }
  return g;
}

/**
 * The door's inner face (its meshes on `side`, where they swing with it): a hem folded along its edge, and a hook over each receiver in the frame's
 * rim at the top. They sit in the sheet's thickness and in the body while the door is shut.
 */
export function doorInner(
  side: Group,
  sheet: geometryTypes.RectLike,
  rad: number,
  cuts: Cuts,
  m: threeTypes.Material,
  hooks: readonly number[],
  hookY: number,
): void {
  const z1 = FRONT - SIDE_T;
  side.add(ring(sheet, rad, cuts, 0, z1 - 16, z1, m, 56));
  for (const x of hooks) {
    side.add(
      rectBox({ x: x - 70, y: hookY - 44, w: 140, h: 26 }, z1 - 46, z1, m),
      rectBox({ x: x - 70, y: hookY - 44, w: 140, h: 70 }, z1 - 46, z1 - 34, m),
    );
  }
}
