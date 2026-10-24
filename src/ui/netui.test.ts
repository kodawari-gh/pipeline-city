import { describe, expect, it } from 'vitest';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec } from '../sim/net/specs';
import type { Snapshot, StorageSnap } from '../sim/game/game';
import { limiterAdvice, limiterLadder, netStateChip } from './netui';
import { snap } from './testdata';

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
