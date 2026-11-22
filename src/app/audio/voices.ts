// Voice policy: rate limit, burst collapse, per-cue, per-bus and global caps, and stealing. Pure: no AudioContext here (engine.ts owns the nodes).
import { MIX, type BusId, type CueId } from './mixTokens';
import type { Cue } from './keys';

/** One voice that plays now. `stop` fades it out and takes it off the pool. */
export interface VoiceRec {
  cue: CueId;
  bus: BusId;
  prio: number;
  /** Start time (ms, performance.now). */
  t: number;
  stop: () => void;
}

export type Admit = { ok: false } | { ok: true; evict: VoiceRec[] };

/** The oldest voice of a list. */
const oldest = (vs: VoiceRec[]): VoiceRec | undefined => vs.reduce<VoiceRec | undefined>((a, v) => (!a || v.t < a.t ? v : a), undefined);
/** The lowest priority, then the oldest (the stealing order). */
const weakest = (vs: VoiceRec[]): VoiceRec | undefined =>
  vs.reduce<VoiceRec | undefined>((a, v) => (!a || v.prio < a.prio || (v.prio === a.prio && v.t < a.t) ? v : a), undefined);

export class VoicePool {
  readonly list: VoiceRec[] = [];
  private last = new Map<string, number>();

  /**
   * Decide whether `c` may start at `now` (ms). A refused cue changes nothing. An admitted one returns the voices it steals or ends
   * (the caller stops them); the caller then adds its own voice with `add`.
   */
  admit(c: Cue, now: number): Admit {
    const prev = this.last.get(c.id) ?? -Infinity;
    if (now - prev < Math.max(c.minIntervalMs, c.collapseMs)) return { ok: false };

    const same = this.list.filter((v) => v.cue === c.id);
    const sameVictim = same.length >= c.maxVoices ? oldest(same) : undefined;
    const rest = this.list.filter((v) => v !== sameVictim);

    const cap = c.bus === 'ui' ? MIX.voices.ui : MIX.voices.sfx;
    const onBus = rest.filter((v) => v.bus === c.bus);
    const busFull = onBus.length >= cap;
    const globalFull = rest.length >= MIX.voices.global;

    let steal: VoiceRec | undefined;
    if (busFull || globalFull) {
      steal = weakest(busFull ? onBus : rest);
      if (!steal || steal.prio > c.priority) return { ok: false };   // everything playing matters more
    }

    const evict = [sameVictim, steal].filter((v): v is VoiceRec => !!v);
    for (const v of evict) this.remove(v);
    this.last.set(c.id, now);
    return { ok: true, evict };
  }

  add(v: VoiceRec): void {
    this.list.push(v);
  }

  remove(v: VoiceRec): void {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }
}
