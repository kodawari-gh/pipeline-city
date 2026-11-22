import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import type { TransferSnap } from '@/worker/game/types';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { FrameMeter, lineFrames } from '../plan/netmeter';
import { BOARD_NIC } from './nicplan';
import { nicShow } from './nicshow';

const ROUTER = { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' };
const ISP = { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 };
const flow = (dir: 'down' | 'up', label: string, percent: number): TransferSnap => ({ jobId: 1, label, dir, totalMB: 100, doneMB: percent, percent, etaTicks: 4, persisted: false });

/** A running machine with a 10 GbE card in slot pcie1, the cable in it (or not), over a router and a plan. */
function game(o: { plugged?: boolean; on?: boolean; tripped?: boolean; router?: boolean; temp?: number; throttle?: number; burnt?: boolean; flows?: TransferSnap[]; waiting?: number } = {}): Snapshot {
  const { plugged = true, on = true, tripped = false, router = true, temp = 41, throttle = 1, burnt = false, flows = [], waiting = 0 } = o, base = snap();
  return snap({
    powered: on, power: { ...base.power, tripped },
    devices: [dev({ id: 'n1', spec: 'nic2', kind: 'nic', slot: 'pcie1', tempC: temp, powerW: 6.5, throttle, burnt })],
    net: {
      ...base.net!, state: 'link-up', reason: null, port: plugged ? { kind: 'nic', deviceId: 'n1', mbps: 10000 } : { kind: null, deviceId: null, mbps: 0 },
      router: router ? ROUTER : null, isp: ISP, bandwidth: { downMbps: 200, upMbps: 50, clients: 4, binding: 'isp' }, transfers: flows, uploadsWaiting: waiting,
      frames: { rx: 90000, tx: 45000 }, counters: { delivered: 3, downloaded: 7, uploaded: 5, lost: 0 },
    },
  });
}

describe('what the card shows', () => {
  it('has nothing for a snapshot with no such card', () => {
    const m = new FrameMeter();
    expect(nicShow(null, 'pcie1', m, 0)).toBeNull();
    expect(nicShow(game(), 'pcie0', m, 0)).toBeNull();
    expect(nicShow(snap(), 'pcie1', m, 0)).toBeNull();
  });

  it('links when the cable is in this card, the router stands and the machine is on', () => {
    const s = nicShow(game(), 'pcie1', new FrameMeter(), 5)!;
    expect(s.plugged).toBe(true);
    expect(s.link).toBe(true);
    expect(s.mbps).toBe(10000);
    expect(s.rated).toBe(10000);
    expect(s.ms).toBe(5);
    expect(s.binding).toBe('isp');
    expect(s.limitMbps).toBe(200);
  });

  it('has no link, and none of the port\'s counters, when the cable is in another jack', () => {
    const s = nicShow(game({ plugged: false }), 'pcie1', Object.assign(new FrameMeter(), { rx: 500, tx: 100 }), 0)!;
    expect(s.plugged).toBe(false);
    expect(s.link).toBe(false);
    expect(s.mbps).toBe(0);
    expect([s.rx, s.tx, s.rxTotal, s.txTotal, s.rxAct, s.txAct]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.downs).toEqual([]);
    expect(s.binding).toBeNull();
  });

  it('loses the link with the machine off, a tripped supply or no router, but still has the cable', () => {
    for (const o of [{ on: false }, { tripped: true }, { router: false }]) {
      const s = nicShow(game(o), 'pcie1', new FrameMeter(), 0)!;
      expect(s.plugged, JSON.stringify(o)).toBe(true);
      expect(s.link, JSON.stringify(o)).toBe(false);
    }
  });

  it('reads the frames the port carries as a rate and as a share of the line rate', () => {
    const m = new FrameMeter();
    m.feed({ baseTick: 1, net: { frames: { rx: 0, tx: 0 } } });
    m.feed({ baseTick: 2, net: { frames: { rx: 1000, tx: 100 } } });
    const s = nicShow(game(), 'pcie1', m, 0)!, line = lineFrames(10000);
    expect([s.rx, s.tx]).toEqual([1000, 100]);
    expect(s.rxLoad).toBeCloseTo(1000 / line, 9);
    expect(s.txLoad).toBeCloseTo(100 / line, 9);
    expect(s.rxAct).toBeGreaterThan(s.txAct);
    expect(s.rxAct).toBeGreaterThan(0.12);
    expect([s.rxTotal, s.txTotal]).toEqual([90000, 45000]);
  });

  it('shows the transfers in flight, each in its own direction, and the results that wait', () => {
    const s = nicShow(game({ flows: [flow('down', '#5 hash', 30), flow('down', '#6 db', 60), flow('up', '#4 log', 10)], waiting: 2 }), 'pcie1', new FrameMeter(), 0)!;
    expect(s.downs.map((f) => f.label)).toEqual(['#5 hash', '#6 db']);
    expect(s.ups.map((f) => f.percent)).toEqual([10]);
    expect(s.waiting).toBe(2);
    expect([s.downloaded, s.uploaded]).toEqual([7, 5]);
  });

  it('reads the buffers the sim keeps for the port the cable is in, and none for a card with no cable', () => {
    const busy = (s: Snapshot): Snapshot => { s.net!.stack = { ...s.net!.stack, nic: { ...s.net!.stack.nic, enabled: true, fifo: 3, rxUsed: 2, txUsed: 1, drops: 4, dmaWords: 900 } }; return s; };
    expect(nicShow(busy(game()), 'pcie1', new FrameMeter(), 0)).toMatchObject({ fifo: 3, rxUsed: 2, txUsed: 1, drops: 4, dmaWords: 900, driver: true });
    expect(nicShow(busy(game({ plugged: false })), 'pcie1', new FrameMeter(), 0)).toMatchObject({ fifo: 0, rxUsed: 0, txUsed: 0, drops: 0, dmaWords: 0, driver: false });
    // (the board's jack is a port like a card's: the same buffers when the cable is in it, none when it is in a card)
    expect(nicShow(busy(boardGame()), BOARD_NIC, new FrameMeter(), 0)).toMatchObject({ fifo: 3, rxUsed: 2, drops: 4, driver: true });
    expect(nicShow(busy(boardGame({ plugged: false })), BOARD_NIC, new FrameMeter(), 0)).toMatchObject({ fifo: 0, drops: 0, driver: false });
    // a card with the driver not yet running has empty buffers and says so
    expect(nicShow(game(), 'pcie1', new FrameMeter(), 0)).toMatchObject({ fifo: 0, rxUsed: 0, txUsed: 0, drops: 0, driver: false });
  });

  it('takes the heat and the power from the card itself', () => {
    const s = nicShow(game({ temp: 77, throttle: 0.5 }), 'pcie1', new FrameMeter(), 0)!;
    expect(s.tempC).toBe(77);
    expect(s.hot).toBe(true);
    expect(s.powerW).toBe(6.5);
    expect(s.idleW).toBe(5);
    expect(s.loadW).toBe(11);
    expect(s.throttleC).toBeGreaterThan(40);
    expect(s.damageC).toBeGreaterThan(s.unstableC);
    expect(s.unstableC).toBeGreaterThan(s.throttleC);
    expect(nicShow(game({ burnt: true }), 'pcie1', new FrameMeter(), 0)!.burnt).toBe(true);
  });
});

/** A running machine on a board of tier `tier` (100 Mbit ports below the Enthusiast board's 1000), the cable in the board jack (or not), over a router and a plan. */
function boardGame(o: { tier?: number; plugged?: boolean; on?: boolean; burnt?: boolean; card?: boolean } = {}): Snapshot {
  const { tier = 3, plugged = true, on = true, burnt = false, card = false } = o, base = snap(), b = boardSnap({ tier, burnt });
  const mbps = b.features.ethernetMbps;
  return snap({
    powered: on, power: { ...base.power, tripped: false }, board: b,
    devices: card ? [dev({ id: 'n1', spec: 'nic2', kind: 'nic', slot: 'pcie1', tempC: 41, powerW: 6.5 })] : [],
    net: {
      ...base.net!, state: 'link-up', reason: null, port: plugged ? { kind: 'board', deviceId: null, mbps: burnt ? 0 : mbps } : { kind: null, deviceId: null, mbps: 0 },
      router: ROUTER, isp: ISP, bandwidth: { downMbps: 100, upMbps: 50, clients: 4, binding: 'port' },
      transfers: [flow('down', '#5 hash', 30)], frames: { rx: 7000, tx: 3500 }, counters: { delivered: 3, downloaded: 7, uploaded: 5, lost: 0 },
    },
  });
}

describe('what the chip on the motherboard shows', () => {
  it('is the board\'s port: its own speed is the rating, and the cable is in it when the net says so', () => {
    const m = Object.assign(new FrameMeter(), { rx: 500, tx: 100 });
    for (const tier of [1, 2, 3]) {
      const s = nicShow(boardGame({ tier }), BOARD_NIC, m, 9)!, mbps = tier === 3 ? 1000 : 100;
      expect([s.plugged, s.link, s.rated, s.mbps, s.burnt, s.ms], `tier ${tier}`).toEqual([true, true, mbps, mbps, false, 9]);
      expect([s.rxTotal, s.txTotal, s.rx, s.tx], `tier ${tier}`).toEqual([7000, 3500, 500, 100]);
      expect(s.downs.map((f) => f.label), `tier ${tier}`).toEqual(['#5 hash']);
      expect(s.binding, `tier ${tier}`).toBe('port');
    }
  });

  it('has nothing on a board with no jack, in no game, or with the cable in no port; and no counters with the cable in a card', () => {
    const m = new FrameMeter();
    expect(nicShow(boardGame({ tier: 0 }), BOARD_NIC, m, 0)).toBeNull();
    expect(nicShow(null, BOARD_NIC, m, 0)).toBeNull();
    const out = nicShow(boardGame({ plugged: false }), BOARD_NIC, Object.assign(new FrameMeter(), { rx: 500, tx: 100 }), 0)!;
    expect([out.plugged, out.link, out.mbps, out.rx, out.rxTotal, out.downs.length]).toEqual([false, false, 0, 0, 0, 0]);
    // the cable in a card: this is the card's port, not the board's
    const card = game();
    card.board = boardSnap({ tier: 3 });
    expect(nicShow(card, BOARD_NIC, m, 0)!.plugged).toBe(false);
    expect(nicShow(card, 'pcie1', m, 0)!.plugged).toBe(true);
  });

  it('loses the link with the machine off, and shows a dead board as burnt out', () => {
    expect(nicShow(boardGame({ on: false }), BOARD_NIC, new FrameMeter(), 0)).toMatchObject({ plugged: true, link: false, mbps: 0 });
    expect(nicShow(boardGame({ burnt: true }), BOARD_NIC, new FrameMeter(), 0)).toMatchObject({ burnt: true, link: false, mbps: 0 });
  });

  it('has no heat of its own: the sim keeps no temperature for it, so it is never hot and draws nothing the card way', () => {
    const s = nicShow(boardGame(), BOARD_NIC, new FrameMeter(), 0)!;
    expect([s.hot, s.tempC, s.throttleC, s.unstableC, s.damageC, s.powerW, s.idleW, s.loadW]).toEqual([false, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('leaves the card\'s port as it was when a board has a jack too', () => {
    const s = nicShow(boardGame({ card: true, plugged: false }), 'pcie1', new FrameMeter(), 0)!;
    expect([s.plugged, s.rated, s.tempC]).toEqual([false, 10000, 41]);
  });
});
