// Load file (ticket #37; SPEC §5.5). A readable file opens the Load confirm screen and starts nothing until the player answers it. An
// unreadable file gives no question and a toast. Written before the coder's changes: the first rule fails until they land.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';

vi.mock('@/app/store', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/store')>()), startSim: vi.fn() }));
vi.mock('./Confirm', () => ({ askConfirm: vi.fn() }));

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
