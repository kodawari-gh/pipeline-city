import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { setLayoutTier } from '../../board/render/layout/layout';
import { boardNicIds, nicIds } from '../render/nic/niclayout';
import { macOf } from '../render/nic/nicmac';
import { isNicId } from './nicdesc';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const CARDS = [
  ['nic1', 'nic-gbe', 1000],
  ['nic2', 'nic-10g', 10_000],
  ['nic3', 'nic-40g', 40_000],
] as const;
const ROUTER = { id: 'router4', name: 'Edge router', mbps: 40_000, clients: 16, visual: 'router-core' };
/** The card's buffers and counters as the sim reports them (`NetSnap.stack`): a FIFO of `fifoSegs` with `fifo` waiting, a segment lost, words moved. */
const stackOf = (fifoSegs: number, fifo: number) => ({
  ...snap().net.stack,
  sent: 211,
  nic: {
    enabled: true,
    fifo,
    fifoSegs,
    rxUsed: 1,
    rxSlots: 4,
    txUsed: 0,
    txSlots: 4,
    rx: 211,
    drops: 2,
    tx: 205,
    dmaWords: 15_000,
    irqs: 0,
  },
});

/** A running machine with the card `spec` in slot pcie1, the cable in it (or in no card), over a router. */
function game(spec: string, mbps: number, plugged = true): Snapshot {
  const base = snap();
  return snap({
    powered: true,
    power: { ...base.power, tripped: false },
    devices: [dev({ id: 'n1', spec, kind: 'nic', slot: 'pcie1', tempC: 52, powerW: 7.5 })],
    net: {
      ...base.net,
      state: plugged ? 'link-up' : 'no-cable',
      reason: plugged ? null : 'no cable',
      port: plugged ? { kind: 'nic', deviceId: 'n1', mbps } : { kind: null, deviceId: null, mbps: 0 },
      router: ROUTER,
      isp: { id: 'isp5', name: 'Backbone', downMbps: 20_000, upMbps: 10_000, clients: 32 },
      bandwidth: { downMbps: 2000, upMbps: 2000, clients: 16, binding: 'disk' },
      transfers: [
        { jobId: 4, label: '#4 db', dir: 'down', totalMB: 80, doneMB: 20, percent: 25, etaTicks: 6, persisted: false },
      ],
      uploadsWaiting: 2,
      frames: { rx: 123_456, tx: 61_728 },
      counters: { delivered: 9, downloaded: 11, uploaded: 7, lost: 0 },
      stack: stackOf(8, 3),
    },
  });
}

describe("the words for the network card's parts", () => {
  setLayoutTier(3, 3);

  it('describes every part the board draws, with the card in the game and without a game', () => {
    for (const [spec, visual, mbps] of CARDS) {
      const ids = nicIds(visual, 'pcie1', 1);
      expect(ids.length, `for ${visual}`).toBeGreaterThanOrEqual(14);
      for (const id of ids) {
        expect(isNicId(id), `for ${id}`).toBe(true);
        for (const d of [
          describeId(id, game(spec, mbps)),
          describeId(id, game(spec, mbps, false)),
          describeId(id, snap()),
          describeId(id),
        ]) {
          expect(d, `${visual} ${id}`).not.toBeNull();
          expect(d?.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d?.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d?.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the card is doing now, from the snapshot', () => {
    const s = game('nic2', 10_000);
    expect(describeId('pcie1.nic-jack', s)?.nerd).toMatch(/link up, 10 Gbit/u);
    expect(describeId('pcie1.nic-phy', s)?.nerd).toMatch(/10GBASE-T.*link up, 10 Gbit.*rated 10 Gbit/u);
    expect(describeId('pcie1.nic-stats', s)?.nerd).toMatch(/rx 123 k frames.*tx 62 k frames/u);
    expect(describeId('pcie1.nic-rxq', s)?.nerd).toMatch(
      /FIFO 3\/8 segments, 2 lost to a full FIFO.*1 downloads in flight.*11 downloaded/u,
    );
    expect(describeId('pcie1.nic-txq', s)?.nerd).toMatch(
      /0 uploads in flight.*2 results wait.*7 uploaded.*205 segments sent/u,
    );
    expect(describeId('pcie1.nic-stats', s)?.nerd).toMatch(/the card took 211 segments, sent 205, lost 2/u);
    expect(describeId('pcie1.nic-temp', s)?.nerd).toMatch(/^52 C \| half speed from \d+ C/u);
    expect(describeId('pcie1.nic-vreg', s)?.nerd).toMatch(/7\.5 W now \| 5 W idle, 11 W at full load/u);
    expect(describeId('pcie1.nic-pcie', s)?.nerd).toMatch(/x4, 8 pairs/u);
    expect(describeId('pcie1.nic-ctl', s)?.nerd).toMatch(/10GbE card \| RL-N510, 10GBASE-T/u);
  });

  it("calls the 40G card's port a QSFP+ cage without transformers and its PHY four lanes with no echo to cancel, and keeps the RJ45 jack and the pairs for the copper cards", () => {
    const s = game('nic3', 40_000),
      jack = must(describeId('pcie1.nic-jack', s)),
      phy = must(describeId('pcie1.nic-phy', s));
    expect(jack.title).toBe('QSFP+ cage');
    expect(jack.plain).toMatch(/no transformers/u);
    expect(jack.nerd).toMatch(
      /link up, 40 Gbit \| two cages on the bracket, the game has one cable \| 4 lanes of 10\.3125 Gbit\/s each way, 40GBASE-CR4 direct attach lead/u,
    );
    expect(phy.plain).toMatch(/four lanes.*no echo to cancel/u);
    expect(phy.plain).not.toMatch(/cancels echo/u);
    expect(phy.nerd).toMatch(/^40GBASE-CR4 \| link up, 40 Gbit/u);
    expect(describeId('pcie1.nic-ctl', s)?.nerd).toMatch(/40GbE card \| RL-N740, 40GBASE-CR4/u);
    const copper = game('nic2', 10_000);
    expect(describeId('pcie1.nic-jack', copper)?.title).toBe('RJ45 jack');
    expect(must(describeId('pcie1.nic-jack', copper)).nerd).not.toMatch(/cages/u);
    expect(describeId('pcie1.nic-phy', copper)?.plain).toMatch(/Each pair has a front end.*cancels echo/u);
  });

  it('says what the DMA engine and the rings hold now: the slots in use, their size, the words moved, and that the kernel polls', () => {
    const d = must(describeId('pcie1.nic-dma', game('nic2', 10_000)));
    expect(d.nerd).toMatch(
      /receive ring 1\/4 slots, transmit ring 0\/4 slots \| 280 and 48 bytes a slot \| 15 k words moved since the game started \| 0 interrupts: the kernel polls/u,
    );
    expect(d.plain).toMatch(/two rings in RAM/u);
    expect(d.plain).not.toMatch(/scatter|descriptor ring\b/u);
    // the receive queue explains the FIFO, and the buffer the card has is its own: the depth shows even where the cable is in another jack
    expect(describeId('pcie1.nic-rxq', game('nic2', 10_000))?.plain).toMatch(/FIFO.*the next segment is lost/u);
    expect(describeId('pcie1.nic-rxq', game('nic3', 40_000, false))?.nerd).toMatch(
      /^FIFO of 16 segments \| downloads in flight/u,
    );
    expect(describeId('pcie1.nic-rxq', game('nic1', 1000, false))?.nerd).toMatch(/^FIFO of 4 segments/u);
    expect(describeId('pcie1.nic-dma', game('nic2', 10_000, false))?.nerd).toMatch(
      /^rings of 4 receive and 4 transmit slots in RAM \| 280 and 48 bytes a slot \| OS 3 and 4 take the interrupt, OS 1 and 2 poll the rings/u,
    );
    expect(describeId('pcie1.nic-dma')?.nerd).toMatch(/OS 1 and 2 poll the rings/u);
    expect(d.plain).toMatch(/OS 3 and OS 4 take it.*OS 1 and OS 2.*interrupts off/u);
    expect(describeId('pcie1.nic-txq', game('nic2', 10_000))?.plain).toMatch(/transmit ring in RAM/u);
  });

  it("names the port's own address on the MAC block, the card's burnt-in one, and none with no game", () => {
    expect(describeId('pcie1.nic-mac', game('nic2', 10_000))?.nerd).toContain(
      `this port's address ${macOf('nic-10g')}`,
    );
    // (the same card with the cable in no card: its address is still its own)
    expect(describeId('pcie1.nic-mac', game('nic2', 10_000, false))?.nerd).toContain(
      `this port's address ${macOf('nic-10g')}`,
    );
    const noMachine = must(describeId('pcie1.nic-mac', snap()));
    expect(noMachine.nerd).not.toMatch(/address/u);
    expect(must(describeId('pcie1.nic-mac')).nerd).not.toMatch(/address/u);
  });

  it("says so when the cable is not in this card, and gives the plan's own words with no game", () => {
    expect(describeId('pcie1.nic-jack', game('nic2', 10_000, false))?.nerd).toMatch(/no cable in this card/u);
    expect(describeId('pcie1.nic-stats', game('nic2', 10_000, false))?.nerd).toMatch(/counters/u);
    expect(describeId('pcie1.nic-jack')?.nerd).toMatch(/no game/u);
    expect(describeId('pcie1.nic-nvm')?.nerd).toMatch(/MAC 02:52:4C:/u);
    expect(describeId('pcie1.nic-pcie')?.nerd).toMatch(/lanes by tier/u);
  });

  it('warns of a card that runs at half speed', () => {
    const s = game('nic2', 10_000);
    s.devices[0] = { ...must(s.devices[0]), tempC: 97, throttle: 0.5 };
    expect(describeId('pcie1.nic-temp', s)?.nerd).toMatch(/HALF SPEED NOW/u);
  });

  it('ignores ids that are not its parts', () => {
    for (const id of ['pcie1.nic-nonsense', 'pcie1.nic-', 'nic-mac', 'cpu.nic-mac']) {
      expect(isNicId(id), `for ${id}`).toBe(false);
      expect(describeId(id, game('nic2', 10_000)), `for ${id}`).toBeNull();
    }
    // the other cards' ids are theirs: a card in the same slot keeps its own words
    for (const id of ['pcie1.mac', 'pcie1.regs', 'pcie1.pcie']) {
      expect(isNicId(id), `for ${id}`).toBe(false);
    }
    expect(isNicId('pcie0.nic-mac')).toBe(true);
    expect(isNicId('pcie12.nic-dma')).toBe(true);
  });
});

/** A running machine on a board of tier `tier` (100 Mbit below the Enthusiast board's 1000), the cable in the board's jack (or in none), over a router. */
function boardGame(tier: number, plugged = true): Snapshot {
  const base = snap(),
    b = boardSnap({ tier }),
    mbps = b.features.ethernetMbps;
  return snap({
    powered: true,
    power: { ...base.power, tripped: false },
    board: b,
    net: {
      ...base.net,
      state: plugged ? 'link-up' : 'no-cable',
      reason: plugged ? null : 'no cable',
      port: plugged ? { kind: 'board', deviceId: null, mbps } : { kind: null, deviceId: null, mbps: 0 },
      router: ROUTER,
      isp: { id: 'isp5', name: 'Backbone', downMbps: 20_000, upMbps: 10_000, clients: 32 },
      bandwidth: { downMbps: 100, upMbps: 100, clients: 16, binding: 'port' },
      transfers: [
        { jobId: 4, label: '#4 db', dir: 'down', totalMB: 80, doneMB: 20, percent: 25, etaTicks: 6, persisted: false },
      ],
      uploadsWaiting: 2,
      frames: { rx: 123_456, tx: 61_728 },
      counters: { delivered: 9, downloaded: 11, uploaded: 7, lost: 0 },
      stack: stackOf(2, 2),
    },
  });
}

describe('the words for the Ethernet chip on the motherboard', () => {
  setLayoutTier(3, 3);

  it('describes every part its die has, on both looks, with the board in the game and without a game', () => {
    for (const [tier, look] of [
      [1, 'board-fe'],
      [3, 'board-ge'],
    ] as const) {
      const ids = boardNicIds(look);
      expect(ids).toHaveLength(8);
      for (const id of ids) {
        expect(isNicId(id), `for ${id}`).toBe(true);
        for (const d of [
          describeId(id, boardGame(tier)),
          describeId(id, boardGame(tier, false)),
          describeId(id, snap()),
          describeId(id),
        ]) {
          expect(d, `${look} ${id}`).not.toBeNull();
          expect(d?.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d?.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d?.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the port is doing now, from the snapshot', () => {
    const s = boardGame(3);
    expect(describeId('board.nic-ctl', s)?.title).toBe('Ethernet controller');
    expect(describeId('board.nic-ctl', s)?.nerd).toMatch(
      /onboard Ethernet \| RL-E111, 1000BASE-T \| soldered to the board/u,
    );
    expect(describeId('board.nic-phy', s)?.nerd).toMatch(/1000BASE-T.*link up, 1 Gbit.*the port is rated 1 Gbit/u);
    expect(describeId('board.nic-stats', s)?.nerd).toMatch(/rx 123 k frames.*tx 62 k frames/u);
    expect(describeId('board.nic-rxq', s)?.nerd).toMatch(/FIFO 2\/2 segments.*1 downloads in flight.*11 downloaded/u);
    expect(describeId('board.nic-txq', s)?.nerd).toMatch(/0 uploads in flight.*2 results wait.*7 uploaded/u);
    expect(describeId('board.nic-dma', s)?.nerd).toMatch(/15 k words moved/u);
    // (the board's jack has the smallest buffer of the ports, with no cable in it too)
    expect(describeId('board.nic-rxq', boardGame(3, false))?.nerd).toMatch(
      /^FIFO of 2 segments \| downloads in flight/u,
    );
    // the board's jack has its own address in the address model (board tier 3)
    expect(describeId('board.nic-mac', s)?.nerd).toMatch(/this port's address 02:48:41:4B:03:01/u);
    expect(must(describeId('board.nic-mac')).nerd).not.toMatch(/address/u);
    // the host link goes to the hub, one lane: not the card's PCIe edge
    expect(describeId('board.nic-pcie', s)?.title).toBe('Hub link');
    expect(describeId('board.nic-pcie', s)?.nerd).toMatch(/^x1, 2 pairs/u);
  });

  it('names the speed of the board it is on, and the pairs a Fast Ethernet port uses', () => {
    const fast = boardGame(1),
      gig = boardGame(3);
    expect(describeId('board.nic-ctl', fast)?.nerd).toMatch(/RL-E100, 100BASE-TX/u);
    expect(describeId('board.nic-phy', fast)?.nerd).toMatch(
      /100BASE-TX.*link up, 100 Mbit.*the port is rated 100 Mbit/u,
    );
    expect(describeId('board.nic-phy', fast)?.plain).toMatch(/two of the four pairs/u);
    expect(must(describeId('board.nic-phy', gig)).plain).not.toMatch(/two of the four pairs/u);
    // (the card's PHY warns of heat; the board's has no sensor to say it by)
    expect(must(describeId('board.nic-phy', gig)).plain).not.toMatch(/too hot/u);
  });

  it("says so when the cable is not in the board's jack, and gives the plan's own words with no game", () => {
    expect(describeId('board.nic-phy', boardGame(3, false))?.nerd).toMatch(/no cable in the board jack/u);
    expect(describeId('board.nic-stats', boardGame(3, false))?.nerd).toMatch(/counters/u);
    // (a cable in a card is no cable in the board's jack)
    const card = game('nic2', 10_000);
    card.board = boardSnap({ tier: 3 });
    expect(describeId('board.nic-phy', card)?.nerd).toMatch(/no cable in the board jack/u);
    expect(describeId('board.nic-stats', card)?.nerd).toMatch(/counters/u);
    expect(describeId('board.nic-phy')?.nerd).toMatch(/no game/u);
    expect(describeId('board.nic-pcie')?.nerd).toMatch(/^x1, 2 pairs/u);
  });

  it("has none of the card's bodies, and keeps the card's words when the card is in the game too", () => {
    for (const k of ['jack', 'edge', 'label', 'nvm', 'xtal', 'vreg', 'temp', 'nonsense', '']) {
      const id = `board.nic-${k}`;
      expect(isNicId(id), `for ${id}`).toBe(false);
      expect(describeId(id, boardGame(3)), `for ${id}`).toBeNull();
    }
    expect(isNicId('board.nic-mac')).toBe(true);
    expect(isNicId('boardx.nic-mac')).toBe(false);
    const s = game('nic2', 10_000);
    s.board = boardSnap({ tier: 3 });
    expect(describeId('pcie1.nic-pcie', s)?.title).toBe('PCIe interface');
    expect(describeId('board.nic-pcie', s)?.title).toBe('Hub link');
    expect(describeId('pcie1.nic-temp', s)).not.toBeNull();
  });
});
