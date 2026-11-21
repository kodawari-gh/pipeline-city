import type { Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import { glyphKit, type Put } from '../../../cpu/render/die/blockart';
import { STRETCH } from '../jackleds';
import { fmtFrames, fmtPct, fmtSpeed } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import { macOf } from './nicmac';
import type { NicBlock, NicPlanInput } from './nicplan';
import type { NicShow } from './nicshow';

// What is inside a block of the NIC card (docs/render/net.md "Inside the NIC and the router"): the schematic an engineer would draw for the part, drawn with the CPU
// die's own tools (`glyphKit`) so the card and the dies read as one family. The jack is its face with the mouth, the eight contacts and the two lights; the magnetics
// are the four transformers of the four pairs; the PHY a chain of front end, DSP and coding on each pair; the MAC an Ethernet frame as its fields; the statistics the
// port's counters; each queue a ring of slots and the transfers in flight; the DMA engine the two ways a frame goes to and from RAM; the PCIe core its lanes; the
// flash a SOIC-8 with the card's address; the crystal and the regulator and the heat sensor each their own part. Pure drawing into a Graphics (and a callback for the
// few labels); the rectangles the live layer lights are the `*Geom` functions below, shared by the drawing and by `nicLive`.

export const NIC_GLYPH_KINDS = new Set<NicBlock['kind']>(['jack', 'mag', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie', 'nvm', 'xtal', 'vreg', 'temp']);

/** The area a symbol may use: the block under its name, or null when the block is too small. */
export function nicGlyphArea(b: Pick<NicBlock, 'kind' | 'rect'>): Rect | null {
  if (!NIC_GLYPH_KINDS.has(b.kind)) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

/** The size of a label inside a symbol (plan units): the card's plan is drawn four times wider than a die's, so its small print is larger than the die's 6 to 8. */
const LAB = 11;
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);
/** The speed pairs of the cable, as the standards name them. */
export const PAIRS = ['A', 'B', 'C', 'D'] as const;
/** The Ethernet frame's fields and the width each takes in the drawing (not to scale: the payload is up to 1500 bytes, the rest a few). */
export const FRAME_FIELDS = [['PRE', 10], ['DST', 14], ['SRC', 14], ['TYPE', 9], ['PAYLOAD', 41], ['FCS', 12]] as const;
/** The three stages each pair goes through in the PHY. */
export const PHY_STAGES = ['AFE', 'DSP', 'PCS'] as const;

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** The jacks: each a face (the shield, the mouth, the eight contacts, the two lights), the status lines under them. */
export function jackGeom(a: Rect, ports: number) {
  const textH = 50, gap = 10, area = R(a.x, a.y, a.w, a.h - textH), ph = (area.h - (ports - 1) * gap) / ports, pw = Math.min(area.w * 0.86, ph * 1.2), h = Math.min(ph, pw / 1.05);
  return {
    text: R(a.x, a.y + a.h - textH, a.w, textH),
    ports: Array.from({ length: ports }, (_, k) => {
      const y = area.y + k * (ph + gap) + (ph - h) / 2, x = a.x + (a.w - pw) / 2, shell = R(x, y, pw, h), mouth = R(x + pw * 0.12, y + h * 0.3, pw * 0.76, h * 0.6);
      return {
        shell, mouth, link: R(x + pw * 0.1, y + h * 0.07, pw * 0.18, h * 0.12), act: R(x + pw * 0.72, y + h * 0.07, pw * 0.18, h * 0.12),
        contacts: Array.from({ length: 8 }, (_, j) => R(mouth.x + mouth.w * 0.08 + (j * mouth.w * 0.84) / 8 + 1, mouth.y + mouth.h * 0.5, Math.max(1.5, (mouth.w * 0.84) / 8 - 2), mouth.h * 0.46)),
      };
    }),
  };
}

/** The magnetics: a transformer for each of the four pairs, the line side on the left, the chip side on the right. */
export function magGeom(a: Rect) {
  const pitch = a.h / 4, lw = 22;
  return PAIRS.map((name, k) => {
    const y = a.y + k * pitch, row = R(a.x + lw, y + 3, a.w - lw, pitch - 8), cw = (row.w - 22) / 2;
    return { name, y, row, left: R(row.x, row.y, cw, row.h), right: R(row.x + cw + 22, row.y, cw, row.h), cy: row.y + row.h / 2 };
  });
}

/** The PHY: a row for each pair with its three stages, the speed gauge and the line under it. */
export function phyGeom(a: Rect) {
  const lw = 20, foot = 50, pitch = (a.h - foot) / 4, gap = 12, sw = (a.w - lw - 2 * gap) / 3;
  return {
    pairs: PAIRS.map((name, k) => {
      const y = a.y + k * pitch, h = Math.min(30, pitch - 8), cy = y + pitch / 2;
      return { name, cy, stages: PHY_STAGES.map((_, j) => R(a.x + lw + j * (sw + gap), cy - h / 2, sw, h)) };
    }),
    gauge: R(a.x, a.y + a.h - foot + 8, a.w, 12), note: R(a.x, a.y + a.h - foot + 24, a.w, 24), gap,
  };
}

/** The MAC: the frame as its fields, the lane a received frame runs along and the lane a sent one runs along under it. */
export function macGeom(a: Rect) {
  const total = FRAME_FIELDS.reduce((s, f) => s + f[1], 0), fh = Math.min(30, a.h * 0.3);
  let x = a.x;
  const fields = FRAME_FIELDS.map((f) => { const w = (a.w * f[1]) / total, r = R(x, a.y + 2, w - 1.5, fh); x += w; return r; });
  const lane = (y: number) => R(a.x + 22, y, a.w - 22, Math.min(14, (a.h - fh - 14) / 3));
  const rx = lane(a.y + fh + 12), tx = lane(rx.y + rx.h + 8);
  return { fields, rx, tx, note: R(a.x, tx.y + tx.h + 6, a.w, Math.max(10, a.y + a.h - (tx.y + tx.h + 6))) };
}

/** The statistics: the two counters and the two load bars. */
export function statsGeom(a: Rect) {
  const rh = Math.min(22, (a.h - 12) / 3), nw = 40;
  const row = (k: number) => R(a.x, a.y + k * (rh + 4), a.w, rh);
  const bar = (k: number) => { const w = (a.w - 12) / 2; return R(a.x + k * (w + 12), a.y + 2 * (rh + 4) + 2, w, rh - 4); };
  return { rx: row(0), tx: row(1), rxVal: R(a.x + nw, row(0).y, a.w - nw, rh), txVal: R(a.x + nw, row(1).y, a.w - nw, rh), rxBar: bar(0), txBar: bar(1), nw };
}

/** A queue: the ring of slots along its top, and below it the transfers in flight, a row each. */
export function queueGeom(a: Rect, ring: number) {
  const ch = 16, cw = (a.w - 8) / ring, rows = Math.max(0, Math.min(3, Math.floor((a.h - ch - 8) / 26)));
  return {
    cells: Array.from({ length: ring }, (_, k) => R(a.x + k * cw + 1, a.y + 1, cw - 2, ch)), ringBox: R(a.x, a.y, ring * cw, ch + 2),
    flows: Array.from({ length: rows }, (_, k) => { const y = a.y + ch + 8 + k * 26, h = 22; return { row: R(a.x, y, a.w, h), label: R(a.x + 2, y, a.w * 0.5, h), bar: R(a.x + a.w * 0.53, y + h * 0.28, a.w * 0.34, h * 0.44), pct: R(a.x + a.w * 0.89, y, a.w * 0.11, h) }; }),
  };
}

/** The DMA engine: the descriptor ring, the two ways a frame goes (into RAM, out of RAM) and the line that counts them. */
export function dmaGeom(a: Rect) {
  const rh = Math.min(46, a.h * 0.2), gap = 14, ey = a.y + rh + gap, eh = Math.max(40, a.h - rh - 2 * gap - 34);
  const cw = (a.w - 2 * 8) / 6;
  return {
    ring: R(a.x, a.y, a.w, rh), cells: Array.from({ length: 6 }, (_, k) => R(a.x + 8 + k * cw + 1, a.y + rh * 0.28, cw - 2, rh * 0.44)),
    engine: R(a.x, ey, a.w, eh), down: R(a.x + a.w * 0.12, ey + 8, a.w * 0.32, eh - 16), up: R(a.x + a.w * 0.56, ey + 8, a.w * 0.32, eh - 16), note: R(a.x, a.y + a.h - 28, a.w, 28),
  };
}

/** The PCIe core: a lane is two pairs, one into the card and one out of it. */
export function pcieGeom(a: Rect, lanes: number) {
  const cw = Math.min(30, (a.w - 4) / lanes), x0 = a.x + (a.w - lanes * cw) / 2, h = Math.max(30, a.h - 66), y = a.y + 6;
  return {
    lanes: Array.from({ length: lanes }, (_, k) => ({ idx: k, rx: R(x0 + k * cw + cw * 0.12, y, cw * 0.34, h), tx: R(x0 + k * cw + cw * 0.54, y, cw * 0.34, h), tag: { x: x0 + k * cw + cw / 2, y: y + h + 9 } })),
    note: R(a.x, y + h + 18, a.w, Math.max(12, a.y + a.h - (y + h + 18))),
  };
}

/** The flash: its SOIC-8 on the left, the card's address and the line about it on the right. */
export function nvmGeom(a: Rect) {
  const w = Math.min(70, a.w * 0.3), h = Math.min(a.h, 38), body = R(a.x + 8, a.y + (a.h - h) / 2, w, h);
  return { body, mac: R(body.x + w + 14, a.y, a.x + a.w - (body.x + w + 14), a.h / 2), note: R(body.x + w + 14, a.y + a.h / 2, a.x + a.w - (body.x + w + 14), a.h / 2) };
}

/** The crystal: its can and the wave it makes. */
export function xtalGeom(a: Rect) {
  const w = Math.min(56, a.w * 0.2), h = Math.min(a.h, 22), can = R(a.x + 8, a.y + (a.h - h) / 2, w, h);
  return { can, wave: R(can.x + w + 14, a.y, a.x + a.w - (can.x + w + 14), a.h) };
}

/** The regulator: the inductor, the two capacitors and the bar of the power it passes. */
export function vregGeom(a: Rect) {
  const bx = a.x + 128;
  return { coil: R(a.x + 4, a.y, 60, a.h), caps: [R(a.x + 76, a.y + a.h * 0.15, 12, a.h * 0.7), R(a.x + 96, a.y + a.h * 0.15, 12, a.h * 0.7)], bar: R(bx, a.y + a.h * 0.3, a.x + a.w - bx, a.h * 0.4) };
}

/** The heat sensor: the scale from room temperature to the damage point, with the throttle and unstable marks on it. */
export function tempGeom(a: Rect) {
  const sx = a.x + 40, bar = R(sx, a.y + a.h * 0.3, a.w - 40 - 8, a.h * 0.4);
  return { bar, icon: { cx: a.x + 16, cy: a.y + a.h / 2, h: a.h } };
}

/** A temperature's place on the sensor's scale (0 at 20 degrees, 1 at the damage point). */
export const tempAt = (c: number, damage: number): number => Math.min(1, Math.max(0, (c - 20) / Math.max(1, damage - 20)));

// ---------------------------------------------------------------- the static symbols

/** A coil of `n` half turns along a line from (x, y) for `w`, drawn into `g` as a path (the caller strokes it). */
function coil(g: Graphics, x: number, y: number, w: number, n: number): void {
  const bw = w / n;
  g.moveTo(x, y);
  for (let k = 0; k < n; k++) g.arc(x + (k + 0.5) * bw, y, bw / 2, Math.PI, 0);
}

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
export function nicGlyph(g: Graphics, T: Theme, b: NicBlock, c: string, put: Put, input: NicPlanInput): void {
  const a = nicGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put), { solid, soft, line, rect, stub } = kit;
  const lab = (t: string, lx: number, ly: number, size = LAB) => put(t, lx + (t.length * size * 0.6) / 2, ly, size);
  const outline = (r: Rect) => { g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const arrow = (x0: number, y: number, x1: number) => { stub(x0, y, x1, y); g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line }); };
  switch (b.kind) {
    case 'jack': {
      const q = jackGeom(a, input.ports);
      q.ports.forEach((p) => {
        g.roundRect(p.shell.x, p.shell.y, p.shell.w, p.shell.h, 5).fill({ color: soft }).stroke({ width: 1.4, color: line });
        rect(p.mouth.x, p.mouth.y, p.mouth.w, p.mouth.h, T.die);
        outline(p.mouth);
        // the latch's notch in the mouth's top edge
        rect(p.mouth.x + p.mouth.w * 0.36, p.mouth.y - p.shell.h * 0.08, p.mouth.w * 0.28, p.shell.h * 0.1, T.die);
        for (const r of p.contacts) rect(r.x, r.y, r.w, r.h, solid);
        outline(p.link); outline(p.act);
      });
      break;
    }
    case 'mag': {
      for (const t of magGeom(a)) {
        lab(t.name, a.x, t.cy);
        coil(g, t.left.x + 2, t.cy, t.left.w - 4, 4);
        coil(g, t.right.x + 2, t.cy, t.right.w - 4, 4);
        g.stroke({ width: 1.4, color: line });
        // the core between the coils, two bars
        for (const dx of [-3, 3]) stub(t.left.x + t.left.w + 11 + dx, t.cy - t.left.h * 0.36, t.left.x + t.left.w + 11 + dx, t.cy + t.left.h * 0.36);
        stub(t.row.x - 6, t.cy, t.left.x + 2, t.cy);
      }
      break;
    }
    case 'phy': {
      const q = phyGeom(a);
      for (const p of q.pairs) {
        lab(p.name, a.x, p.cy);
        p.stages.forEach((r, j) => {
          rect(r.x, r.y, r.w, r.h, j === 1 ? solid : soft); outline(r);
          put(PHY_STAGES[j]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
          if (j < 2) arrow(r.x + r.w + 1, p.cy, p.stages[j + 1]!.x - 1);
        });
      }
      rect(q.gauge.x, q.gauge.y, q.gauge.w, q.gauge.h, soft); outline(q.gauge);
      break;
    }
    case 'mac': {
      const q = macGeom(a);
      q.fields.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft); put(FRAME_FIELDS[k]![0], r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.w * 0.3, r.h * 0.45)); });
      for (const [r, t] of [[q.rx, 'rx'], [q.tx, 'tx']] as [Rect, string][]) { lab(t, a.x, r.y + r.h / 2); rect(r.x, r.y, r.w, r.h, soft); outline(r); }
      break;
    }
    case 'stats': {
      const q = statsGeom(a);
      for (const [r, v, t] of [[q.rx, q.rxVal, 'rx'], [q.tx, q.txVal, 'tx']] as [Rect, Rect, string][]) { lab(t, r.x, r.y + r.h / 2); rect(v.x, v.y, v.w, v.h, soft); outline(v); }
      for (const r of [q.rxBar, q.txBar]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); }
      break;
    }
    case 'rxq': case 'txq': {
      const q = queueGeom(a, input.ring);
      for (const r of q.cells) rect(r.x, r.y, r.w, r.h, soft);
      outline(q.ringBox);
      for (const f of q.flows) { rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft); outline(f.bar); }
      break;
    }
    case 'dma': {
      const q = dmaGeom(a);
      rect(q.ring.x, q.ring.y, q.ring.w, q.ring.h, T.die); outline(q.ring);
      for (const r of q.cells) rect(r.x, r.y, r.w, r.h, soft);
      lab('descriptor ring', q.ring.x + 6, q.ring.y + q.ring.h + 8);
      rect(q.engine.x, q.engine.y, q.engine.w, q.engine.h, T.die); outline(q.engine);
      // two arrows: a received frame goes down into RAM, a frame to send comes up out of it
      for (const [r, up] of [[q.down, false], [q.up, true]] as [Rect, boolean][]) {
        const cx = r.x + r.w / 2, y0 = up ? r.y + r.h : r.y, y1 = up ? r.y : r.y + r.h, d = up ? 1 : -1;
        stub(cx, y0, cx, y1);
        g.poly([cx, y1, cx - 5, y1 + 7 * d, cx + 5, y1 + 7 * d]).fill({ color: line });
        for (let k = 0; k < 3; k++) rect(r.x + 2, r.y + 4 + k * ((r.h - 12) / 3), r.w - 4, (r.h - 12) / 3 - 4, soft);
      }
      put('to RAM', q.down.x + q.down.w / 2, q.engine.y + q.engine.h - 7, 10); put('from RAM', q.up.x + q.up.w / 2, q.engine.y + q.engine.h - 7, 10);
      break;
    }
    case 'pcie': {
      const q = pcieGeom(a, input.lanes);
      for (const l of q.lanes) {
        rect(l.rx.x, l.rx.y, l.rx.w, l.rx.h, soft); rect(l.tx.x, l.tx.y, l.tx.w, l.tx.h, soft); outline(l.rx); outline(l.tx);
        if (input.lanes <= 8) put(`${l.idx}`, l.tag.x, l.tag.y, 10);
      }
      break;
    }
    case 'nvm': {
      const q = nvmGeom(a);
      rect(q.body.x, q.body.y, q.body.w, q.body.h, solid); outline(q.body);
      for (let k = 0; k < 4; k++) for (const e of [-1, 1]) { const px = e < 0 ? q.body.x - 5 : q.body.x + q.body.w; rect(px, q.body.y + 4 + k * ((q.body.h - 8) / 4), 5, 3, soft); }
      g.circle(q.body.x + 6, q.body.y + 6, 1.6).fill({ color: line });
      put('SPI', q.body.x + q.body.w / 2, q.body.y + q.body.h / 2, LAB);
      break;
    }
    case 'xtal': {
      const q = xtalGeom(a);
      g.roundRect(q.can.x, q.can.y, q.can.w, q.can.h, 3).fill({ color: soft }).stroke({ width: 1.3, color: line });
      for (const x of [q.can.x + q.can.w * 0.3, q.can.x + q.can.w * 0.7]) stub(x, q.can.y + 3, x, q.can.y + q.can.h - 3);
      stub(q.can.x - 6, q.can.y + q.can.h / 2, q.can.x, q.can.y + q.can.h / 2); stub(q.can.x + q.can.w, q.can.y + q.can.h / 2, q.can.x + q.can.w + 6, q.can.y + q.can.h / 2);
      break;
    }
    case 'vreg': {
      const q = vregGeom(a), cy = q.coil.y + q.coil.h / 2;
      coil(g, q.coil.x, cy, q.coil.w, 4);
      g.stroke({ width: 1.4, color: line });
      for (const r of q.caps) { rect(r.x, r.y, r.w, r.h, soft); outline(r); }
      rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft); outline(q.bar);
      break;
    }
    case 'temp': {
      const q = tempGeom(a);
      g.roundRect(q.icon.cx - 3, a.y + 2, 6, q.icon.h - 10, 3).fill({ color: soft }).stroke({ width: 1.2, color: line });
      g.circle(q.icon.cx, a.y + q.icon.h - 5, 5).fill({ color: solid }).stroke({ width: 1.2, color: line });
      rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft); outline(q.bar);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- the live symbols

export type LiveKey = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad';
export interface NicLiveItem { rect: Rect; color: LiveKey; a: number }
export interface NicLiveText { rect: Rect; top: string; ink?: boolean; fit?: number }
export interface NicLive { texts: NicLiveText[]; lit: NicLiveItem[] }

/** The activity light's level at the visual clock: it lights for `STRETCH` seconds after each frame (the jacks' law, jackleds.ts), so a few frames blink one by one and many keep it lit. */
export function actLevel(rate: number, ms: number): number {
  if (!(rate > 0)) return 0;
  const duty = rate * STRETCH;
  return duty >= 1 || ((ms / 1000) * rate) % 1 < duty ? 1 : 0;
}

/** The right part of a block's name strip, from `from` of its width (a small block puts its number beside its name, where the symbol has no room for it). */
const head = (r: Rect, from: number): Rect => R(r.x + r.w * from, r.y + 5, r.w * (1 - from) - 8, 22);

/** What a block shows now: the rectangles to light and the texts to put in them. `s` is the card's `NicShow`; a card with no cable lights nothing of the line. */
export function nicLive(b: Pick<NicBlock, 'kind' | 'rect'>, a: Rect, s: NicShow, input: NicPlanInput): NicLive {
  const out: NicLive = { texts: [], lit: [] };
  const rx = s.rxAct, tx = s.txAct, any = Math.max(rx, tx), on = s.link, ms = s.ms;
  const txt = (r: Rect, t: string, fit?: number) => out.texts.push({ rect: r, top: t, ink: true, ...(fit !== undefined ? { fit } : {}) });
  switch (b.kind) {
    case 'jack': {
      const q = jackGeom(a, input.ports), p = q.ports[0]!;
      if (on) out.lit.push({ rect: p.link, color: 'st', a: 0.95 });
      if (on && actLevel(s.rx + s.tx, ms) > 0) out.lit.push({ rect: p.act, color: 'ld', a: 0.95 });
      if (on && any > 0) out.lit.push({ rect: p.mouth, color: 'alu', a: 0.04 + 0.08 * any });
      const t1 = s.burnt ? 'BURNT OUT' : on ? `${fmtSpeed(s.mbps)} link` : s.plugged ? 'cable in, no link' : 'no cable here';
      txt(R(q.text.x, q.text.y + 2, q.text.w, 24), t1, 20);
      if (!on && s.plugged && s.reason) txt(R(q.text.x, q.text.y + 27, q.text.w, 20), s.reason, 40);
      else if (on) txt(R(q.text.x, q.text.y + 27, q.text.w, 20), `to the router`, 20);
      break;
    }
    case 'mag': {
      if (!on) break;
      magGeom(a).forEach((t, k) => {
        if (rx > 0) out.lit.push({ rect: t.left, color: 'alu', a: 0.12 * rx * wave(ms, k) });
        if (tx > 0) out.lit.push({ rect: t.right, color: 'mul', a: 0.12 * tx * wave(ms, k + 2) });
      });
      break;
    }
    case 'phy': {
      const q = phyGeom(a);
      if (on && any > 0) q.pairs.forEach((p, k) => p.stages.forEach((r, j) => out.lit.push({ rect: r, color: j === 1 ? 'mul' : 'alu', a: 0.12 * any * wave(ms, k + j * 1.5, 1.4) })));
      const full = s.rated > 0 ? Math.min(1, s.mbps / s.rated) : 0;
      if (on) out.lit.push({ rect: { ...q.gauge, w: q.gauge.w * full }, color: s.hot ? 'ld' : 'alu', a: 0.45 });
      const t = s.burnt ? 'burnt out' : on ? `LINK ${fmtSpeed(s.mbps)}${s.hot ? ' · hot, half speed' : ''}` : 'no link';
      txt(q.note, t, 32);
      break;
    }
    case 'mac': {
      const q = macGeom(a);
      if (on && rx > 0) { const u = (ms / (1600 - 1300 * rx)) % 1; out.lit.push({ rect: { ...q.rx, x: q.rx.x, w: q.rx.w * u }, color: 'alu', a: 0.12 + 0.18 * rx }); q.fields.forEach((f, k) => { if (Math.floor(u * q.fields.length) === k) out.lit.push({ rect: f, color: 'alu', a: 0.2 }); }); }
      if (on && tx > 0) { const u = (ms / (1600 - 1300 * tx)) % 1; out.lit.push({ rect: { ...q.tx, x: q.tx.x + q.tx.w * (1 - u), w: q.tx.w * u }, color: 'mul', a: 0.12 + 0.18 * tx }); }
      txt(q.note, on ? 'up to 1500 bytes a frame · CRC checked' : 'waiting for a link', 40);
      break;
    }
    case 'stats': {
      const q = statsGeom(a);
      txt(q.rxVal, `${fmtFrames(s.rxTotal)} frames · ${fmtFrames(s.rx)} /s`, 26); txt(q.txVal, `${fmtFrames(s.txTotal)} frames · ${fmtFrames(s.tx)} /s`, 26);
      out.lit.push({ rect: { ...q.rxBar, w: q.rxBar.w * rx }, color: 'alu', a: 0.5 }, { rect: { ...q.txBar, w: q.txBar.w * tx }, color: 'mul', a: 0.5 });
      txt(q.rxBar, `rx ${fmtPct(s.rxLoad)}`, 14); txt(q.txBar, `tx ${fmtPct(s.txLoad)}`, 14);
      break;
    }
    case 'rxq': case 'txq': {
      const q = queueGeom(a, input.ring), down = b.kind === 'rxq', flows = down ? s.downs : s.ups, act = down ? rx : tx, key: LiveKey = down ? 'alu' : 'mul';
      q.cells.forEach((r, k) => { if (on && act > 0 && Math.floor(wave(ms, down ? k : q.cells.length - k, 0.5 + 1.2 * act) * 3) === 2) out.lit.push({ rect: r, color: key, a: 0.2 + 0.3 * act }); });
      txt(head(b.rect, 0.5), down ? `${flows.length} in flight` : `${flows.length} out${s.waiting ? ` · ${s.waiting} wait` : ''}`, 18);
      q.flows.forEach((f, k) => {
        const t = flows[k];
        if (!t) return;
        out.lit.push({ rect: { ...f.bar, w: f.bar.w * Math.min(1, t.percent / 100) }, color: key, a: 0.5 });
        txt(f.label, t.label, 24); txt(f.pct, `${Math.round(t.percent)}%`, 5);
      });
      if (flows.length > q.flows.length) txt({ x: a.x, y: a.y + a.h - 14, w: a.w, h: 14 }, `+ ${flows.length - q.flows.length} more`, 20);
      break;
    }
    case 'dma': {
      const q = dmaGeom(a);
      q.cells.forEach((r, k) => { if (on && any > 0 && Math.floor(wave(ms, k, 1 + any) * 2) === 1) out.lit.push({ rect: r, color: 'mul', a: 0.35 }); });
      if (on && rx > 0) out.lit.push({ rect: q.down, color: 'alu', a: 0.04 + 0.1 * rx * (0.6 + 0.4 * wave(ms, 0)) });
      if (on && tx > 0) out.lit.push({ rect: q.up, color: 'mul', a: 0.04 + 0.1 * tx * (0.6 + 0.4 * wave(ms, 1)) });
      txt(q.note, on ? `${fmtFrames(s.rx + s.tx)} frames /s` : 'idle', 20);
      break;
    }
    case 'pcie': {
      const q = pcieGeom(a, input.lanes);
      q.lanes.forEach((l) => {
        if (on && rx > 0) out.lit.push({ rect: l.rx, color: 'alu', a: 0.1 + 0.35 * rx * wave(ms, l.idx, 1.3) });
        if (on && tx > 0) out.lit.push({ rect: l.tx, color: 'mul', a: 0.1 + 0.35 * tx * wave(ms, l.idx + 3, 1.3) });
      });
      txt(q.note, `x${input.lanes} · ${input.lanes * 2} pairs`, 24);
      break;
    }
    case 'nvm': {
      const q = nvmGeom(a);
      txt(q.mac, macOf(input.visual), 24); txt(q.note, 'read at power-on', 24);
      break;
    }
    case 'xtal': {
      const q = xtalGeom(a), n = 12, dw = q.wave.w / n;
      if (s.powered) for (let k = 0; k < n; k++) { const h = q.wave.h * (0.2 + 0.7 * wave(ms, k, 0.7)); out.lit.push({ rect: R(q.wave.x + k * dw + 1, q.wave.y + (q.wave.h - h) / 2, dw - 2, h), color: 'br', a: 0.4 }); }
      break;
    }
    case 'vreg': {
      const q = vregGeom(a), span = Math.max(0.01, s.loadW - s.idleW), f = Math.min(1, Math.max(0, (s.powerW - s.idleW) / span));
      if (s.powered) out.lit.push({ rect: { ...q.bar, w: q.bar.w * Math.max(0.04, f) }, color: 'br', a: 0.5 });
      txt(head(b.rect, 0.42), s.powered ? `${s.powerW.toFixed(1)} W of ${s.loadW} W` : 'no power', 16);
      break;
    }
    case 'temp': {
      const q = tempGeom(a), f = tempAt(s.tempC, s.damageC);
      out.lit.push({ rect: { ...q.bar, w: q.bar.w * f }, color: s.tempC >= s.throttleC ? 'bad' : 'st', a: 0.55 });
      // the throttle and unstable marks on the scale
      for (const [c, col] of [[s.throttleC, 'ld'], [s.unstableC, 'bad']] as [number, LiveKey][]) out.lit.push({ rect: R(q.bar.x + q.bar.w * tempAt(c, s.damageC) - 1, q.bar.y - 3, 2, q.bar.h + 6), color: col, a: 0.95 });
      txt(head(b.rect, 0.5), `${s.tempC.toFixed(0)} °C`, 8);
      break;
    }
    default: break;
  }
  return out;
}
