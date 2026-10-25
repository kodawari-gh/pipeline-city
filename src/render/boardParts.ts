import { Container, Graphics } from 'pixi.js';
import { box, disc, label, mix } from './ink';
import type { Rect } from './layout';
import { HDR_PITCH, LEG_PITCH, legsOf, m2Contacts, pciePadMax, pciePadX, type IoPort } from './pins';
import type { Palette, Theme } from './theme';

// Drawers for the static components of a motherboard. Everything draws in world coordinates onto one Graphics (`Ctx.g`), the text goes
// to `Ctx.labels` (hidden when zoomed out). Passive parts use the palette (mixed toward the board colour), nothing here glows: the live
// layer lights the buses and the VRM from the same rects.

export interface Ctx { g: Graphics; labels: Container; T: Theme; P: Palette; tier: number }

/** A soft drop shadow under a part that stands off the board. */
export function shadow(c: Ctx, x: number, y: number, w: number, h: number, r: number, off = 12, a = 0.28) {
  box(c.g, x + off, y + off * 1.3, w, h, r, { fill: '#000000', fa: c.T.dark ? a : a * 0.5 });
}

/** Queue pads (small rects centred on the points) in the colour of the palette's plated copper. */
export function padsAt(c: Ctx, pts: [number, number][], w: number, h: number, a = 0.85, color?: string) {
  for (const [x, y] of pts) c.g.rect(x - w / 2, y - h / 2, w, h);
  c.g.fill({ color: color ?? c.P.via, alpha: a });
}

/** A row of `n` small rects along a line (pins, legs, vents). */
export function row(c: Ctx, x: number, y: number, n: number, dx: number, dy: number, w: number, h: number) {
  for (let i = 0; i < n; i++) c.g.rect(x + i * dx - w / 2, y + i * dy - h / 2, w, h);
}

/** A mounting hole with its screw: a copper-ringed pad, the washer, a pan head with a cross slot (it threads into the case's standoff below). */
export function hole(c: Ctx, x: number, y: number, r = 74) {
  const { g, P, T } = c;
  disc(g, x, y, r + 34, { fill: P.board }); // the keepout: bare board round the screw, whatever was drawn under it
  disc(g, x, y, r, { fill: P.panel, stroke: P.edge, lw: 8 });
  disc(g, x, y, r + 26, { stroke: P.silk, lw: 4, sa: 0.35 });
  const head = mix(P.panel, '#ffffff', T.dark ? 0.3 : 0.55), rim = mix(P.edge, '#ffffff', 0.25);
  disc(g, x + 4, y + 7, r * 0.78, { fill: '#000000', fa: T.dark ? 0.35 : 0.18 });                 // its shadow
  disc(g, x, y, r * 0.78, { fill: mix(P.panel, '#ffffff', T.dark ? 0.16 : 0.35), stroke: rim, lw: 3, sa: 0.8 }); // the washer
  disc(g, x, y, r * 0.58, { fill: head, stroke: rim, lw: 3, sa: 0.9 });                           // the head
  const k = r * 0.36;
  g.moveTo(x - k, y).lineTo(x + k, y).moveTo(x, y - k).lineTo(x, y + k).stroke({ width: 8, color: P.dark, alpha: 0.85, cap: 'round' }); // the cross slot
  g.moveTo(x + Math.cos(3.6) * r * 0.46, y + Math.sin(3.6) * r * 0.46).arc(x, y, r * 0.46, 3.6, 5.0).stroke({ width: 4, color: '#ffffff', alpha: T.dark ? 0.35 : 0.7 }); // a highlight
}

/** A square-ish IC with `legs` legs on every side (centred, `pitch` apart: the same positions `legAt` gives the router), a pin-1 dot and an optional label. */
export function chip(c: Ctx, r: Rect, o: { legs?: number; pitch?: number; text?: string; size?: number; tone?: string; accent?: string; round?: number } = {}) {
  const { g, P, T } = c;
  const legs = o.legs ?? 6, pitch = o.pitch ?? Math.min(r.w, r.h) / (legs + 1);
  const tone = o.tone ?? P.dark;
  shadow(c, r.x, r.y, r.w, r.h, 8, 8, 0.3);
  legRects(c, r, legs, pitch);
  g.fill({ color: P.silkHi, alpha: 0.55 });
  box(g, r.x, r.y, r.w, r.h, o.round ?? 8, { fill: tone, stroke: o.accent ?? P.edge, lw: 4, sa: o.accent ? 0.55 : 0.9 });
  g.rect(r.x + 6, r.y + 6, r.w - 12, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.07 : 0.22 });
  disc(g, r.x + 22, r.y + 22, 8, { fill: P.silk, fa: 0.5 });
  if (o.text) c.labels.addChild(label(o.text, r.x + r.w / 2, r.y + r.h / 2, o.size ?? 44, o.accent ?? T.mul, { head: true, anchor: [0.5, 0.5], a: 0.6 }));
}

/** Queue the legs of a chip on all four sides (n each, or as many as fit when 0), at the pin-map positions; the caller fills. */
export function legRects(c: Ctx, r: Rect, n: number, pitch = LEG_PITCH) {
  for (const side of ['n', 's'] as const) for (const [x, y] of legsOf(r, side, n || undefined, pitch)) c.g.rect(x - 5, y - 10, 10, 20);
  for (const side of ['w', 'e'] as const) for (const [x, y] of legsOf(r, side, n || undefined, pitch)) c.g.rect(x - 10, y - 5, 20, 10);
}

/** An electrolytic or polymer capacitor seen from above: a can with a polarity band and a vent cross. */
export function cap(c: Ctx, x: number, y: number, r: number, accent?: string) {
  const { g, P, T } = c;
  disc(g, x + 6, y + 9, r, { fill: '#000000', fa: T.dark ? 0.3 : 0.15 });
  disc(g, x, y, r, { fill: P.panel, stroke: accent ?? P.via, lw: 5, sa: 0.75 });
  disc(g, x, y, r * 0.66, { fill: mix(P.panel, '#ffffff', T.dark ? 0.06 : 0.25), stroke: P.edge, lw: 3, sa: 0.8 });
  g.moveTo(x + Math.cos(2.2) * r * 0.84, y + Math.sin(2.2) * r * 0.84).arc(x, y, r * 0.84, 2.2, 4.1).stroke({ width: Math.max(5, r * 0.2), color: P.silkHi, alpha: 0.55 });
  g.moveTo(x - r * 0.28, y - r * 0.1).lineTo(x + r * 0.28, y + r * 0.1).moveTo(x - r * 0.28, y + r * 0.1).lineTo(x + r * 0.28, y - r * 0.1).stroke({ width: 3, color: P.edge, alpha: 0.7 });
}

/** A power inductor (metal-alloy choke): block, bevel, a winding cut across it. */
export function choke(c: Ctx, x: number, y: number, w: number, h: number) {
  const { g, P, T } = c;
  shadow(c, x, y, w, h, 14, 12, 0.32);
  box(g, x, y, w, h, 14, { fill: mix(P.dark, P.panel, 0.2), stroke: P.edge, lw: 5 });
  box(g, x + 12, y + 12, w - 24, h - 24, 8, { fill: mix(P.dark, P.panel, 0.45), stroke: P.copper, lw: 6, sa: 0.7 });
  g.moveTo(x + w * 0.5, y + 16).lineTo(x + w * 0.5, y + h - 16).stroke({ width: 5, color: P.copper, alpha: 0.55 });
  g.rect(x + 8, y + 6, w - 16, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.08 : 0.25 });
}

/** A DrMOS power stage: a square package with a heat pad and legs on three sides. */
export function powerStage(c: Ctx, x: number, y: number, s: number) {
  const { g, P, T } = c;
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.7) * (s / 7.4);
    g.rect(x - 16, y + t, 18, 11).rect(x + s - 2, y + t, 18, 11).rect(x + t, y + s - 2, 11, 18);
  }
  g.fill({ color: P.via, alpha: 0.7 });
  box(g, x, y, s, s, 8, { fill: P.dark, stroke: P.edge, lw: 4 });
  box(g, x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64, 4, { fill: mix(P.dark, P.copper, 0.35), fa: 0.9 });
  disc(g, x + 18, y + 18, 7, { fill: P.silk, fa: 0.5 });
  g.rect(x + 6, y + 5, s - 12, 4).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.2 });
}

/** A strip of small SMD passives (capacitors, resistors) in a line. */
export function smd(c: Ctx, x: number, y: number, n: number, dx: number, dy: number, w = 30, h = 18, a = 0.9) {
  const { g, P } = c;
  for (let i = 0; i < n; i++) g.rect(x + i * dx - w / 2, y + i * dy - h / 2, w, h);
  g.fill({ color: P.panel, alpha: a });
  for (let i = 0; i < n; i++) g.rect(x + i * dx - w / 2, y + i * dy - h / 2, w * 0.24, h).rect(x + i * dx + w / 2 - w * 0.24, y + i * dy - h / 2, w * 0.24, h);
  g.fill({ color: P.via, alpha: 0.65 });
}

/** Via dots on a regular grid inside a rect (a ground / power pour's stitching). */
export function stitch(c: Ctx, r: Rect, pitch: number, rad = 6, a = 0.35) {
  const { g, P } = c;
  for (let x = r.x + pitch / 2; x < r.x + r.w; x += pitch) for (let y = r.y + pitch / 2; y < r.y + r.h; y += pitch) g.circle(x, y, rad);
  g.fill({ color: P.via, alpha: a });
}

/** One CPU VRM phase block: input feed, power stage, choke, output capacitors, the traces between them. Flow is top to bottom. */
export function vrmPhaseArt(c: Ctx, r: Rect, empty: boolean, railY: number) {
  const { g, P } = c;
  box(g, r.x, r.y, r.w, r.h, 18, { fill: P.dark, fa: 0.3, stroke: P.edge, lw: 4, sa: 0.5 });
  if (empty) return;
  const fx = r.x + 24, fy = r.y + 40, ps = 130;
  // input: a stub from the rail down to the power stage and the input capacitors
  g.rect(r.x + 60 - 14, railY + 22, 28, fy - railY - 22).fill({ color: P.copper, alpha: 0.85 });
  smd(c, r.x + 232, r.y + 42, 3, 0, 36, 34, 20); // input decoupling
  g.moveTo(r.x + 232, r.y + 20).lineTo(r.x + 232, railY + 22).stroke({ width: 10, color: P.copper, alpha: 0.7 });
  powerStage(c, fx, fy, ps);
  // phase node: power stage to choke, a short fat trace
  g.rect(r.x + 60 - 20, fy + ps + 2, 40, 40).fill({ color: P.copper, alpha: 0.9 });
  choke(c, r.x + 20, r.y + 214, 160, 150);
  // output: the choke's output goes right and down to the capacitors, then into the plane
  g.moveTo(r.x + 180, r.y + 290).lineTo(r.x + 265, r.y + 290).lineTo(r.x + 265, r.y + r.h - 4).stroke({ width: 26, color: P.copper, alpha: 0.9, join: 'round', cap: 'butt' });
  cap(c, r.x + 265, r.y + 250, 40);
  cap(c, r.x + 265, r.y + 345, 40);
  smd(c, r.x + 30, r.y + 420, 5, 56, 0, 24, 30, 0.8);
}

/** The memory regulator's phase block (small): power stage, choke, one capacitor. Flow is top to bottom into the rail. */
export function dramPhaseArt(c: Ctx, r: Rect, railY: number) {
  const { g, P } = c;
  box(g, r.x, r.y, r.w, r.h, 14, { fill: P.dark, fa: 0.3, stroke: P.edge, lw: 4, sa: 0.5 });
  g.rect(r.x + 40, railY + 18, 24, r.y + 30 - railY - 18).fill({ color: P.copper, alpha: 0.85 });
  powerStage(c, r.x + 14, r.y + 30, 90);
  smd(c, r.x + 128, r.y + 60, 3, 0, 32, 28, 18);
  g.rect(r.x + 40, r.y + 122, 30, 26).fill({ color: P.copper, alpha: 0.9 });
  choke(c, r.x + 14, r.y + 148, 110, 96);
  cap(c, r.x + 120, r.y + 262, 30);
  g.moveTo(r.x + 124, r.y + 196).lineTo(r.x + 124, r.y + r.h - 4).stroke({ width: 22, color: P.copper, alpha: 0.9 });
}

/**
 * A DIMM socket: housing, centre slot with pins and a key. The data end (row 0: south, row 1: north) carries the pad bar the memory
 * lanes land on (`dimmPads`), with no latch; the latch is at the far end, beside the memory-voltage pad.
 */
export function dimmSocket(c: Ctx, r: Rect, flip: boolean, n: number) {
  const { g, P } = c;
  shadow(c, r.x, r.y, r.w, r.h, 10, 8, 0.25);
  box(g, r.x, r.y, r.w, r.h, 10, { fill: P.sub, stroke: P.edge, lw: 6 });
  const cx = r.x + r.w / 2;
  const dataY = flip ? r.y : r.y + r.h, dir = flip ? 1 : -1; // from the data end into the housing
  box(g, cx - 24, r.y + 40, 48, r.h - 80, 6, { fill: P.dark });
  for (let k = 0; k < Math.floor((r.h - 100) / 22); k++) g.rect(cx - 40, r.y + 50 + k * 22, 9, 12).rect(cx + 31, r.y + 50 + k * 22, 9, 12);
  g.fill({ color: P.via, alpha: 0.55 });
  const ky = flip ? r.y + r.h * 0.6 : r.y + r.h * 0.4; // the key: a bar across the slot, off centre
  g.rect(cx - 26, ky - 6, 52, 12).fill({ color: P.sub });
  // the pad bar: a dark strip across the data end the lanes enter (the pads themselves are drawn over the lane ends)
  box(g, r.x + 14, Math.min(dataY, dataY + dir * 62), r.w - 28, 62, 6, { fill: P.dark, stroke: P.edge, lw: 3, sa: 0.8 });
  // the latch at the far end, outside the housing, clear of the memory-voltage pad (r.x + 36)
  const fy = flip ? r.y + r.h - 2 : r.y - 24;
  box(g, r.x + 70, fy, r.w - 86, 26, 8, { fill: P.panel, stroke: P.edge, lw: 4 });
  g.rect(r.x + 90, flip ? fy + 8 : fy + 10, r.w - 126, 6).fill({ color: P.silk, alpha: 0.4 });
  c.labels.addChild(label('DIMM_' + (n + 1), r.x + r.w, flip ? r.y + r.h + 46 : r.y - 62, 34, c.P.silk, { anchor: [1, 0.5] }));
}

/** A PCIe slot: housing, slot opening with a key, pins, a retention latch at the end, and the staggered SMT pads along both long edges. */
export function pcieSlot(c: Ctx, r: Rect, name: string, armor: boolean, big: boolean) {
  const { g, P } = c;
  shadow(c, r.x, r.y, r.w, r.h, 10, 8, 0.25);
  box(g, r.x, r.y, r.w, r.h, 10, { fill: P.sub, stroke: armor ? P.silkHi : P.edge, lw: armor ? 6 : 5, sa: armor ? 0.7 : 1 });
  g.rect(r.x + 40, r.y + 16, r.w - 90, 26).fill({ color: P.dark });
  const keyX = r.x + Math.min(r.w * 0.2, 700);
  g.rect(keyX, r.y + 12, 18, 34).fill({ color: P.sub });
  for (let k = 0; k < Math.floor((r.w - 110) / 20); k++) g.rect(r.x + 52 + k * 20 - 4, r.y + 20, 8, 18);
  g.fill({ color: P.via, alpha: 0.5 });
  // the pads: top row every 40 from x + 20, bottom row offset by 20 (the pins alternate sides); lanes land on the top ones
  for (let k = 0; k <= pciePadMax(r); k++) {
    const x = pciePadX(r, k);
    g.rect(x - 7, r.y - 11, 14, 24).rect(x + 13, r.y + r.h - 13, 14, 24);
  }
  g.fill({ color: P.via, alpha: 0.5 });
  box(g, r.x + r.w - 6, r.y + 6, 50, r.h - 12, 8, { fill: P.panel, stroke: P.edge, lw: 4 });
  if (armor) g.rect(r.x + 14, r.y + 4, r.w - 28, 4).fill({ color: '#ffffff', alpha: c.T.dark ? 0.12 : 0.35 });
  c.labels.addChild(label(name, r.x, r.y - 36, big ? 38 : 34, P.silk));
}

/**
 * The x16 slot's release button: a raised thumb tab on the latch (it rocks the hook out of the card's notch), with grip ridges and a shadow on the
 * board. Drawn after the slot's power tab, over it: the tab is a pad on the board, the button stands above.
 */
export function pcieRelease(c: Ctx, r: Rect) {
  const { g, P } = c, bx = r.x + r.w + 2, by = r.y + r.h / 2 - 12, w = 40, h = 52;
  shadow(c, bx, by, w, h, 10, 9, 0.4);
  box(g, bx, by, w, h, 10, { fill: P.panel, stroke: P.edge, lw: 4 });
  g.rect(bx + 5, by + 4, w - 10, 5).fill({ color: P.silkHi, alpha: 0.35 }); // the lit top edge
  for (let k = 0; k < 3; k++) g.rect(bx + 9, by + 21 + k * 9, w - 18, 4);
  g.fill({ color: P.silk, alpha: 0.4 });
}

/** A power connector: housing with a grid of cavities, a latch ridge on the open side. */
export function powerConn(c: Ctx, r: Rect, cols: number, rows: number, name: string, mouth: 'e' | 'n', a = 1, nameAt?: [number, number, number]) {
  const { g, P } = c;
  shadow(c, r.x, r.y, r.w, r.h, 14, 10, 0.28);
  box(g, r.x, r.y, r.w, r.h, 14, { fill: P.sub, stroke: P.via, lw: 6, fa: a, sa: a * 0.8 });
  const horizontal = mouth === 'n'; // 8-pin: cavities in `cols` along x and `rows` along y
  // every cavity is the same size on both connectors (a real EPS plug has the 24-pin's pitch and cavities), centred in its cell
  const pw = 70, ph = horizontal ? Math.min(60, (r.h - 60) / rows - 14) : Math.min(60, (r.h - 60) / cols - 18);
  if (horizontal) {
    const cw = (r.w - 80) / cols, ch = (r.h - 60) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.rect(r.x + 40 + (i + 0.5) * cw - pw / 2, r.y + 38 + (j + 0.5) * ch - ph / 2, pw, ph);
  } else {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) g.rect(r.x + 40 + j * 110, r.y + 30 + i * ((r.h - 60) / rows) + 6, pw, ph);
  }
  g.fill({ color: P.via, alpha: 0.8 * a });
  // latch ridge
  if (horizontal) g.rect(r.x + 20, r.y + 8, r.w - 40, 8).fill({ color: P.silkHi, alpha: 0.4 * a });
  else g.rect(r.x + r.w - 20, r.y + 20, 8, r.h - 40).fill({ color: P.silkHi, alpha: 0.4 * a });
  const at = nameAt ?? [r.x + r.w, r.y - 34, 1];
  c.labels.addChild(label(name, at[0], at[1], 32, P.silk, { a, anchor: [at[2], 0.5] }));
}

/** A pin header (cols x rows, 0.1 inch pitch): body, gold pins, a pin-1 mark, its name above. */
export function header(c: Ctx, x: number, y: number, cols: number, rows: number, name: string) {
  const { g, P } = c, pitch = HDR_PITCH, w = cols * pitch + 24, h = rows * pitch + 24;
  box(g, x, y, w, h, 8, { fill: P.dark, stroke: P.edge, lw: 4 });
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.rect(x + 12 + i * pitch + 10, y + 12 + j * pitch + 10, 28, 28);
  g.fill({ color: c.T.pin, alpha: 0.75 });
  g.poly([x + 4, y - 12, x + 22, y - 12, x + 4, y - 30]).fill({ color: P.silkHi, alpha: 0.6 });
  c.labels.addChild(label(name, x, y - 46, 28, P.silk, { anchor: [0, 0.5] }));
  return { x, y, w, h };
}

/** A SATA port (mouth east): housing, the L-shaped opening with its key, the pin row, a latch lip. */
export function sataPortArt(c: Ctx, p: Rect, i: number, live: boolean) {
  const { g, P } = c, a = live ? 1 : 0.35;
  shadow(c, p.x, p.y, p.w, p.h, 10, 8, 0.25 * a);
  box(g, p.x, p.y, p.w, p.h, 10, { fill: P.sub, stroke: P.edge, lw: 5, fa: a, sa: a });
  g.poly([p.x + 150, p.y + 20, p.x + p.w - 20, p.y + 20, p.x + p.w - 20, p.y + p.h - 20, p.x + 150, p.y + p.h - 20, p.x + 150, p.y + p.h - 52, p.x + 210, p.y + p.h - 52, p.x + 210, p.y + 52, p.x + 150, p.y + 52])
    .fill({ color: P.dark, alpha: a });
  for (let k = 0; k < 7; k++) g.rect(p.x + 56 + k * 12, p.y + 20, 6, 20);
  g.fill({ color: P.via, alpha: 0.55 * a });
  g.rect(p.x + p.w - 8, p.y + 14, 10, p.h - 28).fill({ color: P.silk, alpha: 0.35 * a });
  // the solder tails on the west edge (the three signal lanes land on them; the housing's own pins sit behind)
  for (const dy of [-26, 0, 26]) g.rect(p.x - 12, p.y + p.h / 2 + dy - 8, 30, 16);
  g.fill({ color: P.via, alpha: 0.7 * a });
  c.labels.addChild(label('SATA' + i, p.x + p.w / 2, p.y - 24, 30, P.silk, { anchor: [0.5, 0.5], a }));
}

/**
 * A rear I/O connector seen from above, mouth facing west: 3.5 mm audio jack (coloured collar and nut), RJ45 (shielded shell, the
 * latch window and the contact row), HDMI / DisplayPort (the D-shaped shell with its tongue), USB-A (shell and coloured tongue). A
 * connector the board does not carry is a bare outline on the plate.
 */
export function ioConnector(c: Ctx, p: IoPort, fitted: boolean) {
  const { g, P, T } = c, y0 = p.y - p.h / 2;
  const tone = p.tone === 'st' ? T.st : p.tone === 'br' ? T.br : p.tone === 'ld' ? T.ld : p.tone === 'alu' ? T.alu : null;
  if (!fitted) { box(g, p.x, y0, p.w, p.h, 10, { stroke: P.edge, lw: 3, sa: 0.3 }); return; }
  shadow(c, p.x, y0, p.w, p.h, 10, 6, 0.3);
  const shine = (x: number, w: number) => g.rect(x, y0 + 5, w, 4).fill({ color: '#ffffff', alpha: T.dark ? 0.08 : 0.28 });
  switch (p.kind) {
    case 'jack': {
      box(g, p.x, y0, p.w, p.h, 10, { fill: P.dark, stroke: P.edge, lw: 5 });
      g.rect(p.x, y0 + 4, 30, p.h - 8).fill({ color: tone ?? P.edge, alpha: 0.8 });                  // the coloured collar at the mouth
      box(g, p.x + 54, y0 - 6, 18, p.h + 12, 5, { fill: P.panel, stroke: P.edge, lw: 4 });           // the nut
      g.rect(p.x + 84, p.y - 9, p.w - 130, 18).fill({ color: P.sub, alpha: 0.7 });                     // the bore
      for (const dy of [-18, 0, 18]) g.rect(p.x + p.w - 6, p.y + dy - 5, 14, 10);                    // solder lugs
      g.fill({ color: P.via, alpha: 0.7 });
      shine(p.x + 36, p.w - 80);
      break;
    }
    case 'rj45': {
      box(g, p.x, y0, p.w, p.h, 10, { fill: P.dark, stroke: P.edge, lw: 5 });
      box(g, p.x + 10, y0 + 28, p.w - 90, p.h - 56, 8, { fill: mix(P.dark, '#000000', 0.5), stroke: P.edge, lw: 3 }); // the cavity
      for (let k = 0; k < 8; k++) g.rect(p.x + 36 + k * 28, y0 + 40, 12, 56);                         // the eight contacts
      g.fill({ color: P.via, alpha: 0.55 });
      box(g, p.x + p.w - 62, p.y - 40, 38, 80, 6, { stroke: P.edge, lw: 3, sa: 0.8 });                // the latch window in the shell
      shine(p.x + 12, p.w - 24);
      break;
    }
    case 'hdmi': case 'dp': {
      const x = p.x, w = p.w, h = p.h, cc = 26, up = p.kind === 'hdmi';
      const pts = up
        ? [x, y0 + cc, x + cc, y0, x + w, y0, x + w, y0 + h, x + cc, y0 + h, x, y0 + h - cc]
        : [x, y0, x + w, y0, x + w, y0 + h, x + cc, y0 + h, x, y0 + h - cc];
      g.poly(pts).fill({ color: P.dark }).stroke({ width: 6, color: P.edge });
      g.rect(x + 40, p.y - h * 0.12, w - 90, h * 0.24).fill({ color: P.via, alpha: 0.7 });            // the tongue's contacts
      for (let k = 0; k < 9; k++) g.rect(x + 46 + k * 16, p.y - h * 0.3, 7, h * 0.18).rect(x + 46 + k * 16, p.y + h * 0.12, 7, h * 0.18);
      g.fill({ color: P.via, alpha: 0.5 });
      shine(x + cc, w - cc - 10);
      break;
    }
    default: { // USB-A
      box(g, p.x, y0, p.w, p.h, 10, { fill: P.dark, stroke: P.edge, lw: 5 });
      box(g, p.x + 8, y0 + 8, p.w - 16, p.h - 16, 6, { stroke: P.silkHi, lw: 3, sa: 0.4 });          // the metal shell's inner lip
      g.rect(p.x + 18, p.y - p.h * 0.14, p.w - 36, p.h * 0.28).fill({ color: tone ?? P.edge, alpha: 0.55 }); // the tongue
      for (let k = 0; k < 4; k++) g.rect(p.x + p.w - 78 + k * 14, p.y - 6, 7, 12);                    // its four contacts
      g.fill({ color: P.via, alpha: 0.8 });
      shine(p.x + 14, p.w - 28);
    }
  }
}
