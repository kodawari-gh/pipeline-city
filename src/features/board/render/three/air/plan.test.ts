import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { AMBIENT_C } from '../../../sim/specs';
import { setLayoutTier } from '../../layout/layout';
import { fanMounts } from '@/features/room/render/desk/props/case';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { airDomain, airParts, airPlan, airReference, coolantAt, loopPath, pathLine, planKey, pointOn, type AirBody } from './plan';
import type { V3 } from './grid';

setLayoutTier(2, 2);
const d = airDomain();

/** The case's fixed bodies, as the 3D machine gives them, and `more` beside them. */
const bodies = (more: AirBody[] = []): AirBody[] => [
  { id: 'board', kind: 'board', min: [d.min[0], d.min[1], d.min[2]], max: [d.max[0], d.max[1], BOARD_Z] },
  { id: 'basement', kind: 'basement', min: [d.min[0], d.min[1], d.min[2]], max: [d.max[0], d.min[1] + 1500, d.max[2]] },
  { id: 'cage', kind: 'cage', min: [d.max[0] - 2500, d.min[1] + 1600, d.min[2]], max: [d.max[0] - 100, d.max[1] - 2000, d.max[2] - 200] },
  { id: 'ram', kind: 'ram', min: [1700, -1080, BOARD_Z], max: [1870, 1320, BOARD_Z + 380] },
  ...more,
];

/** A running machine: a CPU at `cpuC`, a fan on every mount, and `more` devices. */
function running(more: ReturnType<typeof dev>[] = [], over: Partial<Snapshot> = {}, cpuC = 80): Snapshot {
  const fans = fanMounts().map((m) => dev({ id: `f-${m.id}`, kind: 'fan', spec: 'fan120', slot: m.id }));
  return snap({
    powered: true, power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false }, board: boardSnap({ tier: 2 }),
    devices: [dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 70, tempC: cpuC }), ...fans, ...more], ...over,
  });
}

describe('the airflow plan', () => {
  it('the case air is the case inside, tray to glass, with positive size', () => {
    for (let a = 0; a < 3; a++) expect(d.max[a]! - d.min[a]!).toBeGreaterThan(1000);
  });

  it('a front fan blows in at the east wall, the top and rear fans draw out through the top and the west wall', () => {
    const plan = airPlan(running(), bodies());
    const front = plan.fans.filter((f) => f.kind === 'wall' && f.wall === 1), top = plan.fans.filter((f) => f.kind === 'wall' && f.wall === 3), rear = plan.fans.filter((f) => f.kind === 'wall' && f.wall === 0);
    const mounts = fanMounts();
    expect(front.length).toBe(mounts.filter((m) => m.side === 'front').length);
    expect(top.length).toBe(mounts.filter((m) => m.side === 'top').length);
    expect(rear.length).toBe(mounts.filter((m) => m.side === 'rear').length);
    for (const f of front) expect(f.kind === 'wall' && f.into).toBe(true);
    for (const f of [...top, ...rear]) expect(f.kind === 'wall' && f.into).toBe(false);
    expect(front.every((f) => f.bank.startsWith('case:front'))).toBe(true);
    expect(front.every((f) => f.q > 0 && f.kind === 'wall' && f.r > 0)).toBe(true);
  });

  it('the fans of the radiator side are published as the radiator\'s, and a mount with no fan has none', () => {
    const rad = dev({ id: 'rad', kind: 'radiator', spec: 'rad2', slot: 'rad-front' });
    const plan = airPlan(running([rad]), bodies());
    expect(plan.fans.filter((f) => f.bank.startsWith('radiator:')).length).toBe(fanMounts().filter((m) => m.side === 'front').length);
    expect(plan.fans.some((f) => f.bank === 'case:front0')).toBe(false);
    const bare = airPlan(running([], { devices: [dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' })] }), bodies());
    expect(bare.fans.length).toBe(0);
  });

  it('the openings: the front and the top are meshes, the slots leak, the rear is a grille only where no fan is fitted', () => {
    const plan = airPlan(running(), bodies());
    expect(plan.vents.map((v) => v.id)).toEqual(expect.arrayContaining(['slots', 'front', 'top']));
    const none = airPlan(running([], { devices: [dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' })] }), bodies());
    expect(none.vents.some((v) => v.id === 'rear')).toBe(true);
    for (const v of none.vents) { expect(v.open).toBeGreaterThan(0); expect(v.open).toBeLessThanOrEqual(1); }
  });

  it('the bodies become boxes by their kind: the board and the basement stop the air, the drives and the sticks let some through', () => {
    const plan = airPlan(running(), bodies()), by = (id: string) => plan.boxes.find((b) => b.id === id)!;
    expect(by('board').k).toEqual([0, 0, 0]);
    expect(by('basement').k).toEqual([0, 0, 0]);
    expect(by('cage').k[0]).toBeGreaterThan(0.3);
    expect(by('ram').k[1]).toBeGreaterThan(by('ram').k[2]);
  });

  it('a tower cooler is a block of fins with its fans at its two faces, blowing toward the rear; a card has fans that blow up into it', () => {
    const tower = dev({ id: 'tw', kind: 'cooler', spec: 'cooler1', slot: 'cooler0' });
    const fans = [dev({ id: 'tf0', kind: 'fan', spec: 'fan120', slot: 'cooler0.fan0' }), dev({ id: 'tf1', kind: 'fan', spec: 'fan120', slot: 'cooler0.fan1' })];
    const gpu = dev({ id: 'gp', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 });
    const card: AirBody = { id: 'gp', kind: 'gpu', slot: 'pcie0', min: [-3000, -1500, BOARD_Z + 300], max: [1500, -300, BOARD_Z + 2800] };
    const plan = airPlan(running([tower, ...fans, gpu]), bodies([{ id: 'tw', kind: 'cooler', min: [-700, -1100, BOARD_Z], max: [700, 1700, BOARD_Z + 2700] }, card]));
    const inner = plan.fans.filter((f) => f.kind === 'inner');
    const cooler = inner.filter((f) => f.bank === 'cooler'), cards = inner.filter((f) => f.bank === 'gpu:pcie0');
    expect(cooler.length).toBe(2);
    for (const f of cooler) expect(f.kind === 'inner' && f.axis === 0 && f.dir === -1).toBe(true);
    expect(cards.length).toBeGreaterThan(0);
    for (const f of cards) {
      expect(f.kind === 'inner' && f.axis === 1 && f.dir === 1).toBe(true);
      expect(f.kind === 'inner' && f.at[0]).toBeGreaterThan(card.min[0]);
      expect(f.kind === 'inner' && f.at[0]).toBeLessThan(card.max[0]);
    }
    const fins = plan.boxes.find((b) => b.id === 'tw')!;
    expect(fins.k[2]).toBeLessThan(0.1);
    expect(fins.k[0]).toBeGreaterThan(0.5);
  });

  it('a neural card is a block that heats the air but has no fan of its own', () => {
    const npu = dev({ id: 'np', kind: 'npu', spec: 'npu2', slot: 'pcie1', powerW: 30, tempC: 60 });
    const body: AirBody = { id: 'np', kind: 'npu', slot: 'pcie1', min: [-3000, -1500, BOARD_Z + 300], max: [1500, -300, BOARD_Z + 2800] };
    const s = running([npu]), plan = airPlan(s, bodies([body]));
    expect(plan.fans.some((f) => f.bank === 'gpu:pcie1')).toBe(false);
    expect(plan.boxes.some((b) => b.id === 'np')).toBe(true);
    expect(airParts(s, plan).some((p) => p.id === 'np' && p.ua > 0)).toBe(true);
  });

  it('a pump head is solid and a stock heatsink blocks most of the air', () => {
    const pump = dev({ id: 'pp', kind: 'cooler', spec: 'cooler2', slot: 'cooler0' });
    const solid = airPlan(running([pump]), bodies([{ id: 'pp', kind: 'cooler', min: [-700, -700, BOARD_Z], max: [700, 700, BOARD_Z + 1300] }]));
    expect(solid.boxes.find((b) => b.id === 'pp')!.k).toEqual([0, 0, 0]);
    const stock = airPlan(running([dev({ id: 'st', kind: 'cooler', spec: 'cooler0', slot: 'cooler0' })]), bodies([{ id: 'st', kind: 'cooler', min: [-700, -700, BOARD_Z], max: [700, 700, BOARD_Z + 900] }]));
    expect(stock.boxes.find((b) => b.id === 'st')!.k[2]).toBeLessThan(0.2);
  });

  it('the key changes with a part fitted and with a box that moves, and not otherwise', () => {
    const a = running(), b = bodies();
    expect(planKey(a, b)).toBe(planKey(running(), bodies()));
    expect(planKey(running([dev({ id: 'x', kind: 'ram', slot: 'dimm0' })]), b)).not.toBe(planKey(a, b));
    const moved = bodies().map((x) => (x.id === 'cage' ? { ...x, min: [x.min[0] - 400, x.min[1], x.min[2]] as V3 } : x));
    expect(planKey(a, moved)).not.toBe(planKey(a, b));
  });
});

describe('the parts that heat the air', () => {
  const tower = dev({ id: 'tw', kind: 'cooler', spec: 'cooler1', slot: 'cooler0' });
  const towerBody: AirBody = { id: 'tw', kind: 'cooler', min: [-700, -1100, BOARD_Z], max: [700, 1700, BOARD_Z + 2700] };

  it('the fins of a tower take the processor\'s heat: their surface is part way from the air to the die, and the coefficient is the heat over that rise', () => {
    const s = running([tower], {}, 85), plan = airPlan(s, bodies([towerBody])), air = airReference(s), part = airParts(s, plan).find((p) => p.id === 'tw')!;
    expect(air).toBeCloseTo(AMBIENT_C, 5);
    expect(part.porous).toBe(true);
    expect(part.tempC).toBeGreaterThan(air + 20);
    expect(part.tempC).toBeLessThan(85);
    expect(part.ua).toBeCloseTo(70 / (part.tempC - air), 3);
  });

  it('a machine that is off moves no heat', () => {
    const s = running([tower], { powered: false, power: { vrmLossW: 0, totalW: 0, budgetW: 250, psuFactor: 1, off: true, tripped: false } }, 85);
    for (const p of airParts(s, airPlan(s, bodies([towerBody])))) expect(p.ua).toBe(0);
  });

  it('a liquid cooler has no fins: its heat goes into the coolant, not into the air at the pump', () => {
    const pump = dev({ id: 'pp', kind: 'cooler', spec: 'cooler2', slot: 'cooler0' }), s = running([pump], {}, 85);
    const plan = airPlan(s, bodies([{ id: 'pp', kind: 'cooler', min: [-700, -700, BOARD_Z], max: [700, 700, BOARD_Z + 1300] }]));
    expect(airParts(s, plan).some((p) => p.id === 'pp')).toBe(false);
  });

  it('a processor with no cooler heats the air round its package, and the radiator gives what the loop rejects', () => {
    const s = running([], {}, 70), bare = airParts(s, airPlan(s, bodies())).find((p) => p.id === 'cpu')!;
    expect(bare.porous).toBe(false);
    expect(bare.tempC).toBe(70);
    const rad = dev({ id: 'rad', kind: 'radiator', spec: 'rad2', slot: 'rad-front' });
    const loop = { coolantC: 40, rejectW: 120, side: 'front' as const, flow: 0.8, hotC: 58, coldC: 38 };
    const sr = running([rad], { board: boardSnap({ tier: 2, loop }) }), body: AirBody = { id: 'rad', kind: 'radiator', min: [d.max[0] - 1800, -3000, d.min[2] + 800], max: [d.max[0] - 900, 3000, d.min[2] + 4000] };
    const part = airParts(sr, airPlan(sr, bodies([body]))).find((p) => p.id === 'rad')!;
    expect(part.tempC).toBeCloseTo(48, 5);
    expect(part.powerW).toBe(120);
    expect(part.ua).toBeCloseTo(120 / (48 - AMBIENT_C), 3);
  });

  it('the air reference rises with the areas\' rise', () => {
    const s = running([], { board: boardSnap({ tier: 2, air: [{ id: 'north', flow: 1, fans: 1, riseC: 6 }, { id: 'cards', flow: 1, fans: 1, riseC: 3 }] }) });
    expect(airReference(s)).toBeCloseTo(AMBIENT_C + 4.5, 5);
  });
});

describe('the lines the particles follow', () => {
  it('a line has the length of its legs, and a point on it is found by the length', () => {
    const l = pathLine([[0, 0, 0], [3000, 0, 0], [3000, 4000, 0]]), out: V3 = [0, 0, 0];
    expect(l.length).toBe(7000);
    expect(pointOn(l, 1500, out)).toEqual([1500, 0, 0]);
    expect(pointOn(l, 5000, out)).toEqual([3000, 2000, 0]);
    expect(pointOn(l, -10, out)).toEqual([0, 0, 0]);
    expect(pointOn(l, 99999, out)).toEqual([3000, 4000, 0]);
  });

  it('the loop runs from the pump along the hot hose, through the radiator\'s core to its far end and back, and home on the cold hose', () => {
    // (the two ports of the pump head are apart: the block between them is the last leg)
    const hot: V3[] = [[300, 0, 3500], [300, 2000, 3500], [6000, 4000, 4300]], cold: V3[] = [[-300, 0, 3500], [-300, -2000, 3500], [6000, -4000, 4300]];
    const rad = { min: [7800, -5140, 4300] as V3, max: [8356, 4710, 5000] as V3 };
    const l = loopPath([hot, cold], rad, 'front')!;
    expect(l).not.toBeNull();
    expect(l.hot).toBeGreaterThan(0);
    expect(l.hot).toBeLessThan(l.rad);
    expect(l.rad).toBeLessThan(l.cold);
    expect(l.cold).toBeLessThan(l.length);
    // the core crosses the radiator along its length, at the middle of its thickness
    const s = (l.hot + l.rad) / 2, p = pointOn(l, s, [0, 0, 0]);
    expect(p[0]).toBeGreaterThan(rad.min[0] - 1);
    expect(p[0]).toBeLessThan(rad.max[0] + 1);
    expect(loopPath([hot], rad, 'front')).toBeNull();
    expect(loopPath([hot, cold], undefined, 'front')).toBeNull();
  });

  it('the water is hot to the radiator, cooled in its core, cold back to the pump, and warms in the block', () => {
    const l = { ...pathLine([[0, 0, 0], [1000, 0, 0]]), hot: 200, rad: 500, cold: 900 };
    expect(coolantAt(l, 0, 58, 38)).toBe(58);
    expect(coolantAt(l, 200, 58, 38)).toBe(58);
    expect(coolantAt(l, 350, 58, 38)).toBeCloseTo(48, 5);
    expect(coolantAt(l, 500, 58, 38)).toBe(38);
    expect(coolantAt(l, 800, 58, 38)).toBe(38);
    expect(coolantAt(l, 1000, 58, 38)).toBeCloseTo(58, 5);
  });
});
