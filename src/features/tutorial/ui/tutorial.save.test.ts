// Regression tests: the tutorial's per-viewer state travels inside saves (saveHooks), so loading a save resumes it
// whatever this browser held before. See the review of "tutorial cut off / reload a save mid-tutorial".
import { assert, beforeAll, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import { parseSave } from '@/worker/game/save';
import { INITIAL_TUTORIAL, currentStep } from './tutorial';
import type * as tutorialTypes from './tutorial';
import type * as stateApi from '@/core/ui/state';
import type * as storeApi from '@/app/store';

type State = typeof stateApi;
type Store = typeof storeApi;
const noop = (): void => {
  // the tests draw nothing
};
let st: State;
let store: Store;

beforeAll(async () => {
  // state.ts touches the DOM and localStorage at import; the tests run in node.
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: noop,
      style: { setProperty: noop },
      classList: { toggle: noop, add: noop, remove: noop },
    },
  });
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
});

const freshSave = () => new Game({ seed: 7 }).toSave();
/** Through JSON text and back, as a save file goes. */
const roundTrip = (save: ReturnType<typeof freshSave>) => {
  const text = JSON.stringify(save);
  return parseSave(JSON.parse(text));
};
const set = (t: tutorialTypes.TutorialState) => {
  st.tutorial.value = t;
};

describe('tutorial state travels with the save', () => {
  it('attach writes the current state into the save, and it survives JSON and parseSave', () => {
    set({ ...INITIAL_TUTORIAL, welcomed: true, acks: ['money', 'reputation'], osLesson: true, offered: true });
    const saved = roundTrip(store.saveHooks.attach(freshSave()));
    expect(saved.tutorial).toStrictEqual({
      ...INITIAL_TUTORIAL,
      welcomed: true,
      acks: ['money', 'reputation'],
      osLesson: true,
      offered: true,
    });
  });

  it('a save with the field still loads into a game (the sim ignores it)', () => {
    const saved = roundTrip(store.saveHooks.attach(freshSave()));
    expect(() => Game.fromSave(saved)).not.toThrow();
  });

  it('loading a save replaces a skipped or finished state left by another game', () => {
    set({ ...INITIAL_TUTORIAL, welcomed: true, acks: ['money'] });
    const mid = roundTrip(store.saveHooks.attach(freshSave()));
    set({ ...INITIAL_TUTORIAL, skipped: true, finished: true, osLesson: true, offered: true });
    store.saveHooks.restore(mid);
    expect(st.tutorial.value).toStrictEqual({ ...INITIAL_TUTORIAL, welcomed: true, acks: ['money'] });
  });

  it('loading drops a replay baseline that belonged to another game', () => {
    set({ ...INITIAL_TUTORIAL, welcomed: true, replay: { completed: 9, owned: 30 } });
    const other = roundTrip(store.saveHooks.attach(freshSave())); // saved in a replaying game
    set({ ...INITIAL_TUTORIAL });
    const noReplay = { ...other, tutorial: { ...INITIAL_TUTORIAL, welcomed: true } };
    store.saveHooks.restore(noReplay);
    expect(st.tutorial.value.replay).toBeNull();
  });

  it('restore also persists to localStorage, so a page reload keeps it', () => {
    const save = { ...freshSave(), tutorial: { ...INITIAL_TUTORIAL, welcomed: true, skipped: true } };
    store.saveHooks.restore(save);
    const getItemResult = localStorage.getItem('pipeline-city.tutorial');
    assert.exists(getItemResult);
    expect(JSON.parse(getItemResult)).toMatchObject({
      welcomed: true,
      skipped: true,
    });
  });

  it('a skipped tutorial stays skipped after a save and load', () => {
    set({ ...INITIAL_TUTORIAL, skipped: true });
    const saved = roundTrip(store.saveHooks.attach(freshSave()));
    set({ ...INITIAL_TUTORIAL, welcomed: true });
    store.saveHooks.restore(saved);
    const g = Game.fromSave(saved);
    expect(currentStep(g.snapshot(), st.tutorial.value)).toBeNull();
  });
});

describe('saves from before the field existed', () => {
  it('a mid-OS-lesson save resumes the lesson on a browser that never saw the tutorial', () => {
    const save = freshSave();
    const old = {
      ...save,
      progress: {
        ...save.progress,
        cpuInstalled: true,
        psuInstalled: true,
        ramInstalled: true,
        monitorInstalled: true,
        atxConnected: true,
        cpuPowerConnected: true,
        videoConnected: true,
        poweredOn: true,
        firstKeyPlugged: true,
        firstJobDone: true,
        firstKeyEjected: true,
        firstPurchase: true,
        storageInstalled: true,
      },
    };
    delete (old as { tutorial?: unknown }).tutorial;
    set({ ...INITIAL_TUTORIAL, skipped: true }); // junk left by another game
    store.saveHooks.restore(old);
    expect(st.tutorial.value).toMatchObject({ welcomed: true, skipped: false, finished: false, osLesson: true });
    const step = currentStep(Game.fromSave(old).snapshot(), st.tutorial.value);
    expect(step?.id).not.toBe('welcome');
  });

  it('a brand-new campaign save starts at the welcome card', () => {
    store.saveHooks.restore(freshSave());
    const snapshot = Game.fromSave(freshSave()).snapshot();
    expect(currentStep(snapshot, st.tutorial.value)?.id).toBe('welcome');
  });
});
