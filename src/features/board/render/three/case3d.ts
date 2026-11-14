// The PC case in 3D (docs/render/case.md "Four real cases"): the 2D's four cases, each a real box over its side-view outline. Mini a cream OEM
// tower (a solid side with a pressed panel, a vent patch, screws, a label, round feet, a plastic front with bay covers), Micro a matte black
// tower (a tinted window over the upper part, a debossed logo, rubber rails), Mid a gaming case (a cut-corner window in a bezel, a mesh cap on
// the top front corner, slanted vents, one violet strip under the glass, a debossed logo plate, two rubber rails), Full a dark monolith (a
// charcoal box with one smoked glass, a debossed mark, a flat graphite plinth, a hex mesh intake and filter).
// The body (`root`: top, floor, the rear and front walls, the back sheet, feet, controls) stays; the outer side panel (`side`: the sheet, its
// window, trim and lights) hangs in `door`, which machine3d.ts swings open (`doorPose`, casedoor.ts). The working details are in casedetail3d.ts.
import {
  AddEquation, BoxGeometry, CustomBlending, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Shape, ShapeGeometry, Vector2,
  type Material, type Object3D,
} from 'three';
import { instanced, place, post, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { builtinTheme, type Theme } from '@/core/render/theme';
import { CASE_D, CASE_Z, FAN_MAX } from '@/features/room/render/three/roomplan';
import { CASE_LOOK } from '@/features/room/render/desk/props/case';
import { CASE_CUTS, WINDOW_CUTS, caseWindow, type CaseKind, type Cuts } from '@/features/room/render/shell/casedecor';
import { stripRect, type StripMode } from '@/features/room/render/shell/exterior';
import { frontFanRects } from '@/features/room/render/desk/props/case';
import { CASE, CASE_GLASS, CASE_IN, CASE_PANEL, FOOT, LAYOUT_CASE, PCIE_RAILS, PSU, TOP_FANS } from '../layout/layout';
import { basementPlan } from './basement3d';
import { glowMat, light, type Spin } from './fans3d';
import {
  FRONT, NONE, SIDE_T, badgeTex, brushed, clipY, decal, decalTop, decalX, foldCaseLooks, grain, grow, hex, outlinePts, perfMat, perforated, perforation, ring, screws as screwHeads, shapeOf, slab, slabWithOpening,
  thumbscrews, tiled, wallX, type Span,
} from './casekit3d';
import { bayFrame, controls, fanMountPlates, frontWall, hinges, psuFilter, psuIntake, rearWall, type Controls, type Frame } from './casedetail3d';
import { doorInner, frameDetail, rivetM, screwM, traySheet, trayDetail } from './casetray3d';

export { outlinePts, SIDE_T } from './casekit3d';

/**
 * Each kind's materials and shape: the body's colour and finish, the inside's tone, how round the body is, the glass (the share of the light
 * through it that its tint takes), the shroud's print.
 */
const LOOKS: Record<CaseKind, { body: number; rough: number; metal: number; inner: number; rad: number; glass: { tint: number } | null; shroud: { body: number; ink: string }; rgb: boolean }> = {
  oem: { body: 0xdcd4b5, rough: 0.6, metal: 0.04, inner: 0xcbc2a1, rad: 30, glass: null, shroud: { body: 0xcfc6a5, ink: '#5c5642' }, rgb: false },
  matte: { body: 0x17181c, rough: 0.88, metal: 0.08, inner: 0x111215, rad: 80, glass: { tint: 0.5 }, shroud: { body: 0x15161a, ink: '#5d626d' }, rgb: false },
  gamer: { body: 0x1d2232, rough: 0.38, metal: 0.55, inner: 0x121621, rad: 56, glass: { tint: 0.12 }, shroud: { body: 0x1b2030, ink: '#c9ced6' }, rgb: true },
  show: { body: 0x1d1e22, rough: 0.4, metal: 0.6, inner: 0x0c0d10, rad: 20, glass: { tint: 0.25 }, shroud: { body: 0x1a1c21, ink: '#d8dce4' }, rgb: true },
};

/**
 * A window's glass: clear, so it adds no light of its own (a pale glass lit by a lamp hung a milky veil over the board), only its reflections
 * (a glass's 4 %, more toward grazing); its tint takes `tint` of the light through it. The reflections add whole (they are not the tint's share).
 */
function glassMat(tint: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, opacity: tint, depthWrite: false,
    blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
  });
}
/** The gaming case's top front corner is cut at 45 degrees and carries a mesh cap. */
const GAMER_CAP = 360;
/** The Mini's plastic front: how far it reaches back over the side, from the front edge. */
const OEM_BEZEL = 170;

export interface CaseModel {
  /** The body, the feet and the front, tagged `case`: always shown. */
  root: Group;
  /** The outer side panel with its window, glass, trim and lights (never a hit target but through `hit`). */
  side: Group;
  /** The panel's pivot on its front edge (x `px`, depth `FRONT`): the opening moves and turns it. */
  door: Group;
  px: number;
  /** The unseen plate over the shut side that a click opens the case by (`case.side`). */
  hit: Mesh;
  /** The Mini's thumbscrews in its panel's rear flange (they turn out before it opens). */
  screws: Object3D[];
  glass: Mesh | null;
  /** The power button (`power`) and the lights on the case: on, error, drive activity. */
  power: Group;
  leds: Controls['leds'];
  /** The lights that follow the fans (a `Spin` with nothing to turn). */
  spins: Spin[];
  /** The accent strip on the front rim: the live frame colours it by the machine's state (`stripModeOf`). */
  strip: MeshStandardMaterial;
  /** Whether the inside has RGB (the case fans' rings, the light strips, the coloured fill). */
  rgb: boolean;
  /** The case's accent colour: its lit trim, and the RGB's one colour. */
  accent: number;
  /** The inside's tone (the tray) and the shroud's (its print's ink). */
  inner: number;
  shroud: { body: number; ink: string };
  /** The kind's rivets and screws, for what goes in the case (the basement). */
  rivet: Material;
  screw: Material;
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

/** The light strips along the inside of the top and the front: RGB in the gaming case (the accent), the violet in the showcase, none in the plain cases. */
export function innerStrips(kind: CaseKind, cm: Pick<CaseModel, 'rgb' | 'accent'>): { roots: Mesh[]; spins: Spin[] } {
  const roots: Mesh[] = [], spins: Spin[] = [], gl = CASE_GLASS;
  if (cm.rgb) for (const r of [{ x: gl.x + 200, y: gl.y + 40, w: gl.w - 400, h: 50 }, { x: gl.x + gl.w - 90, y: gl.y + 300, w: 50, h: gl.h - 600 }]) {
    const m = glowMat(cm.accent);
    roots.push(seeThrough(rectBox(r, FRONT - 400, FRONT - 340, m)));
    spins.push(kind === 'show' ? light(m, cm.accent, 2) : light(m));
  }
  return { roots, spins };
}

// ---------------------------------------------------------------- the case

/** The opening in the top over the top fans (layout x and depth), or null: the case has none there. */
function topVent(): { x0: number; x1: number; z0: number; z1: number } | null {
  if (!TOP_FANS.length) return null;
  const zc = CASE_Z + CASE_D / 2, w = CASE_D - 1600;
  return { x0: TOP_FANS[0]!.x - 60, x1: TOP_FANS[TOP_FANS.length - 1]!.x + TOP_FANS[0]!.w + 60, z0: zc - w / 2, z1: zc + w / 2 };
}

/** The case of this kind round the current layout (`CASE`, `CASE_IN`, the tier's window): body, feet, front, side panel, glass and lights. */
export function caseModel(kind: CaseKind, T: Theme): CaseModel {
  const L = LOOKS[kind], C = CASE, P = CASE_PANEL, gl = CASE_GLASS, ci = CASE_IN, bottom = C.y + C.h;
  const root = tag(new Group(), 'case'), side = new Group(), spins: Spin[] = [], ex = C.x + C.w;
  // painted and powder-coated steel has a fine grain; the showcase's graphite is brushed
  const finish = kind === 'show' ? { map: tiled(brushed(), 6, 6) } : { bumpMap: tiled(grain(), 24, 24), bumpScale: kind === 'matte' ? 1.4 : 0.6 };
  const body = mat(L.body, { roughness: L.rough, metalness: L.metal, ...finish }), inner = mat(L.inner, { roughness: 0.75, metalness: 0.15 });
  const dark = mat(0x050608, { roughness: 0.85 });
  const acc = kind === 'gamer' || kind === 'show' ? hex(T.mul) : hex(T.alu);
  const cuts: Cuts = kind === 'gamer' ? [0, GAMER_CAP, 0, 0] : kind === 'show' ? CASE_CUTS.show : NONE;
  const outer = () => outlinePts(C, L.rad, cuts);
  const z1 = FRONT - SIDE_T;

  // the body: the top and the floor (the outline above and below the cavity, cut open over the top fans and under the power supply), the rear and
  // front walls with their openings, the back sheet
  const f: Frame = { kind, body, acc, yTop: C.y + P.h, yBot: bottom - 150, z0: CASE_Z + 70, z1 };
  const topPts = clipY(outer(), -f.yTop, 1), vent = topVent();
  if (vent) root.add(...slabWithOpening(topPts, f.z0, z1, vent, body)); else root.add(slab(shapeOf(topPts), f.z0, z1, body, 18));
  root.add(...slabWithOpening(clipY(outer(), -f.yBot, -1), f.z0, z1, psuIntake(), body));
  root.add(rearWall(f, PCIE_RAILS.length), frontWall(f, spins, ex), psuFilter(f, bottom), traySheet(f, outer(), inner), trayDetail(f, inner), fanMountPlates(inner));
  // the door's hooks along the top rail, clear of the cut corners, and where they go into the frame's rim
  const hookY = (C.y + f.yTop) / 2, hookX = [C.x + C.w * 0.2, C.x + C.w * 0.45, C.x + C.w * 0.68];
  root.add(frameDetail(f, ex, hookX, hookY));
  const ctl = controls(f, ex, GAMER_CAP);
  root.add(ctl.root);
  spins.push(...ctl.spins);
  if (kind === 'gamer' || kind === 'show') root.add(hinges(ex, f.yTop, f.yBot));

  // the outer side panel: one sheet with the window cut out (the Mini's is solid)
  const win = kind === 'oem' ? null : caseWindow(kind), wcuts: Cuts = WINDOW_CUTS[kind], wr = kind === 'gamer' || kind === 'show' ? 24 : 50;
  const winPts = win ? outlinePts(win, wr, wcuts) : null;
  // the lower panel over the basement: its intake over the shroud's vent span, a real opening under a punched sheet, the maker's badge over the supply's cover
  const plan = basementPlan(), lowY = gl.y + gl.h, intake = { x: plan.vent.x - 60, y: plan.top + 60, w: plan.vent.w + 120, h: plan.floor - plan.top - 120 };
  const area = { x: PSU.x + 120, y: plan.top + 60, w: plan.vent.x - 260 - (PSU.x + 120), h: plan.floor - plan.top - 120 };
  const right = area.x + area.w, cy = area.y + area.h / 2;
  const nv = CASE_LOOK[LAYOUT_CASE]?.vents ?? 16;
  // (the Mini's plastic front wraps round the front edge: its sheet stops short of it)
  const sheet = kind === 'oem' ? outlinePts({ ...C, w: C.w - OEM_BEZEL }, L.rad) : outer();
  const sheetM = body;
  side.add(slab(shapeOf(sheet, [...(winPts ? [winPts] : []), outlinePts(intake, 16)]), z1, FRONT, sheetM, 14));
  doorInner(side, kind === 'oem' ? { ...C, w: C.w - OEM_BEZEL } : C, L.rad, cuts, sheetM, hookX, hookY);
  let glass: Mesh | null = null;
  if (win && winPts && L.glass) {
    glass = new Mesh(new ShapeGeometry(shapeOf(winPts), 6), glassMat(L.glass.tint));
    glass.position.z = FRONT - SIDE_T / 2;
    glass.castShadow = false;
    // (no painted streaks, as the 2D has: the glass shows the room's own light, the window by day, the lamps and the city at night)
    side.add(glass);
  }

  // the front rim: a slim vent column and the accent strip (the machine's state, `stripModeOf`)
  const st = stripRect(), rim = kind === 'oem' ? FRONT + 12 : FRONT; // (on the Mini's plastic front)
  const slotsAt = [];
  for (let y = st.y0 + 260; y + 120 < st.y1; y += 215) slotsAt.push({ x: st.x + 70, y: -(y + 60), z: rim + 1, sx: 16, sy: 120, sz: 4 });
  (kind === 'oem' ? root : side).add(instanced(new BoxGeometry(1, 1, 1), dark, slotsAt));
  const strip = glowMat(acc, 0x0b0c10);
  (kind === 'oem' ? root : side).add(seeThrough(rectBox({ x: st.x, y: st.y0, w: st.w, h: st.y1 - st.y0 }, rim - 4, rim + 6, strip)));

  if (kind === 'oem') {
    // a pressed panel over the board's side, a vent patch over the CPU, a screw in each corner, the seam to the PSU bay, a label
    const r = { x: ci.x, y: gl.y, w: ci.w, h: gl.h }, pressed = { x: r.x + 60, y: r.y + 50, w: r.w - 120, h: r.h - 100 };
    side.add(softBox(pressed, FRONT - 10, FRONT + 14, mat(0xe3dcc0, { roughness: 0.55 }), 12));
    const v = { x: caseWindow('oem').x + 700, y: r.y + r.h / 2 - 760, w: 1500, h: 1500 };
    side.add(softBox(grow(v, 30), FRONT + 8, FRONT + 18, mat(0xc2b994, { roughness: 0.6 }), 10));
    perforated(side, v, FRONT + 20, 'round', 52, 0xcfc6a3, { metal: 0.05, rough: 0.6 });
    const corners = [[r.x + 120, r.y + 110], [r.x + r.w - 120, r.y + 110], [r.x + 120, r.y + r.h - 110], [r.x + r.w - 120, r.y + r.h - 110]] as const;
    side.add(screwHeads(corners.map(([x, y]) => ({ x, y: -y, z: FRONT + 14 })), 'z+', 62, mat(0xb9b29a, { metalness: 0.6, roughness: 0.35 })));
    side.add(rectBox({ x: ci.x + 40, y: lowY + 40, w: ci.w - 80, h: 14 }, FRONT - 2, FRONT + 1, mat(0x8f8768, { roughness: 0.7 })));
    side.add(decal(intake, FRONT + 2, perfMat('round', intake.w, intake.h, 64, 0xbfb695, { metal: 0.05, rough: 0.6 })));
    const label = { x: right - 700, y: cy - 150, w: 700, h: 300 };
    side.add(softBox(label, FRONT - 4, FRONT + 8, mat(0xc9c0a0, { roughness: 0.5 }), 8));
    side.add(decal(grow(label, -20), FRONT + 9, mat(0xffffff, { map: badgeTex('oem', 512, 220, 'PC-1', '#4a4636', '#4a4636', '#cbc3a3'), roughness: 0.5 })));
    // the top strip's vents; the plastic front with two drive-bay covers and its grille; round feet
    for (let k = 0; k < nv; k++) side.add(softBox({ x: -2250 + k * 78, y: P.y + 120, w: 30, h: 190 }, FRONT - 4, FRONT + 2, mat(0x8a8468, { roughness: 0.8 }), 12));
    const bezel = mat(0xd3caa9, { roughness: 0.65 }), ex = C.x + C.w;
    const zc = CASE_Z + CASE_D / 2;
    // the plastic front, with a round grille of slots cut through it over each front fan
    const grilleR = Math.min(frontFanRects()[0]!.h, FAN_MAX) * 0.45, slots: Span[] = [];
    for (const fan of frontFanRects()) for (let k = -6; k <= 6; k++) {
      const yc = fan.y + fan.h / 2 + k * 130, half = Math.sqrt(grilleR * grilleR - (k * 130) ** 2);
      slots.push({ y0: yc - 30, y1: yc + 30, z0: zc - half, z1: zc + half, r: 26 });
    }
    root.add(wallX(ex - OEM_BEZEL, ex + 50, { y0: C.y - 8, y1: C.y + C.h + 8, z0: CASE_Z + 10, z1: FRONT + 12, r: 40 }, slots, bezel));
    // two 5.25-inch bay blanks, each in its dark gap: a face with soft corners, a raised rim round a recessed panel, the release notch under it
    const blank = mat(0xcbc29f, { roughness: 0.6 }), gap = mat(0x34312a, { roughness: 0.9 });
    for (let k = 0; k < 2; k++) {
      const b: Span = { y0: C.y + 520 + k * 470, y1: C.y + 940 + k * 470, z0: zc - 740, z1: zc + 740, r: 12 }, inset = (e: number): Span => ({ y0: b.y0 + e, y1: b.y1 - e, z0: b.z0 + e, z1: b.z1 - e, r: 10 });
      root.add(wallX(ex + 48, ex + 52, inset(-14), [], gap), wallX(ex + 52, ex + 66, b, [], blank, 3), wallX(ex + 66, ex + 71, inset(34), [inset(64)], blank));
      root.add(rectBox({ x: ex + 62, y: b.y1 - 26, w: 10, h: 16 }, zc - 110, zc + 110, gap));
    }
    root.add(bayFrame());
    // the maker's badge over the bays
    const badge: Span = { y0: C.y + 220, y1: C.y + 390, z0: zc - 300, z1: zc + 300, r: 24 };
    root.add(wallX(ex + 50, ex + 58, badge, [], mat(0xc2b994, { roughness: 0.5 }), 2));
    root.add(decalX(ex + 59, { ...badge, y0: badge.y0 + 16, y1: badge.y1 - 16, z0: badge.z0 + 30, z1: badge.z1 - 30 }, 1, mat(0xffffff, { map: badgeTex('oem', 512, 220, 'PC-1', '#4a4636', '#4a4636', '#cbc3a3'), roughness: 0.5 })));
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
    side.add(decal(intake, FRONT + 2, perfMat('round', intake.w, intake.h, 64, 0x1b1c21, { metal: 0.1, rough: 0.85 })));
    for (let k = 0; k < nv; k++) side.add(softBox({ x: -2250 + k * 78, y: P.y + 120, w: 30, h: 190 }, FRONT - 4, FRONT + 1, dark, 12));
    const rubber = mat(0x0c0c0e, { roughness: 0.95 });
    for (const x of [C.x + 300, C.x + C.w - 600]) root.add(softBox({ x, y: bottom - 10, w: 300, h: FOOT + 10 }, CASE_Z + 260, FRONT - 260, rubber, 30));
  }

  if (kind === 'gamer') {
    // the mesh cap on the cut corner, slanted vents along the top strip, a bezel round the cut-corner window, one violet strip under the glass,
    // a debossed logo plate, two rubber rails
    const len = GAMER_CAP * Math.SQRT2, d = CASE_D - 160, cx = C.x + C.w - GAMER_CAP / 2, cyw = -(C.y + GAMER_CAP / 2);
    const cap = new Group();
    cap.position.set(cx + 5, cyw + 5, CASE_Z + CASE_D / 2);
    cap.rotation.z = -Math.PI / 4;
    const t = perforation('mesh')?.clone() ?? null;
    if (t) { t.needsUpdate = true; t.repeat.set(len / 36, d / 36); }
    const capBack = new Mesh(new PlaneGeometry(len - 40, d), dark), capMesh = new Mesh(new PlaneGeometry(len - 40, d), mat(0x2a3042, { map: t, alphaTest: 0.5, alphaToCoverage: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, metalness: 0.5, roughness: 0.45 }));
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
    const ly = win!.y + win!.h - 70, lx0 = win!.x + 140, lw = win!.w - 280, strip1 = glowMat(acc, 0x15121f);
    side.add(rectBox({ x: lx0, y: ly, w: lw, h: 26 }, z1 - 30, z1 - 4, strip1));
    spins.push(light(strip1, acc, 1.6));
    side.add(decal(intake, FRONT + 2, perfMat('round', intake.w, intake.h, 64, 0x232938, { metal: 0.5, rough: 0.4 })));
    const plate = { x: right - 1100, y: cy - 190, w: 1100, h: 380 };
    side.add(softBox(plate, FRONT - 2, FRONT + 18, mat(0x0d1018, { roughness: 0.4, metalness: 0.4 }), 10));
    // the four bars, debossed into the plate: a lit print over a dark one
    for (let k = 0; k < 4; k++) {
      const bh = 200 * (0.34 + k * 0.2), x = plate.x + plate.w / 2 - 89 + k * 48, y = plate.y + plate.h / 2 + 100 - bh;
      side.add(rectBox({ x, y: y + 5, w: 34, h: bh }, FRONT + 18, FRONT + 19, mat(0x2c2e35, { roughness: 0.9 })));
      side.add(rectBox({ x, y, w: 34, h: bh }, FRONT + 18, FRONT + 20, mat(0x08090b, { roughness: 0.95 })));
    }
    // two flat rubber rails, as on the matte case
    const rubber = mat(0x0c0c0e, { roughness: 0.95 });
    for (const x of [C.x + 300, C.x + C.w - 600]) root.add(softBox({ x, y: bottom - 10, w: 300, h: FOOT + 10 }, CASE_Z + 260, FRONT - 260, rubber, 30));
  }

  if (kind === 'show') {
    // a smoked glass in a thin dark gasket, a debossed four-bar mark, a hex mesh intake, a flat graphite plinth under the case
    side.add(ring(win!, wr, wcuts, 30, FRONT - 2, FRONT + 14, mat(0x101115, { metalness: 0.5, roughness: 0.3 })));
    const bars = [0, 1, 2, 3].map((k) => ({ x: right - 300 + k * 24, y: cy - 60 + 100 * (0.66 - k * 0.2), w: 17, h: 100 * (0.34 + k * 0.2) }));
    for (const b of bars) {
      side.add(rectBox({ ...b, y: b.y + 5 }, FRONT, FRONT + 1, mat(0x2c2e35, { roughness: 0.9 })));
      side.add(rectBox(b, FRONT, FRONT + 2, mat(0x08090b, { roughness: 0.95 })));
    }
    side.add(decal(intake, FRONT + 4, perfMat('hex', intake.w, intake.h, 46, 0x2a2d32, { metal: 0.5, rough: 0.4 })));
    root.add(softBox({ x: C.x + 250, y: bottom - 10, w: C.w - 500, h: FOOT + 10 }, CASE_Z + 250, FRONT - 250, mat(0x4e5360, { metalness: 0.5, roughness: 0.5 }), 30));
  }

  // the top's dust filter over the opening above the top fans (the cases that have them)
  if (vent) {
    const { x0, x1, z0, z1: ze } = vent, w = x1 - x0, h = ze - z0, frame = body;
    // a magnetic mesh: fine nylon on the plain cases (it must not catch the room's warm light), a hex mesh on the showcase
    root.add(decalTop(C.y - 3, x0, x1, z0, ze, kind === 'show' ? perfMat('hex', w, h, 70, 0x2a2d32, { metal: 0.5, rough: 0.45 }) : perfMat('mesh', w, h, 40, 0x15171b, { metal: 0.02, rough: 0.95 })));
    for (const z of [z0 - 30, ze + 30]) root.add(rectBox({ x: x0 - 60, y: C.y - 10, w: w + 120, h: 14 }, z - 30, z + 30, frame));
    for (const x of [x0 - 30, x1 + 30]) root.add(rectBox({ x: x - 30, y: C.y - 10, w: 60, h: 14 }, z0, ze, frame));
  }

  // the Mini's two thumbscrews hold its panel's rear flange, folded round onto the rear wall (each a group at the screw's axis: machine3d.ts
  // turns them out before the panel opens)
  const screws: Object3D[] = [], flange = { x: C.x - 12, y: C.y + 160, w: 12, h: bottom - C.y - 320 }, FL = 260;
  if (kind === 'oem') {
    const knurl = mat(0xb4ad94, { metalness: 0.6, roughness: 0.35 });
    side.add(rectBox(flange, FRONT - FL, FRONT, sheetM));
    for (const y of [C.y + 700, bottom - 700]) {
      const s = thumbscrews([{ x: 12, y: 0, z: 0 }], 'x-', 100, 96, knurl);
      s.position.set(C.x - 24, -y, FRONT - FL / 2);
      screws.push(s);
      side.add(s);
    }
  }
  // the back panel's flange and its two thumbscrews, on every case (black on the dark ones)
  const backKnurl = kind === 'oem' ? mat(0xb4ad94, { metalness: 0.6, roughness: 0.35 }) : mat(0x1b1c21, { metalness: 0.55, roughness: 0.4 });
  root.add(rectBox(flange, CASE_Z, CASE_Z + FL, body));
  root.add(thumbscrews([C.y + 700, bottom - 700].map((y) => ({ x: C.x - 12, y: -y, z: CASE_Z + FL / 2 })), 'x-', 100, 96, backKnurl));
  side.traverse(seeThrough);
  // a click on the shut side opens the case: an unseen plate over it (machine3d.ts lets rays at it only while the panel is shut)
  const hit = tag(rectBox(kind === 'oem' ? { ...C, w: C.w - OEM_BEZEL } : C, FRONT, FRONT + 4, mat(0, { transparent: true, opacity: 0, depthWrite: false })), 'case.side');
  hit.castShadow = hit.receiveShadow = false;
  side.add(hit);
  // the panel hangs from its front edge (the Mini's from the edge of its sheet, under the plastic front)
  const px = kind === 'oem' ? ex - OEM_BEZEL : ex, door = new Group();
  door.position.set(px, 0, FRONT);
  side.position.set(-px, 0, -FRONT);
  door.add(side);
  foldCaseLooks(root); // (the material cap, 3D_STYLE "Asset standard" §2: near-duplicate looks become one)
  return { root, side, door, px, hit, screws, glass, power: ctl.power, leds: ctl.leds, spins, strip, rgb: L.rgb, accent: acc, inner: L.inner, shroud: L.shroud, rivet: rivetM(kind), screw: screwM(kind) };

}
