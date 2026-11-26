import { assert, describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { specsOfKind } from '../../board/sim/specs';
import type { Theme } from '@/core/render/theme';
import { gpuEncode, gpuInstr, GPU_OPS } from '../sim/isa/isa';
import {
  ALU_UNITS,
  aluUnitOf,
  decodeGeom,
  fetchGeom,
  gpuControlIndices,
  gpuControlLines,
  gpuGlyph,
  gpuGlyphArea,
  gpuGlyphLive,
  gpuSlotValues,
  GPU_GLYPH_KINDS,
  gpuHostLive,
  hasGpuSymbol,
  laneUnits,
  launchGeom,
  pcArea,
  pcieGeom,
} from './glyph';
import * as gpuplan from './plan/gpuplan';
import { cellInset, gpuCells, gpuPlan } from './plan/gpuplans';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const T: Theme = {
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
/** How many drawing instructions a graphics object holds. */
const instr = (g: unknown): number => {
  assert.instanceOf(g, Graphics);
  return g.context.instructions.length;
};

type Area = NonNullable<ReturnType<typeof gpuGlyphArea>>;

/** Whether `r` lies inside the area `a`, give or take half a pixel. */
const inside = (r: { x: number; y: number; w: number; h: number }, a: Area): boolean =>
  r.x >= a.x - 0.5 && r.y >= a.y - 0.5 && r.x + r.w <= a.x + a.w + 0.5 && r.y + r.h <= a.y + a.h + 0.5;

const PLANS = specsOfKind('gpu').map((s) => ({ id: s.id, plan: gpuPlan(gpuplan.gpuPlanInput(must(s.gpu))) }));

/** Every block of every tier, with the tier it is on. */
const BLOCKS = PLANS.flatMap(({ id, plan }) => plan.blocks.map((b) => ({ id, b })));

/** The blocks of the given kinds, with their symbol areas. */
const blocksOf = (...kinds: gpuplan.GpuBlockKind[]) =>
  BLOCKS.filter(({ b }) => kinds.includes(b.kind)).map(({ id, b }) => ({ id, b, a: must(gpuGlyphArea(b)) }));

/** The parts of a decoder that must stay inside its area: the word, the fields and the lines, and a roomy one's selects and control. */
function decodeParts(d: ReturnType<typeof decodeGeom>) {
  const parts = [d.word, ...d.fields, ...d.lines];
  if (d.rich) {
    parts.push(...d.sel, d.ctl, d.sext);
  }
  return parts;
}

/** Whether a plan has a register file with an inset under its cells. */
const hasInsetRegfile = (plan: gpuplan.GpuPlan): boolean =>
  plan.blocks.some((x) => x.kind === 'regfile' && cellInset(x).b > 0);

/** The host link state of a launch of 16 lanes in `phase`. */
const hostAt = (phase: 'idle' | 'in' | 'run' | 'out') => ({ phase, lanes: 16, launches: 1, ms: 1000 });

// The symbols inside the card's blocks (docs/DIE.md "Inside the blocks"): every kind of a plan has one, it fits its block and draws something.
describe('gpu block symbols', () => {
  it('every block kind of every tier has a symbol but the SM frame, drawn into its block', () => {
    for (const { id, b } of BLOCKS) {
      expect(hasGpuSymbol(b), `${id} ${b.id}`).toBe(b.kind !== 'sm');
    }
    for (const { b } of BLOCKS.filter((x) => x.b.kind === 'sm')) {
      expect(gpuGlyphArea(b)).toBeNull();
    }
    for (const { id, b } of BLOCKS.filter((x) => x.b.kind !== 'sm')) {
      const a = gpuGlyphArea(b);
      expect(a, `${id} ${b.id}`).not.toBeNull();
      expect(must(a).x).toBeGreaterThanOrEqual(b.rect.x);
      expect(must(a).y + must(a).h).toBeLessThanOrEqual(b.rect.y + b.rect.h);
      const g = new Graphics(),
        texts: string[] = [];
      expect(() => {
        gpuGlyph(g, b, {
          T,
          c: '#0af',
          put: (t) => {
            texts.push(t);
          },
        });
      }).not.toThrow();
      expect(instr(g), `${id} ${b.id}`).toBeGreaterThan(0);
    }
    const seen = new Set<string>(BLOCKS.map(({ b }) => b.kind));
    for (const k of Object.keys(GPU_GLYPH_KINDS)) {
      expect(seen.has(k), `kind ${k}`).toBe(true);
    }
  });

  it('a block too small for a symbol draws nothing', () => {
    const b: gpuplan.GpuBlock = { id: 'x', kind: 'lanes', label: 'L', rect: { x: 0, y: 0, w: 12, h: 20 } };
    expect(gpuGlyphArea(b)).toBeNull();
    const g = new Graphics();
    gpuGlyph(g, b, {
      T,
      c: '#0af',
      put: () => {
        // a block too small has no text to put
      },
    });
    expect(instr(g)).toBe(0);
  });

  it('an instruction raises the control lines it needs', () => {
    const aluLines = [...gpuControlLines({ name: 'vaddi', kind: 'alu', dest: 2 })],
      ldLines = [...gpuControlLines({ name: 'vld', kind: 'ld', dest: 3 })];
    expect(aluLines.toSorted()).toStrictEqual(['alu', 'imm', 'wr']);
    expect(ldLines.toSorted()).toStrictEqual(['imm', 'mem', 'wr']);
    expect([...gpuControlLines({ name: 'halt', kind: 'sys', dest: null })]).toStrictEqual(['sys']);
    expect(gpuControlIndices({ name: 'vld', kind: 'ld', dest: 3 })).toStrictEqual([1, 2, 4]);
  });

  it('the decoder splits a GPU word into its slots, and the shared symbols light for the instruction on show', () => {
    const word = gpuEncode(gpuInstr('vaddi', { rd: 2, rs1: 1, imm: 7 }));
    expect(gpuSlotValues(word)).toStrictEqual(['vaddi', 'v2', 'v1', '', '7']);
    const vadd = gpuEncode(gpuInstr('vadd', { rd: 3, rs1: 1, rs2: 2 }));
    expect(gpuSlotValues(vadd)).toStrictEqual(['vadd', 'v3', 'v1', 'v2', '']);
    const step = { pc: 0x2c, name: 'vaddi', kind: 'alu' as const, mask: 0xff, cost: 1, banks: null, dest: 2, word };
    const dec: gpuplan.GpuBlock = {
      id: 'decode',
      kind: 'decode',
      label: 'DECODE',
      rect: { x: 100, y: 50, w: 400, h: 150 },
    };
    const decArea = must(gpuGlyphArea(dec));
    const live = gpuGlyphLive(dec, decArea, { step });
    expect(live.lit.length).toBeGreaterThan(1 + 2); // the word and the lines raised
    expect(live.texts.map((t) => t.top)).toStrictEqual(['vaddi', 'v2', 'v1', '7']);
    // the word wipes in: at the start no text yet, only the bar
    expect(gpuGlyphLive(dec, decArea, { step, prog: 0.2 }).texts).toStrictEqual([]);
    const pc: gpuplan.GpuBlock = { id: 'pc', kind: 'pc', label: 'PC', rect: { x: 0, y: 0, w: 300, h: 80 } };
    const pcTexts = gpuGlyphLive(pc, must(gpuGlyphArea(pc)), { step }).texts;
    expect(pcTexts.map((t) => t.top).join('')).toBe('0000002c');
    const fetch: gpuplan.GpuBlock = {
      id: 'fetch',
      kind: 'fetch',
      label: 'FETCH',
      rect: { x: 0, y: 0, w: 300, h: 80 },
    };
    const fetchTexts = gpuGlyphLive(fetch, must(gpuGlyphArea(fetch)), { step }).texts;
    expect(must(fetchTexts[0]).top).toBe('vaddi v2, v1, 7');
    expect(gpuGlyphLive(dec, decArea, { step: null })).toStrictEqual({ texts: [], lit: [] });
  });

  it('the decoder, the fetch and the program counter keep their live slots inside their area, on every tier', () => {
    for (const { id, a } of blocksOf('pc')) {
      expect(pcArea(a).h, `${id} pc`).toBeLessThanOrEqual(22);
    }
    for (const { id, b, a } of blocksOf('fetch')) {
      const f = fetchGeom(a);
      expect(f.rows.length, `${id} ${b.id}`).toBeGreaterThan(0);
      for (const r of f.rows) {
        expect(inside(r, a), `${id} ${b.id} row`).toBe(true);
      }
    }
    for (const { id, b, a } of blocksOf('decode')) {
      const d = decodeGeom(a);
      expect(d.lines, `${id} decode`).toHaveLength(6);
      for (const r of decodeParts(d)) {
        expect(inside(r, a), `${id} ${b.id}`).toBe(true);
      }
    }
    for (const { id, a } of blocksOf('decode').filter((x) => decodeGeom(x.a).rich)) {
      const d = decodeGeom(a);
      expect(must(d.lines[0]).y, `${id} decode lines`).toBeGreaterThan(must(d.sel[0]).y + must(d.sel[0]).h);
    }
  });

  it('a roomy lane cell opens up into the units of its ALU, inside the cell, and every ALU op goes through one of them', () => {
    const cell = { x: 10, y: 20, w: 155, h: 130 },
      u = must(laneUnits(cell));
    expect(u.units).toHaveLength(ALU_UNITS.length);
    for (const [k, r] of u.units.entries()) {
      expect(r.x, `unit ${k}`).toBeGreaterThan(u.busX);
      expect(r.x + r.w, `unit ${k}`).toBeLessThan(u.mux.x);
      expect(r.y).toBeGreaterThanOrEqual(cell.y);
      expect(r.y + r.h).toBeLessThanOrEqual(cell.y + cell.h);
    }
    for (const [k, r] of u.units.slice(1).entries()) {
      const above = must(u.units[k]);
      expect(r.y, `unit ${k + 1}`).toBeGreaterThanOrEqual(above.y + above.h);
    }
    expect(u.res.x + u.res.w).toBeLessThanOrEqual(cell.x + cell.w);
    expect(laneUnits({ x: 0, y: 0, w: 38, h: 22 })).toBeNull();
    const control = new Set(['mpush', 'mpop', 'melse', 'bar', 'bany', 'jmp', 'halt']);
    for (const o of GPU_OPS) {
      expect(aluUnitOf(o.name) >= 0, `op ${o.name}`).toBe(!control.has(o.name));
    }
    expect([
      aluUnitOf('vadd'),
      aluUnitOf('vandi'),
      aluUnitOf('vsrai'),
      aluUnitOf('msetlt'),
      aluUnitOf('vmul'),
      aluUnitOf('vmin'),
    ]).toStrictEqual([0, 1, 2, 3, 4, 5]);
  });

  it('the register file and the caches keep their cells beside their decoder and under their latches or compare, inside the symbol area', () => {
    const celled = blocksOf('regfile', 'l1', 'l2');
    for (const { id, b, a } of celled) {
      const ins = cellInset(b),
        cells = gpuCells(b);
      expect(cells).toHaveLength(must(b.grid).count);
      for (const c of cells) {
        expect(c.x, `${id} ${b.id}`).toBeGreaterThanOrEqual(a.x + ins.l - 0.5);
        expect(c.x + c.w, `${id} ${b.id}`).toBeLessThanOrEqual(a.x + a.w + 0.5);
        expect(c.y + c.h, `${id} ${b.id}`).toBeLessThanOrEqual(a.y + a.h - ins.b + 0.5);
      }
    }
    expect(celled.length).toBeGreaterThan(4);
    expect(PLANS.some(({ plan }) => hasInsetRegfile(plan))).toBe(true);
  });

  it('the host link and the launch registers keep their parts inside their area, on every tier', () => {
    for (const { id, b, a } of blocksOf('pcie')) {
      const q = pcieGeom(a);
      for (const r of [q.dma, ...q.credits, ...q.lanes.flatMap((l) => [l.rx, l.tx])]) {
        expect(inside(r, a), `${id} ${b.id}`).toBe(true);
      }
    }
    for (const { id, b, a } of blocksOf('launch')) {
      const l = launchGeom(a);
      for (const r of [l.go, ...l.regs, ...l.states, ...l.slots]) {
        expect(inside(r, a), `${id} ${b.id}`).toBe(true);
      }
    }
  });

  it('a launch moves the link and the launch registers: in on the receive cells, out on the transmit cells, run at the run state; idle shows nothing', () => {
    const a = { x: 0, y: 0, w: 200, h: 131 };
    const q = pcieGeom(a),
      l = launchGeom(a);
    expect(gpuHostLive('pcie', a, hostAt('idle'))).toStrictEqual({ texts: [], lit: [] });
    expect(gpuHostLive('launch', a, hostAt('idle'))).toStrictEqual({ texts: [], lit: [] });
    const lit = (kind: 'pcie' | 'launch', phase: 'in' | 'run' | 'out') =>
      gpuHostLive(kind, a, hostAt(phase)).lit.map((x) => x.rect);
    const lane0 = must(q.lanes[0]);
    expect(lit('pcie', 'in')).toContainEqual(lane0.rx);
    expect(lit('pcie', 'in')).not.toContainEqual(lane0.tx);
    expect(lit('pcie', 'out')).toContainEqual(lane0.tx);
    expect(lit('pcie', 'run')).toContainEqual(q.dma);
    expect(lit('launch', 'run')).toContainEqual(l.go);
    expect(lit('launch', 'run')).toContainEqual(must(l.states[1]));
    expect(lit('launch', 'out')).toContainEqual(must(l.states[2]));
    expect(gpuHostLive('launch', a, hostAt('run')).texts.map((t) => t.top)).toStrictEqual(['0x0000', '16', 'busy']);
    // the receive cells flow: the same lane is brighter at one moment than another
    const at = (ms: number) => must(gpuHostLive('pcie', a, { ...hostAt('in'), ms }).lit[0]).a;
    expect(new Set([0, 90, 180, 270].map((ms) => at(ms))).size).toBeGreaterThan(1);
  });

  it('a wide fetch keeps a side panel for the address, clear of its word rows', () => {
    const wide = fetchGeom({ x: 0, y: 0, w: 419, h: 59 }),
      narrow = fetchGeom({ x: 0, y: 0, w: 233, h: 116 });
    expect(wide.side).not.toBeNull();
    for (const r of wide.rows) {
      expect(r.x + r.w).toBeLessThanOrEqual(must(wide.side).x);
    }
    expect(must(wide.side).x + must(wide.side).w).toBeLessThanOrEqual(419);
    expect(narrow.side).toBeNull();
  });

  it('the decoder of a roomy block fans its fields out: units under the fields, the control lines under a bus', () => {
    const d = decodeGeom({ x: 0, y: 0, w: 220, h: 80 });
    expect(d.rich).toBe(true);
    expect(d.sel).toHaveLength(3);
    expect(d.busY).toBeGreaterThan(must(d.sel[0]).y + must(d.sel[0]).h);
    expect(d.busY).toBeLessThan(must(d.lines[0]).y);
    expect(decodeGeom({ x: 0, y: 0, w: 220, h: 30 }).rich).toBe(false);
  });
});
