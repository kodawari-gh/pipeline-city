// Load file (ticket #37; SPEC §5.5). A readable file opens the Load confirm screen and starts nothing until the player answers it. An
// unreadable file gives no question and a toast. Written before the coder's changes: the first rule fails until they land.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

vi.mock('@/app/store', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/store')>()), startSim: vi.fn() }));
vi.mock('./Confirm', () => ({ askConfirm: vi.fn() }));
vi.mock('../leave', () => ({ leaveGame: vi.fn() }));

let loadFromFile: typeof import('@/core/ui/panels/loadgame').loadFromFile;
let store: typeof import('@/app/store');

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  });
  ({ loadFromFile } = await import('@/core/ui/panels/loadgame'));
  store = await import('@/app/store');
  store.autosaveOffer.value = null;
  store.lastError.value = null;
});

const goodFile = () => new File([JSON.stringify(new Game({ seed: 7 }).toSave())], 'save.json', { type: 'application/json' });

describe('Load file', () => {
  it('an unreadable file starts nothing and says why in the toast', async () => {
    await loadFromFile(new File(['not json'], 'bad.json', { type: 'application/json' }));
    expect(vi.mocked(store.startSim)).not.toHaveBeenCalled();
    expect(store.lastError.value).toMatch(/not a Pipeline City save/);
  });

  it('a readable file starts nothing until the Load confirm screen is answered (no autosave)', async () => {
    await loadFromFile(goodFile());
    expect(vi.mocked(store.startSim)).not.toHaveBeenCalled();
  });

  it('a readable file starts nothing until the Load confirm screen is answered (with an autosave)', async () => {
    store.autosaveOffer.value = JSON.parse(JSON.stringify(new Game({ seed: 3 }).toSave()));
    await loadFromFile(goodFile());
    expect(vi.mocked(store.startSim)).not.toHaveBeenCalled();
  });
});

// Corrupt or incompatible save (ticket #45): no Load confirm screen opens, the game does not start, and the player stays on the menu with a
// plain message that says what to do next.
describe('a corrupt or incompatible save file', () => {
  const badFiles = {
    'not JSON': 'not json',
    'JSON of the wrong shape': '{"version": 99}',
  };
  for (const [name, body] of Object.entries(badFiles)) {
    it(`(${name}) opens no Load confirm screen and starts nothing`, async () => {
      const { loadOffer } = await import('@/core/ui/panels/loadgame');
      await loadFromFile(new File([body], 'bad.json', { type: 'application/json' }));
      expect(loadOffer.value).toBeNull();
      expect(vi.mocked(store.startSim)).not.toHaveBeenCalled();
    });

    it(`(${name}) shows a plain message with a way forward, not the raw error`, async () => {
      const { friendlyError } = await import('@/core/ui/logic');
      await loadFromFile(new File([body], 'bad.json', { type: 'application/json' }));
      const shown = friendlyError(store.lastError.value ?? '');
      expect(shown).not.toMatch(/^Not now:/);
      expect(shown).toMatch(/pick|choose|another|menu|try/i);
    });
  }
});

// A bad file while a game is on screen ends the game, so the player is back at the main menu (ticket #45). With no game running, nothing ends.
describe('a bad save file and the main menu', () => {
  const bad = () => new File(['not json'], 'bad.json', { type: 'application/json' });

  it('returns the player to the menu when a game is running', async () => {
    const { leaveGame } = await import('../leave');
    store.snapshot.value = new Game({ seed: 7 }).snapshot() as Snapshot;
    await loadFromFile(bad());
    expect(vi.mocked(leaveGame)).toHaveBeenCalledTimes(1);
  });

  it('does not end anything when no game is running', async () => {
    const { leaveGame } = await import('../leave');
    store.snapshot.value = null;
    await loadFromFile(bad());
    expect(vi.mocked(leaveGame)).not.toHaveBeenCalled();
  });
});
