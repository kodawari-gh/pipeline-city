import { describe, expect, it } from 'vitest';
import { clearance } from './clearance';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const stage = box(0, 0, 1600, 900);

describe('clearance', () => {
  it('a tall panel on the left and a wide one at the bottom each cover their own strip, plus the gap', () => {
    const c = clearance(stage, [box(15, 15, 225, 885), box(240, 757, 1585, 885)], 15);
    expect(c).toStrictEqual({ left: 240, right: 0, top: 0, bottom: 158 });
  });

  it('a tall panel on the right covers the right strip', () => {
    expect(clearance(stage, [box(1330, 65, 1585, 885)], 10)).toStrictEqual({ left: 0, right: 280, top: 0, bottom: 0 });
  });

  it('a panel below the stage (the narrow layout) or missing covers nothing', () => {
    const narrow = box(0, 0, 800, 540);
    expect(clearance(narrow, [box(15, 570, 785, 700), null], 15)).toStrictEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it('the widest cover wins when two panels hug the same edge', () => {
    expect(clearance(stage, [box(15, 15, 225, 885), box(15, 15, 300, 885)], 0).left).toBe(300);
  });
});
