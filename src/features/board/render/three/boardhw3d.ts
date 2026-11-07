// The board's hardware that stands up off the flat PCB, shared by the live board (machine3d.ts) and the showcase (showcase.ts): the rear I/O
// (where each port sits in the shield, the connectors behind it and their cover by the tier's skin), and the slot hardware (PCIe armour and
// latches, the CPU socket's load frame and lever).
import { BoxGeometry, CylinderGeometry, Group, Mesh, Path, Shape, type Material, type MeshStandardMaterial } from 'three';
import { extrude, instanced, place, rectBox, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { IO_PORTS } from '../layout/boardlayout';
import { CASE, GEO, PCIE_RAILS, PKG, SOCKET_E, WALL_T } from '../layout/layout';
import type { IoPort } from '../layout/pins';
import { hexNum, skinOf, slotArmour } from '../skins';
import { brushed, outlinePts, shapeOf, slab, tiled } from './casekit3d';
import { glowMat } from './fans3d';

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** What the board's rear connectors are fitted with (the board tier's features). */
export interface IoFeatures { ethernetMbps: number; usbPorts: number; displayPorts: number }

/**
 * Where the rear ports sit in the I/O shield (`ioShield`, casedetail3d.ts): each mouth's depth over the board (from BOARD_Z) and the half-width
 * of its shell (layout y). The connectors behind the shield (`ioCover`) take the same numbers, so each shell meets its opening.
 */
export const IO_Z = { jack: 300, rj45: [220, 380], video: [488, 552], usb: [572, 628], legacy: 880 } as const;
export const IO_HALF = { rj45: 62, video: 58, usb: 56 } as const;
/** The better boards' extras on the shield (look only): the BIOS flashback and clear-CMOS buttons, two Wi-Fi antenna jacks, the optical out, a USB-C. */
export const IO_EXTRA = { bios: -1290, clr: -1220, wifi: { y: -620, z: [900, 1160] }, optical: { y: -430, z: 270 }, usbc: { y: -320, z: [470, 610] } } as const;

/** Whether the board fits this rear port: a tier fits the first of each kind its features ask for (the others are bare outlines on the PCB). */
export function fitted(p: IoPort, f: IoFeatures): boolean {
  return p.kind === 'jack' || p.kind === 'hdmi' || (p.kind === 'rj45' ? f.ethernetMbps > 0 : p.kind === 'dp' ? f.displayPorts >= 2 : Number(p.id.slice(3)) < f.usbPorts);
}

/** An older board's legacy port in the stamped shield's free column (look only): a PS/2 jack (`din`) or a D-sub of this length; `tone` names its colour. */
export interface LegacyPort { kind: 'din' | 'dsub'; y: number; len: number; tone: string; half?: string }
/** The Starter has an old board's full set (PS/2 keyboard and mouse, serial, parallel); the Basic one PS/2 combo port, VGA and DVI. */
export function legacyIo(tier: number): LegacyPort[] {
  if (tier === 0) return [{ kind: 'din', y: -1890, len: 0, tone: 'kb' }, { kind: 'din', y: -1770, len: 0, tone: 'mouse' }, { kind: 'dsub', y: -1460, len: 190, tone: 'serial' }, { kind: 'dsub', y: -930, len: 470, tone: 'parallel' }];
  if (tier === 1) return [{ kind: 'din', y: -1830, len: 0, tone: 'kb', half: 'mouse' }, { kind: 'dsub', y: -1460, len: 190, tone: 'vga' }, { kind: 'dsub', y: -980, len: 330, tone: 'dvi' }];
  return [];
}

/** A rear port's shell where it passes through the rear wall to the shield: layout y and depth spans (a round one is a barrel that fills them). */
export interface IoShell { y0: number; y1: number; z0: number; z1: number; round: boolean; m: 'steel' | 'plastic' | 'gold' }

/** The shells behind every opening the shield of this tier has (the fitted ports, the legacy ports, the extras). */
export function ioShells(feat: IoFeatures, tier: number): IoShell[] {
  const Z = BOARD_Z, out: IoShell[] = [];
  const sq = (y: number, h: number, z0: number, z1: number, m: IoShell['m'] = 'steel') => out.push({ y0: y - h, y1: y + h, z0: Z + z0, z1: Z + z1, round: false, m });
  const rd = (y: number, z: number, r: number, m: IoShell['m']) => out.push({ y0: y - r, y1: y + r, z0: Z + z - r, z1: Z + z + r, round: true, m });
  for (const p of IO_PORTS) {
    if (!fitted(p, feat)) continue;
    if (p.kind === 'jack') rd(p.y, IO_Z.jack, 26, 'plastic');
    else if (p.kind === 'rj45') sq(p.y, IO_HALF.rj45, ...IO_Z.rj45);
    else if (p.kind === 'usb') sq(p.y, IO_HALF.usb, ...IO_Z.usb);
    else sq(p.y, IO_HALF.video, ...IO_Z.video);
  }
  for (const l of legacyIo(tier)) {
    if (l.kind === 'din') rd(l.y, IO_Z.legacy, 34, 'steel');
    else sq(l.y, l.len / 2 + 16, IO_Z.legacy - 60, IO_Z.legacy + 60);
  }
  if (tier >= 2) rd(IO_EXTRA.bios, IO_Z.jack, 18, 'plastic');
  if (tier >= 3) {
    rd(IO_EXTRA.clr, IO_Z.jack, 18, 'plastic');
    for (const z of IO_EXTRA.wifi.z) rd(IO_EXTRA.wifi.y, z, 14, 'gold');
    sq(IO_EXTRA.optical.y, 20, IO_EXTRA.optical.z - 20, IO_EXTRA.optical.z + 20, 'plastic');
    sq(IO_EXTRA.usbc.y, 20, ...IO_EXTRA.usbc.z);
  }
  return out;
}

/** A stack of connectors standing on the board behind the shield: the shells whose spans meet share one housing (layout y, its top; `base`: the audio block's top under a steel housing, 0 none). */
export interface IoStack { y0: number; y1: number; top: number; base: number; shells: IoShell[] }
export function ioStacks(shells: IoShell[]): IoStack[] {
  const out: IoStack[] = [];
  for (const s of [...shells].sort((a, b) => a.y0 - b.y0)) {
    const last = out[out.length - 1], top = s.z1 + 24, base = s.m === 'plastic' ? top : 0;
    if (last && s.y0 < last.y1 + 12) Object.assign(last, { y1: Math.max(last.y1, s.y1), top: Math.max(last.top, top), base: Math.max(last.base, base) }).shells.push(s);
    else out.push({ y0: s.y0, y1: s.y1, top, base, shells: [s] });
  }
  return out;
}

/** The depths the connectors span: from the shield's back (the rear wall's outer face) through the wall to their back on the board. */
export const IO_X0 = () => CASE.x + 1, IO_XB = () => CASE.x + 340;

/** A barrel along x from x0 to x1 round the layout point (y, z). */
function barrel(x0: number, x1: number, y: number, z: number, r: number, m: Material, sides = 18): Mesh {
  const o = new Mesh(new CylinderGeometry(r, r, x1 - x0, sides).rotateZ(Math.PI / 2), m);
  o.position.set((x0 + x1) / 2, -y, z);
  return place(o);
}

/**
 * The rear I/O inside the case, by the skin; glow is the armoured cover's lit line (it follows the fans), null on the others. Every port the
 * shield opens has its connector's shell running through the rear wall to the opening (`ioShells`). On the Starter the connectors stand bare:
 * stacked housings in stamped steel (the audio block in black plastic) with their spring tabs, the seam between stacked ports, the solder legs
 * and, at the back, the plastic insert and the pins bent down into the board. The better boards hide them under a moulded cover (the Basic's
 * legacy stacks rise through its top); the Enthusiast's Wi-Fi jacks above it run their leads down into it.
 */
export function ioCover(feat: IoFeatures = { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 }): { root: Group; glow: MeshStandardMaterial | null } {
  const sk = skinOf(GEO.tier), tier = GEO.tier, io = tag(new Group(), 'io'), ir = GEO.io, x0 = ir.x + WALL_T, xs = IO_X0(), xb = IO_XB(), Z = BOARD_Z;
  let glow: MeshStandardMaterial | null = null;
  const steelM = mat(0x8a9099, { metalness: 0.7, roughness: 0.42 }), plastic = mat(0x111215, { roughness: 0.55 }), dark = mat(0x23272d, { metalness: 0.5, roughness: 0.5 });
  const shellM = { steel: steelM, plastic, gold: mat(0xd9b25e, { metalness: 0.9, roughness: 0.34 }) };
  const shells = ioShells(feat, tier), stacks = ioStacks(shells.filter((s) => s.m !== 'gold'));
  const bare = sk.ioCover === 'bare', into = bare ? x0 + 8 : x0 + 6;
  // the shells through the wall, from the shield's back to the housing (or the cover) inside
  for (const s of shells) {
    if (s.m === 'gold') continue;
    io.add(s.round ? barrel(xs, into, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2, (s.y1 - s.y0) / 2, shellM[s.m]) : rectBox({ x: xs, y: s.y0, w: into - xs, h: s.y1 - s.y0 }, s.z0, s.z1, shellM[s.m]));
  }
  const pins: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  /** A stack's housing from `from` up (the board, or inside a cover it rises through): steel over the black audio block where the stack starts with the jacks. */
  const housing = (st: IoStack, from: number) => {
    const foot = { x: x0 + 2, y: st.y0 - 4, w: xb - x0 - 2, h: st.y1 - st.y0 + 8 }, low = from === Z;
    if (st.base >= st.top) io.add(softBox(foot, from, st.top, plastic, 8));
    else {
      if (st.base > from) io.add(softBox(foot, from, st.base, plastic, 8));
      io.add(softBox(foot, Math.max(from, st.base), st.top, steelM, 6));
    }
    // the seam under each stacked port, the spring tabs on top; on the board, a solder leg each side and the back's insert with its pins bent down
    for (const s of st.shells) if (s.z0 - 30 > Math.max(from, st.base) + 40) io.add(rectBox(grow(foot, 1.5), s.z0 - 34, s.z0 - 28, dark));
    const n = Math.max(1, Math.round(foot.h / 140));
    for (let k = 0; k < n; k++) io.add(rectBox({ x: x0 + 26, y: foot.y + ((k + 0.5) * foot.h) / n - 12, w: 40, h: 24 }, st.top, st.top + 6, steelM));
    if (!low) return;
    for (const y of [foot.y - 8, foot.y + foot.h]) io.add(rectBox({ x: xb - 80, y, w: 30, h: 8 }, Z, Z + 70, steelM));
    io.add(rectBox({ x: xb - 2, y: foot.y + 14, w: 6, h: foot.h - 28 }, Z + 24, Z + 120, plastic));
    for (let y = foot.y + 24; y < foot.y + foot.h - 20; y += 26) pins.push({ x: xb + 10, y: -y, z: Z + 22, sx: 6, sy: 6, sz: 44 }, { x: xb + 5, y: -y, z: Z + 42, sx: 14, sy: 6, sz: 5 });
  };
  if (bare) for (const st of stacks) housing(st, Z);
  else {
    // a moulded cover over them, as high as the port stacks: plain (Basic: black; Mainstream: a teal line down its inner edge), or the
    // Enthusiast's armour, a brushed silver plate with chamfered corners on top and a lit line that glows with the fans. A stack taller than
    // the cover (the Basic's legacy ports) rises through its top in bare steel.
    const armour = sk.ioCover === 'armour', H = Z + 720, body = { ...ir, x: x0, w: ir.w - WALL_T }, coverM = mat(hexNum(sk.sink), { metalness: 0.4, roughness: 0.48 });
    io.add(softBox(body, Z, H, coverM, 30));
    for (const st of stacks) if (st.top > H - 30) housing(st, H - 40);
    const vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (let y = ir.y + 140; y < ir.y + ir.h * (armour ? 0.3 : 1) - 140; y += 64) vents.push({ x: x0 + body.w * 0.45, y: -y, z: H, sx: body.w * 0.5, sy: 24, sz: 10 });
    io.add(instanced(new BoxGeometry(1, 1, 1), mat(0x07080c, { roughness: 0.7 }), vents));
    if (armour) {
      const plate = { x: x0 + 24, y: ir.y + ir.h * 0.3, w: body.w - 48, h: ir.h * 0.7 - 60 };
      io.add(slab(shapeOf(outlinePts(plate, 0, [60, 60, 60, 60])), H - 4, H + 26, mat(hexNum(sk.insert ?? '#7d838d'), { metalness: 0.6, roughness: 0.38, map: tiled(brushed(), 1, 6) }), 6));
      const line = glowMat(hexNum(sk.accent), 0x2a2550);
      io.add(seeThrough(rectBox({ x: x0 + body.w - 22, y: ir.y + 80, w: 12, h: ir.h - 160 }, H - 70, H + 2, line)));
      glow = line;
    } else if (sk.accent && tier >= 2) io.add(rectBox({ x: x0 + body.w - 20, y: ir.y + 120, w: 8, h: ir.h - 240 }, H - 60, H + 1, mat(hexNum(sk.accent), { roughness: 0.4 })));
    // the Wi-Fi jacks over the cover: each barrel through the wall, its nut inside, and a black lead bent down into the cover to the module
    shells.filter((s) => s.m === 'gold').forEach((s, i) => {
      const y = (s.y0 + s.y1) / 2, z = (s.z0 + s.z1) / 2, xe = x0 + 90 + i * 60;
      io.add(barrel(xs, x0 + 24, y, z, (s.y1 - s.y0) / 2, shellM.gold, 14), barrel(x0, x0 + 22, y, z, 26, steelM, 6));
      io.add(tube(rounded([[x0 + 20, -y, z], [xe, -y, z], [xe, -y, H - 10]], 50, 6), 9, mat(0x1a1b1f, { roughness: 0.6 }), 8));
    });
  }
  if (pins.length) io.add(instanced(new BoxGeometry(1, 1, 1), mat(0xc9ccd2, { metalness: 0.8, roughness: 0.3 }), pins));
  return { root: io, glow };
}

/** The hardware round the sockets that the flat drawing cannot show: a steel armour round the PCIe slots the skin armours, the retention latch at each slot's far end, and the CPU socket's load frame and lever. */
export function slotHardware(): Group {
  const g = new Group();
    const sk = skinOf(GEO.tier), latchM = mat(hexNum(sk.latch), { roughness: 0.5 }), steel = mat(0x8a929c, { metalness: 0.75, roughness: 0.38, map: tiled(brushed(), 10, 1) });
    PCIE_RAILS.forEach((r, i) => {
      // the armour: a thin steel wall round the slot's sides, a little proud of it, its top edge rolled; the latch stands at the east end
      const t = 10, z0 = BOARD_Z + 10, z1 = BOARD_Z + 152;
      if (slotArmour(GEO.tier, i)) for (const s of [{ x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y + r.h, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y, w: t, h: r.h }]) g.add(softBox(s, z0, z1, steel, 4));
      g.add(softBox({ x: r.x + r.w, y: r.y - 16, w: 70, h: r.h + 32 }, BOARD_Z, BOARD_Z + 190, latchM, 10));
      g.add(rectBox({ x: r.x + r.w + 44, y: r.y - 16, w: 26, h: r.h + 32 }, BOARD_Z + 190, BOARD_Z + 240, latchM));
    });
    // the load frame over the socket's border and its lever down the east side, the handle turned out at the south end under its hook
    const o = grow(PKG, SOCKET_E + 20), inner = grow(PKG, SOCKET_E - 26), frame = new Shape(), hole = new Path();
    frame.moveTo(o.x, -o.y).lineTo(o.x + o.w, -o.y).lineTo(o.x + o.w, -(o.y + o.h)).lineTo(o.x, -(o.y + o.h)).closePath();
    hole.moveTo(inner.x, -inner.y).lineTo(inner.x, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -inner.y).closePath();
    frame.holes.push(hole);
    const plate = place(new Mesh(extrude(frame, { depth: 16, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 1 }), steel));
    plate.position.z = BOARD_Z + 70;
    g.add(plate);
    const lx = o.x + o.w + 40, ys = o.y + o.h + 50, zl = BOARD_Z + 46;
    g.add(tube(rounded([[lx, -(o.y + 40), zl], [lx, -ys, zl], [lx + 170, -ys, zl]], 40, 5), 13, steel, 10));
    const cap = place(new Mesh(new CylinderGeometry(20, 20, 70, 14).rotateZ(Math.PI / 2), latchM));
    cap.position.set(lx + 200, -ys, zl);
    g.add(cap);
    g.add(rectBox({ x: lx - 30, y: ys - 70, w: 60, h: 40 }, BOARD_Z, BOARD_Z + 70, steel), rectBox({ x: lx - 26, y: o.y + 10, w: 52, h: 70 }, BOARD_Z, BOARD_Z + 64, steel));
  return g;
}
