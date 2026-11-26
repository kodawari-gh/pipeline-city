// The router's detailed view in the room (docs/render/net.md "Inside the NIC and the router"): the router's board lies in its shell and stays lying; the zoom fades the shell away (the room's) and the board
// shows through, its parts up. The machine offers a flight to the board and to each part (each looks down on what lies). It is made again when a router of another tier stands, and it is the room's: none on
// the Build my PC stage, none with no router, none with no live chips.
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { BakeQueue } from '@/core/render/three/artlod';
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { ROUTER_BODIES, routerIds } from '@/features/network/render/router/routerlayout';
import { roomGeo } from '@/features/room/render/shell/room';
import { Chips3D } from './chips3d';
import { Machine3D } from './machine3d';
import { ROUTER_FLOOR, ROUTER_SIZE, routerStand } from './router3d';
import { maxedSnapshot, quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

quietCanvas();

const mine = (m: Machine3D): string[] =>
  m.rails.map((r) => r.id).filter((id) => id === 'router' || id.startsWith('router.'));
/** The ids a tier's board offers a flight to: the board, its bodies (the SoC's last: its die's rail), no block of the die. */
const offered = (tier: number): string[] => [
  'router',
  ...routerIds(tier).filter((id) => (ROUTER_BODIES as readonly string[]).includes(id)),
  'router.soc',
];
const ROUTERS = { 2: { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' } } as const;
const withRouter = (s: Snapshot, router: NonNullable<Snapshot['net']>['router']): Snapshot => ({
  ...s,
  net: { ...s.net, router },
});
/** A camera `d` in front of the point `at` (the room's frame: layout x, 3D y, depth), looking at it. */
const camAt = (x: number, y: number, z: number, d: number): PerspectiveCamera => {
  const c = new PerspectiveCamera(40, 16 / 9, 10, 200_000);
  c.position.set(x, y, z + d);
  c.lookAt(x, y, z);
  c.updateMatrixWorld();
  return c;
};
const H = 1080;

describe("the router's board on the machine", () => {
  const s = maxedSnapshot(),
    geo = roomGeo();

  it('has a flight to the board and to each part of the router the game has, all lying on the plinth behind the jacks', () => {
    const m = new Machine3D(s, geo, {
        q: new BakeQueue(),
        chips: new Chips3D(),
        inRoom: true,
        merge: false,
        lod: false,
      }),
      routerId = must(s.net.router).id,
      tier = Number(must(/\d+$/u.exec(routerId))[0]),
      stand = routerStand(tier);
    expect(mine(m)).toStrictEqual(offered(tier));
    const board = must(m.rails.find((r) => r.id === 'router')),
      lie = must(board.lie);
    // (it lies behind the front: its jack side is just behind the jacks' backs, and it ends before the back wall)
    expect(lie).toBeDefined();
    expect(board.z + lie.d / 2).toBeLessThan(stand.front);
    expect(board.z - lie.d / 2).toBeGreaterThan(stand.front - stand.k * stand.depth);
    expect(board.zoom).toBe(DEVICE_LOD.router.fade[1]);
    expect(board.rect.w).toBeGreaterThan(stand.face.w * 0.8);
    expect(board.rect.w).toBeLessThanOrEqual(stand.face.w);
    // (on the standoffs over the plinth, under the shell's top: the shelf is `-stand.oy`, the shell's top its height above it)
    expect(lie.y).toBeGreaterThan(-stand.oy + stand.k * ROUTER_FLOOR);
    expect(lie.y).toBeLessThan(-stand.oy + stand.k * must(ROUTER_SIZE[tier]).h);
    expect(board.rect.y).toBe(-lie.y);
    for (const r of m.rails.filter((x) => x.id.startsWith('router.'))) {
      expect(r.lie).toBeDefined();
      expect(r.zoom).toBeGreaterThan(0);
      // (each part lies on the board: inside its east-west span and its depth, standing over it)
      expect(r.rect.x).toBeGreaterThanOrEqual(board.rect.x - 0.01);
      expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(board.rect.x + board.rect.w + 0.01);
      expect(r.z - must(r.lie).d / 2).toBeGreaterThanOrEqual(board.z - lie.d / 2 - 0.01);
      expect(r.z + must(r.lie).d / 2).toBeLessThanOrEqual(board.z + lie.d / 2 + 0.01);
      expect(must(r.lie).y).toBeGreaterThanOrEqual(lie.y - 0.01);
    }
    for (const r of m.rails.filter((x) => x.id.startsWith('router.') && x.id !== 'router.soc')) {
      expect(r.zoom).toBe(DEVICE_LOD.router.detail);
    }
    // (the die's flight comes in where its lid is gone)
    expect(must(m.rails.find((r) => r.id === 'router.soc')).zoom).toBeGreaterThan(DEVICE_LOD.router.fade[1]);
    m.dispose();
  });

  it('has none with no router, none on the Build my PC stage, and none without the live chips', () => {
    const noRouter = new Machine3D(withRouter(s, null), geo, {
      q: new BakeQueue(),
      chips: new Chips3D(),
      inRoom: true,
      merge: false,
      lod: false,
    });
    const onStage = new Machine3D(s, geo, {
      q: new BakeQueue(),
      chips: new Chips3D(),
      inRoom: false,
      merge: false,
      lod: false,
    });
    const noChips = new Machine3D(s, geo, {
      q: new BakeQueue(),
      chips: null,
      inRoom: true,
      merge: false,
      lod: false,
    });
    expect(mine(noRouter)).toStrictEqual([]);
    expect(mine(onStage)).toStrictEqual([]);
    expect(mine(noChips)).toStrictEqual([]);
  });

  it('is made again for a router of another tier, and goes with the router', () => {
    const m = new Machine3D(s, geo, {
        q: new BakeQueue(),
        chips: new Chips3D(),
        inRoom: true,
        merge: false,
        lod: false,
      }),
      before = mine(m).length;
    m.syncCables(withRouter(s, ROUTERS[2]), geo);
    expect(mine(m)).toStrictEqual(offered(2));
    expect(mine(m)).not.toHaveLength(before);
    // (the old board's flights are gone, not left beside the new: one board)
    expect(m.rails.filter((r) => r.id === 'router')).toHaveLength(1);
    m.syncCables(withRouter(s, null), geo);
    expect(mine(m)).toStrictEqual([]);
    m.syncCables(s, geo);
    expect(mine(m)[0]).toBe('router');
    m.dispose();
  });

  it('keeps the shell whole from afar and takes it away as the camera comes in, the board lying where it is', () => {
    const m = new Machine3D(s, geo, {
        q: new BakeQueue(),
        chips: new Chips3D(),
        inRoom: true,
        merge: false,
        lod: false,
      }),
      alphas: number[] = [];
    m.onRouterShell = (a) => {
      alphas.push(a);
    };
    const routerId = must(s.net.router).id,
      tier = Number(must(/\d+$/u.exec(routerId))[0]),
      stand = routerStand(tier),
      cx = stand.face.x + stand.face.w / 2,
      cy = -(stand.face.y + stand.face.h / 2);
    const boardRoot = (): { visible: boolean; lying: boolean } => {
      const o = must(m.root.children.find((c) => c.userData['id'] === 'router'));
      return { visible: o.visible, lying: Math.abs(must(o.children[0]).rotation.x + Math.PI / 2) < 1e-9 };
    };
    const seen = (d: number) => {
      m.lod(camAt(cx, cy, stand.front, d), H, 1);
      return { ...boardRoot(), shell: must(alphas.at(-1)) };
    };
    expect(tier).toBeGreaterThan(0);
    const far = seen(60_000);
    expect(far.visible).toBe(false);
    expect(far.shell).toBe(1);
    // (zoom is H / (2 d tan 20 degrees) pixels a unit: the shell is gone by `fade[1]`)
    const at = (zoom: number) => seen(H / (2 * zoom * Math.tan((20 * Math.PI) / 180)));
    const mid = at((DEVICE_LOD.router.fade[0] + DEVICE_LOD.router.fade[1]) / 2);
    expect(mid.visible).toBe(true);
    expect(mid.shell).toBeGreaterThan(0.05);
    expect(mid.shell).toBeLessThan(0.95);
    const gone = at(DEVICE_LOD.router.fade[1] * 1.05);
    expect(gone.shell).toBe(0);
    // (it never stands up: it lies at every zoom)
    for (const v of [far, mid, gone, at(3)]) {
      expect(v.lying).toBe(true);
    }
    // (a part of the board is the router until the shell is gone: the pick of its parts follows)
    expect(m.pickId('router.dram')).toBe('router.dram');
    m.lod(camAt(cx, cy, stand.front, 60_000), H, 1);
    expect(m.pickId('router.dram')).toBe('router');
    expect(m.pickId('router.soc')).toBe('router');
    expect(m.pickId('pcie0')).toBe('pcie0');
    m.dispose();
  });
});
