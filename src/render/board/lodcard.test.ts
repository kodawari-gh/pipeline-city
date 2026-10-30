import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { cardCandidates, cardText } from './lodcard';
import { RectCache } from './lodrect';

const node = (x: number, y: number): Container => ({ x, y, getLocalBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }) }) as unknown as Container;
const view = { x: 0, y: 0, w: 1000, h: 1000 };

describe('cardCandidates', () => {
  const cards = [{ slot: 'a', root: node(450, 450) }, { slot: 'b', root: node(5000, 5000) }];
  it('lists only cards in view, with their id', () => {
    const out = cardCandidates('gpu', cards, new RectCache(), view, 1, 0.6);
    expect(out.map((c) => c.id)).toEqual(['gpu:a']);
    expect(out[0]!.focus).toBeGreaterThan(0.9);
  });
  it('lists none below the detail zoom', () => {
    expect(cardCandidates('gpu', cards, new RectCache(), view, 0.5, 0.6)).toEqual([]);
  });
});

describe('cardText', () => {
  const lod = (ids: string[]) => ({ view, top: new Set(ids) });
  it('shows the counters without a budget', () => {
    expect(cardText(2, undefined, 'npu:a', 0.75, 1.5).showDetail).toBe(true);
  });
  it('drops the counters of a card without a slot, keeps its names', () => {
    const t = cardText(2, lod([]), 'npu:a', 0.75, 1.5);
    expect(t.showText).toBe(true);
    expect(t.showDetail).toBe(false);
    expect(t.da).toBe(0);
  });
  it('shows the counters of a card with a slot', () => {
    expect(cardText(2, lod(['npu:a']), 'npu:a', 0.75, 1.5).showDetail).toBe(true);
  });
  it('hides both below their zooms', () => {
    const t = cardText(0.1, undefined, 'npu:a', 0.75, 1.5);
    expect(t.showText || t.showDetail).toBe(false);
  });
});
