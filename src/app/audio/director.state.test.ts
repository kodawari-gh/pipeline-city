// Ticket #54: state rules (SPEC §3.2), and the clock's speed, holds and crash, played by the director (director.ts).
// The sound is a fake CueSink, as in director.test.ts: the test reads which cues were asked for.
// Seam: the snapshot carries the fields the state rules read (`phase`, `net`, `power`, `plugged`, `keyActivity`).
// The clock (`speed`, `hold`) and the crash (`crashed`) come through `onUi`, as index.ts feeds them, not through the snapshot.
import { describe, expect, it } from 'vitest';
import { createDirector, type CueSink, type DirectorSnap, type UiInput } from './director';
import type { GameEvent } from '../../worker/game/types';

function fakeSink() {
  const plays: { id: string; delayS: number }[] = [];
  /** The music note cues (ticket #65) are read in music.notes.test.ts: this file reads the game cues only. */
  const notes: string[] = [];
  const sink: CueSink = {
    playCue(id, opts) {
      if (id.startsWith('music_note_')) return void notes.push(id);
      plays.push({ id, delayS: opts?.delayS ?? 0 });
    },
    setKeyPc() {},
  };
  return { plays, notes, sink, ids: () => plays.map((p) => p.id) };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });

type Fields = {
  phase: string;
  net: { state: string };
  power: { tripped: boolean };
  plugged: { id: number } | null;
  keyActivity: string;
};

const IDLE: Fields = {
  phase: 'running',
  net: { state: 'no-device' },
  power: { tripped: false },
  plugged: null,
  keyActivity: 'none',
};

/** A director snapshot: the fields the state rules read, over the idle machine. */
const snap = (over: Partial<Fields> = {}, log: GameEvent[] = []) =>
  ({ log, level: { level: 1 }, pendingSwaps: [], ...IDLE, ...over }) as unknown as DirectorSnap;

/** A UI input: the clock's speed, its hold and the crash, as index.ts reads them. */
const UI_IDLE: UiInput = { speed: 4, hold: null, crashed: false };
const ui = (over: Partial<UiInput> = {}): UiInput => ({ ...UI_IDLE, ...over });

/** The cues one change in the snapshot plays: a baseline snapshot (plays nothing), then the changed one. */
function cuesFor(from: Partial<Fields>, to: Partial<Fields>, log: GameEvent[] = []): string[] {
  const f = fakeSink();
  const d = createDirector(f.sink);
  d.onSnapshot(snap(from));
  f.plays.length = 0;
  d.onSnapshot(snap(to, log));
  return f.ids();
}

/** The cues one change in the UI input plays: a baseline input (plays nothing), then the changed one. */
function uiCuesFor(from: Partial<UiInput>, to: Partial<UiInput>): string[] {
  const f = fakeSink();
  const d = createDirector(f.sink);
  d.onUi(ui(from));
  f.plays.length = 0;
  d.onUi(ui(to));
  return f.ids();
}

describe('state rules: network link', () => {
  it('link up: from no-device, from down, and from no-cable plays net_link_up', () => {
    expect(cuesFor({ net: { state: 'no-device' } }, { net: { state: 'link-up' } })).toEqual(['net_link_up']);
    expect(cuesFor({ net: { state: 'down' } }, { net: { state: 'link-up' } })).toEqual(['net_link_up']);
    expect(cuesFor({ net: { state: 'no-cable' } }, { net: { state: 'link-up' } })).toEqual(['net_link_up']);
  });

  it('link up from saturated plays nothing', () => {
    expect(cuesFor({ net: { state: 'saturated' } }, { net: { state: 'link-up' } })).toEqual([]);
  });

  it('saturated plays net_saturated', () => {
    expect(cuesFor({ net: { state: 'link-up' } }, { net: { state: 'saturated' } })).toEqual(['net_saturated']);
  });

  it.each(['down', 'no-cable', 'no-os', 'no-device'])('link lost to %s from link-up plays net_down', (to) => {
    expect(cuesFor({ net: { state: 'link-up' } }, { net: { state: to } })).toEqual(['net_down']);
  });

  it('link lost to down from saturated plays net_down', () => {
    expect(cuesFor({ net: { state: 'saturated' } }, { net: { state: 'down' } })).toEqual(['net_down']);
  });

  it('a change between two down-like states (no-device to no-cable) plays nothing', () => {
    expect(cuesFor({ net: { state: 'no-device' } }, { net: { state: 'no-cable' } })).toEqual([]);
  });
});

describe('state rules: boot, error, PSU trip, key out', () => {
  it('POST plays post_boot when the phase enters posting', () => {
    expect(cuesFor({ phase: 'off' }, { phase: 'posting' })).toEqual(['post_boot']);
  });

  it('POST, then idle-os plays boot_ready once; an idle-os return after a job plays nothing', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onSnapshot(snap({ phase: 'off' }));
    d.onSnapshot(snap({ phase: 'posting' }));
    d.onSnapshot(snap({ phase: 'booting-os' }));
    f.plays.length = 0;
    d.onSnapshot(snap({ phase: 'idle-os' }));
    expect(f.ids()).toEqual(['boot_ready']);
    f.plays.length = 0;
    d.onSnapshot(snap({ phase: 'running' }));
    d.onSnapshot(snap({ phase: 'idle-os' }));
    expect(f.ids()).toEqual([]);
  });

  it('loading to running plays nothing when no POST ran before it', () => {
    expect(cuesFor({ phase: 'loading' }, { phase: 'running' })).toEqual([]);
  });

  it('POST, then running plays boot_ready once; a later loading to running plays nothing', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onSnapshot(snap({ phase: 'off' }));
    d.onSnapshot(snap({ phase: 'posting' }));
    d.onSnapshot(snap({ phase: 'running' }));
    expect(f.ids()).toEqual(['post_boot', 'boot_ready']);
    f.plays.length = 0;
    d.onSnapshot(snap({ phase: 'loading' }));
    d.onSnapshot(snap({ phase: 'running' }));
    expect(f.ids()).toEqual([]);
  });

  it('POST, then running plays boot_ready once; a later idle-os entry (second OS job) plays nothing', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onSnapshot(snap({ phase: 'off' }));
    d.onSnapshot(snap({ phase: 'posting' }));
    d.onSnapshot(snap({ phase: 'running' }));
    expect(f.ids()).toEqual(['post_boot', 'boot_ready']);
    f.plays.length = 0;
    d.onSnapshot(snap({ phase: 'booting-os' }));
    d.onSnapshot(snap({ phase: 'idle-os' }));
    expect(f.ids()).toEqual([]);
  });

  it('idle-os without a prior POST plays nothing', () => {
    expect(cuesFor({ phase: 'running' }, { phase: 'idle-os' })).toEqual([]);
    expect(cuesFor({ phase: 'booting-os' }, { phase: 'idle-os' })).toEqual([]);
  });

  it('error (no fault note) plays fault_hard', () => {
    expect(cuesFor({ phase: 'running' }, { phase: 'error' })).toEqual(['fault_hard']);
  });

  it('PSU trip (power.tripped false to true, no fault note) plays fault_hard', () => {
    expect(cuesFor({ power: { tripped: false } }, { power: { tripped: true } })).toEqual(['fault_hard']);
  });

  it('key out (plugged key to none) plays key_eject', () => {
    expect(cuesFor({ plugged: { id: 1 } }, { plugged: null })).toEqual(['key_eject']);
  });

  it('key out by keyActivity done to none plays key_eject', () => {
    expect(cuesFor({ keyActivity: 'done' }, { keyActivity: 'none' })).toEqual(['key_eject']);
  });
});

describe('state rules: skipped when a note of the same family played', () => {
  it('error with a fault note in the same snapshot plays only the note cue (one fault, not two)', () => {
    const log = [note(9, 'fault', 'POST failed')];
    expect(cuesFor({ phase: 'running' }, { phase: 'error' }, log)).toEqual(['fault_soft']);
  });

  it('PSU trip with a fault note in the same snapshot plays only the note cue', () => {
    const log = [note(9, 'fault', 'POST failed')];
    expect(cuesFor({ power: { tripped: false } }, { power: { tripped: true } }, log)).toEqual(['fault_soft']);
  });

  it('key out with a key note in the same snapshot plays only the note cue', () => {
    const log = [note(9, 'key', 'key 2 pulled before it finished')];
    expect(cuesFor({ plugged: { id: 2 } }, { plugged: null }, log)).toEqual(['key_refused']);
  });

  it('a note of another family does not skip the state rule', () => {
    const log = [note(9, 'payout', 'key 1 paid: $120')];
    expect(cuesFor({ net: { state: 'down' } }, { net: { state: 'link-up' } }, log).sort()).toEqual([
      'net_link_up',
      'payout',
    ]);
  });
});

describe('clock: speed, pause, resume and crash (onUi)', () => {
  it('speed up plays speed_up', () => {
    expect(uiCuesFor({ speed: 4 }, { speed: 16 })).toEqual(['speed_up']);
  });

  it('speed down plays speed_down', () => {
    expect(uiCuesFor({ speed: 16 }, { speed: 4 })).toEqual(['speed_down']);
  });

  it('pause (speed to 0) plays pause', () => {
    expect(uiCuesFor({ speed: 4 }, { speed: 0 })).toEqual(['pause']);
  });

  it('resume (speed from 0 to non-zero) plays resume', () => {
    expect(uiCuesFor({ speed: 0 }, { speed: 4 })).toEqual(['resume']);
  });

  it('a sim crash plays the error cue, and the pause cue too (speed to 0)', () => {
    expect(uiCuesFor({ speed: 4 }, { speed: 0, crashed: true }).sort()).toEqual(['pause', 'ui_error']);
  });
});

describe('Hold: a holder that stops the clock plays neither pause nor resume (onUi)', () => {
  it.each(['levelUp', 'tutorial'] as const)('%s hold: stopping and resuming play nothing', (hold) => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onUi(ui({ speed: 4, hold: null }));
    d.onUi(ui({ speed: 0, hold }));
    expect(f.ids()).toEqual([]);
    d.onUi(ui({ speed: 4, hold: null }));
    expect(f.ids()).toEqual([]);
    // Control: a Pause that is not a Hold still plays after the Hold, so the director does hear onUi.
    d.onUi(ui({ speed: 0, hold: null }));
    expect(f.ids()).toEqual(['pause']);
  });

  it('in-game menu: opening it plays ui_panel_open, not pause; closing it plays no resume', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onUi(ui({ speed: 4, hold: null }));
    d.onUi(ui({ speed: 0, hold: 'menu' }));
    expect(f.ids()).toEqual(['ui_panel_open']);
    f.plays.length = 0;
    d.onUi(ui({ speed: 4, hold: null }));
    expect(f.ids()).toEqual([]);
  });
});

describe('the clock and the cues', () => {
  it('a note cue still plays while the clock is stopped', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onUi(ui({ speed: 0 }));
    d.onSnapshot(snap());
    f.plays.length = 0;
    d.onSnapshot(snap({}, [note(9, 'payout', 'key 1 paid: $120')]));
    expect(f.ids()).toEqual(['payout']);
  });

  it('stopping the clock asks the sink for nothing but playCue and setKeyPc', () => {
    const plays: string[] = [];
    const base = {
      playCue(id: string) {
        plays.push(id);
      },
      setKeyPc() {},
    };
    // A sink with any other method (suspend, stop, ...) throws on access, so the test fails on such a call.
    const sink = new Proxy(base, {
      get(t, p) {
        if (typeof p === 'string' && !(p in t)) throw new Error(`unexpected sink call: ${p}`);
        return (t as Record<string | symbol, unknown>)[p];
      },
    }) as unknown as CueSink;
    const d = createDirector(sink);
    d.onSnapshot(snap());
    d.onUi(ui({ speed: 4 }));
    d.onUi(ui({ speed: 0 }));
    d.onSnapshot(snap({ net: { state: 'link-up' } }));
    expect(plays).toEqual(['pause', 'net_link_up']);
  });
});

describe('the first snapshot, the first UI input and a reset', () => {
  it('the first snapshot plays no state cue, even if the state reads as a change', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onSnapshot(snap({ phase: 'posting', net: { state: 'link-up' } }));
    expect(f.plays).toEqual([]);
  });

  it('the first UI input plays no cue, even a crash', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onUi(ui({ speed: 0, hold: 'menu', crashed: true }));
    expect(f.plays).toEqual([]);
  });

  it('after reset, the next snapshot is the first again and plays no state cue', () => {
    const f = fakeSink();
    const d = createDirector(f.sink);
    d.onSnapshot(snap());
    d.reset();
    f.plays.length = 0;
    d.onSnapshot(snap({ net: { state: 'link-up' } }));
    expect(f.plays).toEqual([]);
  });
});
