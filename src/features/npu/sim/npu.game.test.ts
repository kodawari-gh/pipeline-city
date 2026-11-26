import { assert, describe, expect, it } from 'vitest';
import { GpuStatus, NPU_BASE, NPU_REG } from '@/core/sim/memmap';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import { econ } from '@/worker/game/testkit';

const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(`${id}: ${r.reason}`);
  }
  return r.invId;
};

/** Runs the bot until the first job is done (or `max` ticks pass); returns the ticks it took. */
function runFirstJob(g: Game, op: Operator, max = 200_000): number {
  let ticks = 0;
  while (g.completed < 1 && ticks < max) {
    g.advanceBaseTick();
    op.step();
    ticks++;
  }
  return ticks;
}

/** Serve one `npu` class job with the bot using whichever cards are fitted (none without `fit`); returns the ticks. */
function serve(fit?: (g: Game) => void) {
  const g = maxed();
  fit?.(g);
  g.clearQueue();
  expect(g.spawnKey('npu').ok).toBe(true);
  expect(g.snapshot().tray.find((k) => k.cls === 'npu')).toMatchObject({ runnable: true }); // no card needed
  const ticks = runFirstJob(g, new Operator(g, 1));
  expect(g.completed).toBe(1);
  expect(g.errors).toBe(0);
  return ticks;
}

describe('an NPU in the machine', () => {
  it('is on the bus in the port of its slot once installed, and gone when taken out', () => {
    const g = maxed();
    const slotOf = () => {
      const npu1Device = g.board.devices.find((d) => d.spec === 'npu1');
      assert.exists(npu1Device);
      return Number(npu1Device.slot.slice(4));
    };
    expect(g.install(buy(g, 'npu1')).ok).toBe(true);
    g.advanceBaseTick();
    const base = NPU_BASE + slotOf() * 0x1_00_00;
    expect(g.machine.bus.load32(base + NPU_REG.STATUS)).toBe(GpuStatus.Present);
    expect(g.machine.bus.load32(base + NPU_REG.GRID)).toBe(4);
    const k = slotOf();
    const npu1Device2 = g.board.devices.find((d) => d.spec === 'npu1');
    assert.exists(npu1Device2);
    expect(g.uninstall(npu1Device2.id).ok).toBe(true);
    g.advanceBaseTick();
    expect(g.machine.bus.load32(NPU_BASE + k * 0x1_00_00 + NPU_REG.STATUS)).toBe(0);
  });

  it("the snapshot lists the card's insides (keyed by its PCIe slot) only while the machine is on, and its log shows the descriptors an inference ran", () => {
    const g = maxed();
    g.install(buy(g, 'npu1'));
    const npu1Device3 = g.board.devices.find((d) => d.spec === 'npu1');
    assert.exists(npu1Device3);
    const { slot } = npu1Device3;
    expect(g.snapshot().npus).toBeUndefined(); // installed but off
    expect(g.powerButton().ok).toBe(true);
    g.advanceBaseTick();
    expect(g.snapshot().npus).toMatchObject([{ slot, grid: 4, memBytes: 8192, phase: 'idle', launches: 0, log: [] }]);
    g.clearQueue();
    expect(g.spawnKey('npu').ok).toBe(true);
    runFirstJob(g, new Operator(g, 1));
    expect(g.completed).toBe(1);
    const npus2 = g.snapshot().npus;
    assert.exists(npus2);
    const [card] = npus2;
    assert.exists(card);
    expect(card.launches).toBeGreaterThan(0);
    expect(card.log.length).toBeGreaterThan(1);
    expect(card.log.at(-1)).toMatchObject({ run: card.launches, fault: false });
    expect(card.log.every((e) => e.acc.length === 16)).toBe(true);
  }, 30_000);

  it('the inference job runs on the CPU alone, faster with a GPU, faster still with an NPU', () => {
    const cpu = serve();
    const gpu = serve((g) => {
      g.install(buy(g, 'gpu1'));
      g.connectCable('pcie');
    });
    const npu = serve((g) => {
      g.install(buy(g, 'npu1'));
    });
    expect(npu).toBeLessThan(gpu);
    expect(gpu).toBeLessThan(cpu);
  }, 30_000);
});
