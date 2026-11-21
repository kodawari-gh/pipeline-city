import { describe, expect, it } from 'vitest';
import { BusFlow, FADE_MS, MAX_LIT, MAX_MS, MIN_MS, slice } from './busflow';
import { mkLane } from './routes';

const lane = mkLane([[0, 0], [100, 0], [100, 100]]);
const length = (pts: number[][]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0]! - pts[i - 1]![0]!, p[1]! - pts[i - 1]![1]!) : 0), 0);

describe('slice', () => {
  it('cuts a lane between two arc lengths, round a corner', () => {
    expect(slice(lane, 0, 100)).toEqual([[0, 0], [100, 0]]);
    expect(slice(lane, 50, 150)).toEqual([[50, 0], [100, 0], [100, 50]]);
    expect(length(slice(lane, 30, 170))).toBeCloseTo(140);
  });
  it('clamps to the lane and gives nothing for an empty stretch', () => {
    expect(length(slice(lane, -50, 500))).toBeCloseTo(200);
    expect(slice(lane, 80, 80)).toEqual([]);
    expect(slice(lane, 250, 300)).toEqual([]);
  });
});

describe('BusFlow', () => {
  it('takes a bounded time per trip, longer for a longer lane', () => {
    const f = new BusFlow();
    expect(f.send([mkLane([[0, 0], [10, 0]])], 1, '#fff', 0, 9)).toBe(MIN_MS);
    expect(f.send([mkLane([[0, 0], [100000, 0]])], 1, '#fff', 0, 9)).toBe(MAX_MS);
  });
  it('is idle again once the packet has arrived and the trace has faded', () => {
    const f = new BusFlow();
    const dur = f.send([lane], 1, '#fff', 1000, 9);
    f.frame(1000 + dur / 2, 1, true);
    expect(f.busy).toBe(true);
    f.frame(1000 + dur + FADE_MS + 1, 1, true);
    expect(f.busy).toBe(false);
  });
  it('lets a packet age while the interior is hidden, and clears at once', () => {
    const f = new BusFlow();
    const dur = f.send([lane], -1, '#fff', 0, 9);
    f.frame(dur + FADE_MS + 1, 1, false);
    expect(f.busy).toBe(false);
    f.send([lane], 1, '#fff', 0, 9);
    f.clear();
    expect(f.busy).toBe(false);
  });
});

describe('BusFlow drawing', () => {
  const strokes = (f: BusFlow) => (f.g.context.instructions as { action: string; data: { style: { width: number; alpha: number; cap: string; join: string } } }[]).filter((i) => i.action === 'stroke').map((i) => i.data.style);
  const far = mkLane([[0, 0], [1000, 0], [1000, 600]]);

  it('strokes each lit lane twice, a trail and a head, plain: square ends and mitred corners', () => {
    const f = new BusFlow();
    f.send([far, far], 1, '#3be3ff', 0, 9);
    f.frame(150, 1, true);
    const s = strokes(f);
    expect(s).toHaveLength(4);
    expect(s.every((x) => x.cap === 'butt' && x.join === 'miter')).toBe(true);
    // (the head is brighter than the trail behind it)
    expect(s[1]!.alpha).toBeGreaterThan(s[0]!.alpha);
  });

  it('lights no more than MAX_LIT lanes of a wide link, spread over it', () => {
    const f = new BusFlow();
    f.send(Array.from({ length: 32 }, () => far), 1, '#3be3ff', 0, 9);
    f.frame(150, 1, true);
    expect(strokes(f)).toHaveLength(2 * MAX_LIT);
  });

  it('draws nothing before the packet starts, and keeps no stroke once the interior is hidden', () => {
    const f = new BusFlow();
    f.send([far], 1, '#3be3ff', 1000, 9);
    f.frame(900, 1, true);
    expect(strokes(f)).toHaveLength(0);
    f.frame(1100, 1, false);
    expect(strokes(f)).toHaveLength(0);
  });
});
