import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { REF_SIZE } from '../lod';
import { cardCandidates, cardText } from './lodcard';
import { RectCache } from './lodrect';

/** A card `w` wide at (x, y). */
const node = (x: number, y: number, w = REF_SIZE): Container => ({ x, y, getLocalBounds: () => ({ x: 0, y: 0, width: w, height: 100 }) }) as unknown as Container;
const view = { x: 0, y: 0, w: 4000, h: 3000 };

describe('cardCandidates', () => {
  const cards = [{ slot: 'a', root: node(1300, 1400) }, { slot: 'b', root: node(50000, 5000) }];
  it('lists only cards in view, with their id', () => {
    const out = cardCandidates('gpu', cards, new RectCache(), view, 1.6, 1.5);
    expect(out.map((c) => c.id)).toEqual(['gpu:a']);
    expect(out[0]!.focus).toBeGreaterThan(0.9);
  });
  it('lists none below the detail zoom', () => {
    expect(cardCandidates('gpu', cards, new RectCache(), view, 1, 1.5)).toEqual([]);
  });
});

describe('the same ladder for every size', () => {
  it('a card twice as wide reaches the detail stage at half the camera zoom', () => {
    const wide = [{ slot: 'w', root: node(1000, 1400, 2 * REF_SIZE) }], base = [{ slot: 'b', root: node(1300, 1400) }];
    expect(cardCandidates('gpu', wide, new RectCache(), view, 0.8, 1.5)).toHaveLength(1);
    expect(cardCandidates('gpu', base, new RectCache(), view, 0.8, 1.5)).toHaveLength(0);
    expect(cardCandidates('gpu', base, new RectCache(), view, 1.6, 1.5)).toHaveLength(1);
  });
});

describe('distance from the centre', () => {
  it('a card at the edge reaches the detail stage later than one at the centre', () => {
    const near = [{ slot: 'a', root: node(1300, 1400) }], far = [{ slot: 'b', root: node(3800, 2900) }];
    expect(cardCandidates('gpu', near, new RectCache(), view, 1.6, 1.5)).toHaveLength(1);
    expect(cardCandidates('gpu', far, new RectCache(), view, 1.6, 1.5)).toHaveLength(0);
    expect(cardCandidates('gpu', far, new RectCache(), view, 5, 1.5)).toHaveLength(1);
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
