import { assert, describe, expect, it } from 'vitest';
import { advance, handleMessage, newHost } from './host';
import type { FromSim, Snapshot } from './protocol';
import { ECONOMY } from '../features/economy/sim/economy';

// These tests are about hardware, not player levels: every item is buyable (levels have their own tests in levels.test.ts).
ECONOMY.levelGating = false;

const types = (r: FromSim[]) => r.map((m) => m.type);

describe('host message handling', () => {
  it('errors before init', () => {
    expect(handleMessage(newHost(), { type: 'purchase', id: 'cpu1' })).toStrictEqual([
      { type: 'error', message: 'purchase: sim not started' },
    ]);
  });

  it('init starts a game and replies ready + snapshot', () => {
    const h = newHost();
    expect(types(handleMessage(h, { type: 'init', seed: 5 }))).toStrictEqual(['ready', 'snapshot']);
    expect(h.game).not.toBeNull();
  });

  it('init with a bad save reports an error and does not crash', () => {
    const h = newHost();
    const r = handleMessage(h, { type: 'init', save: { version: 42 } as never });
    expect(types(r)).toStrictEqual(['error']);
    expect(h.game).toBeNull();
  });

  it('advances 1 tick per second at 1x, scales with speed, pauses', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    expect(advance(h, 500)).toBe(0);
    expect(advance(h, 500)).toBe(1);
    assert.exists(h.game);
    expect(h.game.baseTick).toBe(1);
    handleMessage(h, { type: 'setSpeed', speed: 16 });
    expect(advance(h, 1000)).toBe(16);
    handleMessage(h, { type: 'setSpeed', speed: 0 });
    expect(advance(h, 5000)).toBe(0);
    expect(h.game.baseTick).toBe(17);
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
    assert.exists(h.game);
    h.game.money = 1000;
    expect(types(handleMessage(h, { type: 'purchase', id: 'cooler1' }))).toStrictEqual(['snapshot']);
    expect(types(handleMessage(h, { type: 'purchase', id: 'nope' }))).toStrictEqual(['error', 'snapshot']);
    expect(types(handleMessage(h, { type: 'setCpuClock', clock: 99 }))).toStrictEqual(['error', 'snapshot']);
    advance(h, 5000);
    const [saved] = handleMessage(h, { type: 'requestSave' });
    assert.exists(saved);
    expect(saved.type).toBe('saved');
    const h2 = newHost();
    const save = JSON.parse(JSON.stringify((saved as { save: unknown }).save));
    expect(types(handleMessage(h2, { type: 'init', save }))).toStrictEqual(['ready', 'snapshot']);
    assert.exists(h2.game);
    expect(h2.game.baseTick).toBe(5);
    assert.exists(h.game);
    expect(h2.game.money).toBe(h.game.money);
  });

  it('assembly and key messages reach the game, refusals come back as errors plus a snapshot', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    const snap = (r: FromSim[]): Snapshot =>
      (r.find((m) => m.type === 'snapshot') as Extract<FromSim, { type: 'snapshot' }>).snapshot;
    expect(types(handleMessage(h, { type: 'powerButton' }))).toStrictEqual(['error', 'snapshot']); // no PSU yet
    expect(types(handleMessage(h, { type: 'install', invId: 'nope' }))).toStrictEqual(['error', 'snapshot']);
    for (const id of ['inv1', 'inv5', 'inv2', 'inv3', 'inv4']) {
      expect(types(handleMessage(h, { type: 'install', invId: id }))).toStrictEqual(['snapshot']);
    }
    expect(snap(handleMessage(h, { type: 'connectCable', cable: 'atx' })).progress.atxConnected).toBe(true);
    handleMessage(h, { type: 'connectCable', cable: 'cpu' });
    handleMessage(h, { type: 'connectCable', cable: 'cpufan' });
    handleMessage(h, { type: 'connectCable', cable: 'video' });
    handleMessage(h, { type: 'connectCable', cable: 'pcmains' });
    handleMessage(h, { type: 'connectCable', cable: 'monmains' });
    expect(snap(handleMessage(h, { type: 'powerButton' })).phase).toBe('posting');
    expect(types(handleMessage(h, { type: 'disconnectCable', cable: 'atx' }))).toStrictEqual(['error', 'snapshot']); // powered on
    for (let i = 0; i < 8; i++) {
      advance(h, 12_000); // past the cold boot and POST
    }
    assert.exists(h.game);
    expect(h.game.currentPhase()).toBe('halted'); // no key at boot
    const key = snap(handleMessage(h, { type: 'plugKey', keyId: 1 }));
    expect(key.tray.map((k) => k.id)).not.toContain(1);
    expect(types(handleMessage(h, { type: 'plugKey', keyId: 3 }))).toStrictEqual(['error', 'snapshot']);
    expect(types(handleMessage(h, { type: 'ejectKey' }))).toStrictEqual(['snapshot']); // aborts the job
    expect(types(handleMessage(h, { type: 'uninstall', deviceId: 'dev1' }))).toStrictEqual(['error', 'snapshot']); // still powered
  });

  it('buys and installs a drive and an OS, and uninstalls the OS, through the same messages', () => {
    const snap = (r: FromSim[]): Snapshot =>
      (r.find((m) => m.type === 'snapshot') as Extract<FromSim, { type: 'snapshot' }>).snapshot;
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    assert.exists(h.game);
    h.game.money = 100_000;
    for (const id of ['inv1', 'inv2', 'inv3', 'inv4']) {
      handleMessage(h, { type: 'install', invId: id });
    }
    const bought = (id: string) => {
      const purchaseInventory = snap(handleMessage(h, { type: 'purchase', id })).inventory.find((i) => i.spec === id);
      assert.exists(purchaseInventory);
      return purchaseInventory;
    };
    expect(types(handleMessage(h, { type: 'install', invId: bought('hdd0').id }))).toStrictEqual(['snapshot']);
    const early = bought('os1'); // sold whatever the memory
    expect(types(handleMessage(h, { type: 'install', invId: early.id, slotId: 'sata0' }))).toStrictEqual([
      'error',
      'snapshot',
    ]); // 16K RAM is too little
    assert.exists(h.game);
    const ram0Device = h.game.board.devices.find((d) => d.spec === 'ram0');
    assert.exists(ram0Device);
    handleMessage(h, { type: 'uninstall', deviceId: ram0Device.id });
    handleMessage(h, { type: 'install', invId: bought('ram1').id });
    const os = bought('os1');
    expect(os.kind).toBe('os');
    expect(snap(handleMessage(h, { type: 'install', invId: os.id, slotId: 'sata0' })).os?.name).toMatch(/Resident/u);
    expect(types(handleMessage(h, { type: 'uninstallOs' }))).toStrictEqual(['snapshot']);
    assert.exists(h.game);
    const { game } = h;
    expect(
      snap(
        handleMessage(h, { type: 'requestSave' }).length > 0 ? [{ type: 'snapshot', snapshot: game.snapshot() }] : [],
      ).os,
    ).toBeNull();
    expect(types(handleMessage(h, { type: 'uninstallOs' }))).toStrictEqual(['error', 'snapshot']); // none left
  });
});
