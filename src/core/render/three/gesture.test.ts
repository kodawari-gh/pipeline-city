import { describe, expect, it } from 'vitest';
import { LOCK_PX, TURN, turnOf, twoMove, twoStart, wheelZoom } from './gesture';
import type * as gestureTypes from './gesture';

describe('wheelZoom', () => {
  it('goes out for a wheel down and in for a wheel up', () => {
    expect(wheelZoom({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelZoom({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
  });
  it('counts a wheel that reports lines or pages in pixels', () => {
    const px = wheelZoom({ deltaY: 40, deltaMode: 0, ctrlKey: false });
    expect(wheelZoom({ deltaY: 1, deltaMode: 1, ctrlKey: false })).toBeCloseTo(px, 10);
  });
  it('caps one event, so a fast wheel never jumps the whole way', () => {
    const k = wheelZoom({ deltaY: 100_000, deltaMode: 0, ctrlKey: false });
    expect(k).toBeCloseTo(Math.exp(300 * 0.0018), 10);
    expect(wheelZoom({ deltaY: 5000, deltaMode: 2, ctrlKey: false })).toBe(k);
  });
  it('takes a trackpad pinch (ctrl held) in finer steps with a stronger effect per pixel', () => {
    expect(Math.log(wheelZoom({ deltaY: 10, deltaMode: 0, ctrlKey: true }))).toBeGreaterThan(
      Math.log(wheelZoom({ deltaY: 10, deltaMode: 0, ctrlKey: false })),
    );
  });
});

describe('turnOf', () => {
  it('turns by the same share of the stage whatever its size', () => {
    const a = turnOf(100, 50, 500),
      b = turnOf(200, 100, 1000);
    expect(a.yaw).toBeCloseTo(b.yaw, 10);
    expect(a.pitch).toBeCloseTo(b.pitch, 10);
    expect(a.yaw).toBeCloseTo(-(100 / 500) * TURN, 10);
    expect(a.pitch).toBeCloseTo((50 / 500) * TURN, 10);
  });
  it('does not divide by nothing', () => {
    expect(Number.isFinite(turnOf(10, 10, 0).yaw)).toBe(true);
  });
});

const A = { x: 100, y: 200 },
  B = { x: 200, y: 200 };

describe('two fingers', () => {
  it('wait until they have travelled before they mean anything', () => {
    const { two, move } = twoMove(twoStart(A, B), { x: 101, y: 200 }, { x: 201, y: 201 });
    expect(move.kind).toBeNull();
    expect(move.zoom).toBe(1);
    expect(two.kind).toBeNull();
    expect(LOCK_PX).toBeGreaterThan(1);
  });

  it('spread is a pinch: the fingers closing zoom in, by the share of their span', () => {
    const { move } = twoMove(twoStart(A, B), { x: 50, y: 200 }, { x: 250, y: 200 });
    expect(move.kind).toBe('pinch');
    expect(move.zoom).toBeCloseTo(0.5, 10); // the span doubled: the height shown halves
    expect(move.dx).toBeCloseTo(0, 10);
    expect(move.twist).toBeCloseTo(0, 10);
    expect(move.at).toStrictEqual({ x: 150, y: 200 }); // about where they were
    const back = twoMove(twoStart(A, B), { x: 125, y: 200 }, { x: 175, y: 200 });
    expect(back.move.zoom).toBeCloseTo(2, 10);
  });

  it('moving together is a swipe: the whole travel since they went down, no zoom', () => {
    const { two, move } = twoMove(twoStart(A, B), { x: 100, y: 260 }, { x: 200, y: 260 });
    expect(move.kind).toBe('swipe');
    expect(move.dy).toBeCloseTo(60, 10);
    expect(move.dx).toBeCloseTo(0, 10);
    expect(move.zoom).toBe(1);
    // a swipe stays one: the span drifting a little is a hand's tremor, not a zoom
    const next = twoMove(two, { x: 100, y: 270 }, { x: 220, y: 270 });
    expect(next.move.kind).toBe('swipe');
    expect(next.move.zoom).toBe(1);
    expect(next.move.dy).toBeCloseTo(10, 10);
    expect(next.move.twist).toBe(0);
  });

  it('a pinch stays one and carries the middle along with the twist', () => {
    const { two } = twoMove(twoStart(A, B), { x: 50, y: 200 }, { x: 250, y: 200 });
    const next = twoMove(two, { x: 60, y: 210 }, { x: 260, y: 210 });
    expect(next.move.kind).toBe('pinch');
    expect(next.move.zoom).toBeCloseTo(1, 10);
    expect(next.move.dx).toBeCloseTo(10, 10);
    expect(next.move.dy).toBeCloseTo(10, 10);
  });

  it('turning the fingers about their middle is a twist (clockwise on the screen positive), no zoom', () => {
    const { move } = twoMove(twoStart(A, B), { x: 150, y: 150 }, { x: 150, y: 250 });
    expect(move.kind).toBe('pinch');
    expect(move.twist).toBeCloseTo(Math.PI / 2, 10);
    expect(move.zoom).toBeCloseTo(1, 10);
  });

  it('takes the short way round for a twist across the half turn', () => {
    const s: gestureTypes.Two = {
      a0: { x: 200, y: 200 },
      b0: { x: 100, y: 201 },
      kind: 'pinch',
      a: { x: 200, y: 200 },
      b: { x: 100, y: 201 },
      na: 4,
      nb: 4,
    };
    const { move } = twoMove(s, { x: 200, y: 200 }, { x: 100, y: 199 });
    expect(Math.abs(move.twist)).toBeLessThan(0.05);
  });

  it("hear both fingers before they decide: a fast swipe's first finger alone is no pinch", () => {
    // (the events come one finger at a time: finger 1 has gone 60 px down, finger 2's event is still to come)
    const first = twoMove(twoStart(A, B), { x: 100, y: 260 }, B, 0);
    expect(first.move.kind).toBeNull();
    const both = twoMove(first.two, { x: 100, y: 260 }, { x: 200, y: 260 }, 1);
    expect(both.move.kind).toBe('swipe');
    expect(both.move.dy).toBeCloseTo(60, 10);
  });

  it('a finger at rest while the other goes round it is a pinch, once the mover has been heard enough', () => {
    let s = twoStart(A, B);
    const kinds: (string | null)[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = twoMove(s, A, { x: 200 + 4 * i, y: 200 }, 1);
      s = r.two;
      kinds.push(r.move.kind);
    }
    expect(kinds.slice(0, 2)).toStrictEqual([null, null]); // (its travel is under the lock, or the other finger is not heard)
    expect(kinds.at(-1)).toBe('pinch');
  });

  it('does not divide by a span of nothing', () => {
    const { move } = twoMove(twoStart(A, A), { x: 100, y: 200 }, { x: 160, y: 200 });
    expect(Number.isFinite(move.zoom)).toBe(true);
  });
});
