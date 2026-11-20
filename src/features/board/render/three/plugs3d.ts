// The plugs of the cables the player moves at the PC's end (and the video cable's at the monitor), as real ones: an HDMI plug, an RJ45 (8P8C)
// plug and a Swiss mains (type 12) plug, built `k` units a mm. Each is built round its own z axis: the socket's mouth at z = -l, the cable leaving at z = 0 (`seatPlug`,
// cablerig3d.ts, stands one in its seat), the part that goes into the socket ahead of the mouth (hidden when it is seated, seen when it lies
// loose); its long side along x, its keyed side (HDMI's cut corners, the RJ45's latch) at -y. A real socket (a card's, the monitor's) takes a
// real plug. The board's rear I/O is drawn at about a third of real size: its plug's tip is cut to its mouth, and its boot keeps a real plug's
// proportion to the cable, which stays as thick as at the far end.
import { BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Path, Shape, Vector2, type BufferGeometry, type Material } from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { extrude, instanced, place, SEG, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { IO_HALF, IO_Z } from './boardhw3d';

/** The machine's scale: units a mm. */
const MM = 23;

/**
 * An HDMI (type A) plug's real size (mm): the metal tip 13.9 x 4.45, its two keyed corners cut 1.3, 8.5 of it into the socket; the moulded boot
 * 21 x 10.5 tapering to 18.5 x 9; 32 out of the socket to the cable's end of the strain relief.
 */
export const HDMI = { tip: { w: 13.9, h: 4.45, cut: 1.3 }, in: 8.5, boot: { w: 21, h: 10.5, w1: 18.5, h1: 9 }, l: 32 } as const;
/**
 * An RJ45 plug's real size (mm): the clear body 11.6 x 6.5, 14 of it into the jack and 6 out; the latch on its keyed side, 6 wide at its
 * shoulders, 1.8 off the body at the jack's mouth (in the jack's latch slot); the boot 13.5 x 10; 23 out of the jack to the cable.
 */
export const RJ45 = { body: { w: 11.6, h: 6.5 }, in: 14, out: 6, latch: { w: 6, rise: 1.8 }, boot: { w: 13.5, h: 10, w1: 9.5, h1: 8.5 }, l: 23 } as const;

/** An HDMI plug for one socket: `k` units a mm, its tip's cross-section (the socket's mouth), the cable's radius. */
export interface HdmiFit { k: number; tip: { w: number; h: number; cut: number }; cable: number }
/** An RJ45 plug for one jack: `k` units a mm, its body's cross-section and its latch (the jack's mouth and latch slot), the cable's radius and colour. */
export interface Rj45Fit { k: number; body: { w: number; h: number }; latch: { w: number; rise: number }; cable: number; tone: number }

/** A real socket's plug (a card's output, the monitor's input). */
export const hdmiReal = (cable: number): HdmiFit => ({ k: MM, tip: { w: HDMI.tip.w * MM, h: HDMI.tip.h * MM, cut: HDMI.tip.cut * MM }, cable });
export const rj45Real = (cable: number, tone: number): Rj45Fit => ({
  k: MM, body: { w: RJ45.body.w * MM, h: RJ45.body.h * MM }, latch: { w: RJ45.latch.w * MM, rise: RJ45.latch.rise * MM }, cable, tone,
});

/** A plug for a compact jack (rj45jack3d.ts `jackFace`) built `k` units a mm: its mouth is 11.68 wide and 8.2 high, its latch slot 4.2 across and 0.7 past the latch side. */
export const rj45Jack = (k: number, cable: number, tone: number): Rj45Fit => ({ k, body: { w: RJ45.body.w * k, h: RJ45.body.h * k }, latch: { w: 3.8 * k, rise: 0.55 * k }, cable, tone });

/**
 * The board's rear I/O sockets (`ioShield`, casedetail3d.ts: the HDMI mouth 8 in from its shell, its corners cut 16; the RJ45 mouth 16 and 12 in
 * along y and 12 along z, its latch notch 48 wide and 8 deep): each plug's tip a hair inside its mouth.
 */
export const boardHdmi = (cable: number): HdmiFit => {
  const w = 2 * IO_HALF.video - 16 - 4, h = IO_Z.video[1] - IO_Z.video[0] - 16 - 4;
  return { k: w / HDMI.tip.w, tip: { w, h, cut: 15 }, cable };
};
export const boardRj45 = (cable: number, tone: number): Rj45Fit => {
  const w = IO_Z.rj45[1] - IO_Z.rj45[0] - 24 - 4, h = 2 * IO_HALF.rj45 - 28 - 4;
  return { k: w / RJ45.body.w, body: { w, h }, latch: { w: 44, rise: 7 }, cable, tone };
};

/** The scale of a plug's boot and strain relief: the plug's own, or more, so the cable is no thicker than a real one is to its boot (`share`). */
const bootScale = (k: number, cable: number, h: number, share: number): number => Math.max(k, (2 * cable) / share / h);

/** How far a plug stands out of its socket (its seat's `l`). */
export const hdmiLength = (f: HdmiFit): number => HDMI.l * bootScale(f.k, f.cable, HDMI.boot.h, 0.68);
export const rj45Length = (f: Rj45Fit): number => RJ45.l * bootScale(f.k, f.cable, RJ45.boot.h, 0.62);

/** A box in the plug's own frame. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Material): Mesh {
  const o = new Mesh(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
  o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return place(o);
}

/** A rounded rectangle drawn into a path, its corners `k` (capped by the sides). */
function roundRect(p: Path, x0: number, y0: number, x1: number, y1: number, k: number): void {
  k = Math.max(0.5, Math.min(k, (x1 - x0) / 2 - 0.5, (y1 - y0) / 2 - 0.5));
  p.moveTo(x0 + k, y0); p.lineTo(x1 - k, y0); p.quadraticCurveTo(x1, y0, x1, y0 + k); p.lineTo(x1, y1 - k); p.quadraticCurveTo(x1, y1, x1 - k, y1);
  p.lineTo(x0 + k, y1); p.quadraticCurveTo(x0, y1, x0, y1 - k); p.lineTo(x0, y0 + k); p.quadraticCurveTo(x0, y0, x0 + k, y0);
}

/**
 * A moulded sleeve of any outline `sh` (drawn in by `bev`, the roll puts it back), `z0` to `z1` along z, its edges rolled `bev`, the whole of it drawn
 * in round its middle to `sx` x `sy` times its size at `z1`.
 */
function loft(sh: Shape, sx: number, sy: number, z0: number, z1: number, bev: number, m: Material): Mesh {
  const d = Math.max(1, z1 - z0 - 2 * bev);
  const g = extrude(sh, { depth: d, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: SEG.plug, curveSegments: SEG.caseCurve }), p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getZ(i) + bev) / (d + 2 * bev);
    p.setXYZ(i, p.getX(i) * (1 + (sx - 1) * t), p.getY(i) * (1 + (sy - 1) * t), z0 + bev + p.getZ(i));
  }
  return place(new Mesh(toCreasedNormals(g, 0.7), m));
}

/** A moulded sleeve: a `w0` x `h0` rounded rectangle at `z0` drawn in to `w1` x `h1` at `z1`, its corners `r`, its edges rolled `bev`. */
function taper(w0: number, h0: number, w1: number, h1: number, z0: number, z1: number, r: number, bev: number, m: Material): Mesh {
  const sh = new Shape();
  roundRect(sh, -w0 / 2 + bev, -h0 / 2 + bev, w0 / 2 - bev, h0 / 2 - bev, r - bev);
  return loft(sh, w1 / w0, h1 / h0, z0, z1, bev, m);
}

/** A ribbed strain relief round the cable, along +z from `z0` (radius `r0`) to `z1` (radius `r1`), a rib every `pitch`. */
function relief(z0: number, z1: number, r0: number, r1: number, pitch: number, rib: number, m: Material): Mesh {
  const L = z1 - z0, n = Math.max(6, Math.round(L / (pitch / 2))), pts = [new Vector2(0, 0)];
  for (let i = 0; i <= n; i++) {
    const t = i / n, ridge = i > 1 && i < n - 1 && i % 2 === 0 ? rib : 0;
    pts.push(new Vector2(r0 + (r1 - r0) * t + ridge, t * L));
  }
  pts.push(new Vector2(0, L));
  const g: BufferGeometry = new LatheGeometry(pts, SEG.disc);
  g.rotateX(Math.PI / 2);
  const o = new Mesh(g, m);
  o.position.z = z0;
  return place(o);
}

/** An outline `w` x `h` round its middle, its two corners on the -y side cut `c` (HDMI's key). */
function keyed(p: Path, w: number, h: number, c: number): Path {
  const x = w / 2, y = h / 2;
  p.moveTo(-x + c, -y); p.lineTo(x - c, -y); p.lineTo(x, -y + c); p.lineTo(x, y); p.lineTo(-x, y); p.lineTo(-x, -y + c); p.lineTo(-x + c, -y);
  return p;
}

/**
 * An HDMI plug: the nickel-plated keyed shell, open at its front, the black insulator in it with the slot the socket's tongue goes into and the
 * 19 gold contacts (ten on the slot's top, nine on its floor); the collar where the shell goes into the boot; the moulded boot, tapering back,
 * its grip ribs across both broad faces; the ribbed strain relief down to the cable.
 */
export function hdmiPlug(f: HdmiFit): { body: Group; l: number } {
  const { k, tip, cable } = f, b = bootScale(k, cable, HDMI.boot.h, 0.68), l = HDMI.l * b, g = new Group();
  const nickel = mat(0xb9babf, { metalness: 0.9, roughness: 0.26 }), black = mat(0x050608, { roughness: 0.7 }), boot = mat(0x1d1e22, { roughness: 0.5 });
  const goldM = mat(0xd4af5f, { metalness: 0.9, roughness: 0.3 });
  const zf = -l - HDMI.in * k, zs = -l + 3 * b, t = Math.max(2, 0.3 * k), iw = tip.w - 2 * t, ih = tip.h - 2 * t;
  // the shell, from its open front to inside the boot
  const out = keyed(new Shape(), tip.w, tip.h, tip.cut) as Shape;
  out.holes.push(keyed(new Path(), iw, ih, Math.max(0.5, tip.cut - t * 0.6)));
  const sg = extrude(out, { depth: zs - zf, bevelEnabled: false, curveSegments: SEG.curveFlat });
  sg.translate(0, 0, zf);
  g.add(place(new Mesh(sg, nickel)));
  // the insulator: solid behind the slot, the slot's walls ahead of it (its front 0.8 mm in from the shell's), the contacts on the slot's walls
  const sw = tip.w * 0.74, sh = Math.min(ih * 0.4, Math.max(2, 1.4 * k)), zi = zf + 0.8 * k, zd = zf + 7 * k;
  g.add(box(-iw / 2, iw / 2, -ih / 2, ih / 2, zd, zs, black));
  g.add(box(-iw / 2, iw / 2, sh / 2, ih / 2, zi, zd, black), box(-iw / 2, iw / 2, -ih / 2, -sh / 2, zi, zd, black));
  g.add(box(-iw / 2, -sw / 2, -sh / 2, sh / 2, zi, zd, black), box(sw / 2, iw / 2, -sh / 2, sh / 2, zi, zd, black));
  const pitch = sw / 10.5, cw = pitch * 0.45, ct = Math.max(0.6, 0.1 * k), cl = 4.5 * k, cz = zi + 0.6 * k + cl / 2, pins = [];
  for (let i = 0; i < 10; i++) pins.push({ x: (i - 4.5) * pitch, y: sh / 2 - ct / 2, z: cz, sx: cw, sy: ct, sz: cl });
  for (let i = 0; i < 9; i++) pins.push({ x: (i - 4) * pitch, y: -sh / 2 + ct / 2, z: cz, sx: cw, sy: ct, sz: cl });
  g.add(place(instanced(new BoxGeometry(1, 1, 1), goldM, pins)));
  // the collar, the boot, its ribs, the strain relief
  const z0 = -l + 1.2 * b, z1 = -l + 2.4 * b, z2 = -l + 23.5 * b, B = HDMI.boot, bw = B.w * b, bh = B.h * b;
  g.add(softBox({ x: -(tip.w / 2 + 0.9 * b), y: -(tip.h / 2 + 0.9 * b), w: tip.w + 1.8 * b, h: tip.h + 1.8 * b }, z0, z1 + 0.5 * b, boot, 0.8 * b));
  g.add(taper(bw, bh, B.w1 * b, B.h1 * b, z1, z2, 2.4 * b, 1.1 * b, boot));
  const ribs = [];
  for (let i = 0; i < 6; i++) {
    const z = z1 + (4.5 + i * 1.7) * b, u = (z - z1) / (z2 - z1), w = (B.w + (B.w1 - B.w) * u) * b, h = (B.h + (B.h1 - B.h) * u) * b;
    for (const s of [-1, 1]) ribs.push({ x: 0, y: s * (h / 2 + 0.05 * b), z, sx: w * 0.62, sy: 0.5 * b, sz: 0.55 * b });
  }
  g.add(place(instanced(new BoxGeometry(1, 1, 1), boot, ribs)));
  const r1 = cable + 0.35 * b, r0 = Math.max(r1 + 0.3 * b, Math.min(4.1 * b, cable + 1.2 * b));
  g.add(relief(z2 - 0.6 * b, 0, r0, r1, 1.6 * b, 0.25 * b, boot));
  return { body: g, l };
}

/** T568B: the eight wires' colours, pin 1 to 8 (white-orange, orange, white-green, blue, white-blue, green, white-brown, brown). */
const PAIRS = [0xf0d7bd, 0xe8772b, 0xd3e8cf, 0x2f63c8, 0xd2dbf1, 0x3a9a4a, 0xe3d6c6, 0x7a4a2a];

/**
 * An RJ45 plug: the clear polycarbonate body, the eight gold blades at 1.02 mm pitch in its front on the contact side, the eight wires (T568B) run
 * up to them and the cable's jacket crimped into its back, seen through it; the latch on the keyed side, its shoulders that catch in the jack, its
 * thumb end out past the mouth; the boot in the cable's colour with its grip ridges, tapering down to the cable.
 */
export function rj45Plug(f: Rj45Fit): { body: Group; l: number } {
  const { k, body: B, latch, cable } = f, b = bootScale(k, cable, RJ45.boot.h, 0.62), l = RJ45.l * b, g = new Group();
  const clear = mat(0xffffff, { transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0 }), lever = mat(0xffffff, { transparent: true, opacity: 0.6, roughness: 0.15 });
  const goldM = mat(0xd4af5f, { metalness: 0.9, roughness: 0.3 }), boot = mat(f.tone, { roughness: 0.55 });
  const zf = -l - RJ45.in * k, zb = -l + RJ45.out * b, hy = B.h / 2;
  // the wires and the jacket inside first (the clear body over them draws after)
  const pitch = Math.min(1.02 * k, B.w / 11), wr = Math.min(0.35 * k, pitch * 0.42), jr = Math.min(cable, hy - 0.6 * k), wy = hy - 2.5 * k;
  PAIRS.forEach((c, i) => g.add(box((i - 3.5) * pitch - wr, (i - 3.5) * pitch + wr, wy - wr, wy + wr, zf + 2 * k, zb - 4 * b, mat(c, { roughness: 0.5 }))));
  const jacket = new Mesh(new CylinderGeometry(jr, jr, 6 * b, SEG.post).rotateX(Math.PI / 2), boot);
  jacket.position.set(0, 0, zb - 3 * b);
  g.add(place(jacket));
  // the blades, standing in their slots at the front with their tops at the contact face
  const blades = [];
  for (let i = 0; i < 8; i++) blades.push({ x: (i - 3.5) * pitch, y: hy - 1.25 * k, z: zf + 2.1 * k, sx: Math.max(1, 0.3 * k), sy: 2.4 * k, sz: 3 * k });
  g.add(place(instanced(new BoxGeometry(1, 1, 1), goldM, blades)));
  const shell = softBox({ x: -B.w / 2, y: -hy, w: B.w, h: B.h }, zf, zb, clear, 0.6 * k);
  shell.renderOrder = 1;
  g.add(shell);
  // the latch: from 3.5 mm behind the front, rising off the keyed side to `rise` at the mouth, on out past it to its thumb end
  const za = zf + 3.5 * k, zt = -l + 4 * Math.min(k, b), rise = (latch.rise * (zt - za)) / (-l - za), th = Math.max(2, 0.9 * k), L = Math.hypot(zt - za, rise);
  const arm = new Mesh(new BoxGeometry(latch.w * 0.62, th, L), lever);
  arm.rotation.x = Math.atan2(rise, zt - za);
  arm.position.set(0, -hy - rise / 2 + th / 2, (za + zt) / 2);
  g.add(place(arm));
  // its shoulders, just in from the mouth, and the thumb end's pad
  const at = (z: number) => -hy - (latch.rise * (z - za)) / (-l - za);
  const s0 = -l - 3.5 * k, s1 = -l - 1.5 * k;
  g.add(box(-latch.w / 2, latch.w / 2, at(s1), -hy + 0.1, s0, s1, lever));
  g.add(box(-latch.w * 0.31, latch.w * 0.31, at(zt) - th * 0.6, at(zt) + th * 0.4, zt - 1.6 * Math.min(k, b), zt, lever));
  // the boot, its ridges across the sides, the relief down to the cable
  const R = RJ45.boot, z2 = zb + 9 * b, ridges = [];
  g.add(taper(R.w * b, R.h * b, R.w1 * b, R.h1 * b, zb, z2, 2 * b, 0.9 * b, boot));
  for (let i = 0; i < 4; i++) {
    const z = zb + (1.8 + i * 1.7) * b, u = (z - zb) / (z2 - zb), w = (R.w + (R.w1 - R.w) * u) * b, h = (R.h + (R.h1 - R.h) * u) * b;
    for (const s of [-1, 1]) ridges.push({ x: s * (w / 2 + 0.05 * b), y: 0, z, sx: 0.5 * b, sy: h * 0.66, sz: 0.6 * b });
  }
  g.add(place(instanced(new BoxGeometry(1, 1, 1), boot, ridges)));
  const r1 = cable + 0.3 * b, r0 = Math.max(r1 + 0.3 * b, Math.min(3.9 * b, cable + 1.2 * b));
  g.add(relief(z2 - 0.5 * b, 0, r0, r1, 1.5 * b, 0.22 * b, boot));
  return { body: g, l };
}

/**
 * The Swiss socket (SN 441011 type 13, for the earthed plug of type 12, "type J") as a flush one shows it, in mm round the middle of its recess (x across,
 * y toward the live and neutral holes): a rounded hexagon pointing sideways, 39 x 22.1 and 13 deep (traced from a photo of a real one: its corners are cut
 * by `round` mm along each edge, the tips 1.4, the others 3.6). The holes are 4.6 across (the pins 4): the live and the neutral one 19 apart on the line
 * `ln`, a hair under the middle, the earth one 5 mm under that line.
 */
export const T13 = {
  hex: [[-9, 11.05], [9, 11.05], [20, 0], [9, -11.05], [-9, -11.05], [-20, 0]], round: [3.6, 3.6, 1.4, 3.6, 3.6, 1.4],
  hole: 4.6, pitch: 19, earth: 5, ln: -0.55, deep: 13,
} as const;

/** A closed outline through the corners `pts`, each corner cut by a curve that starts `radius` along its two edges (at most 45 percent of one). */
function roundedPoly(pts: readonly (readonly [number, number])[], radius: readonly number[], seg: number): [number, number][] {
  const n = pts.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, a = pts[(i + n - 1) % n]!, c = pts[(i + 1) % n]!, la = Math.hypot(a[0] - p[0], a[1] - p[1]), lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const da = Math.min(radius[i]!, la * 0.45), dc = Math.min(radius[i]!, lc * 0.45);
    const A = [p[0] + ((a[0] - p[0]) / la) * da, p[1] + ((a[1] - p[1]) / la) * da], C = [p[0] + ((c[0] - p[0]) / lc) * dc, p[1] + ((c[1] - p[1]) / lc) * dc];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push([u * u * A[0]! + 2 * u * t * p[0] + t * t * C[0]!, u * u * A[1]! + 2 * u * t * p[1] + t * t * C[1]!]);
    }
  }
  return out;
}

/** The recess's outline (`T13.hex`) drawn in by `inset` mm all round, as mm points round the middle: the socket's own, and a plug's head that goes into it. */
export function lozenge(inset = 0, seg = 4): [number, number][] {
  const sx = 1 - inset / 20, sy = 1 - inset / 11.05;
  return roundedPoly(T13.hex.map(([x, y]) => [x * sx, y * sy] as const), T13.round.map((r) => Math.max(0.5, r - inset)), seg);
}

/**
 * A Swiss mains plug's real size (mm), type 12: three round pins 4 across and 19 long on the head's front, the live and the neutral one 19 apart with the root
 * 8.5 mm of each in an insulating sleeve, the earth pin 5 mm under their line with a short collar (a plain nickel pin). The head is the rounded hexagon of the
 * recess (`lozenge`, 0.6 under it) and goes 12.5 into it; the shoulder behind (3 long, 0.6 over the recess: the pinwheel's recesses stand 3 apart, so a
 * plug is no wider than its own); then the grip, drawn in to half its size over 29 with eight ribs across both broad faces, and the ribbed strain relief
 * down to the cord (the last 20); 52 out of the socket to the cord's end. The plug's origin is the middle of its head, at the socket's mouth.
 */
export const SWISS = {
  pin: { d: 4, l: 19, sleeve: 8.5, collar: 6.2, collarL: 2.4 }, head: { l: 12.5, fit: 0.6, roll: 0.8 }, shoulder: { out: 0.6, l: 3 }, grip: { scale: 0.5, ribs: 8 }, relief: 20, l: 52,
} as const;
/** The grip's height where it ends (the hexagon's 22 drawn in), for the share of it the cord takes. */
const SWISS_GRIP_H = 22 * SWISS.grip.scale;

/** A mains plug for one socket: `k` units a mm, the cord's radius and the plug's colour. */
export interface SwissFit { k: number; cable: number; tone: number }
export const swissReal = (cable: number, tone: number): SwissFit => ({ k: MM, cable, tone });
export const swissLength = (f: SwissFit): number => SWISS.l * bootScale(f.k, f.cable, SWISS_GRIP_H, 0.55);

/** The recess's outline `inset` mm in, as a shape of `k` units a mm (a plug's head, a socket's mouth). */
export function lozengeShape(k: number, inset = 0, seg: number = SEG.plug): Shape {
  const s = new Shape(), p = lozenge(inset, seg);
  s.moveTo(p[0]![0] * k, p[0]![1] * k);
  for (let i = 1; i < p.length; i++) s.lineTo(p[i]![0] * k, p[i]![1] * k);
  s.closePath();
  return s;
}

/**
 * A Swiss plug (type 12): the three pins (sleeved at their roots, the earth one with a collar), the head with its edge rolled, the shoulder, the grip
 * with a rib across each broad face, the ribbed strain relief. Its pins go in along -z; the earth pin and the keyed side are at -y, the live and the
 * neutral pin across x (`T13`: they stand over the head's middle, the earth pin under it).
 */
export function swissPlug(f: SwissFit): { body: Group; l: number } {
  const { k, cable } = f, b = bootScale(k, cable, SWISS_GRIP_H, 0.55), l = SWISS.l * b, g = new Group();
  const shell = mat(f.tone, { roughness: 0.55 }), pin = mat(0xb9babf, { metalness: 0.9, roughness: 0.25 }), sleeve = mat(0x050608, { roughness: 0.6 });
  const P = SWISS.pin, H = SWISS.head, S = SWISS.shoulder, G = SWISS.grip, zs = -l, zb = zs - H.l * k, rp = (P.d / 2) * k;
  // (a rod along z at (x, y) from z0 to z1)
  const rod = (x: number, y: number, z0: number, z1: number, r: number, m: Material, sides: number = SEG.part) => {
    const o = new Mesh(new CylinderGeometry(r, r, z1 - z0, sides).rotateX(Math.PI / 2), m);
    o.position.set(x * k, y * k, (z0 + z1) / 2);
    return place(o);
  };
  // the pins from the head's front face: live and neutral over the middle with a sleeve on the root of each, the earth pin under it with its collar
  const yl = T13.ln, ye = T13.ln - T13.earth, tip = zb - P.l * k;
  for (const s of [-1, 1]) g.add(rod((s * T13.pitch) / 2, yl, tip, zb + 0.5 * k, rp, pin), rod((s * T13.pitch) / 2, yl, zb - P.sleeve * k, zb + 0.5 * k, rp * 1.2, sleeve));
  g.add(rod(0, ye, tip, zb + 0.5 * k, rp, pin), rod(0, ye, zb - P.collarL * k, zb + 0.5 * k, (P.collar / 2) * k, sleeve));
  // the head: the recess's outline, a hair in, its front edge rolled, to the mouth (its end under the shoulder)
  g.add(loft(lozengeShape(k, H.fit + H.roll), 1, 1, zb, zs + S.l * k * 0.5, H.roll * k, shell));
  // the shoulder, a hair over the recess's outline; then the grip, its outline a little in, drawn in further over its length (more when the cord is thick:
  // the boot grows to it); the ribs across both broad faces, along the flat of each (the corners are rounded)
  const z2 = zs + (SWISS.l - SWISS.relief) * b, zg = zs + S.l * k, end = Math.min(0.95, (G.scale * b) / k), roll1 = 0.9, roll2 = 1.4;
  g.add(loft(lozengeShape(k, roll1 - S.out), 1, 1, zs, zg + 0.5 * k, roll1 * k, shell));
  g.add(loft(lozengeShape(k, roll2 + 0.2), end, end, zg, z2, roll2 * k, shell));
  const hh = T13.hex[0]![1], half = (z: number) => (hh - 0.2) * (1 - (1 - end) * ((z - zg) / (z2 - zg))) * k, ribs = [];
  for (let i = 0; i < G.ribs; i++) {
    const z = zg + ((i + 0.8) / (G.ribs + 0.3)) * (z2 - zg), s = half(z) / (hh * k);
    for (const side of [-1, 1]) ribs.push({ x: 0, y: side * (half(z) + 0.05 * k), z, sx: 9 * k * s, sy: 0.7 * k, sz: 1.1 * k });
  }
  g.add(place(instanced(new BoxGeometry(1, 1, 1), shell, ribs)));
  // the ribbed strain relief down to the cord
  const r1 = cable + 0.35 * b, r0 = Math.max(r1 + 0.3 * b, Math.min(4.6 * b, cable + 1.6 * b));
  g.add(relief(z2 - 0.6 * b, 0, r0, r1, 2 * b, 0.28 * b, shell));
  return { body: g, l };
}
