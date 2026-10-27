// The floorplans of each CPU architecture (see cpuplan.ts for the data model, cpufloor.ts for the layout engine, docs/DIE.md for the grammar).
//
// Every die has the same edge ring, on the sides the package pins are (docs/RENDER.md "Routing"): power and SVID in the north (the VRM's
// vcore stubs), the memory controller in the east (the DIMM bus), the clock and PCIe / NVMe / DMI in the south, USB, the display and the
// interrupt controller in the west. The core fills the middle, tiled edge to edge; blocks that talk to each other touch across a gutter.

import { type Block, type CpuPlan, type Link, type PlanInput, type Rect } from './cpuplan';
import { GAP, col, leaf, place, routeLinks, row, spans, type LinkSpec, type Node } from './cpufloor';
import { DIE } from './layout';

/** The die's usable area, the width of the edge columns and the height of the north and south bands. */
const R: Rect = { x: DIE.x + 24, y: DIE.y + 24, w: DIE.w - 48, h: DIE.h - 48 };
const EDGE = { side: 104, north: 64, south: 84 };
const CORE: Rect = { x: R.x + EDGE.side + GAP, y: R.y + EDGE.north + GAP, w: R.w - 2 * EDGE.side - 2 * GAP, h: R.h - EDGE.north - EDGE.south - 2 * GAP };

function ringTree(core: Node): Node {
  return col([
    row([leaf('pwr', 'power', 'POWER', { sub: 'vcore · one stub per VRM phase', shape: [6, 1], f: 3 }), leaf('thermal', 'thermal', 'SVID · THERMAL', { sub: 'sensors · throttle', f: 1.2 })], { px: EDGE.north }),
    row([
      col([
        leaf('usb', 'usb', 'USB', { sub: 'four lanes', shape: [1, 4], f: 1 }),
        leaf('display', 'display', 'DISPLAY', { sub: 'video pairs', shape: [1, 2], f: 1 }),
        leaf('intc', 'intc', 'INTC', { sub: 'four lines', shape: [4, 1], f: 1 }),
      ], { px: EDGE.side }),
      core,
      leaf('mc', 'mc', 'MEMORY CONTROLLER', { sub: 'six lanes a DIMM', shape: [1, 6], px: EDGE.side }),
    ], { f: 1 }),
    row([leaf('clk', 'clock', 'CLOCK · PLL', { sub: '24 MHz', f: 1 }), leaf('pcie', 'pcie', 'PCIe · NVMe · DMI', { sub: '12 PCIe · 3 NVMe · 6 DMI lanes', shape: [21, 1], f: 4 })], { px: EDGE.south }),
  ], { zone: 'edge' });
}

const fabric = () => leaf('fabric', 'fabric', 'SYSTEM BUS', { sub: 'RAM · devices', px: 50, zone: 'edge' });

type L = [id: string, kind: LinkSpec['kind'], from: string, to: string, lanes?: 1 | 2 | 3 | 4, label?: string, both?: boolean];
const links = (a: L[]): LinkSpec[] => a.map(([id, kind, from, to, lanes, label, both]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}), ...(label ? { label } : {}), ...(both ? { both } : {}) }));

const cacheSub = (lines: number, ways: number): string => `${lines} lines${ways > 1 ? ` · ${ways}-way` : ''}`;

/** The links every die has: the system bus to the edge blocks, the interrupt vector, the clock, the power into the core's top. */
function edgeLinks(coreTops: string[], pcId: string, clockTo: string): L[] {
  const out: L[] = [
    ['fab-mc', 'mem', 'fabric', 'mc', 4, undefined, true],
    ['fab-pcie', 'mmio', 'fabric', 'pcie', 3, 'DMI · PCIe · NVMe', true],
    ['fab-usb', 'mmio', 'fabric', 'usb', 2],
    ['fab-display', 'mmio', 'fabric', 'display', 2],
    ['fab-intc', 'mmio', 'fabric', 'intc', 1],
    ['irq-pc', 'irq', 'intc', pcId, 1, 'interrupt vector'],
    ['clk-core', 'control', 'clk', clockTo, 1, 'clock'],
    ['thermal-pwr', 'control', 'thermal', 'pwr', 1],
  ];
  for (const t of coreTops) out.push([`pwr-${t}`, 'power', 'pwr', t, 1]);
  return out;
}

// ---------------------------------------------------------------- unpipelined and in-order pipelines

function pipeline(i: PlanInput, cw: number = CORE.w, tile = false): { tree: Node; specs: LinkSpec[] } {
  const un = i.arch === 'unpipelined', two = i.arch === 'inorder2', fwd = i.forwarding ?? true;
  const lines = i.cacheLines ?? 8, ways = i.ways ?? 1;
  const icLines = i.icacheLines ?? 0, l2Lines = i.l2Lines ?? 0, tlb = i.tlbEntries ?? 0;
  const predEntries = i.predEntries ?? 64, predBits = i.predBits ?? 1;
  const frame = (id: string, label: string, stage: number, kids: Node[], f: number) => col(kids, { frame: { id, kind: 'stage', label, stage }, f });
  const latch = (k: number, name: string) => leaf(`lat${k}`, 'latch', name, { px: 30 });

  const ifKids: Node[] = [
    ...(un ? [] : [leaf('bp', 'predictor', 'BRANCH PREDICTOR', { cells: predEntries, sub: `${predEntries} x ${predBits}-bit`, f: 1.5 })]),
    row([leaf('npc', 'nextpc', 'NEXT PC', { shape: [32, 1] }), leaf('pcadd', 'pcadd', 'PC + 4', { shape: [32, 1] })], { px: un ? 64 : 52 }),
    leaf('pc', 'pc', 'PC', { shape: [32, 1], px: un ? 60 : 50 }),
    leaf('fetch', 'fetch', two ? 'FETCH × 2' : 'FETCH', { sub: icLines ? 'reads the I-cache' : 'reads RAM', shape: [32, 1], f: 1 }),
  ];
  const idKids: Node[] = un
    ? [leaf('imm', 'imm', 'IMMEDIATE', { shape: [32, 1], px: 70 }), leaf('dec', 'decode', 'DECODER', { sub: 'opcode to control', shape: [8, 4], f: 1 })]
    : two
      ? [
        leaf('hz', 'hazard', 'HAZARD', { sub: fwd ? 'load-use stall' : 'waits for write back', px: 56 }),
        leaf('imm', 'imm', 'IMMEDIATE', { shape: [32, 1], px: 46 }),
        leaf('bundle', 'bundle', 'PAIR / ISSUE', { sub: 'one bundle a cycle', px: 52 }),
        row([leaf('dec0', 'decode', 'DECODE A', { lane: 0, shape: [8, 4] }), leaf('dec1', 'decode', 'DECODE B', { lane: 1, shape: [8, 4] })], { f: 1 }),
      ]
      : [
        leaf('hz', 'hazard', 'HAZARD', { sub: fwd ? 'load-use stall' : 'waits for write back', px: 60 }),
        leaf('imm', 'imm', 'IMMEDIATE', { shape: [32, 1], px: 50 }),
        leaf('dec', 'decode', 'DECODER', { sub: 'opcode to control', shape: [8, 4], f: 1 }),
      ];
  const exKids: Node[] = [
    leaf('br', 'branch', 'BRANCH', { sub: 'compare · target', px: un ? 70 : 64 }),
    ...(!un && fwd ? [leaf('fwd', 'forward', 'FORWARD', { sub: 'bypass A / B', px: 56 })] : []),
    ...(two
      ? [leaf('alu0', 'alu', 'ALU A', { sub: 'add · logic · shift · mul', lane: 0, shape: [32, 1], f: 1 }), leaf('alu1', 'alu', 'ALU B', { lane: 1, shape: [32, 1], f: 1 })]
      : [leaf('alu', 'alu', 'ALU', { sub: 'add · logic · shift · mul', shape: [32, 1], f: 1 })]),
  ];
  const memKids: Node[] = [leaf('dev', 'mmio', 'DEVICE?', { sub: 'skips the cache', px: 64 }), leaf('lsu', 'lsu', 'LOAD / STORE', { sub: 'address · align', shape: [32, 1], f: 1 })];
  const wbKids: Node[] = [leaf('wb', 'wb', 'WRITE BACK', { sub: two ? 'two write ports' : 'result mux', shape: [32, 1], f: 1 })];

  // the stage columns, and the spans the south row has to line up with
  const defs = un
    ? [{ f: 1 }, { f: 1 }, { f: 1 }, { f: 1 }, { f: 0.8 }]
    : [{ f: 1.3 }, { px: 30 }, { f: 1.1 }, { px: 30 }, { f: 1.2 }, { px: 30 }, { f: 1 }, { px: 30 }, { f: 0.7 }];
  const sp = spans(cw, defs, GAP);
  const cover = (a: number, b: number) => sp[b]![0] + sp[b]![1] - sp[a]![0];
  const stageRow = row(un
    ? [
      frame('if', 'IF · FETCH', 0, ifKids, 1), frame('id', 'ID · DECODE', 1, idKids, 1), frame('ex', 'EX · EXECUTE', 2, exKids, 1),
      frame('mem', 'MEM · MEMORY', 3, memKids, 1), frame('wbf', 'WB · WRITE BACK', 4, wbKids, 0.8),
    ]
    : [
      frame('if', 'IF · FETCH', 0, ifKids, 1.3), latch(0, 'IF/ID'), frame('id', 'ID · DECODE', 1, idKids, 1.1), latch(1, 'ID/EX'),
      frame('ex', 'EX · EXECUTE', 2, exKids, 1.2), latch(2, 'EX/MEM'), frame('mem', 'MEM · MEMORY', 3, memKids, 1), latch(3, 'MEM/WB'),
      frame('wbf', 'WB · WRITE BACK', 4, wbKids, 0.7),
    ], { f: 52 });
  const southRow = row([
    ...(icLines > 0 ? [leaf('ic', 'icache', 'I-CACHE', { cells: icLines, sub: cacheSub(icLines, 1), px: un ? cover(0, 0) : cover(0, 1) })] : []),
    leaf('rf', 'regfile', 'REGISTER FILE', { cells: 16, sub: two ? '4 read · 2 write' : '2 read · 1 write', px: icLines > 0 ? (un ? cover(1, 2) : cover(2, 5)) : (un ? cover(0, 2) : cover(0, 5)) }),
    ...(tlb > 0 ? [leaf('tlb', 'tlb', 'TLB', { cells: tlb, sub: `${tlb} entries · virtual to physical`, f: 0.55 })] : []),
    leaf('dc', 'dcache', 'D-CACHE', { cells: lines, sub: cacheSub(lines, ways), f: 1 }),
  ], { f: 31 });
  const tree = col([
    ...(un ? [leaf('seq', 'control', 'SEQUENCER', { cells: 5, sub: 'one instruction at a time · five phases', px: 70 })] : []),
    stageRow,
    southRow,
    ...(l2Lines > 0 && !tile ? [leaf('l2', 'l2', 'L2 CACHE', { cells: l2Lines, sub: `${l2Lines} lines · shared by both L1s`, px: 92 })] : []),
    ...(tile ? [] : [fabric()]),
  ], { f: 1, zone: 'core' });

  const specs: L[] = [
    // the fetch group
    ['pc-pcadd', 'data', 'pc', 'pcadd', 1], ['pcadd-npc', 'data', 'pcadd', 'npc', 1], ['npc-pc', 'data', 'npc', 'pc', 1], ['pc-fetch', 'data', 'pc', 'fetch', 1],
    ...(icLines > 0
      ? [['fetch-ic', 'data', 'fetch', 'ic', 2, 'instruction fetch', true] as L]
      : [['fetch-mem', 'mem', 'fetch', l2Lines > 0 ? 'l2' : 'fabric', 3, 'instruction fetch (uncached)'] as L]),
  ];
  if (un) {
    specs.push(
      ['fetch-dec', 'data', 'fetch', 'dec', 2, 'instruction'], ['fetch-imm', 'data', 'fetch', 'imm', 1],
      ['dec-alu', 'data', 'dec', 'alu', 2], ['imm-alu', 'data', 'imm', 'alu', 1], ['dec-br', 'data', 'dec', 'br', 1],
      ['alu-lsu', 'data', 'alu', 'lsu', 2], ['lsu-dev', 'control', 'lsu', 'dev', 1], ['lsu-wb', 'data', 'lsu', 'wb', 2],
      ['br-npc', 'flush', 'br', 'npc', 1, 'branch target'],
      ['seq-dec', 'control', 'seq', 'dec', 1, 'phase'],
    );
  } else {
    specs.push(
      ['if-l0', 'data', 'fetch', 'lat0', 2], ['pc-l0', 'data', 'pc', 'lat0', 1],
      ['l0-hz', 'data', 'lat0', 'hz', 1], ['l0-imm', 'data', 'lat0', 'imm', 2],
      ['imm-l1', 'data', 'imm', 'lat1', 1], ['rf-l1', 'data', 'rf', 'lat1', 2, 'operands'],
      ['l1-br', 'data', 'lat1', 'br', 1], ['l2-lsu', 'data', 'lat2', 'lsu', 2], ['l2-dev', 'data', 'lat2', 'dev', 1],
      ['lsu-l3', 'data', 'lsu', 'lat3', 2], ['l3-wb', 'data', 'lat3', 'wb', 2],
      ['bp-npc', 'control', 'bp', 'npc', 1, 'predicted target'], ['br-bp', 'control', 'br', 'bp', 1, 'learn'], ['br-npc', 'flush', 'br', 'npc', 1, 'redirect · squash'],
    );
    if (two) {
      specs.push(['l0-dec0', 'data', 'lat0', 'dec0', 2], ['l0-dec1', 'data', 'lat0', 'dec1', 2], ['bundle-dec0', 'control', 'bundle', 'dec0', 1], ['bundle-dec1', 'control', 'bundle', 'dec1', 1],
        ['dec0-l1', 'data', 'dec0', 'lat1', 2], ['dec1-l1', 'data', 'dec1', 'lat1', 2],
        ['l1-alu0', 'data', 'lat1', 'alu0', 2], ['l1-alu1', 'data', 'lat1', 'alu1', 2], ['alu0-l2', 'data', 'alu0', 'lat2', 2], ['alu1-l2', 'data', 'alu1', 'lat2', 2]);
    } else {
      specs.push(['l0-dec', 'data', 'lat0', 'dec', 2], ['dec-l1', 'data', 'dec', 'lat1', 2], ['l1-alu', 'data', 'lat1', 'alu', 2], ['alu-l2', 'data', 'alu', 'lat2', 2]);
    }
    if (fwd) specs.push(['l1-fwd', 'data', 'lat1', 'fwd', 2], ['fwd-a', 'forward', 'lat2', 'fwd', 2, 'forward'], ['fwd-b', 'forward', 'lat3', 'fwd', 2], ['fwd-alu', 'data', 'fwd', two ? 'alu0' : 'alu', 2]);
  }
  // the register file ports
  for (const d of two ? ['dec0', 'dec1'] : ['dec']) specs.push([`${d}-rf`, 'data', d, 'rf', 2, 'read']);
  specs.push(['wb-rf', 'data', 'wb', 'rf', 2, 'write']);
  // memory
  specs.push(['lsu-dc', 'data', 'lsu', 'dc', 2, undefined, true], ['dev-fab', 'mmio', 'dev', 'fabric', 2, 'device access']);
  // the MMU: loads, stores and instruction fetches are translated, and a TLB miss walks the page table through the L2 and RAM
  if (tlb > 0) specs.push(['lsu-tlb', 'control', 'lsu', 'tlb', 1, 'translate'], ['fetch-tlb', 'control', 'fetch', 'tlb', 1, 'translate'], ['tlb-walk', 'mem', 'tlb', l2Lines > 0 ? 'l2' : 'fabric', 3, 'page walk']);
  if (l2Lines > 0) {
    specs.push(['dc-l2', 'mem', 'dc', 'l2', 3, undefined, true], ['l2-fab', 'mem', 'l2', 'fabric', 3, undefined, true]);
    if (icLines > 0) specs.push(['ic-l2', 'mem', 'ic', 'l2', 3, undefined, true]);
  } else {
    specs.push(['dc-fab', 'mem', 'dc', 'fabric', 3, undefined, true]);
    if (icLines > 0) specs.push(['ic-fab', 'mem', 'ic', 'fabric', 3, undefined, true]);
  }
  specs.push(...edgeLinks(['if', 'id', 'ex', 'mem', 'wbf'], 'pc', 'fetch'));
  return { tree, specs: links(specs) };
}

// ---------------------------------------------------------------- out of order

function outOfOrder(i: PlanInput, cw: number = CORE.w, tile = false): { tree: Node; specs: LinkSpec[] } {
  const W = i.width ?? 2, rob = i.robSize ?? 8, sched = i.schedSize ?? 6, fq = i.fetchQueue ?? 4;
  const lines = i.cacheLines ?? 8, ways = i.ways ?? 1, icLines = i.icacheLines ?? 0, l2Lines = i.l2Lines ?? 0, tlb = i.tlbEntries ?? 0;
  const predEntries = i.predEntries ?? 64, predBits = i.predBits ?? 1;
  const frame = (id: string, label: string, stage: number, kids: Node[], f: number) => col(kids, { frame: { id, kind: 'stage', label, stage }, f });
  const defs = [{ f: 1.35 }, { f: 0.45 }, { f: 0.95 }, { f: 1.05 }, { f: 1.1 }, { f: 1.25 }, { px: 26 }];
  const sp = spans(cw, defs, GAP);
  const cover = (a: number, b: number) => sp[b]![0] + sp[b]![1] - sp[a]![0];
  const decs = Array.from({ length: W }, (_, k) => leaf(`dec${k}`, 'decode', `DECODER ${String.fromCharCode(65 + k)}`, { lane: k, shape: [8, 4], f: 1 }));
  const stageRow = row([
    frame('if', 'IF · FETCH', 0, [
      leaf('bp', 'predictor', 'BRANCH PREDICTOR', { cells: predEntries, sub: `${predEntries} x ${predBits}-bit`, f: 1.4 }),
      row([leaf('npc', 'nextpc', 'NEXT PC', { shape: [32, 1] }), leaf('pcadd', 'pcadd', `PC + ${4 * W}`, { shape: [32, 1] })], { px: 52 }),
      leaf('pc', 'pc', 'PC', { shape: [32, 1], px: 46 }),
      leaf('fetch', 'fetch', W > 1 ? `FETCH × ${W}` : 'FETCH', { sub: icLines ? 'reads the I-cache' : 'reads RAM', shape: [32, 1], f: 1 }),
    ], 1.35),
    leaf('fq', 'queue', 'FETCH QUEUE', { cells: fq, ring: true, sub: `${fq} slots`, f: 0.45 }),
    frame('dcf', 'ID · DECODE', 1, [leaf('imm', 'imm', 'IMMEDIATE', { shape: [32, 1], px: 46 }), ...decs], 0.95),
    frame('rnf', 'RENAME', 1, [leaf('rat', 'rename', 'RENAME TABLE', { cells: 16, sub: 'register to producer', f: 1.3 }), leaf('disp', 'queue', 'DISPATCH', { sub: `${W} a cycle`, px: 64 })], 1.05),
    leaf('sched', 'sched', 'SCHEDULER', { cells: sched, sub: `${sched} entries · oldest ready first`, f: 1.1 }),
    frame('exf', 'EXECUTE', 2, [
      leaf('alu0', 'alu', 'ALU 0', { sub: 'add · logic · shift · branch', unit: 'ALU0', shape: [32, 1], f: 1 }),
      leaf('alu1', 'alu', 'ALU 1', { sub: 'add · logic · shift · branch', unit: 'ALU1', shape: [32, 1], f: 1 }),
      leaf('mul', 'mul', 'MULTIPLIER', { sub: '3 cycles', unit: 'MUL', shape: [32, 1], f: 1 }),
      leaf('lsu', 'lsu', 'LOAD / STORE', { sub: 'loads wait for older stores', unit: 'LSU', shape: [32, 1], f: 1.5 }),
    ], 1.25),
    leaf('bus', 'resultbus', 'RESULT BUS', { px: 26 }),
  ], { f: 50 });
  const southRow = row([
    ...(icLines > 0 ? [leaf('ic', 'icache', 'I-CACHE', { cells: icLines, sub: cacheSub(icLines, 1), px: cover(0, 1) })] : []),
    leaf('rf', 'regfile', 'REGISTER FILE', { cells: 16, sub: `${W} read · commit write`, px: icLines > 0 ? cover(2, 2) : cover(0, 2) }),
    leaf('rob', 'rob', 'REORDER BUFFER', { cells: rob, ring: true, sub: `${rob} entries · commit ${i.commitWidth ?? W} a cycle`, px: cover(3, 4) }),
    ...(tlb > 0 ? [leaf('tlb', 'tlb', 'TLB', { cells: tlb, sub: `${tlb} entries · virtual to physical`, f: 0.55 })] : []),
    leaf('dc', 'dcache', 'D-CACHE', { cells: lines, sub: cacheSub(lines, ways), f: 1 }),
  ], { f: 31 });
  const tree = col([
    stageRow, southRow,
    ...(l2Lines > 0 && !tile ? [leaf('l2', 'l2', 'L2 CACHE', { cells: l2Lines, sub: `${l2Lines} lines · shared by both L1s`, px: 92 })] : []),
    ...(tile ? [] : [fabric()]),
  ], { f: 1, zone: 'core' });

  const specs: L[] = [
    ['pc-pcadd', 'data', 'pc', 'pcadd', 1], ['pcadd-npc', 'data', 'pcadd', 'npc', 1], ['npc-pc', 'data', 'npc', 'pc', 1], ['pc-fetch', 'data', 'pc', 'fetch', 1],
    ['bp-npc', 'control', 'bp', 'npc', 1, 'predicted target'],
    ['fetch-fq', 'data', 'fetch', 'fq', 2],
    ...(icLines > 0
      ? [['fetch-ic', 'data', 'fetch', 'ic', 2, 'instruction fetch', true] as L]
      : [['fetch-mem', 'mem', 'fetch', l2Lines > 0 ? 'l2' : 'fabric', 3, 'instruction fetch (uncached)'] as L]),
    ['fq-imm', 'data', 'fq', 'imm', 1], ['imm-disp', 'data', 'imm', 'disp', 1, 'immediate'],
    ['rat-disp', 'data', 'rat', 'disp', 2], ['disp-sched', 'data', 'disp', 'sched', 2, 'dispatch'], ['disp-rob', 'data', 'disp', 'rob', 2],
    ['bus-sched', 'wakeup', 'bus', 'sched', 1, 'wake up'], ['bus-rob', 'data', 'bus', 'rob', 2, 'result'],
    ['bus-npc', 'flush', 'bus', 'npc', 1, 'mispredict: squash'], ['bus-bp', 'control', 'bus', 'bp', 1, 'learn'],
    ['rob-rf', 'data', 'rob', 'rf', 2, 'commit'],
    ['lsu-dc', 'data', 'lsu', 'dc', 2, undefined, true], ['lsu-fab', 'mmio', 'lsu', 'fabric', 2, 'device access'],
    ...(tlb > 0 ? [['lsu-tlb', 'control', 'lsu', 'tlb', 1, 'translate'] as L, ['fetch-tlb', 'control', 'fetch', 'tlb', 1, 'translate'] as L, ['tlb-walk', 'mem', 'tlb', l2Lines > 0 ? 'l2' : 'fabric', 3, 'page walk'] as L] : []),
  ];
  for (let k = 0; k < W; k++) specs.push([`fq-dec${k}`, 'data', 'fq', `dec${k}`, 2], [`dec${k}-rat`, 'data', `dec${k}`, 'rat', 2], [`dec${k}-rf`, 'data', `dec${k}`, 'rf', 2, k === 0 ? 'read' : undefined]);
  for (const u of ['alu0', 'alu1', 'mul', 'lsu']) specs.push([`sched-${u}`, 'data', 'sched', u, 2, u === 'alu0' ? 'issue' : undefined], [`${u}-bus`, 'data', u, 'bus', 2]);
  if (l2Lines > 0) specs.push(['dc-l2', 'mem', 'dc', 'l2', 3, undefined, true], ['l2-fab', 'mem', 'l2', 'fabric', 3, undefined, true], ...(icLines > 0 ? [['ic-l2', 'mem', 'ic', 'l2', 3, undefined, true] as L] : []));
  else specs.push(['dc-fab', 'mem', 'dc', 'fabric', 3, undefined, true], ...(icLines > 0 ? [['ic-fab', 'mem', 'ic', 'fabric', 3, undefined, true] as L] : []));
  specs.push(...edgeLinks(['if', 'dcf', 'rnf', 'sched', 'exf'], 'pc', 'fetch'));
  return { tree, specs: links(specs) };
}

// ---------------------------------------------------------------- one core, and several

const cache = new Map<string, CpuPlan>();

function single(i: PlanInput): CpuPlan {
  const { tree, specs } = i.arch === 'ooo' ? outOfOrder(i) : pipeline(i);
  const blocks: Block[] = [];
  place(ringTree(tree), R, blocks, 'edge');
  return { arch: i.arch, cores: 1, die: DIE, blocks, links: routeLinks(DIE, blocks, specs) };
}

/** One core of a multicore die: the core's floorplan laid out in a w x h rectangle at the origin, its links routed in it. */
function coreTile(i: PlanInput, w: number, h: number): { blocks: Block[]; links: Link[] } {
  const { tree, specs } = i.arch === 'ooo' ? outOfOrder(i, w, true) : pipeline(i, w, true);
  const blocks: Block[] = [];
  place(tree, { x: 0, y: 0, w, h }, blocks, 'core');
  const have = new Set(blocks.map((b) => b.id));
  const inner = specs.filter((l) => have.has(l.from) && have.has(l.to));
  return { blocks, links: routeLinks({ x: -24, y: -24, w: w + 48, h: h + 48 }, blocks, inner) };
}

/** Core tiles in the die's middle (each core laid out for its own tile, then scaled to fit), a shared L2 at their east end and one system bus under them (nothing multicore is simulated yet). */
function multicore(i: PlanInput): CpuPlan {
  const n = Math.max(2, Math.floor(i.cores ?? 2));
  // the ring blocks, with the core area holding a placeholder for the tiles, the shared L2 and the system bus
  const holder = col([
    row([leaf('__tiles', 'stage', ''), leaf('l2s', 'l2', 'SHARED L2', { cells: i.l2Lines ?? 64, sub: `${i.l2Lines ?? 64} lines · all cores`, px: 150, zone: 'edge' })], { f: 1 }),
    fabric(),
  ], { f: 1, zone: 'core' });
  const ring: Block[] = [];
  place(ringTree(holder), R, ring, 'edge');
  const region = ring.find((b) => b.id === '__tiles')!.rect;
  const blocks = ring.filter((b) => b.id !== '__tiles');
  const G2 = 18, TW = 1136;
  // the tile grid: every (cols x rows) that holds n tiles; each tile is laid out at its cell's shape, and the biggest scale wins
  let best = { cols: 1, rows: n, s: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols !== 0) continue;
    const rows = n / cols;
    const cellW = (region.w - (cols - 1) * G2) / cols, cellH = (region.h - (rows - 1) * G2) / rows;
    const th = Math.min(900, Math.max(430, Math.round((TW * cellH) / cellW)));
    const s = Math.min(cellW / TW, cellH / th);
    if (s > best.s + 1e-9) best = { cols, rows, s, th };
  }
  const { cols, rows, s, th } = best;
  const cellW = (region.w - (cols - 1) * G2) / cols, cellH = (region.h - (rows - 1) * G2) / rows;
  const one = coreTile(i, TW, th);
  const ids = new Set(one.blocks.map((b) => b.id));
  const at = (k: number, x: number, y: number): [number, number] => [
    Math.round(region.x + (k % cols) * (cellW + G2) + (cellW - TW * s) / 2 + x * s),
    Math.round(region.y + Math.floor(k / cols) * (cellH + G2) + (cellH - th * s) / 2 + y * s),
  ];
  const tiles: Rect[] = [];
  const inner: Link[] = [];
  for (let k = 0; k < n; k++) {
    const p = `c${k}.`;
    const [tx, ty] = at(k, 0, 0);
    tiles.push({ x: tx, y: ty, w: Math.round(TW * s), h: Math.round(th * s) });
    for (const b of one.blocks) {
      const [a0, b0] = at(k, b.rect.x, b.rect.y), [a1, b1] = at(k, b.rect.x + b.rect.w, b.rect.y + b.rect.h);
      blocks.push({ ...b, id: p + b.id, ...(b.parent ? { parent: p + b.parent } : {}), core: k, rect: { x: a0, y: b0, w: a1 - a0, h: b1 - b0 } });
    }
    for (const l of one.links) {
      const pts = l.pts.map(([x, y]) => at(k, x, y)).filter((q, m, all) => m === 0 || q[0] !== all[m - 1]![0] || q[1] !== all[m - 1]![1]);
      if (pts.length >= 2) inner.push({ ...l, id: p + l.id, from: p + l.from, to: p + l.to, pts });
    }
  }
  void ids;
  // the links out of every tile: its caches into the shared L2, its device path to the system bus; the edge blocks hang off the system bus
  const outs: L[] = [];
  for (let k = 0; k < n; k++) {
    const p = `c${k}.`;
    outs.push([`${p}dc-l2`, 'mem', `${p}dc`, 'l2s', 3, undefined, true], [`${p}src-l2`, 'mem', `${p}${i.icacheLines ? 'ic' : 'fetch'}`, 'l2s', 3, undefined, true], [`${p}dev-fab`, 'mmio', `${p}${i.arch === 'ooo' ? 'lsu' : 'dev'}`, 'fabric', 2]);
  }
  for (let k = 0; k < n; k++) outs.push([`c${k}.irq`, 'irq', 'intc', `c${k}.pc`, 1]);
  outs.push(['l2-fab', 'mem', 'l2s', 'fabric', 4, undefined, true], ...edgeLinks([], 'c0.pc', 'c0.fetch').filter((l) => !['irq-pc', 'clk-core'].includes(l[0])));
  const routed = routeLinks(DIE, blocks, links(outs));
  return { arch: i.arch, cores: n, die: DIE, blocks, links: [...inner, ...routed], tiles };
}

export function cpuPlan(i: PlanInput): CpuPlan {
  const key = JSON.stringify(i);
  const hit = cache.get(key);
  if (hit) return hit;
  const plan = (i.cores ?? 1) > 1 ? multicore(i) : single(i);
  cache.set(key, plan);
  return plan;
}
