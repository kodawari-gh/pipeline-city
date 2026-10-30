import type { Graphics } from 'pixi.js';
import type { Block, Rect } from '../die/cpuplan';
import { aluPoly, CONTROL_LINES, glyphKit, pcDigits, slotsOf, WORD_FIELDS, type LiveGlyph, type Put } from '../die/blockart';
import { mix } from '../ink';
import { GPU_FRAME } from '../../sim/isa/memmap';
import { KERNEL_LAYOUT } from '../../sim/gen/gpukernels';
import { gpuDecode, gpuDisassemble, GPU_SPEC_BY_NAME } from '../../sim/isa/gpu';
import type { GpuStep } from '../../sim/ref/gpuref';
import type { Theme } from '../theme';
import type { GpuBlock, GpuBlockKind } from './gpuplan';
import { dramGeom } from './gpumem';
import { cellInset, gpuCells, maskParts } from './gpuplans';

// What is inside a block of a GPU card (docs/DIE.md "Inside the blocks", docs/GPU.md section 7): the schematic an engineer would draw for the part,
// drawn with the CPU die's own tools (`glyphKit`, `aluPoly`, `pcDigits`, the word strip) so the two read as one family, and wired inside: the
// decoder fans the op field out to its control lines, the scheduler's ready bits run into a round robin picker, the arbiter's requests queue per
// bank, the card memory ends in a row buffer and a controller. Pure drawing into a Graphics (and a callback for the few labels).
// The rectangles the live layer draws over (lane cells, warp cards, bank bars, register rows) are `gpuCells` / `maskParts` of gpuplans.ts and stay
// where they are; the symbols decorate inside them.

/** The block kinds with a symbol: every kind of a plan but the SM frame, which is only a frame. */
export const GPU_GLYPH_KINDS: Record<GpuBlockKind, boolean> = {
  pcie: true, launch: true, pc: true, fetch: true, decode: true, sched: true, warps: true, regfile: true, lanes: true, mask: true,
  coalescer: true, arbiter: true, banks: true, l1: true, l2: true, dram: true, sm: false,
};

export const hasGpuSymbol = (b: GpuBlock): boolean => GPU_GLYPH_KINDS[b.kind];

/** The area a symbol may use: the block under its name (the area the cell grids fill), or null when the block is too small. */
export function gpuGlyphArea(b: Pick<GpuBlock, 'kind' | 'rect'>): Rect | null {
  if (!GPU_GLYPH_KINDS[b.kind]) return null;
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

/** Which control lines an instruction raises: the ALU or memory unit it goes to, a register write, a branch or mask change, an immediate, a system operation. */
export function gpuControlLines(s: { name: string; kind: string; dest: number | null }): Set<string> {
  const out = new Set<string>();
  if (s.kind === 'alu') out.add('alu');
  if (s.kind === 'ld' || s.kind === 'st') out.add('mem');
  if (s.dest !== null) out.add('wr');
  if (s.kind === 'br' || s.kind === 'mask') out.add('br');
  if (/i$/.test(s.name) || s.name === 'vli' || s.kind === 'ld' || s.kind === 'st') out.add('imm');
  if (s.kind === 'sys') out.add('sys');
  return out;
}

/** The block as the CPU die's slot geometry takes it (it reads only the id, kind, label, sub and rectangle). */
const asCpuBlock = (b: Pick<GpuBlock, 'id' | 'kind' | 'label' | 'sub' | 'rect'>) => b as unknown as Pick<Block, 'id' | 'kind' | 'label' | 'sub' | 'rect'>;

/** The five slots of the decoder's word strip for a GPU instruction (op, rd, rs1, rs2, imm), '' where the format has none. */
export function gpuSlotValues(word: number): string[] {
  const i = gpuDecode(word);
  if (!i) return ['?', '', '', '', ''];
  const f = GPU_SPEC_BY_NAME.get(i.name)!.fmt, v = (n: number) => `v${n}`;
  return [i.name, f === 'R' || f === 'I' || f === 'D' ? v(i.rd) : '', f === 'R' || f === 'I' || f === 'S' || f === 'M' ? v(i.rs1) : '', f === 'R' || f === 'S' || f === 'M' ? v(i.rs2) : '', f === 'I' || f === 'S' || f === 'O' ? String(i.imm) : ''];
}

/** Indices into CONTROL_LINES the instruction raises. */
export const gpuControlIndices = (s: { name: string; kind: string; dest: number | null }): number[] => {
  const set = gpuControlLines(s);
  return CONTROL_LINES.flatMap((n, k) => (set.has(n) ? [k] : []));
};

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

const WORD_BITS = WORD_FIELDS.reduce((n, f) => n + f.bits, 0);
/** The fields of a word strip in proportion to their bits. */
function fieldRects(x: number, y: number, w: number, h: number): Rect[] {
  let fx = x;
  return WORD_FIELDS.map((f) => { const fw = (w * f.bits) / WORD_BITS, r = { x: fx, y, w: fw, h }; fx += fw; return r; });
}

/** The program counter's digits, on the left of the block with the next-pc logic beside them when it is wide enough. */
export const pcArea = (a: Rect): Rect => ({ x: a.x, y: a.y, w: a.w >= 200 ? a.w * 0.54 : a.w, h: Math.min(a.h, 22) });

/** The fetch: a window of the kernel, the word being fetched on the first row (the live word goes there), the words behind it dim; a wide block keeps a side panel (kernel base + pc = the address) on the right. */
export function fetchGeom(a: Rect): { gutter: number; rows: Rect[]; side: Rect | null } {
  const gutter = a.w >= 90 ? 18 : 0, rh = Math.min(14, a.h), n = Math.max(1, Math.min(5, Math.floor((a.h + 3) / 17)));
  const side = a.w >= 400 ? { x: a.x + a.w - 150, y: a.y, w: 150, h: rh } : null, rw = a.w - gutter - (side ? 158 : 0);
  return { gutter, rows: Array.from({ length: n }, (_, k) => ({ x: a.x + gutter, y: a.y + k * 17, w: rw, h: rh })), side };
}

/** The units inside a lane's ALU, in the order they are drawn, and the unit an instruction goes through (-1 when it does not use the ALU). */
export const ALU_UNITS = ['add', 'logic', 'shift', 'cmp', 'mul', 'min/max'] as const;
export function aluUnitOf(name: string): number {
  if (/^(vadd|vsub|vaddi|vli|lane|vld|vst)$/.test(name)) return 0;
  if (/^(vand|vor|vxor|vandi)$/.test(name)) return 1;
  if (/^(vsll|vsrl|vsra|vslli|vsrli|vsrai)$/.test(name)) return 2;
  if (/^(vslt|mset(eq|ne|lt|ge))$/.test(name)) return 3;
  if (name === 'vmul') return 4;
  if (/^(vmin|vmax)$/.test(name)) return 5;
  return -1;
}

/** Inside a roomy lane cell: the operand bus, one box per unit, the mux that picks the result, the result latch. Null for the small cells of the wider cards. */
export function laneUnits(r: Rect): { units: Rect[]; busX: number; mux: Rect; res: Rect; notch: { x: number; y: number } } | null {
  if (r.w < 70 || r.h < 40) return null;
  const ax = r.x + 1.5, ay = r.y + 1.5, aw = r.w - 3, ah = r.h - 3, n = ALU_UNITS.length;
  const busX = ax + aw * 0.22, top = ay + ah * 0.16, span = ah * 0.68, pitch = span / n, ux = busX + 12, uw = aw * 0.3;
  const mux = { x: ux + uw + 9, y: top, w: aw * 0.07, h: span };
  return {
    units: ALU_UNITS.map((_, k) => ({ x: ux, y: top + k * pitch + 1, w: uw, h: pitch - 2 })), busX, mux,
    res: { x: mux.x + mux.w + 14, y: ay + ah * 0.38, w: Math.max(10, ax + aw * 0.96 - (mux.x + mux.w + 14)), h: ah * 0.24 }, notch: { x: ax + aw * 0.14, y: ay + ah / 2 },
  };
}

/** The decoder: the word on top; below it, when there is room, the register selects and the sign extender under their fields, the control unit under the op field and the control lines it fans out to. */
export function decodeGeom(a: Rect): { word: Rect; fields: Rect[]; lines: Rect[]; rich: boolean; sel: Rect[]; ctl: Rect; sext: Rect; busY: number } {
  const { x, y, w, h } = a, wh = Math.min(14, h * 0.4), n = CONTROL_LINES.length;
  const rich = h >= 56 && w >= 110, lh = 11, selH = 11;
  const gap = rich ? Math.max(6, Math.min(26, (h - wh - selH - lh) / 2)) : 0;
  const fields = fieldRects(x, y, w, wh), word = { x, y, w, h: wh };
  if (!rich) {
    const ly = y + wh + 4, h1 = Math.max(4, Math.min(11, h - wh - 6)), lw = (w - (n - 1) * 3) / n;
    return { word, fields, lines: CONTROL_LINES.map((_, k) => ({ x: x + k * (lw + 3), y: ly, w: lw, h: h1 })), rich, sel: [], ctl: word, sext: word, busY: ly };
  }
  const ySel = y + wh + gap, yLines = ySel + selH + gap, lw = (w - (n - 1) * 3) / n, box = (f: Rect): Rect => ({ x: f.x + 1, y: ySel, w: f.w - 2, h: selH });
  return {
    word, fields, rich, busY: ySel + selH + gap / 2, ctl: box(fields[0]!), sel: [1, 2, 3].map((k) => box(fields[k]!)), sext: box(fields[4]!),
    lines: CONTROL_LINES.map((_, k) => ({ x: x + k * (lw + 3), y: yLines, w: lw, h: lh })),
  };
}

/** The registers of the launch block, in the order of its rows. */
export const LAUNCH_REGS = ['kernel', 'arg0', 'arg1', 'lanes', 'status'] as const;

/** The host link: a receive and a transmit cell per lane, the bus into the DMA engine, and its credit counters. */
export function pcieGeom(a: Rect) {
  const { x, y, w, h } = a, foot = h > 70 ? 16 : 0, top = h > 50 ? 9 : 0, bodyH = h - foot - top;
  const n = Math.max(2, Math.min(8, Math.floor(bodyH / 11))), cw = w * 0.25 - 1, busX = x + w * 0.56;
  const lanes = Array.from({ length: n }, (_, k) => { const ry = y + top + ((k + 0.5) * bodyH) / n; return { y: ry, rx: { x, y: ry - 3, w: cw, h: 6 }, tx: { x: x + cw + 2, y: ry - 3, w: cw, h: 6 } }; });
  const dh = Math.min(bodyH * 0.5, 44), dy = y + top + (bodyH - dh) / 2, dx = x + w * 0.64, dw = x + w - dx;
  const credits: Rect[] = dy + dh + 12 < y + h - foot ? Array.from({ length: 4 }, (_, k) => ({ x: dx + 1 + (k * (dw - 2)) / 4, y: dy + dh + 6, w: (dw - 2) / 4 - 2, h: 5 })) : [];
  return { top, bodyH, n, cw, busX, lanes, dma: { x: dx, y: dy, w: dw, h: dh } as Rect, credits };
}

/** The launch registers: a value cell per register, the go flag the bus raises, and with room the three states of a launch and the command queue. */
export function launchGeom(a: Rect) {
  const { x, y, w, h } = a, rows = h >= 85 ? 5 : Math.max(3, Math.floor(h / 15));
  const state = h >= rows * 17 + 34, queue = h >= rows * 17 + 70, pitch = state ? 17 : Math.min(26, h / rows), gut = Math.min(34, w * 0.26), vw = w * 0.6 - gut, busX = x + w * 0.68;
  const regs: Rect[] = Array.from({ length: rows }, (_, k) => ({ x: x + gut, y: y + k * pitch, w: vw, h: pitch - 3 }));
  const gh = Math.min(rows * pitch * 0.5, 26), gy = y + (rows * pitch - gh) / 2 - 1.5, gx = x + w * 0.76, go: Rect = { x: gx, y: gy, w: x + w - gx, h: gh };
  const sy = y + rows * pitch + 14, bw = (w - 28) / 3, qy = sy + 34;
  const states: Rect[] = state ? [0, 1, 2].map((k) => ({ x: x + k * (bw + 14), y: sy, w: bw, h: 14 })) : [];
  const slots: Rect[] = queue ? [0, 1, 2, 3].map((k) => ({ x: x + k * ((w - 3) / 4), y: qy, w: (w - 3) / 4 - 3, h: 12 })) : [];
  return { rows, pitch, gut, vw, busX, regs, go, states, slots };
}

/** What the host side of the card is doing, as the symbols of the PCIe and launch blocks need it. */
export interface HostLive { phase: 'idle' | 'in' | 'run' | 'out'; lanes: number; launches: number; /** The clock the motion runs on, in ms. */ ms: number }

/**
 * The PCIe and launch blocks in motion: a launch crosses the link into the card (`in`: the receive cells flow, the DMA engine and its credits fill), the launch
 * registers hold the command, the go flag is up and the state machine sits at run until the kernel ends, and the result crosses back (`out`: the transmit cells).
 */
export function gpuHostLive(kind: 'pcie' | 'launch', a: Rect, h: HostLive): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  if (h.phase === 'idle') return out;
  const wave = h.ms / 90;
  if (kind === 'pcie') {
    const q = pcieGeom(a), moving = h.phase === 'in' || h.phase === 'out';
    q.lanes.forEach((l, k) => {
      if (h.phase === 'in') out.lit.push({ rect: l.rx, color: 'mul', a: 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(wave - k * 0.9)) });
      else if (h.phase === 'out') out.lit.push({ rect: l.tx, color: 'mul', a: 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(wave + k * 0.9)) });
    });
    out.lit.push({ rect: q.dma, color: 'mul', a: moving ? 0.35 + 0.25 * Math.sin(wave) ** 2 : 0.18 });
    const up = moving ? 1 + (Math.floor(h.ms / 160) % 4) : 3;
    q.credits.forEach((r, k) => { if (k < up) out.lit.push({ rect: r, color: 'mul', a: 0.85 }); });
    return out;
  }
  const l = launchGeom(a), vals: string[] = ['0x0000', '', '', String(h.lanes || ''), h.phase === 'run' ? 'busy' : h.phase];
  l.regs.forEach((r, k) => {
    out.lit.push({ rect: r, color: 'br', a: k % 2 ? 0.5 : 0.35 });
    if (vals[k]) out.texts.push({ rect: r, top: vals[k]!, bottom: '' });
  });
  out.lit.push({ rect: l.go, color: 'br', a: 0.5 + 0.3 * Math.sin(wave) ** 2 });
  const at = h.phase === 'out' ? 2 : 1;
  if (l.states[at]) out.lit.push({ rect: l.states[at]!, color: 'br', a: 0.7 });
  if (l.slots[0]) out.lit.push({ rect: l.slots[0], color: 'br', a: 0.8 });
  return out;
}

/** What the symbols of the shared kinds show for the instruction on show (the program counter's digits, the word fetched, the decoded word and the lines it raises). `prog` is how far the instruction has got into the block (0..1), as on the CPU die. */
export function gpuGlyphLive(b: Pick<GpuBlock, 'id' | 'kind' | 'label' | 'sub' | 'rect'>, a: Rect, step: GpuStep | null, prog = 1): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  if (!step) return out;
  const wipe = (r: Rect): Rect => ({ ...r, w: r.w * prog });
  switch (b.kind) {
    case 'pc': {
      const s = slotsOf(asCpuBlock(b), pcArea(a));
      if (s.digits) { const hex = (step.pc >>> 0).toString(16).padStart(8, '0'); s.digits.forEach((r, k) => out.texts.push({ rect: r, top: hex[k]!, bottom: '' })); }
      break;
    }
    case 'fetch': {
      const row = fetchGeom(a).rows[0]!;
      out.lit.push({ rect: wipe(row), color: 'alu', a: 0.92 });
      if (prog > 0.55) out.texts.push({ rect: row, top: step.word !== undefined ? gpuDisassemble(step.word) : step.name, bottom: '' });
      break;
    }
    case 'decode': {
      const d = decodeGeom(a);
      out.lit.push({ rect: wipe(d.word), color: 'alu', a: 0.92 });
      if (prog > 0.55 && step.word !== undefined) gpuSlotValues(step.word).forEach((v, n) => { if (v) out.texts.push({ rect: d.fields[n]!, top: v, bottom: '' }); });
      gpuControlIndices(step).forEach((n, j) => { if (prog > 0.45 + 0.1 * j) out.lit.push({ rect: d.lines[n]!, color: 'br', a: 0.6 }); });
      break;
    }
    default: break;
  }
  return out;
}

// ---------------------------------------------------------------- the symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. */
export function gpuGlyph(g: Graphics, T: Theme, b: GpuBlock, c: string, put: Put): void {
  const a = gpuGlyphArea(b);
  if (!a) return;
  const kit = glyphKit(g, T, c, put);
  const { solid, soft, line, rect, stub, poly, mux, adder, word } = kit;
  const { x, y, w, h } = a;
  const cells = gpuCells(b);
  /** A label starting at (lx, ly). */
  const lab = (t: string, lx: number, ly: number, size = 6.5) => put(t, lx + (t.length * size * 0.6) / 2, ly, size);
  const dot = (px: number, py: number) => { g.circle(px, py, 1.6).fill({ color: line }); };
  const outline = (rx: number, ry: number, rw: number, rh: number) => { g.roundRect(rx, ry, rw, rh, 1.5).stroke({ width: 1, color: line, alpha: 0.85 }); };
  const wire = (...p: number[]) => { g.moveTo(p[0]!, p[1]!); for (let k = 2; k < p.length; k += 2) g.lineTo(p[k]!, p[k + 1]!); g.stroke({ width: 1, color: line, alpha: 0.75 }); };

  switch (b.kind) {
    case 'pcie': {
      // the lanes of the link, receive and transmit a pair of cells each, merged onto a bus into the DMA engine and its credit counters
      const q = pcieGeom(a);
      if (q.top) { put('rx', x + q.cw / 2, y + 4, 6); put('tx', x + q.cw + 2 + q.cw / 2, y + 4, 6); }
      q.lanes.forEach((l) => { rect(l.rx.x, l.rx.y, l.rx.w, l.rx.h, soft); rect(l.tx.x, l.tx.y, l.tx.w, l.tx.h, solid); stub(l.tx.x + l.tx.w, l.y, q.busX, l.y); });
      const f = q.lanes[0]!, z = q.lanes[q.lanes.length - 1]!, d = q.dma, dcy = d.y + d.h / 2;
      stub(q.busX, f.y, q.busX, z.y);
      stub(q.busX, dcy, d.x, dcy); dot(q.busX, dcy);
      rect(d.x, d.y, d.w, d.h, soft); outline(d.x, d.y, d.w, d.h); put('dma', d.x + d.w / 2, dcy, 7);
      q.credits.forEach((r, k) => rect(r.x, r.y, r.w, r.h, k < 3 ? solid : soft));
      break;
    }
    case 'launch': {
      // the argument registers by name, merged onto a bus that raises the go flag; with room, the state machine of a launch and the command queue
      const l = launchGeom(a);
      l.regs.forEach((r, k) => {
        lab(LAUNCH_REGS[k]!, x, r.y + l.pitch / 2 - 1, 6.5);
        rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
        stub(r.x + r.w, r.y + r.h / 2, l.busX, r.y + r.h / 2);
      });
      const r0 = l.regs[0]!, rz = l.regs[l.regs.length - 1]!, g = l.go, gcy = g.y + g.h / 2;
      stub(l.busX, r0.y + r0.h / 2, l.busX, rz.y + rz.h / 2);
      stub(l.busX, gcy, g.x, gcy); dot(l.busX, gcy);
      rect(g.x, g.y, g.w, g.h, soft); outline(g.x, g.y, g.w, g.h); put('go', g.x + g.w / 2, gcy, 7);
      if (l.states.length) {
        // idle -> run -> done, and the commands waiting behind the one running
        const st0 = l.states[0]!;
        lab('launch state', x, st0.y - 6, 6.5);
        l.states.forEach((r, k) => {
          rect(r.x, r.y, r.w, r.h, k === 1 ? solid : soft); outline(r.x, r.y, r.w, r.h); put(['idle', 'run', 'done'][k]!, r.x + r.w / 2, r.y + 7, 6.5);
          if (k < 2) wire(r.x + r.w, r.y + 7, r.x + r.w + 14, r.y + 7);
        });
        const last = l.states[2]!, first = l.states[0]!;
        wire(last.x + last.w / 2, last.y + 14, last.x + last.w / 2, last.y + 22, first.x + first.w / 2, last.y + 22, first.x + first.w / 2, last.y + 14);
        if (l.slots.length) { lab('command queue', x, l.slots[0]!.y - 6, 6.5); l.slots.forEach((r, k) => rect(r.x, r.y, r.w, r.h, k === 0 ? solid : soft)); }
      }
      break;
    }
    case 'pc': {
      // the program counter feeding its own next value: pc + 1 for the next word, or the branch target (pc + imm) when `jmp` or `bany` takes it, back in;
      // with room, the target adder with the immediate, and the gate that takes a `bany` only when a lane of the mask is still active
      const pa = pcArea(a);
      pcDigits(g, kit, pa);
      if (pa.w < a.w - 1) {
        const cy = pa.y + pa.h / 2, r = 7, end = pa.x + pa.w, cx = end + 23, mx = end + 54, mw = 24, mh = 22, my = cy - mh * 0.25, ox = mx + mw + 7;
        const rich = a.h >= 50, loopY = pa.y + pa.h + 9, ry = loopY + 10, selX = mx + mw / 2;
        stub(end, cy, end + 9, cy);
        adder(cx, cy, r, ['', '']);
        stub(end + 9, cy, cx - r - 7, cy); dot(end + 9, cy);
        stub(cx + r + 7, cy, mx - 7, cy);
        mux(mx, my, mw, mh, ['seq', 'tgt']);
        put('+1', cx, cy - r - 5, 5.5);
        if (!rich) { stub(mx + mw, my + mh / 2, ox, my + mh / 2); break; }
        wire(ox, my + mh / 2, ox + 1, my + mh / 2, ox + 1, loopY, pa.x + 4, loopY, pa.x + 4, pa.y + pa.h);
        dot(ox + 1, loopY); wire(ox + 1, loopY, a.x + a.w - 6, loopY); lab('to fetch', ox + 10, loopY - 5, 6);
        // the target: the pc and the immediate of the decoded word into an adder, its sum into the mux
        adder(cx, ry, r, ['', '']);
        wire(end + 9, cy, end + 9, ry - 0.55 * r);
        rect(end - 30, ry - 6, 24, 12, soft); outline(end - 30, ry - 6, 24, 12); put('imm', end - 18, ry, 6);
        stub(end - 6, ry + 0.55 * r, cx - r - 7, ry + 0.55 * r);
        wire(cx + r + 7, ry, end + 43, ry, end + 43, my + mh * 0.75, mx - 7, my + mh * 0.75);
        put('tgt', cx, ry + r + 5, 5.5);
        // the select: taken = bany and any lane active (jmp always takes it)
        g.circle(selX, ry, 6).fill({ color: soft }).stroke({ width: 1.2, color: line }); put('&', selX, ry, 7);
        wire(selX, ry - 6, selX, my + mh * 0.89);
        stub(selX + 6, ry - 2.5, selX + 14, ry - 2.5); stub(selX + 6, ry + 2.5, selX + 14, ry + 2.5);
        lab('bany', selX + 17, ry - 4, 6); lab('any lane', selX + 17, ry + 5, 6);
      }
      break;
    }
    case 'fetch': {
      // a window of the kernel: the word being fetched on the first row, the ones behind it dimmed, each by its distance from the pc
      const f = fetchGeom(a);
      f.rows.forEach((r, k) => {
        if (f.gutter) lab(k ? `+${k}` : 'pc', x, r.y + r.h / 2, 6.5);
        if (k === 0) { word(r.x, r.y, r.w, r.h, r.h >= 9); return; }
        fieldRects(r.x, r.y, r.w, r.h).forEach((fr) => rect(fr.x + 0.6, fr.y, fr.w - 1.2, fr.h, soft));
      });
      if (f.gutter && f.rows.length > 1) wire(x + f.gutter - 3, f.rows[0]!.y + f.rows[0]!.h / 2, x + f.gutter - 3, f.rows[f.rows.length - 1]!.y + f.rows[0]!.h / 2);
      if (f.side) {
        // the address of the word: the kernel's base plus the pc, out to the card memory; the word comes back into the first row
        const s = f.side, cy = s.y + s.h / 2, r = 7, cx = s.x + 52, rowEnd = f.rows[0]!.x + f.rows[0]!.w;
        lab('pc', s.x + 6, cy - 0.55 * r, 6); stub(s.x + 20, cy - 0.55 * r, cx - r - 7, cy - 0.55 * r);
        rect(s.x, cy + 0.55 * r - 3.5, 30, 7, solid); put('base', s.x + 15, cy + 0.55 * r, 5);
        stub(s.x + 30, cy + 0.55 * r, cx - r - 7, cy + 0.55 * r);
        adder(cx, cy, r, ['', '']);
        stub(cx + r + 7, cy, s.x + 98, cy);
        rect(s.x + 98, s.y, 32, s.h, soft); outline(s.x + 98, s.y, 32, s.h); put('addr', s.x + 114, cy, 6);
        stub(s.x + 130, cy, s.x + s.w, cy); lab('mem', s.x + s.w - 20, cy - 6, 5.5);
        wire(s.x + s.w, f.rows[0]!.y + f.rows[0]!.h + 3, rowEnd + 4, f.rows[0]!.y + f.rows[0]!.h + 3, rowEnd + 4, f.rows[0]!.y + f.rows[0]!.h / 2, rowEnd, f.rows[0]!.y + f.rows[0]!.h / 2);
      }
      break;
    }
    case 'decode': {
      const d = decodeGeom(a);
      word(d.word.x, d.word.y, d.word.w, d.word.h);
      if (!d.rich) {
        d.lines.forEach((r, k) => { rect(r.x, r.y, r.w, r.h, soft); if (r.h >= 7 && r.w > 14) put(CONTROL_LINES[k]!, r.x + r.w / 2, r.y + r.h / 2, 6); });
        break;
      }
      // the fields run down into their units: register selects, the sign extender, the control unit that fans the op out to its lines
      const named: [Rect, string][] = [[d.ctl, 'ctl'], [d.sel[0]!, 'dst'], [d.sel[1]!, 'srcA'], [d.sel[2]!, 'srcB'], [d.sext, 'sext']];
      named.forEach(([r, t], k) => {
        const fr = d.fields[k]!, cx = fr.x + fr.w / 2;
        stub(cx, fr.y + fr.h, cx, r.y);
        rect(r.x, r.y, r.w, r.h, k ? soft : solid); put(t, r.x + r.w / 2, r.y + r.h / 2, 6);
      });
      const cx = d.ctl.x + d.ctl.w / 2, first = d.lines[0]!, last = d.lines[d.lines.length - 1]!;
      stub(cx, d.ctl.y + d.ctl.h, cx, d.busY);
      stub(Math.min(cx, first.x + first.w / 2), d.busY, last.x + last.w / 2, d.busY); dot(cx, d.busY);
      d.lines.forEach((r, k) => { stub(r.x + r.w / 2, d.busY, r.x + r.w / 2, r.y); rect(r.x, r.y, r.w, r.h, soft); if (r.w > 14) put(CONTROL_LINES[k]!, r.x + r.w / 2, r.y + r.h / 2, 6); });
      break;
    }
    case 'sched': {
      // the scoreboard (a bit per register and warp: pending writes) and the round robin that picks the warp to issue
      const rows = b.grid?.rows ?? 1, cols = b.grid?.cols ?? 8, picker = w >= 160, gut = w >= 90 ? 30 : 12, headH = h >= 30 ? 8 : 0;
      const sw = (picker ? w * 0.62 : w) - gut, cw = sw / cols, rh = Math.min(34, (h - headH) / rows);
      if (headH && cw >= 9) for (let k = 0; k < cols; k++) put(`v${k}`, x + gut + (k + 0.5) * cw, y + 4, 5.5);
      if (headH && picker) put('ready', x + gut + sw + 5, y + 4, 5.5);
      for (let r = 0; r < rows; r++) {
        const ry = y + headH + r * rh;
        lab(gut >= 30 ? `warp ${r}` : `w${r}`, x, ry + rh / 2, 6);
        for (let k = 0; k < cols; k++) rect(x + gut + k * cw + 0.5, ry + 1, cw - 1, rh - 2, soft);
        // the warp's ready line: a gate that is true when none of the registers the next instruction reads is still pending
        g.circle(x + gut + sw + 5, ry + rh / 2, 3).fill({ color: soft }).stroke({ width: 1, color: line, alpha: r === 0 ? 1 : 0.6 });
        stub(x + gut + sw, ry + rh / 2, x + gut + sw + 2, ry + rh / 2);
        poly([x - 7, ry + rh / 2 - 3, x - 1, ry + rh / 2, x - 7, ry + rh / 2 + 3], r === 0 ? solid : soft); // the pointer
      }
      if (picker) {
        const mw = 22, mx = x + w * 0.78, mh = Math.min(h * 0.85, rows * rh + 8), my = y + headH + (rows * rh - mh) / 2, xm = x + gut + sw + 14;
        mux(mx, my, mw, mh, Array(rows).fill(''));
        for (let r = 0; r < rows; r++) wire(x + gut + sw + 7, y + headH + r * rh + rh / 2, xm, y + headH + r * rh + rh / 2, xm, my + mh * ((r + 0.5) / rows), mx - 7, my + mh * ((r + 0.5) / rows));
        put('rr', mx + mw * 0.5, my + mh / 2, 7);
        if (x + w - (mx + mw + 7) >= 30) put('issue', mx + mw + 7 + (x + w - (mx + mw + 7)) / 2, my + mh / 2, 6);
      }
      break;
    }
    case 'warps': {
      // one card per warp: its state, program counter, active mask and divergence stack
      cells.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft);
        const pad = 4, ix = r.x + pad, iw = r.w - 2 * pad;
        if (r.w >= 150 && r.h >= 62) {
          const top = r.y + 5, pitch = Math.min(28, (r.h - 22 - 9) / 3), lx = ix + 26, lw = iw - 26;
          lab(`warp ${k}`, ix, top + 4, 7);
          rect(r.x + r.w - pad - 32, top, 32, 9, solid); put('ready', r.x + r.w - pad - 16, top + 4.5, 6);
          const y1 = top + 14, y2 = y1 + pitch, y3 = y2 + pitch;
          lab('pc', ix, y1 + 6, 6.5);
          pcDigits(g, kit, { x: lx, y: y1, w: lw, h: 12 });
          lab('mask', ix, y2 + 4, 6.5);
          for (let j = 0; j < 16; j++) rect(lx + (j * lw) / 16, y2, lw / 16 - 1, 8, j < 12 ? solid : soft);
          lab('stack', ix, y3 + 5, 6.5);
          const sl = lw / 8;
          for (let j = 0; j < 8; j++) { if (j < 2) rect(lx + j * sl, y3, sl - 3, 10, solid); outline(lx + j * sl, y3, sl - 3, 10); }
        } else if (r.h >= 56 && r.w >= 36) {
          // a narrow card: its name, then the program counter, the mask and the stack each under its label
          const pitch = (r.h - 20 - 8) / 3, cx = r.x + r.w / 2;
          put(`warp ${k}`, cx, r.y + 7, 6.5);
          const y1 = r.y + 14, y2 = y1 + pitch, y3 = y2 + pitch;
          put('pc', cx, y1 + 3, 5.5); rect(ix, y1 + 7, iw, 6, solid);
          put('mask', cx, y2 + 3, 5.5); for (let j = 0; j < 8; j++) rect(ix + (j * iw) / 8, y2 + 7, iw / 8 - 1, 6, j < 6 ? solid : soft);
          put('stack', cx, y3 + 3, 5.5);
          for (let j = 0; j < 4; j++) { const sx = ix + (j * iw) / 4; if (j < 2) rect(sx, y3 + 7, iw / 4 - 2, 8, solid); outline(sx, y3 + 7, iw / 4 - 2, 8); }
        } else {
          const px = r.x + 3, pw = r.w - 6, rh = Math.max(2, (r.h - 8) / 6);
          rect(px, r.y + 3, pw * 0.7, rh, solid);
          if (r.h >= 34 && pw >= 70) { put('pc', px + pw * 0.85, r.y + 3 + rh / 2, Math.min(7, rh)); put('mask', px + pw * 0.5, r.y + 5 + rh * 1.5, Math.min(7, rh)); put('stack', px + pw * 0.5, r.y + 7 + rh * 3, Math.min(7, rh)); }
          for (let j = 0; j < 8; j++) rect(px + (j * pw) / 8, r.y + 5 + rh, Math.max(1, pw / 8 - 1), rh, j < 6 ? solid : soft);
          for (let j = 0; j < 3; j++) rect(px, r.y + 7 + rh * (2 + j) + j, pw * (0.9 - 0.2 * j), rh, soft);
        }
      });
      break;
    }
    case 'regfile': {
      // the register array, each row a register: a row decoder on the left raises the word line of the register the decoded word names, and under
      // every lane's column the two operand latches (A and B) take what the read ports bring; the results come back in on the write port
      const cols = b.grid?.cols ?? 1, rows = b.grid?.rows ?? 0, ins = cellInset(b), c0 = cells[0], cz = cells[cells.length - 1];
      cells.forEach((r, k) => rect(r.x, r.y, r.w, r.h, Math.floor(k / cols) % 2 ? soft : solid));
      for (let k = 0; k < rows; k++) { const rc = cells[k * cols]; if (rc && rc.h >= 7) put(`v${k}`, rc.x + 9, rc.y + rc.h / 2, Math.min(7, rc.h * 0.8)); }
      if (c0 && cz) {
        const top = c0.y, bot = cz.y + cz.h;
        if (ins.l) {
          const dw = ins.l - 5;
          rect(x, top, dw, bot - top, soft); outline(x, top, dw, bot - top);
          for (let k = 0; k < rows; k++) { const rc = cells[k * cols]!, my = rc.y + rc.h / 2; stub(x + dw, my, rc.x, my); g.circle(x + dw - 3, my, 1.4).fill({ color: line }); }
          stub(x - 7, (top + bot) / 2, x, (top + bot) / 2);
        }
        if (ins.b) {
          const ly = bot + 5;
          for (let k = 0; k < cols; k++) {
            const cc = cells[k]!;
            stub(cc.x + cc.w / 2, bot, cc.x + cc.w / 2, ly);
            rect(cc.x + 1, ly, cc.w - 2, 7, solid); rect(cc.x + 1, ly + 10, cc.w - 2, 7, soft);
          }
          lab('A', x + 3, ly + 3.5, 6); lab('B', x + 3, ly + 13.5, 6);
        }
      }
      if (!ins.l) { stub(x - 6, y + h * 0.3, x, y + h * 0.3); stub(x - 6, y + h * 0.7, x, y + h * 0.7); }
      stub(x + w, y + h / 2, x + w + 6, y + h / 2);
      break;
    }
    case 'lanes': {
      // an ALU in every lane: the notched trapezoid, its lane number and the operation it is given; a roomy cell opens up: the operands run down a bus that
      // taps every unit (add, logic, shift, compare, multiply, min/max), the units' results meet in a mux the op field selects, and the latch holds the result
      cells.forEach((r, k) => {
        poly(aluPoly(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3));
        const u = laneUnits(r);
        if (u) {
          const top = u.units[0]!, bot = u.units[u.units.length - 1]!, mid = u.notch.y;
          stub(u.notch.x, mid, u.busX, mid); if (r.h >= 60) put('a b', u.notch.x + 9, mid - 6, 5.5);
          stub(u.busX, top.y + top.h / 2, u.busX, bot.y + bot.h / 2);
          u.units.forEach((ur, n) => {
            const uy = ur.y + ur.h / 2;
            dot(u.busX, uy); stub(u.busX, uy, ur.x, uy);
            rect(ur.x, ur.y, ur.w, ur.h, n % 2 ? soft : solid); if (ur.h >= 6) put(ALU_UNITS[n]!, ur.x + ur.w / 2, uy, Math.min(6.5, ur.h * 0.7));
          });
          mux(u.mux.x, u.mux.y, u.mux.w, u.mux.h, ALU_UNITS.map(() => ''));
          const rx = u.mux.x + u.mux.w + 7, ry = u.res.y + u.res.h / 2;
          stub(rx, u.mux.y + u.mux.h / 2, u.res.x, u.mux.y + u.mux.h / 2);
          rect(u.res.x, u.res.y, u.res.w, u.res.h, solid); put('res', u.res.x + u.res.w / 2, ry, 6);
          put('op', u.mux.x + u.mux.w / 2, r.y + r.h * 0.09, 5.5); stub(u.mux.x + u.mux.w / 2, r.y + r.h * 0.125, u.mux.x + u.mux.w / 2, u.mux.y + u.mux.h * 0.11);
          put(r.h >= 70 ? `lane ${k}` : `l${k}`, r.x + (r.h >= 70 ? 22 : 12), r.y + r.h * 0.92, 5.5);
        } else if (r.h >= 22 && r.w >= 34) { put('op', r.x + r.w * 0.55, r.y + r.h * 0.5, 6.5); put(`l${k}`, r.x + 12, r.y + r.h - 6, 5.5); }
      });
      break;
    }
    case 'mask': {
      // a bit per lane, and the stack of masks a divergent branch pushes
      const m = maskParts(b.rect, b.grid?.cols ?? 8);
      m.bits.forEach((r, k) => rect(r.x, r.y, r.w, r.h, k % 2 ? soft : solid));
      m.slots.forEach((r) => { g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1.2, color: line }); });
      // beside the stack: push/pop, which saves the mask on a divergent branch and takes it back (its wire runs up into the strip), and with more room the
      // compare of the `mset` ops, whose result becomes the new mask
      const sEnd = m.stack.x + m.stack.w, room = x + w - sEnd - 16, sy = m.stack.y, sh = m.stack.h, up = (px: number) => { stub(px, sy - 1, px, m.strip.y + m.strip.h); dot(px, m.strip.y + m.strip.h); };
      if (room >= 60 && sh >= 8 && sy - (m.strip.y + m.strip.h) >= 4) {
        const uw = Math.min(64, room * (room >= 150 ? 0.4 : 0.8)), ux = sEnd + 14;
        stub(sEnd, sy + sh / 2, ux, sy + sh / 2);
        rect(ux, sy - 1, uw, sh + 2, soft); outline(ux, sy - 1, uw, sh + 2); put('push · pop', ux + uw / 2, sy + sh / 2, 6);
        up(ux + uw / 2);
        if (room >= 150) {
          const cx2 = ux + uw + 22, cw = Math.min(64, x + w - cx2 - 4);
          rect(cx2, sy - 1, cw, sh + 2, soft); outline(cx2, sy - 1, cw, sh + 2); put('mset cmp', cx2 + cw / 2, sy + sh / 2, 6);
          up(cx2 + cw / 2);
        }
      }
      break;
    }
    case 'coalescer': {
      // every lane's address is shifted down to the number of the line it falls in; lanes of one line merge onto that line's buffer (here two lanes to a line, eight
      // lanes to four lines, the way a unit-stride load lands), and the lines go out on one bus to the bank arbiter
      const n = 8, outs = 4, foot = h >= 150 ? 30 : 0, bodyH = h - foot, pl = bodyH / n, po = bodyH / outs, rq = Math.min(10, pl - 2);
      const sx = x + 26, sw = 18, mx = x + w * 0.46, bx = x + w * 0.6, bw = x + w - 14 - bx, busX = x + w - 6, bh = Math.min(28, po * 0.62), cw = (bw - 2) / 4;
      for (let k = 0; k < n; k++) {
        const ly = y + (k + 0.5) * pl, oy = y + (Math.floor(k / 2) + 0.5) * po;
        rect(x, ly - rq / 2, 16, rq, k % 2 ? soft : solid); if (pl >= 11) put(`l${k}`, x + 8, ly, 5.5);
        stub(x + 16, ly, sx, ly);
        rect(sx, ly - rq / 2, sw, rq, soft); if (pl >= 11) put('>>', sx + sw / 2, ly, 6);
        wire(sx + sw, ly, mx, ly, mx + 8, oy, bx, oy);
      }
      for (let k = 0; k < outs; k++) {
        const oy = y + (k + 0.5) * po;
        dot(mx + 8, oy);
        rect(bx, oy - bh / 2, bw, bh, soft); outline(bx, oy - bh / 2, bw, bh);
        for (let j = 0; j < 4; j++) rect(bx + 1 + j * cw + 1, oy - bh / 2 + 2, cw - 2, bh - 4, j < 2 || k % 2 ? solid : soft);
        if (bh >= 14) put(`line ${k}`, bx + bw / 2, oy - bh / 2 - 4, 5.5);
        stub(bx + bw, oy, busX, oy);
      }
      stub(busX, y + 0.5 * po, busX, y + (outs - 0.5) * po);
      if (foot) {
        // the counter of distinct lines the access touched: one cycle of the memory path per line
        const fy = y + h - foot + 8, cwid = Math.min(18, (w - 60) / 4);
        lab('lines', x, fy + 5, 6);
        for (let k = 0; k < 4; k++) rect(x + 34 + k * (cwid + 3), fy, cwid, 10, k < 2 ? solid : soft);
        stub(x + 34 + 4 * (cwid + 3) - 3, fy + 5, busX, fy + 5); dot(busX, fy + 5); stub(busX, y + (outs - 0.5) * po, busX, fy + 5);
      }
      break;
    }
    case 'arbiter': {
      const nb = Math.max(1, Number(/^(\d+)/.exec(b.sub ?? '')?.[1] ?? b.grid?.count ?? 1));
      if (b.grid) {
        // each bank's request queue is one row (the live layer fills it, a slot per access)
        cells.forEach((r, k) => {
          lab(`b${k}`, r.x + 3, r.y + 7, 6);
          const len = r.w - 4, seg = len / 8;
          for (let j = 0; j < 8; j++) g.rect(r.x + 2 + j * seg + 1, r.y + 1 + Math.min(10, r.h * 0.3), seg - 2, r.h - 2 - Math.min(10, r.h * 0.3)).stroke({ width: 0.8, color: line, alpha: 0.55 });
        });
        break;
      }
      // the lanes' requests come in on a column of request cells, merge onto a bus and queue at the bank they address; a picker takes the oldest of each
      // queue and a comparator spots two lanes on one bank
      const foot = h > 130 ? 44 : 0, region = h - foot - 4, few = nb <= 2, pitch = Math.min(few ? 120 : 56, region / nb), busX = x + 20, sh = Math.min(few ? 34 : 14, pitch - 14), qx = x + 30;
      const sw = Math.max(5, (w * 0.5 - 30) / 4), n = 8, rq = Math.min(14, region / n - 3);
      for (let k = 0; k < n; k++) {
        const ry = y + 4 + ((k + 0.5) * region) / n;
        rect(x + 2, ry - rq / 2, 10, rq, k % 3 === 0 ? solid : soft); stub(x + 12, ry, busX, ry);
        if (rq >= 8) put(`${k}`, x + 7, ry, 5);
      }
      stub(busX, y + 4 + 0.5 * region / n, busX, y + 4 + (n - 0.5) * region / n);
      for (let k = 0; k < nb; k++) {
        const ry = y + 4 + k * pitch + pitch / 2 + (region - nb * pitch) / 2;
        lab(`b${k}`, qx, ry - sh / 2 - 5, 6);
        stub(busX, ry, qx, ry); dot(busX, ry);
        for (let j = 0; j < 4; j++) {
          rect(qx + j * (sw + 1), ry - sh / 2, sw, sh, j === 0 ? solid : soft);
          if (sh >= 18 && sw >= 14) { put(`l${j}`, qx + j * (sw + 1) + sw / 2, ry - 4, 5.5); rect(qx + j * (sw + 1) + 2, ry + sh / 2 - 8, (sw - 4) * (1 - j * 0.22), 3, line); }
        }
        if (sh >= 18) lab('oldest', qx, ry + sh / 2 + 7, 5.5);
        const px = qx + 4 * (sw + 1) + 7;
        stub(qx + 4 * (sw + 1), ry, px - 5, ry);
        g.circle(px, ry, 5).fill({ color: soft }).stroke({ width: 1.2, color: line });
        stub(px + 5, ry, x + w, ry);
      }
      if (foot) {
        const cy = y + 4 + region + foot / 2 - 4, cx = x + w * 0.4;
        stub(busX, y + 4 + (n - 0.5) * region / n, busX, cy); stub(busX, cy, cx - 8, cy); dot(busX, cy);
        g.circle(cx, cy, 8).fill({ color: soft }).stroke({ width: 1.3, color: line }); put('=?', cx, cy, 7);
        stub(cx + 8, cy, x + w * 0.58, cy);
        rect(x + w * 0.58, cy - 6, x + w - (x + w * 0.58), 12, soft); put('serialise', x + w * 0.58 + (x + w - (x + w * 0.58)) / 2, cy, 6);
      }
      break;
    }
    case 'banks': {
      // an SRAM array per bank: a row decoder on top, rows of words, the sense amplifiers underneath
      cells.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, soft);
        const horizontal = r.w >= r.h, head = horizontal ? 0 : Math.min(9, r.h * 0.08), foot = horizontal ? 0 : Math.min(8, r.h * 0.07);
        if (head >= 5) { rect(r.x + 1.5, r.y + 1.5, r.w - 3, head - 2, solid); put(`b${k}`, r.x + r.w / 2, r.y + head / 2 + 0.5, Math.min(6, head - 1.5)); }
        if (foot >= 4) for (let j = 0; j < 4; j++) rect(r.x + 1.5 + (j * (r.w - 3)) / 4, r.y + r.h - foot - 0.5, (r.w - 3) / 4 - 1, foot - 1, solid);
        if (foot >= 6 && r.w >= 70) put('sense amps', r.x + r.w / 2, r.y + r.h - foot / 2 - 1, 5.5);
        const by = r.y + head, bh = r.h - head - foot, n = Math.max(1, Math.floor(bh / 6));
        if (horizontal) { const m = Math.max(1, Math.floor(r.w / 6)); for (let j = 1; j < m; j++) stub(r.x + (j * r.w) / m, r.y + 1.5, r.x + (j * r.w) / m, r.y + r.h - 1.5); }
        else {
          // a tall array: the row decoder down its left side raises one word line, the others run across to the right
          const dec = r.h >= 90 && r.w >= 60 ? 10 : 0;
          if (dec) { rect(r.x + 1.5, by + 1, dec - 2, bh - 2, solid); outline(r.x + 1.5, by + 1, dec - 2, bh - 2); put('dec', r.x + 1.5 + (dec - 2) / 2, by + 8, 5); }
          for (let j = 1; j < n; j++) stub(r.x + 1.5 + dec, by + (j * bh) / n, r.x + r.w - 1.5, by + (j * bh) / n);
          // and the bit lines down the columns, where the sense amplifiers read them
          const bl = Math.max(2, Math.floor((r.w - dec) / 14));
          if (bh > 40) for (let j = 1; j < bl; j++) { const bx = r.x + 1.5 + dec + (j * (r.w - 3 - dec)) / bl; g.moveTo(bx, by + 2).lineTo(bx, by + bh - 2); }
          g.stroke({ width: 0.8, color: line, alpha: 0.28 });
        }
      });
      break;
    }
    case 'l1':
    case 'l2': {
      // a line is its valid bit and tag beside its data; the index part of the address runs into a decoder that picks the line, the tag part is compared with the line's tag,
      // and a match (a hit) lets the line's data through
      const ins = cellInset(b), cols = b.grid?.cols ?? 1, c0 = cells[0], cz = cells[cells.length - 1];
      for (const r of cells) {
        rect(r.x, r.y, r.w * 0.3, r.h, solid); rect(r.x + r.w * 0.3 + 1, r.y, r.w * 0.7 - 1, r.h, soft);
        if (r.h >= 6 && r.w >= 12) g.circle(r.x + 2.5, r.y + r.h / 2, 1).fill({ color: line });
        // the words of the line, along the longer side of its data
        const dx = r.x + r.w * 0.3 + 1, dw = r.w * 0.7 - 1;
        if (Math.max(dw, r.h) >= 24) for (let j = 1; j < 4; j++) { if (dw >= r.h) stub(dx + (j * dw) / 4, r.y + 1, dx + (j * dw) / 4, r.y + r.h - 1); else stub(dx + 1, r.y + (j * r.h) / 4, dx + dw - 1, r.y + (j * r.h) / 4); }
      }
      if (c0 && cz) {
        const top = c0.y, bot = cz.y + cz.h;
        if (ins.l) {
          const dw = ins.l - 4;
          rect(x, top, dw, bot - top, soft); outline(x, top, dw, bot - top);
          for (let k = 0; k * cols < cells.length; k++) { const rc = cells[k * cols]!, my = rc.y + rc.h / 2; stub(x + dw, my, rc.x, my); }
          stub(x - 6, (top + bot) / 2, x, (top + bot) / 2);
        }
        if (ins.b) {
          const fy = bot + 5, fh = ins.b - 8, cy = fy + fh / 2, wide = w >= 200, cx = x + ins.l + (wide ? 70 : 38), r = 7;
          lab('tag', x + ins.l, cy, 6); stub(x + ins.l + 15, cy, cx - r, cy);
          g.circle(cx, cy, r).fill({ color: soft }).stroke({ width: 1.3, color: line }); put('=?', cx, cy, 6);
          stub(cx + r, cy, cx + r + 8, cy);
          rect(cx + r + 8, cy - 6, 26, 12, soft); outline(cx + r + 8, cy - 6, 26, 12); put('hit', cx + r + 21, cy, 6);
          if (wide) {
            const mx = x + w * 0.66, mw = 16, mh = fh;
            stub(cx + r + 34, cy, mx - 7, cy);
            mux(mx, cy - mh / 2, mw, mh, ['']);
            lab('data', mx + mw + 10, cy, 6);
          }
        }
      }
      break;
    }
    case 'dram': {
      // the card's memory: rows of words (with the map of what lives where), the row buffer under them and the controller
      const { foot, cw, cols, rows, by, slots } = dramGeom(a);
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) g.rect(x + k * cw + 1, y + r * cw + 1, cw - 2, cw - 2);
      g.fill({ color: soft });
      // the map of the memory: the kernel code, its two parameter words, the picture the card draws (docs/GPU.md section 2), as bands over the rows
      if (b.bytes && rows >= 4) {
        const total = cols * rows, cell = (a0: number) => Math.min(total, Math.max(0, Math.round((a0 / b.bytes!) * total)));
        const bands: { from: number; to: number; name: string; fill: string }[] = [
          { from: 0, to: KERNEL_LAYOUT.param, name: 'code', fill: solid }, { from: KERNEL_LAYOUT.param, to: GPU_FRAME.at, name: 'args', fill: line }, { from: GPU_FRAME.at, to: GPU_FRAME.at + GPU_FRAME.words * 4, name: 'frame', fill: mix(T.die, T.st, 0.7) },
        ];
        for (const bd of bands) {
          const a0 = cell(bd.from), z = Math.max(a0 + 1, cell(bd.to));
          for (let k = a0; k < Math.min(z, total); k++) g.rect(x + (k % cols) * cw + 1, y + Math.floor(k / cols) * cw + 1, cw - 2, cw - 2).fill({ color: bd.fill, alpha: 0.3 });
          const r0 = Math.floor(a0 / cols);
          if (cols * cw > 90 && r0 < rows - 1) put(bd.name, x + (a0 % cols) * cw + 18, y + r0 * cw + cw / 2 + 0.5, 7);
        }
      }
      if (foot) {
        // the row buffer: the words of the row the last access opened, in slots the live layer fills
        const mx = x + cols * cw / 2, bw = cols * cw * 0.4, cy = by + 22 + 12;
        for (const r of slots) { rect(r.x, r.y, r.w, r.h, solid); outline(r.x, r.y, r.w, r.h); }
        lab('row buffer', x + 2, by + 22 + 12, 6);
        stub(mx, by + 22, mx, cy - 6);
        rect(mx - bw / 2, cy - 6, bw, 12, soft); outline(mx - bw / 2, cy - 6, bw, 12); put('ctrl', mx, cy, 6.5);
        stub(x, cy, mx - bw / 2, cy); stub(mx + bw / 2, cy, x + cols * cw, cy);
      }
      break;
    }
    case 'sm':
      break;
  }
}
