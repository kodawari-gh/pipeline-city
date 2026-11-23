// Ticket #65: the music notes on game events (music-spec.md section 7, event to note map). The notes are one-shot cues
// on the music bus: `music_note_<pluck|glint|low>_<NOTE>` (`Cs4` = C#4). The director (director.ts) plays one note per
// mapped log note, next to the game cue of that note. Fake backend: a CueSink that records each playCue; the voice pool
// gets explicit times (a fake clock). No AudioContext here.
// Contract assumed (the coder adds it): note cues are entries of MIX.cues with id `music_note_<family>_<NOTE>`, bus `music`,
// one file each (`pickFile` returns rate 1, never rate-shifted), and the director plays them through `playCue`.
import { describe, expect, it } from 'vitest';
import { createDirector, type CueSink } from './director';
import { cueForNote } from './events';
import { keyName, keyPcForLevel, pickFile, type Cue } from './keys';
import { MIX } from './mixTokens';
import { VoicePool, type VoiceRec } from './voices';
import type { GameEvent } from '../../worker/game/types';

const NOTE_PREFIX = 'music_note_';
const FAMILIES = ['pluck', 'glint', 'low'] as const;

/** The note cues in the mix tokens (the music lane's one-shots). */
const noteCues = (): Cue[] => MIX.cues.filter((c) => c.id.startsWith(NOTE_PREFIX));
/** The note ids a list of play ids holds, in order. */
const notesIn = (ids: string[]): string[] => ids.filter((id) => id.startsWith(NOTE_PREFIX));

function fakeSink() {
  const plays: { id: string; delayS: number }[] = [];
  const sink: CueSink = {
    playCue(id, opts) {
      plays.push({ id, delayS: opts?.delayS ?? 0 });
    },
    setKeyPc() {},
  };
  return { plays, sink, ids: () => plays.map((p) => p.id) };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });
const snap = (log: GameEvent[], level = 1) => ({ log, level: { level } });

/** A director with the level's key, past its first snapshot, then one snapshot with `log` (the new notes). */
function play(log: GameEvent[], level = 1) {
  const f = fakeSink();
  const d = createDirector(f.sink);
  d.onSnapshot(snap([], level));
  d.onSnapshot(snap(log, level));
  return f;
}

/** The game cue of one note (the one the note rides with), and its music note ids. */
const one = (kind: string, text: string, level = 1) => play([note(5, kind, text)], level);

describe('music notes: the event map (director, fake backend)', () => {
  it('install plays the root pluck (F4 at level 1, F Lydian) next to the install cue', () => {
    const f = one('install', 'CPU installed in socket');
    const cue = cueForNote(note(5, 'install', 'CPU installed in socket'));
    expect(cue).not.toBeNull();
    expect(f.ids()).toEqual(expect.arrayContaining([cue as string, `${NOTE_PREFIX}pluck_F4`]));
    expect(notesIn(f.ids())).toEqual([`${NOTE_PREFIX}pluck_F4`]);
  });

  it('key plays the pluck on scale step 2 in the flow register (A5 at level 1)', () => {
    expect(notesIn(one('key', 'key 1 plugged in').ids())).toEqual([`${NOTE_PREFIX}pluck_A5`]);
  });

  it('job plays the root pluck in the flow register (F5 at level 1)', () => {
    expect(notesIn(one('job', 'key 1 holds its result').ids())).toEqual([`${NOTE_PREFIX}pluck_F5`]);
  });

  it('expire plays low 2 then low 0 (A2, then F2 at level 1)', () => {
    expect(notesIn(one('expire', 'client took back job 1').ids())).toEqual([`${NOTE_PREFIX}low_A2`, `${NOTE_PREFIX}low_F2`]);
  });

  it('cable connected plays two plucks rising (pluck 0 then 4)', () => {
    const ids = notesIn(one('cable', 'Ethernet cable connected to NIC').ids());
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id.startsWith(`${NOTE_PREFIX}pluck_`))).toBe(true);
  });

  it('drop plays a low note and a glint (low 4, then glint 3)', () => {
    const ids = notesIn(one('drop', 'a client gave up').ids());
    expect(ids.some((id) => id.startsWith(`${NOTE_PREFIX}low_`))).toBe(true);
    expect(ids.some((id) => id.startsWith(`${NOTE_PREFIX}glint_`))).toBe(true);
  });

  it('payout plays a glint fan: 3 + min(3, floor(log10 amount)) notes ($120 gives 5)', () => {
    const ids = notesIn(one('payout', 'key 3 paid: $120').ids());
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => id.startsWith(`${NOTE_PREFIX}glint_`))).toBe(true);
  });

  it('a late payout plays two glint notes', () => {
    const ids = notesIn(one('payout', 'key 3 paid: $120 (late)').ids());
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id.startsWith(`${NOTE_PREFIX}glint_`))).toBe(true);
  });

  it('ecc plays one glint (scale step 3, the Lydian #4)', () => {
    const ids = notesIn(one('ecc', 'ECC corrected a flipped bit').ids());
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(new RegExp(`^${NOTE_PREFIX}glint_`));
  });

  it('a kind with no music map plays no note (purchase)', () => {
    expect(notesIn(one('purchase', 'bought a CPU').ids())).toEqual([]);
  });
});

describe('music notes: the key', () => {
  it('the same event plays its note in the level key (install: F4 at level 1, G4 at level 3)', () => {
    expect(keyName(keyPcForLevel(1))).toBe('F');
    expect(keyName(keyPcForLevel(3))).toBe('G');
    expect(notesIn(one('install', 'CPU installed in socket', 1).ids())).toEqual([`${NOTE_PREFIX}pluck_F4`]);
    expect(notesIn(one('install', 'CPU installed in socket', 3).ids())).toEqual([`${NOTE_PREFIX}pluck_G4`]);
  });
});

describe('music notes: the mix tokens', () => {
  it('every note family has cues, all on the music bus', () => {
    const notes = noteCues();
    expect(notes.length).toBeGreaterThan(0);
    for (const fam of FAMILIES) {
      const of = notes.filter((c) => c.id.startsWith(`${NOTE_PREFIX}${fam}_`));
      expect(of.length, fam).toBeGreaterThan(0);
    }
    for (const c of notes) expect(c.bus, c.id).toBe('music');
  });

  it('each note sits quieter than a game cue: music bus, trim and family gain stay under the sfx bus (0 dB)', () => {
    expect(noteCues().length).toBeGreaterThan(0);
    const sfxDb = MIX.buses.sfx.defaultDb;
    for (const fam of FAMILIES) {
      const level = MIX.buses.music.defaultDb + MIX.music.cueGainDb[fam] + MIX.music.trimDb;
      expect(level, fam).toBeLessThan(sfxDb);
    }
  });

  it('the matching game cue of each mapped kind ducks the music bus', () => {
    expect(MIX.ducking.targets).toContain('music');
    const kinds: [string, string][] = [
      ['install', 'CPU installed in socket'],
      ['cable', 'Ethernet cable connected to NIC'],
      ['key', 'key 1 plugged in'],
      ['job', 'key 1 holds its result'],
      ['payout', 'key 3 paid: $120'],
      ['drop', 'a client gave up'],
      ['expire', 'client took back job 1'],
    ];
    for (const [kind, text] of kinds) {
      const id = cueForNote(note(5, kind, text));
      expect(id, kind).not.toBeNull();
      const cue = MIX.cues.find((c) => c.id === id)!;
      expect(cue.duckClass, kind).not.toBeNull();
      expect(MIX.ducking.cueDuckDb[cue.duckClass as keyof typeof MIX.ducking.cueDuckDb], kind).toBeLessThan(0);
    }
  });

  it('no note cue is rate-shifted: every key plays the note file at rate 1', () => {
    expect(noteCues().length).toBeGreaterThan(0);
    for (const c of noteCues()) {
      for (let pc = 0; pc < 12; pc++) {
        const pick = pickFile(c, pc, new Map());
        expect(pick.rate, `${c.id} in pc ${pc}`).toBe(1);
        expect(pick.path, c.id).toContain(c.id);
      }
    }
  });
});

describe('music notes: the voice cap (8 note voices, oldest stolen first)', () => {
  /** Admit `c` at `now` as the engine does: an admitted cue adds its own voice. */
  function admit(pool: VoicePool, c: Cue, now: number) {
    const adm = pool.admit(c, now);
    if (adm.ok) pool.add({ cue: c.id, bus: c.bus, prio: c.priority, t: now, stop: () => {} } as VoiceRec);
    return adm;
  }

  /** Nine distinct pluck notes of one priority, 1 s apart (no rate limit between them). */
  const nine = (): Cue[] => {
    const same = noteCues().filter((c) => c.id.startsWith(`${NOTE_PREFIX}pluck_`));
    const pr = same[0]?.priority;
    return same.filter((c) => c.priority === pr).slice(0, 9);
  };

  it('eight note voices play; the ninth steals the oldest', () => {
    const cs = nine();
    expect(cs).toHaveLength(9);
    const pool = new VoicePool();
    for (let i = 0; i < 8; i++) expect(admit(pool, cs[i]!, 1000 + i * 1000).ok).toBe(true);
    expect(pool.list.length).toBe(8);
    const adm = admit(pool, cs[8]!, 9000);
    expect(adm.ok).toBe(true);
    expect(adm.ok ? adm.evict.map((v) => v.t) : null).toEqual([1000]);
    expect(pool.list.map((v) => v.t).sort((a, b) => a - b)).toEqual([2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
  });

  it('the next note steals the next oldest; the pool never holds more than eight', () => {
    const cs = nine();
    const pool = new VoicePool();
    for (let i = 0; i < 8; i++) admit(pool, cs[i]!, 1000 + i * 1000);
    admit(pool, cs[8]!, 9000);
    const adm = admit(pool, cs[0]!, 10000);
    expect(adm.ok).toBe(true);
    expect(adm.ok ? adm.evict.map((v) => v.t) : null).toEqual([2000]);
    expect(pool.list.length).toBeLessThanOrEqual(8);
  });
});
