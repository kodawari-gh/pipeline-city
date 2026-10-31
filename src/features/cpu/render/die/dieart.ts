import { Container, Graphics } from 'pixi.js';
import { dashed, label, mix } from '@/core/render/ink';
import type { Block, BlockKind, CpuPlan, Grid, Link, LinkKind, Pt, Rect } from '../core/cpuplan';
import type { Theme } from '@/core/render/theme';
import type { CpuSpec } from '@/features/board/sim/specs';
import { planInput } from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { glyph, glyphArea, type Put } from './blockart';
import { hasSymbol, isTall } from './glyphgeom';
export { isTall };

// The static art of a CPU die, drawn from a `CpuPlan` (docs/DIE.md): macro blocks with rim lines, dense cell arrays, trace bundles
// ending in solder pads, bond pads on the edge. Two parts so the far view stays cheap:
//   `dieFar`  blocks, stage frames and bond pads, baked with the device (the part of the die seen from far out);
//   `dieNear` traces, cell arrays, names (a `DieArt`), shown by zoom in the die view (dieview.ts).

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with). */
export const KIND_COLOR: Record<BlockKind, Key> = {
  power: 'ld', thermal: 'br', mc: 'ld', pcie: 'alu', clock: 'mute', usb: 'st', display: 'st', intc: 'br', timer: 'ld', mpu: 'mul', fabric: 'ld',
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

/** What the art needs of a block and a link, so a CPU die and a GPU card are drawn by the same code (`planFar`, `planNear`). */
export interface PlanBlock { id: string; kind: string; label: string; sub?: string; rect: Rect; grid?: Grid }
export interface PlanLink { id: string; kind: string; pts: Pt[]; lanes: number }

/** The cell rectangles of a block's grid (die coordinates, in entry order, row by row), under the block's name (beside it for a tall block). */
export function cellRects(b: PlanBlock): Rect[] {
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
export function laneLines(l: Pick<PlanLink, 'pts' | 'lanes'>): Pt[][] {
  const out: Pt[][] = [];
  for (let k = 0; k < l.lanes; k++) out.push(offsetPts(l.pts, (k - (l.lanes - 1) / 2) * LANE_GAP));
  return out;
}

const tint = (T: Theme, c: string, t: number) => mix(T.die, c, t);

/** How a kind of plan is drawn: its colours, which blocks are frames, which show a symbol instead of cells (the CPU die and the GPU card each give theirs). */
export interface PlanStyle<B extends PlanBlock, L extends PlanLink> {
  color(T: Theme, b: B): string;
  linkColor(T: Theme, l: L): string;
  /** Links drawn dashed (an event, not a stream). */
  dashed?(l: L): boolean;
  /** A frame (a pipeline stage, an SM): drawn behind its children, with a title. */
  frame(b: B): boolean;
  /** The area of the block's symbol, or null when it shows cells. */
  symbol(b: B): Rect | null;
  draw(g: Graphics, T: Theme, b: B, a: Rect, c: string, put: Put): void;
  cells(b: B): Rect[];
}

/** The frames, then the blocks over them, each tinted in its colour with a rim line: the part of the far view the CPU die and the GPU card share. */
export function planFar<B extends PlanBlock, L extends PlanLink>(g: Graphics, T: Theme, blocks: readonly B[], style: PlanStyle<B, L>): void {
  for (const b of blocks) {
    if (!style.frame(b)) continue;
    const r = b.rect;
    g.roundRect(r.x, r.y, r.w, r.h, 5).fill({ color: mix(T.die, T.ink, 0.08) }).stroke({ width: 1.2, color: T.line });
  }
  for (const b of blocks) {
    if (style.frame(b)) continue;
    const r = b.rect, c = style.color(T, b);
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

/** Traces, cell arrays, symbols and names of a plan, drawn by `style`. */
export function planNear<B extends PlanBlock, L extends PlanLink>(T: Theme, plan: { blocks: readonly B[]; links: readonly L[] }, style: PlanStyle<B, L>): DieArt {
  const root = new Container(), wires = new Container(), cells = new Container(), names = new Container(), subs = new Container();
  root.addChild(wires, cells, names, subs);
  const wg = new Graphics();
  wires.addChild(wg);
  for (const l of plan.links) {
    const c = style.linkColor(T, l);
    for (const line of laneLines(l)) {
      if (style.dashed?.(l)) dashed(wg, line, 7, 4); else { wg.moveTo(line[0]![0], line[0]![1]); for (let i = 1; i < line.length; i++) wg.lineTo(line[i]![0], line[i]![1]); }
      wg.stroke({ width: 1.3, color: c, alpha: 0.85, join: 'round' });
    }
  }
  for (const l of plan.links) {
    const c = style.linkColor(T, l);
    for (const p of [l.pts[0]!, l.pts[l.pts.length - 1]!]) wg.rect(p[0] - 2.5, p[1] - 2.5, 5, 5).fill({ color: c });
  }
  const cg = new Graphics();
  cells.addChild(cg);
  for (const b of plan.blocks) {
    const c = style.color(T, b);
    const ga = style.symbol(b);
    if (ga) style.draw(cg, T, b, ga, c, (t, x, y, size) => subs.addChild(label(t, x, y, size, T.ink, { anchor: [0.5, 0.5], a: 0.85 })));
    else {
      for (const r of style.cells(b)) cg.roundRect(r.x, r.y, r.w, r.h, 1.5);
      if (b.grid) cg.fill({ color: mix(T.die, c, 0.38) });
    }
    if (style.frame(b)) {
      names.addChild(label(b.label, b.rect.x + 8, b.rect.y + 12, 11, T.mute, { weight: '600', a: 0.9 }));
      if (b.sub) names.addChild(label(b.sub, b.rect.x + 8 + b.label.length * 8 + 10, b.rect.y + 12, 9, T.mute, { a: 0.8 }));
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

/** How the CPU die is drawn. */
export const CPU_STYLE: PlanStyle<Block, Link> = {
  color: (T, b) => T[KIND_COLOR[b.kind]],
  linkColor: (T, l) => T[LINK_COLOR[l.kind]],
  dashed: (l) => EVENT_LINK.has(l.kind),
  frame: (b) => b.kind === 'stage',
  symbol: (b) => (hasSymbol(b) ? glyphArea(b) : null),
  draw: glyph,
  cells: cellRects,
};

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
  planFar(g, T, plan.blocks, CPU_STYLE);
}

/** Traces, cell arrays and names of a CPU plan. */
export const dieNear = (T: Theme, plan: CpuPlan): DieArt => planNear(T, plan, CPU_STYLE);

/** The floorplan of a CPU spec (cached by its input). */
export const planOf = (spec: CpuSpec): CpuPlan => cpuPlan(planInput(spec.engine, { ...(spec.mmu ? { tlbEntries: spec.mmu.tlb } : {}), ...(spec.cores && spec.cores > 1 ? { cores: spec.cores } : {}) }));
