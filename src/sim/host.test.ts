import { describe, expect, it } from 'vitest';
import { advance, handleMessage, newHost } from './host';
import type { FromSim } from './protocol';

const types = (r: FromSim[]) => r.map((m) => m.type);

describe('host message handling', () => {
  it('errors before init', () => {
    expect(handleMessage(newHost(), { type: 'purchase', id: 'cpu1' })).toEqual([
      { type: 'error', message: 'purchase: sim not started' },
    ]);
  });

  it('init starts a game and replies ready + snapshot', () => {
    const h = newHost();
    expect(types(handleMessage(h, { type: 'init', seed: 5 }))).toEqual(['ready', 'snapshot']);
    expect(h.game).not.toBeNull();
  });

  it('init with a bad save reports an error and does not crash', () => {
    const h = newHost();
    const r = handleMessage(h, { type: 'init', save: { version: 42 } as never });
    expect(types(r)).toEqual(['error']);
    expect(h.game).toBeNull();
  });

  it('advances 1 tick per second at 1x, scales with speed, pauses', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    expect(advance(h, 500)).toBe(0);
    expect(advance(h, 500)).toBe(1);
    expect(h.game!.baseTick).toBe(1);
    handleMessage(h, { type: 'setSpeed', speed: 16 });
    expect(advance(h, 1000)).toBe(16);
    handleMessage(h, { type: 'setSpeed', speed: 0 });
    expect(advance(h, 5000)).toBe(0);
    expect(h.game!.baseTick).toBe(17);
  });

  it('caps catch-up per frame and drops the backlog', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    expect(advance(h, 60_000, 10)).toBe(10);
    expect(advance(h, 0, 10)).toBe(0);
  });

  it('purchase, clock, save and reload work through messages', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    h.game!.money = 1000;
    expect(types(handleMessage(h, { type: 'purchase', id: 'cooler1' }))).toEqual(['snapshot']);
    expect(types(handleMessage(h, { type: 'purchase', id: 'nope' }))).toEqual(['error', 'snapshot']);
    expect(types(handleMessage(h, { type: 'setCpuClock', clock: 99 }))).toEqual(['error', 'snapshot']);
    advance(h, 5000);
    const [saved] = handleMessage(h, { type: 'requestSave' });
    expect(saved!.type).toBe('saved');
    const h2 = newHost();
    const save = JSON.parse(JSON.stringify((saved as { save: unknown }).save));
    expect(types(handleMessage(h2, { type: 'init', save }))).toEqual(['ready', 'snapshot']);
    expect(h2.game!.baseTick).toBe(5);
    expect(h2.game!.money).toBe(h.game!.money);
  });
});
