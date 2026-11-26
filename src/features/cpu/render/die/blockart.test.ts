import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { planInput } from '../core/cpuplan';
import type * as planTypes from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { specsOfKind } from '@/features/board/sim/specs';
import type * as specTypes from '@/features/board/sim/specs';
import { dockLink, glyphPins, hasSymbol, inPinFor } from './glyphgeom';
import { controlsOf, glyph, glyphArea, glyphLive, slotsOf, CONTROL_LINES } from './blockart';
import type { Theme } from '@/core/render/theme';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const DARK: Theme = {
  bg: '#04060f',
  board: '#081628',
  trace: '#1e4270',
  sub: '#0d1636',
  die: '#111b46',
  pin: '#d4af5f',
  tile: '#18245c',
  ink: '#e2eaff',
  mute: '#8a97c2',
  line: '#2a366a',
  dot: '#18214a',
  on: '#08102a',
  alu: '#3be3ff',
  mul: '#a68bff',
  ld: '#ffc247',
  st: '#6dffa6',
  br: '#ff55dc',
  bad: '#ff5a78',
};

// The symbols inside the die's blocks (docs/DIE.md "Inside the blocks"): they fit their blocks, and the live text goes where the symbol has room for it.

const INPUTS: planTypes.PlanInput[] = [
  { arch: 'unpipelined', cacheLines: 8 },
  { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
  { arch: 'inorder2', forwarding: true, cacheLines: 16 },
  {
    arch: 'ooo',
    width: 4,
    robSize: 32,
    schedSize: 16,
    fetchQueue: 8,
    cacheLines: 64,
    ways: 4,
    icacheLines: 32,
    l2Lines: 128,
  },
];
const inside = (r: planTypes.Rect, o: planTypes.Rect) =>
  r.x >= o.x - 4 && r.y >= o.y - 1 && r.x + r.w <= o.x + o.w + 4 && r.y + r.h <= o.y + o.h + 1;
/** The control lines the decoder raises for `op`. */
const on = (op: string) => controlsOf(op).map((k) => CONTROL_LINES[k]);
/** The symbol blocks of `plan` that have pins (a latch is a column of registers: the wires meet its edge). */
const pinnedSymbols = (plan: planTypes.CpuPlan) => plan.blocks.filter((x) => hasSymbol(x) && x.kind !== 'latch');
/** Every pin of a symbol: its inputs and, when it has one, its output. */
const allPins = (pins: NonNullable<ReturnType<typeof glyphPins>>): planTypes.Pt[] => [
  ...Object.values(pins.ins),
  ...(pins.out ? [pins.out] : []),
];
/** The links of `plan` into a block with pins, with that block and its pins. */
const linksIntoPins = (plan: planTypes.CpuPlan) =>
  plan.links.flatMap((l) => {
    const to = must(plan.blocks.find((b) => b.id === l.to));
    const pins = glyphPins(to);
    return pins ? [{ l, to, pins }] : [];
  });
/** The links of `plan` out of a block with an output pin, with that block and the pin. */
const linksOutOfPins = (plan: planTypes.CpuPlan) =>
  plan.links.flatMap((l) => {
    const from = must(plan.blocks.find((b) => b.id === l.from));
    const out = glyphPins(from)?.out;
    return out ? [{ l, from, out }] : [];
  });
/** Does every segment of the polyline run along an axis? */
const square = (pts: planTypes.Pt[]): boolean =>
  pts.slice(1).every((v, k) => v[0] === must(pts[k])[0] || v[1] === must(pts[k])[1]);
/** The plan of a catalog CPU, with its TLB when it has an MMU. */
const specPlan = (s: specTypes.CpuSpec) => cpuPlan(planInput(s.engine, s.mmu ? { tlbEntries: s.mmu.tlb } : {}));

describe('block symbols', () => {
  it('every symbol block of every architecture has room for its symbol, which is drawn without error', () => {
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => hasSymbol(x))) {
        const a = glyphArea(b);
        expect(a, `${i.arch} ${b.id}`).not.toBeNull();
        const texts: string[] = [];
        expect(() => {
          glyph(new Graphics(), DARK, b, must(a), '#0af', (t) => {
            texts.push(t);
          });
        }).not.toThrow();
      }
    }
  });

  it('the live text of an instruction goes inside the block it is in', () => {
    const items = [{ op: 'addi', text: 'addi t0, t0, 4', pc: 0x10_04 }];
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => hasSymbol(x))) {
        const a = must(glyphArea(b));
        const l = glyphLive(b, a, items, 0x10_04);
        for (const t of l.texts) {
          expect(inside(t.rect, b.rect), `${i.arch} ${b.id}`).toBe(true);
        }
        for (const t of l.lit) {
          expect(inside(t.rect, b.rect), `${i.arch} ${b.id} lit`).toBe(true);
        }
      }
    }
  });

  it('the PC shows eight hex digits and a fetch block one word per lane it reads', () => {
    const plan = cpuPlan(must(INPUTS[3]));
    const pc = must(plan.blocks.find((b) => b.kind === 'pc')),
      fetch = must(plan.blocks.find((b) => b.kind === 'fetch'));
    const pcArea = must(glyphArea(pc)),
      fetchArea = must(glyphArea(fetch));
    expect(
      glyphLive(pc, pcArea, [], 0x1a_bc)
        .texts.map((t) => t.top)
        .join(''),
    ).toBe('00001abc');
    expect(slotsOf(fetch, fetchArea).words).toHaveLength(4);
  });

  it('the decoder raises the lines an instruction needs', () => {
    expect(on('add')).toStrictEqual(['alu', 'wr']);
    expect(on('addi')).toStrictEqual(['alu', 'wr', 'imm']);
    expect(on('lw')).toStrictEqual(['mem', 'wr', 'imm']);
    expect(on('sw')).toStrictEqual(['mem', 'imm']);
    expect(on('bne')).toStrictEqual(['br']);
    expect(on('ecall')).toStrictEqual(['sys']);
  });

  it('every symbol has its pins inside its block, and a link into it ends on the right one', () => {
    for (const i of INPUTS) {
      const plan = cpuPlan(i);
      for (const b of pinnedSymbols(plan)) {
        const pins = must(glyphPins(b));
        expect(pins, `${i.arch} ${b.id}`).not.toBeNull();
        for (const p of allPins(pins)) {
          expect(p[0], `block ${b.id}`).toBeGreaterThanOrEqual(b.rect.x);
          expect(p[0], `block ${b.id}`).toBeLessThanOrEqual(b.rect.x + b.rect.w);
          expect(p[1], `block ${b.id}`).toBeGreaterThanOrEqual(b.rect.y);
          expect(p[1], `block ${b.id}`).toBeLessThanOrEqual(b.rect.y + b.rect.h);
        }
      }
      for (const { l, to, pins } of linksIntoPins(plan)) {
        const pin = must(inPinFor(to, l.id, pins));
        expect(l.pts.at(-1), `${i.arch} ${l.id} into ${to.id}`).toStrictEqual(pin);
      }
    }
  });

  it('the next-PC multiplexer takes the +4, the branch redirect and the interrupt vector on three different pins', () => {
    const plan = cpuPlan(must(INPUTS[3]));
    const npc = must(plan.blocks.find((b) => b.kind === 'nextpc')),
      pins = must(glyphPins(npc));
    expect(inPinFor(npc, 'pcadd-npc', pins)).toStrictEqual(pins.ins['+4']);
    expect(inPinFor(npc, 'br-npc', pins)).toStrictEqual(pins.ins['br']);
    expect(inPinFor(npc, 'irq-pc', pins)).toStrictEqual(pins.ins['irq']);
    expect(new Set([must(pins.ins['+4'])[1], must(pins.ins['br'])[1], must(pins.ins['irq'])[1]]).size).toBe(3);
    // a link docks: it runs on from the block's edge to the pin without a diagonal
    const d = dockLink(npc, npc, 'br-npc', [
      [npc.rect.x, npc.rect.y + 20],
      [npc.rect.x - 30, npc.rect.y + 20],
    ]);
    expect(square(d)).toBe(true);
  });

  it('every CPU the game ships draws every symbol, docks every link into a pin or an edge, and fills its decoders', () => {
    const cpus = specsOfKind('cpu');
    expect(cpus.length).toBeGreaterThanOrEqual(10);
    for (const spec of cpus) {
      const plan = specPlan(spec);
      const symbols = plan.blocks.filter((b) => hasSymbol(b));
      expect(symbols.length, `spec ${spec.id}`).toBeGreaterThan(8);
      for (const b of symbols) {
        expect(glyphArea(b), `${spec.id} ${b.id}`).not.toBeNull();
        const texts: string[] = [];
        expect(() => {
          glyph(new Graphics(), DARK, b, must(glyphArea(b)), '#0af', (t) => {
            texts.push(t);
          });
        }).not.toThrow();
        const live = glyphLive(
          b,
          must(glyphArea(b)),
          [{ op: 'add', text: 'add t4, t1, t2', pc: 0x10_00, word: 0x00_a0_10_83 }],
          0x10_00,
          [1],
        );
        for (const t of live.texts) {
          expect(t.rect.x + t.rect.w, `${spec.id} ${b.id}`).toBeLessThanOrEqual(b.rect.x + b.rect.w + 4);
        }
      }
      // a decoder never falls back to a field of cells: wide or in a column it is a symbol
      for (const b of plan.blocks.filter((x) => x.kind === 'decode')) {
        expect(hasSymbol(b), `${spec.id} ${b.id}`).toBe(true);
      }
      for (const { l, to, pins } of linksIntoPins(plan)) {
        expect(l.pts.at(-1), `${spec.id} ${l.id}`).toStrictEqual(inPinFor(to, l.id, pins));
      }
      for (const { l, from, out } of linksOutOfPins(plan)) {
        expect(l.pts[0], `${spec.id} ${l.id} from ${from.id}`).toStrictEqual(out);
      }
    }
  });

  it('the hazard lamp lights for a waiting instruction and the forwarding multiplexer for the operand that is forwarded', () => {
    const plan = cpuPlan(must(INPUTS[2]));
    const hz = must(plan.blocks.find((b) => b.kind === 'hazard')),
      fw = must(plan.blocks.find((b) => b.kind === 'forward'));
    const item = { op: 'add', text: 'add t0, t1, t2', pc: 0x10_00, word: 1 };
    const hzArea = must(glyphArea(hz)),
      fwArea = must(glyphArea(fw));
    expect(glyphLive(hz, hzArea, [], undefined, []).lit).toHaveLength(0);
    expect(glyphLive(hz, hzArea, [item]).lit).toHaveLength(1);
    expect(glyphLive(fw, fwArea, [{ ...item, flags: 0 }]).lit).toHaveLength(0);
    expect(glyphLive(fw, fwArea, [{ ...item, flags: 2 }]).lit).toHaveLength(1); // operand B only
    expect(glyphLive(fw, fwArea, [{ ...item, flags: 3 }]).lit).toHaveLength(2);
  });
});
