// Ticket #51: the `?debug` cue board is loaded only with the debug flag. Uses the existing flag seam (debugflag.ts),
// so the board module is never loaded in a normal visit. The board's listing and play buttons have no module yet.
import { describe, expect, it, vi } from 'vitest';
import { debugOn, whenDebug } from '../debugflag';

describe('the ?debug cue board', () => {
  it('is absent without the flag: its module is not loaded', () => {
    const load = vi.fn(async () => ({ mountDebug: vi.fn() }));
    expect(debugOn('')).toBe(false);
    expect(whenDebug('', load, {})).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and mounts with ?debug', async () => {
    const mountDebug = vi.fn();
    const load = vi.fn(async () => ({ mountDebug }));
    const ctx = { board: true };
    await whenDebug('?debug', load, ctx);
    expect(load).toHaveBeenCalledTimes(1);
    expect(mountDebug).toHaveBeenCalledWith(ctx);
  });
});
