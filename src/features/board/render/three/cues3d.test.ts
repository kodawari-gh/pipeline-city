import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { key, snap as fullSnap } from '@/core/ui/testdata';
import { cuesOf } from './cues3d';

const snap = (o: Partial<Snapshot>): Snapshot =>
  fullSnap({ phase: 'running-os', plugged: null, keyActivity: 'none', pendingSwaps: [], ...o });

describe('the waiting cues', () => {
  it('has none without a snapshot or a wait', () => {
    expect(cuesOf(null)).toStrictEqual([]);
    expect(cuesOf(snap({}))).toStrictEqual([]);
  });

  it('rings a finished key once, whichever way the game says it is done', () => {
    const k = key({ id: 4, stage: 'running' });
    expect(cuesOf(snap({ plugged: k, phase: 'done-remove-key', keyActivity: 'done' }))).toStrictEqual([
      { id: 'key:4', kind: 'key', veil: false },
    ]);
  });

  it('veils the part a queued install replaces, and rings an empty slot', () => {
    const swaps = [
      { invId: 'a', target: 'cpu0', replacesId: 'dev7' },
      { invId: 'b', target: 'dimm3', replacesId: null },
    ];
    expect(cuesOf(snap({ pendingSwaps: swaps }))).toStrictEqual([
      { id: 'dev7', kind: 'swap', veil: true },
      { id: 'dimm3', kind: 'swap', veil: false },
    ]);
  });
});
