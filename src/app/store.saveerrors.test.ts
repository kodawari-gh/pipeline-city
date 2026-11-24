// Save, load and offline errors (ticket #45): each one says in plain words what happened and gives a next step, and the player can always go back to
// the menu. No DOM: the sim worker is a stand-in, and `document` does not exist (so a download fails, as when the browser blocks it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import { friendlyError } from '@/core/ui/logic';
import { booted } from './boot';
import {
  exportSave,
  lastError,
  leaveSim,
  online,
  readSaveFile,
  setOnline,
  snapshot,
  startSim,
  starting,
  watchConnection,
} from './store';

class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  sent: Array<{ type: string }> = [];
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: { type: string }): void {
    this.sent.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const NEXT_STEP = /pick|choose|another|menu|try|reload|reconnect|start a game|check/i;
const shown = () => friendlyError(lastError.value ?? '');
const file = (body: string) => new File([body], 'save.json', { type: 'application/json' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  FakeWorker.made = [];
  booted.value = true;
  starting.value = false;
  lastError.value = null;
  snapshot.value = null;
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A game on screen: the sim has sent its first snapshot. */
function runGame(): FakeWorker {
  startSim(null);
  const w = FakeWorker.made.at(-1)!;
  snapshot.value = new Game({ seed: 7 }).snapshot() as never;
  return w;
}

describe('a save file that cannot be read', () => {
  it('(not JSON) says so, and gives a way forward', async () => {
    expect(await readSaveFile(file('not json'))).toBeNull();
    expect(shown()).toMatch(/not a Pipeline City save/i);
    expect(shown()).toMatch(NEXT_STEP);
    expect(shown()).not.toMatch(/^Not now:/);
  });

  it('(wrong shape) says it may be another version, leaves the save alone, and gives a way forward', async () => {
    expect(await readSaveFile(file('{"version": 99}'))).toBeNull();
    expect(shown()).toMatch(/another version|damaged/i);
    expect(shown()).toMatch(/unchanged/i);
    expect(shown()).toMatch(NEXT_STEP);
    expect(shown()).not.toMatch(/^Not now:/);
  });

  it('(JSON that is not an object) is a corrupt save, with a way forward', async () => {
    for (const body of ['null', '[]', '42', '"save"']) {
      lastError.value = null;
      expect(await readSaveFile(file(body))).toBeNull();
      expect(shown()).toMatch(NEXT_STEP);
    }
  });

  it('the two messages differ, so the player learns which problem it is', async () => {
    await readSaveFile(file('not json'));
    const a = shown();
    await readSaveFile(file('{"version": 99}'));
    expect(shown()).not.toBe(a);
  });
});

describe('export', () => {
  it('with no game running, says so and tells the player to start one', () => {
    exportSave();
    expect(shown()).toMatch(/not running/i);
    expect(shown()).toMatch(/start a game/i);
    expect(shown()).toMatch(/unchanged/i);
  });

  it('when the download fails, says the save is unchanged and gives a way forward', () => {
    const w = runGame();
    exportSave();
    // the sim answers the save request; the download then fails (no `document` here)
    w.onmessage?.({ data: { type: 'saved', save: new Game({ seed: 7 }).toSave() } });
    expect(shown()).toMatch(/could not be saved/i);
    expect(shown()).toMatch(/unchanged/i);
    expect(shown()).toMatch(/try again|check your download settings/i);
    expect(shown()).not.toMatch(/^Not now:/);
  });
});

describe('offline', () => {
  it('shows the offline state (the online flag) and a notice with a way forward', () => {
    expect(online.value).toBe(true);
    setOnline(false);
    expect(online.value).toBe(false);
    expect(shown()).toMatch(/offline/i);
    expect(shown()).toMatch(/still runs/i);
    expect(shown()).toMatch(/reconnect|reload/i);
    expect(shown()).not.toMatch(/^Not now:/);
  });

  it('going back online clears the offline notice, and only that notice', () => {
    setOnline(false);
    setOnline(true);
    expect(online.value).toBe(true);
    expect(lastError.value).toBeNull();
    lastError.value = 'say: Some other problem.';
    setOnline(true);
    expect(lastError.value).toBe('say: Some other problem.');
  });

  it('a page that opens offline shows the notice at once', () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('window', {
      addEventListener: (t: string, f: () => void) => {
        listeners[t] = f;
      },
    });
    online.value = false;
    watchConnection();
    expect(shown()).toMatch(/offline/i);
    listeners.online!();
    expect(online.value).toBe(true);
    expect(lastError.value).toBeNull();
    listeners.offline!();
    expect(online.value).toBe(false);
  });
});

describe('return to the menu after each error', () => {
  // The menu is shown when no game runs: no snapshot, no worker, not "starting".
  const menuIsShown = () => {
    expect(snapshot.value).toBeNull();
    expect(starting.value).toBe(false);
  };

  it('after a bad save file read in a running game', async () => {
    const w = runGame();
    await readSaveFile(file('not json'));
    leaveSim();
    w.onmessage?.({ data: { type: 'saved', save: new Game({ seed: 7 }).toSave() } });
    await vi.runAllTimersAsync();
    menuIsShown();
    expect(w.terminated).toBe(true);
  });

  it('after a bad save file with no game running', async () => {
    await readSaveFile(file('{"version": 99}'));
    leaveSim();
    menuIsShown();
  });

  it('after a failed export', async () => {
    const w = runGame();
    exportSave();
    w.onmessage?.({ data: { type: 'saved', save: new Game({ seed: 7 }).toSave() } });
    expect(shown()).toMatch(/could not be saved/i);
    leaveSim();
    w.onmessage?.({ data: { type: 'saved', save: new Game({ seed: 7 }).toSave() } });
    await vi.runAllTimersAsync();
    menuIsShown();
    expect(w.terminated).toBe(true);
  });

  it('after a game that could not start', () => {
    startSim(null);
    const w = FakeWorker.made.at(-1)!;
    w.onerror?.();
    expect(shown()).toMatch(/could not start/i);
    leaveSim();
    menuIsShown();
    expect(w.terminated).toBe(true);
  });

  it('after the offline notice, with a game running', async () => {
    const w = runGame();
    setOnline(false);
    leaveSim();
    w.onmessage?.({ data: { type: 'saved', save: new Game({ seed: 7 }).toSave() } });
    await vi.runAllTimersAsync();
    menuIsShown();
  });

  it('a sim that does not answer cannot trap the player in the game', async () => {
    runGame();
    leaveSim();
    await vi.runAllTimersAsync();
    menuIsShown();
  });
});
