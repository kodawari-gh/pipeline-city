import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { IO_PORTS, IO_X } from '@/features/board/render/layout/boardlayout';
import { acInlet, portProfile, shieldSheet } from '@/features/board/render/layout/ports';
import { box, label, lgrad, mix } from '@/core/render/ink';
import * as layout from '@/features/board/render/layout/layout';
import { CASE_LOOK } from '../desk/props/case';
import * as decor from './casedecor';
import type { DriveKind } from '@/features/storage/render/drives';
import type { Theme } from '@/core/render/theme';

// The far-zoom exterior of the PC: an opaque chassis (brushed panels, a smoked glass side with only a faint reflection, vents, feet,
// the top panel, the drive bay front and the rear I/O plate) that replaces the interior when the camera is far away. It shares the
// case rectangle (`CASE`) with the interior view, so the power button, its lights, the USB port, the video cable and the key tray
// (all external things, drawn by props.ts / live.ts above this layer) stay exactly where they are.
//
// Static art is built once per (theme, tier, drives) and baked to one texture by board.ts; the accent strip is the only live part.

/** The thin accent light strip on the front rim of the case (a vertical bar east of the glass). */
export const stripRect = () => ({
  x: layout.CASE.x + layout.CASE.w - 82,
  y0: layout.CASE_GLASS.y + 140,
  y1: layout.CASE_GLASS.y + layout.CASE_GLASS.h - 110,
  w: 20,
});

export interface ExteriorOpts {
  /** SATA ports this tier has. */
  nSata: number;
  /** Drives mounted in the bay (NVMe lives on the board, not in the bay, and is not visible from outside). */
  drives: { slot: string; kind: DriveKind }[];
  /** External connectors this board offers (ethernetMbps 0 = no jack). */
  features: { ethernetMbps: number; usbPorts: number; displayPorts: number };
  /** PCIe slot indices that hold a NIC card: each has its jack on the rear plate. */
  nics?: number[];
  /** PCIe slot indices that hold a graphics card: each has an HDMI port on the rear plate (the video cable goes in there on a graphics display). */
  gpus?: number[];
}

function exteriorTones(_T: Theme) {
  return {
    hi: '#3b4663',
    mid: '#29324b',
    lo: '#181e30',
    edge: '#51608a',
    shade: '#070a12',
    glassTop: '#0f172a',
    glassBot: '#05080f',
    cut: '#05070c',
  };
}

/** Fine horizontal hairlines that read as brushed metal. */
function brush(g: Graphics, x: number, y: number, w: number, h: number, step = 34, cuts?: decor.Cuts) {
  const [tl, tr, br, bl] = cuts ?? [0, 0, 0, 0];
  for (let yy = y + step / 2, k = 0; yy < y + h; yy += step, k++) {
    // a cut corner shortens the line where the corner has been cut away
    const x0 = x + Math.max(0, tl - (yy - y), bl - (y + h - yy)),
      x1 = x + w - Math.max(0, tr - (yy - y), br - (y + h - yy));
    if (x1 > x0) {
      g.moveTo(x0, yy)
        .lineTo(x1, yy)
        .stroke({ width: 5, color: k % 2 ? '#ffffff' : '#000000', alpha: 0.028 });
    }
  }
}

/**
 * How each case tier looks from outside, beyond its size: the colour of its body, its trim, its accent light and how round it is.
 * Mini: a pale aluminium shell, soft corners, amber light. Micro: matte black, cyan. Mid: gunmetal with brass trim, violet.
 * Full: a dark monolith in charcoal, a square box with a small radius, a smoked window and a violet light.
 */
interface CaseStyle {
  mixTo: string;
  k: number;
  accent: (T: Theme) => string;
  rad: number;
  rgb: boolean;
  brushed: boolean;
}
const STYLES: CaseStyle[] = [
  // a budget OEM tower: charcoal painted steel, square corners, a solid side with one vent patch, no window
  { mixTo: '#2a2d32', k: 0.72, accent: (T) => T.ld, rad: 28, rgb: false, brushed: false },
  // a matte black mid-tower: powder coat, a tinted window over the upper part, one small logo
  { mixTo: '#0b0c10', k: 0.72, accent: (T) => T.mute, rad: 70, rgb: false, brushed: false },
  // a gaming case: dark, angular, slanted vents, a cut-corner window, one RGB strip and a lit logo plate
  { mixTo: '#1b2030', k: 0.5, accent: (T) => T.mul, rad: 56, rgb: true, brushed: false },
  // a showcase: a charcoal monolith with brushed sides, a small radius, a smoked window and no light but its front state strip
  { mixTo: '#1d1e22', k: 0.7, accent: (T) => T.mul, rad: 20, rgb: false, brushed: true },
];
const styleOf = (): CaseStyle & { kind: decor.CaseKind } => ({
  ...(STYLES[layout.LAYOUT_CASE] ?? STYLES[2]!),
  kind: decor.CASE_KIND[layout.LAYOUT_CASE] ?? 'gamer',
});

/** The body tones of the current tier: the shared steel tones mixed toward the tier's colour. */
function bodyTones(T: Theme, st: CaseStyle) {
  const c = exteriorTones(T),
    m = (v: string) => mix(v, st.mixTo, st.k);
  // the painted OEM tower is charcoal to its edges: its own palette, no darkening and no steel grey left in it
  if (st.k >= 0.72 && st.mixTo === '#2a2d32') {
    return { ...c, hi: '#4e5360', mid: '#2a2d32', lo: '#1d1e22', edge: '#131518', shade: '#050608', cut: '#131518' };
  }
  return {
    ...c,
    hi: m(c.hi),
    mid: m(c.mid),
    lo: m(c.lo),
    edge: mix(c.edge, st.mixTo, st.k * 0.6),
    cut: mix(c.cut, '#000000', 0.2),
  };
}

/** A bevel round a rounded box: a lit edge on the top and west sides, a shaded one on the bottom and east. */
function bevel(g: Graphics, x: number, y: number, w: number, h: number, r: number, a = 1) {
  g.moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .moveTo(x, y + r)
    .lineTo(x, y + h - r)
    .stroke({ width: 6, color: '#ffffff', alpha: 0.13 * a, cap: 'round' });
  g.moveTo(x + r, y + h)
    .lineTo(x + w - r, y + h)
    .moveTo(x + w, y + r)
    .lineTo(x + w, y + h - r)
    .stroke({ width: 6, color: '#000000', alpha: 0.4 * a, cap: 'round' });
}

/** The static exterior (world coordinates, around `CASE`). */
export function exteriorArt(T: Theme, o: ExteriorOpts): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const st = styleOf(),
    c = bodyTones(T, st),
    acc = st.accent(T),
    R = st.rad;
  const c0 = layout.CASE,
    p = layout.CASE_PANEL,
    gl = layout.CASE_GLASS,
    ci = layout.CASE_IN;
  const oem = st.kind === 'oem',
    dim = oem ? '#959aa3' : '#8d9bc4';
  const slit = oem ? mix(c.lo, '#000000', 0.5) : c.glassTop; // the dark of the vent holes

  // the feet (rubber pads on the small cases, wider blocks on the full tower, which also throws a little light on the desk) and the soft shadow
  const { kind } = st,
    fw = { oem: 190, matte: 300, gamer: 300, show: 600 }[kind];
  if (kind === 'show') {
    // one flat plinth, inset from the sides and the front and back
    box(g, c0.x + 250, c0.y + c0.h - 40, c0.w - 500, 150, 30, { fill: '#4e5360', stroke: c.edge, lw: 6, sa: 0.5 });
    g.rect(c0.x + 300, c0.y + c0.h - 34, c0.w - 600, 5).fill({ color: '#ffffff', alpha: 0.1 });
  } else {
    for (const fx of [c0.x + 300, c0.x + c0.w - 300 - fw]) {
      const fy = c0.y + c0.h - 40;
      if (kind === 'gamer') {
        // two flat rubber rails, as on the matte case
        box(g, fx, fy, fw, 150, 30, { fill: '#0c0c0e', stroke: c.edge, lw: 6, sa: 0.5 });
      } else {
        box(g, fx, fy, fw, kind === 'oem' ? 130 : 150, kind === 'oem' ? 65 : 30, {
          fill: kind === 'oem' ? '#131518' : c.shade,
          stroke: c.edge,
          lw: 6,
          sa: 0.5,
        });
        g.rect(fx + 30, fy, fw - 60, 5).fill({ color: '#ffffff', alpha: 0.08 });
      }
      if (st.rgb) {
        g.rect(fx + 20, c0.y + c0.h + 100, fw - 40, 8).fill({ color: acc, alpha: 0.55 });
      }
    }
  }
  const bc = decor.isCut(decor.CASE_CUTS[kind]) ? decor.CASE_CUTS[kind] : undefined; // (no kind has cut corners now: the body stays a box with its radius)
  decor.outline(g, c0.x + 24, c0.y + 40, c0.w, c0.h, R, bc).fill({ color: '#000000', alpha: 0.4 });
  box(g, c0.x + 60, c0.y + c0.h + 40, c0.w - 80, 120, 60, { fill: '#000000', fa: 0.22 });
  if (bc) {
    for (const grow of [90, 45]) {
      decor
        .outline(g, c0.x - grow, c0.y - grow, c0.w + 2 * grow, c0.h + 2 * grow, R + grow, decor.growCuts(bc, grow))
        .fill({
          color: acc,
          alpha: 0.05,
        });
    } // its light spills onto the wall
  }

  // body: brushed metal lit from the top left, with a bevelled rim and a soft light band down the side
  decor
    .outline(g, c0.x, c0.y, c0.w, c0.h, R, bc)
    .fill(lgrad(c.hi, c.lo, [0.25, 1]))
    .stroke({ width: 12, color: c.edge, alpha: 0.9, join: 'miter' });
  decor
    .outline(g, c0.x + 14, c0.y + 14, c0.w - 28, c0.h - 28, R - 10, bc && decor.growCuts(bc, -8))
    .fill(lgrad('#ffffff12', '#ffffff00', [1, 0.2]));
  if (st.brushed) {
    brush(g, c0.x + 40, c0.y + 40, c0.w - 80, c0.h - 80, 34, bc && decor.growCuts(bc, -26));
  }
  bevel(g, c0.x + 16, c0.y + 16, c0.w - 32, c0.h - 32, R - 10, kind === 'matte' ? 0.4 : kind === 'oem' ? 0.3 : 1);

  // top panel: a recessed plate with an accent hairline, the brand, a row of vents and the light window for the status LEDs
  const pi = bc ? 410 : 36; // the chamfered corners cut into the panel's ends
  if (kind !== 'matte') {
    g.roundRect(p.x + pi, p.y + 36, p.w - 2 * pi, p.h - 52, 40)
      .fill(lgrad(c.mid, c.lo))
      .stroke({ width: 6, color: c.edge, alpha: 0.6 });
  }
  if (kind !== 'matte') {
    g.rect(p.x + pi + 34, p.y + 44, p.w - 2 * pi - 68, 10).fill({ color: '#000000', alpha: 0.3 });
  }
  if (kind !== 'oem' && kind !== 'matte') {
    g.rect(p.x + pi + 54, p.y + p.h - 34, p.w - 2 * pi - 108, 5).fill({ color: acc, alpha: 0.5 });
  }
  const nv = CASE_LOOK[layout.LAYOUT_CASE]?.vents ?? 16;
  if (kind === 'gamer') {
    decor.slots(g, { x: -2250, y: p.y + 110, w: nv * 78, h: 200 }, nv, 70);
    g.fill({ color: c.cut });
  } else if (kind !== 'show') {
    for (let k = 0; k < nv; k++) {
      box(g, -2250 + k * 78, p.y + 120, 30, 190, 15, { fill: c.cut });
    } // (the showcase's top is one plain rail, its fans behind the filter)
  }
  if (kind === 'gamer') {
    // an angled mesh cap in the top front corner
    const cx = c0.x + c0.w - 20,
      cw = 380;
    g.poly([cx - cw, c0.y + 20, cx, c0.y + 20, cx, c0.y + 20 + cw * 0.8])
      .fill(lgrad('#1c212c', '#07090d'))
      .stroke({ width: 5, color: c.edge, alpha: 0.6 });
    for (let k = 1; k < 5; k++) {
      const x0 = cx - cw + k * 70;
      g.moveTo(x0, c0.y + 20).lineTo(cx, c0.y + 20 + 0.8 * (cx - x0));
    }
    g.stroke({ width: 14, color: '#000000', alpha: 0.7 });
  }
  box(g, layout.CASE_LEDS.disk - 120, p.y + 70, layout.CASE_LEDS.err - layout.CASE_LEDS.disk + 240, 250, 40, {
    fill: c.cut,
    stroke: c.edge,
    lw: 5,
    sa: 0.5,
  });
  root.addChild(label('DISK', layout.CASE_LEDS.disk, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));
  for (const [t, x] of [
    ['ON', layout.CASE_LEDS.on],
    ['OFF', layout.CASE_LEDS.off],
    ['ERR', layout.CASE_LEDS.err],
  ] as const) {
    root.addChild(label(t, x, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));
  }

  // rear I/O plate (west): a panel with the external connectors cut into it
  const io = { x: c0.x + 30, y: ci.y, w: layout.BR.io.x + layout.BR.io.w + 60 - (c0.x + 30), h: gl.h };
  if (kind !== 'matte') {
    g.roundRect(io.x, io.y, io.w, io.h, 30).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.7 });
    brush(g, io.x + 10, io.y + 10, io.w - 20, io.h - 20, 40);
  }
  rearIo(g, T, o);
  root.addChild(label('REAR I/O', io.x + 24, io.y + 70, 56, dim, { head: true, a: 0.6 }));
  // the PSU's exhaust grille (the cases above the Mini)
  if (layout.PSU_REAR_FAN) {
    for (let k = 0; k < 7; k++) {
      box(g, io.x + 40, layout.PSU_REAR_FAN.y + 50 + k * 90, 120, 26, 13, { fill: c.cut, fa: 0.75 });
    }
  }
  // the rear fan, the expansion slot covers and the top fans are inside: only their vents show on the plate
  for (let k = 0; k < Math.min(5, Math.floor((layout.REAR_FAN.h - 40) / 70)); k++) {
    box(g, io.x + 40, layout.REAR_FAN.y + 60 + k * 70, 120, 26, 13, { fill: c.cut, fa: 0.75 });
  }

  // the glass side: a bezel (the tier's trim colour where it has one), a dark gasket, then the window itself, a hole in the body
  // with a thin smoked pane over it, so the real interior shows through at every zoom
  // The window differs by case: none on the OEM tower (a solid side with a vent patch), the upper part on the matte case, a cut corner on the
  // gaming case, a full height smoked pane in a thin dark gasket on the showcase.
  const win = decor.caseWindow(kind);
  const bz = kind === 'matte' ? 22 : 30,
    wr = kind === 'show' ? 24 : 50;
  const cuts: decor.Cuts | undefined = decor.isCut(decor.WINDOW_CUTS[kind]) ? decor.WINDOW_CUTS[kind] : undefined;
  const bcuts: decor.Cuts | undefined = cuts && (cuts.map((v) => (v ? v + bz * 0.6 : 0)) as decor.Cuts);
  const top = new Graphics();
  if (kind === 'oem') {
    solidSide(g, c, { x: ci.x, y: gl.y, w: ci.w, h: gl.h }, win);
  } else {
    // the showcase's bezel is a dark gasket (no trim); the gaming one is blue-black, the others plain steel
    const bezelFill =
      kind === 'show'
        ? lgrad('#15171c', '#030304')
        : kind === 'gamer'
          ? lgrad('#222834', '#07090d')
          : lgrad(c.mid, c.lo);
    if (kind !== 'matte') {
      decor
        .outline(g, win.x - bz, win.y - bz, win.w + 2 * bz, win.h + 2 * bz, wr + 26, bcuts)
        .fill(bezelFill)
        .stroke({ width: 6, color: c.edge, alpha: 0.6 });
    }
    if (kind !== 'matte') {
      bevel(g, win.x - bz + 4, win.y - bz + 4, win.w + 2 * bz - 8, win.h + 2 * bz - 8, 20, 0.8);
    }
    decor
      .outline(
        g,
        win.x - 16,
        win.y - 16,
        win.w + 32,
        win.h + 32,
        wr + 12,
        cuts && (cuts.map((v) => (v ? v + 10 : 0)) as decor.Cuts),
      )
      .fill(c.shade);
    const hole = new Graphics();
    hole.blendMode = 'erase';
    decor.outline(hole, win.x, win.y, win.w, win.h, wr, cuts).fill('#000000');
    const pane = new Graphics();
    root.addChild(hole, pane);
    decor.outline(pane, win.x, win.y, win.w, win.h, wr, cuts).fill(lgrad(c.glassTop, c.glassBot));
    pane.alpha = kind === 'matte' ? 0.55 : 0.4;
    root.addChild(top);
  }
  const refl = (x0: number, w: number, a: number) =>
    top
      .poly([
        win.x + x0,
        win.y + 8,
        win.x + x0 + w,
        win.y + 8,
        win.x + x0 + w - 1500,
        win.y + win.h - 8,
        win.x + x0 - 1500,
        win.y + win.h - 8,
      ])
      .fill({ color: '#ffffff', alpha: a });
  const ra = 0.05;
  refl(3200, 700, ra);
  refl(4200, 150, ra * 0.8);
  refl(7500, 500, ra * 0.7);
  decor
    .outline(
      top,
      win.x + 14,
      win.y + 14,
      win.w - 28,
      win.h - 28,
      wr - 10,
      cuts && (cuts.map((v) => (v ? v - 10 : 0)) as decor.Cuts),
    )
    .stroke({ width: 5, color: '#ffffff', alpha: 0.1 });
  // the light under the glass: multi-zone RGB on the gaming case, one colour on the showcase, nothing on the plain cases
  if (kind === 'gamer') {
    // one violet strip under the glass (the same length as the old six-colour bar)
    const ly = win.y + win.h - 40,
      lx0 = win.x + 140,
      lw = win.w - 280;
    top.roundRect(lx0, ly - 30, lw, 60, 30).fill({ color: acc, alpha: 0.12 });
    top.roundRect(lx0, ly, lw, 10, 5).fill(acc);
  }

  // PSU compartment: a brushed panel with a perforated intake (the drive cage is inside, behind the glass)
  const lowY = gl.y + gl.h,
    lowH = ci.y + ci.h - lowY;
  const lowFill = kind === 'gamer' ? lgrad('#232936', '#0a0c11') : lgrad(c.mid, c.lo);
  if (kind !== 'matte') {
    g.roundRect(ci.x, lowY, ci.w, lowH, 36).fill(lowFill).stroke({ width: 6, color: c.edge, alpha: 0.5 });
  }
  if (st.brushed) {
    brush(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, 40);
  }
  if (kind !== 'matte') {
    bevel(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, 30, 0.7); // the matte side is one sheet: no seam under the window
  }
  const mesh = { x: layout.PSU.x + 120, y: layout.PSU.y + 60, w: 3300, h: layout.PSU.h - 120 };
  box(g, mesh.x, mesh.y, mesh.w, mesh.h, 40, {
    fill: oem ? mix(c.lo, '#000000', 0.25) : c.cut,
    stroke: c.edge,
    lw: 5,
    sa: 0.6,
  });
  if (kind === 'show') {
    decor.hexes(g, { x: mesh.x + 40, y: mesh.y + 40, w: mesh.w - 80, h: mesh.h - 80 }, 46, 10);
  } else {
    decor.holes(g, { x: mesh.x + 30, y: mesh.y + 30, w: mesh.w - 60, h: mesh.h - 60 }, 64, 13);
  }
  g.fill({ color: slit, alpha: 1 });
  g.rect(mesh.x + 20, mesh.y + 20, mesh.w - 40, 4).fill({ color: '#ffffff', alpha: 0.04 });
  // the mains inlet in the rear wall at the PSU's end (the cord is drawn by the room)
  acInlet(g, T, layout.PC_POWER, { wallX: IO_X, wallW: layout.WALL_T });
  // the badge beside the intake: a plate of the body's metal with the name pressed into it (a lit edge above each letter's shadow)
  const bx = mesh.x + mesh.w + 260,
    area = { x: bx, y: layout.PSU.y + 60, w: ci.x + ci.w - 300 - bx, h: layout.PSU.h - 120 };
  badge(root, g, c, kind, area);

  // front rim: a slim vertical vent column east of the glass
  const STRIP = stripRect();
  for (let k = 0; k < Math.floor((STRIP.y1 - STRIP.y0 - 260) / 215) + 1; k++) {
    box(g, STRIP.x + 62, STRIP.y0 + 260 + k * 215, 16, 120, 8, { fill: c.cut, fa: 0.8 });
  }
  box(g, STRIP.x - 6, STRIP.y0 - 6, STRIP.w + 12, STRIP.y1 - STRIP.y0 + 12, 12, {
    fill: c.cut,
    stroke: c.edge,
    lw: 3,
    sa: 0.5,
  });
  return root;
}

const tones = exteriorTones;

type Tones = ReturnType<typeof bodyTones>;

/** The solid side of the OEM tower: a pressed panel with a square perforated vent patch, screws in its corners and the seam to the PSU bay. */
function solidSide(g: Graphics, c: Tones, r: layout.Rect, win: layout.Rect) {
  g.roundRect(r.x + 50, r.y + 40, r.w - 100, r.h - 80, 20)
    .fill(lgrad(mix(c.hi, c.lo, 0.25), mix(c.hi, c.lo, 0.6)))
    .stroke({ width: 8, color: c.edge, alpha: 0.5 });
  g.roundRect(r.x + 62, r.y + 52, r.w - 124, r.h - 104, 14).stroke({ width: 5, color: '#ffffff', alpha: 0.08 });
  const v = { x: win.x + 700, y: r.y + r.h / 2 - 760, w: 1500, h: 1500 };
  g.roundRect(v.x - 24, v.y - 24, v.w + 48, v.h + 48, 50).fill({ color: '#000000', alpha: 0.18 });
  g.roundRect(v.x, v.y, v.w, v.h, 40)
    .fill(mix(c.lo, '#000000', 0.2))
    .stroke({ width: 6, color: c.edge, alpha: 0.7 });
  decor.holes(g, { x: v.x + 30, y: v.y + 30, w: v.w - 60, h: v.h - 60 }, 52, 12);
  g.fill({ color: mix(c.lo, '#000000', 0.5) });
  for (const [x, y] of [
    [r.x + 110, r.y + 100],
    [r.x + r.w - 110, r.y + 100],
    [r.x + 110, r.y + r.h - 100],
    [r.x + r.w - 110, r.y + r.h - 100],
  ] as const) {
    decor.screw(g, x, y, 30, mix(c.hi, c.lo, 0.3), c.edge);
  }
}

/**
 * The maker's mark, as small as on a real case and different on each: a plain label on the OEM tower, a debossed logo on the matte case,
 * a lit plate with an RGB outline on the gaming case. The showcase's mark is debossed like the matte case's.
 */
function badge(root: Container, g: Graphics, c: Tones, kind: decor.CaseKind, r: layout.Rect) {
  // the case maker's lockup (`brands/hako.ts`), as the 3D case has it: a label, a debossed plate, a debossed print
  const right = r.x + r.w,
    cy = r.y + r.h / 2;
  if (kind === 'oem') {
    const w = 700,
      x = right - w,
      h = 300;
    g.roundRect(x, cy - h / 2, w, h, 16)
      .fill(mix(c.hi, c.lo, 0.45))
      .stroke({ width: 5, color: c.edge, alpha: 0.7 });
    decor.brandLockup(root, 'hako', x + w / 2, cy, 110, '#959aa3');
  } else if (kind === 'gamer') {
    // a dark plate, the lockup debossed into it
    const w = 1100,
      x = right - w,
      h = 380,
      y = cy - h / 2;
    g.roundRect(x, y, w, h, 28).fill(lgrad('#171b25', '#07090d')).stroke({ width: 6, color: c.edge, alpha: 0.6 });
    for (const [dy, col] of [
      [8, '#2a2f3a'],
      [0, '#000000'],
    ] as const) {
      decor.brandLockup(root, 'hako', x + w / 2, y + h / 2 + dy, 190, col, null, 1);
    }
  } else {
    // matte and showcase: debossed, a dark print over a paler lip
    for (const [dy, col] of [
      [8, '#2a2d32'],
      [0, '#050608'],
    ] as const) {
      decor.brandLockup(root, 'hako', right - 120 - 520, cy + dy, 200, col, null, 1);
    }
  }
}

/**
 * The rear panel from outside, in the same side profile as inside the case (ports.ts): the wall's sheet at the case's west edge and
 * each connector passing through it (only the part that sits in the wall shows, the glass hides the rest). Audio, ethernet (if the
 * board has it), HDMI, DisplayPort (if it has a second output), USB, and the jack of every NIC card.
 */
function rearIo(g: Graphics, T: Theme, o: ExteriorOpts) {
  const c = tones(T),
    f = o.features,
    q = layout.BR.io;
  const fitted = (id: string) =>
    id === 'eth'
      ? f.ethernetMbps > 0
      : id === 'dp'
        ? f.displayPorts >= 2
        : id.startsWith('usb')
          ? Number(id.slice(3)) < f.usbPorts
          : true;
  shieldSheet(g, T, IO_X + 14, q.y + 20, layout.WALL_T - 28, q.h - 40);
  for (const p of IO_PORTS) {
    portProfile(g, T, p, fitted(p.id), { wallX: IO_X, wallW: layout.WALL_T, depth: layout.WALL_T - 24 });
  }
  if (f.ethernetMbps > 0) {
    const e = IO_PORTS.find((p) => p.id === 'eth')!;
    for (const lx of [e.x + 50, e.x + 110]) {
      g.circle(lx, e.y + e.h / 2 + 36, 11)
        .fill({ color: '#05070c' })
        .stroke({ width: 3, color: c.edge, alpha: 0.7 });
    }
  }
  // NIC cards: their jack comes out of the rear wall at the height of the card's slot
  for (const i of o.nics ?? []) {
    const j = layout.nicJack(i);
    portProfile(g, T, { id: `nic${i}`, kind: 'rj45', x: j.x, y: layout.nicY(i), w: j.w, h: j.h }, true, {
      wallX: IO_X,
      wallW: layout.WALL_T,
      depth: layout.WALL_T - 24,
    });
    for (const lx of [j.x + 50, j.x + 112]) {
      g.circle(lx, j.y + j.h + 30, 11)
        .fill({ color: '#05070c' })
        .stroke({ width: 3, color: c.edge, alpha: 0.7 });
    }
  }
  // graphics cards: an HDMI port at the height of the card's slot
  for (const i of o.gpus ?? []) {
    const p = layout.gpuPort(i);
    portProfile(g, T, { id: `gpu${i}`, kind: 'hdmi', x: p.x, y: p.y + p.h / 2, w: p.w, h: p.h }, true, {
      wallX: IO_X,
      wallW: layout.WALL_T,
      depth: layout.WALL_T - 24,
    });
  }
}

export type StripMode = 'off' | 'idle' | 'halt' | 'work' | 'error' | 'dead';

/** What the accent strip should say right now (from the snapshot only). */
export function stripModeOf(s: Snapshot | null): StripMode {
  if (!s) {
    return 'off';
  }
  if (s.board?.burnt) {
    return 'dead';
  }
  if (s.phase === 'error' || s.power.tripped) {
    return 'error';
  }
  if (!s.powered) {
    return 'off';
  }
  const ph = s.phase;
  if (ph === 'halted') {
    return 'halt';
  }
  return ph === 'posting' ||
    ph === 'mounting' ||
    ph === 'loading' ||
    ph === 'running' ||
    ph === 'writing' ||
    ph === 'booting-os' ||
    ph === 'ingesting' ||
    ph === 'running-os' ||
    ph === 'flashing'
    ? 'work'
    : 'idle';
}

/** Rect the exterior covers (for the bake frame), a little beyond `CASE` for the feet and the shadow. */
export const exteriorFrame = (): layout.Rect => ({
  x: layout.CASE.x - 60,
  y: layout.CASE.y - 40,
  w: layout.CASE.w + 140,
  h: layout.CASE.h + 240,
});
