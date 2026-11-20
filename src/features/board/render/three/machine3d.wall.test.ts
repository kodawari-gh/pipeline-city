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
import { wallPlan, type StageWall } from './studiowall3d';
import { quietCanvas } from './testutil';

quietCanvas();

const plan = wallPlan({ caseX: CASE.x, caseTop: -CASE.y, caseW: CASE.w, floorY: -(CASE.y + CASE.h) - 140 });
/** The stage's wall, with the monitor's cord let out where a monitor would. */
const wall = (monitor: boolean): StageWall => ({ plan, monitor: monitor ? { at: [-5856, -5352, 3510], axis: [-0.38, -0.6, -0.7] } : null });
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const game = (): Game => {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  expect(setNet(g, 'router', 'router2').ok).toBe(true);
  return g;
};
const machine = (s: Snapshot, w: StageWall | null): Machine3D => new Machine3D(s, roomGeo(), new BakeQueue(), null, false, true, true, false, 'machine', w);

describe('Machine3D on the studio\'s wall', () => {
  let snap: Snapshot, m: Machine3D, bare: Machine3D;
  beforeAll(() => {
    const g = game();
    snap = g.snapshot();
    m = machine(snap, wall(true));
    bare = machine(snap, null);
  });

  it('plugs the PC and the monitor into the wall\'s two outlets, each in a plug of its own', () => {
    for (const id of ['pcmains', 'monmains'] as const) {
      const rig = m.rig(id)!;
      expect(rig, id).not.toBeNull();
      expect(rig.name, id).toBe('the wall socket');
      expect(rig.target, id).toBe('socket');
      expect(rig.seat.at, id).toEqual(plan.mains.outlet[id]);
      // (the plug goes in along -z: the wall's face looks toward the viewer)
      expect(rig.seat.axis, id).toEqual([0, 0, 1]);
      expect(rig.power?.out, id).toBe(true);
    }
    expect(m.rig('pcmains')!.seat.at).not.toEqual(m.rig('monmains')!.seat.at);
  });

  it('leaves the monitor\'s outlet empty when the stage has no monitor', () => {
    const g = game();
    const s = g.snapshot(), m2 = machine(s, wall(false));
    expect(m2.rig('pcmains')).not.toBeNull();
    expect(m2.rig('monmains')).toBeNull();
  });

  it('runs each mains cord from the plug in the outlet to its device, a cord of one piece', () => {
    const runs = m.cableRuns();
    const pc = runs.find((r) => r.id === 'pcmains')!, mon = runs.find((r) => r.id === 'monmains')!;
    expect(pc).toBeDefined();
    expect(mon).toBeDefined();
    const plug = plan.mains.outlet.pcmains, first = pc.strands[0]![0]!, last = pc.strands[0]![pc.strands[0]!.length - 1]!;
    // (the strand starts where the plug lets the cord out, a plug's length (52 mm) in front of the outlet, and ends at the supply's inlet at the case's rear)
    expect(dist(first, plug)).toBeGreaterThan(900);
    expect(dist(first, plug)).toBeLessThan(1500);
    expect(last[0]).toBeLessThan(CASE.x);
    expect(first[1]).toBeGreaterThan(last[1]);
    // (the monitor's cord comes out at the plug of its outlet and ends where the monitor lets it out)
    const m1 = mon.strands[0]![0]!, m2 = mon.strands[0]![mon.strands[0]!.length - 1]!;
    expect(dist(m1, plan.mains.outlet.monmains)).toBeLessThan(1500);
    expect(dist(m2, [-5856, -5352, 3510])).toBeLessThan(40);
  });

  it('puts the LAN lead\'s far end in the router\'s first jack, and its near end in the case\'s network port', () => {
    const rig = m.rig('lan')!, from = rig.fixed[0]!;
    expect(rig).not.toBeNull();
    // (the plug sits in the jack: its cord leaves in front of the jack's face, at the jack's height and across)
    expect(Math.hypot(from.at[0] - plan.router.lan[0], from.at[1] - plan.router.lan[1])).toBeLessThan(60);
    expect(from.at[2]).toBeGreaterThan(plan.router.lan[2]);
    // (the other end is a plug in the case's rear, at its west face, going in toward it)
    expect(Math.abs(rig.seat.at[0] - CASE.x)).toBeLessThan(200);
    expect(rig.seat.axis).toEqual([-1, 0, 0]);
  });

  it('leaves the room\'s sockets to the room: with no wall the PC\'s cord goes to the floor\'s socket', () => {
    const rig = bare.rig('pcmains')!;
    expect(rig).not.toBeNull();
    expect(rig.name).toBe('the wall socket');
    expect(rig.seat.at).not.toEqual(plan.mains.outlet.pcmains);
  });

  it('builds the cords again when the router is another tier, and not when nothing changed', () => {
    const g = game(), s2 = g.snapshot(), m3 = machine(s2, wall(true));
    const before = m3.rig('lan')!, pc = m3.rig('pcmains')!;
    m3.syncCables(s2, roomGeo());
    expect(m3.rig('lan')).toBe(before);
    expect(setNet(g, 'router', 'router4').ok).toBe(true);
    const s4 = g.snapshot();
    expect(s4.net.router?.id).toBe('router4');
    m3.syncCables(s4, roomGeo());
    expect(m3.rig('lan')).not.toBe(before);
    expect(m3.rig('pcmains')).not.toBe(pc);
  });
});
