import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import type { TransferSnap } from '@/worker/game/types';
import { dev, snap } from '@/core/ui/testdata';
import { FrameMeter, lineFrames } from '../plan/netmeter';
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
