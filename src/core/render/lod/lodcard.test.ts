import { assert, describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { cardCandidates, cardText } from './lodcard';
import { RectCache } from './lodrect';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A card `w` wide at (x, y). */
const node = (x: number, y: number, w = 100): Container => {
  const card: unknown = { x, y, getLocalBounds: () => ({ x: 0, y: 0, width: w, height: 100 }) };
  assert(isContainer(card));
  return card;
};
/** A container as far as the card places read one: where it is and its bounds. */
function isContainer(v: unknown): v is Container {
  return typeof v === 'object' && v !== null && 'getLocalBounds' in v;
}
const view = { x: 0, y: 0, w: 4000, h: 3000 };
/** The budget's say: the view, and the cards that hold a top slot. */
const lod = (ids: string[]) => ({ view, top: new Set(ids) });

describe('cardCandidates', () => {
  const cards = [
    { slot: 'a', root: node(1950, 1450) },
    { slot: 'b', root: node(50_000, 5000) },
  ];
  it('lists only cards in view, with their id', () => {
    const out = cardCandidates('gpu', cards, new RectCache(), view, 1.6, 1.5);
    expect(out.map((c) => c.id)).toStrictEqual(['gpu:a']);
    expect(must(out[0]).focus).toBeGreaterThan(0.9);
  });
  it('lists none below the detail zoom', () => {
    expect(cardCandidates('gpu', cards, new RectCache(), view, 1, 1.5)).toStrictEqual([]);
  });
  it('does not care how big a card is: only the zoom and its distance from the centre', () => {
    const small = [{ slot: 's', root: node(1950, 1450, 100) }],
      wide = [{ slot: 'w', root: node(1000, 1450, 2000) }];
    for (const z of [1, 1.6]) {
      expect(cardCandidates('gpu', small, new RectCache(), view, z, 1.5)).toHaveLength(
        cardCandidates('gpu', wide, new RectCache(), view, z, 1.5).length,
      );
    }
  });
});

describe('distance from the centre', () => {
  it('a card at the edge reaches the detail stage later than one at the centre', () => {
    const near = [{ slot: 'a', root: node(1950, 1450) }],
      far = [{ slot: 'b', root: node(3800, 2900) }];
    expect(cardCandidates('gpu', near, new RectCache(), view, 1.6, 1.5)).toHaveLength(1);
    expect(cardCandidates('gpu', far, new RectCache(), view, 1.6, 1.5)).toHaveLength(0);
    expect(cardCandidates('gpu', far, new RectCache(), view, 5, 1.5)).toHaveLength(1);
  });
});

describe('cardText', () => {
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
    expect([t.showText, t.showDetail]).toStrictEqual([false, false]);
  });
});
