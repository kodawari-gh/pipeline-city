import { describe, expect, it } from 'vitest';
import type { Progress } from '../sim/game/save';
import { newProgress } from '../sim/game/save';
import {
  currentStep, effectiveProgress, INITIAL_TUTORIAL, resumeState, STEPS, stepCount, stepProblem, type TutorialState,
} from './tutorial';
import { dev, key, snap, STARTER_CRATE } from './testdata';

const welcomed: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
/** Flags set in the order the player meets them (the tutorial's own order). */
const FLAGS_IN_ORDER: Array<keyof Progress> = [
  'cpuInstalled', 'ramInstalled', 'psuInstalled', 'monitorInstalled', 'atxConnected', 'cpuPowerConnected',
  'videoConnected', 'poweredOn', 'firstKeyPlugged', 'firstJobDone', 'firstKeyEjected', 'firstPurchase',
];
const upTo = (n: number): Progress => {
  const p = newProgress(false);
  for (const f of FLAGS_IN_ORDER.slice(0, n)) p[f] = true;
  return p;
};
const idOf = (s: ReturnType<typeof currentStep>) => s?.id ?? null;

describe('tutorial step from snapshot flags', () => {
  it('a new game opens on the welcome card', () => {
    expect(idOf(currentStep(snap(), INITIAL_TUTORIAL))).toBe('welcome');
  });

  it('after welcome, with nothing done, it asks for the processor', () => {
    expect(idOf(currentStep(snap(), welcomed))).toBe('cpu');
  });

  it('walks the steps in order as flags come in', () => {
    const order = ['cpu', 'ram', 'psu', 'monitor', 'atx', 'cpuPower', 'video', 'power', 'plugKey', 'watch', 'removeKey', 'spend', 'done'];
    for (let n = 0; n < FLAGS_IN_ORDER.length; n++) {
      expect(idOf(currentStep(snap({ progress: upTo(n) }), welcomed)), `after ${n} flags`).toBe(order[n]);
    }
  });

  it('the final card (done) shows once everything is done', () => {
    expect(idOf(currentStep(snap({ progress: upTo(12) }), welcomed))).toBe('done');
  });

  it('skipped and finished tutorials show nothing', () => {
    expect(currentStep(snap(), { ...welcomed, skipped: true })).toBeNull();
    expect(currentStep(snap(), { ...welcomed, finished: true })).toBeNull();
  });

  it('resumes mid-way from a loaded save, without the welcome card again', () => {
    // A save where the CPU, RAM, PSU, monitor and ATX cable are already in: resume at the CPU power cable.
    const s = snap({ progress: upTo(5) });
    const step = currentStep(s, INITIAL_TUTORIAL);
    expect(step?.id).toBe('cpuPower');
    expect(stepCount(step!)).toEqual({ n: 6, total: 12 });
  });

  it('out of order: parts placed before the earlier ones are skipped past, not repeated', () => {
    // The player installs the PSU and monitor first. The CPU is still the first thing to ask for.
    const p = newProgress(false);
    p.psuInstalled = true;
    p.monitorInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cpu');
    // Then the CPU and RAM: the next open step is the ATX cable, not the PSU again.
    p.cpuInstalled = true;
    p.ramInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('atx');
  });

  it('out of order: a job served before the power was ever pressed still points at the power button', () => {
    const p = newProgress(false);
    p.firstKeyPlugged = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cpu');
  });

  it('a save migrated from v1 (all progress set) shows only the final card', () => {
    expect(idOf(currentStep(snap({ progress: newProgress(true) }), welcomed))).toBe('done');
  });

  it('every flag-driven step names a real progress key, and the card step ids are unique', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STEPS) if (s.flag) expect(FLAGS_IN_ORDER).toContain(s.flag);
  });
});

describe('replay', () => {
  // Replay: every flag is already true in the save, so the steps are judged from live state and deltas.
  const replay: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true, replay: { completed: 2, owned: 5 } };

  it('judges installs from live state, not the sticky flags', () => {
    const s = snap({ progress: newProgress(true), devices: [] });
    expect(idOf(currentStep(s, replay))).toBe('cpu');
  });

  it('a part that is installed right now is skipped', () => {
    const s = snap({ progress: newProgress(true), devices: [dev({ kind: 'cpu' })] });
    expect(idOf(currentStep(s, replay))).toBe('ram');
  });

  it('a new key ejected since the replay started finishes the removal step', () => {
    const s = snap({ progress: newProgress(true), completed: 3 });
    const p = effectiveProgress(s, replay);
    expect(p.firstKeyEjected).toBe(true);
    expect(p.firstPurchase).toBe(false);
  });

  it('a purchase since the replay started counts', () => {
    const s = snap({ progress: newProgress(true), inventory: [...STARTER_CRATE, { ...STARTER_CRATE[0]!, id: 'inv9' }] });
    expect(effectiveProgress(s, { ...replay, replay: { completed: 0, owned: 5 } }).firstPurchase).toBe(true);
  });

  it('a replay does not show the welcome card a second time once welcomed', () => {
    const s = snap({ progress: newProgress(true) });
    expect(idOf(currentStep(s, { ...replay, welcomed: true }))).not.toBe('welcome');
  });
});

describe('effectiveProgress', () => {
  it('uses the sticky flags outside a replay', () => {
    const p = upTo(3);
    expect(effectiveProgress(snap({ progress: p }), INITIAL_TUTORIAL)).toEqual(p);
  });

  it('a plugged key that is already done counts as the job done', () => {
    const k = key({ done: true });
    const p = effectiveProgress(snap({ plugged: k }), { ...INITIAL_TUTORIAL, replay: { completed: 0, owned: 5 } });
    expect(p.firstKeyPlugged).toBe(true);
    expect(p.firstJobDone).toBe(true);
  });
});

describe('stepProblem: why a step is stuck, in the sim\'s own words', () => {
  it('the CPU step explains a refusal when the machine is on', () => {
    const s = snap({ powered: true, phase: 'waiting-for-key' });
    expect(stepProblem(s, STEPS.find((x) => x.id === 'cpu')!)).toMatch(/Press the power button to switch it off/);
  });

  it('the cable step shows the cable\'s blocked reason', () => {
    expect(stepProblem(snap(), STEPS.find((x) => x.id === 'atx')!)).toMatch(/power supply is not installed/);
  });

  it('the power step shows the power button refusal', () => {
    expect(stepProblem(snap(), STEPS.find((x) => x.id === 'power')!)).toMatch(/Install a power supply/);
  });

  it('the key step waits for a key, then asks for power', () => {
    const plug = STEPS.find((x) => x.id === 'plugKey')!;
    expect(stepProblem(snap(), plug)).toMatch(/No key yet/);
    expect(stepProblem(snap({ tray: [key()] }), plug)).toMatch(/machine is off/);
    expect(stepProblem(snap({ tray: [key()], powered: true }), plug)).toBeNull();
  });

  it('no problem on the welcome card', () => {
    expect(stepProblem(snap(), STEPS[0]!)).toBeNull();
  });
});

describe('step targets (what the renderer pulses)', () => {
  it('installing the CPU pulses its crate item and the socket it fits', () => {
    const cpu = STEPS.find((x) => x.id === 'cpu')!;
    expect(cpu.targets(snap())).toEqual(['inv:inv1', 'cpu0']);
  });

  it('no step points at the old crate: the welcome card highlights the inventory button', () => {
    for (const step of STEPS) {
      expect(step.targets(snap({ devices: [dev()] })), step.id).not.toContain('crate');
    }
    expect(STEPS[0]!.targets(snap())).toEqual(['inventory']);
  });

  it('install steps point at their inventory items (inv:) and the socket, and the last card points at the new part', () => {
    expect(STEPS.find((x) => x.id === 'ram')!.targets(snap())).toEqual(['inv:inv3', 'dimm0', 'dimm1']);
    expect(STEPS.find((x) => x.id === 'spend')!.targets(snap())).toEqual(['inventory']);
    expect(STEPS.find((x) => x.id === 'done')!.targets(snap())).toEqual(['inv:inv1']);
  });

  it('the welcome and last cards tell the player to open the inventory and drag parts from it', () => {
    expect(STEPS[0]!.text).toMatch(/open the inventory/i);
    expect(STEPS.find((x) => x.id === 'cpu')!.text).toMatch(/inventory/);
    for (const step of STEPS) expect(step.text, step.id).not.toMatch(/\bcrate\b/i);
  });

  it('the power step pulses the button; the key step pulses the USB port and the key', () => {
    expect(STEPS.find((x) => x.id === 'power')!.targets(snap())).toEqual(['power']);
    expect(STEPS.find((x) => x.id === 'plugKey')!.targets(snap({ tray: [key({ id: 9 })] }))).toEqual(['usb', 'key:9']);
  });
});

describe('persisted tutorial state', () => {
  it('reads a stored object and ignores junk', () => {
    expect(resumeState({ welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 } })).toEqual({
      welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 },
    });
    expect(resumeState('nonsense')).toEqual(INITIAL_TUTORIAL);
    expect(resumeState({ replay: { completed: 'x' } })).toEqual({ ...INITIAL_TUTORIAL, replay: null });
  });
});
