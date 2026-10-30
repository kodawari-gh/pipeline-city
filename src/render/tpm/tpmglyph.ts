import type { Graphics } from 'pixi.js';
import type { Rect } from '../die/cpuplan';
import { glyphKit, type Put } from '../die/blockart';
import type { Theme } from '../theme';
import type { TpmBlock } from './tpmplan';

// What is inside a block of the secure module's die (docs/ACCEL.md "TPM", docs/DIE.md "Inside the blocks"): the schematic an engineer would draw for
// the part, drawn with the CPU die's own tools (`glyphKit`) so the two read as one family. The link to the chipset is a ladder of signal lanes, the
// registers are the six words the CPU sees as rows of hex digits, the sequencer is its four states and a counter, the hash engine the round unit the
// checksum kernel's hash needs (h * 33 ^ w), the quote engine a shift register xor-ed with the nonce, the sealed storage a table of handle and value,
// the bus master an address and a data latch on the RAM bus, the range guard a ruler over RAM with the protected window on it and the comparators
// that decide whether an access may pass. Pure drawing into a Graphics (and a callback for the few labels); the rectangles the live layer lights are
// the `*Geom` functions below, shared by the drawing and by `tpmLive`.

export const TPM_GLYPH_KINDS = new Set<TpmBlock['kind']>(['lpc', 'regs', 'seq', 'hash', 'quote', 'vault', 'ramport', 'guard']);

/** The area a symbol may use: the block under its name (the area the CPU die's cell grids fill), or null when the block is too small. */
export function tpmGlyphArea(b: Pick<TpmBlock, 'kind' | 'rect'>): Rect | null {
  if (!TPM_GLYPH_KINDS.has(b.kind)) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const hex = (n: number, d = 8): string => (n >>> 0).toString(16).padStart(d, '0');

export const REG_NAMES = ['status', 'cmd', 'arg0', 'arg1', 'result', 'fault'] as const;
export const FLAGS = [['busy', 'BSY'], ['error', 'ERR'], ['present', 'PRS'], ['done', 'DNE'], ['prot', 'PRT']] as const;
export const STATE_NAMES = ['IDLE', 'IN', 'WORK', 'OUT'] as const;
export const CMD_NAMES = ['', 'MEASURE', 'ATTEST', 'SEAL', 'UNSEAL', 'PROTECT', 'UNPROTECT'] as const;
export const FAULT_NAMES = ['', 'BAD COMMAND', 'BAD RANGE', 'NO SUCH KEY', 'VIOLATION'] as const;
export const LPC_PINS = ['clk', 'frame', 'ad0', 'ad1', 'ad2', 'ad3', 'rst'] as const;

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** The header link: a lane per signal, each a row of cells the bits march along, and a meter for the ticks a hop takes. */
export function lpcGeom(a: Rect) {
  const n = LPC_PINS.length, lw = 32, foot = 44, pitch = Math.min(44, (a.h - foot) / n);
  const pins = LPC_PINS.map((name, k) => {
    const cy = a.y + (k + 0.5) * pitch, lane = R(a.x + lw, cy - 5, a.w - lw, 10), cw = lane.w / 10;
    return { name, cy, lane, cells: Array.from({ length: 10 }, (_, j) => R(lane.x + j * cw + 1, lane.y + 1, cw - 2, lane.h - 2)) };
  });
  const meter = R(a.x, a.y + n * pitch + 14, a.w, 10);
  return { pins, meter, note: { x: a.x, y: meter.y + 22 }, lw };
}

/** The six registers: a name and eight hex digits each, the status row as five flag chips. */
export function regsGeom(a: Rect) {
  const n = REG_NAMES.length, pitch = a.h / n, nw = 46, h = Math.max(8, pitch - 8), vx = a.x + nw, vw = a.w - nw, gap = 2, dw = (vw - 7 * gap) / 8, cw = (vw - 4 * 3) / 5;
  return {
    nw,
    rows: REG_NAMES.map((name, k) => {
      const y = a.y + k * pitch + 4;
      return {
        name, y, h, value: R(vx, y, vw, h),
        digits: Array.from({ length: 8 }, (_, j) => R(vx + j * (dw + gap), y, dw, h)),
        chips: Array.from({ length: 5 }, (_, j) => R(vx + j * (cw + 3), y, cw, h)),
      };
    }),
  };
}

/** The sequencer: its four states, the bar of the phase's ticks and the line naming the command. */
export function seqGeom(a: Rect) {
  const sh = Math.min(26, a.h * 0.38), gapw = 16, sw = (a.w - 3 * gapw) / 4;
  const bar = R(a.x, a.y + sh + 8, a.w, 8);
  return { states: STATE_NAMES.map((_, k) => R(a.x + k * (sw + gapw), a.y, sw, sh)), gapw, bar, cmd: R(a.x, bar.y + 14, a.w, Math.max(10, a.y + a.h - (bar.y + 14))) };
}

/** The hash engine: the word in, the round unit (`stages` steps on the serial module, one on the fast one), the accumulator with its feedback, the seed, the progress and the result. */
export function hashGeom(a: Rect, stages: number) {
  const rowH = Math.min(38, a.h * 0.36), arrow = 16, word = R(a.x, a.y, 104, rowH), acc = R(a.x + a.w - 176, a.y, 176, rowH);
  const x0 = word.x + word.w + arrow, x1 = acc.x - arrow, steps: Rect[] = [];
  if (stages > 1) { const gp = 8, sw = (x1 - x0 - (stages - 1) * gp) / stages; for (let k = 0; k < stages; k++) steps.push(R(x0 + k * (sw + gp), a.y, sw, rowH)); } else steps.push(R(x0, a.y, x1 - x0, rowH));
  const dw = (acc.w - 14) / 8, y2 = a.y + rowH + 26;
  return {
    rowH, word, steps, acc, x0, x1, loopY: a.y + rowH + 10,
    accDigits: Array.from({ length: 8 }, (_, j) => R(acc.x + 2 + j * (dw + 1.5), acc.y + rowH * 0.2, dw, rowH * 0.6)),
    seed: R(a.x, y2, 104, 18), bar: R(a.x + 104 + arrow, y2, acc.x - arrow - (a.x + 104 + arrow), 18), out: R(acc.x, y2, acc.w, 18),
  };
}

/** The quote engine: the nonce and the shift register meet in an xor, then the signing rounds, then the quote. */
export function quoteGeom(a: Rect, rounds: number) {
  const h = Math.min(20, a.h - 6), nonce = R(a.x, a.y, 60, h), xor = { cx: nonce.x + nonce.w + 22, cy: a.y + h / 2, r: Math.min(8, h / 2) };
  const prng = R(xor.cx + 22, a.y, 150, h), quote = R(a.x + a.w - 110, a.y, 110, h), rx0 = prng.x + prng.w + 22, rx1 = quote.x - 16, gp = 6;
  const rw = Math.min(46, (rx1 - rx0 - (rounds - 1) * gp) / rounds);
  return {
    nonce, xor, prng, quote, wireY: a.y + h + 6,
    cells: Array.from({ length: 16 }, (_, j) => R(prng.x + 2 + j * ((prng.w - 4) / 16), a.y + 2, (prng.w - 4) / 16 - 1.5, h - 4)),
    rounds: Array.from({ length: rounds }, (_, k) => R(rx0 + k * (rw + gp), a.y, rw, h)),
  };
}

/** The sealed storage: a table of slots, a handle and a value in each. */
export function vaultGeom(a: Rect, keys: number) {
  const gx = 16, gy = 4, rows = Math.ceil(keys / 2), sw = (a.w - gx) / 2, sh = (a.h - (rows - 1) * gy) / rows;
  return Array.from({ length: keys }, (_, k) => {
    const x = a.x + (k % 2) * (sw + gx), y = a.y + Math.floor(k / 2) * (sh + gy);
    return { slot: R(x, y, sw, sh), handle: R(x + 26, y + 2, 64, sh - 4), value: R(x + 94, y + 2, sw - 94 - 4, sh - 4) };
  });
}

/** The bus master: the address it drives, the word it latches, the request and the acknowledge, and the lanes of the RAM bus. */
export function ramGeom(a: Rect) {
  const addr = R(a.x, a.y, 240, 26), data = R(a.x, a.y + 38, 240, 26), bx = a.x + 240 + 18, bw = a.x + a.w - bx - 4, cw = bw / 10;
  const lane = (cy: number) => ({ cy, lane: R(bx, cy - 5, bw, 10), cells: Array.from({ length: 10 }, (_, j) => R(bx + j * cw + 1, cy - 4, cw - 2, 8)) });
  return { addr, data, req: R(a.x, a.y + 78, 56, 16), ack: R(a.x + 66, a.y + 78, 56, 16), count: R(a.x + 140, a.y + 78, 240, 16), busA: lane(addr.y + 13), busD: lane(data.y + 13), bx, bw };
}

/** The range guard: the ruler over RAM with the window on it, the bounds, the two comparators and the gate that lets an access pass, the surcharge and the lock. */
export function guardGeom(a: Rect) {
  const ruler = R(a.x, a.y + 16, a.w, 18), lo = R(a.x + 22, a.y + 58, 150, 22), hi = R(a.x + 22, a.y + 90, 150, 22);
  return {
    ruler, lo, hi,
    cmpLo: { x: a.x + 190, cy: lo.y + 11 }, cmpHi: { x: a.x + 190, cy: hi.y + 11 }, gate: { x: a.x + 238, cy: lo.y + 28 },
    allow: R(a.x + 282, lo.y, 66, 20), trap: R(a.x + 282, hi.y + 2, 66, 20),
    sur: R(a.x, a.y + 130, 200, 18), cnt: R(a.x + 210, a.y + 130, a.w - 210, 18),
    lock: { cx: a.x + a.w - 52, cy: a.y + 98, s: 44 },
  };
}

/** The window the protected range cuts out of the ruler (RAM is `ram` bytes). */
export function guardWindow(ruler: Rect, range: { lo: number; hi: number }, ram: number): Rect {
  const x0 = ruler.x + (Math.min(ram, range.lo) / ram) * ruler.w, x1 = ruler.x + (Math.min(ram, range.hi) / ram) * ruler.w;
  return R(x0, ruler.y, Math.max(2, x1 - x0), ruler.h);
}

// ---------------------------------------------------------------- the static symbols

/** A padlock, closed or open, centred at (cx, cy) with a body `s` wide. */
export function padlock(g: Graphics, cx: number, cy: number, s: number, closed: boolean, color: string, fill: string): void {
  const bw = s, bh = s * 0.72, by = cy - bh * 0.1;
  g.roundRect(cx - bw / 2, by, bw, bh, 3).fill({ color: fill }).stroke({ width: 1.6, color });
  g.circle(cx, by + bh * 0.42, s * 0.09).fill({ color });
  const sr = s * 0.3;
  if (closed) g.moveTo(cx - sr, by).lineTo(cx - sr, by - sr * 0.8).arc(cx, by - sr * 0.8, sr, Math.PI, 0).lineTo(cx + sr, by).stroke({ width: 2.2, color });
  else g.moveTo(cx - sr, by).lineTo(cx - sr, by - sr * 0.8).arc(cx, by - sr * 0.8, sr, Math.PI, 0).lineTo(cx + sr, by - sr * 1.1).stroke({ width: 2.2, color });
}

/** Draw the symbol of block `b` into `g`; `put` adds a label. `stages`, `rounds` and `keys` are the plan input's. */
export function tpmGlyph(g: Graphics, T: Theme, b: TpmBlock, c: string, put: Put, opt: { stages: number; rounds: number; keys: number }): void {
  const a = tpmGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put);
  const { solid, soft, line, rect, stub } = kit;
  const lab = (t: string, lx: number, ly: number, size = 7.5) => put(t, lx + (t.length * size * 0.6) / 2, ly, size);
  const outline = (r: Rect) => { g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const arrow = (x0: number, y: number, x1: number) => { stub(x0, y, x1, y); g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line }); };
  const dot = (px: number, py: number) => { g.circle(px, py, 1.7).fill({ color: line }); };
  switch (b.kind) {
    case 'lpc': {
      const q = lpcGeom(a);
      for (const p of q.pins) {
        lab(p.name, a.x, p.cy, 7.5);
        rect(p.lane.x, p.lane.y, p.lane.w, p.lane.h, soft);
        for (const r of p.cells) g.rect(r.x, r.y, r.w, r.h).fill({ color: soft });
        outline(p.lane);
      }
      rect(q.meter.x, q.meter.y, q.meter.w, q.meter.h, soft); outline(q.meter);
      lab('20 ticks each way', q.note.x, q.note.y, 7.5);
      break;
    }
    case 'regs': {
      const q = regsGeom(a);
      q.rows.forEach((row, k) => {
        lab(row.name, a.x, row.y + row.h / 2, 7.5);
        if (k === 0) row.chips.forEach((r, j) => { rect(r.x, r.y, r.w, r.h, soft); outline(r); put(FLAGS[j]![1], r.x + r.w / 2, r.y + r.h / 2, Math.min(7, row.h * 0.5)); });
        else { for (const d of row.digits) rect(d.x, d.y, d.w, d.h, soft); outline(row.value); }
      });
      break;
    }
    case 'seq': {
      const q = seqGeom(a);
      q.states.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, soft); outline(r); put(STATE_NAMES[k]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(8, r.h * 0.4)); if (k < 3) arrow(r.x + r.w + 2, r.y + r.h / 2, r.x + r.w + q.gapw - 2); });
      // the way back from OUT to IDLE
      const s0 = q.states[0]!, s3 = q.states[3]!, by = s0.y + s0.h + 3;
      g.moveTo(s3.x + s3.w / 2, s3.y + s3.h).lineTo(s3.x + s3.w / 2, by).lineTo(s0.x + s0.w / 2, by).lineTo(s0.x + s0.w / 2, s0.y + s0.h).stroke({ width: 1, color: line, alpha: 0.55 });
      rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft); outline(q.bar);
      break;
    }
    case 'hash': {
      const q = hashGeom(a, opt.stages), my = q.word.y + q.rowH / 2;
      rect(q.word.x, q.word.y, q.word.w, q.word.h, soft); outline(q.word); lab('word from RAM', q.word.x + 2, q.word.y - 6);
      arrow(q.word.x + q.word.w + 1, my, q.x0 - 1);
      q.steps.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, solid); outline(r);
        put(opt.stages > 1 ? ['h<<5', '+h', '^w', 'latch'][k] ?? '' : 'h * 33 ^ w', r.x + r.w / 2, r.y + r.h / 2, opt.stages > 1 ? 7 : 8);
        if (k < q.steps.length - 1) stub(r.x + r.w, r.y + r.h / 2, q.steps[k + 1]!.x, r.y + r.h / 2);
      });
      arrow(q.x1 + 1, my, q.acc.x - 1);
      rect(q.acc.x, q.acc.y, q.acc.w, q.acc.h, soft); outline(q.acc);
      for (const d of q.accDigits) rect(d.x, d.y, d.w, d.h, solid);
      lab('h', q.acc.x + 2, q.acc.y - 6, 7.5);
      // the feedback: the accumulator goes back into the round unit
      g.moveTo(q.acc.x + q.acc.w - 12, q.acc.y + q.acc.h).lineTo(q.acc.x + q.acc.w - 12, q.loopY).lineTo(q.x0 + 6, q.loopY).lineTo(q.x0 + 6, q.steps[0]!.y + q.steps[0]!.h).stroke({ width: 1, color: line, alpha: 0.7 });
      dot(q.acc.x + q.acc.w - 12, q.acc.y + q.acc.h);
      rect(q.seed.x, q.seed.y, q.seed.w, q.seed.h, soft); outline(q.seed); put('seed 0x1505', q.seed.x + q.seed.w / 2, q.seed.y + q.seed.h / 2, 7);
      rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft); outline(q.bar);
      rect(q.out.x, q.out.y, q.out.w, q.out.h, soft); outline(q.out);
      break;
    }
    case 'quote': {
      const q = quoteGeom(a, opt.rounds), my = q.nonce.y + q.nonce.h / 2;
      rect(q.nonce.x, q.nonce.y, q.nonce.w, q.nonce.h, soft); outline(q.nonce); lab('nonce', q.nonce.x + 2, q.nonce.y - 6);
      g.circle(q.xor.cx, q.xor.cy, q.xor.r).fill({ color: soft }).stroke({ width: 1.3, color: line });
      g.moveTo(q.xor.cx - q.xor.r * 0.5, q.xor.cy).lineTo(q.xor.cx + q.xor.r * 0.5, q.xor.cy).moveTo(q.xor.cx, q.xor.cy - q.xor.r * 0.5).lineTo(q.xor.cx, q.xor.cy + q.xor.r * 0.5).stroke({ width: 1.3, color: line });
      stub(q.nonce.x + q.nonce.w, my, q.xor.cx - q.xor.r, my);
      stub(q.prng.x, my, q.xor.cx + q.xor.r, my);
      for (const r of q.cells) rect(r.x, r.y, r.w, r.h, soft);
      outline(q.prng);
      // the xor goes down, runs under the shift register and up into the first signing round
      const r0 = q.rounds[0]!;
      g.moveTo(q.xor.cx, q.xor.cy + q.xor.r).lineTo(q.xor.cx, q.wireY).lineTo(r0.x - 9, q.wireY).lineTo(r0.x - 9, my).lineTo(r0.x, my).stroke({ width: 1, color: line, alpha: 0.8 });
      q.rounds.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, solid); outline(r); put(`r${k + 1}`, r.x + r.w / 2, r.y + r.h / 2, 7); if (k < q.rounds.length - 1) stub(r.x + r.w, my, q.rounds[k + 1]!.x, my); });
      const rl = q.rounds[q.rounds.length - 1]!;
      arrow(rl.x + rl.w + 1, my, q.quote.x - 1);
      rect(q.quote.x, q.quote.y, q.quote.w, q.quote.h, soft); outline(q.quote);
      lab('prng', q.prng.x + 2, a.y + a.h - 3, 7.5);
      break;
    }
    case 'vault': {
      vaultGeom(a, opt.keys).forEach((s, k) => {
        rect(s.slot.x, s.slot.y, s.slot.w, s.slot.h, T.die); g.roundRect(s.slot.x, s.slot.y, s.slot.w, s.slot.h, 1.5).stroke({ width: 0.8, color: line, alpha: 0.45 });
        lab(`k${k}`, s.slot.x + 2, s.slot.y + s.slot.h / 2, 7.5);
        rect(s.handle.x, s.handle.y, s.handle.w, s.handle.h, soft); rect(s.value.x, s.value.y, s.value.w, s.value.h, soft);
      });
      break;
    }
    case 'ramport': {
      const q = ramGeom(a);
      for (const [r, t] of [[q.addr, 'addr'], [q.data, 'data']] as [Rect, string][]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); lab(t, r.x - 0, r.y - 5, 7.5); }
      for (const [r, t] of [[q.req, 'req'], [q.ack, 'ack']] as [Rect, string][]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); put(t, r.x + r.w / 2, r.y + r.h / 2, 7); }
      for (const bus of [q.busA, q.busD]) {
        stub(bus === q.busA ? q.addr.x + q.addr.w : q.data.x + q.data.w, bus.cy, q.bx, bus.cy);
        rect(bus.lane.x, bus.lane.y, bus.lane.w, bus.lane.h, soft);
        for (const r of bus.cells) g.rect(r.x, r.y, r.w, r.h).fill({ color: soft });
        outline(bus.lane);
      }
      put('to the RAM bus', q.bx + q.bw / 2, q.busD.cy + 17, 7);
      break;
    }
    case 'guard': {
      const q = guardGeom(a);
      rect(q.ruler.x, q.ruler.y, q.ruler.w, q.ruler.h, soft); outline(q.ruler);
      for (let k = 1; k < 16; k++) stub(q.ruler.x + (q.ruler.w * k) / 16, q.ruler.y + q.ruler.h - 5, q.ruler.x + (q.ruler.w * k) / 16, q.ruler.y + q.ruler.h);
      lab('RAM, first byte to last', a.x, a.y + 6, 7.5);
      for (const [r, t] of [[q.lo, 'lo'], [q.hi, 'hi']] as [Rect, string][]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); lab(t, a.x, r.y + r.h / 2, 7.5); }
      for (const m of [q.cmpLo, q.cmpHi]) {
        stub(q.lo.x + q.lo.w, m.cy, m.x, m.cy);
        g.poly([m.x, m.cy - 7, m.x + 16, m.cy, m.x, m.cy + 7]).fill({ color: soft }).stroke({ width: 1.2, color: line });
        stub(m.x + 16, m.cy, q.gate.x, q.gate.cy);
      }
      put('>=', q.cmpLo.x + 5, q.cmpLo.cy, 6); put('<', q.cmpHi.x + 5, q.cmpHi.cy, 6);
      g.roundRect(q.gate.x, q.gate.cy - 10, 18, 20, 5).fill({ color: soft }).stroke({ width: 1.2, color: line });
      put('&', q.gate.x + 9, q.gate.cy, 8);
      stub(q.gate.x + 18, q.gate.cy, q.allow.x, q.allow.y + q.allow.h / 2);
      for (const [r, t] of [[q.allow, 'ALLOW'], [q.trap, 'TRAP']] as [Rect, string][]) { rect(r.x, r.y, r.w, r.h, soft); outline(r); put(t, r.x + r.w / 2, r.y + r.h / 2, 7); }
      rect(q.sur.x, q.sur.y, q.sur.w, q.sur.h, soft); outline(q.sur); rect(q.cnt.x, q.cnt.y, q.cnt.w, q.cnt.h, soft); outline(q.cnt);
      padlock(g, q.lock.cx, q.lock.cy, q.lock.s, false, line, T.die);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- the live symbols

/** What the module is doing, as the symbols need it: the snapshot, or a replay of a command that finished before the player looked. */
export interface TpmShow {
  phase: 'idle' | 'in' | 'work' | 'out';
  /** How far through the phase (0..1). */
  progress: number;
  cmd: number;
  arg0: number;
  arg1: number;
  result: number;
  fault: number;
  busy: boolean;
  error: boolean;
  done: boolean;
  /** Words hashed so far and the hash so far (a measure in its work phase). */
  hashed: number;
  partial: number;
  range: { lo: number; hi: number } | null;
  ram: number;
  sealed: { handle: number; value: number }[];
  guardedAccesses: number;
  measuredWords: number;
  lastViolation: number;
  surcharge: number;
  /** A command replayed after it finished (the registers are its, the running hash is not known), not the module's state now. */
  replay: boolean;
  /** The clock the motion runs on (ms). */
  ms: number;
}

export type LiveKey = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad';
export interface TpmLiveItem { rect: Rect; color: LiveKey; a: number }
export interface TpmLiveText { rect: Rect; top: string; ink?: boolean; small?: boolean; fit?: number }
export interface TpmLive { texts: TpmLiveText[]; lit: TpmLiveItem[] }

const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);

/** The engine block a command works in. */
export const ENGINE_OF: Record<number, string> = { 1: 'hash', 2: 'quote', 3: 'vault', 4: 'vault', 5: 'guard', 6: 'guard' };

/** What a block shows now: the rectangles to light and the texts to put in them. */
export function tpmLive(b: Pick<TpmBlock, 'kind' | 'rect'>, a: Rect, s: TpmShow, opt: { stages: number; rounds: number; keys: number }): TpmLive {
  const out: TpmLive = { texts: [], lit: [] };
  const working = s.phase === 'work', moving = s.phase === 'in' || s.phase === 'out', mine = ENGINE_OF[s.cmd];
  const num = (r: Rect, t: string, ink = true) => out.texts.push({ rect: r, top: t, small: true, ink });
  switch (b.kind) {
    case 'lpc': {
      const q = lpcGeom(a);
      q.pins.forEach((p, k) => {
        if (p.name === 'clk') p.cells.forEach((r, j) => { if ((j + Math.floor(s.ms / 160)) % 2 === 0) out.lit.push({ rect: r, color: 'alu', a: s.busy ? 0.7 : 0.28 }); });
        else if (p.name === 'frame') { if (moving) out.lit.push({ rect: { ...p.lane, w: p.lane.w * (s.phase === 'in' ? s.progress : 1) }, color: 'alu', a: 0.5 }); }
        else if (p.name === 'rst') { if (s.busy || s.done) out.lit.push({ rect: p.lane, color: 'alu', a: 0.18 }); } // held high while the module runs
        else if (moving) p.cells.forEach((r, j) => { const jj = s.phase === 'in' ? j : 9 - j; if (Math.floor(wave(s.ms, jj + k) * 3) === 2) out.lit.push({ rect: r, color: 'mul', a: 0.8 }); });
      });
      if (moving) out.lit.push({ rect: { ...q.meter, w: q.meter.w * s.progress }, color: 'mul', a: 0.75 });
      out.texts.push({ rect: { x: q.meter.x, y: q.note.y + 8, w: q.meter.w, h: 14 }, top: s.phase === 'in' ? 'command in' : s.phase === 'out' ? 'answer out' : s.busy ? 'working' : 'idle', small: true, ink: true, fit: 14 });
      break;
    }
    case 'regs': {
      const q = regsGeom(a);
      const word = [0, s.cmd, s.arg0, s.arg1, s.result, s.fault];
      q.rows.forEach((row, k) => {
        if (k === 0) {
          const on = [s.busy, s.error, true, s.done, !!s.range];
          row.chips.forEach((r, j) => { if (on[j]) out.lit.push({ rect: r, color: j === 1 ? 'bad' : j === 4 ? 'bad' : 'st', a: 0.7 }); });
          return;
        }
        const written = (k >= 1 && k <= 3 && s.phase === 'in') || (k === 4 && s.phase === 'out') || (k === 5 && s.fault !== 0);
        if (written) out.lit.push({ rect: row.value, color: k === 5 ? 'bad' : 'st', a: 0.25 + 0.2 * wave(s.ms, k) });
        const h = hex(word[k]!);
        row.digits.forEach((d, j) => { if (h[j] !== '0' || word[k] !== 0) num(d, h[j]!); else num(d, '0', false); });
      });
      break;
    }
    case 'seq': {
      const q = seqGeom(a), at = s.phase === 'idle' ? 0 : s.phase === 'in' ? 1 : s.phase === 'work' ? 2 : 3;
      out.lit.push({ rect: q.states[at]!, color: 'br', a: s.phase === 'idle' ? 0.4 : 0.75 });
      if (s.phase !== 'idle') out.lit.push({ rect: { ...q.bar, w: q.bar.w * s.progress }, color: 'br', a: 0.85 });
      const name = CMD_NAMES[s.cmd] ?? '', err = s.error && s.fault ? `  ${FAULT_NAMES[s.fault] ?? ''}` : '';
      if (name || err) out.texts.push({ rect: q.cmd, top: `${name}${err}`.trim(), small: true, ink: true, fit: 18 });
      break;
    }
    case 'hash': {
      const q = hashGeom(a, opt.stages), on = mine === 'hash' && working, n = Math.max(1, s.arg1);
      if (on) {
        out.lit.push({ rect: q.word, color: 'ld', a: 0.45 }, { rect: q.acc, color: 'mul', a: 0.22 });
        if (opt.stages > 1) { const f = s.progress * n - Math.floor(s.progress * n), at = Math.min(opt.stages - 1, Math.floor(f * opt.stages)); out.lit.push({ rect: q.steps[at]!, color: 'mul', a: 0.8 }); }
        else out.lit.push({ rect: q.steps[0]!, color: 'mul', a: 0.5 + 0.3 * wave(s.ms, 0) });
        out.lit.push({ rect: { ...q.bar, w: q.bar.w * Math.min(1, s.hashed / n) }, color: 'mul', a: 0.8 });
        out.texts.push({ rect: q.word, top: `w[${s.hashed}]`, small: true, ink: true, fit: 8 });
        if (!s.replay) { const h = hex(s.partial); q.accDigits.forEach((d, j) => num(d, h[j]!)); } // a replay does not know the words, only the answer
      } else if (s.cmd === 1 && s.done) {
        const h = hex(s.result);
        q.accDigits.forEach((d, j) => num(d, h[j]!));
        out.lit.push({ rect: q.out, color: 'mul', a: 0.5 });
      }
      if (s.cmd === 1 && (working || s.done)) {
        out.texts.push({ rect: q.bar, top: working ? `${s.hashed} / ${s.arg1} words` : `${s.arg1} words`, small: true, ink: true, fit: 16 });
        if (s.done || s.hashed >= s.arg1) out.texts.push({ rect: q.out, top: `0x${hex(s.result)}`, small: true, ink: true, fit: 10 });
      }
      break;
    }
    case 'quote': {
      const q = quoteGeom(a, opt.rounds), on = mine === 'quote' && working;
      if (on) {
        out.lit.push({ rect: q.nonce, color: 'ld', a: 0.5 });
        q.cells.forEach((r, j) => { if (Math.floor(wave(s.ms, j, 1.6) * 2) === 1) out.lit.push({ rect: r, color: 'mul', a: 0.75 }); });
        const at = Math.min(opt.rounds - 1, Math.floor(s.progress * opt.rounds));
        q.rounds.forEach((r, k) => { if (k <= at) out.lit.push({ rect: r, color: 'mul', a: k === at ? 0.85 : 0.45 }); });
        out.texts.push({ rect: q.nonce, top: `0x${hex(s.arg0, 4)}`, small: true, ink: true, fit: 8 });
      } else if (s.cmd === 2 && s.done) {
        out.lit.push({ rect: q.quote, color: 'mul', a: 0.5 });
      }
      if (s.cmd === 2 && (s.done || (working && s.progress > 0.95))) out.texts.push({ rect: q.quote, top: `0x${hex(s.result)}`, small: true, ink: true, fit: 10 });
      break;
    }
    case 'vault': {
      const slots = vaultGeom(a, opt.keys), touched = (s.cmd === 3 || s.cmd === 4) && (working || s.done || s.phase === 'out') ? s.arg0 : -1;
      slots.forEach((q, k) => {
        const e = s.sealed[k];
        if (!e) return;
        const hot = e.handle === touched;
        out.lit.push({ rect: q.slot, color: 'ld', a: hot ? 0.3 + 0.25 * wave(s.ms, 0) : 0.12 });
        out.lit.push({ rect: q.handle, color: 'ld', a: 0.3 }, { rect: q.value, color: 'ld', a: 0.3 });
        out.texts.push({ rect: q.handle, top: `0x${hex(e.handle, 4)}`, small: true, ink: true, fit: 6 }, { rect: q.value, top: `0x${hex(e.value)}`, small: true, ink: true, fit: 10 });
      });
      break;
    }
    case 'ramport': {
      const q = ramGeom(a), on = mine === 'hash' && working;
      if (on) {
        const addr = (s.arg0 + 4 * s.hashed) >>> 0, tick = Math.floor(s.ms / 120) % 2 === 0;
        out.lit.push({ rect: q.addr, color: 'ld', a: 0.4 }, { rect: q.data, color: 'ld', a: 0.3 }, { rect: tick ? q.req : q.ack, color: 'ld', a: 0.85 });
        for (const bus of [q.busA, q.busD]) bus.cells.forEach((r, j) => { if (Math.floor(wave(s.ms, bus === q.busA ? j : 9 - j) * 3) === 2) out.lit.push({ rect: r, color: 'ld', a: 0.8 }); });
        out.texts.push({ rect: q.addr, top: `0x${hex(addr)}`, small: true, ink: true, fit: 10 });
      }
      if (s.measuredWords > 0) out.texts.push({ rect: q.count, top: `${s.measuredWords} words read since power-on`, small: true, ink: true, fit: 30 });
      break;
    }
    case 'guard': {
      const q = guardGeom(a), r = s.range;
      if (r) {
        out.lit.push({ rect: guardWindow(q.ruler, r, s.ram), color: 'bad', a: 0.5 });
        out.lit.push({ rect: q.lo, color: 'bad', a: 0.2 }, { rect: q.hi, color: 'bad', a: 0.2 });
        if (s.fault !== 4) out.lit.push({ rect: q.allow, color: 'st', a: 0.35 });
        out.texts.push({ rect: q.lo, top: `0x${hex(r.lo)}`, small: true, ink: true, fit: 10 }, { rect: q.hi, top: `0x${hex(r.hi)}`, small: true, ink: true, fit: 10 });
        out.texts.push({ rect: q.sur, top: `+${s.surcharge} cycles per access`, small: true, ink: true, fit: 22 });
        out.texts.push({ rect: q.cnt, top: `${s.guardedAccesses} guarded`, small: true, ink: true, fit: 14 });
      } else out.texts.push({ rect: q.sur, top: 'off: RAM open to every job', small: true, ink: true, fit: 26 });
      if (s.fault === 4) {
        out.lit.push({ rect: q.trap, color: 'bad', a: 0.85 });
        if (s.lastViolation >= 0 && s.ram > 0) out.lit.push({ rect: { x: q.ruler.x + Math.min(1, s.lastViolation / s.ram) * q.ruler.w - 1.5, y: q.ruler.y - 3, w: 3, h: q.ruler.h + 6 }, color: 'bad', a: 0.95 });
      }
      if (mine === 'guard' && working) out.lit.push({ rect: { x: q.gate.x, y: q.gate.cy - 10, w: 18, h: 20 }, color: 'bad', a: 0.5 + 0.3 * wave(s.ms, 0) });
      break;
    }
    default: break;
  }
  return out;
}
