import { Container, Graphics } from 'pixi.js';
import { dashed, label, mix } from '../ink';
import type { Block, BlockKind, CpuPlan, Link, LinkKind, Pt, Rect } from './cpuplan';
import type { Theme } from '../theme';
import type { CpuSpec } from '../../sim/board/specs';
import { planInput } from './cpuplan';
import { cpuPlan } from './cpuplans';
import { glyph, glyphArea } from './blockart';
import { hasSymbol, isTall } from './glyphgeom';
export { isTall };

// The static art of a CPU die, drawn from a `CpuPlan` (docs/DIE.md): macro blocks with rim lines, dense cell arrays, trace bundles
// ending in solder pads, bond pads on the edge. Two parts so the far view stays cheap:
//   `dieFar`  blocks, stage frames and bond pads, baked with the device (the part of the die seen from far out);
//   `dieNear` traces, cell arrays, names (a `DieArt`), shown by zoom in the die view (dieview.ts).

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with). */
export const KIND_COLOR: Record<BlockKind, Key> = {
  power: 'ld', thermal: 'br', mc: 'ld', pcie: 'alu', clock: 'mute', usb: 'st', display: 'st', intc: 'br', fabric: 'ld',
  stage: 'mute', latch: 'mute',
  pc: 'alu', pcadd: 'alu', nextpc: 'alu', fetch: 'alu', port: 'ld', icache: 'ld', predictor: 'br', queue: 'alu',
  imm: 'alu', decode: 'alu', bundle: 'mul', hazard: 'br', control: 'br',
  regfile: 'st', alu: 'alu', mul: 'mul', branch: 'br', forward: 'st', mmio: 'ld', lsu: 'ld', wb: 'alu',
  dcache: 'ld', l2: 'ld', tlb: 'st', rename: 'alu', rob: 'mul', sched: 'mul', resultbus: 'mul', ring: 'mul',
};
export const LINK_COLOR: Record<LinkKind, Key> = { data: 'alu', control: 'mute', flush: 'bad', forward: 'st', wakeup: 'mul', irq: 'br', mem: 'ld', mmio: 'ld', power: 'ld' };
/** Links drawn dashed: they carry an event, not a stream. */
export const EVENT_LINK: ReadonlySet<LinkKind> = new Set<LinkKind>(['flush', 'forward', 'wakeup', 'irq']);
/** The die side each board-facing block's bond pads sit on. */
const PAD_SIDE: Partial<Record<BlockKind, 'N' | 'S' | 'E' | 'W'>> = { power: 'N', thermal: 'N', mc: 'E', pcie: 'S', clock: 'S', usb: 'W', display: 'W' };

export const colorOf = (T: Theme, k: Key): string => T[k];

/** The cell rectangles of a block's grid (die coordinates, in entry order, row by row), under the block's name (beside it for a tall block). */
export function cellRects(b: Block): Rect[] {
  const g = b.grid;
  if (!g) return [];
  const r = b.rect;
  const tall = isTall(b);
  const head = tall ? 8 : r.h >= 70 ? 44 : r.h * 0.55;
  const gx = r.x + (tall ? 22 : 8), gy = r.y + head, gw = r.w - (tall ? 30 : 16), gh = r.y + r.h - 6 - gy;
  if (gw <= 8 || gh <= 6) return [];
  const cw = gw / g.cols, ch = gh / g.rows;
  const out: Rect[] = [];
  for (let k = 0; k < g.count; k++) {
    out.push({ x: gx + (k % g.cols) * cw + 1, y: gy + Math.floor(k / g.cols) * ch + 1, w: Math.max(1.5, cw - 2), h: Math.max(1.5, ch - 2) });
  }
  return out;
}

/** An orthogonal polyline moved sideways by `o` (a miter at every corner). */
export function offsetPts(pts: Pt[], o: number): Pt[] {
  if (o === 0) return pts;
  const seg: Pt[] = [];
  for (let i = 1; i < pts.length; i++) seg.push([-Math.sign(pts[i]![1] - pts[i - 1]![1]), Math.sign(pts[i]![0] - pts[i - 1]![0])]);
  return pts.map((p, i) => {
    const a = i > 0 ? seg[i - 1]! : null, b = i < seg.length ? seg[i]! : null;
    let x = p[0], y = p[1];
    if (a) { x += a[0] * o; y += a[1] * o; }
    if (b && !a) { x += b[0] * o; y += b[1] * o; }
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) { x += b[0] * o; y += b[1] * o; }
    return [x, y];
  });
}

/** Spacing of the traces of a bundle. */
export const LANE_GAP = 3.2;

/** The traces of a link: one polyline per lane. */
export function laneLines(l: Link): Pt[][] {
  const out: Pt[][] = [];
  for (let k = 0; k < l.lanes; k++) out.push(offsetPts(l.pts, (k - (l.lanes - 1) / 2) * LANE_GAP));
  return out;
}

const tint = (T: Theme, c: string, t: number) => mix(T.die, c, t);

/** Blocks, stage frames and bond pads: the far view of the die. */
export function dieFar(g: Graphics, T: Theme, plan: CpuPlan): void {
  const D = plan.die;
  for (const b of plan.blocks.filter((x) => x.zone === 'edge' && PAD_SIDE[x.kind])) {
    const side = PAD_SIDE[b.kind]!, r = b.rect, c = T[KIND_COLOR[b.kind]];
    const n = side === 'N' || side === 'S' ? Math.floor((r.w - 20) / 12) : Math.floor((r.h - 20) / 12);
    for (let k = 0; k < n; k++) {
      const x = side === 'N' || side === 'S' ? r.x + 10 + k * 12 : side === 'W' ? D.x + 9 : D.x + D.w - 15;
      const y = side === 'W' || side === 'E' ? r.y + 10 + k * 12 : side === 'N' ? D.y + 9 : D.y + D.h - 15;
      g.rect(x, y, 6, 6);
    }
    g.fill({ color: c, alpha: 0.8 });
  }
  for (const b of plan.blocks) {
    if (b.kind !== 'stage') continue;
    const r = b.rect;
    g.roundRect(r.x, r.y, r.w, r.h, 5).fill({ color: mix(T.die, T.ink, 0.08) }).stroke({ width: 1.2, color: T.line });
  }
  for (const b of plan.blocks) {
    if (b.kind === 'stage') continue;
    const r = b.rect, c = T[KIND_COLOR[b.kind]];
    g.roundRect(r.x, r.y, r.w, r.h, 3).fill({ color: tint(T, c, 0.1) }).stroke({ width: 1.6, color: c });
  }
}

export interface DieArt {
  root: Container;
  /** Trace bundles, solder pads (shown from about zoom 0.7). */
  wires: Container;
  /** Cell arrays (from about zoom 0.8). */
  cells: Container;
  /** Block names (they fade by their own size on screen). */
  names: Container;
  /** The second line of a block (from about zoom 1.2). */
  subs: Container;
}

/** Traces, cell arrays and names of a plan. */
export function dieNear(T: Theme, plan: CpuPlan): DieArt {
  const root = new Container(), wires = new Container(), cells = new Container(), names = new Container(), subs = new Container();
  root.addChild(wires, cells, names, subs);
  const wg = new Graphics();
  wires.addChild(wg);
  for (const l of plan.links) {
    const c = T[LINK_COLOR[l.kind]];
    for (const line of laneLines(l)) {
      if (EVENT_LINK.has(l.kind)) dashed(wg, line, 7, 4); else { wg.moveTo(line[0]![0], line[0]![1]); for (let i = 1; i < line.length; i++) wg.lineTo(line[i]![0], line[i]![1]); }
      wg.stroke({ width: 1.3, color: c, alpha: 0.85, join: 'round' });
    }
  }
  for (const l of plan.links) {
    const c = T[LINK_COLOR[l.kind]];
    for (const p of [l.pts[0]!, l.pts[l.pts.length - 1]!]) wg.rect(p[0] - 2.5, p[1] - 2.5, 5, 5).fill({ color: c });
  }
  const cg = new Graphics();
  cells.addChild(cg);
  for (const b of plan.blocks) {
    const c = T[KIND_COLOR[b.kind]];
    const ga = hasSymbol(b) ? glyphArea(b) : null;
    if (ga) glyph(cg, T, b, ga, c, (t, x, y, size) => subs.addChild(label(t, x, y, size, T.ink, { anchor: [0.5, 0.5], a: 0.85 })));
    else {
      for (const r of cellRects(b)) cg.roundRect(r.x, r.y, r.w, r.h, 1.5);
      if (b.grid) cg.fill({ color: mix(T.die, c, 0.38) });
    }
    if (b.kind === 'stage') {
      names.addChild(label(b.label, b.rect.x + 8, b.rect.y + 12, 11, T.mute, { weight: '600', a: 0.9 }));
      continue;
    }
    const r = b.rect;
    if (isTall(b)) {
      const t = label(b.label, b.grid ? r.x + 11 : b.kind === 'latch' ? r.x + r.w - 7 : r.x + r.w / 2 + 4, r.y + r.h / 2, Math.min(13, Math.max(8, r.w * 0.45)), T.ink, { weight: '700', anchor: [0.5, 0.5] });
      t.rotation = -Math.PI / 2;
      names.addChild(t);
      continue;
    }
    const fs = Math.max(8, Math.min(14, (r.w - 14) / (b.label.length * 0.66), r.h * 0.45));
    if (r.h >= 20 && r.w >= 40) names.addChild(label(b.label, r.x + 7, r.y + 6 + fs / 2, fs, T.ink, { weight: '700' }));
    if (b.sub && r.h >= 44 && r.w >= 100) subs.addChild(label(b.sub, r.x + 7, r.y + 9 + fs + 6, 9, T.mute, { a: 0.95 }));
  }
  return { root, wires, cells, names, subs };
}

/** The floorplan of a CPU spec (cached by its input). */
export const planOf = (spec: CpuSpec): CpuPlan => cpuPlan(planInput(spec.engine, { ...(spec.mmu ? { tlbEntries: spec.mmu.tlb } : {}), ...(spec.cores && spec.cores > 1 ? { cores: spec.cores } : {}) }));
