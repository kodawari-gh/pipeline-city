// Ticket #53: the director (director.ts) plays one cue per new log note. The sound is a fake CueSink, so the test
// reads which cues were asked for and at what delay. Covers: the first snapshot plays nothing; a burst of three
// new notes at one tick plays in log order, 40 ms apart; only unseen notes play; `level` plays one `level_up`; reset
// (new game, load, leaving a game) and a loaded save (tick goes back) play nothing for the old notes.
import { assert, describe, expect, it } from 'vitest';
import * as audioDirector from './director';
import type { GameEvent } from '../../worker/game/types';

function fakeSink() {
  const plays: { id: string; delayS: number }[] = [];
  /** The music note cues (ticket #65) are read in music.notes.test.ts: this file reads the game cues only. */
  const notes: string[] = [];
  const sink: audioDirector.CueSink = {
    playCue(id, opts) {
      if (id.startsWith('music_note_')) {
        return void notes.push(id);
      }
      plays.push({ id, delayS: opts?.delayS ?? 0 });
    },
    setKeyPc() {
      /* no-op */
    },
  };
  return { plays, notes, sink, ids: () => plays.map((p) => p.id) };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });
const snap = (log: GameEvent[], level = 1) => ({ log, level: { level } });

describe('director: one cue per new log note', () => {
  it('the first snapshot plays nothing, even when its log has notes', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([note(1, 'install', 'Board installed'), note(2, 'payout', 'key 1 paid: $120')]));
    expect(f.plays).toStrictEqual([]);
  });

  it('a burst of three new notes at one tick plays in log order, 40 ms apart', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onSnapshot(
      snap([
        note(5, 'install', 'Board installed'),
        note(5, 'cable', 'USB cable connected'),
        note(5, 'payout', 'key 3 paid: $120'),
      ]),
    );
    expect(f.ids()).toStrictEqual(['install', 'cable_connect', 'payout']);
    assert.exists(f.plays[0]);
    expect(f.plays[0].delayS).toBeCloseTo(0, 9);
    assert.exists(f.plays[1]);
    expect(f.plays[1].delayS).toBeCloseTo(0.04, 9);
    assert.exists(f.plays[2]);
    expect(f.plays[2].delayS).toBeCloseTo(0.08, 9);
    expect(audioDirector.NOTE_GAP_S).toBeCloseTo(0.04, 9);
  });

  it('the next snapshot plays only the notes it has not played yet', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    const a = note(5, 'install', 'Board installed');
    const b = note(5, 'cable', 'USB cable connected');
    d.onSnapshot(snap([]));
    d.onSnapshot(snap([a, b]));
    f.plays.length = 0;
    d.onSnapshot(snap([a, b, note(6, 'payout', 'key 3 paid: $120')]));
    expect(f.ids()).toStrictEqual(['payout']);
  });

  it('a level note plays one level_up (the level-up stinger, see director.levelup.test.ts)', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    expect(f.ids()).toStrictEqual(['level_up']);
  });

  it('reset (new game, load or leaving a game): the next snapshot plays nothing, later notes play', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    const a = note(5, 'install', 'Board installed');
    d.onSnapshot(snap([]));
    d.onSnapshot(snap([a]));
    expect(f.ids()).toStrictEqual(['install']);
    d.reset();
    f.plays.length = 0;
    const b = note(6, 'cable', 'USB cable connected');
    d.onSnapshot(snap([a, b]));
    expect(f.plays).toStrictEqual([]);
    d.onSnapshot(snap([a, b, note(7, 'payout', 'key 3 paid: $120')]));
    expect(f.ids()).toStrictEqual(['payout']);
  });

  it('a loaded save (tick goes back) plays nothing for its old notes, then plays new ones', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onSnapshot(snap([note(50, 'payout', 'key 1 paid: $120')]));
    f.plays.length = 0;
    const loaded = note(10, 'install', 'Board installed');
    d.onSnapshot(snap([loaded]));
    expect(f.plays).toStrictEqual([]);
    d.onSnapshot(snap([loaded, note(11, 'cable', 'USB cable connected')]));
    expect(f.ids()).toStrictEqual(['cable_connect']);
  });
});
