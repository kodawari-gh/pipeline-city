import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { cuesOf } from './cues3d';

const snap = (o: Record<string, unknown>) => ({ phase: 'running-os', plugged: null, keyActivity: 'idle', pendingSwaps: [], ...o }) as unknown as Snapshot;

describe('the waiting cues', () => {
  it('has none without a snapshot or a wait', () => {
    expect(cuesOf(null)).toEqual([]);
    expect(cuesOf(snap({}))).toEqual([]);
  });

  it('rings a finished key once, whichever way the game says it is done', () => {
    const k = { id: 4, stage: 'running' };
    expect(cuesOf(snap({ plugged: k, phase: 'done-remove-key', keyActivity: 'done' }))).toEqual([{ id: 'key:4', kind: 'key', veil: false }]);
  });

  it('veils the part a queued install replaces, and rings an empty slot', () => {
    const swaps = [{ invId: 'a', target: 'cpu0', replacesId: 'dev7' }, { invId: 'b', target: 'dimm3', replacesId: null }];
    expect(cuesOf(snap({ pendingSwaps: swaps }))).toEqual([{ id: 'dev7', kind: 'swap', veil: true }, { id: 'dimm3', kind: 'swap', veil: false }]);
  });
});
