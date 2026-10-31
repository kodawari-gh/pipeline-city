// The whole life of an inference job on an NPU, from the key in the tray to the number on the screen (docs/ACCEL.md "NPU internal view", "How a job reaches the
// card"): a real job is served by the bot, and every access the CPU makes to the card's window is recorded as the CPU makes it. The test checks the story the
// board and the card's die tell: the weights, the activations and the descriptor list are copied in word by word (no DMA), DESC, COUNT and CMD launch it, STATUS
// is polled, the result words are read back out of card memory; and that every one of those accesses lights traces on the board of the machine it ran on.
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import { econ } from '@/worker/game/testkit';
import { NPU_BASE, NPU_MEM, NPU_REG, NPU_STRIDE } from '@/core/sim/memmap';
import { roundUp16 } from '../../gpu/sim/kernels';
import { makeNetwork, npuProgram } from '../sim/kernels';
import { Prng } from '@/core/sim/prng';
import { buildBuses, type Bus, type BusKind } from '../../board/render/wiring/routes';
import { deviceAt, npuAccess, resolve, slotChain } from '../../board/render/wiring/busmap';
import { GEO, setLayoutTier } from '../../board/render/layout/layout';

interface Access { store: boolean; reg: boolean; off: number; word: number }

/** Serve one `npu` job with an NPU in the machine and return every access to the card's window, in order, with the machine afterwards. */
function runJob() {
  const g = new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
  const bought = g.purchase('npu1');
  if (!bought.ok) throw new Error(bought.reason);
  expect(g.install(bought.invId).ok).toBe(true);
  const slot = g.board.devices.find((d) => d.spec === 'npu1')!.slot;
  const log: Access[] = [];
  const bus = g.machine.bus as unknown as Record<string, (a: number, v?: number) => number | void>;
  for (const name of ['load32', 'store32', 'load8', 'store8']) {
    const orig = bus[name]!.bind(bus);
    bus[name] = (a: number, v?: number) => {
      const n = npuAccess(a);
      if (n && (name.endsWith('32') || (n.off & 3) === 0)) log.push({ store: name.startsWith('store'), reg: n.off < NPU_MEM, off: n.off, word: name.startsWith('store') ? (v ?? 0) >>> 0 : -1 });
      return orig(a, v);
    };
  }
  expect(g.powerButton().ok).toBe(true);
  g.clearQueue();
  expect(g.spawnKey('npu').ok).toBe(true);
  const op = new Operator(g, 1);
  for (let n = 0; g.completed < 1 && n < 400_000; n++) { g.advanceBaseTick(); op.step(); }
  expect(g.completed).toBe(1);
  expect(g.errors).toBe(0);
  return { g, slot, log };
}

describe('an inference job on the NPU, access by access', () => {
  const { g, slot, log } = runJob();
  const card = g.snapshot().npus![0]!;
  const layers = card.log.length;
  const mem = (a: Access) => !a.reg;
  const regs = log.filter((a) => a.reg);

  it('copies the activations, the weights, the biases and the descriptor list into card memory word by word, before anything else', () => {
    const net = makeNetwork(new Prng(1), layers), prog = npuProgram(net);
    const wantWords = 64 + layers * 64 + layers * 8 + roundUp16(prog.words.length * 4) / 4;
    const stores = log.filter((a) => mem(a) && a.store);
    expect(stores).toHaveLength(wantWords);
    // the copy is in order: the first activations, then the weights, then the biases, then the list
    expect(stores.slice(0, 64).map((a) => a.off - NPU_MEM)).toEqual(Array.from({ length: 64 }, (_, k) => 4 * k));
    expect(stores[64]!.off - NPU_MEM).toBe(0x200); // NPU_LAYOUT.w
    expect(stores[stores.length - 1]!.off - NPU_MEM).toBeGreaterThan(0x900); // the list, last
    // nothing touches a register until the last word is in
    const firstReg = log.findIndex((a) => a.reg), lastStore = log.map((a, i) => (mem(a) && a.store ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
    expect(firstReg).toBeGreaterThan(lastStore);
  });

  it('launches with DESC, COUNT and CMD in that order, then polls STATUS until the card is done', () => {
    const writes = regs.filter((a) => a.store);
    expect(writes.map((a) => a.off)).toEqual([NPU_REG.DESC, NPU_REG.COUNT, NPU_REG.CMD]);
    expect(writes[1]!.word).toBe(layers);
    expect(writes[2]!.word).toBe(1);
    const polls = regs.filter((a) => !a.store);
    expect(polls.length).toBeGreaterThan(0);
    expect(polls.every((a) => a.off === NPU_REG.STATUS)).toBe(true);
    expect(log.indexOf(regs.find((a) => !a.store)!)).toBeGreaterThan(log.indexOf(writes[2]!)); // polling starts after the go
  });

  it('then reads the result back out of card memory (one word at a time, in order, from the last layer\'s buffer) and not before the polling ends', () => {
    const lastPoll = log.lastIndexOf(regs.filter((a) => !a.store).at(-1)!);
    const reads = log.map((a, i) => ({ a, i })).filter((x) => mem(x.a) && !x.a.store);
    expect(reads).toHaveLength(64);
    expect(reads.every((x) => x.i > lastPoll)).toBe(true);
    const finalAt = npuProgram(makeNetwork(new Prng(1), layers)).finalAt;
    expect(reads.map((x) => x.a.off - NPU_MEM)).toEqual(Array.from({ length: 64 }, (_, k) => finalAt + 4 * k));
  });

  it('is what the card says it saw: the counters, the log of descriptors and the map of card memory agree', () => {
    const stores = log.filter((a) => mem(a) && a.store).length, reads = log.filter((a) => mem(a) && !a.store).length;
    expect(card).toMatchObject({ slot, hostWrites: stores, hostReads: reads, launches: 1, count: layers });
    expect(card.log.map((e) => e.op)).toEqual(Array(layers).fill(7));
    expect(card.lastRead).toBe(npuProgram(makeNetwork(new Prng(1), layers)).finalAt + 63 * 4);
    // the weights and the list are in the map, and the card remembers where each layer's parameters are
    expect(card.list.every((d) => d.layer && d.layer.n === 8)).toBe(true);
    const cell = (b: number) => card.fill[Math.floor(b / 64)]!;
    expect(cell(0x200)).toBeGreaterThan(0.3); // the first layer's weights
    expect(cell(0x900)).toBeGreaterThan(0); // the list
  });

  describe.each([0, 1, 2, 3])('on a tier %i board', (tier) => {
    const map = () => {
      setLayoutTier(tier);
      const out = new Map<BusKind, Bus>();
      for (const b of buildBuses()) if (!out.has(b.id)) out.set(b.id, b);
      return out;
    };
    it('every one of those accesses lights traces on the way to the card: a write runs toward the card, a read comes back', () => {
      const m = map(), k = Number(slot.slice(4));
      if (k >= GEO.pcie.length) return; // (this tier has no such slot)
      for (const a of log) {
        const addr = NPU_BASE + k * NPU_STRIDE + a.off;
        expect(deviceAt(addr)).toEqual({ kind: 'card', slot });
        expect(npuAccess(addr)).toEqual({ slot, off: a.off });
        const legs = resolve(m, slotChain(slot, a.store));
        // the first slot is the CPU's own x16; the others hang off the chipset, so a write crosses DMI first and a read crosses it last
        expect(legs.map((l) => l.bus)).toEqual(k === 0 ? ['pcie'] : a.store ? ['dmi', 'pcie'] : ['pcie', 'dmi']);
        expect(legs.every((l) => l.lanes.length > 0 && l.dir === (a.store ? 1 : -1))).toBe(true);
      }
    });
  });
});
