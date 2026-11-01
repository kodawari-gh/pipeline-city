// The PC case in 3D (docs/render/case.md "Four real cases"): the 2D's four cases, each a real box over its side-view outline. Mini a cream OEM
// tower (a solid side with a pressed panel, a vent patch, screws, a label, round feet, a plastic front with bay covers), Micro a matte black
// tower (a tinted window over the upper part, a debossed logo, rubber rails), Mid a gaming case (a cut-corner window in a bezel, a mesh cap on
// the top front corner, slanted vents, multi-zone RGB under the glass, a lit logo plate, splayed feet), Full a chamfered showcase (graphite,
// silver pillars and rails, a lit edge round the glass, lit slots in the pillars and over the top fans, hex mesh, two name plates).
// The body (`root`) stays; the outer side panel (`side`: the sheet, its window, trim and lights) fades as the camera comes in (machine3d.ts).
import {
  BoxGeometry, CanvasTexture, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Path, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Shape, ShapeGeometry, Vector2,
  type Material, type Texture,
} from 'three';
import { drum, instanced, place, post, rectBox, rod, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { builtinTheme, type Theme } from '@/core/render/theme';
import { CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE_LOOK } from '@/features/room/render/desk/props/case';
import { CASE_CUTS, WINDOW_CUTS, caseWindow, isCut, showPillars, type CaseKind, type Cuts } from '@/features/room/render/shell/casedecor';
import { stripRect, type StripMode } from '@/features/room/render/shell/exterior';
import { CASE, CASE_GLASS, CASE_IN, CASE_PANEL, FOOT, LAYOUT_CASE, PSU, TOP_FANS, WALL_T } from '../layout/layout';
import { glowMat, light, type Spin } from './fans3d';

const FRONT = CASE_Z + CASE_D;
/** The outer side panel's thickness: it closes the body's open side, its face at `FRONT`. */
export const SIDE_T = 36;
const NONE: Cuts = [0, 0, 0, 0];
const hex = (s: string) => parseInt(s.slice(1, 7), 16);

/** Each kind's materials and shape: the body's colour and finish, the inside's tone, how round the body is, the glass, the shroud's print. */
const LOOKS: Record<CaseKind, { body: number; rough: number; metal: number; inner: number; rad: number; glass: { color: number; opacity: number } | null; shroud: { body: number; ink: string }; rgb: boolean }> = {
  oem: { body: 0xdcd4b5, rough: 0.6, metal: 0.04, inner: 0xcbc2a1, rad: 30, glass: null, shroud: { body: 0xcfc6a5, ink: '#5c5642' }, rgb: false },
  matte: { body: 0x17181c, rough: 0.88, metal: 0.08, inner: 0x111215, rad: 80, glass: { color: 0x1c2330, opacity: 0.5 }, shroud: { body: 0x15161a, ink: '#5d626d' }, rgb: false },
  gamer: { body: 0x1d2232, rough: 0.38, metal: 0.55, inner: 0x121621, rad: 56, glass: { color: 0x9fb4c4, opacity: 0.12 }, shroud: { body: 0x1b2030, ink: '#c9ced6' }, rgb: true },
  show: { body: 0x0c0d10, rough: 0.32, metal: 0.6, inner: 0x0c0d10, rad: 0, glass: { color: 0xb8c6d2, opacity: 0.09 }, shroud: { body: 0x1a1c21, ink: '#d8dce4' }, rgb: true },
};
/** The gaming case's top front corner is cut at 45 degrees and carries a mesh cap. */
const GAMER_CAP = 360;
/** The Mini's plastic front: how far it reaches back over the side, from the front edge. */
const OEM_BEZEL = 170;
/** The showcase's anodised aluminium. */
const SILVER = { color: 0xa7adb6, metalness: 0.6, roughness: 0.34 };

export interface CaseModel {
  /** The body, the feet and the front, tagged `case`: always shown. */
  root: Group;
  /** The outer side panel with its window, trim and lights: it fades as the camera comes in, and never takes a click. */
  side: Group;
  glass: Mesh | null;
  /** The lights that follow the fans (a `Spin` with nothing to turn). */
  spins: Spin[];
  /** The accent strip on the front rim: the live frame colours it by the machine's state (`stripModeOf`). */
  strip: MeshStandardMaterial;
  /** Whether the inside has RGB (the case fans' rings, the light strips, the coloured fill). */
  rgb: boolean;
  /** The inside's tone (the tray) and the shroud's (its print's ink). */
  inner: number;
  shroud: { body: number; ink: string };
}

/** The outline of a layout rect as world points (y up), clockwise in the layout: a corner with a cut is chamfered at 45 degrees, the others rounded by `r`. */
export function outlinePts(rc: RectLike, r: number, cuts: Cuts = NONE, seg = 5): Vector2[] {
  const { x, y, w, h } = rc, rr = Math.max(0, Math.min(r, w / 2, h / 2)), out: Vector2[] = [];
  const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]];
  corners.forEach(([cx, cy, dx, dy], k) => {
    const c = cuts[k]!, d = c > 0 ? c : rr, yFirst = k % 2 === 0; // the walk comes into the top left and the bottom right along y
    const a = yFirst ? [cx, cy + dy * d] : [cx + dx * d, cy], b = yFirst ? [cx + dx * d, cy] : [cx, cy + dy * d];
    if (d <= 0) { out.push(new Vector2(cx, -cy)); return; }
    if (c > 0) { out.push(new Vector2(a[0]!, -a[1]!), new Vector2(b[0]!, -b[1]!)); return; }
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, u = 1 - t;
      out.push(new Vector2(u * u * a[0]! + 2 * u * t * cx + t * t * b[0]!, -(u * u * a[1]! + 2 * u * t * cy + t * t * b[1]!)));
    }
  });
  return out;
}

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const growCuts = (c: Cuts, e: number): Cuts => c.map((v) => (v > 0 ? Math.max(1, v + e * 0.6) : 0)) as Cuts;
const shapeOf = (pts: Vector2[], holes: Vector2[][] = []): Shape => {
  const s = new Shape(pts);
  for (const h of holes) s.holes.push(new Path(h));
  return s;
};

/** A flat shape extruded from depth z0 to z1, its edges rounded by `bevel` inside its outline. */
export function slab(shape: Shape, z0: number, z1: number, m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (z1 - z0) / 2.2));
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z0 + b);
  return place(new Mesh(g, m));
}

/** A ring: the outline of `r` grown by `e`, less `r` itself (a bezel, a trim line, a light frame), `z0` to `z1`. */
function ring(r: RectLike, rad: number, cuts: Cuts, e: number, z0: number, z1: number, m: Material, inset = 0): Mesh {
  const inner = grow(r, -inset);
  return slab(shapeOf(outlinePts(grow(r, e), rad + e, isCut(cuts) ? growCuts(cuts, e) : NONE), [outlinePts(inner, Math.max(0, rad - inset), isCut(cuts) ? growCuts(cuts, -inset) : NONE)]), z0, z1, m);
}

/** A flat textured face over a layout rect at depth z (a decal on the side panel). */
function decal(r: RectLike, z: number, m: Material): Mesh {
  const o = new Mesh(new PlaneGeometry(r.w, r.h), m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z);
  o.receiveShadow = true;
  return o;
}

// ---------------------------------------------------------------- textures (painted once, shared by every rebuild)
const TEX = new Map<string, Texture | null>();
function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture | null {
  if (TEX.has(key)) return TEX.get(key)!;
  let t: Texture | null = null;
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d')!, w, h);
    t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = RepeatWrapping;
  }
  TEX.set(key, t);
  return t;
}

/** A sheet with holes cut through it (white, so the material tints it): round holes in staggered rows, a honeycomb, or a diamond mesh. */
function perforation(kind: 'round' | 'hex' | 'mesh'): Texture | null {
  return tex('perf-' + kind, 128, kind === 'mesh' ? 128 : 222, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    if (kind === 'round') for (const [x, y] of [[64, 55], [0, 166], [128, 166]]) { c.beginPath(); c.arc(x!, y!, 25, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'hex') {
      const s = 128 / Math.sqrt(3), hs = s - 17;
      for (const [x, y] of [[64, s * 0.5], [0, s * 2], [128, s * 2], [64, s * 3.5]]) {
        c.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(x! + Math.cos(a) * hs, y! + Math.sin(a) * hs); }
        c.fill();
      }
    } else for (const [x, y] of [[64, 64], [0, 0], [128, 0], [0, 128], [128, 128]]) { c.beginPath(); c.moveTo(x!, y! - 52); c.lineTo(x! + 52, y!); c.lineTo(x!, y! + 52); c.lineTo(x! - 52, y!); c.fill(); }
  });
}

/** A perforated plate over `r` at depth z with a dark backing a little behind it (the holes show the dark), `pitch` units per hole. */
function perforated(g: Group, r: RectLike, z: number, kind: 'round' | 'hex' | 'mesh', pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): void {
  const t = perforation(kind)?.clone() ?? null;
  if (t) { t.needsUpdate = true; t.repeat.set(r.w / pitch, r.h / (pitch * (kind === 'mesh' ? 1 : 1.73))); }
  g.add(decal(r, z, mat(0x040506, { roughness: 0.9 })));
  g.add(decal(r, z + 5, mat(tone, { map: t, alphaTest: 0.5, metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.5 })));
}

/** The pipeline mark (four rising bars on a foot) and a word, painted for a badge: `ink` the bars, `acc` the last bar. */
function badgeTex(key: string, w: number, h: number, word: string, ink: string, acc: string, bg: string | null, mark = true): Texture | null {
  return tex('badge-' + key, w, h, (c) => {
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); }
    const s = h * 0.5, bw = s * 0.17, gap = s * 0.07, x0 = word ? w * 0.12 : (w - 4 * bw - 3 * gap) / 2, y0 = (h - s) / 2;
    if (mark) {
      for (let k = 0; k < 4; k++) { const bh = s * (0.34 + k * 0.2); c.fillStyle = k === 3 ? acc : ink; c.fillRect(x0 + k * (bw + gap), y0 + s - bh, bw, bh); }
      c.fillStyle = ink; c.fillRect(x0 - gap, y0 + s + gap, 4 * bw + 4 * gap, s * 0.07);
    }
    if (word) {
      c.fillStyle = ink; c.textBaseline = 'middle'; c.textAlign = mark ? 'left' : 'center';
      c.font = `700 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
      c.fillText(word, mark ? x0 + 4 * bw + 4 * gap + w * 0.06 : w / 2, h / 2 + h * 0.02);
    }
  });
}

/**
 * The accent strip's light by the machine's state (`drawStrip` in 2D): off dark, idle a dim cyan, halted a steady amber, working a slow
 * breath, an error blinks red, a dead board a dim red. `wall`: wall time in ms (an alarm must not stop on a pause).
 */
export function stripLight(m: MeshStandardMaterial, mode: StripMode, wall: number): void {
  const T = STRIP_T, col = mode === 'error' || mode === 'dead' ? T.bad : mode === 'halt' ? T.ld : T.alu;
  m.emissive.set(col);
  m.emissiveIntensity = mode === 'off' ? 0 : mode === 'idle' ? 0.7 : mode === 'halt' ? 1.2 : mode === 'dead' ? 0.6
    : mode === 'error' ? (Math.floor(wall / 420) % 2 ? 2.4 : 0.3) : 1.2 + Math.sin(wall / 420) * 0.8;
}
const STRIP_T = builtinTheme(true);

// ---------------------------------------------------------------- the case

/** The case of this kind round the current layout (`CASE`, `CASE_IN`, the tier's window): body, feet, front, side panel, glass and lights. */
export function caseModel(kind: CaseKind, T: Theme): CaseModel {
  const L = LOOKS[kind], C = CASE, P = CASE_PANEL, gl = CASE_GLASS, ci = CASE_IN, bottom = C.y + C.h;
  const root = tag(new Group(), 'case'), side = new Group(), spins: Spin[] = [];
  const body = mat(L.body, { roughness: L.rough, metalness: L.metal }), inner = mat(L.inner, { roughness: 0.75, metalness: 0.15 });
  const dark = mat(0x050608, { roughness: 0.85 });
  const acc = kind === 'gamer' ? hex(T.mul) : kind === 'show' ? hex(T.br) : hex(T.alu);
  const cuts: Cuts = kind === 'gamer' ? [0, GAMER_CAP, 0, 0] : kind === 'show' ? CASE_CUTS.show : NONE;
  const outer = () => outlinePts(C, L.rad, cuts);
  const z1 = FRONT - SIDE_T;

  // the body: a shell round the cavity (top, floor, rear wall, front wall) and the back sheet the tray is on
  const cavity = { x: C.x + WALL_T, y: C.y + P.h, w: ci.x + ci.w - (C.x + WALL_T), h: bottom - 150 - (C.y + P.h) };
  root.add(slab(shapeOf(outer(), [outlinePts(cavity, 24)]), CASE_Z + 70, z1, body, 18));
  root.add(slab(shapeOf(outer()), CASE_Z, CASE_Z + 70, inner, 12));

  // the outer side panel: one sheet with the window cut out (the Mini's is solid)
  const win = kind === 'oem' ? null : caseWindow(kind), wcuts: Cuts = WINDOW_CUTS[kind], wr = kind === 'show' ? 0 : kind === 'gamer' ? 24 : 50;
  const winPts = win ? outlinePts(win, wr, wcuts) : null;
  // (the Mini's plastic front wraps round the front edge: its sheet stops short of it)
  const sheet = kind === 'oem' ? outlinePts({ ...C, w: C.w - OEM_BEZEL }, L.rad) : outer();
  side.add(slab(shapeOf(sheet, winPts ? [winPts] : []), z1, FRONT, kind === 'show' ? mat(0x111216, { roughness: 0.3, metalness: 0.55 }) : body, 14));
  let glass: Mesh | null = null;
  if (win && winPts && L.glass) {
    glass = new Mesh(new ShapeGeometry(shapeOf(winPts), 6), new MeshStandardMaterial({ color: L.glass.color, transparent: true, opacity: L.glass.opacity, roughness: 0.03, metalness: 0.6, envMapIntensity: 2.5, depthWrite: false }));
    glass.position.z = FRONT - SIDE_T / 2;
    glass.castShadow = false;
    // faint diagonal reflections across the glass (the 2D's), where they fit inside the window
    const sheen = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: kind === 'matte' ? 0.016 : 0.024, depthWrite: false });
    for (const [x0, w] of [[0.36, 0.08], [0.47, 0.018], [0.86, 0.055]] as const) {
      const a = win.x + win.w * x0, b = a + win.w * w, run = win.h * 0.3, y0 = win.y + 60, y1 = win.y + win.h - 60;
      if (a - run < win.x + 100 || b > win.x + win.w - 100) continue;
      const q = [[a, y0], [b, y0], [b - run, y1], [a - run, y1]].map(([x, y]) => new Vector2(x!, -y!));
      const m = new Mesh(new ShapeGeometry(shapeOf(q)), sheen);
      m.position.z = FRONT - SIDE_T / 2 + 2;
      side.add(m);
    }
  }

  // the lower panel over the PSU bay: its intake and the maker's badge (east of it, as in 2D)
  const lowY = gl.y + gl.h, intake = { x: PSU.x + 120, y: PSU.y + 60, w: 3300, h: PSU.h - 120 };
  const area = { x: intake.x + intake.w + 260, y: PSU.y + 60, w: ci.x + ci.w - 300 - (intake.x + intake.w + 260), h: PSU.h - 120 };
  const right = area.x + area.w, cy = area.y + area.h / 2;
  const nv = CASE_LOOK[LAYOUT_CASE]?.vents ?? 16;

  // the front rim: a slim vent column and the accent strip (the machine's state, `stripModeOf`)
  const st = stripRect(), rim = kind === 'oem' ? FRONT + 12 : FRONT; // (on the Mini's plastic front)
  const slotsAt = [];
  for (let y = st.y0 + 260; y + 120 < st.y1; y += 215) slotsAt.push({ x: st.x + 70, y: -(y + 60), z: rim + 1, sx: 16, sy: 120, sz: 4 });
  (kind === 'oem' ? root : side).add(instanced(new BoxGeometry(1, 1, 1), dark, slotsAt));
  const strip = glowMat(acc, 0x0b0c10);
  root.add(seeThrough(rectBox({ x: st.x, y: st.y0, w: st.w, h: st.y1 - st.y0 }, rim - 4, rim + 6, strip)));

  if (kind === 'oem') {
    // a pressed panel over the board's side, a vent patch over the CPU, a screw in each corner, the seam to the PSU bay, a label
    const r = { x: ci.x, y: gl.y, w: ci.w, h: gl.h }, pressed = { x: r.x + 60, y: r.y + 50, w: r.w - 120, h: r.h - 100 };
    side.add(softBox(pressed, FRONT - 10, FRONT + 14, mat(0xe3dcc0, { roughness: 0.55 }), 12));
    const v = { x: caseWindow('oem').x + 700, y: r.y + r.h / 2 - 760, w: 1500, h: 1500 };
    side.add(softBox(grow(v, 30), FRONT + 8, FRONT + 18, mat(0xc2b994, { roughness: 0.6 }), 10));
    perforated(side, v, FRONT + 20, 'round', 52, 0xcfc6a3, { metal: 0.05, rough: 0.6 });
    const screw = mat(0xb9b29a, { metalness: 0.6, roughness: 0.35 });
    for (const [x, y] of [[r.x + 120, r.y + 110], [r.x + r.w - 120, r.y + 110], [r.x + 120, r.y + r.h - 110], [r.x + r.w - 120, r.y + r.h - 110]] as const) {
      side.add(drum(x, y, FRONT + 10, FRONT + 34, 46, screw, 18), rectBox({ x: x - 32, y: y - 6, w: 64, h: 12 }, FRONT + 34, FRONT + 37, dark));
    }
    side.add(rectBox({ x: ci.x + 40, y: lowY + 40, w: ci.w - 80, h: 14 }, FRONT - 2, FRONT + 1, mat(0x8f8768, { roughness: 0.7 })));
    perforated(side, intake, FRONT + 2, 'round', 64, 0xbfb695, { metal: 0.05, rough: 0.6 });
    const label = { x: right - 700, y: cy - 150, w: 700, h: 300 };
    side.add(softBox(label, FRONT - 4, FRONT + 8, mat(0xc9c0a0, { roughness: 0.5 }), 8));
    side.add(decal(grow(label, -20), FRONT + 9, mat(0xffffff, { map: badgeTex('oem', 512, 220, 'PC-1', '#4a4636', '#4a4636', '#cbc3a3'), roughness: 0.5 })));
    // the top strip's vents; the plastic front with two drive-bay covers and its grille; round feet
    for (let k = 0; k < nv; k++) side.add(softBox({ x: -2250 + k * 78, y: P.y + 120, w: 30, h: 190 }, FRONT - 4, FRONT + 2, mat(0x8a8468, { roughness: 0.8 }), 12));
    const bezel = mat(0xd3caa9, { roughness: 0.65 }), ex = C.x + C.w;
    root.add(softBox({ x: ex - OEM_BEZEL, y: C.y - 8, w: OEM_BEZEL + 50, h: C.h + 16 }, CASE_Z + 10, FRONT + 12, bezel, 44));
    const zc = CASE_Z + CASE_D / 2;
    for (let k = 0; k < 2; k++) {
      root.add(rectBox({ x: ex + 46, y: C.y + 520 + k * 470, w: 22, h: 420 }, zc - 740, zc + 740, mat(0xc8bf9c, { roughness: 0.6 })));
      root.add(rectBox({ x: ex + 66, y: C.y + 720 + k * 470, w: 6, h: 16 }, zc - 600, zc + 600, mat(0xa59d7d, { roughness: 0.7 })));
    }
    root.add(instanced(new BoxGeometry(1, 1, 1), mat(0x6e6852, { roughness: 0.8 }), Array.from({ length: 9 }, (_, k) => ({ x: ex + 52, y: -(bottom - 1300 + k * 110), z: zc, sx: 6, sy: 40, sz: 1800 }))));
    const foot = mat(0x2a2924, { roughness: 0.9 });
    for (const x of [C.x + 400, ex - 400]) for (const z of [CASE_Z + 420, FRONT - 420]) root.add(post(x, bottom + FOOT, z, 110, FOOT, foot, 20, 95));
  }

  if (kind === 'matte') {
    // one sheet: a smoked window over the upper part in a dark gasket, a debossed mark, the intake, the vents; rubber rails for feet
    side.add(ring(win!, wr, NONE, 16, FRONT - 2, FRONT + 3, mat(0x050507, { roughness: 0.6 })));
    const bars = [0, 1, 2, 3].map((k) => ({ x: right - 300 + k * 24, y: cy - 60 + 100 * (0.66 - k * 0.2), w: 17, h: 100 * (0.34 + k * 0.2) }));
    for (const b of bars) {
      side.add(rectBox({ ...b, y: b.y + 5 }, FRONT, FRONT + 1, mat(0x2c2e35, { roughness: 0.9 })));
      side.add(rectBox(b, FRONT, FRONT + 2, mat(0x08090b, { roughness: 0.95 })));
    }
    perforated(side, intake, FRONT + 2, 'round', 64, 0x1b1c21, { metal: 0.1, rough: 0.85 });
    for (let k = 0; k < nv; k++) side.add(softBox({ x: -2250 + k * 78, y: P.y + 120, w: 30, h: 190 }, FRONT - 4, FRONT + 1, dark, 12));
    const rubber = mat(0x0c0c0e, { roughness: 0.95 });
    for (const x of [C.x + 300, C.x + C.w - 600]) root.add(softBox({ x, y: bottom - 10, w: 300, h: FOOT + 10 }, CASE_Z + 260, FRONT - 260, rubber, 30));
  }

  if (kind === 'gamer') {
    // the mesh cap on the cut corner, slanted vents along the top strip, a bezel round the cut-corner window, multi-zone RGB under the glass,
    // the lit logo plate, splayed feet
    const len = GAMER_CAP * Math.SQRT2, d = CASE_D - 160, cx = C.x + C.w - GAMER_CAP / 2, cyw = -(C.y + GAMER_CAP / 2);
    const cap = new Group();
    cap.position.set(cx + 5, cyw + 5, CASE_Z + CASE_D / 2);
    cap.rotation.z = -Math.PI / 4;
    const t = perforation('mesh')?.clone() ?? null;
    if (t) { t.needsUpdate = true; t.repeat.set(len / 36, d / 36); }
    const capBack = new Mesh(new PlaneGeometry(len - 40, d), dark), capMesh = new Mesh(new PlaneGeometry(len - 40, d), mat(0x2a3042, { map: t, alphaTest: 0.5, metalness: 0.5, roughness: 0.45 }));
    capBack.rotation.x = capMesh.rotation.x = -Math.PI / 2;
    capBack.position.y = -4;
    cap.add(capBack, capMesh);
    for (const s of [-1, 1]) { const rail = place(new Mesh(new BoxGeometry(len, 24, 40), mat(0x262c3c, { metalness: 0.6, roughness: 0.35 }))); rail.position.z = (s * d) / 2; cap.add(rail); }
    root.add(cap);
    const lean = 70, pitch = 78, sw = pitch * 0.5, sh = 200, par = new Shape([new Vector2(lean, 0), new Vector2(lean + sw, 0), new Vector2(sw, -sh), new Vector2(0, -sh)]);
    const sg = new ExtrudeGeometry(par, { depth: 6, bevelEnabled: false });
    side.add(instanced(sg, dark, Array.from({ length: nv }, (_, k) => ({ x: -2250 + k * pitch, y: -(P.y + 110), z: FRONT - 4 }))));
    side.add(ring(win!, wr, wcuts, 34, FRONT - 2, FRONT + 16, mat(0x161b27, { metalness: 0.5, roughness: 0.35 })));
    side.add(ring(win!, wr, wcuts, 6, FRONT + 16, FRONT + 20, mat(0x3a4256, { metalness: 0.7, roughness: 0.3 })));
    const ly = win!.y + win!.h - 70, lx0 = win!.x + 140, lw = win!.w - 280, hues = [0xff4d6d, 0xffb84d, 0x7dff4d, 0x4dd2ff, 0x6a4dff, 0xff4dd2];
    hues.forEach((h, k) => {
      const m = glowMat(h, 0x15171d);
      side.add(rectBox({ x: lx0 + (k * lw) / hues.length + 6, y: ly, w: lw / hues.length - 12, h: 26 }, z1 - 30, z1 - 4, m));
      spins.push(light(m, h, 2.4));
    });
    perforated(side, intake, FRONT + 2, 'round', 64, 0x232938, { metal: 0.5, rough: 0.4 });
    const plate = { x: right - 1100, y: cy - 190, w: 1100, h: 380 };
    const rim = glowMat(acc, 0x15121f);
    side.add(ring(plate, 28, NONE, 14, FRONT - 2, FRONT + 20, rim));
    spins.push(light(rim, acc, 2));
    side.add(softBox(plate, FRONT - 2, FRONT + 18, mat(0x0d1018, { roughness: 0.4, metalness: 0.4 }), 10));
    const logo = mat(0xffffff, { map: badgeTex('gamer', 640, 220, 'TIER 3', '#e8ecf8', T.mul, '#0d1018'), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4 });
    logo.emissiveMap = logo.map;
    side.add(decal(grow(plate, -30), FRONT + 19, logo));
    spins.push(light(logo, 0xffffff, 0.6));
    feet(root, 520, 0x1a1e28, null);
  }

  if (kind === 'show') {
    // graphite bezel, a silver trim and a light round the chamfered window, silver pillars with lit slots, rails above and below, machined
    // corner plates, lit fan windows on the top rail, hex mesh, two angled name plates, splayed feet on silver plates
    const silver = mat(SILVER.color, { metalness: SILVER.metalness, roughness: SILVER.roughness }), bz = 44;
    side.add(ring(win!, wr, wcuts, bz, FRONT - 2, FRONT + 14, mat(0x101115, { metalness: 0.5, roughness: 0.3 })));
    side.add(ring(win!, wr, wcuts, 14, FRONT + 14, FRONT + 22, silver));
    const edge = glowMat(acc, 0x1a1016), pts = outlinePts(grow(win!, -26), 0, growCuts(wcuts, -26));
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]!; side.add(seeThrough(rod([p.x, p.y, z1 - 10], [q.x, q.y, z1 - 10], 9, edge, 6))); });
    spins.push(light(edge, acc, 2.6));
    const pil = showPillars(win!, bz), py = pil[0].y, ph = pil[0].h;
    for (const r of [{ x: win!.x - bz - 20, y: py, w: win!.w + 2 * bz + 40, h: 130 }, { x: win!.x - bz - 20, y: py + ph - 130, w: win!.w + 2 * bz + 40, h: 130 }]) side.add(softBox(r, FRONT - 2, FRONT + 34, silver, 12));
    const slot = glowMat(acc, 0x1a1016);
    for (const r of pil) {
      side.add(softBox(r, FRONT - 2, FRONT + 52, silver, 18));
      side.add(rectBox({ x: r.x + r.w / 2 - 3, y: r.y, w: 6, h: r.h }, FRONT + 52, FRONT + 54, dark));
      const px = r.x + r.w / 2 + r.w * 0.2, sh = ph - 520;
      side.add(rectBox({ x: px - 10, y: py + 270, w: 20, h: sh - 20 }, FRONT + 46, FRONT + 54, dark));
      side.add(rectBox({ x: px - 5, y: py + 285, w: 10, h: sh - 50 }, FRONT + 48, FRONT + 56, slot));
    }
    spins.push(light(slot, acc, 2.4));
    const plateM = mat(0x121418, { metalness: 0.5, roughness: 0.35 }), off = 90;
    for (const [bx, by, dx, dy, cut] of [[C.x + 16, C.y + 16, 1, 1, cuts[0]], [C.x + C.w - 16, C.y + 16, -1, 1, cuts[1]], [C.x + 16, bottom - 16, 1, -1, cuts[3]], [C.x + C.w - 16, bottom - 16, -1, -1, cuts[2]]] as const) {
      const ax = bx + dx * cut, bY = by + dy * cut, ox = dx * off, oy = dy * off;
      const q = [[ax, by], [bx, bY], [bx + ox, bY + oy * 0.6], [ax + ox * 0.6, by + oy]].map(([x, y]) => new Vector2(x!, -y!));
      side.add(slab(shapeOf(q), FRONT - 2, FRONT + 24, plateM, 6));
      side.add(drum((ax + bx) / 2 + ox * 0.55, (by + bY) / 2 + oy * 0.55, FRONT + 24, FRONT + 34, 24, silver, 14));
    }
    const fanLit = glowMat(acc, 0x1a1016);
    for (const f of TOP_FANS) {
      const r = { x: f.x + 130, y: P.y + 110, w: f.w - 260, h: 210 };
      side.add(slab(shapeOf(outlinePts(grow(r, 10), r.h / 2 + 10)), FRONT - 2, FRONT + 12, silver, 4));
      side.add(slab(shapeOf(outlinePts(r, r.h / 2)), FRONT + 12, FRONT + 14, dark));
      side.add(rectBox({ x: r.x + 30, y: r.y + r.h * 0.56, w: r.w - 60, h: r.h * 0.2 }, FRONT + 14, FRONT + 18, fanLit));
    }
    spins.push(light(fanLit, acc, 2.2));
    perforated(side, intake, FRONT + 4, 'hex', 46, 0x5a5f69, { metal: 0.5, rough: 0.4 });
    side.add(ring(intake, 20, NONE, 16, FRONT - 2, FRONT + 8, silver));
    const pw = 900, lean = 120, line = glowMat(acc, 0x1a1016);
    for (const k of [0, 1] as const) {
      const x = right - (2 - k) * pw - (1 - k) * 120, y = area.y + 140, h = area.h - 280;
      const q = [[x + lean, y], [x + pw, y], [x + pw - lean, y + h], [x, y + h]].map(([a, b]) => new Vector2(a!, -b!));
      side.add(slab(shapeOf(q), FRONT - 2, FRONT + 18, mat(0x0e0f12, { metalness: 0.5, roughness: 0.35 }), 4));
      side.add(rectBox({ x: x + lean + 30, y: y + 20, w: pw - lean - 60, h: 8 }, FRONT + 18, FRONT + 22, line));
      const face = mat(0xffffff, { map: badgeTex(k ? 'show-name' : 'show-mark', 512, 256, k ? 'PC-4' : '', '#eef1f9', T.br, null, !k), transparent: true, roughness: 0.4 });
      side.add(decal({ x: x + lean / 2 + 60, y: y + 40, w: pw - lean - 120, h: h - 60 }, FRONT + 19, face));
    }
    spins.push(light(line, acc, 2.4));
    feet(root, 600, 0x14161b, silver);
  }

  // the top's dust filter over the top fans (the cases that have them)
  if (TOP_FANS.length) {
    const x0 = TOP_FANS[0]!.x - 60, x1 = TOP_FANS[TOP_FANS.length - 1]!.x + TOP_FANS[0]!.w + 60, zc = CASE_Z + CASE_D / 2, w = CASE_D - 900;
    const r = { x: x0, y: 0, w: x1 - x0, h: w }, frame = kind === 'show' ? mat(SILVER.color, { metalness: SILVER.metalness, roughness: SILVER.roughness }) : body;
    const t = perforation(kind === 'show' ? 'hex' : 'mesh')?.clone() ?? null;
    if (t) { t.needsUpdate = true; t.repeat.set(r.w / 44, r.h / 44); }
    const plate = new Mesh(new PlaneGeometry(r.w, r.h), mat(kind === 'show' ? 0x3a3e46 : 0x1a1c22, { map: t, alphaTest: 0.5, metalness: 0.3, roughness: 0.7 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x0 + r.w / 2, -C.y + 3, zc);
    const back = new Mesh(new PlaneGeometry(r.w, r.h), dark);
    back.rotation.x = -Math.PI / 2;
    back.position.set(x0 + r.w / 2, -C.y + 1, zc);
    root.add(back, plate);
    for (const z of [zc - w / 2 - 30, zc + w / 2 + 30]) root.add(rectBox({ x: x0 - 30, y: C.y - 10, w: r.w + 60, h: 14 }, z - 30, z + 30, frame));
  }

  for (const o of side.children) seeThrough(o);
  return { root, side, glass, spins, strip, rgb: L.rgb, inner: L.inner, shroud: L.shroud };

  /** Splayed feet along the case's depth (a dark wedge, a lit top line), on a silver plate for the showcase. */
  function feet(g: Group, fw: number, tone: number, plate: Material | null) {
    const m = mat(tone, { metalness: 0.5, roughness: 0.4 }), fh = plate ? FOOT - 22 : FOOT, splay = 100;
    for (const fx of [C.x + 300, C.x + C.w - 300 - fw]) {
      const q = [[fx + 40, bottom - 20], [fx + fw - 40, bottom - 20], [fx + fw + splay, bottom + fh], [fx - splay, bottom + fh]].map(([x, y]) => new Vector2(x!, -y!));
      g.add(slab(shapeOf(q), CASE_Z + 200, FRONT - 200, m, 10));
      if (plate) g.add(softBox({ x: fx - splay - 20, y: bottom + fh, w: fw + 2 * splay + 40, h: FOOT - fh }, CASE_Z + 160, FRONT - 160, plate, 8));
    }
  }
}
