// The game starts a menu choice made while the world still loads (the menu stands over the boot screen), `startSim`. No DOM: the worker is a stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { booted } from './boot';
import { snapshot, startSim, starting } from './store';

type Sent = { type: string; sandbox?: boolean };

/** A stand-in for the sim's worker: it keeps what it is sent. */
class FakeWorker {
  static made: FakeWorker[] = [];
  sent: Sent[] = [];
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: Sent): void {
    this.sent.push(m);
  }
  terminate(): void {}
}

describe('startSim while the world loads', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // (a running game saves on a timer)
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.made = [];
    booted.value = false;
    starting.value = false;
    snapshot.value = null;
  });
  afterEach(() => {
    booted.value = true; // (ends a wait that is left)
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for the world: the menu shows "starting", and no worker is made yet', () => {
    startSim(null);
    expect(starting.value).toBe(true);
    expect(FakeWorker.made).toHaveLength(0);
  });

  it('starts the game once the world is there', () => {
    startSim(null, { sandbox: true });
    booted.value = true;
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.sent.find((m) => m.type === 'init')?.sandbox).toBe(true);
  });

  it('keeps the last choice when more than one is made before that', () => {
    startSim(null, { sandbox: true });
    startSim(null, { sandbox: false });
    booted.value = true;
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.sent.find((m) => m.type === 'init')?.sandbox).toBe(false);
  });

  it('starts at once when the world is there', () => {
    booted.value = true;
    startSim(null);
    expect(FakeWorker.made).toHaveLength(1);
    expect(starting.value).toBe(true);
  });
});
