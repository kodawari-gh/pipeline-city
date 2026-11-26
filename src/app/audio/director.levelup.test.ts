// Ticket #55: the level-up stinger, seen through the director (director.ts) with a fake CueSink. The sink records
// the cues, the key changes and the `quantise` each cue asks for, in the order they happen. Covers: one level change
// plays one `level_up` after the new key is set, on the music beat (the mix token); the level-up popup plays one
// stinger (once per level, with the note); several levels in one tick play one stinger; load, new game, sandbox and
// a loaded save move the key silently, and the next real level-up still plays. The beat's timing is in
// engine.test.ts (the beat clock); the file played is in index.test.ts (the real engine).
import { describe, expect, it } from 'vitest';
import * as audioDirector from './director';
import { keyPcForLevel } from './keys';
import { MIX } from './mixTokens';
import type { GameEvent } from '../../worker/game/types';

type Rec = { kind: 'cue'; id: string; delayS: number; quantise?: 'beat' | undefined } | { kind: 'key'; pc: number };

function fakeSink() {
  const log: Rec[] = [];
  const sink: audioDirector.CueSink = {
    playCue(id, opts) {
      log.push({ kind: 'cue', id, delayS: opts?.delayS ?? 0, quantise: opts?.quantise });
    },
    setKeyPc(pc) {
      log.push({ kind: 'key', pc });
    },
  };
  return {
    log,
    sink,
    cues: () => log.filter((r): r is Extract<Rec, { kind: 'cue' }> => r.kind === 'cue').map((r) => r.id),
    keys: () => log.filter((r): r is Extract<Rec, { kind: 'key' }> => r.kind === 'key').map((r) => r.pc),
    /** The `quantise` of each level_up played, in order. */
    stingerQuantise: () =>
      log
        .filter((r): r is Extract<Rec, { kind: 'cue' }> => r.kind === 'cue' && r.id === 'level_up')
        .map((r) => r.quantise),
  };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });
const snap = (log: GameEvent[], level = 1) => ({ log, level: { level } });

describe('level-up stinger: one level change', () => {
  it('a level note plays one level_up, after the new level key is set', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    expect(f.cues()).toStrictEqual(['level_up']);
    expect(f.keys()).toStrictEqual([keyPcForLevel(2)]);
    const keyAt = f.log.findIndex((r) => r.kind === 'key' && r.pc === keyPcForLevel(2));
    const stingerAt = f.log.findIndex((r) => r.kind === 'cue' && r.id === 'level_up');
    expect(keyAt).toBeGreaterThanOrEqual(0);
    expect(keyAt).toBeLessThan(stingerAt);
  });

  it('the stinger asks for the music beat: the quantise rule is the mix token', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    expect(MIX.levelUp.quantise).toBe('beat');
    expect(f.stingerQuantise()).toStrictEqual([MIX.levelUp.quantise]);
  });

  it('two level notes in two ticks play two stingers, one for each level', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk'), note(9, 'level', 'Level 3: Shop')], 3));
    expect(f.cues()).toStrictEqual(['level_up', 'level_up']);
    expect(f.keys()).toStrictEqual([keyPcForLevel(2), keyPcForLevel(3)]);
  });

  it('the popup hold that comes with a level change adds no second stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    const idle = { speed: 1, hold: null, crashed: false };
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onUi(idle);
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    d.onUi({ ...idle, speed: 0, hold: 'levelUp' });
    expect(f.cues()).toStrictEqual(['level_up']);
  });
});

describe('level-up stinger: several levels in one tick', () => {
  it('two level notes at one tick play one stinger, in the newest level key', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk'), note(4, 'level', 'Level 3: Shop')], 3));
    expect(f.cues()).toStrictEqual(['level_up']);
    expect(f.keys()).toStrictEqual([keyPcForLevel(3)]);
  });

  it('a popup for the newest of those levels, opened after the tick, plays no more', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    const idle = { speed: 1, hold: null, crashed: false };
    d.onSnapshot(snap([]));
    d.onUi(idle);
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk'), note(4, 'level', 'Level 3: Shop')], 3));
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 3 });
    expect(f.cues()).toStrictEqual(['level_up']);
  });
});

describe('level-up stinger: silent level changes', () => {
  it('a load or a new game moves the key with no stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.reset(); // load or new game: the next snapshot's notes are old
    d.onSnapshot(snap([note(40, 'level', 'Level 5: Lab')], 5));
    expect(f.cues()).toStrictEqual([]);
    expect(f.keys()).toStrictEqual([keyPcForLevel(5)]);
  });

  it('a level note after a load plays its stinger: the silent change does not block it', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.reset();
    d.onSnapshot(snap([note(40, 'level', 'Level 5: Lab')], 5));
    f.log.length = 0;
    d.onSnapshot(snap([note(40, 'level', 'Level 5: Lab'), note(41, 'level', 'Level 6: Plant')], 6));
    expect(f.cues()).toStrictEqual(['level_up']);
    expect(f.keys()).toStrictEqual([keyPcForLevel(6)]);
  });

  it('a sandbox level change moves the key with no stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    // A level note in a sandbox game: only the sandbox flag keeps the stinger silent.
    d.onSnapshot({ ...snap([note(4, 'level', 'Level 3: Shop')], 3), sandbox: true });
    expect(f.cues()).not.toContain('level_up');
    expect(f.keys()).toStrictEqual([keyPcForLevel(3)]);
  });

  it('the next level-up after a sandbox level change plays its stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot({ ...snap([note(4, 'level', 'Level 3: Shop')], 3), sandbox: true });
    d.onSnapshot(snap([note(4, 'level', 'Level 3: Shop'), note(12, 'level', 'Level 4: Lab')], 4));
    expect(f.cues()).toStrictEqual(['level_up']);
    expect(f.keys()).toStrictEqual([keyPcForLevel(3), keyPcForLevel(4)]);
  });

  it('a popup for a level changed in the sandbox plays no stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    const idle = { speed: 1, hold: null, crashed: false };
    d.onSnapshot(snap([]));
    d.onUi(idle);
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot({ ...snap([note(4, 'level', 'Level 3: Shop')], 3), sandbox: true });
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 3 });
    expect(f.cues()).toStrictEqual([]);
  });

  it('a loaded save (tick goes back) at another level plays no stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onSnapshot(snap([note(50, 'level', 'Level 9: Plant')], 9));
    f.log.length = 0;
    d.onSnapshot(snap([note(10, 'level', 'Level 2: Desk')], 2));
    expect(f.cues()).not.toContain('level_up');
    expect(f.keys()).toStrictEqual([keyPcForLevel(2)]);
  });
});

describe('level-up stinger: the level-up popup', () => {
  const idle = { speed: 1, hold: null, crashed: false };

  it('a popup opens with a levelUp change and no level note: one level_up', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onUi(idle);
    f.log.length = 0; // the first snapshot sets the level 1 key: not part of the test
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    expect(f.cues()).toStrictEqual(['level_up']);
  });

  it('a popup after a level note of that level plays no more', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onUi(idle);
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    expect(f.cues()).toStrictEqual(['level_up']);
  });

  it('a level note after a popup of that level plays no second stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onUi(idle);
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    d.onSnapshot(snap([note(4, 'level', 'Level 2: Desk')], 2));
    expect(f.cues()).toStrictEqual(['level_up']);
  });

  it('the popup stinger asks for the music beat, as the note does', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onUi(idle);
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    expect(f.stingerQuantise()).toStrictEqual([MIX.levelUp.quantise]);
  });

  it('a popup closed and opened again for the same level plays no second stinger', () => {
    const f = fakeSink();
    const d = audioDirector.createDirector(f.sink);
    d.onSnapshot(snap([]));
    d.onUi(idle);
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    d.onUi({ ...idle, speed: 1, hold: null, levelUp: null });
    d.onUi({ ...idle, speed: 0, hold: 'levelUp', levelUp: 2 });
    expect(f.cues()).toStrictEqual(['level_up']);
  });
});

describe('level-up stinger: todo (the music, not built yet)', () => {
  it.todo(
    'the music key change and chord start on the same beat as the stinger (the music tickets use the beat clock hook)',
  );
});
