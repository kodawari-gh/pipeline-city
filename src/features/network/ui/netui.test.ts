import { describe, expect, it, vi } from 'vitest';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec } from '../sim/specs';
import type { Snapshot, StorageSnap } from '@/worker/game/game';
import { hudNetChip, limiterAdvice, limiterLadder, netPanel, netPanelShown, netStateChip, slaModel, uploadLimiter, usbModel } from './netui';
import { key, snap } from '@/core/ui/testdata';

/** A linked rig: board jack `portMbps`, router and plan by id, OS drive by spec id. The bandwidth comes from the sim's own rule. */
function rig(portMbps: number, routerId: string, ispId: string, driveSpec: string): Snapshot {
  const r = getRouterSpec(routerId)!;
  const p = getIspSpec(ispId)!;
  const base = snap();
  return snap({
    storage: [{ deviceId: 'd1', slot: 'sata0', spec: driveSpec, name: driveSpec, hasOs: true } as StorageSnap],
    board: { ...base.board, features: { ...base.board.features, ethernetMbps: portMbps } },
    net: {
      ...base.net, state: 'link-up', reason: null, port: { kind: 'board', deviceId: null, mbps: portMbps },
      router: { id: r.id, name: r.name, mbps: r.mbps, clients: r.clients, visual: r.visual },
      isp: { id: p.id, name: p.name, downMbps: p.downMbps, upMbps: p.upMbps, clients: p.clients },
      bandwidth: bandwidth(portMbps, r, p, DISK_NET_MBPS[driveSpec]!),
    },
  });
}

describe('network panel: link chip and limiting component', () => {
  it('picks the port when the jack is the slowest piece', () => {
    const l = limiterLadder(rig(100, 'router3', 'isp4', 'nvme2'));
    expect(l.binding).toBe('port');
    expect(l.downMbps).toBe(100);
    expect(l.segs.filter((x) => x.binding).map((x) => x.id)).toEqual(['port']);
  });
  it('picks the router when it is the slowest piece', () => {
    const l = limiterLadder(rig(1000, 'router1', 'isp3', 'nvme2'));
    expect(l.binding).toBe('router');
    expect(l.segs.find((x) => x.binding)!.id).toBe('router');
  });
  it('picks the plan when it is the slowest piece', () => {
    const l = limiterLadder(rig(1000, 'router3', 'isp1', 'nvme2'));
    expect(l.binding).toBe('isp');
    expect(l.downMbps).toBe(50);
    expect(limiterAdvice(l)).toMatch(/plan/);
  });
  it('picks the drive (netMbps) when it is the slowest piece', () => {
    const l = limiterLadder(rig(1000, 'router3', 'isp4', 'hdd0'));
    expect(l.binding).toBe('disk');
    expect(l.downMbps).toBe(80);
    expect(l.segs.find((x) => x.id === 'disk')!.binding).toBe(true);
  });
  it('shows the state chip with the link up and none without a network', () => {
    expect(netStateChip(rig(1000, 'router3', 'isp4', 'nvme2'))).toMatchObject({ text: 'Link up', level: 'ok' });
    expect(netStateChip(snap())).toBeNull();
  });
});

/** A linked rig with `net` fields overridden. */
function withNet(net: Partial<Snapshot['net']>, o: Partial<Snapshot> = {}): Snapshot {
  const r = rig(1000, 'router3', 'isp4', 'nvme2');
  return { ...r, ...o, net: { ...r.net, ...net } };
}

describe('HUD network chip', () => {
  it('is hidden until a router exists, even with a plan', () => {
    expect(hudNetChip(snap())).toBeNull();
    expect(hudNetChip(withNet({ router: null }))).toBeNull();
  });
  it('shows the speed when up and the reason word otherwise', () => {
    expect(hudNetChip(withNet({}))).toMatchObject({ icon: 'net', level: 'ok' });
    expect(hudNetChip(withNet({ state: 'no-cable' }))!.text).toBe('no cable');
    expect(hudNetChip(withNet({ state: 'down' }))!.text).toBe('down');
    expect(hudNetChip(withNet({ state: 'no-os' }))!.text).toBe('setup');
    expect(hudNetChip(withNet({ state: 'no-device', isp: null }))!.text).toBe('no plan');
  });
});

const spool = (used: number, slots: number, full: boolean) => ({ slotBytes: 1, slots, used, freeBytes: 0, full });

describe('network panel: offers, transfers, spool, USB fallback', () => {
  it('has no panel without a network', () => {
    expect(netPanel(snap())).toBeNull();
  });
  it('lists offers with time left, late and retired flags', () => {
    const p = netPanel(withNet({
      offers: [key({ id: 1, deadlineTick: 120 }), key({ id: 2, deadlineTick: 20, late: true, retired: true })],
    }, { baseTick: 50 }))!;
    expect(p.offers.map((o) => o.left)).toEqual([70, 0]);
    expect(p.offers[1]).toMatchObject({ late: true, retired: true });
    expect(p.offers[0]!.retired).toBe(false);
    expect(p.stages.find((x) => x.id === 'offer')!.count).toBe(2);
  });
  it('shows transfers with clamped progress, eta and direction counts', () => {
    const t = { persisted: false as const, totalMB: 100, doneMB: 40, etaTicks: 0 };
    const p = netPanel(withNet({
      transfers: [{ ...t, jobId: 1, label: '#1', dir: 'down', percent: 40, etaTicks: 90 }, { ...t, jobId: 2, label: '#2', dir: 'up', percent: 140 }],
    }))!;
    expect(p.transfers.map((x) => x.pct)).toEqual([40, 100]);
    expect(p.transfers[0]!.etaText).not.toBe('now');
    expect(p.transfers[1]!.etaText).toBe('now');
    expect(p.stages.find((x) => x.id === 'downloading')!.count).toBe(1);
    expect(p.stages.find((x) => x.id === 'uploading')!.count).toBe(1);
    expect(p.clients.busy).toBe(2);
  });
  it('lists spooled jobs with their stage words', () => {
    const p = netPanel(withNet({ spooled: [key({ id: 1, stage: 'spooled' }), key({ id: 2, stage: 'running' }), key({ id: 3, stage: 'uploading' })] }))!;
    expect(p.spooled.map((r) => r.state)).toEqual(['on the drive', 'running now', 'uploading']);
    expect(p.stages.find((x) => x.id === 'spooled')!.count).toBe(2);
  });
  it('reports the spool and os.spoolFull, which wins over spool.full', () => {
    const os = (full: boolean, spoolFull?: boolean) => ({ spool: spool(3, 4, full), spoolFull } as unknown as Snapshot['os']);
    expect(netPanel(withNet({}, { os: os(false) }))!.spool).toEqual({ used: 3, slots: 4, full: false });
    expect(netPanel(withNet({}, { os: os(false, true) }))!.spool!.full).toBe(true);
    expect(netPanel(withNet({}, { os: os(true) }))!.spool!.full).toBe(true);
    expect(netPanel(withNet({}, { os: null }))!.spool).toBeNull();
  });
  it('describes the USB fallback states', () => {
    const fb = (state: 'off' | 'retired' | 'waiting' | 'fallback', startsIn: number | null = null, retiredKeys = 0) =>
      usbModel(withNet({ usbFallback: { state, deadTicks: 0, startsIn, keyRateMul: 1 }, retiredKeys }));
    expect(fb('off')).toBeNull();
    expect(fb('retired')).toMatchObject({ state: 'retired', level: 'idle' });
    expect(fb('waiting', 600)).toMatchObject({ state: 'waiting', level: 'warn', countdown: 600 });
    expect(fb('waiting')!.text).toBe('Keys return soon');
    expect(fb('fallback')).toMatchObject({ state: 'fallback', level: 'warn', countdown: null });
  });
  it('counts retired keys in the USB detail and the panel', () => {
    const net = (n: number) => withNet({ usbFallback: { state: 'retired', deadTicks: 0, startsIn: null, keyRateMul: 1 }, retiredKeys: n });
    expect(usbModel(net(1))!.detail).toMatch(/^1 leftover key expire/);
    expect(usbModel(net(3))!.detail).toMatch(/^3 leftover keys expire/);
    expect(usbModel(net(0))!.detail).toMatch(/over the wire/);
    expect(netPanel(net(3))!.retiredKeys).toBe(3);
  });
});

describe('network panel: open and close with netOpen', () => {
  it('shows only while netOpen is set and a network exists', async () => {
    // state.ts sets data-theme on import; there is no DOM here, so give it a stub document first.
    vi.stubGlobal('document', { documentElement: { setAttribute: () => {}, style: { setProperty: () => {} }, classList: { toggle: () => {} } } });
    const { netOpen, toggleNet, toggleStats } = await import('@/core/ui/state');
    const linked = rig(1000, 'router3', 'isp3', 'nvme2');
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
    expect(slaModel(web, 140)).toEqual({ left: 60, over: false, text: 'full pay for 1m 00s' });
    expect(slaModel(web, 200)).toEqual({ left: 0, over: true, text: 'pay is falling' });
    expect(slaModel(web, 350)).toMatchObject({ over: true });
    expect(slaModel(key({ id: 6 }), 10)).toBeNull(); // a job without an SLA has no countdown
  });
  it('puts the SLA and the estimate on the offer rows of web jobs only', () => {
    const p = netPanel(withNet({
      offers: [key({ id: 1, cls: 'web', slaTick: 100, payoutEstimate: 700 }), key({ id: 2 })],
    }, { baseTick: 40 }))!;
    expect(p.offers[0]).toMatchObject({ payout: 700, sla: { left: 60, over: false } });
    expect(p.offers[1]!.sla).toBeNull();
  });
  it('names the slowest piece of the upload, in the sim tie order', () => {
    // Basic DSL uploads 10 Mbit: the plan limits the way out even though the board jack and router are faster.
    expect(uploadLimiter(rig(100, 'router1', 'isp1', 'ssd1'))).toEqual({ id: 'isp', text: 'limited by: isp (upload)' });
    expect(netPanel(rig(100, 'router1', 'isp1', 'ssd1'))!.uploadLimit).toBe('limited by: isp (upload)');
    // Fibre uploads 300 Mbit: the 100 Mbit router is the slowest.
    expect(uploadLimiter(rig(1000, 'router1', 'isp3', 'nvme2'))!.id).toBe('router');
    // A 100 Mbit jack on a fast router and plan.
    expect(uploadLimiter(rig(100, 'router3', 'isp4', 'nvme2'))!.id).toBe('port');
  });
  it('has no upload limiter when the link is not usable', () => {
    const down = rig(100, 'router1', 'isp1', 'ssd1');
    down.net = { ...down.net, state: 'down', bandwidth: { ...down.net.bandwidth, upMbps: 0 } };
    expect(uploadLimiter(down)).toBeNull();
    expect(netPanel(down)!.uploadLimit).toBeNull();
  });
  it('carries the results waiting for a client slot', () => {
    expect(netPanel(withNet({ uploadsWaiting: 3 }))!.uploadsWaiting).toBe(3);
    expect(netPanel(withNet({ uploadsWaiting: 0 }))!.uploadsWaiting).toBe(0);
  });
});
