// A machine on the studio's wall (Machine3D's `wall` option, studiowall3d.ts): its two mains cords go from its devices into the wall's outlets in real Swiss type 12 plugs, one in each of two sockets of its triple plate (the power
// runs out of the plug), its LAN lead from the router's first jack to the case's network port, and a router of another tier builds the cords again.
import { beforeAll, describe, expect, it } from 'vitest';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { setNet } from '@/features/board/sim/buildnet';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { CASE } from '../layout/layout';
import { Machine3D } from './machine3d';
import * as studiowall3d from './studiowall3d';
import { quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

quietCanvas();

const plan = studiowall3d.wallPlan({
  caseX: CASE.x,
  caseTop: -CASE.y,
  caseW: CASE.w,
  floorY: -(CASE.y + CASE.h) - 140,
});
/** The stage's wall, with the monitor's cord let out where a monitor would. */
const wall = (monitor: boolean): studiowall3d.StageWall => ({
  plan,
  monitor: monitor ? { at: [-5856, -5352, 3510], axis: [-0.38, -0.6, -0.7] } : null,
});
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(must(a[0]) - must(b[0]), must(a[1]) - must(b[1]), must(a[2]) - must(b[2]));
const game = (): Game => {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  expect(setNet(g, 'router', 'router2').ok).toBe(true);
  return g;
};
const machine = (s: Snapshot, w: studiowall3d.StageWall | null): Machine3D =>
  new Machine3D(s, roomGeo(), {
    q: new BakeQueue(),
    chips: null,
    inRoom: false,
    merge: true,
    lod: true,
    defer: false,
    shown: 'machine',
    wall: w,
  });

/** The plugs of the LAN lead's two ends, the plug itself first: the router's end (fixed) and the PC's (the one the hand holds). */
/** The plug kinds under `o`, in tree order. */
function kinds(o: { traverse: (cb: (x: { userData: Record<string, unknown> }) => void) => void }): string[] {
  const t: string[] = [];
  o.traverse((x) => {
    if (typeof x.userData['plug'] === 'string') {
      t.push(x.userData['plug']);
    }
  });
  return t;
}

const ends = (mc: Machine3D): { router: string[]; pc: string[] } => {
  const lanCable = must(must(mc.cableGroup('lan')).children[0]);
  const lanRig = must(mc.rig('lan')).model().root;
  return { router: kinds(lanCable), pc: kinds(lanRig) };
};

/** The plugs the held end takes on when it comes to another port (`alts`): what the hand swaps to. */
const heldAt = (mc: Machine3D, port: string): string[] => {
  const t: string[] = [];
  const lanRig = must(mc.rig('lan'));
  const alt = must(must(lanRig.alts).find((a) => a.port === port));
  must(alt.model)().root.traverse((x) => {
    if (typeof x.userData['plug'] === 'string') {
      t.push(x.userData['plug']);
    }
  });
  return t;
};

describe("Machine3D on the studio's wall", () => {
  let snap: Snapshot, m: Machine3D, bare: Machine3D;
  beforeAll(() => {
    const g = game();
    snap = g.snapshot();
    m = machine(snap, wall(true));
    bare = machine(snap, null);
  });

  it("plugs the PC and the monitor into the wall's two outlets, each in a plug of its own", () => {
    for (const id of ['pcmains', 'monmains'] as const) {
      const rig = must(m.rig(id));
      expect(rig).not.toBeNull();
      expect(rig.name).toBe('the wall socket');
      expect(rig.target).toBe('socket');
      expect(rig.seat.at).toStrictEqual(plan.mains.outlet[id]);
      // (the plug goes in along -z: the wall's face looks toward the viewer)
      expect(rig.seat.axis).toStrictEqual([0, 0, 1]);
      expect(rig.power?.out).toBe(true);
    }
    expect(must(m.rig('pcmains')).seat.at).not.toStrictEqual(must(m.rig('monmains')).seat.at);
  });

  it("leaves the monitor's outlet empty when the stage has no monitor", () => {
    const g = game();
    const s = g.snapshot(),
      m2 = machine(s, wall(false));
    expect(m2.rig('pcmains')).not.toBeNull();
    expect(m2.rig('monmains')).toBeNull();
  });

  it('runs each mains cord from the plug in the outlet to its device, a cord of one piece', () => {
    const runs = m.cableRuns();
    const pc = must(runs.find((r) => r.id === 'pcmains')),
      mon = must(runs.find((r) => r.id === 'monmains'));
    expect(pc).toBeDefined();
    expect(mon).toBeDefined();
    const plug = plan.mains.outlet.pcmains,
      first = must(must(pc.strands[0])[0]),
      last = must(must(pc.strands[0])[must(pc.strands[0]).length - 1]);
    // (the strand starts where the plug lets the cord out, a plug's length (52 mm) in front of the outlet, and ends at the supply's inlet at the case's rear)
    expect(dist(first, plug)).toBeGreaterThan(900);
    expect(dist(first, plug)).toBeLessThan(1500);
    expect(last[0]).toBeLessThan(CASE.x);
    expect(first[1]).toBeGreaterThan(last[1]);
    // (the monitor's cord comes out at the plug of its outlet and ends where the monitor lets it out)
    const m1 = must(must(mon.strands[0])[0]),
      m2 = must(must(mon.strands[0])[must(mon.strands[0]).length - 1]);
    expect(dist(m1, plan.mains.outlet.monmains)).toBeLessThan(1500);
    expect(dist(m2, [-5856, -5352, 3510])).toBeLessThan(40);
  });

  it("puts the LAN lead's far end in the router's first jack, and its near end in the case's network port", () => {
    const rig = must(m.rig('lan')),
      from = must(rig.fixed[0]);
    expect(rig).not.toBeNull();
    // (the plug sits in the jack: its cord leaves in front of the jack's face, at the jack's height and across)
    expect(Math.hypot(from.at[0] - plan.router.lan[0], from.at[1] - plan.router.lan[1])).toBeLessThan(60);
    expect(from.at[2]).toBeGreaterThan(plan.router.lan[2]);
    // (the other end is a plug in the case's rear, at its west face, going in toward it)
    expect(Math.abs(rig.seat.at[0] - CASE.x)).toBeLessThan(200);
    expect(rig.seat.axis).toStrictEqual([-1, 0, 0]);
  });

  it("leaves the room's sockets to the room: with no wall the PC's cord goes to the floor's socket", () => {
    const rig = must(bare.rig('pcmains'));
    expect(rig).not.toBeNull();
    expect(rig.name).toBe('the wall socket');
    expect(rig.seat.at).not.toStrictEqual(plan.mains.outlet.pcmains);
  });

  it('builds the cords again when the router is another tier, and not when nothing changed', () => {
    const g = game(),
      s2 = g.snapshot(),
      m3 = machine(s2, wall(true));
    const before = must(m3.rig('lan')),
      pc = must(m3.rig('pcmains'));
    m3.syncCables(s2, roomGeo());
    expect(m3.rig('lan')).toBe(before);
    expect(setNet(g, 'router', 'router4').ok).toBe(true);
    const s4 = g.snapshot();
    expect(s4.net.router?.id).toBe('router4');
    m3.syncCables(s4, roomGeo());
    expect(m3.rig('lan')).not.toBe(before);
    expect(m3.rig('pcmains')).not.toBe(pc);
  });

  it('ends the LAN lead as its two ports do: an RJ45 plug in a jack, an adapter in the QSFP+ cage that faces a jack, a direct attach lead between two cages', () => {
    // (the PC has the 40G card, its two cages; the board has its RJ45 jack; the router of a tier has RJ45 jacks, the edge router QSFP+ cages)
    const g = game(),
      mc = machine(g.snapshot(), wall(true));
    const sync = (): void => {
      mc.syncCables(g.snapshot(), roomGeo());
    };
    const card = must(g.snapshot().devices.find((d) => d.kind === 'nic')).id;
    expect(g.snapshot().net.port).toMatchObject({ kind: 'nic', deviceId: card });
    // a copper router and the card's cage: the adapter is the card's
    expect(ends(mc)).toStrictEqual({ router: ['rj45'], pc: ['adapter', 'rj45'] });
    // the board's jack: a patch lead, plain
    expect(g.disconnectCable('lan').ok).toBe(true);
    expect(g.connectLan('board').ok).toBe(true);
    sync();
    expect(ends(mc)).toStrictEqual({ router: ['rj45'], pc: ['rj45'] });
    // (the held end, brought to the card's cage, takes the adapter: the router's end stays as it was until the plug is in)
    expect(heldAt(mc, card)).toStrictEqual(['adapter', 'rj45']);
    // the edge router (a new router: its cages) and the board's jack: the adapter is the router's
    expect(setNet(g, 'router', 'router4').ok).toBe(true);
    sync();
    expect(ends(mc)).toStrictEqual({ router: ['adapter', 'rj45'], pc: ['rj45'] });
    // and the card's cage: a direct attach lead, a QSFP+ plug at each end
    expect(g.disconnectCable('lan').ok).toBe(true);
    expect(g.connectLan(card).ok).toBe(true);
    sync();
    expect(ends(mc)).toStrictEqual({ router: ['qsfp'], pc: ['qsfp'] });
    // (the held end swaps to the plug of the port it comes to: from the card's cage to the board's jack, an RJ45 plug)
    expect(heldAt(mc, 'board')).toStrictEqual(['rj45']);
  });

  it('builds the LAN lead again in the room when the router is another tier: the end at its port is another plug', () => {
    // (the machine in the room, no wall: the room's router has a side port, a QSFP+ cage on the edge router)
    const g = game(),
      mc = new Machine3D(g.snapshot(), roomGeo(), {
        q: new BakeQueue(),
        chips: null,
        inRoom: true,
        merge: true,
        lod: true,
        defer: false,
        shown: 'machine',
        wall: null,
      });
    expect(g.disconnectCable('lan').ok).toBe(true);
    expect(g.connectLan('board').ok).toBe(true);
    mc.syncCables(g.snapshot(), roomGeo());
    expect(ends(mc)).toStrictEqual({ router: ['rj45'], pc: ['rj45'] });
    const before = must(mc.rig('lan'));
    expect(setNet(g, 'router', 'router4').ok).toBe(true);
    mc.syncCables(g.snapshot(), roomGeo());
    expect(mc.rig('lan')).not.toBe(before);
    expect(ends(mc)).toStrictEqual({ router: ['adapter', 'rj45'], pc: ['rj45'] });
  });
});
