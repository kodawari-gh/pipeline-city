// Ticket #65: the music notes on game events (director.ts with a fake backend). Each mapped log note plays its note with its
// cue, in the level's key. A fake clock times the voice cap: 8 note voices at once, the oldest stolen first.
// Covers: the map (kinds, figures and gains), the key (the level's key sets the pitch), the cap and the stolen order, and that a
// note is never rate-shifted (its options carry no rate). The duck class of each note goes to the sink for the engine's duck.
import { assert, describe, expect, it } from 'vitest';
import * as audioDirector from './director';
import { BEAT_S } from './music';
import type { NoteOpts } from './musicNotes';
import type { GameEvent } from '../../worker/game/types';

interface Note {
  id: string;
  token: number;
  opts: NoteOpts;
}

function fake() {
  const cues: string[] = [];
  const notes: Note[] = [];
  const stopped: number[] = [];
  let t = 0;
  const sink: audioDirector.CueSink & { playNote(id: string, opts: NoteOpts): void; stopNote(token: number): void } = {
    playCue(id) {
      cues.push(id);
    },
    setKeyPc() {
      /* no-op */
    },
    playNote(id, opts) {
      notes.push({ id, token: opts.token, opts });
    },
    stopNote(token) {
      stopped.push(token);
    },
  };
  return { cues, notes, stopped, sink, setTime: (s: number) => (t = s), clock: () => t };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });
const snap = (log: GameEvent[], level = 1) => ({ log, level: { level } });

/** A director with one empty snapshot at `level` (the key is set, the first snapshot plays nothing), then `events` as new notes. */
function play(events: GameEvent[], level = 1) {
  const f = fake();
  const d = audioDirector.createDirector(f.sink, f.clock);
  d.onSnapshot(snap([], level));
  d.onSnapshot(snap(events, level));
  return f;
}

describe('director: the music notes map (ticket #65)', () => {
  it('an install plays its pluck note in the build register, in the level key (F at level 1)', () => {
    const f = play([note(5, 'install', 'Board installed')]);
    expect(f.cues).toStrictEqual(['install']);
    expect(f.notes).toHaveLength(1);
    assert.exists(f.notes[0]);
    expect(f.notes[0].id).toBe('music_note_pluck_F4');
    expect(f.notes[0].opts).toStrictEqual({ token: 1, delayS: 0, gainDb: 2, duckClass: 'standard' });
  });

  it('a removal plays the uninstall figure: pluck 4 then 0, half a beat apart', () => {
    const f = play([note(5, 'install', 'Board removed')]);
    expect(f.cues).toStrictEqual(['uninstall']);
    expect(f.notes.map((n) => n.id)).toStrictEqual(['music_note_pluck_C5', 'music_note_pluck_F4']);
    assert.exists(f.notes[1]);
    expect(f.notes[1].opts.delayS).toBeCloseTo(0.5 * BEAT_S, 9);
  });

  it('a swap that is queued plays no note', () => {
    const f = play([note(5, 'install', 'Board will be swapped in')]);
    expect(f.notes).toStrictEqual([]);
  });

  it('a connect rises 0 then 4; a disconnect falls 4 then 0 with a low root', () => {
    const up = play([note(5, 'cable', 'USB cable connected')]);
    expect(up.notes.map((n) => n.id)).toStrictEqual(['music_note_pluck_F4', 'music_note_pluck_C5']);
    const down = play([note(5, 'cable', 'USB cable disconnected')]);
    expect(down.notes.map((n) => n.id)).toStrictEqual([
      'music_note_pluck_C5',
      'music_note_pluck_F4',
      'music_note_low_F2',
    ]);
  });

  it('power on plays the chord 0, 4, 7 a third of a beat apart', () => {
    const f = play([note(5, 'power', 'Machine powered on')]);
    expect(f.notes.map((n) => n.id)).toStrictEqual([
      'music_note_pluck_F4',
      'music_note_pluck_C5',
      'music_note_pluck_F4',
    ]);
    assert.exists(f.notes[1]);
    expect(f.notes[1].opts.delayS).toBeCloseTo(BEAT_S / 3, 9);
    assert.exists(f.notes[2]);
    expect(f.notes[2].opts.delayS).toBeCloseTo((2 * BEAT_S) / 3, 9);
  });

  it('a payout plays a glint fan: 3 + min(3, floor(log10 amount)) chord tones, a third of a beat apart', () => {
    const big = play([note(5, 'payout', 'key 3 paid: $1500')]);
    expect(big.notes.map((n) => n.id)).toStrictEqual([
      'music_note_glint_F5',
      'music_note_glint_A5',
      'music_note_glint_C6',
      'music_note_glint_E6',
      'music_note_glint_F6',
      'music_note_glint_A6',
    ]);
    assert.exists(big.notes[1]);
    expect(big.notes[1].opts.delayS).toBeCloseTo(BEAT_S / 3, 9);
    assert.exists(big.notes[0]);
    expect(big.notes[0].opts.duckClass).toBe('key');

    const small = play([note(5, 'payout', 'key 3 paid: $5')]);
    expect(small.notes).toHaveLength(3);
    const late = play([note(5, 'payout', 'key 3 paid: $1500 (late)')]);
    expect(late.notes).toHaveLength(2);
  });

  it('a drop plays a low tone and a falling glint; an expiry plays low 2 then 0', () => {
    const drop = play([note(5, 'drop', 'Client dropped')]);
    expect(drop.cues).toStrictEqual(['client_drop']);
    expect(drop.notes.map((n) => n.id)).toStrictEqual(['music_note_low_C3', 'music_note_glint_B5']);
    expect(drop.notes.every((n) => n.opts.duckClass === 'failure')).toBe(true);

    const exp = play([note(5, 'expire', 'Job expired')]);
    expect(exp.notes.map((n) => n.id)).toStrictEqual(['music_note_low_A2', 'music_note_low_F2']);
  });

  it('a note with no cue still plays its note (a link up)', () => {
    const f = play([note(5, 'net', 'link up at 1 Gb')]);
    expect(f.cues).toStrictEqual([]);
    expect(f.notes.map((n) => n.id)).toStrictEqual(['music_note_glint_C6', 'music_note_glint_F6']);
    assert.exists(f.notes[0]);
    expect(f.notes[0].opts.duckClass).toBe('standard');
  });

  it('a level note plays no note of its own (the key logic and the stinger)', () => {
    const f = play([note(4, 'level', 'Level 2: Desk')], 2);
    expect(f.notes).toStrictEqual([]);
  });

  it('a note keeps its options exactly: no rate, so it is never rate-shifted', () => {
    const f = play([note(5, 'job', 'key 1 job done')]);
    assert.exists(f.notes[0]);
    expect(Object.keys(f.notes[0].opts).toSorted()).toStrictEqual(['delayS', 'duckClass', 'gainDb', 'token']);
  });
});

describe('director: the music notes follow the level key', () => {
  it('the same event plays in the key of its level (C at level 2, F at level 1)', () => {
    const f1 = play([note(5, 'job', 'key 1 job done')], 1);
    const f2 = play([note(5, 'job', 'key 1 job done')], 2);
    assert.exists(f1.notes[0]);
    expect(f1.notes[0].id).toBe('music_note_pluck_F5');
    assert.exists(f2.notes[0]);
    expect(f2.notes[0].id).toBe('music_note_pluck_C5');
  });

  it('a key change moves the notes that play after it', () => {
    const f = fake();
    const d = audioDirector.createDirector(f.sink, f.clock);
    d.onSnapshot(snap([], 1));
    d.onSnapshot(snap([note(5, 'job', 'key 1 job done')], 1));
    d.onSnapshot(snap([note(5, 'job', 'key 1 job done'), note(6, 'job', 'key 2 job done')], 2));
    expect(f.notes.map((n) => n.id)).toStrictEqual(['music_note_pluck_F5', 'music_note_pluck_C5']);
  });
});

describe('director: the music notes voice cap (8 voices, the oldest stolen first)', () => {
  /** Job notes, one per snapshot, at the fake clock's time. Returns the fake and the director. */
  function jobs(count: number, f = fake()) {
    const d = audioDirector.createDirector(f.sink, f.clock);
    const log: GameEvent[] = [];
    d.onSnapshot(snap([], 1));
    for (let i = 0; i < count; i++) {
      log.push(note(10 + i, 'job', 'key 1 job done'));
      d.onSnapshot(snap([...log], 1));
    }
    return { f, d, log };
  }

  it('eight notes sound with nothing stopped', () => {
    const { f } = jobs(8);
    expect(f.notes).toHaveLength(8);
    expect(f.stopped).toStrictEqual([]);
  });

  it('a ninth note steals the oldest voice', () => {
    const { f } = jobs(9);
    expect(f.notes).toHaveLength(9);
    expect(f.stopped).toStrictEqual([1]);
  });

  it('a tenth note steals the next oldest', () => {
    const { f } = jobs(10);
    expect(f.stopped).toStrictEqual([1, 2]);
  });

  it('a voice that has ended (its length passed) is not stolen', () => {
    const { f, d, log } = jobs(8);
    // Pluck notes last 1.2 s: at 2 s the eight have ended, so the ninth steals nothing.
    f.setTime(2);
    log.push(note(30, 'job', 'key 1 job done'));
    d.onSnapshot(snap([...log], 1));
    expect(f.notes).toHaveLength(9);
    expect(f.stopped).toStrictEqual([]);
  });
});

describe('director: a fixture with no note calls', () => {
  it('plays its cues, and the note as a cue (no note call)', () => {
    const cues: string[] = [];
    const d = audioDirector.createDirector({
      playCue: (id) => void cues.push(id),
      setKeyPc() {
        /* no-op */
      },
    });
    d.onSnapshot(snap([], 1));
    d.onSnapshot(snap([note(5, 'install', 'Board installed')], 1));
    expect(cues).toStrictEqual(['install', 'music_note_pluck_F4']);
    expect(audioDirector.NOTE_GAP_S).toBeCloseTo(0.04, 9);
  });
});
