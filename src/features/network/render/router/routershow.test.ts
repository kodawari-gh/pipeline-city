import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import type { TransferSnap } from '@/worker/game/types';
import { snap } from '@/core/ui/testdata';
import { FrameMeter, lineFrames } from '../plan/netmeter';
import { limitWords, routerShow } from './routershow';

const ROUTER = { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' };
const ISP = { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 2 };
const flow = (dir: 'down' | 'up', label: string, percent: number): TransferSnap => ({
  jobId: 1,
  label,
  dir,
  totalMB: 100,
  doneMB: percent,
  percent,
  etaTicks: 4,
  persisted: false,
});

/** A running machine with its cable in the board's jack, over a router and a plan. */
function game(
  o: {
    plugged?: boolean;
    on?: boolean;
    tripped?: boolean;
    router?: boolean;
    plan?: boolean;
    flows?: TransferSnap[];
    portMbps?: number;
  } = {},
): Snapshot {
  const { plugged = true, on = true, tripped = false, router = true, plan = true, flows = [], portMbps = 1000 } = o,
    base = snap();
  return snap({
    powered: on,
    power: { ...base.power, tripped },
    net: {
      ...base.net!,
      state: 'link-up',
      reason: null,
      port: plugged ? { kind: 'board', deviceId: null, mbps: portMbps } : { kind: null, deviceId: null, mbps: 0 },
      router: router ? ROUTER : null,
      isp: plan ? ISP : null,
      bandwidth: { downMbps: 200, upMbps: 50, clients: 2, binding: 'isp' },
      transfers: flows,
      frames: { rx: 90000, tx: 45000 },
      counters: { delivered: 3, downloaded: 7, uploaded: 5, lost: 0 },
    },
  });
}

describe('what the router shows', () => {
  it('has nothing for a snapshot with no router', () => {
    const m = new FrameMeter();
    expect(routerShow(null, m, 0)).toBeNull();
    expect(routerShow(snap(), m, 0)).toBeNull();
    expect(routerShow(game({ router: false }), m, 0)).toBeNull();
  });

  it('is the router the snapshot has: its tier, its speed and its clients', () => {
    const s = routerShow(game(), new FrameMeter(), 5)!;
    expect([s.tier, s.name, s.ratedMbps, s.clientsMax, s.ms]).toEqual([2, 'Gigabit router', 1000, 4, 5]);
    expect(
      routerShow(
        {
          ...game(),
          net: { ...game().net!, router: { ...ROUTER, id: 'router4', name: 'Edge router', mbps: 40000, clients: 16 } },
        },
        new FrameMeter(),
        0,
      )!.tier,
    ).toBe(4);
  });

  it("links the PC when it is on and plugged, and the line when a plan is on it; the speed on the LAN is the slower of the PC's port and the router", () => {
    const s = routerShow(game(), new FrameMeter(), 0)!;
    expect([s.pc, s.wan, s.plugged, s.lanMbps]).toEqual([true, true, true, 1000]);
    expect(routerShow(game({ portMbps: 100 }), new FrameMeter(), 0)!.lanMbps).toBe(100);
    expect(routerShow(game({ portMbps: 10000 }), new FrameMeter(), 0)!.lanMbps).toBe(1000);
    expect(s.ispName).toBe('Cable');
    expect([s.downMbps, s.upMbps]).toEqual([200, 50]);
  });

  it('loses the LAN link with the machine off, a tripped supply or no cable, but keeps the line while a plan is on it', () => {
    for (const o of [{ on: false }, { tripped: true }, { plugged: false }]) {
      const s = routerShow(game(o), new FrameMeter(), 0)!;
      expect(s.pc, JSON.stringify(o)).toBe(false);
      expect(s.lanMbps, JSON.stringify(o)).toBe(0);
      expect(s.wan, JSON.stringify(o)).toBe(true);
    }
    expect(routerShow(game({ plugged: false }), new FrameMeter(), 0)!.plugged).toBe(false);
    expect(routerShow(game({ plan: false }), new FrameMeter(), 0)!.wan).toBe(false);
  });

  it('counts frames only while both sides have a link, and reads them as a rate and as a share of the line rate', () => {
    const m = new FrameMeter();
    m.feed({ baseTick: 1, net: { frames: { rx: 0, tx: 0 } } });
    m.feed({ baseTick: 2, net: { frames: { rx: 1000, tx: 100 } } });
    const s = routerShow(game(), m, 0)!,
      line = lineFrames(1000);
    expect([s.rx, s.tx]).toEqual([1000, 100]);
    expect(s.rxLoad).toBeCloseTo(1000 / line, 9);
    expect(s.txLoad).toBeCloseTo(100 / line, 9);
    expect(s.rxAct).toBeGreaterThan(s.txAct);
    expect(s.rxAct).toBeGreaterThan(0.12);
    expect([s.rxTotal, s.txTotal]).toEqual([90000, 45000]);
    for (const o of [{ plugged: false }, { on: false }, { plan: false }]) {
      const d = routerShow(game(o), m, 0)!;
      expect([d.rx, d.tx, d.rxAct, d.txAct, d.rxLoad > 0 ? 1 : 0], JSON.stringify(o)).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('shows the transfers in flight, each in its own direction, and the clients in service against the slots the router and the plan give', () => {
    const s = routerShow(
      game({ flows: [flow('down', '#5 hash', 30), flow('down', '#6 db', 60), flow('up', '#4 log', 10)] }),
      new FrameMeter(),
      0,
    )!;
    expect(s.downs.map((f) => f.label)).toEqual(['#5 hash', '#6 db']);
    expect(s.ups.map((f) => f.percent)).toEqual([10]);
    expect([s.used, s.slots]).toEqual([3, 2]);
    expect(routerShow(game({ plan: false }), new FrameMeter(), 0)!.slots).toBe(4);
  });

  it('names what limits the speed', () => {
    const s = routerShow(game(), new FrameMeter(), 0)!;
    expect(s.binding).toBe('isp');
    expect(s.limitMbps).toBe(200);
    expect(limitWords({ binding: 'isp', limitMbps: 200 })).toBe('the plan, 200 Mb');
    expect(limitWords({ binding: 'router', limitMbps: 1000 })).toBe('the router, 1 Gb');
    expect(limitWords({ binding: 'disk', limitMbps: 2000 })).toBe('the drive, 2 Gb');
    expect(limitWords({ binding: 'port', limitMbps: 100 })).toBe("the PC's port, 100 Mb");
    expect(limitWords({ binding: null, limitMbps: 0 })).toBe('none');
  });
});

describe('the addresses the router shows', () => {
  it("reads them from the snapshot: the LAN and WAN sides, the PC's lease and a connection for each transfer", () => {
    const s = routerShow(
      game({ flows: [flow('down', '#5 hash', 30), { ...flow('up', '#4 log', 10), jobId: 2 }] }),
      new FrameMeter(),
      0,
    )!;
    expect(s.addr!.lan!.ip).toBe('192.168.1.1');
    expect(s.addr!.host!.ip).toBe('192.168.1.100');
    expect(s.addr!.router).toEqual({ wan: '02:52:4C:02:00:01', lan: '02:52:4C:02:00:02' });
    expect(s.addr!.conns.map((c) => [c.jobId, c.dir])).toEqual([
      [1, 'down'],
      [2, 'up'],
    ]);
    // each flow names its job and its way, so a row of the NAT table finds its connection
    expect(s.downs.map((f) => [f.jobId, f.dir])).toEqual([[1, 'down']]);
    expect(s.ups.map((f) => [f.jobId, f.dir])).toEqual([[2, 'up']]);
  });

  it('has no lease with no cable and no public address with no plan', () => {
    expect(routerShow(game({ plugged: false }), new FrameMeter(), 0)!.addr!.host).toBeNull();
    const d = routerShow(game({ plan: false }), new FrameMeter(), 0)!;
    expect(d.addr!.wan).toBeNull();
    expect(d.addr!.router!.wan).toBe('02:52:4C:02:00:01');
    expect(d.addr!.conns).toEqual([]);
  });
});
