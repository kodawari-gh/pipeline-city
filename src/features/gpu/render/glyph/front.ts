import type { Rect } from '../../../cpu/render/core/cpuplan';
import { CONTROL_LINES, pcDigits } from '../../../cpu/render/die/blockart';
import { decodeGeom, fieldRects } from './decode';
import { fetchGeom, pcArea } from './geom';
import type { Pen } from './pen';

// The front end of an SM: the program counter and its next-pc logic, the fetch window and the decoder.

/** Where the next-pc logic sits beside the program counter's digits. */
interface NextPc {
  pa: Rect;
  cy: number;
  r: number;
  end: number;
  cx: number;
  mx: number;
  mw: number;
  mh: number;
  my: number;
  ox: number;
  loopY: number;
  ry: number;
  selX: number;
}

function nextPcGeom(pa: Rect): NextPc {
  const cy = pa.y + pa.h / 2,
    end = pa.x + pa.w,
    mx = end + 54,
    mw = 24,
    mh = 22,
    loopY = pa.y + pa.h + 9;
  return {
    pa,
    cy,
    r: 7,
    end,
    cx: end + 23,
    mx,
    mw,
    mh,
    my: cy - mh * 0.25,
    ox: mx + mw + 7,
    loopY,
    ry: loopY + 10,
    selX: mx + mw / 2,
  };
}

/** The loop back to the program counter, the wire on to the fetch, and the target adder: the pc and the immediate of the decoded word, its sum into the mux. */
function drawPcTarget(p: Pen, n: NextPc): void {
  const { rect, stub, soft, adder } = p.kit,
    { pa, cy, r, end, cx, mx, mh, my, ox, loopY, ry } = n;
  p.wire(ox, my + mh / 2, ox + 1, my + mh / 2, ox + 1, loopY, pa.x + 4, loopY, pa.x + 4, pa.y + pa.h);
  p.dot(ox + 1, loopY);
  p.wire(ox + 1, loopY, p.a.x + p.a.w - 6, loopY);
  p.lab('to fetch', [ox + 10, loopY - 5], 6);
  adder(cx, ry, r, ['', '']);
  p.wire(end + 9, cy, end + 9, ry - 0.55 * r);
  rect(end - 30, ry - 6, 24, 12, soft);
  p.outline({ x: end - 30, y: ry - 6, w: 24, h: 12 });
  p.put('imm', end - 18, ry, 6);
  stub(end - 6, ry + 0.55 * r, cx - r - 7, ry + 0.55 * r);
  p.wire(cx + r + 7, ry, end + 43, ry, end + 43, my + mh * 0.75, mx - 7, my + mh * 0.75);
  p.put('tgt', cx, ry + r + 5, 5.5);
}

/** The select: taken = bany and any lane active (jmp always takes it). */
function drawPcSelect(p: Pen, n: NextPc): void {
  const { stub, line } = p.kit,
    { mh, my, ry, selX } = n;
  p.gate([selX, ry], 6, { width: 1.2, color: line });
  p.put('&', selX, ry, 7);
  p.wire(selX, ry - 6, selX, my + mh * 0.89);
  stub(selX + 6, ry - 2.5, selX + 14, ry - 2.5);
  stub(selX + 6, ry + 2.5, selX + 14, ry + 2.5);
  p.lab('bany', [selX + 17, ry - 4], 6);
  p.lab('any lane', [selX + 17, ry + 5], 6);
}

/**
 * The program counter feeding its own next value: pc + 1 for the next word, or the branch target (pc + imm) when `jmp` or `bany` takes it, back in;
 * with room, the target adder with the immediate, and the gate that takes a `bany` only when a lane of the mask is still active.
 */
export function drawPc(p: Pen): void {
  const pa = pcArea(p.a);
  pcDigits(p.g, p.kit, pa);
  if (pa.w >= p.a.w - 1) {
    return;
  }
  const { stub, adder, mux } = p.kit,
    n = nextPcGeom(pa),
    { cy, r, end, cx, mx, mw, mh, my, ox } = n;
  stub(end, cy, end + 9, cy);
  adder(cx, cy, r, ['', '']);
  stub(end + 9, cy, cx - r - 7, cy);
  p.dot(end + 9, cy);
  stub(cx + r + 7, cy, mx - 7, cy);
  mux(mx, my, mw, mh, ['seq', 'tgt']);
  p.put('+1', cx, cy - r - 5, 5.5);
  if (p.a.h < 50) {
    stub(mx + mw, my + mh / 2, ox, my + mh / 2);
    return;
  }
  drawPcTarget(p, n);
  drawPcSelect(p, n);
}

/** The address of the fetched word: the kernel's base plus the pc, out to the card memory; the word comes back into the first row. */
function drawFetchSide(p: Pen, s: Rect, row: Rect): void {
  const { rect, stub, soft, solid, adder } = p.kit;
  const cy = s.y + s.h / 2,
    r = 7,
    cx = s.x + 52,
    rowEnd = row.x + row.w;
  p.lab('pc', [s.x + 6, cy - 0.55 * r], 6);
  stub(s.x + 20, cy - 0.55 * r, cx - r - 7, cy - 0.55 * r);
  rect(s.x, cy + 0.55 * r - 3.5, 30, 7, solid);
  p.put('base', s.x + 15, cy + 0.55 * r, 5);
  stub(s.x + 30, cy + 0.55 * r, cx - r - 7, cy + 0.55 * r);
  adder(cx, cy, r, ['', '']);
  stub(cx + r + 7, cy, s.x + 98, cy);
  rect(s.x + 98, s.y, 32, s.h, soft);
  p.outline({ x: s.x + 98, y: s.y, w: 32, h: s.h });
  p.put('addr', s.x + 114, cy, 6);
  stub(s.x + 130, cy, s.x + s.w, cy);
  p.lab('mem', [s.x + s.w - 20, cy - 6], 5.5);
  p.wire(
    s.x + s.w,
    row.y + row.h + 3,
    rowEnd + 4,
    row.y + row.h + 3,
    rowEnd + 4,
    row.y + row.h / 2,
    rowEnd,
    row.y + row.h / 2,
  );
}

/** A window of the kernel: the word being fetched on the first row, the ones behind it dimmed, each by its distance from the pc. */
export function drawFetch(p: Pen): void {
  const { x } = p.a,
    { rect, soft, word } = p.kit;
  const f = fetchGeom(p.a);
  for (const [k, r] of f.rows.entries()) {
    if (f.gutter) {
      p.lab(k ? `+${k}` : 'pc', [x, r.y + r.h / 2], 6.5);
    }
    if (k === 0) {
      word(r.x, r.y, r.w, r.h, r.h >= 9);
      continue;
    }
    for (const fr of fieldRects(r)) {
      rect(fr.x + 0.6, fr.y, fr.w - 1.2, fr.h, soft);
    }
  }
  const first = f.rows.at(0),
    last = f.rows.at(-1);
  if (!first || !last) {
    return;
  }
  if (f.gutter && f.rows.length > 1) {
    p.wire(x + f.gutter - 3, first.y + first.h / 2, x + f.gutter - 3, last.y + first.h / 2);
  }
  if (f.side) {
    drawFetchSide(p, f.side, first);
  }
}

/** The names of the decoder's units, under the fields of the word: the control unit, the register selects, the sign extender. */
const DECODE_UNITS = ['ctl', 'dst', 'srcA', 'srcB', 'sext'] as const;

/** The control lines in a row, each with its name when it has room for one; with a bus (at `busY`), each line hangs from it. */
function drawLines(p: Pen, lines: Rect[], busY?: number): void {
  const { rect, stub, soft } = p.kit;
  for (const [k, r] of lines.entries()) {
    if (busY !== undefined) {
      stub(r.x + r.w / 2, busY, r.x + r.w / 2, r.y);
    }
    rect(r.x, r.y, r.w, r.h, soft);
    if (r.w > 14 && (busY !== undefined || r.h >= 7)) {
      p.put(CONTROL_LINES[k] ?? '', r.x + r.w / 2, r.y + r.h / 2, 6);
    }
  }
}

/** The decoder: the word on top; the fields run down into their units (register selects, the sign extender, the control unit that fans the op out to its lines). */
export function drawDecode(p: Pen): void {
  const { rect, stub, soft, solid, word } = p.kit;
  const d = decodeGeom(p.a);
  word(d.word.x, d.word.y, d.word.w, d.word.h);
  if (!d.rich) {
    drawLines(p, d.lines);
    return;
  }
  for (const [k, r] of [d.ctl, ...d.sel, d.sext].entries()) {
    const fr = d.fields[k];
    if (fr) {
      const fx = fr.x + fr.w / 2;
      stub(fx, fr.y + fr.h, fx, r.y);
    }
    rect(r.x, r.y, r.w, r.h, k ? soft : solid);
    p.put(DECODE_UNITS[k] ?? '', r.x + r.w / 2, r.y + r.h / 2, 6);
  }
  const cx = d.ctl.x + d.ctl.w / 2,
    first = d.lines.at(0),
    last = d.lines.at(-1);
  if (!first || !last) {
    return;
  }
  stub(cx, d.ctl.y + d.ctl.h, cx, d.busY);
  stub(Math.min(cx, first.x + first.w / 2), d.busY, last.x + last.w / 2, d.busY);
  p.dot(cx, d.busY);
  drawLines(p, d.lines, d.busY);
}
