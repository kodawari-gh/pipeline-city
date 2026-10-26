// The floorplans of each CPU architecture (see cpuplan.ts for the data model and docs/DIE.md for the grammar).

import { Builder, U, cacheSub, gridFor, type Block, type BlockKind, type CpuPlan, type Link, type PlanInput, type Pt, type Rect } from './cpuplan';
import { DIE } from './layout';

// ---------------------------------------------------------------- shared pieces

const cy = (b: Block): number => Math.round(b.rect.y + 0.5 * b.rect.h);
const cx = (b: Block): number => Math.round(b.rect.x + 0.5 * b.rect.w);

/** Clock and interrupt controller (north-west corner). The clock is the cpu clock domain (and its throttling), the INTC the controller of docs/CPU.md. */
function corner(b: Builder): void {
  b.add('clk', 'clock', 'CLOCK', U.x0, U.y0, 118, 62, { sub: 'cpu domain' });
  b.add('intc', 'intc', 'INTC', U.x0, U.y0 + 70, 118, 62, { sub: 'interrupts' });
}

/** The bus interface unit: the east column, toward the package pins and the memory bus. */
function biu(b: Builder, w = 138): Block {
  return b.add('biu', 'biu', 'BUS INTERFACE', U.x1 - w, U.y0, w, U.y1 - U.y0, { sub: 'RAM · MMIO' });
}

const gridIn = (n: number, w: number, h: number, minCols = 1) => gridFor(n, w - 24, h - 56, minCols);

function dcache(b: Builder, x: number, y: number, w: number, h: number, lines: number, ways: number): Block {
  return b.add('dc', 'dcache', 'D-CACHE', x, y, w, h, { sub: cacheSub(lines, ways), grid: gridIn(lines, w, h, ways) });
}

function icache(b: Builder, x: number, y: number, w: number, h: number, lines: number): Block {
  return b.add('ic', 'icache', 'I-CACHE', x, y, w, h, { sub: cacheSub(lines, 1), grid: gridIn(lines, w, h) });
}

function l2(b: Builder, x: number, y: number, w: number, h: number, lines: number): Block {
  return b.add('l2', 'l2', 'L2 CACHE', x, y, w, h, { sub: `${lines} lines · shared`, grid: gridFor(lines, w - 24, h - 40) });
}

function regfile(b: Builder, x: number, y: number, w: number, h: number, sub: string): Block {
  return b.add('rf', 'regfile', 'REGISTER FILE', x, y, w, h, { sub, grid: gridIn(16, w, h) });
}

// ---------------------------------------------------------------- stage frames and their sub-blocks

interface Sub {
  id: string; kind: BlockKind; label: string; sub?: string; h: number;
  /** Shares the row with this one (half width each). */
  pair?: Sub;
  /** Takes the extra height of the frame (default: the last item). */
  fill?: boolean;
  lane?: number;
}

const PAD = 16, TOP = 36, GAP = 8, BOT = 12;

const need = (items: Sub[]): number => TOP + items.reduce((n, s) => n + s.h, 0) + GAP * (items.length - 1) + BOT;

/** Stack sub-blocks top to bottom inside a stage frame; the extra height goes to the `fill` item. */
function stack(b: Builder, f: Block, items: Sub[]): void {
  const extra = f.rect.h - need(items);
  const fillAt = Math.max(0, items.findIndex((s) => s.fill));
  const fi = items.some((s) => s.fill) ? fillAt : items.length - 1;
  let y = f.rect.y + TOP;
  const x = f.rect.x + PAD, w = f.rect.w - 2 * PAD;
  items.forEach((s, k) => {
    const h = s.h + (k === fi ? extra : 0);
    const put = (sub: Sub, sx: number, sw: number) => b.add(sub.id, sub.kind, sub.label, sx, y, sw, h, {
      parent: f.id, ...(sub.sub ? { sub: sub.sub } : {}), ...(sub.lane !== undefined ? { lane: sub.lane } : {}),
    });
    if (s.pair) {
      const hw = Math.floor((w - GAP) / 2);
      put(s, x, hw);
      put(s.pair, x + hw + GAP, hw);
    } else put(s, x, w);
    y += h + GAP;
  });
}

// ---------------------------------------------------------------- unpipelined and in-order pipelines

const LATCH = ['IF/ID', 'ID/EX', 'EX/MEM', 'MEM/WB'];
const STAGE_NAMES = ['IF · fetch', 'ID · decode', 'EX · execute', 'MEM · memory', 'WB · write back'];

export function pipeline(i: PlanInput): Builder {
  const b = new Builder();
  const un = i.arch === 'unpipelined', two = i.arch === 'inorder2', fwd = i.forwarding ?? true;
  const lines = i.cacheLines ?? 8, ways = i.ways ?? 1;
  const icLines = i.icacheLines ?? 0, l2Lines = i.l2Lines ?? 0;
  const predEntries = i.predEntries ?? 64, predBits = i.predBits ?? 1;
  corner(b);

  const ifItems: Sub[] = [
    { id: 'pc', kind: 'pc', label: 'PC', sub: 'program counter', h: 40 },
    { id: 'npc', kind: 'nextpc', label: 'NEXT PC', h: 38, pair: { id: 'pcadd', kind: 'pcadd', label: 'PC + 4', h: 38 } },
    { id: 'fetch', kind: 'fetch', label: two ? 'FETCH × 2' : 'FETCH', sub: icLines ? 'reads the I-cache' : 'reads RAM', h: 56, fill: true },
  ];
  const idItems: Sub[] = un
    ? [{ id: 'imm', kind: 'imm', label: 'IMMEDIATE', h: 40 }, { id: 'dec', kind: 'decode', label: 'DECODER', sub: 'opcode to control', h: 70, fill: true }]
    : two
      ? [
        { id: 'hz', kind: 'hazard', label: 'HAZARD', sub: fwd ? 'load-use stall' : 'waits for write back', h: 46 },
        { id: 'imm', kind: 'imm', label: 'IMMEDIATE', h: 36 },
        { id: 'bundle', kind: 'bundle', label: 'PAIR / ISSUE', sub: 'one bundle a cycle', h: 46 },
        { id: 'dec0', kind: 'decode', label: 'DECODE A', h: 54, lane: 0, fill: true, pair: { id: 'dec1', kind: 'decode', label: 'DECODE B', h: 54, lane: 1 } },
      ]
      : [
        { id: 'hz', kind: 'hazard', label: 'HAZARD', sub: fwd ? 'load-use stall' : 'waits for write back', h: 50 },
        { id: 'imm', kind: 'imm', label: 'IMMEDIATE', h: 38 },
        { id: 'dec', kind: 'decode', label: 'DECODER', sub: 'opcode to control', h: 70, fill: true },
      ];
  const exTop: Sub[] = [
    { id: 'br', kind: 'branch', label: 'BRANCH', sub: 'compare · target', h: 46 },
    ...(!un && fwd ? [{ id: 'fwd', kind: 'forward', label: 'FORWARD', sub: 'bypass A / B', h: 46 } as Sub] : []),
  ];
  const exItems: Sub[] = two
    ? [...exTop, { id: 'alu0', kind: 'alu', label: 'ALU A', sub: 'add · logic · shift · mul', h: 54, lane: 0 }, { id: 'alu1', kind: 'alu', label: 'ALU B', h: 54, lane: 1, fill: true }]
    : [...exTop, { id: 'alu', kind: 'alu', label: 'ALU', sub: 'add · logic · shift · mul', h: 70, fill: true }];
  const memItems: Sub[] = [
    { id: 'mmio', kind: 'mmio', label: 'DEVICE?', sub: 'skips the cache', h: 46 },
    { id: 'lsu', kind: 'lsu', label: 'LOAD / STORE', sub: 'address · align', h: 70, fill: true },
  ];
  const wbItems: Sub[] = [{ id: 'wb', kind: 'wb', label: 'WRITE BACK', sub: two ? 'two write ports' : 'result mux', h: 70, fill: true }];
  const lists = [ifItems, idItems, exItems, memItems, wbItems];

  // frames
  const y0 = -308;
  const H = Math.max(un ? 340 : 360, ...lists.map(need));
  const widths = un ? [200, 200, 200, 200, 150] : [210, 210, 210, 210, 160];
  const gap = un ? 36 : 46;
  const frames: Block[] = [];
  let x = U.x0;
  widths.forEach((w, k) => {
    frames.push(b.frame(['if', 'id', 'ex', 'mem', 'wbf'][k]!, STAGE_NAMES[k]!, k, x, y0, w, H));
    stack(b, frames[k]!, lists[k]!);
    if (!un && k < 4) b.add(`lat${k}`, 'latch', LATCH[k]!, x + w + 8, y0, 30, H);
    x += w + gap;
  });
  const bu = biu(b);
  const g = (id: string) => b.get(id);
  const FR = frames;

  // ---- south band: I-cache | register file | D-cache, and the L2 under them
  const sy = y0 + H + 48;
  const l2h = l2Lines > 0 ? 120 : 0;
  const bottom = U.y1 - (l2Lines > 0 ? l2h + 18 : 30);
  const rfX = FR[1]!.rect.x, rfW = FR[2]!.rect.x + FR[2]!.rect.w - rfX;
  regfile(b, rfX, sy, rfW, bottom - sy, two ? '4 read · 2 write' : '2 read · 1 write');
  const dcX = FR[3]!.rect.x, dcW = bu.rect.x - 40 - dcX;
  dcache(b, dcX, sy, dcW, bottom - sy, lines, ways);
  if (icLines > 0) icache(b, U.x0, sy, FR[1]!.rect.x - 40 - U.x0, bottom - sy, icLines);
  if (l2Lines > 0) l2(b, U.x0, U.y1 - l2h, bu.rect.x - 40 - U.x0, l2h, l2Lines);

  // ---- north band: the predictor (or, unpipelined, the sequencer)
  const nx = U.x0 + 134;
  if (un) {
    b.add('seq', 'control', 'SEQUENCER', nx, U.y0, bu.rect.x - 40 - nx, 104, { sub: 'one instruction at a time · five phases', grid: { cols: 5, rows: 1, count: 5 } });
  } else {
    b.add('bp', 'predictor', 'BRANCH PREDICTOR', nx, U.y0, FR[3]!.rect.x + 90 - nx, 104, {
      sub: `${predEntries} x ${predBits}-bit`, grid: gridFor(predEntries, FR[3]!.rect.x + 90 - nx - 24, 48),
    });
  }

  // ---- links
  const lane = { mmio: -386, fwdB: -373, fwdA: -360, flush: -347, bp: -334 };
  const feed = (id: string, latch: string, sub: string) => b.link(id, 'data', latch, 'E', sub, 'W', { ft: b.ty(latch, cy(g(sub))), tt: 0.5, width: 2 });
  const drain = (id: string, sub: string, latch: string) => b.link(id, 'data', sub, 'E', latch, 'W', { ft: 0.5, tt: b.ty(latch, cy(g(sub))), width: 2 });
  const direct = (id: string, a: string, c: string, label?: string) => b.link(id, 'data', a, 'E', c, 'W', { width: 2, ...(label ? { label } : {}) });

  // fetch group: PC -> +4 -> next PC -> PC, PC -> fetch address
  b.link('pc-add', 'data', 'pc', 'S', 'pcadd', 'N', { ft: 0.75, tt: 0.5, width: 1 });
  b.link('add-npc', 'data', 'pcadd', 'W', 'npc', 'E', { width: 1 });
  b.link('npc-pc', 'data', 'npc', 'N', 'pc', 'S', { ft: 0.5, tt: 0.2, width: 1 });
  b.link('pc-fetch', 'data', 'pc', 'S', 'fetch', 'N', { ft: 0.5, tt: 0.5, width: 1 });
  // interrupts: the controller forces the vector into the PC
  b.link('irq-pc', 'irq', 'intc', 'S', 'pc', 'W', { ft: 0.5, tt: 0.5, width: 1, via: [[FR[0]!.rect.x + 4, cy(g('pc'))]], label: 'IRQ vector' });

  if (un) {
    direct('fetch-dec', 'fetch', 'dec', 'instruction');
    direct('fetch-imm', 'fetch', 'imm');
    direct('dec-alu', 'dec', 'alu');
    direct('imm-alu', 'imm', 'alu');
    direct('alu-lsu', 'alu', 'lsu');
    direct('mmio-lsu', 'lsu', 'mmio');
    direct('lsu-wb', 'lsu', 'wb');
    b.link('br-pc', 'control', 'br', 'N', 'npc', 'W', { ft: 0.5, tt: 0.3, via: [[cx(g('br')), lane.flush], [FR[0]!.rect.x + 10, lane.flush]], width: 1, label: 'branch target' });
  } else {
    // pipeline registers carry the instruction from stage to stage
    drain('if-l0', 'fetch', 'lat0');
    b.link('pc-l0', 'data', 'pc', 'E', 'lat0', 'W', { ft: 0.5, tt: b.ty('lat0', cy(g('pc'))), width: 1 });
    feed('l0-hz', 'lat0', 'hz');
    feed('l0-imm', 'lat0', 'imm');
    if (two) {
      // both decoders sit side by side under the pairing logic; the whole stage reads the register and feeds the next one
      b.link('l0-id', 'data', 'lat0', 'E', 'id', 'W', { width: 2 });
      b.link('bundle-dec0', 'control', 'bundle', 'S', 'dec0', 'N', { width: 1 });
      b.link('bundle-dec1', 'control', 'bundle', 'S', 'dec1', 'N', { width: 1 });
      b.link('id-l1', 'data', 'id', 'E', 'lat1', 'W', { width: 2 });
    } else {
      feed('l0-dec', 'lat0', 'dec');
      drain('dec-l1', 'dec', 'lat1');
    }
    drain('imm-l1', 'imm', 'lat1');
    feed('l1-br', 'lat1', 'br');
    if (fwd) feed('l1-fwd', 'lat1', 'fwd');
    if (two) { feed('l1-alu0', 'lat1', 'alu0'); feed('l1-alu1', 'lat1', 'alu1'); drain('alu0-l2', 'alu0', 'lat2'); drain('alu1-l2', 'alu1', 'lat2'); } else { feed('l1-alu', 'lat1', 'alu'); drain('alu-l2', 'alu', 'lat2'); }
    feed('l2-lsu', 'lat2', 'lsu');
    feed('l2-mmio', 'lat2', 'mmio');
    drain('lsu-l3', 'lsu', 'lat3');
    feed('l3-wb', 'lat3', 'wb');
    // forwarding: the results of the two older instructions go straight back to the ALU inputs
    if (fwd) {
      // they come in along the stage's east margin and enter the forwarding mux from its east edge
      const ex = FR[2]!.rect, strip = ex.x + ex.w - 5;
      b.link('fwd-a', 'forward', 'lat2', 'N', 'fwd', 'E', { ft: 0.5, tt: 0.3, via: [[cx(g('lat2')), lane.fwdA], [strip, lane.fwdA], [strip, cy(g('fwd')) - 8]], width: 2, label: 'forward' });
      b.link('fwd-b', 'forward', 'lat3', 'N', 'fwd', 'E', { ft: 0.5, tt: 0.75, via: [[cx(g('lat3')), lane.fwdB], [strip - 7, lane.fwdB], [strip - 7, cy(g('fwd')) + 8]], width: 2 });
      b.link('fwd-alu', 'data', 'fwd', 'S', two ? 'alu0' : 'alu', 'N', { width: 2 });
    }
    // a taken branch: the next PC is redirected and the younger instructions are squashed; the predictor learns
    b.link('br-npc', 'flush', 'br', 'N', 'npc', 'W', { ft: 0.5, tt: 0.3, via: [[cx(g('br')), lane.flush], [FR[0]!.rect.x + 9, lane.flush]], width: 1, label: 'redirect · squash' });
    b.link('br-bp', 'control', 'br', 'N', 'bp', 'S', { ft: 0.85, tt: b.tx('bp', Math.round(g('br').rect.x + 0.85 * g('br').rect.w)), width: 1, label: 'learn' });
    b.link('bp-npc', 'control', 'bp', 'S', 'npc', 'W', { ft: 0.02, tt: 0.7, via: [[nx + 6, lane.bp], [FR[0]!.rect.x + 13, lane.bp]], width: 1, label: 'predicted target' });
  }

  // register file ports
  const decs = two ? ['dec0', 'dec1'] : ['dec'];
  decs.forEach((d, k) => {
    b.link(`${d}-rfa`, 'data', d, 'S', 'rf', 'N', { ft: 0.3, tt: 0.12 + 0.12 * k, width: 2, label: k === 0 ? 'read' : undefined });
    b.link(`${d}-rfb`, 'data', d, 'S', 'rf', 'N', { ft: 0.7, tt: 0.26 + 0.12 * k, width: 2 });
  });
  b.link('wb-rf', 'data', 'wbf', 'S', 'rf', 'N', { ft: 0.5, tt: 0.88, via: [[cx(g('wbf')), y0 + H + 24]], width: 2, label: 'write' });

  // memory: the cache for RAM addresses, the bus interface for devices, and the instruction side
  b.link('lsu-dc', 'data', 'lsu', 'S', 'dc', 'N', { ft: 0.5, tt: b.tx('dc', cx(g('lsu'))), both: true, width: 2 });
  b.link('mmio-biu', 'mmio', 'mmio', 'N', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', lane.mmio), via: [[cx(g('mmio')), lane.mmio]], width: 2, label: 'device access' });
  if (l2Lines > 0) {
    b.link('dc-l2', 'mem', 'dc', 'S', 'l2', 'N', { ft: 0.5, tt: b.tx('l2', cx(g('dc'))), both: true, width: 3 });
    if (icLines > 0) b.link('ic-l2', 'mem', 'ic', 'S', 'l2', 'N', { ft: 0.5, tt: b.tx('l2', cx(g('ic'))), both: true, width: 3 });
    b.link('l2-biu', 'mem', 'l2', 'E', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', cy(g('l2'))), both: true, width: 3 });
    if (icLines > 0) b.link('fetch-ic', 'data', 'fetch', 'S', 'ic', 'N', { ft: 0.5, tt: b.tx('ic', cx(g('fetch'))), both: true, width: 2 });
    else b.link('fetch-l2', 'mem', 'fetch', 'S', 'l2', 'N', { ft: 0.5, tt: b.tx('l2', cx(g('fetch'))), width: 3, label: 'instruction fetch' });
  } else {
    b.link('dc-biu', 'mem', 'dc', 'E', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', cy(g('dc'))), both: true, width: 3 });
    const yb = U.y1 - 14;
    if (icLines > 0) {
      b.link('fetch-ic', 'data', 'fetch', 'S', 'ic', 'N', { ft: 0.5, tt: b.tx('ic', cx(g('fetch'))), both: true, width: 2 });
      b.link('ic-biu', 'mem', 'ic', 'S', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', yb), via: [[cx(g('ic')), yb]], width: 3, label: 'instruction fetch' });
    } else {
      b.link('fetch-biu', 'mem', 'fetch', 'S', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', yb), via: [[cx(g('fetch')), yb]], width: 3, label: 'instruction fetch' });
    }
  }
  return b;
}

// ---------------------------------------------------------------- out of order

export function outOfOrder(i: PlanInput): Builder {
  const b = new Builder();
  const W = i.width ?? 2, rob = i.robSize ?? 8, sched = i.schedSize ?? 6, fq = i.fetchQueue ?? 4;
  const lines = i.cacheLines ?? 8, ways = i.ways ?? 1, icLines = i.icacheLines ?? 0, l2Lines = i.l2Lines ?? 0;
  const predEntries = i.predEntries ?? 64, predBits = i.predBits ?? 1;
  corner(b);
  const bu = biu(b);
  const decItems: Sub[] = [
    { id: 'imm', kind: 'imm', label: 'IMMEDIATE', h: 34 },
    ...Array.from({ length: W }, (_, k): Sub => ({ id: `dec${k}`, kind: 'decode', label: `DECODER ${String.fromCharCode(65 + k)}`, h: 54, lane: k, ...(k === W - 1 ? { fill: true } : {}) })),
  ];
  const y0 = -308, H = Math.max(290, need(decItems));

  const ifF = b.frame('if', 'IF · fetch', 0, U.x0, y0, 200, H);
  stack(b, ifF, [
    { id: 'pc', kind: 'pc', label: 'PC', sub: 'program counter', h: 40 },
    { id: 'npc', kind: 'nextpc', label: 'NEXT PC', h: 38, pair: { id: 'pcadd', kind: 'pcadd', label: `PC + ${4 * W}`, h: 38 } },
    { id: 'fetch', kind: 'fetch', label: W > 1 ? `FETCH × ${W}` : 'FETCH', sub: icLines ? 'reads the I-cache' : 'reads RAM', h: 56, fill: true },
  ]);
  const fqX = ifF.rect.x + ifF.rect.w + 18;
  b.add('fq', 'queue', 'FETCH QUEUE', fqX, y0, 84, H, { sub: `${fq} slots`, grid: { cols: 1, rows: fq, count: fq, ring: true } });
  const dcF = b.frame('dcf', 'ID · decode', 1, fqX + 84 + 18, y0, 150, H);
  stack(b, dcF, decItems);
  const rnF = b.frame('rnf', 'RENAME', 1, dcF.rect.x + dcF.rect.w + 18, y0, 170, H);
  stack(b, rnF, [
    { id: 'rat', kind: 'rename', label: 'RENAME TABLE', sub: 'register to producer', h: 130, fill: true },
    { id: 'disp', kind: 'queue', label: 'DISPATCH', sub: `${W} a cycle`, h: 52 },
  ]);
  b.get('rat').grid = { cols: 4, rows: 4, count: 16 };
  const sx = rnF.rect.x + rnF.rect.w + 18;
  b.add('sched', 'sched', 'SCHEDULER', sx, y0, 190, H, { sub: `${sched} entries · oldest ready first`, grid: gridFor(sched, 190 - 24, H - 56) });
  const ux = sx + 190 + 26;
  const uy = (k: number) => y0 + k * 64;
  b.add('alu0', 'alu', 'ALU 0', ux, uy(0), 200, 56, { sub: 'add · logic · shift · branch', unit: 'ALU0' });
  b.add('alu1', 'alu', 'ALU 1', ux, uy(1), 200, 56, { sub: 'add · logic · shift · branch', unit: 'ALU1' });
  b.add('mul', 'mul', 'MULTIPLIER', ux, uy(2), 200, 56, { sub: '3 cycles', unit: 'MUL' });
  b.add('lsu', 'lsu', 'LOAD / STORE', ux, uy(3), 200, H - 3 * 64, { sub: 'loads wait for older stores', unit: 'LSU' });
  const busX = ux + 200 + 14;
  b.add('bus', 'resultbus', 'RESULT BUS', busX, y0, 20, H - 40);
  // reorder buffer: a ring under the rename stage and the scheduler; the register file takes the commits
  const ry = y0 + H + 38, rh = 150;
  const robX = rnF.rect.x;
  b.add('rob', 'rob', 'REORDER BUFFER', robX, ry, sx + 190 - robX, rh, {
    sub: `${rob} entries · commit ${i.commitWidth ?? W} a cycle`, grid: { ...gridFor(rob, sx + 190 - robX - 24, rh - 56), ring: true },
  });
  regfile(b, robX - 16 - 230, ry, 230, rh, '2 read · commit write');
  // caches
  const l2h = l2Lines > 0 ? 100 : 0;
  const bottom = U.y1 - (l2Lines > 0 ? l2h + 18 : 30);
  const cy0 = ry + rh + 40;
  dcache(b, fqX, cy0, bu.rect.x - 40 - fqX, bottom - cy0, lines, ways);
  if (icLines > 0) icache(b, U.x0, cy0, fqX - 24 - U.x0, bottom - cy0, icLines);
  if (l2Lines > 0) l2(b, U.x0, U.y1 - l2h, bu.rect.x - 40 - U.x0, l2h, l2Lines);
  const nx = U.x0 + 134;
  b.add('bp', 'predictor', 'BRANCH PREDICTOR', nx, U.y0, busX + 20 - nx, 104, { sub: `${predEntries} x ${predBits}-bit`, grid: gridFor(predEntries, busX - nx - 24, 48) });

  const g = (id: string) => b.get(id);
  const lane = { flush: -373, wake: -360, bp: -347 };
  b.link('pc-add', 'data', 'pc', 'S', 'pcadd', 'N', { ft: 0.75, tt: 0.5, width: 1 });
  b.link('add-npc', 'data', 'pcadd', 'W', 'npc', 'E', { width: 1 });
  b.link('npc-pc', 'data', 'npc', 'N', 'pc', 'S', { ft: 0.5, tt: 0.2, width: 1 });
  b.link('pc-fetch', 'data', 'pc', 'S', 'fetch', 'N', { ft: 0.5, tt: 0.5, width: 1 });
  b.link('irq-pc', 'irq', 'intc', 'S', 'pc', 'W', { ft: 0.5, tt: 0.5, width: 1, via: [[ifF.rect.x + 4, cy(g('pc'))]], label: 'IRQ vector' });
  b.link('fetch-fq', 'data', 'fetch', 'E', 'fq', 'W', { ft: 0.5, tt: b.ty('fq', cy(g('fetch'))), width: 2 });
  b.link('fq-dec', 'data', 'fq', 'E', 'dcf', 'W', { width: 2 });
  b.link('dec-ren', 'data', 'dcf', 'E', 'rnf', 'W', { width: 2 });
  b.link('ren-sched', 'data', 'rnf', 'E', 'sched', 'W', { width: 2, label: 'dispatch' });
  b.link('ren-rob', 'data', 'rnf', 'S', 'rob', 'N', { ft: 0.5, tt: 0.2, width: 2 });
  ['alu0', 'alu1', 'mul', 'lsu'].forEach((u, k) => {
    const yy = y0 + Math.round(H * (0.15 + 0.22 * k)), mx = sx + 190 + 6 + 5 * k;
    b.link(`sched-${u}`, 'data', 'sched', 'E', u, 'W', { ft: b.ty('sched', yy), tt: 0.5, via: [[mx, yy], [mx, cy(g(u))]], width: 2, label: k === 0 ? 'issue' : undefined });
  });
  ['alu0', 'alu1', 'mul', 'lsu'].forEach((u) => b.link(`${u}-bus`, 'data', u, 'E', 'bus', 'W', { ft: 0.5, tt: b.ty('bus', cy(g(u))), width: 2 }));
  b.link('bus-wake', 'wakeup', 'bus', 'N', 'sched', 'N', { ft: 0.25, tt: 0.7, via: [[busX + 5, lane.wake], [Math.round(sx + 0.7 * 190), lane.wake]], width: 1, label: 'wake up' });
  b.link('bus-rob', 'data', 'bus', 'S', 'rob', 'E', { ft: 0.5, tt: 0.5, via: [[busX + 10, cy(g('rob'))]], width: 2, label: 'result' });
  b.link('bus-flush', 'flush', 'bus', 'N', 'npc', 'W', { ft: 0.6, tt: 0.3, via: [[busX + 12, lane.flush], [ifF.rect.x + 9, lane.flush]], width: 1, label: 'mispredict: squash' });
  b.link('bus-bp', 'control', 'bus', 'N', 'bp', 'S', { ft: 0.9, tt: b.tx('bp', busX + 18), width: 1, label: 'learn' });
  b.link('bp-npc', 'control', 'bp', 'S', 'npc', 'W', { ft: 0.02, tt: 0.7, via: [[nx + 6, lane.bp], [ifF.rect.x + 13, lane.bp]], width: 1, label: 'predicted target' });
  b.link('rob-rf', 'data', 'rob', 'W', 'rf', 'E', { width: 2, label: 'commit' });
  b.link('dec-rf', 'data', 'dcf', 'S', 'rf', 'N', { ft: 0.35, tt: 0.5, width: 2, label: 'read' });
  b.link('lsu-dc', 'data', 'lsu', 'S', 'dc', 'N', { ft: 0.5, tt: b.tx('dc', cx(g('lsu'))), both: true, width: 2 });
  const mmioY = Math.round(g('lsu').rect.y + 0.92 * g('lsu').rect.h);
  b.link('lsu-biu', 'mmio', 'lsu', 'E', 'biu', 'W', { ft: 0.92, tt: b.ty('biu', mmioY), width: 2, label: 'device access' });
  const fx = ifF.rect.x + 40;
  if (l2Lines > 0) {
    b.link('dc-l2', 'mem', 'dc', 'S', 'l2', 'N', { ft: 0.5, tt: b.tx('l2', cx(g('dc'))), both: true, width: 3 });
    if (icLines > 0) {
      b.link('ic-l2', 'mem', 'ic', 'S', 'l2', 'N', { ft: 0.5, tt: b.tx('l2', cx(g('ic'))), both: true, width: 3 });
      b.link('fetch-ic', 'data', 'fetch', 'S', 'ic', 'N', { ft: 0.2, tt: b.tx('ic', fx), both: true, width: 2 });
    } else b.link('fetch-l2', 'mem', 'fetch', 'S', 'l2', 'N', { ft: 0.2, tt: b.tx('l2', fx), width: 3, label: 'instruction fetch' });
    b.link('l2-biu', 'mem', 'l2', 'E', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', cy(g('l2'))), both: true, width: 3 });
  } else {
    b.link('dc-biu', 'mem', 'dc', 'E', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', cy(g('dc'))), both: true, width: 3 });
    const yb = U.y1 - 14;
    if (icLines > 0) {
      b.link('fetch-ic', 'data', 'fetch', 'S', 'ic', 'N', { ft: 0.2, tt: b.tx('ic', fx), both: true, width: 2 });
      b.link('ic-biu', 'mem', 'ic', 'S', 'biu', 'W', { ft: 0.5, tt: b.ty('biu', yb), via: [[cx(g('ic')), yb]], width: 3, label: 'instruction fetch' });
    } else b.link('fetch-biu', 'mem', 'fetch', 'S', 'biu', 'W', { ft: 0.2, tt: b.ty('biu', yb), via: [[fx, yb]], width: 3, label: 'instruction fetch' });
  }
  return b;
}

// ---------------------------------------------------------------- several cores on one die

/**
 * Core tiles in rows, a coherence ring bar above each row (every tile's bus interface reaches its bar going up), a trunk joining the bars,
 * and a shared column: the memory controller and the shared L2. Nothing multicore is simulated yet (docs/CPU.md).
 */
function multicore(i: PlanInput): CpuPlan {
  const n = Math.max(2, Math.floor(i.cores ?? 2));
  const one = cpuPlan({ ...i, cores: 1, l2Lines: 0 }); // the cores share one L2, they have none of their own
  const src = { x: U.x0, y: U.y0, w: U.x1 - U.x0, h: U.y1 - U.y0 };
  const BAR = 14, UP = 30;
  const area = { x: U.x0, y: U.y0, w: 1110, h: src.h };
  let best = { cols: 1, rows: n, s: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const s = Math.min(area.w / cols / src.w, (area.h - rows * UP) / rows / src.h);
    if (s > best.s + 1e-9) best = { cols, rows, s };
  }
  const { cols, rows, s } = best;
  const cw = area.w / cols, ch = (area.h - rows * UP) / rows;
  const blocks: Block[] = [], links: Link[] = [], tiles: Rect[] = [];
  const origin = (k: number): Pt => [
    area.x + (k % cols) * cw + (cw - src.w * s) / 2,
    area.y + UP + Math.floor(k / cols) * (ch + UP) + (ch - src.h * s) / 2,
  ];
  const at = (k: number, p: Pt): Pt => {
    const [ox, oy] = origin(k);
    return [Math.round(ox + (p[0] - src.x) * s), Math.round(oy + (p[1] - src.y) * s)];
  };
  const trunkX = area.x + area.w + 14;
  const barY = (r: number): number => Math.round(area.y + r * (ch + UP) + 6);
  for (let r = 0; r < rows; r++) blocks.push({ id: `ringbar${r}`, kind: 'ring', label: '', rect: { x: area.x, y: barY(r), w: area.w, h: BAR } });
  for (let k = 0; k < n; k++) {
    const p = `c${k}.`;
    const [tx, ty] = at(k, [src.x, src.y]);
    tiles.push({ x: tx, y: ty, w: Math.round(src.w * s), h: Math.round(src.h * s) });
    for (const b of one.blocks) {
      const [x0, y0] = at(k, [b.rect.x, b.rect.y]), [x1, y1] = at(k, [b.rect.x + b.rect.w, b.rect.y + b.rect.h]);
      blocks.push({
        ...b, id: p + b.id, ...(b.parent ? { parent: p + b.parent } : {}), core: k, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        ...(b.id === 'biu' ? { label: 'RING PORT', sub: 'to the ring' } : {}),
      });
    }
    for (const l of one.links) {
      // a small tile rounds short segments away
      const pts = l.pts.map((q) => at(k, q)).filter((q, m, all) => m === 0 || q[0] !== all[m - 1]![0] || q[1] !== all[m - 1]![1]);
      if (pts.length >= 2) links.push({ ...l, id: p + l.id, from: p + l.from, to: p + l.to, pts });
    }
  }
  const sx = U.x1 - 170;
  blocks.push({ id: 'ring', kind: 'ring', label: 'COHERENCE RING', rect: { x: trunkX, y: U.y0, w: 18, h: src.h }, sub: 'keeps the L1 caches in step' });
  blocks.push({ id: 'mc', kind: 'biu', label: 'MEMORY CONTROLLER', rect: { x: sx, y: U.y0, w: 170, h: 150 }, sub: 'RAM · MMIO' });
  blocks.push({ id: 'l2s', kind: 'l2', label: 'SHARED L2', rect: { x: sx, y: U.y0 + 170, w: 170, h: src.h - 170 }, sub: `${i.l2Lines ?? 64} lines`, grid: gridFor(i.l2Lines ?? 64, 146, src.h - 226) });
  const my = U.y0 + 75, ly = U.y0 + 170 + Math.round((src.h - 170) / 2);
  links.push({ id: 'ring-mc', kind: 'mem', from: 'ring', to: 'mc', pts: [[trunkX + 18, my], [sx, my]], width: 3, both: true });
  links.push({ id: 'ring-l2', kind: 'mem', from: 'ring', to: 'l2s', pts: [[trunkX + 18, ly], [sx, ly]], width: 3, both: true });
  for (let r = 0; r < rows; r++) {
    const y = barY(r) + BAR / 2;
    links.push({ id: `bar${r}-ring`, kind: 'mem', from: `ringbar${r}`, to: 'ring', pts: [[area.x + area.w, y], [trunkX, y]], width: 3, both: true });
  }
  for (let k = 0; k < n; k++) {
    const b = blocks.find((x) => x.id === `c${k}.biu`)!;
    const bx = Math.round(b.rect.x + b.rect.w / 2), bar = blocks.find((x) => x.id === `ringbar${Math.floor(k / cols)}`)!;
    links.push({ id: `c${k}.ring`, kind: 'mem', from: b.id, to: bar.id, pts: [[bx, b.rect.y], [bx, bar.rect.y + bar.rect.h]], width: 3, both: true });
  }
  return { arch: i.arch, cores: n, die: DIE, blocks, links, tiles };
}

export function cpuPlan(i: PlanInput): CpuPlan {
  if ((i.cores ?? 1) > 1) return multicore(i);
  const b = i.arch === 'ooo' ? outOfOrder(i) : pipeline(i);
  return { arch: i.arch, cores: 1, die: DIE, blocks: b.blocks, links: b.links };
}

export type { Pt };
