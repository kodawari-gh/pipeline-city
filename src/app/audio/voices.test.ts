// Ticket #51: the voice caps (voices.ts) with the mix tokens (mixTokens.ts). A cap never delays a cue: it steals a voice
// or refuses the cue at once, and a refused cue starts no rate-limit clock. Pure: no AudioContext.
import { describe, expect, it } from 'vitest';
import type { Cue } from './keys';
import { MIX } from './mixTokens';
import { VoicePool } from './voices';

const cue = (id: string): Cue => MIX.cues.find((c) => c.id === id) as Cue;

/** Admit `c` at `now` as the engine does: an admitted cue adds its own voice. */
function play(pool: VoicePool, c: Cue, now: number, prio = c.priority) {
  const adm = pool.admit(c, now);
  if (adm.ok) pool.add({ cue: c.id, bus: c.bus, prio, t: now, stop: () => {} });
  return adm;
}

describe('per-cue cap (maxVoices)', () => {
  it('a payout past its cap steals the oldest payout at once; the pool keeps maxVoices', () => {
    const payout = cue('payout');
    const gap = Math.max(payout.minIntervalMs, payout.collapseMs) + 1;
    const pool = new VoicePool();
    for (let i = 0; i < payout.maxVoices; i++) expect(play(pool, payout, 1000 + i * gap).ok).toBe(true);
    const adm = play(pool, payout, 1000 + payout.maxVoices * gap);
    expect(adm).toMatchObject({ ok: true });
    expect(adm.ok ? adm.evict.map((v) => v.t) : null).toEqual([1000]);
    expect(pool.list.map((v) => v.t)).toEqual([1000 + gap, 1000 + 2 * gap]);
  });
});

describe('global cap (voices.global)', () => {
  // sfx and ui reach 12 + 6 = 18 at most, so the global cap binds only with a third bus. Fill it with music voices.
  const fill = (pool: VoicePool) => {
    for (let i = 0; i < MIX.voices.global; i++)
      pool.add({ cue: 'payout', bus: 'music', prio: 3, t: i, stop: () => {} });
  };

  it('a higher-priority cue steals the oldest lowest-priority voice and the pool stays at MIX.voices.global', () => {
    const pool = new VoicePool();
    fill(pool);
    const adm = play(pool, cue('fault_crash'), 5000);
    expect(adm.ok ? adm.evict.map((v) => v.t) : null).toEqual([0]);
    expect(pool.list).toHaveLength(MIX.voices.global);
  });

  it('a cue below every playing voice is refused at once, and the refusal starts no rate-limit clock', () => {
    const pool = new VoicePool();
    fill(pool);
    const install = cue('install');
    expect(play(pool, install, 5000)).toEqual({ ok: false });
    expect(pool.list).toHaveLength(MIX.voices.global);
    pool.remove(pool.list[0]!);
    expect(play(pool, install, 5000).ok).toBe(true);
  });
});
