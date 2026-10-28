import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { planInput, type PlanInput, type Rect } from './cpuplan';
import { cpuPlan } from './cpuplans';
import { specsOfKind, type CpuSpec } from '../../sim/board/specs';
import { isTall } from './dieart';
import { dockLink, glyphPins, hasSymbol, inPinFor } from './glyphgeom';
import { controlsOf, glyph, glyphArea, glyphLive, GLYPH_KINDS, slotsOf, CONTROL_LINES } from './blockart';
import type { Theme } from '../theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

// The symbols inside the die's blocks (docs/DIE.md "Inside the blocks"): they fit their blocks, and the live text goes where the symbol has room for it.

const INPUTS: PlanInput[] = [
  { arch: 'unpipelined', cacheLines: 8 },
  { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
  { arch: 'inorder2', forwarding: true, cacheLines: 16 },
  { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128 },
];
const inside = (r: Rect, o: Rect) => r.x >= o.x - 4 && r.y >= o.y - 1 && r.x + r.w <= o.x + o.w + 4 && r.y + r.h <= o.y + o.h + 1;

describe('block symbols', () => {
  it('every symbol block of every architecture has room for its symbol, which is drawn without error', () => {
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => hasSymbol(x))) {
        const a = glyphArea(b);
        expect(a, `${i.arch} ${b.id}`).not.toBeNull();
        const texts: string[] = [];
        expect(() => glyph(new Graphics(), DARK, b, a!, '#0af', (t) => texts.push(t))).not.toThrow();
      }
    }
  });

  it('the live text of an instruction goes inside the block it is in', () => {
    const items = [{ op: 'addi', text: 'addi t0, t0, 4', pc: 0x1004 }];
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => hasSymbol(x))) {
        const a = glyphArea(b)!;
        const l = glyphLive(b, a, items, 0x1004);
        for (const t of l.texts) expect(inside(t.rect, b.rect), `${i.arch} ${b.id}`).toBe(true);
        for (const t of l.lit) expect(inside(t.rect, b.rect), `${i.arch} ${b.id} lit`).toBe(true);
      }
    }
  });

  it('the PC shows eight hex digits and a fetch block one word per lane it reads', () => {
    const plan = cpuPlan(INPUTS[3]!);
    const pc = plan.blocks.find((b) => b.kind === 'pc')!, fetch = plan.blocks.find((b) => b.kind === 'fetch')!;
    expect(glyphLive(pc, glyphArea(pc)!, [], 0x1abc).texts.map((t) => t.top).join('')).toBe('00001abc');
    expect(slotsOf(fetch, glyphArea(fetch)!).words).toHaveLength(4);
  });

  it('the decoder raises the lines an instruction needs', () => {
    const on = (op: string) => controlsOf(op).map((k) => CONTROL_LINES[k]);
    expect(on('add')).toEqual(['alu', 'wr']);
    expect(on('addi')).toEqual(['alu', 'wr', 'imm']);
    expect(on('lw')).toEqual(['mem', 'wr', 'imm']);
    expect(on('sw')).toEqual(['mem', 'imm']);
    expect(on('bne')).toEqual(['br']);
    expect(on('ecall')).toEqual(['sys']);
  });

  it('every symbol has its pins inside its block, and a link into it ends on the right one', () => {
    for (const i of INPUTS) {
      const plan = cpuPlan(i);
      for (const b of plan.blocks.filter((x) => hasSymbol(x))) {
        if (b.kind === 'latch') continue; // a column of registers: the wires meet its edge, it has no pins
        const pins = glyphPins(b)!;
        expect(pins, `${i.arch} ${b.id}`).not.toBeNull();
        for (const p of [...Object.values(pins.ins), ...(pins.out ? [pins.out] : [])]) {
          expect(p[0], b.id).toBeGreaterThanOrEqual(b.rect.x); expect(p[0], b.id).toBeLessThanOrEqual(b.rect.x + b.rect.w);
          expect(p[1], b.id).toBeGreaterThanOrEqual(b.rect.y); expect(p[1], b.id).toBeLessThanOrEqual(b.rect.y + b.rect.h);
        }
      }
      for (const l of plan.links) {
        const to = plan.blocks.find((b) => b.id === l.to)!, pins = glyphPins(to);
        if (!pins) continue;
        const pin = inPinFor(to, l.id, pins)!;
        expect(l.pts[l.pts.length - 1], `${i.arch} ${l.id} into ${to.id}`).toEqual(pin);
      }
    }
  });

  it('the next-PC multiplexer takes the +4, the branch redirect and the interrupt vector on three different pins', () => {
    const plan = cpuPlan(INPUTS[3]!);
    const npc = plan.blocks.find((b) => b.kind === 'nextpc')!, pins = glyphPins(npc)!;
    expect(inPinFor(npc, 'pcadd-npc', pins)).toEqual(pins.ins['+4']);
    expect(inPinFor(npc, 'br-npc', pins)).toEqual(pins.ins.br);
    expect(inPinFor(npc, 'irq-pc', pins)).toEqual(pins.ins.irq);
    expect(new Set([pins.ins['+4']![1], pins.ins.br![1], pins.ins.irq![1]]).size).toBe(3);
    // a link docks: it runs on from the block's edge to the pin without a diagonal
    const d = dockLink(npc, npc, 'br-npc', [[npc.rect.x, npc.rect.y + 20], [npc.rect.x - 30, npc.rect.y + 20]]);
    for (let k = 1; k < d.length; k++) expect(d[k]![0] === d[k - 1]![0] || d[k]![1] === d[k - 1]![1]).toBe(true);
  });

  it('every CPU the game ships draws every symbol, docks every link into a pin or an edge, and fills its decoders', () => {
    const cpus = specsOfKind('cpu') as CpuSpec[];
    expect(cpus.length).toBeGreaterThanOrEqual(10);
    for (const spec of cpus) {
      const plan = cpuPlan(planInput(spec.engine, spec.mmu ? { tlbEntries: spec.mmu.tlb } : {}));
      const symbols = plan.blocks.filter((b) => hasSymbol(b));
      expect(symbols.length, spec.id).toBeGreaterThan(8);
      for (const b of symbols) {
        expect(glyphArea(b), `${spec.id} ${b.id}`).not.toBeNull();
        expect(() => glyph(new Graphics(), DARK, b, glyphArea(b)!, '#0af', () => {})).not.toThrow();
        const live = glyphLive(b, glyphArea(b)!, [{ op: 'add', text: 'add t4, t1, t2', pc: 0x1000, word: 0x00a01083 }], 0x1000, [1]);
        for (const t of live.texts) expect(t.rect.x + t.rect.w, `${spec.id} ${b.id}`).toBeLessThanOrEqual(b.rect.x + b.rect.w + 4);
      }
      // a decoder never falls back to a field of cells: wide or in a column it is a symbol
      for (const b of plan.blocks.filter((x) => x.kind === 'decode')) expect(hasSymbol(b), `${spec.id} ${b.id}`).toBe(true);
      for (const l of plan.links) {
        const to = plan.blocks.find((b) => b.id === l.to)!, pins = glyphPins(to);
        if (pins) expect(l.pts[l.pts.length - 1], `${spec.id} ${l.id}`).toEqual(inPinFor(to, l.id, pins));
        const from = plan.blocks.find((b) => b.id === l.from)!, fp = glyphPins(from);
        if (fp?.out) expect(l.pts[0], `${spec.id} ${l.id} from ${from.id}`).toEqual(fp.out);
      }
    }
  });

  it('the hazard lamp lights for a waiting instruction and the forwarding multiplexer for the operand that is forwarded', () => {
    const plan = cpuPlan(INPUTS[2]!);
    const hz = plan.blocks.find((b) => b.kind === 'hazard')!, fw = plan.blocks.find((b) => b.kind === 'forward')!;
    const item = { op: 'add', text: 'add t0, t1, t2', pc: 0x1000, word: 1 };
    expect(glyphLive(hz, glyphArea(hz)!, [], undefined, []).lit).toHaveLength(0);
    expect(glyphLive(hz, glyphArea(hz)!, [item]).lit).toHaveLength(1);
    expect(glyphLive(fw, glyphArea(fw)!, [{ ...item, flags: 0 }]).lit).toHaveLength(0);
    expect(glyphLive(fw, glyphArea(fw)!, [{ ...item, flags: 2 }]).lit).toHaveLength(1); // operand B only
    expect(glyphLive(fw, glyphArea(fw)!, [{ ...item, flags: 3 }]).lit).toHaveLength(2);
  });
});
