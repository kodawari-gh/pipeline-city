import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in gpuview.test.ts).
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import { NpuOp } from '@/core/sim/memmap';
import { sampleRun, sampleView } from './npusample';
import type { Theme } from '@/core/render/theme';
import { setLayoutTier } from '../../board/render/layout';
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

  it('shows the CPU reaching into the card: a packet on the wire it takes, one per kind of access at a time, gone when the touch fades', () => {
    setLayoutTier(3, 3);
    const v = new NpuCardView();
    v.setScene(T, [{ slot: 'pcie1', visual: 'npu-1', origin: { x: 0, y: 0 } }]);
    v.setZoom(1);
    v.update([sampleView({})]);
    v.frame(0.016, true);
    const packets = () => (v as unknown as { cards: { packets: unknown[]; touch: unknown }[] }).cards[0]!.packets.length;
    const touched = () => (v as unknown as { cards: { touch: unknown }[] }).cards[0]!.touch !== null;
    v.touch('pcie9', true, 0x1000); // not a card of the scene
    expect(touched()).toBe(false);
    v.touch('pcie1', true, 0x1000); // a word copied in
    expect(touched()).toBe(true);
    expect(packets()).toBe(1);
    v.touch('pcie1', true, 0x1004); // the next word of the copy: the same stretch, no new packet this soon
    expect(packets()).toBe(1);
    v.touch('pcie1', false, 0x10); // STATUS polled: another wire
    expect(packets()).toBe(2);
    for (let i = 0; i < 100; i++) v.frame(0.05, true);
    expect(touched()).toBe(false);
    expect(packets()).toBe(0);
  });
});
