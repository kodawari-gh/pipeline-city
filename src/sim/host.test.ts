import { describe, expect, it } from 'vitest';
import { advance, handleMessage, newHost } from './host';
import type { FromSim, Snapshot } from './protocol';

const types = (r: FromSim[]) => r.map((m) => m.type);

describe('host message handling', () => {
  it('errors before init', () => {
    expect(handleMessage(newHost(), { type: 'purchase', id: 'cpu1' })).toEqual([
      { type: 'error', message: 'purchase: sim not started' },
    ]);
  });

  it('init starts a game and replies ready + snapshot', () => {
    const h = newHost();
    expect(types(handleMessage(h, { type: 'init', seed: 5 }))).toEqual(['ready', 'snapshot']);
    expect(h.game).not.toBeNull();
  });

  it('init with a bad save reports an error and does not crash', () => {
    const h = newHost();
    const r = handleMessage(h, { type: 'init', save: { version: 42 } as never });
    expect(types(r)).toEqual(['error']);
    expect(h.game).toBeNull();
  });

  it('advances 1 tick per second at 1x, scales with speed, pauses', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    expect(advance(h, 500)).toBe(0);
    expect(advance(h, 500)).toBe(1);
    expect(h.game!.baseTick).toBe(1);
    handleMessage(h, { type: 'setSpeed', speed: 16 });
    expect(advance(h, 1000)).toBe(16);
    handleMessage(h, { type: 'setSpeed', speed: 0 });
    expect(advance(h, 5000)).toBe(0);
    expect(h.game!.baseTick).toBe(17);
  });

  it('caps catch-up per frame and drops the backlog', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    expect(advance(h, 60_000, 10)).toBe(10);
    expect(advance(h, 0, 10)).toBe(0);
  });

  it('purchase, clock, save and reload work through messages', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    h.game!.money = 1000;
    expect(types(handleMessage(h, { type: 'purchase', id: 'cooler1' }))).toEqual(['snapshot']);
    expect(types(handleMessage(h, { type: 'purchase', id: 'nope' }))).toEqual(['error', 'snapshot']);
    expect(types(handleMessage(h, { type: 'setCpuClock', clock: 99 }))).toEqual(['error', 'snapshot']);
    advance(h, 5000);
    const [saved] = handleMessage(h, { type: 'requestSave' });
    expect(saved!.type).toBe('saved');
    const h2 = newHost();
    const save = JSON.parse(JSON.stringify((saved as { save: unknown }).save));
    expect(types(handleMessage(h2, { type: 'init', save }))).toEqual(['ready', 'snapshot']);
    expect(h2.game!.baseTick).toBe(5);
    expect(h2.game!.money).toBe(h.game!.money);
  });

  it('assembly and key messages reach the game, refusals come back as errors plus a snapshot', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    const snap = (r: FromSim[]): Snapshot => (r.find((m) => m.type === 'snapshot') as Extract<FromSim, { type: 'snapshot' }>).snapshot;
    expect(types(handleMessage(h, { type: 'powerButton' }))).toEqual(['error', 'snapshot']); // no PSU yet
    expect(types(handleMessage(h, { type: 'install', invId: 'nope' }))).toEqual(['error', 'snapshot']);
    for (const id of ['inv1', 'inv5', 'inv2', 'inv3', 'inv4']) expect(types(handleMessage(h, { type: 'install', invId: id }))).toEqual(['snapshot']);
    expect(snap(handleMessage(h, { type: 'connectCable', cable: 'atx' })).progress.atxConnected).toBe(true);
    handleMessage(h, { type: 'connectCable', cable: 'cpu' });
    handleMessage(h, { type: 'connectCable', cable: 'video' });
    expect(snap(handleMessage(h, { type: 'powerButton' })).phase).toBe('posting');
    expect(types(handleMessage(h, { type: 'disconnectCable', cable: 'video' }))).toEqual(['error', 'snapshot']); // powered on
    for (let i = 0; i < 8; i++) advance(h, 12_000); // past the cold boot and POST
    expect(h.game!.currentPhase()).toBe('halted'); // no key at boot
    const key = snap(handleMessage(h, { type: 'plugKey', keyId: 1 }));
    expect(key.tray.map((k) => k.id)).not.toContain(1);
    expect(types(handleMessage(h, { type: 'plugKey', keyId: 3 }))).toEqual(['error', 'snapshot']);
    expect(types(handleMessage(h, { type: 'ejectKey' }))).toEqual(['snapshot']); // aborts the job
    expect(types(handleMessage(h, { type: 'uninstall', deviceId: 'dev1' }))).toEqual(['error', 'snapshot']); // still powered
  });

  it('buys and installs a drive and an OS, and uninstalls the OS, through the same messages', () => {
    const snap = (r: FromSim[]): Snapshot => (r.find((m) => m.type === 'snapshot') as Extract<FromSim, { type: 'snapshot' }>).snapshot;
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    h.game!.money = 100_000;
    for (const id of ['inv1', 'inv2', 'inv3', 'inv4']) handleMessage(h, { type: 'install', invId: id });
    const bought = (id: string) => snap(handleMessage(h, { type: 'purchase', id })).inventory.find((i) => i.spec === id)!;
    expect(types(handleMessage(h, { type: 'install', invId: bought('hdd0').id }))).toEqual(['snapshot']);
    expect(types(handleMessage(h, { type: 'purchase', id: 'os1' }))).toEqual(['error', 'snapshot']); // 16K RAM is too little
    handleMessage(h, { type: 'uninstall', deviceId: h.game!.board.devices.find((d) => d.spec === 'ram0')!.id });
    handleMessage(h, { type: 'install', invId: bought('ram1').id });
    const os = bought('os1');
    expect(os.kind).toBe('os');
    expect(snap(handleMessage(h, { type: 'install', invId: os.id, slotId: 'sata0' })).os?.name).toMatch(/Resident/);
    expect(types(handleMessage(h, { type: 'uninstallOs' }))).toEqual(['snapshot']);
    expect(snap(handleMessage(h, { type: 'requestSave' }).length ? [{ type: 'snapshot', snapshot: h.game!.snapshot() }] : []).os).toBeNull();
    expect(types(handleMessage(h, { type: 'uninstallOs' }))).toEqual(['error', 'snapshot']); // none left
  });
});
