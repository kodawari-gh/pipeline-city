import { describe, expect, it } from 'vitest';
import type { CableSnap, Snapshot, StorageSnap } from '@/worker/game/game';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec } from '../../sim/specs';
import { snap } from '@/core/ui/testdata';
import { netLensReady } from '../netvis';
import { ispLine, netDraw, netShape, speedLevel } from './shape';
import type * as shapeTypes from './shape';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const A: shapeTypes.NetAnchors = {
  plate: { at: [0, 0, 96], hw: 300, hh: 300 },
  router: { at: [-2000, 200, 800], hw: 1000, hh: 300 },
  lan: {
    strands: [
      [
        [-1000, 100, 800],
        [-900, -500, 900],
        [-800, -1500, 1500],
      ],
    ],
    seated: true,
    jack: [-800, -1500, 1500],
    r: 40,
  },
  drive: [1000, -500, 2000],
};

/** The OS drive of spec `spec`, idle and empty. */
const osDrive = (spec: string): StorageSnap => ({
  deviceId: 'd1',
  slot: 'sata0',
  spec,
  name: spec,
  burnt: false,
  capacityBytes: 96 * 1024,
  usedBytes: 0,
  bytesRead: 0,
  bytesWritten: 0,
  busy: false,
  latencyTicks: 720,
  blockTicks: 72,
  bytesPerSecond: 3600,
  hasOs: true,
  fs: { runs: [], fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 }, files: [] },
  wear: [],
  headLba: 0,
  cmds: [],
  wearPct: 0,
  badGroups: 0,
  lostBlocks: 0,
  queueDepth: 2,
  queued: 0,
  mirror: false,
  mount: { state: 'unformatted', phase: 'unmounted', progress: 0 },
  format: { why: null, datasets: 0 },
});
/** The LAN lead, plugged in or not. */
const lanLead = (connected: boolean): CableSnap => ({ id: 'lan', name: 'Ethernet cable', connected });

/** A linked rig: board jack `portMbps`, router and plan by id, OS drive by spec id; the LAN lead plugged in. */
function rig({
  portMbps,
  routerId,
  ispId,
  driveSpec,
  net = {},
}: {
  portMbps: number;
  routerId: string;
  ispId: string;
  driveSpec: string;
  net?: Partial<Snapshot['net']>;
}): Snapshot {
  const r = must(getRouterSpec(routerId)),
    p = must(getIspSpec(ispId)),
    base = snap();
  return snap({
    storage: [osDrive(driveSpec)],
    board: { ...base.board, features: { ...base.board.features, ethernetMbps: portMbps } },
    cables: [lanLead(true)],
    net: {
      ...base.net,
      state: 'link-up',
      reason: null,
      port: { kind: 'board', deviceId: null, mbps: portMbps },
      router: { id: r.id, name: r.name, mbps: r.mbps, clients: r.clients, visual: r.visual },
      isp: { id: p.id, name: p.name, downMbps: p.downMbps, upMbps: p.upMbps, clients: p.clients },
      bandwidth: bandwidth(portMbps, r, p, must(DISK_NET_MBPS[driveSpec])),
      ...net,
    },
  });
}

const transfer = (dir: 'down' | 'up', jobId = 1) => ({
  jobId,
  label: 'x',
  dir,
  totalMB: 10,
  doneMB: 1,
  percent: 10,
  etaTicks: 5,
  persisted: false as const,
});

describe('speedLevel', () => {
  it('runs from the foot of the scale to its top, and never leaves it', () => {
    expect(speedLevel(0)).toBeCloseTo(0.08);
    expect(speedLevel(10)).toBeCloseTo(0.08);
    expect(speedLevel(20_000)).toBeCloseTo(1);
    expect(speedLevel(1e6)).toBe(1);
    expect(speedLevel(100)).toBeLessThan(speedLevel(1000));
    expect(speedLevel(1000)).toBeLessThan(speedLevel(10_000));
  });
});

describe('the network lens shape', () => {
  it("is the plan's line and one line for each strand of the lead", () => {
    const s = netShape(A);
    expect(s.lines.map((l) => l.id)).toStrictEqual(['isp', 'lan']);
    expect(s.lines[1]?.pts).toHaveLength(3);
    // (the lens keeps its own copy of the strand: the machine's points are not touched)
    expect(must(s.lines[1]).pts[0]).not.toBe(must(must(A.lan).strands[0])[0]);
  });
  it("is the plan's line alone with no lead, and leaves out a strand of one point", () => {
    expect(netShape({ ...A, lan: null }).lines.map((l) => l.id)).toStrictEqual(['isp']);
    expect(netShape({ ...A, lan: { ...must(A.lan), strands: [[[0, 0, 0]]] } }).lines.map((l) => l.id)).toStrictEqual([
      'isp',
    ]);
  });
  it("runs the plan's line from the plate to the router's back", () => {
    const l = ispLine(A);
    expect(l[0]?.[0]).toBeLessThan(A.plate.at[0]);
    expect(l.at(-1)?.[2]).toBeGreaterThan(must(l[0])[2]);
    // (it ends inside the router's width)
    const end = must(l.at(-1));
    expect(Math.abs(end[0] - A.router.at[0])).toBeLessThanOrEqual(A.router.hw);
  });
});

describe('the network lens draw', () => {
  const shape = netShape(A);
  it('trickles with the link up and nothing moving, and runs both ways with transfers', () => {
    const idle = netDraw(shape, rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }), A);
    expect([...idle.state]).toStrictEqual([1, 1]);
    expect([...idle.down]).toStrictEqual([0, 0]);
    expect([...idle.up]).toStrictEqual([0, 0]);
    const busy = netDraw(
      shape,
      rig({
        portMbps: 1000,
        routerId: 'router3',
        ispId: 'isp4',
        driveSpec: 'nvme2',
        net: { transfers: [transfer('down'), transfer('up', 2)] },
      }),
      A,
    );
    expect(busy.down[1]).toBeGreaterThan(0);
    expect(busy.up[1]).toBeGreaterThan(0);
    // (the faster the link, the faster the pulses: the upload leg is the slower)
    expect(busy.down[1]).toBeGreaterThanOrEqual(must(busy.up[1]));
  });
  it("paces the pulses by the link's speed", () => {
    const slow = netDraw(
      shape,
      rig({
        portMbps: 100,
        routerId: 'router3',
        ispId: 'isp4',
        driveSpec: 'nvme2',
        net: { transfers: [transfer('down')] },
      }),
      A,
    );
    const fast = netDraw(
      shape,
      rig({
        portMbps: 10_000,
        routerId: 'router3',
        ispId: 'isp4',
        driveSpec: 'nvme2',
        net: { transfers: [transfer('down')] },
      }),
      A,
    );
    expect(fast.down[1]).toBeGreaterThan(must(slow.down[1]));
  });
  it("shows the lead out in red while the plan's line is up", () => {
    const s = rig({
      portMbps: 1000,
      routerId: 'router3',
      ispId: 'isp4',
      driveSpec: 'nvme2',
      net: {
        state: 'no-cable',
        port: { kind: null, deviceId: null, mbps: 0 },
      },
    });
    s.cables = [lanLead(false)];
    const open = netDraw(shape, s, A);
    expect([...open.state]).toStrictEqual([1, 2]);
    expect(open.tags.find((t) => t.id === 'link')).toMatchObject({ text: 'No cable', tone: 'limit' });
    expect(open.tags.find((t) => t.id === 'port')).toMatchObject({ text: 'Port · plug the cable in', tone: 'warn' });
  });
  it('shows a down link in red and a link that needs setup as a dim thread', () => {
    expect([
      ...netDraw(
        shape,
        rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2', net: { state: 'down' } }),
        A,
      ).state,
    ]).toStrictEqual([1, 2]);
    expect([
      ...netDraw(
        shape,
        rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2', net: { state: 'no-os' } }),
        A,
      ).state,
    ]).toStrictEqual([1, 0]);
  });
  it('lights nothing with no network', () => {
    const d = netDraw(shape, snap({ net: { ...snap().net, router: null, isp: null, state: 'no-device' } }), A);
    expect([...d.state]).toStrictEqual([0, 0]);
    expect(d.limit).toBeNull();
    expect(d.tags.find((t) => t.id === 'plan')).toMatchObject({ tone: 'warn' });
    expect(d.tags.find((t) => t.id === 'router')).toMatchObject({ tone: 'warn' });
  });
  it('words each piece of the link, and calls the slowest the limit', () => {
    const d = netDraw(shape, rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'hdd0' }), A);
    const word = (id: string) => must(d.tags.find((t) => t.id === id));
    expect(word('plan').text).toMatch(/^Plan · /u);
    expect(word('router').text).toMatch(/^Router · .* clients$/u);
    expect(word('port').text).toMatch(/^Port · /u);
    expect(word('drive')).toMatchObject({ tone: 'limit' });
    expect(word('drive').text).toMatch(/limit$/u);
    expect(d.limit).toBe('disk');
    // (only the slowest is the limit)
    expect(word('plan').tone).toBe('net');
    expect(word('router').tone).toBe('net');
  });
  it('counts the clients that are being served', () => {
    const d = netDraw(
      shape,
      rig({
        portMbps: 1000,
        routerId: 'router3',
        ispId: 'isp4',
        driveSpec: 'nvme2',
        net: { transfers: [transfer('down', 1), transfer('up', 2), transfer('up', 1)] },
      }),
      A,
    );
    expect(d.tags.find((t) => t.id === 'router')?.text).toContain('2/');
  });
  it("puts the legend under the link's word when the link needs care, and under the router's last pill otherwise", () => {
    expect(
      netDraw(shape, rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }), A).tags.find(
        (t) => t.id === 'legend',
      ),
    ).toMatchObject({
      legend: 'net',
      under: 'router-wan',
    });
    expect(
      netDraw(
        shape,
        rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2', net: { state: 'down' } }),
        A,
      ).tags.find((t) => t.id === 'legend'),
    ).toMatchObject({ under: 'link' });
    // (with no plan the router has no WAN side: the legend goes under its LAN pill; with no router, under the router's own word)
    expect(
      netDraw(
        shape,
        rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2', net: { isp: null } }),
        A,
      ).tags.find((t) => t.id === 'legend'),
    ).toMatchObject({ under: 'router-lan' });
    expect(
      netDraw(
        shape,
        rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2', net: { router: null } }),
        A,
      ).tags.find((t) => t.id === 'legend'),
    ).toMatchObject({ under: 'router' });
  });
  it("leaves the drive's word out with no OS drive and the port's with no lead", () => {
    const noDrive = netDraw(
      shape,
      { ...rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }), storage: [] },
      A,
    );
    expect(noDrive.tags.some((t) => t.id === 'drive')).toBe(false);
    const noLead = netDraw(
      netShape({ ...A, lan: null }),
      rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }),
      { ...A, lan: null },
    );
    expect(noLead.tags.some((t) => t.id === 'port')).toBe(false);
  });
});

describe('netLensReady', () => {
  it('waits for the network: its unlock level, a router, a plan, a router in the inventory or a lead plugged in', () => {
    const base = snap();
    expect(netLensReady(base)).toBe(false);
    expect(netLensReady(snap({ level: { ...base.level, level: 4 } }))).toBe(true);
    expect(netLensReady(rig({ portMbps: 1000, routerId: 'router1', ispId: 'isp1', driveSpec: 'nvme2' }))).toBe(true);
    const leadIn = snap({ cables: [lanLead(true)] });
    expect(netLensReady(leadIn)).toBe(true);
  });
});

/** The rig with the machine on, so the link is up and the PC has the IP address the router gave it. */
const lit = (net: Partial<Snapshot['net']> = {}): Snapshot => {
  const s = rig({ portMbps: 1000, routerId: 'router2', ispId: 'isp2', driveSpec: 'nvme2', net });
  return { ...s, powered: true, power: { ...s.power, tripped: false } };
};
type Draw = ReturnType<typeof netDraw>;
const tag = (d: Draw, id: string) => d.tags.find((t) => t.id === id);
/** The pills placed under another pill, each with the one it hangs under. */
const hung = (d: Draw) =>
  d.tags.flatMap((t) => (t.under === undefined || t.under === '' ? [] : [{ id: t.id, under: t.under }]));
/** The words of the pills that are any of `ids`. */
const anyOf = (d: Draw, ids: readonly string[]) => d.tags.filter((t) => ids.includes(t.id));

describe('the addresses in the lens words', () => {
  const shape = netShape(A);

  it("pins the gateway under the plan, the router's two sides under the router and the PC's jack under the port, each in dim words", () => {
    const d = netDraw(shape, lit(), A);
    expect(tag(d, 'plan-addr')).toMatchObject({ tone: 'dim', under: 'plan' });
    expect(tag(d, 'plan-addr')?.text).toMatch(/^gateway 203\.0\.113\.1 · 02(?::[0-9A-F]{2}){5}$/u);
    expect(tag(d, 'router-lan')).toMatchObject({
      tone: 'dim',
      under: 'router',
      text: 'LAN 192.168.1.1 · 02:52:4C:02:00:02',
    });
    expect(tag(d, 'router-wan')).toMatchObject({ tone: 'dim', under: 'router-lan' });
    expect(tag(d, 'router-wan')?.text).toMatch(/^WAN 203\.0\.113\.\d+ · 02:52:4C:02:00:01$/u);
    expect(tag(d, 'port-addr')).toMatchObject({ tone: 'dim', under: 'port' });
    expect(tag(d, 'port-addr')?.text).toMatch(/^eth0 · 192\.168\.1\.100 · 02:48:41:4B(?::[0-9A-F]{2}){2}$/u);
  });
  it("lists a pill after the pill it hangs under, as the pills are placed in the list's order", () => {
    for (const net of [{}, { state: 'down' as const }, { isp: null }, { router: null }]) {
      const d = netDraw(shape, lit(net), A),
        at = (id: string) => d.tags.findIndex((t) => t.id === id);
      for (const t of hung(d)) {
        expect(at(t.under), `${t.id} under ${t.under}`).toBeGreaterThanOrEqual(0);
        expect(at(t.under), `${t.id} under ${t.under}`).toBeLessThan(at(t.id));
      }
    }
  });
  it("says no IP address on the PC's pill while its link is down, and keeps its MAC", () => {
    const off = netDraw(shape, { ...lit(), powered: false }, A);
    expect(tag(off, 'port-addr')?.text).toMatch(/^eth0 · no IP address · 02:48:41:4B/u);
  });
  it('leaves out the pill of a place that does not stand: no plan, no router, no cable', () => {
    const noPlan = netDraw(shape, lit({ isp: null }), A);
    expect(anyOf(noPlan, ['plan-addr', 'router-wan'])).toStrictEqual([]);
    expect(tag(noPlan, 'router-lan')).toBeDefined();
    const noRouter = netDraw(shape, lit({ router: null }), A);
    expect(anyOf(noRouter, ['router-lan', 'router-wan'])).toStrictEqual([]);
    const noCable = netDraw(shape, lit({ state: 'no-cable', port: { kind: null, deviceId: null, mbps: 0 } }), A);
    expect(noCable.tags.some((t) => t.id === 'port-addr')).toBe(false);
    expect(netDraw(shape, snap(), A).tags.some((t) => /-addr$|^router-/u.test(t.id))).toBe(false);
  });
  it("hangs the link's word under the router's last pill", () => {
    const down = netDraw(shape, lit({ state: 'down' }), A);
    expect(tag(down, 'link')).toMatchObject({ under: 'router-wan' });
  });
});
