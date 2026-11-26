import { describe, expect, it, vi } from 'vitest';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec } from '../sim/specs';
import type { Snapshot, StorageSnap } from '@/worker/game/game';
import type { OsSnap } from '@/worker/game/types';
import {
  addressModel,
  hudNetChip,
  limiterAdvice,
  limiterLadder,
  netPanel,
  netPanelShown,
  netStateChip,
  slaModel,
  uploadLimiter,
  usbModel,
} from './netui';
import { key, snap } from '@/core/ui/testdata';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

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

/** A linked rig: board jack `portMbps`, router and plan by id, OS drive by spec id. The bandwidth comes from the sim's own rule. */
function rig({
  portMbps,
  routerId,
  ispId,
  driveSpec,
}: {
  portMbps: number;
  routerId: string;
  ispId: string;
  driveSpec: string;
}): Snapshot {
  const r = must(getRouterSpec(routerId));
  const p = must(getIspSpec(ispId));
  const base = snap();
  return snap({
    storage: [osDrive(driveSpec)],
    board: { ...base.board, features: { ...base.board.features, ethernetMbps: portMbps } },
    net: {
      ...base.net,
      state: 'link-up',
      reason: null,
      port: { kind: 'board', deviceId: null, mbps: portMbps },
      router: { id: r.id, name: r.name, mbps: r.mbps, clients: r.clients, visual: r.visual },
      isp: { id: p.id, name: p.name, downMbps: p.downMbps, upMbps: p.upMbps, clients: p.clients },
      bandwidth: bandwidth({ portMbps, router: r, isp: p, diskMbps: must(DISK_NET_MBPS[driveSpec]) }),
    },
  });
}

describe('network panel: link chip and limiting component', () => {
  it('picks the port when the jack is the slowest piece', () => {
    const l = limiterLadder(rig({ portMbps: 100, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }));
    expect(l.binding).toBe('port');
    expect(l.downMbps).toBe(100);
    expect(l.segs.filter((x) => x.binding).map((x) => x.id)).toStrictEqual(['port']);
  });
  it('picks the router when it is the slowest piece', () => {
    const l = limiterLadder(rig({ portMbps: 1000, routerId: 'router1', ispId: 'isp3', driveSpec: 'nvme2' }));
    expect(l.binding).toBe('router');
    expect(l.segs.find((x) => x.binding)?.id).toBe('router');
  });
  it('picks the plan when it is the slowest piece', () => {
    const l = limiterLadder(rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp1', driveSpec: 'nvme2' }));
    expect(l.binding).toBe('isp');
    expect(l.downMbps).toBe(50);
    expect(limiterAdvice(l)).toMatch(/plan/u);
  });
  it('picks the drive (netMbps) when it is the slowest piece', () => {
    const l = limiterLadder(rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'hdd0' }));
    expect(l.binding).toBe('disk');
    expect(l.downMbps).toBe(80);
    expect(l.segs.find((x) => x.id === 'disk')?.binding).toBe(true);
  });
  it('shows the state chip with the link up and none without a network', () => {
    expect(netStateChip(rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }))).toMatchObject(
      { text: 'Link up', level: 'ok' },
    );
    expect(netStateChip(snap())).toBeNull();
  });
});

/** A linked rig with `net` fields overridden. */
function withNet(net: Partial<Snapshot['net']>, o: Partial<Snapshot> = {}): Snapshot {
  const r = rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' });
  return { ...r, ...o, net: { ...r.net, ...net } };
}

describe('HUD network chip', () => {
  it('is hidden until a router exists, even with a plan', () => {
    expect(hudNetChip(snap())).toBeNull();
    expect(hudNetChip(withNet({ router: null }))).toBeNull();
  });
  it('shows the speed when up and the reason word otherwise', () => {
    expect(hudNetChip(withNet({}))).toMatchObject({ icon: 'net', level: 'ok' });
    expect(hudNetChip(withNet({ state: 'no-cable' }))?.text).toBe('no cable');
    expect(hudNetChip(withNet({ state: 'down' }))?.text).toBe('down');
    expect(hudNetChip(withNet({ state: 'no-os' }))?.text).toBe('setup');
    expect(hudNetChip(withNet({ state: 'no-device', isp: null }))?.text).toBe('no plan');
  });
});

const spool = (used: number, slots: number, full: boolean) => ({ slotBytes: 1, slots, used, freeBytes: 0, full });
/** The panel over the linked rig with `net` fields (and snapshot fields `o`) overridden. */
const panel = (net: Partial<Snapshot['net']>, o: Partial<Snapshot> = {}) => must(netPanel(withNet(net, o)));
/** A running OS whose spool holds 3 of 4 jobs, full or not as `full` says, with `extra` on top. */
const osWith = (full: boolean, extra: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os1',
  tier: 1,
  name: 'Resident OS 1.0',
  deviceId: 'd1',
  slot: 'sata0',
  programSlots: 1,
  queueSlots: 4,
  up: true,
  queue: [],
  runningKeyId: null,
  spool: spool(3, 4, full),
  ...extra,
});
/** The USB fallback model in `state`, starting in `startsIn` ticks, with `retiredKeys` keys left over. */
const fb = (state: 'off' | 'retired' | 'waiting' | 'fallback', startsIn: number | null = null, retiredKeys = 0) =>
  usbModel(withNet({ usbFallback: { state, deadTicks: 0, startsIn, keyRateMul: 1 }, retiredKeys }));
/** The linked rig with the USB fallback retired and `n` keys left over. */
const retired = (n: number) =>
  withNet({ usbFallback: { state: 'retired', deadTicks: 0, startsIn: null, keyRateMul: 1 }, retiredKeys: n });

describe('network panel: offers, transfers, spool, USB fallback', () => {
  it('has no panel without a network', () => {
    expect(netPanel(snap())).toBeNull();
  });
  it('lists offers with time left, late and retired flags', () => {
    const p = panel(
      { offers: [key({ id: 1, deadlineTick: 120 }), key({ id: 2, deadlineTick: 20, late: true, retired: true })] },
      { baseTick: 50 },
    );
    expect(p.offers.map((o) => o.left)).toStrictEqual([70, 0]);
    expect(p.offers[1]).toMatchObject({ late: true, retired: true });
    expect(p.offers[0]?.retired).toBe(false);
    expect(p.stages.find((x) => x.id === 'offer')?.count).toBe(2);
  });
  it('shows transfers with clamped progress, eta and direction counts', () => {
    const t = { persisted: false as const, totalMB: 100, doneMB: 40, etaTicks: 0 };
    const p = must(
      netPanel(
        withNet({
          transfers: [
            { ...t, jobId: 1, label: '#1', dir: 'down', percent: 40, etaTicks: 90 },
            { ...t, jobId: 2, label: '#2', dir: 'up', percent: 140 },
          ],
        }),
      ),
    );
    expect(p.transfers.map((x) => x.pct)).toStrictEqual([40, 100]);
    expect(must(p.transfers[0]).etaText).not.toBe('now');
    expect(p.transfers[1]?.etaText).toBe('now');
    expect(p.stages.find((x) => x.id === 'downloading')?.count).toBe(1);
    expect(p.stages.find((x) => x.id === 'uploading')?.count).toBe(1);
    expect(p.clients.busy).toBe(2);
  });
  it('lists spooled jobs with their stage words', () => {
    const p = panel({
      spooled: [key({ id: 1, stage: 'spooled' }), key({ id: 2, stage: 'running' }), key({ id: 3, stage: 'uploading' })],
    });
    expect(p.spooled.map((r) => r.state)).toStrictEqual(['on the drive', 'running now', 'uploading']);
    expect(p.stages.find((x) => x.id === 'spooled')?.count).toBe(2);
  });
  it('reports the spool and os.spoolFull, which wins over spool.full', () => {
    expect(panel({}, { os: osWith(false) }).spool).toStrictEqual({ used: 3, slots: 4, full: false });
    expect(panel({}, { os: osWith(false, { spoolFull: true }) }).spool?.full).toBe(true);
    expect(panel({}, { os: osWith(true) }).spool?.full).toBe(true);
    expect(netPanel(withNet({}, { os: null }))?.spool).toBeNull();
  });
  it('describes the USB fallback states', () => {
    expect(fb('off')).toBeNull();
    expect(fb('retired')).toMatchObject({ state: 'retired', level: 'idle' });
    expect(fb('waiting', 600)).toMatchObject({ state: 'waiting', level: 'warn', countdown: 600 });
    expect(fb('waiting')?.text).toBe('Keys return soon');
    expect(fb('fallback')).toMatchObject({ state: 'fallback', level: 'warn', countdown: null });
  });
  it('counts retired keys in the USB detail and the panel', () => {
    expect(usbModel(retired(1))?.detail).toMatch(/^1 leftover key expire/u);
    expect(usbModel(retired(3))?.detail).toMatch(/^3 leftover keys expire/u);
    expect(usbModel(retired(0))?.detail).toMatch(/over the wire/u);
    expect(netPanel(retired(3))?.retiredKeys).toBe(3);
  });
});

describe('network panel: packets (the transport and the card)', () => {
  const nic = {
    enabled: true,
    fifo: 1,
    fifoSegs: 4,
    rxUsed: 2,
    rxSlots: 4,
    txUsed: 0,
    txSlots: 4,
    rx: 30,
    drops: 0,
    tx: 31,
    dmaWords: 900,
    irqs: 0,
  };
  const stack = (o: Partial<Snapshot['net']['stack']> = {}, n: Partial<typeof nic> = {}): Snapshot['net']['stack'] => ({
    sent: 120,
    resent: 3,
    lost: 2,
    timeouts: 3,
    loss: 0.0396,
    rtt: { srtt: 12.4, rttvar: 3, rto: 25 },
    nic: { ...nic, ...n },
    ...o,
  });
  const rows = (o?: Partial<Snapshot['net']['stack']>, n?: Partial<typeof nic>) => {
    const lines = must(panel({ stack: stack(o, n) }).stack).rows;
    return Object.fromEntries(lines.map((r) => [r.id, r]));
  };

  it("says the round trip the senders measured, and the timeout it gives, in the game's time", () => {
    const r = rows();
    expect(r['rtt']).toMatchObject({ label: 'Round trip', text: '12s', level: 'info' });
    expect(r['rtt']?.title).toMatch(/waits 25s for an answer/u);
    expect(rows({ rtt: null })['rtt']).toMatchObject({ text: '-' });
  });
  it('shows the chance the line loses a segment, and warns when the line is poor', () => {
    expect(rows()['loss']).toMatchObject({ text: '4.0%', level: 'warn' });
    expect(rows({ loss: 0.005 })['loss']).toMatchObject({ text: '0.50%', level: 'info' });
    expect(rows({ loss: 0 })['loss']?.text).toBe('0%');
    expect(rows({ loss: 0.2 })['loss']?.text).toBe('20%');
  });
  it('counts the segments sent, and the ones sent again, and warns when a tenth of them go twice', () => {
    expect(rows()['segments']).toMatchObject({ text: '120 sent · 3 again', level: 'info' });
    expect(rows({ resent: 0 })['segments']?.text).toBe('120 sent');
    expect(rows({ sent: 100, resent: 10 })['segments']?.level).toBe('warn');
    expect(rows()['segments']?.title).toMatch(/3 timers fired.*2 lost by the line itself/u);
  });
  it("shows the card's buffer and ring, and warns when it has dropped a segment", () => {
    expect(rows()['nic']).toMatchObject({ text: '1/4 waiting · ring 2/4', level: 'info' });
    expect(rows({}, { drops: 5 })['nic']).toMatchObject({ text: '1/4 waiting · ring 2/4 · 5 dropped', level: 'warn' });
    expect(rows({}, { enabled: false })['nic']?.text).toBe('card off');
  });
  it('has no lines with no link and nothing sent, and lines once the link is up', () => {
    expect(panel({ state: 'no-cable', stack: stack({ sent: 0 }) }).stack).toBeNull();
    expect(panel({ state: 'no-cable', stack: stack({ sent: 9 }) }).stack).not.toBeNull();
    expect(panel({ stack: stack({ sent: 0 }) }).stack).not.toBeNull();
  });
  it("tells a download's segments, window and resends on its transfer row, and nothing for an upload", () => {
    const t = { persisted: false as const, totalMB: 100, doneMB: 40, percent: 40, etaTicks: 4 };
    const p = must(
      netPanel(
        withNet({
          transfers: [
            {
              ...t,
              jobId: 1,
              label: '#1',
              dir: 'down',
              flow: { segs: 6, acked: 3, inflight: 2, window: 2, resent: 1, timeouts: 1, rto: 24 },
            },
            { ...t, jobId: 2, label: '#2', dir: 'up' },
          ],
        }),
      ),
    );
    expect(p.transfers[0]?.flow).toMatchObject({ text: '3 of 6 segments in · window 2', resent: 1 });
    expect(must(p.transfers[0]).flow?.title).toMatch(/3 of 6 segments acknowledged, 2 on the way.*waits 24s/u);
    expect(p.transfers[1]?.flow).toBeNull();
  });
});

describe('network panel: open and close with netOpen', () => {
  it('shows only while netOpen is set and a network exists', async () => {
    // state.ts sets --ui-scale on import; there is no DOM here, so give it a stub document first.
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: () => {
          /* empty */
        },
        style: {
          setProperty: () => {
            /* empty */
          },
        },
        classList: {
          toggle: () => {
            /* empty */
          },
        },
      },
    });
    const { netOpen, toggleNet, toggleStats } = await import('@/core/ui/state');
    const linked = rig({ portMbps: 1000, routerId: 'router3', ispId: 'isp3', driveSpec: 'nvme2' });
    netOpen.value = false;
    expect(netPanelShown(netOpen.value, linked)).toBe(false);
    toggleNet();
    expect(netOpen.value).toBe(true);
    expect(netPanelShown(netOpen.value, linked)).toBe(true);
    expect(netPanelShown(netOpen.value, snap())).toBe(false);
    toggleStats();
    expect(netOpen.value).toBe(false);
    expect(netPanelShown(netOpen.value, linked)).toBe(false);
    toggleStats();
  });
});

describe('network panel: web jobs (SLA, upload limiter, waiting results)', () => {
  it('counts the SLA down to the tick, then says the pay is falling', () => {
    const web = key({ id: 5, cls: 'web', slaTick: 200, payoutEstimate: 900 });
    expect(slaModel(web, 140)).toStrictEqual({ left: 60, over: false, text: 'full pay for 1m 00s' });
    expect(slaModel(web, 200)).toStrictEqual({ left: 0, over: true, text: 'pay is falling' });
    expect(slaModel(web, 350)).toMatchObject({ over: true });
    expect(slaModel(key({ id: 6 }), 10)).toBeNull(); // a job without an SLA has no countdown
  });
  it('puts the SLA and the estimate on the offer rows of web jobs only', () => {
    const p = panel(
      { offers: [key({ id: 1, cls: 'web', slaTick: 100, payoutEstimate: 700 }), key({ id: 2 })] },
      { baseTick: 40 },
    );
    expect(p.offers[0]).toMatchObject({ payout: 700, sla: { left: 60, over: false } });
    expect(p.offers[1]?.sla).toBeNull();
  });
  it('names the slowest piece of the upload, in the sim tie order', () => {
    // Basic DSL uploads 10 Mbit: the plan limits the way out even though the board jack and router are faster.
    expect(uploadLimiter(rig({ portMbps: 100, routerId: 'router1', ispId: 'isp1', driveSpec: 'ssd1' }))).toStrictEqual({
      id: 'isp',
      text: 'limited by: isp (upload)',
    });
    expect(netPanel(rig({ portMbps: 100, routerId: 'router1', ispId: 'isp1', driveSpec: 'ssd1' }))?.uploadLimit).toBe(
      'limited by: isp (upload)',
    );
    // Fibre uploads 300 Mbit: the 100 Mbit router is the slowest.
    expect(uploadLimiter(rig({ portMbps: 1000, routerId: 'router1', ispId: 'isp3', driveSpec: 'nvme2' }))?.id).toBe(
      'router',
    );
    // A 100 Mbit jack on a fast router and plan.
    expect(uploadLimiter(rig({ portMbps: 100, routerId: 'router3', ispId: 'isp4', driveSpec: 'nvme2' }))?.id).toBe(
      'port',
    );
  });
  it('has no upload limiter when the link is not usable', () => {
    const down = rig({ portMbps: 100, routerId: 'router1', ispId: 'isp1', driveSpec: 'ssd1' });
    down.net = { ...down.net, state: 'down', bandwidth: { ...down.net.bandwidth, upMbps: 0 } };
    expect(uploadLimiter(down)).toBeNull();
    expect(netPanel(down)?.uploadLimit).toBeNull();
  });
  it('carries the results waiting for a client slot', () => {
    expect(netPanel(withNet({ uploadsWaiting: 3 }))?.uploadsWaiting).toBe(3);
    expect(netPanel(withNet({ uploadsWaiting: 0 }))?.uploadsWaiting).toBe(0);
  });
});

/** The rig with the machine on: the cable is in the board's jack, a router and a plan stand, so the link is up. */
const lit = (o: { router?: boolean; isp?: boolean; on?: boolean; cable?: boolean } = {}): Snapshot => {
  const { router = true, isp = true, on = true, cable = true } = o,
    s = rig({ portMbps: 1000, routerId: 'router2', ispId: 'isp2', driveSpec: 'nvme2' });
  return {
    ...s,
    powered: on,
    power: { ...s.power, tripped: false },
    net: {
      ...s.net,
      router: router ? s.net.router : null,
      isp: isp ? s.net.isp : null,
      port: cable ? s.net.port : { kind: null, deviceId: null, mbps: 0 },
    },
  };
};
const xfer = (jobId: number, label: string, dir: 'down' | 'up') => ({
  jobId,
  label,
  dir,
  totalMB: 80,
  doneMB: 20,
  percent: 25,
  etaTicks: 6,
  persisted: false as const,
});
const busy = (...t: ReturnType<typeof xfer>[]): Snapshot => {
  const s = lit();
  return { ...s, net: { ...s.net, transfers: t } };
};

describe('network panel: addresses', () => {
  it('names the path from the PC to the ISP, each place with its MAC, and the PC with the IP address the router gave it', () => {
    const m = addressModel(lit());
    expect(m.rows.map((r) => r.id)).toStrictEqual(['pc', 'lan', 'wan', 'gateway']);
    expect(m.rows.map((r) => r.label)).toStrictEqual(['PC · eth0', 'Router · LAN', 'Router · WAN', 'ISP gateway']);
    expect(m.rows.map((r) => r.ip)).toStrictEqual([
      '192.168.1.100/24',
      '192.168.1.1/24',
      expect.stringMatching(/^203\.0\.113\.\d+\/24$/u),
      '203.0.113.1',
    ]);
    for (const r of m.rows) {
      expect(r.mac, `for ${r.id}`).toMatch(/^02(?::[0-9A-F]{2}){5}$/u);
    }
    expect(m.rows[1]?.mac).toBe('02:52:4C:02:00:02');
    expect(new Set(m.rows.map((r) => r.mac)).size).toBe(4);
    expect(m.rows[0]?.note).toMatch(/DHCP gave it this address for 24 h/u);
    expect(m.rows[3]?.note).toMatch(/Name servers 203\.0\.113\.53 and 203\.0\.113\.54/u);
  });

  it('gives the PC its MAC and no IP address while the link is down, and says what is missing', () => {
    const off = must(addressModel(lit({ on: false })).rows[0]);
    expect(off).toMatchObject({ id: 'pc', ip: null });
    expect(off.mac).toMatch(/^02:48:41:4B/u);
    expect(off.note).toMatch(/machine is off/u);
    // (a cable and no router: nobody gives out addresses)
    const lone = addressModel(lit({ router: false })).rows;
    expect(lone.map((r) => r.id)).toStrictEqual(['pc']);
    expect(lone[0]?.ip).toBeNull();
    expect(lone[0]?.note).toMatch(/no router/u);
  });

  it('leaves out a place that does not stand: no plan, no cable, no network', () => {
    expect(addressModel(lit({ isp: false })).rows.map((r) => r.id)).toStrictEqual(['pc', 'lan']);
    expect(addressModel(lit({ cable: false })).rows.map((r) => r.id)).toStrictEqual(['lan', 'wan', 'gateway']);
    expect(addressModel(snap())).toStrictEqual({ rows: [], nat: [] });
  });

  it('lists a line of the NAT table for each job in flight: its server and the two ports the router swaps', () => {
    const m = addressModel(busy(xfer(4, '#4 db', 'down'), xfer(7, '#7 dns', 'down'), xfer(4, '#4 db', 'up')));
    expect(m.nat.map((r) => r.label)).toStrictEqual(['down #4 db', 'down #7 dns', 'up #4 db']);
    expect(m.nat.map((r) => r.proto)).toStrictEqual(['TCP', 'UDP', 'TCP']);
    expect(m.nat[0]?.server).toMatch(/^198\.51\.100\.\d+:443$/u);
    // (a DNS job asks the router's resolver, which asks the plan's first name server itself)
    expect(m.nat[1]?.server).toBe('203.0.113.53:53');
    expect(m.nat[1]?.ports).toMatch(/^PC :\d+ > router :53 \| router :\d+ > name server$/u);
    expect(m.nat[1]?.line).toMatch(
      /^UDP 192\.168\.1\.100:\d+ > 192\.168\.1\.1:53 \| 203\.0\.113\.\d+:\d+ > 203\.0\.113\.53:53$/u,
    );
    expect(m.nat[0]?.ports).toMatch(/^PC :\d+ > router :\d+$/u);
    expect(m.nat[0]?.line).toMatch(/^TCP 192\.168\.1\.100:\d+ > 203\.0\.113\.\d+:\d+ > 198\.51\.100\.\d+:443$/u);
    expect(new Set(m.nat.map((r) => r.key)).size).toBe(3);
    // (the same game shows the same table in the next frame)
    const first = addressModel(busy(xfer(4, '#4 db', 'down'))),
      next = addressModel(busy(xfer(4, '#4 db', 'down')));
    expect(first.nat[0]?.line).toBe(must(next.nat[0]).line);
  });

  it('has no NAT table with the link down or no plan, and the panel carries the model', () => {
    const t = [xfer(4, '#4 db', 'down')];
    const down = { ...lit({ on: false }), net: { ...lit().net, transfers: t } },
      noPlan = { ...lit({ isp: false }), net: { ...lit({ isp: false }).net, transfers: t } };
    expect(addressModel(down).nat).toStrictEqual([]);
    expect(addressModel(noPlan).nat).toStrictEqual([]);
    const s = busy(xfer(4, '#4 db', 'down'));
    expect(netPanel(s)?.addrs).toStrictEqual(addressModel(s));
  });
});
