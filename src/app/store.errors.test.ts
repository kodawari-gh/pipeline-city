// The failed-start state (ticket #45): when the sim worker errors, the game says so in plain words and tells the player how to go on (reload),
// and the menu's "starting" line goes away. Written before the coder's changes: it passes only if the copy already matches. No DOM: the worker is a stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { booted } from './boot';
import { lastError, startSim, starting } from './store';

class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: unknown = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(): void {}
  terminate(): void {}
}

describe('the game fails to start', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    FakeWorker.made = [];
    booted.value = true;
    starting.value = false;
    lastError.value = null;
  });

  it('says the game could not start and how to go on (reload), and clears "starting"', () => {
    startSim(null);
    expect(starting.value).toBe(true);
    FakeWorker.made[0]!.onerror?.();
    expect(starting.value).toBe(false);
    expect(lastError.value).toMatch(/could not start/i);
    expect(lastError.value).toMatch(/reload the page and try again/i);
  });
});

// Offline (ticket #45; SPEC §5.14): with no network the menus and the game still work, so going offline gives a plain notice and a way
// forward, not a dead end. It listens for the browser's `offline` event on `window`. Written before the coder's change: it fails until the
// offline notice lands (the exact wording is the coder's; the test checks plain words and a way forward).
describe('the browser goes offline', () => {
  let offlineListeners: (() => void)[];

  beforeEach(() => {
    vi.resetModules();
    offlineListeners = [];
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'offline') offlineListeners.push(fn);
      },
      removeEventListener: () => {},
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says so in plain words, with a way forward, and not as a raw error', async () => {
    const store = await import('./store');
    const { toasts } = await import('@/core/ui/state');
    const { friendlyError } = await import('@/core/ui/logic');
    store.watchConnection(); // (main.tsx calls it once, when the page starts: importing the store alone listens to nothing)
    for (const fn of offlineListeners) fn();
    const said = [store.lastError.value && friendlyError(store.lastError.value), ...toasts.value.map((t) => t.text)]
      .filter(Boolean)
      .join(' ');
    expect(said).toMatch(/offline/i);
    expect(said).toMatch(/still|keep|menu|online|reconnect|try/i);
    expect(said).not.toMatch(/^Not now:/);
  });
});
