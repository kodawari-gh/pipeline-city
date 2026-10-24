import { describe, expect, it } from 'vitest';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec } from '../sim/net/specs';
import type { Snapshot, StorageSnap } from '../sim/game/game';
import { limiterAdvice, limiterLadder, netPanel, netStateChip, usbModel } from './netui';
import { key, snap } from './testdata';

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
