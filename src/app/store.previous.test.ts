// Previous save (ticket #34): New game copies the autosave it replaces to one backup key, and that backup loads in one step.
// The store is driven through its public calls only: startNewGame (New game) and startSim (a load), and the localStorage it writes.
// The backup's key name is not fixed by the ticket, so the tests find it by its content.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../worker/game/game';
import type { SaveV1 } from '../worker/protocol';
import { booted } from './boot';
import { startNewGame, startSim } from './store';

type Sent = { type: string; save?: SaveV1 | null };

/** A stand-in for the sim's worker: it keeps what it is sent. */
class FakeWorker {
  static made: FakeWorker[] = [];
  sent: Sent[] = [];
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor() { FakeWorker.made.push(this); }
  postMessage(m: Sent): void { this.sent.push(m); }
  terminate(): void {}
}

/** An in-memory localStorage, so the tests can see every key the store writes. */
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

/** A real save (the sim's own format), made after `ticks` base ticks, as the JSON text the store keeps. */
function saveText(seed: number, ticks: number): string {
  const g = new Game({ seed });
  for (let i = 0; i < ticks; i++) g.advanceBaseTick();
  return JSON.stringify(JSON.parse(JSON.stringify(g.toSave())));
}

/** The keys whose text is the given save (the backup, if any). */
const keysHolding = (text: string): string[] => [...store.entries()].filter(([, v]) => v === text).map(([k]) => k);

/** The save the last worker was started with (the `init` message's save), or undefined for a new game. */
const lastInitSave = (): SaveV1 | null | undefined => {
  const init = FakeWorker.made.at(-1)?.sent.find((m) => m.type === 'init');
  return init?.save;
};

describe('Previous save: the backup of the autosave New game replaces', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // (a running game saves on a timer)
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('localStorage', fakeStorage);
    FakeWorker.made = [];
    store.clear();
    booted.value = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('no backup exists until New game replaces an autosave; then the backup holds the old save', () => {
    const old = saveText(3, 0);
    store.set('pipeline-city.autosave', old);
    store.set('pipeline-city.autosave.at', String(Date.now()));
    expect(keysHolding(old)).toEqual(['pipeline-city.autosave']); // before New game: only the autosave holds it

    startNewGame(); // New game

    const backups = keysHolding(old).filter((k) => k !== 'pipeline-city.autosave');
    expect(backups).toHaveLength(1);
    expect(JSON.parse(store.get(backups[0]!)!)).toEqual(JSON.parse(old));
  });

  it('no backup is made when there is no autosave to replace', () => {
    startNewGame(); // New game with nothing saved

    expect(store.size).toBe(0);
    expect(FakeWorker.made).toHaveLength(1); // the game still starts
  });

  it('the backup loads in one step: the old game starts from it with no other call', () => {
    const old = saveText(3, 0);
    store.set('pipeline-city.autosave', old);
    startNewGame(); // New game copies the old autosave

    const backupKey = keysHolding(old).find((k) => k !== 'pipeline-city.autosave')!;
    const backup = JSON.parse(store.get(backupKey)!) as SaveV1;
    startSim(backup); // the one click on Previous save

    expect(FakeWorker.made).toHaveLength(2);
    expect(lastInitSave()).toEqual(JSON.parse(old));
  });
});
