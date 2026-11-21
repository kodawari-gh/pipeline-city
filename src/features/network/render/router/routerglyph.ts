import type { Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import { glyphKit, type Put } from '../../../cpu/render/die/blockart';
import { actLevel, PAIRS, PHY_STAGES, type LiveKey, type NicLive } from '../nic/nicglyph';
import { fmtFrames, fmtPct, fmtSpeed } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import type { RouterBlock, RouterPlanInput } from './routerplan';
import { limitWords, type RouterShow } from './routershow';

// What is inside a block of the router (docs/render/net.md "Inside the NIC and the router"): the schematic an engineer would draw for the part, drawn with the CPU die's own tools
// (`glyphKit`) so the router, the card and the dies read as one family. The magnetics, the flash and the power input are the card's own symbols (nicglyph.ts); the others are new:
// the jacks (a face with the mouth, the contacts and the two lights; four of them for the LAN), the PHY (a front end, a signal processor and a coding stage, a speed gauge), the CPU
// (its cores), the forwarding engine (its stages and the table of clients), the LAN switch (the uplink to the engine and the four ports), the DRAM (its chips and the packet buffers),
// the radio (a mast and its waves) and the traffic block (the counters, the speeds, the transfers). Pure drawing into a Graphics (and a callback for the few labels); the
// rectangles the live layer lights are the `*Geom` functions below, shared by the drawing and by `routerLive`.

export const ROUTER_GLYPH_KINDS = new Set<RouterBlock['kind']>(['cpu', 'pkt', 'sw', 'dram', 'flash', 'radio', 'power', 'wanjack', 'wanmag', 'wanphy', 'lanphy', 'lanmag', 'lanjack', 'stat']);

/** The area a symbol may use: the block under its name, or null for the SoC's frame (it holds blocks) and for a block too small. */
export function routerGlyphArea(b: Pick<RouterBlock, 'kind' | 'rect'>): Rect | null {
  if (!ROUTER_GLYPH_KINDS.has(b.kind)) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

const LAB = 11;
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);
/** The stages of the forwarding engine, in the order a frame meets them. */
export const PKT_STAGES = ['PARSE', 'LOOKUP', 'REWRITE', 'QUEUE'] as const;

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** A row of `n` jacks (each a face: the shield, the mouth, the eight contacts and the two lights) over the status lines. */
export function jacksGeom(a: Rect, n: number) {
  const textH = 44, gap = 8, area = R(a.x, a.y, a.w, a.h - textH), pw = Math.min((area.w - (n - 1) * gap) / n, area.h * 1.15, 90), ph = Math.min(area.h, pw / 1.05);
  const x0 = a.x + (a.w - (n * pw + (n - 1) * gap)) / 2, y = area.y + (area.h - ph) / 2;
  return {
    text: R(a.x, a.y + a.h - textH, a.w, textH),
    ports: Array.from({ length: n }, (_, k) => {
      const x = x0 + k * (pw + gap), mouth = R(x + pw * 0.12, y + ph * 0.3, pw * 0.76, ph * 0.6);
      return {
        shell: R(x, y, pw, ph), mouth, link: R(x + pw * 0.1, y + ph * 0.07, pw * 0.18, ph * 0.12), act: R(x + pw * 0.72, y + ph * 0.07, pw * 0.18, ph * 0.12),
        contacts: pw < 60 ? [] : Array.from({ length: 8 }, (_, j) => R(mouth.x + mouth.w * 0.08 + (j * mouth.w * 0.84) / 8 + 1, mouth.y + mouth.h * 0.5, Math.max(1.5, (mouth.w * 0.84) / 8 - 2), mouth.h * 0.46)),
      };
    }),
  };
}

/** The PHY: its three stages in a row, the speed gauge under them and the line under that. */
export function phyGeom(a: Rect) {
  const gap = 10, sw = (a.w - 2 * gap) / 3, sh = Math.min(40, a.h * 0.4);
  return { stages: [0, 1, 2].map((k) => R(a.x + k * (sw + gap), a.y + 2, sw, sh)), gauge: R(a.x, a.y + sh + 12, a.w, 10), note: R(a.x, a.y + sh + 26, a.w, Math.max(14, a.y + a.h - (a.y + sh + 26))) };
}

/** The CPU: its cores as tiles (up to four to a row) and the line under them. */
export function cpuGeom(a: Rect, cores: number) {
  const cols = Math.min(cores, 4), rows = Math.ceil(cores / cols), noteH = 28, gh = a.h - noteH - 6, th = Math.max(10, Math.min(36, (gh - (rows - 1) * 6) / rows)), tw = Math.min(64, (a.w - (cols - 1) * 8) / cols);
  const x0 = a.x + (a.w - (cols * tw + (cols - 1) * 8)) / 2;
  return { cores: Array.from({ length: cores }, (_, k) => R(x0 + (k % cols) * (tw + 8), a.y + Math.floor(k / cols) * (th + 6), tw, th)), note: R(a.x, a.y + a.h - noteH, a.w, noteH) };
}

/** The forwarding engine: its four stages in a row, the table of clients under them (a cell for each slot, two rows when there are many) and the transfers in flight, a row each. */
export function pktGeom(a: Rect, slots: number) {
  const gap = 10, sw = (a.w - 3 * gap) / 4, sh = 28, per = slots > 8 ? Math.ceil(slots / 2) : slots, cw = (a.w - 8) / Math.max(1, per), ch = 13, ty = a.y + sh + 10, trows = slots > 8 ? 2 : 1;
  const fy = ty + trows * (ch + 3) + 6, rows = Math.max(0, Math.min(3, Math.floor((a.y + a.h - fy) / 24)));
  return {
    stages: [0, 1, 2, 3].map((k) => R(a.x + k * (sw + gap), a.y, sw, sh)),
    cells: Array.from({ length: slots }, (_, k) => R(a.x + (k % per) * cw + 1, ty + Math.floor(k / per) * (ch + 3), cw - 2, ch)),
    table: R(a.x, ty - 1, per * cw, trows * (ch + 3) + 1),
    flows: Array.from({ length: rows }, (_, k) => { const y = fy + k * 24, h = 20; return { row: R(a.x, y, a.w, h), label: R(a.x + 2, y, a.w * 0.5, h), bar: R(a.x + a.w * 0.53, y + h * 0.28, a.w * 0.34, h * 0.44), pct: R(a.x + a.w * 0.89, y, a.w * 0.11, h) }; }),
  };
}

/** The LAN switch: the uplink to the engine on the left, the LAN ports on the right (a bar each), the fabric between them and the line under it. */
export function swGeom(a: Rect, lan: number) {
  const noteH = 24, h = a.h - noteH - 4, pitch = h / lan, bh = Math.min(22, pitch - 5), up = R(a.x, a.y, 40, h), pw = Math.min(70, a.w * 0.22);
  return {
    up, ports: Array.from({ length: lan }, (_, k) => R(a.x + a.w - pw, a.y + k * pitch + (pitch - bh) / 2, pw, bh)),
    fabric: R(up.x + up.w, a.y, a.w - up.w - pw, h), note: R(a.x, a.y + a.h - noteH, a.w, noteH),
  };
}

/** The DRAM: its chips in a row, the ring of packet buffers under them and the line under that. */
export function dramGeom(a: Rect, chips: number) {
  const gap = 8, cw = Math.min(96, (a.w - (chips - 1) * gap) / chips), ch = Math.min(40, a.h * 0.4), ring = 20, cell = (a.w - 8) / ring;
  return {
    chips: Array.from({ length: chips }, (_, k) => R(a.x + k * (cw + gap), a.y + 2, cw, ch)),
    cells: Array.from({ length: ring }, (_, k) => R(a.x + k * cell + 1, a.y + ch + 12, cell - 2, 14)), ringBox: R(a.x, a.y + ch + 11, ring * cell, 16),
    note: R(a.x, a.y + ch + 32, a.w, Math.max(14, a.y + a.h - (a.y + ch + 32))),
  };
}

/** The radio: the mast with its waves on the left, the line on the right. */
export function radioGeom(a: Rect) {
  const w = Math.min(56, a.w * 0.2), cx = a.x + 8 + w / 2;
  return { mast: { cx, top: a.y + 4, bottom: a.y + a.h - 2, h: a.h }, note: R(a.x + 16 + w, a.y, a.x + a.w - (a.x + 16 + w), a.h) };
}

/** The traffic block: the two counters with their load bars (a), the speeds (b) and the transfers in flight (c), side by side. */
export function statGeom(a: Rect) {
  const nw = 34, aw = a.w * 0.34, bw = a.w * 0.3, rh = Math.min(26, (a.h - 12) / 3.4), flowRows = Math.max(0, Math.min(3, Math.floor(a.h / 26)));
  const count = (k: number) => R(a.x + nw, a.y + k * (rh * 1.7 + 4), aw - nw, rh), bar = (k: number) => R(a.x + nw, a.y + k * (rh * 1.7 + 4) + rh + 2, aw - nw, rh * 0.7);
  const bx = a.x + aw + 24, cx = bx + bw + 24, cw = a.x + a.w - cx;
  return {
    rx: count(0), tx: count(1), rxBar: bar(0), txBar: bar(1),
    lines: [0, 1, 2].map((k) => R(bx, a.y + k * Math.min(30, a.h / 3), bw, Math.min(26, a.h / 3 - 2))),
    flows: Array.from({ length: flowRows }, (_, k) => { const y = a.y + k * 26, h = 22; return { row: R(cx, y, cw, h), label: R(cx + 2, y, cw * 0.5, h), bar: R(cx + cw * 0.53, y + h * 0.28, cw * 0.34, h * 0.44), pct: R(cx + cw * 0.89, y, cw * 0.11, h) }; }),
  };
}

// (until the router's board is built in 3D, where the magnetics, the flash and the regulator are bodies of it: the three symbols the card's die no longer draws)

/** The magnetics: a transformer for each of the four pairs, the line side on the left, the chip side on the right. */
function magGeom(a: Rect) {
  const pitch = a.h / 4, lw = 22;
  return PAIRS.map((name, k) => {
    const y = a.y + k * pitch, row = R(a.x + lw, y + 3, a.w - lw, pitch - 8), cw = (row.w - 22) / 2;
    return { name, y, row, left: R(row.x, row.y, cw, row.h), right: R(row.x + cw + 22, row.y, cw, row.h), cy: row.y + row.h / 2 };
  });
}

/** The flash: its SOIC-8 on the left, the line about it on the right. */
function nvmGeom(a: Rect) {
  const w = Math.min(70, a.w * 0.3), h = Math.min(a.h, 38), body = R(a.x + 8, a.y + (a.h - h) / 2, w, h);
  return { body, mac: R(body.x + w + 14, a.y, a.x + a.w - (body.x + w + 14), a.h / 2), note: R(body.x + w + 14, a.y + a.h / 2, a.x + a.w - (body.x + w + 14), a.h / 2) };
}

/** The regulator: the inductor, the two capacitors and the bar of the power it passes. */
function vregGeom(a: Rect) {
  const bx = a.x + 128;
  return { coil: R(a.x + 4, a.y, 60, a.h), caps: [R(a.x + 76, a.y + a.h * 0.15, 12, a.h * 0.7), R(a.x + 96, a.y + a.h * 0.15, 12, a.h * 0.7)], bar: R(bx, a.y + a.h * 0.3, a.x + a.w - bx, a.h * 0.4) };
}

/** A coil of `n` half turns along a line from (x, y) for `w`, drawn into `g` as a path (the caller strokes it). */
function coil(g: Graphics, x: number, y: number, w: number, n: number): void {
  const bw = w / n;
  g.moveTo(x, y);
  for (let k = 0; k < n; k++) g.arc(x + (k + 0.5) * bw, y, bw / 2, Math.PI, 0);
}

// ---------------------------------------------------------------- the static symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
export function routerGlyph(g: Graphics, T: Theme, b: RouterBlock, c: string, put: Put, input: RouterPlanInput): void {
  const a = routerGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put), { solid, soft, line, rect, stub } = kit;
  // the transformers of the four pairs, the SPI flash, the regulator
  if (b.kind === 'wanmag' || b.kind === 'lanmag') {
    for (const t of magGeom(a)) {
      put(t.name, a.x + (t.name.length * LAB * 0.6) / 2, t.cy, LAB);
      coil(g, t.left.x + 2, t.cy, t.left.w - 4, 4);
      coil(g, t.right.x + 2, t.cy, t.right.w - 4, 4);
      g.stroke({ width: 1.4, color: line });
      for (const dx of [-3, 3]) stub(t.left.x + t.left.w + 11 + dx, t.cy - t.left.h * 0.36, t.left.x + t.left.w + 11 + dx, t.cy + t.left.h * 0.36);
      stub(t.row.x - 6, t.cy, t.left.x + 2, t.cy);
    }
    return;
  }
  if (b.kind === 'flash') {
    const q = nvmGeom(a);
    rect(q.body.x, q.body.y, q.body.w, q.body.h, solid);
    g.roundRect(q.body.x, q.body.y, q.body.w, q.body.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
    for (let k = 0; k < 4; k++) for (const e of [-1, 1]) { const px = e < 0 ? q.body.x - 5 : q.body.x + q.body.w; rect(px, q.body.y + 4 + k * ((q.body.h - 8) / 4), 5, 3, soft); }
    g.circle(q.body.x + 6, q.body.y + 6, 1.6).fill({ color: line });
    put('SPI', q.body.x + q.body.w / 2, q.body.y + q.body.h / 2, LAB);
    return;
  }
  if (b.kind === 'power') {
    const q = vregGeom(a), cy = q.coil.y + q.coil.h / 2;
    coil(g, q.coil.x, cy, q.coil.w, 4);
    g.stroke({ width: 1.4, color: line });
    for (const r of q.caps) { rect(r.x, r.y, r.w, r.h, soft); g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); }
    rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft);
    g.roundRect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
    return;
  }
  const outline = (r: Rect) => { g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const arrow = (x0: number, y: number, x1: number) => { stub(x0, y, x1, y); g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line }); };
  switch (b.kind) {
    case 'wanjack': case 'lanjack': {
      const q = jacksGeom(a, b.kind === 'wanjack' ? 1 : input.lan);
      for (const p of q.ports) {
        g.roundRect(p.shell.x, p.shell.y, p.shell.w, p.shell.h, 4).fill({ color: soft }).stroke({ width: 1.3, color: line });
        rect(p.mouth.x, p.mouth.y, p.mouth.w, p.mouth.h, T.die);
        outline(p.mouth);
        rect(p.mouth.x + p.mouth.w * 0.36, p.mouth.y - p.shell.h * 0.08, p.mouth.w * 0.28, p.shell.h * 0.1, T.die);
        for (const r of p.contacts) rect(r.x, r.y, r.w, r.h, solid);
        outline(p.link); outline(p.act);
      }
      break;
    }
    case 'wanphy': case 'lanphy': {
      const q = phyGeom(a);
      q.stages.forEach((r, j) => {
        rect(r.x, r.y, r.w, r.h, j === 1 ? solid : soft); outline(r);
        put(PHY_STAGES[j]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
        if (j < 2) arrow(r.x + r.w + 1, r.y + r.h / 2, q.stages[j + 1]!.x - 1);
      });
      rect(q.gauge.x, q.gauge.y, q.gauge.w, q.gauge.h, soft); outline(q.gauge);
      break;
    }
    case 'cpu': {
      const q = cpuGeom(a, input.cores);
      q.cores.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft); outline(r); put(`C${k}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3)); });
      break;
    }
    case 'pkt': {
      const q = pktGeom(a, routerSlots(input));
      q.stages.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft); outline(r);
        put(PKT_STAGES[k]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.4, r.w * 0.17));
        if (k < 3) arrow(r.x + r.w + 1, r.y + r.h / 2, q.stages[k + 1]!.x - 1);
      });
      for (const r of q.cells) rect(r.x, r.y, r.w, r.h, soft);
      outline(q.table);
      for (const f of q.flows) { rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft); outline(f.bar); }
      break;
    }
    case 'sw': {
      const q = swGeom(a, input.lan);
      rect(q.up.x, q.up.y, q.up.w, q.up.h, solid); outline(q.up);
      put('UP', q.up.x + q.up.w / 2, q.up.y + q.up.h / 2, LAB);
      q.ports.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft); outline(r);
        put(`P${k + 1}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.5));
        // the fabric: a line from the uplink to each port, bent at the middle of the gap
        const y0 = q.up.y + q.up.h / 2, x0 = q.up.x + q.up.w, x1 = r.x, ym = r.y + r.h / 2, xm = x0 + (x1 - x0) * 0.5;
        g.moveTo(x0, y0).lineTo(xm, y0).lineTo(xm, ym).lineTo(x1, ym).stroke({ width: 1.1, color: line, alpha: 0.7 });
      });
      break;
    }
    case 'dram': {
      const q = dramGeom(a, input.dram.chips);
      for (const r of q.chips) {
        rect(r.x, r.y, r.w, r.h, solid); outline(r);
        for (let k = 0; k < 6; k++) for (const e of [-1, 1]) rect(e < 0 ? r.x - 4 : r.x + r.w, r.y + 3 + k * ((r.h - 6) / 6), 4, 2, soft);
        put(input.dram.kind.split(' ')[0]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.4, r.w * 0.2));
      }
      for (const r of q.cells) rect(r.x, r.y, r.w, r.h, soft);
      outline(q.ringBox);
      break;
    }
    case 'radio': {
      const q = radioGeom(a), m = q.mast, top = m.top + 6;
      g.moveTo(m.cx, m.bottom).lineTo(m.cx, top + 4).stroke({ width: 1.6, color: line });
      g.circle(m.cx, top + 2, 3).fill({ color: solid }).stroke({ width: 1.2, color: line });
      for (const [k, s] of [[1, 9], [2, 17], [3, 25]] as const) for (const e of [-1, 1]) g.arc(m.cx, top + 2, s, e < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, e < 0 ? Math.PI * 1.25 : Math.PI * 0.25).stroke({ width: 1.1, color: line, alpha: 1 - k * 0.2 });
      break;
    }
    case 'stat': {
      const q = statGeom(a);
      for (const r of [q.rxBar, q.txBar]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); }
      for (const f of q.flows) { rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft); outline(f.bar); }
      for (const [r, t] of [[q.rx, 'rx'], [q.tx, 'tx']] as [Rect, string][]) put(t, a.x + 12, r.y + r.h / 2, LAB + 2);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- the live symbols

export type RouterLive = NicLive;

/** The right part of a block's name strip, from `from` of its width (a small block puts its number beside its name, where the symbol has no room for it). */
const head = (r: Rect, from: number): Rect => R(r.x + r.w * from, r.y + 5, r.w * (1 - from) - 8, 22);

/** The forwarding engine's table: a cell for each slot (the plan's `routerSlots`). */
export const routerSlots = (input: Pick<RouterPlanInput, 'tier'>): number => (input.tier >= 4 ? 16 : input.tier >= 3 ? 8 : 4);

/** What a block shows now: the rectangles to light and the texts to put in them. `s` is the router's `RouterShow`; a router with no link on one side lights nothing of that side's line. */
export function routerLive(b: Pick<RouterBlock, 'kind' | 'rect'>, a: Rect, s: RouterShow, input: RouterPlanInput): RouterLive {
  const out: RouterLive = { texts: [], lit: [] };
  const rx = s.rxAct, tx = s.txAct, any = Math.max(rx, tx), flow = s.pc && s.wan, ms = s.ms;
  const txt = (r: Rect, t: string, fit?: number) => out.texts.push({ rect: r, top: t, ink: true, ...(fit !== undefined ? { fit } : {}) });
  const lit = (rect: Rect, color: LiveKey, al: number) => out.lit.push({ rect, color, a: al });
  switch (b.kind) {
    case 'wanjack': {
      const q = jacksGeom(a, 1), p = q.ports[0]!;
      if (s.wan) lit(p.link, 'st', 0.95);
      if (flow && actLevel(s.rx + s.tx, ms) > 0) lit(p.act, 'ld', 0.95);
      if (flow && any > 0) lit(p.mouth, 'alu', 0.04 + 0.08 * any);
      txt(R(q.text.x, q.text.y + 2, q.text.w, 24), s.wan ? `${fmtSpeed(s.downMbps)} down` : 'no plan', 14);
      txt(R(q.text.x, q.text.y + 27, q.text.w, 20), s.wan ? `${fmtSpeed(s.upMbps)} up` : 'nothing on the line', 18);
      break;
    }
    case 'lanjack': {
      const q = jacksGeom(a, input.lan), p = q.ports[0]!;
      if (s.pc) lit(p.link, 'st', 0.95);
      if (s.pc && actLevel(s.rx + s.tx, ms) > 0 && flow) lit(p.act, 'ld', 0.95);
      if (flow && any > 0) lit(p.mouth, 'alu', 0.04 + 0.08 * any);
      txt(R(q.text.x, q.text.y + 2, q.text.w, 24), s.pc ? `${fmtSpeed(s.lanMbps)} link` : s.plugged ? 'cable in, no link' : 'no cable', 14);
      txt(R(q.text.x, q.text.y + 27, q.text.w, 20), s.pc ? 'jack 1 · the PC' : `${input.lan} ports`, 18);
      break;
    }
    case 'wanmag': case 'lanmag': {
      if (!flow) break;
      magGeom(a).forEach((t, k) => {
        if (rx > 0) lit(b.kind === 'wanmag' ? t.left : t.right, 'alu', 0.12 * rx * wave(ms, k));
        if (tx > 0) lit(b.kind === 'wanmag' ? t.right : t.left, 'mul', 0.12 * tx * wave(ms, k + 2));
      });
      break;
    }
    case 'wanphy': case 'lanphy': {
      const q = phyGeom(a), wan = b.kind === 'wanphy', up = wan ? s.wan : s.pc, mbps = wan ? (s.wan ? s.downMbps : 0) : s.lanMbps;
      if (flow && any > 0) q.stages.forEach((r, j) => lit(r, j === 1 ? 'mul' : 'alu', 0.12 * any * wave(ms, j * 1.5, 1.4)));
      if (up) lit({ ...q.gauge, w: q.gauge.w * (s.ratedMbps > 0 ? Math.min(1, mbps / s.ratedMbps) : 0) }, 'alu', 0.45);
      txt(q.note, up ? (wan ? `PLAN ${fmtSpeed(mbps)}` : `LINK ${fmtSpeed(mbps)}`) : wan ? 'no plan' : 'no link', 16);
      break;
    }
    case 'cpu': {
      const q = cpuGeom(a, input.cores);
      q.cores.forEach((r) => lit(r, 'mul', 0.08));
      txt(q.note, s.pc ? '1 DHCP lease · the PC' : 'no clients', 22);
      break;
    }
    case 'pkt': {
      const q = pktGeom(a, routerSlots(input));
      if (flow && any > 0) q.stages.forEach((r, k) => lit(r, 'st', 0.12 * any * wave(ms, k * 1.4, 1.2 + any)));
      // a cell for each client in service: the table is the slots the router and the plan give, the transfers in flight are the clients
      q.cells.forEach((r, k) => { if (k < s.used) lit(r, 'st', 0.5); });
      txt(head(b.rect, 0.45), `${s.used} of ${s.slots} clients`, 18);
      const flows = [...s.downs.map((f) => ({ ...f, down: true })), ...s.ups.map((f) => ({ ...f, down: false }))];
      q.flows.forEach((f, k) => {
        const t = flows[k];
        if (!t) return;
        lit({ ...f.bar, w: f.bar.w * Math.min(1, t.percent / 100) }, t.down ? 'alu' : 'mul', 0.5);
        txt(f.label, `${t.down ? 'v' : '^'} ${t.label}`, 24); txt(f.pct, `${Math.round(t.percent)}%`, 5);
      });
      if (flows.length > q.flows.length) txt({ x: a.x, y: a.y + a.h - 14, w: a.w, h: 14 }, `+ ${flows.length - q.flows.length} more`, 20);
      break;
    }
    case 'sw': {
      const q = swGeom(a, input.lan);
      if (flow && any > 0) { lit(q.up, 'st', 0.1 + 0.3 * any); lit(q.ports[0]!, 'st', 0.1 + 0.3 * any); }
      else if (s.pc) lit(q.ports[0]!, 'st', 0.1);
      if (flow && rx > 0) lit({ ...q.fabric, w: q.fabric.w * ((ms / (1600 - 1300 * rx)) % 1) }, 'alu', 0.05 + 0.07 * rx);
      txt(q.note, s.pc ? `port 1 up · ${fmtSpeed(s.lanMbps)}` : 'no port up', 26);
      break;
    }
    case 'dram': {
      const q = dramGeom(a, input.dram.chips);
      q.cells.forEach((r, k) => { if (flow && any > 0 && Math.floor(wave(ms, k, 1 + any) * 2) === 1) lit(r, 'ld', 0.35); });
      txt(q.note, flow ? `${fmtFrames(s.rx + s.tx)} frames /s through the buffers` : 'no frames', 34);
      break;
    }
    case 'flash': {
      const q = nvmGeom(a);
      txt(q.mac, 'firmware', 12); txt(q.note, 'read at power-on', 18);
      break;
    }
    case 'radio': {
      const q = radioGeom(a);
      txt(R(q.note.x, q.note.y + q.note.h * 0.18, q.note.w, q.note.h * 0.36), 'idle', 12);
      txt(R(q.note.x, q.note.y + q.note.h * 0.55, q.note.w, q.note.h * 0.36), 'no wireless clients', 24);
      break;
    }
    case 'power': {
      const q = vregGeom(a);
      lit({ ...q.bar, w: q.bar.w }, 'br', 0.5);
      txt(head(b.rect, 0.42), 'wall power · on', 18);
      break;
    }
    case 'stat': {
      const q = statGeom(a);
      txt(q.rx, `${fmtFrames(s.rxTotal)} frames · ${fmtFrames(s.rx)} /s`, 30); txt(q.tx, `${fmtFrames(s.txTotal)} frames · ${fmtFrames(s.tx)} /s`, 30);
      lit({ ...q.rxBar, w: q.rxBar.w * s.rxLoad }, 'alu', 0.5); lit({ ...q.txBar, w: q.txBar.w * s.txLoad }, 'mul', 0.5);
      txt(q.rxBar, `rx ${fmtPct(s.rxLoad)} of the router`, 30); txt(q.txBar, `tx ${fmtPct(s.txLoad)} of the router`, 30);
      txt(q.lines[0]!, s.wan ? `WAN ${fmtSpeed(s.downMbps)} down · ${fmtSpeed(s.upMbps)} up` : 'WAN no plan', 30);
      txt(q.lines[1]!, s.pc ? `LAN ${fmtSpeed(s.lanMbps)} link` : 'LAN no link', 30);
      txt(q.lines[2]!, flow ? `limit: ${limitWords(s)}` : `router ${fmtSpeed(s.ratedMbps)}`, 30);
      q.flows.forEach((f, k) => {
        const t = [...s.downs, ...s.ups][k], down = k < s.downs.length;
        if (!t) return;
        lit({ ...f.bar, w: f.bar.w * Math.min(1, t.percent / 100) }, down ? 'alu' : 'mul', 0.5);
        txt(f.label, `${down ? 'v' : '^'} ${t.label}`, 24); txt(f.pct, `${Math.round(t.percent)}%`, 5);
      });
      break;
    }
    default: break;
  }
  return out;
}

