// The router's detailed view in the room (docs/render/net.md "Inside the NIC and the router"): the machine lays the router's plan over its front bezel and offers a flight to the
// whole panel and to each block. It is made again when a router of another tier stands, and it is the room's: none on the Build my PC stage, none with no router, none with no live chips.
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { BakeQueue } from '@/core/render/three/artlod';
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { routerIds } from '@/features/network/render/router/routerlayout';
import { roomGeo } from '@/features/room/render/shell/room';
import { Chips3D } from './chips3d';
import { Machine3D } from './machine3d';
import { routerFit } from './router3d';
import { maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

const mine = (m: Machine3D): string[] => m.rails.map((r) => r.id).filter((id) => id === 'router' || id.startsWith('router.'));
const ROUTERS = { 2: { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' } } as const;
const withRouter = (s: Snapshot, router: NonNullable<Snapshot['net']>['router']): Snapshot => ({ ...s, net: { ...s.net!, router } });

describe('the router\'s panel on the machine', () => {
  const s = maxedSnapshot(), geo = roomGeo();

  it('has a flight to the whole panel and to each block of the router the game has, at the front of its bezel', () => {
    const m = new Machine3D(s, geo, new BakeQueue(), new Chips3D(), true, false, false), tier = Number(/\d+$/.exec(s.net!.router!.id)![0]), fit = routerFit(tier);
    expect(mine(m)).toEqual(['router', ...routerIds(tier)]);
    const panel = m.rails.find((r) => r.id === 'router')!;
    expect(panel.rect.x).toBeCloseTo(fit.face.x, 6);
    expect(panel.rect.w).toBeCloseTo(fit.face.w, 6);
    expect(panel.z).toBeGreaterThan(fit.front);
    expect(panel.zoom).toBe(DEVICE_LOD.router.fade[1]);
    for (const r of m.rails.filter((x) => x.id.startsWith('router.'))) {
      expect(r.z, r.id).toBe(panel.z);
      expect(r.zoom, r.id).toBe(DEVICE_LOD.router.detail);
      expect(r.rect.x, r.id).toBeGreaterThanOrEqual(panel.rect.x - 0.01);
      expect(r.rect.x + r.rect.w, r.id).toBeLessThanOrEqual(panel.rect.x + panel.rect.w + 0.01);
    }
    m.dispose();
  });

  it('has none with no router, none on the Build my PC stage, and none without the live chips', () => {
    expect(mine(new Machine3D(withRouter(s, null), geo, new BakeQueue(), new Chips3D(), true, false, false))).toEqual([]);
    expect(mine(new Machine3D(s, geo, new BakeQueue(), new Chips3D(), false, false, false))).toEqual([]);
    expect(mine(new Machine3D(s, geo, new BakeQueue(), null, true, false, false))).toEqual([]);
  });

  it('is made again for a router of another tier, and goes with the router', () => {
    const m = new Machine3D(s, geo, new BakeQueue(), new Chips3D(), true, false, false), before = m.rails.length;
    m.syncCables(withRouter(s, ROUTERS[2]), geo);
    expect(mine(m)).toEqual(['router', ...routerIds(2)]);
    expect(mine(m).length).not.toBe(before);
    // (the old panel's flights are gone, not left beside the new: one panel)
    expect(m.rails.filter((r) => r.id === 'router').length).toBe(1);
    m.syncCables(withRouter(s, null), geo);
    expect(mine(m)).toEqual([]);
    m.syncCables(s, geo);
    expect(mine(m)[0]).toBe('router');
    m.dispose();
  });
});
