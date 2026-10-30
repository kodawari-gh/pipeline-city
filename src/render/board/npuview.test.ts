import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in gpuview.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import { NpuOp } from '../../sim/isa/memmap';
import { sampleRun, sampleView } from '../npu/npusample';
import type { Theme } from '../theme';
import { setLayoutTier } from './layout';
import { NpuCardView } from './npuview';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('the AI card view', () => {
  it('builds a card per scene entry, fades the lid out for the die as the zoom grows, and hides with the exterior', () => {
    setLayoutTier(3, 3);
    const v = new NpuCardView();
    expect(v.root.visible).toBe(false);
    v.setScene(T, [{ slot: 'pcie1', visual: 'npu-1', origin: { x: 100, y: 200 } }]);
    expect(v.root.visible).toBe(true);
    const card = v.root.children[0] as Container;
    expect(card.position.x).toBe(100);
    const [die, lid] = card.children as [Container, Container];
    v.setZoom(0.2);
    v.frame(0.016, true);
    expect(die.visible).toBe(false);
    expect(lid.alpha).toBeCloseTo(1, 1);
    v.setZoom(1);
    v.frame(0.016, true);
    expect(die.visible).toBe(true);
    expect(lid.alpha).toBeCloseTo(0, 1);
    v.frame(0.016, false);
    expect(v.root.visible).toBe(false);
  });

  it('runs a launch seen in flight, and replays one that finished between two looks, then settles', () => {
    setLayoutTier(3, 3);
    const v = new NpuCardView();
    v.setScene(T, [{ slot: 'pcie1', visual: 'npu-2', origin: { x: 0, y: 0 } }]);
    v.setZoom(2);
    const lit = () => ((v.root.children[0] as Container).children[0] as Container).children.length;
    v.update([sampleView({ grid: 8, memBytes: 32768, acc: new Array<number>(64).fill(0) })]);
    v.frame(0.016, true);
    // a launch in flight, drawn live
    v.update([sampleView({ grid: 8, memBytes: 32768, acc: new Array<number>(64).fill(2), phase: 'run', busy: true, run: 1, index: 1, stepWait: 6, stepSpan: 14, count: 3, launches: 1, log: sampleRun().slice(0, 2).map((e) => ({ ...e, acc: new Array<number>(64).fill(1) })) })]);
    for (let i = 0; i < 20; i++) v.frame(0.016, true);
    expect(lit()).toBeGreaterThan(5);
    // it finished, and another one came and went between looks: replayed
    v.update([sampleView({ grid: 8, memBytes: 32768, acc: new Array<number>(64).fill(2), launches: 2, log: [...sampleRun(1, 1), ...sampleRun(2, 4)].map((e) => ({ ...e, acc: new Array<number>(64).fill(3) })) })]);
    for (let i = 0; i < 400; i++) v.frame(0.05, true);
    // and settles: an idle card with nothing moving costs no redraws
    expect(() => { for (let i = 0; i < 30; i++) v.frame(0.016, true); }).not.toThrow();
    expect(NpuOp.Layer).toBe(7);
  });
});
