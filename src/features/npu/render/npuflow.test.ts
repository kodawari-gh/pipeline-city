// The whole life of an inference job on an NPU, from the key in the tray to the number on the screen (docs/ACCEL.md "NPU internal view", "How a job reaches the
// card"): a real job is served by the bot, and every access the CPU makes to the card's window is recorded as the CPU makes it. The test checks the story the
// board and the card's die tell: the weights, the activations and the descriptor list are copied in word by word (no DMA), DESC, COUNT and CMD launch it, STATUS
// is polled, the result words are read back out of card memory; and that every one of those accesses lights traces on the board of the machine it ran on.
import { assert, describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';

import { NPU_BASE, NPU_MEM, NPU_REG, NPU_STRIDE } from '@/core/sim/memmap';
import { roundUp16 } from '../../gpu/sim/kernels';
import { makeNetwork, npuProgram } from '../sim/kernels';
import { Prng } from '@/core/sim';

import { buildBuses } from '../../board/render/wiring/routes';
import { deviceAt, npuAccess, resolve, slotChain } from '../../board/render/wiring/busmap';
import { GEO, setLayoutTier } from '../../board/render/layout/layout';

interface Access {
  store: boolean;
  reg: boolean;
  off: number;
  word: number;
}

type Bus = ReturnType<typeof buildBuses>[number];
type MachineBus = Game['machine']['bus'];

/** Logs an access to the card's window (a byte access only at a word boundary: the word access it is part of is what the card sees). */
function record(log: Access[], name: string, { a, v }: { a: number; v: number }): void {
  const n = npuAccess(a);
  if (n && (name.endsWith('32') || (n.off & 3) === 0)) {
    const store = name.startsWith('store');
    log.push({ store, reg: n.off < NPU_MEM, off: n.off, word: store ? v >>> 0 : -1 });
  }
}

/** Records every access the CPU makes through `bus` into `log`, as it makes it. */
function recordAccesses(bus: MachineBus, log: Access[]): void {
  const load32 = bus.load32.bind(bus),
    store32 = bus.store32.bind(bus),
    load8 = bus.load8.bind(bus),
    store8 = bus.store8.bind(bus);
  bus.load32 = (a) => {
    record(log, 'load32', { a, v: 0 });
    return load32(a);
  };
  bus.store32 = (a, v) => {
    record(log, 'store32', { a, v });
    store32(a, v);
  };
  bus.load8 = (a) => {
    record(log, 'load8', { a, v: 0 });
    return load8(a);
  };
  bus.store8 = (a, v) => {
    record(log, 'store8', { a, v });
    store8(a, v);
  };
}

const isMem = (a: Access): boolean => !a.reg;
const isMemStore = (a: Access): boolean => isMem(a) && a.store;
const isMemLoad = (a: Access): boolean => isMem(a) && !a.store;

/** The board's buses at a tier, one per kind (the first built). */
function busesAt(tier: number): Map<Bus['id'], Bus> {
  setLayoutTier(tier);
  const out = new Map<Bus['id'], Bus>();
  for (const b of buildBuses()) {
    if (!out.has(b.id)) {
      out.set(b.id, b);
    }
  }
  return out;
}

/** The accesses to check on a board: none when the board has no PCIe slot `k` (this tier has no such slot). */
const onBoard = (k: number, log: Access[]): Access[] => (k < GEO.pcie.length ? log : []);
/** The buses a slot's access crosses: the first slot is the CPU's own x16; the others hang off the chipset, so a write crosses DMI first and a read crosses it last. */
const expectedLegs = (k: number, store: boolean): string[] => {
  if (k === 0) {
    return ['pcie'];
  }
  return store ? ['dmi', 'pcie'] : ['pcie', 'dmi'];
};
/** Every leg carries lanes and runs toward the card for a write, back for a read. */
const legsRun = (legs: { lanes: unknown[]; dir: number }[], store: boolean): boolean =>
  legs.every((l) => l.lanes.length > 0 && l.dir === (store ? 1 : -1));
const hasLayerOf8 = (d: { layer?: { n: number } | null }): boolean => d.layer?.n === 8;

/** Serve one `npu` job with an NPU in the machine and return every access to the card's window, in order, with the machine afterwards. */
function runJob() {
  const g = new Game({
    seed: 3,
    sandbox: true,
    preassembled: true,
    maxed: true,
    economy: { baseDemandPerTick: 0, startQueue: [{ template: 'cli.log' }] },
  });
  const bought = g.purchase('npu1');
  if (!bought.ok) {
    throw new Error(bought.reason);
  }
  expect(g.install(bought.invId).ok).toBe(true);
  const npu1Device = g.board.devices.find((d) => d.spec === 'npu1');
  assert.exists(npu1Device);
  const { slot } = npu1Device;
  const log: Access[] = [];
  recordAccesses(g.machine.bus, log);
  expect(g.powerButton().ok).toBe(true);
  g.clearQueue();
  expect(g.spawnKey('npu').ok).toBe(true);
  const op = new Operator(g, 1);
  for (let n = 0; g.completed < 1 && n < 400_000; n++) {
    g.advanceBaseTick();
    op.step();
  }
  expect(g.completed).toBe(1);
  expect(g.errors).toBe(0);
  return { g, slot, log };
}

describe('an inference job on the NPU, access by access', () => {
  const { g, slot, log } = runJob();
  const npus2 = g.snapshot().npus;
  assert.exists(npus2);
  const [card] = npus2;
  assert.exists(card);
  const layers = card.log.length;
  const regs = log.filter((a) => a.reg);

  it('copies the activations, the weights, the biases and the descriptor list into card memory word by word, before anything else', () => {
    const net = makeNetwork(new Prng(1), layers),
      prog = npuProgram(net);
    const wantWords = 64 + layers * 64 + layers * 8 + roundUp16(prog.words.length * 4) / 4;
    const stores = log.filter((a) => isMemStore(a));
    expect(stores).toHaveLength(wantWords);
    // the copy is in order: the first activations, then the weights, then the biases, then the list
    expect(stores.slice(0, 64).map((a) => a.off - NPU_MEM)).toStrictEqual(Array.from({ length: 64 }, (_, k) => 4 * k));
    assert.exists(stores[64]);
    expect(stores[64].off - NPU_MEM).toBe(0x2_00); // NPU_LAYOUT.w
    const lastStore2 = stores.at(-1);
    assert.exists(lastStore2);
    expect(lastStore2.off - NPU_MEM).toBeGreaterThan(0x9_00); // the list, last
    // nothing touches a register until the last word is in
    const firstReg = log.findIndex((a) => a.reg),
      lastStore = log.findLastIndex((a) => isMemStore(a));
    expect(firstReg).toBeGreaterThan(lastStore);
  });

  it('launches with DESC, COUNT and CMD in that order, then polls STATUS until the card is done', () => {
    const writes = regs.filter((a) => a.store);
    expect(writes.map((a) => a.off)).toStrictEqual([NPU_REG.DESC, NPU_REG.COUNT, NPU_REG.CMD]);
    assert.exists(writes[1]);
    expect(writes[1].word).toBe(layers);
    assert.exists(writes[2]);
    expect(writes[2].word).toBe(1);
    const polls = regs.filter((a) => !a.store);
    expect(polls.length).toBeGreaterThan(0);
    expect(polls.every((a) => a.off === NPU_REG.STATUS)).toBe(true);
    const foundReg = regs.find((a) => !a.store);
    assert.exists(foundReg);
    expect(log.indexOf(foundReg)).toBeGreaterThan(log.indexOf(writes[2])); // polling starts after the go
  });

  it("then reads the result back out of card memory (one word at a time, in order, from the last layer's buffer) and not before the polling ends", () => {
    const lastFilter = regs.findLast((a) => !a.store);
    assert.exists(lastFilter);
    const lastPoll = log.lastIndexOf(lastFilter);
    const reads = log.map((a, i) => ({ a, i })).filter((x) => isMemLoad(x.a));
    expect(reads).toHaveLength(64);
    expect(reads.every((x) => x.i > lastPoll)).toBe(true);
    const { finalAt } = npuProgram(makeNetwork(new Prng(1), layers));
    expect(reads.map((x) => x.a.off - NPU_MEM)).toStrictEqual(Array.from({ length: 64 }, (_, k) => finalAt + 4 * k));
  });

  it('is what the card says it saw: the counters, the log of descriptors and the map of card memory agree', () => {
    const stores = log.filter((a) => isMemStore(a)).length,
      reads = log.filter((a) => isMemLoad(a)).length;
    expect(card).toMatchObject({ slot, hostWrites: stores, hostReads: reads, launches: 1, count: layers });
    expect(card.log.map((e) => e.op)).toStrictEqual(Array.from({ length: layers }, () => 7));
    const { finalAt } = npuProgram(makeNetwork(new Prng(1), layers));
    expect(card.lastRead).toBe(finalAt + 63 * 4);
    // the weights and the list are in the map, and the card remembers where each layer's parameters are
    expect(card.list.every((d) => hasLayerOf8(d))).toBe(true);
    const cell = (b: number) => {
      const fillItem = card.fill[Math.floor(b / 64)];
      assert.exists(fillItem);
      return fillItem;
    };
    expect(cell(0x2_00)).toBeGreaterThan(0.3); // the first layer's weights
    expect(cell(0x9_00)).toBeGreaterThan(0); // the list
  });

  describe.each([0, 1, 2, 3])('on a tier %i board', (tier) => {
    const map = () => busesAt(tier);
    it('every one of those accesses lights traces on the way to the card: a write runs toward the card, a read comes back', () => {
      const m = map(),
        k = Number(slot.slice(4));
      for (const a of onBoard(k, log)) {
        const addr = NPU_BASE + k * NPU_STRIDE + a.off;
        expect(deviceAt(addr)).toStrictEqual({ kind: 'card', slot });
        expect(npuAccess(addr)).toStrictEqual({ slot, off: a.off });
        const legs = resolve(m, slotChain(slot, a.store));
        // the first slot is the CPU's own x16; the others hang off the chipset, so a write crosses DMI first and a read crosses it last
        expect(legs.map((l) => l.bus)).toStrictEqual(expectedLegs(k, a.store));
        expect(legsRun(legs, a.store)).toBe(true);
      }
    });
  });
});
