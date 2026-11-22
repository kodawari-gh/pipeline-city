// Ticket #58: room ambience and the machine hum, seen through the director (director.ts) with a fake backend.
// The fake records every cue and every ambience call in order. Covers: hum powered and unpowered; hum gain and rate from the
// mean fan speed (0.5 with no fans), smoothed over 800 ms; the hum dips 4 dB while the clock is stopped (Pause or
// Hold); the room loop before and after the unlock gesture; the room loop in the room scene, not the studios.
// Values come from MIX (mix tokens), never typed in here.
import { describe, expect, it } from 'vitest';
import { createDirector, type DirectorSnap, type UiInput } from './director';
import { MIX } from './mixTokens';

type LoopId = 'amb_room_city_loop' | 'amb_machine_hum_loop';

/** The snapshot fields the ambience rules read. */
interface AmbSnap {
  powered: boolean;
  devices: { fan?: number }[];
}

type Call =
  | { kind: 'cue'; id: string }
  | { kind: 'loop'; id: LoopId; op: 'start'; fadeInMs: number }
  | { kind: 'loop'; id: LoopId; op: 'stop'; fadeOutMs: number }
  | { kind: 'hum'; gainDb: number; rate: number; smoothMs: number }
  | { kind: 'humDuck'; gainDb: number; fadeMs: number };

function fakeBackend() {
  const calls: Call[] = [];
  const sink = {
    playCue(id: string) {
      calls.push({ kind: 'cue', id });
    },
    setKeyPc() {},
    // Ambience (round 1): the loops start and stop with a fade, the hum follows the fans, the clock ducks the hum.
    startLoop(id: LoopId, fadeInMs: number) {
      calls.push({ kind: 'loop', id, op: 'start', fadeInMs });
    },
    stopLoop(id: LoopId, fadeOutMs: number) {
      calls.push({ kind: 'loop', id, op: 'stop', fadeOutMs });
    },
    setHum(gainDb: number, rate: number, smoothMs: number) {
      calls.push({ kind: 'hum', gainDb, rate, smoothMs });
    },
    duckHum(gainDb: number, fadeMs: number) {
      calls.push({ kind: 'humDuck', gainDb, fadeMs });
    },
  };
  return {
    sink,
    calls,
    loops: (id: LoopId) => calls.filter((c) => c.kind === 'loop' && c.id === id),
    hums: () => calls.filter((c): c is Extract<Call, { kind: 'hum' }> => c.kind === 'hum'),
    ducks: () => calls.filter((c): c is Extract<Call, { kind: 'humDuck' }> => c.kind === 'humDuck'),
  };
}

const ROOM = 'amb_room_city_loop' as const;
const HUM = 'amb_machine_hum_loop' as const;
const FAN = MIX.ambience[HUM].fanFollow;
const PAUSE_DB = MIX.pause.ambienceGainDb[HUM];
const PAUSE_FADE = MIX.pause.fadeMs;

/** The hum gain and rate that the fan follow token gives for a mean fan speed x (0..1). */
const humAt = (x: number) => ({
  gainDb: FAN.gainDbAt0 + (FAN.gainDbAt1 - FAN.gainDbAt0) * x,
  rate: FAN.rateAt0 + (FAN.rateAt1 - FAN.rateAt0) * x,
});

const snap = (powered: boolean, devices: { fan?: number }[] = []): DirectorSnap & AmbSnap => ({
  log: [],
  level: { level: 1 },
  powered,
  devices,
});

const UI_RUNNING: UiInput = { speed: 1, hold: null, crashed: false };

function setup() {
  const b = fakeBackend();
  const d = createDirector(b.sink);
  return { b, d };
}

describe('ambience: machine hum while powered', () => {
  it('powered: the hum loop starts with a 1.2 s fade in, once', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(false));
    d.onSnapshot(snap(true));
    d.onSnapshot(snap(true));
    const starts = b.loops(HUM).filter((c) => c.kind === 'loop' && c.op === 'start');
    expect(starts).toEqual([{ kind: 'loop', id: HUM, op: 'start', fadeInMs: MIX.ambience[HUM].fadeInMs }]);
    expect(MIX.ambience[HUM].fadeInMs).toBe(1200);
  });

  it('unpowered from the start: no hum loop plays', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(false));
    d.onSnapshot(snap(false));
    expect(b.loops(HUM)).toEqual([]);
  });

  it('powered, then unpowered: the hum loop stops with a 0.9 s fade out', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true));
    d.onSnapshot(snap(false));
    const stops = b.loops(HUM).filter((c) => c.kind === 'loop' && c.op === 'stop');
    expect(stops).toEqual([{ kind: 'loop', id: HUM, op: 'stop', fadeOutMs: MIX.ambience[HUM].fadeOutMs }]);
    expect(MIX.ambience[HUM].fadeOutMs).toBe(900);
  });
});

describe('ambience: hum follows the mean fan speed', () => {
  it('no device has a fan: the hum uses x = 0.5', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true, [{}, {}]));
    const want = humAt(0.5);
    expect(b.hums().at(-1)).toEqual({ kind: 'hum', gainDb: want.gainDb, rate: want.rate, smoothMs: 800 });
  });

  it('the mean covers only the devices that have fans (a fanless device is not 0)', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true, [{ fan: 0.8 }, { fan: 0.4 }, {}]));
    const want = humAt(0.6);
    expect(b.hums().at(-1)).toEqual({ kind: 'hum', gainDb: want.gainDb, rate: want.rate, smoothMs: 800 });
  });

  it('a fan change moves the hum to the new mean, smoothed over 800 ms', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true, [{ fan: 0.2 }]));
    d.onSnapshot(snap(true, [{ fan: 1 }]));
    const last = b.hums().at(-1)!;
    const want = humAt(1);
    expect(last.gainDb).toBeCloseTo(want.gainDb, 9);
    expect(last.rate).toBeCloseTo(want.rate, 9);
    expect(last.smoothMs).toBe(800);
    expect(FAN.smoothMs).toBe(800);
  });
});

describe('ambience: the clock stopped dips the hum', () => {
  it('Pause (speed 0): the hum drops 4 dB over the pause fade, and comes back on resume', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true));
    d.onUi(UI_RUNNING);
    d.onUi({ ...UI_RUNNING, speed: 0 });
    expect(b.ducks().at(-1)).toEqual({ kind: 'humDuck', gainDb: PAUSE_DB, fadeMs: PAUSE_FADE });
    expect(PAUSE_DB).toBe(-4);
    d.onUi(UI_RUNNING);
    expect(b.ducks().at(-1)).toEqual({ kind: 'humDuck', gainDb: 0, fadeMs: PAUSE_FADE });
  });

  it('a Hold (level-up popup) stops the clock: the hum drops 4 dB too', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true));
    d.onUi(UI_RUNNING);
    d.onUi({ speed: 0, hold: 'levelUp', crashed: false });
    expect(b.ducks().at(-1)).toEqual({ kind: 'humDuck', gainDb: PAUSE_DB, fadeMs: PAUSE_FADE });
  });

  it('the clock running: the hum is not ducked', () => {
    const { b, d } = setup();
    d.onSnapshot(snap(true));
    d.onUi(UI_RUNNING);
    d.onUi({ ...UI_RUNNING, speed: 2 });
    expect(b.ducks()).toEqual([]);
  });
});

describe('ambience: room loop', () => {
  it('before the unlock gesture: the room scene plays no room loop', () => {
    const { b, d } = setup();
    d.onScene('menu');
    d.onSnapshot(snap(false));
    expect(b.loops(ROOM)).toEqual([]);
  });

  it('after the unlock: the room loop starts with a 2 s fade in, in the menu', () => {
    const { b, d } = setup();
    d.onScene('menu');
    d.onUnlock();
    expect(b.loops(ROOM)).toEqual([{ kind: 'loop', id: ROOM, op: 'start', fadeInMs: MIX.ambience[ROOM].fadeInMs }]);
    expect(MIX.ambience[ROOM].fadeInMs).toBe(2000);
  });

  it('the unlock before the scene: the room loop starts when the room scene shows', () => {
    const { b, d } = setup();
    d.onUnlock();
    expect(b.loops(ROOM)).toEqual([]);
    d.onScene('game');
    expect(b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'start')).toHaveLength(1);
  });
});

describe('ambience: room scene, not the studios', () => {
  it('the game plays the room loop; the build and gallery studios do not', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('build');
    expect(b.loops(ROOM)).toEqual([]);
    d.onScene('gallery');
    expect(b.loops(ROOM)).toEqual([]);
    d.onScene('game');
    expect(b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'start')).toHaveLength(1);
  });

  it('leaving the room scene for a studio fades the room loop out in 1.5 s; coming back fades it in again', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    d.onScene('build');
    const stops = b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'stop');
    expect(stops).toEqual([{ kind: 'loop', id: ROOM, op: 'stop', fadeOutMs: MIX.ambience[ROOM].fadeOutMs }]);
    expect(MIX.ambience[ROOM].fadeOutMs).toBe(1500);
    d.onScene('game');
    const starts = b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'start');
    expect(starts).toHaveLength(2);
  });

  it('the menu and the game are one room scene: moving between them does not restart the loop', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    d.onScene('game');
    d.onScene('menu');
    expect(b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'start')).toHaveLength(1);
    expect(b.loops(ROOM).filter((c) => c.kind === 'loop' && c.op === 'stop')).toEqual([]);
  });
});
