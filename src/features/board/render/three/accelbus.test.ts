import { describe, expect, it } from 'vitest';
import { busesOf } from './accelbus';

const hop = (from: string, to: string, reverse = false) => ({ link: { from, to }, reverse });

describe("a card's buses", () => {
  it('a launch over the host link runs the receive lines inward, its answer back out', () => {
    expect([...busesOf([hop('pcie', 'launch'), hop('launch', 'pc')])]).toEqual([['host', 1]]);
    expect([...busesOf([hop('host', 'ctl')])]).toEqual([['host', 1]]);
    expect([...busesOf([hop('host', 'ctl', true)])]).toEqual([['host', -1]]);
  });

  it('a store reaches the card memory (toward the memory die), a load comes from it', () => {
    expect([...busesOf([hop('lanes', 'dram')])]).toEqual([['mem', 1]]);
    expect([...busesOf([hop('lanes', 'dram', true)])]).toEqual([['mem', -1]]);
    expect([...busesOf([hop('cardmem', 'tiles')])]).toEqual([['mem', -1]]);
  });

  it("a CPU word into the AI card's memory crosses the host link and the memory bus; a route inside the die touches neither", () => {
    const b = busesOf([hop('host', 'cardmem')]);
    expect(b.get('host')).toBe(1);
    expect(b.get('mem')).toBe(1);
    expect(busesOf([hop('fetch', 'decode'), hop('regs', 'lanes')]).size).toBe(0);
  });
});
