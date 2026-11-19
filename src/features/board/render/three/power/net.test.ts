import { beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { dev, snap } from '@/core/ui/testdata';
import type { Rect } from '@/core/render/camera';
import type { V3 } from '@/core/render/three/rope';
import { setLayoutTier } from '../../layout/layout';
import { buildBuses } from '../../wiring/routes';
import type { PsuBay } from '../air/plan';
import { powerLedger } from './ledger';
import { powerDraw, powerShape, type PowerShape, type ShapeIn } from './net';
import type { CableRun } from './runs';

const BAY: PsuBay = { id: 'psu', min: [4000, -3000, 2400], max: [7000, -1500, 4000], fan: null, opening: { y: -2000, z: 3000, hw: 400, hh: 400 } };
const strand = (...p: V3[]): V3[] => p;
const run = (id: string, strands: V3[][], over: Partial<CableRun> = {}): CableRun => ({ id, strands, r: 24, seated: true, seat: { at: strands[0]![strands[0]!.length - 1]!, axis: [-1, 0, 0] }, held: false, fed: false, ...over });

/** A running machine: PSU, CPU, RAM, a SATA drive and a monitor, 54 W on the supply. */
function running(over: Partial<Snapshot> = {}, cords = { pc: true, mon: true }): Snapshot {
  return snap({
    powered: true, phase: 'idle-os' as never, power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false }, energy: { wallW: 60, wh: 1 },
    devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0', powerW: 0 }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13 }), dev({ id: 'ram', kind: 'ram', slot: 'dimm0', powerW: 4 }),
      dev({ id: 'hdd', kind: 'storage', slot: 'sata0', powerW: 5 }), dev({ id: 'mon', kind: 'display', slot: 'display0', powerW: 1.2 })],
    storage: [{ deviceId: 'hdd', slot: 'sata0' } as never],
    cables: [
      { id: 'atx', name: 'ATX', connected: true }, { id: 'cpu', name: 'CPU', connected: true }, { id: 'video', name: 'Video', connected: true },
      { id: 'pcmains', name: 'PC cord', connected: cords.pc }, { id: 'monmains', name: 'Monitor cord', connected: cords.mon },
    ] as Snapshot['cables'],
    ...over,
  });
}

function input(s: Snapshot, over: Partial<ShapeIn> = {}): ShapeIn {
  const slots = new Map<string, Rect>([['cpu0', { x: 0, y: 0, w: 500, h: 500 }], ['dimm0', { x: 800, y: 0, w: 100, h: 600 }]]);
  const runs = [
    run('atx', [strand([5000, -2000, 2500], [5000, -2400, 2600], [3000, -2500, 2700]), strand([5020, -2000, 2500], [3020, -2500, 2700])], { fed: true }),
    run('cpu', [strand([5000, -1800, 2500], [3500, -900, 2700])]),
    run('video', [strand([100, 100, 2500], [200, 200, 2700])]),
    run('pcmains', [strand([9000, -5000, 2000], [8000, -4000, 2100], [7000, -3000, 2300])], { seat: { at: [9000, -5000, 2000], axis: [1, 0, 0] } }),
    run('monmains', [strand([9000, -4000, 2000], [-9000, -1000, 4000])], { seat: { at: [9000, -4000, 2000], axis: [1, 0, 0] } }),
    run('hdd:power', [strand([6000, -2000, 2500], [6000, -2500, 2700])], { fed: true }),
  ];
  return { s, runs, buses: buildBuses(), slots, psu: BAY, boardZ: 2460, ...over };
}

const box = (id: string): { min: V3; max: V3 } | null => (id === 'cpu' ? { min: [0, -500, 2460], max: [500, 0, 2800] } : id === 'ram' ? { min: [800, -600, 2460], max: [900, 0, 2800] } : id === 'hdd' ? { min: [6000, -2000, 2500], max: [6800, -1700, 2900] } : null);
const lineOf = (sh: PowerShape, id: string) => sh.lines.findIndex((l) => l.id === id);

beforeAll(() => setLayoutTier(2, 2));

describe('the power shape', () => {
  it('has a line for each strand of each power cable, and none for the data cables', () => {
    const sh = powerShape(input(running()));
    const cables = sh.lines.filter((l) => l.kind === 'cable').map((l) => l.id);
    expect(cables).toEqual(expect.arrayContaining(['atx#0', 'atx#1', 'cpu#0', 'pcmains#0', 'monmains#0', 'hdd:power#0']));
    expect(cables.some((id) => id.startsWith('video'))).toBe(false);
    expect(sh.rings.map((r) => r.cable)).toEqual(['atx', 'cpu', 'pcmains', 'monmains', 'hdd:power']);
  });

  it('a cable from the supply goes on behind the tray as a stub of each strand: the way it was heading, a short run, fading in toward the cable', () => {
    const sh = powerShape(input(running()));
    const stubs = sh.lines.filter((l) => l.kind === 'ghost');
    expect(stubs.map((l) => l.id)).toEqual(['atx~0', 'atx~1', 'hdd:power~0']);
    const g = stubs[0]!;
    // (the first strand starts at [5000, -2000, 2500] heading to [5000, -2400, 2600]: it came from the other way)
    const [back, root] = g.pts as [V3, V3];
    expect(root).toEqual([5000, -2000, 2500]);
    expect(Math.hypot(back[0] - root[0], back[1] - root[1], back[2] - root[2])).toBeCloseTo(1500, 6);
    expect(back[1]).toBeGreaterThan(root[1]);
    expect(back[2]).toBeLessThan(root[2]);
    expect(g.fade).toBe(1500);
    expect(g.cable).toBe('atx');
    // a cable that is not from the supply (a cord, a lead the sim has no strand for) has none
    expect(powerShape(input(running(), { runs: [run('cpu', [strand([1, 2, 3], [4, 5, 6])])] })).lines.some((l) => l.kind === 'ghost')).toBe(false);
  });

  it('follows the board\'s own copper: the CPU rails, the memory rails and a drop into the stick, in world space over the board', () => {
    const sh = powerShape(input(running()));
    const ids = sh.lines.filter((l) => l.kind === 'trace').map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['trace.pwrcpu.0', 'trace.vcore.0', 'trace.pwr12.0', 'trace.vdimm.0', 'trace.vdimm.dimm0']));
    const t = sh.lines[lineOf(sh, 'trace.pwrcpu.0')]!;
    expect(t.pts.every((p) => p[2] === 2470)).toBe(true);
    expect(t.pts.every((p) => p.every(Number.isFinite))).toBe(true);
    // (layout y runs down, the world's runs up)
    const b = buildBuses().find((x) => x.id === 'pwrcpu')!.lanes[0]!;
    expect(t.pts[0]![1]).toBe(-b.pts[0]![1]);
  });

  it('a card is fed along its slot rail, a drive on its M.2 socket; with no supply there are no traces', () => {
    const base = running();
    const s = { ...base, devices: [...base.devices, dev({ id: 'gpu', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 })] };
    const i = input(s);
    i.slots = new Map([...i.slots, ['pcie0', { x: -2850, y: 1100, w: 3300, h: 60 }]]);
    const sh = powerShape(i);
    const feed = sh.lines[lineOf(sh, 'feed.pcie0')]!;
    expect(feed.pts.length, 'a routed rail, not a straight line').toBeGreaterThan(3);
    expect(feed.branch).toBe(true);
    expect(powerShape(input({ ...s, devices: s.devices.filter((d) => d.kind !== 'psu') })).lines.some((l) => l.kind === 'trace')).toBe(false);
  });
});

describe('a snapshot on the shape', () => {
  const draw = (s: Snapshot, over: Partial<ShapeIn> = {}) => { const sh = powerShape(input(s, over)); return { sh, d: powerDraw(sh, s, powerLedger(s), box) }; };
  const state = (sh: PowerShape, d: ReturnType<typeof draw>['d'], id: string) => d.state[lineOf(sh, id)];

  it('a running machine: cables and traces on, the busiest run the hottest, every number a number', () => {
    const { sh, d } = draw(running());
    expect(state(sh, d, 'pcmains#0')).toBe(1);
    expect(state(sh, d, 'cpu#0')).toBe(1);
    expect(d.level[lineOf(sh, 'pcmains#0')]!).toBeGreaterThan(d.level[lineOf(sh, 'cpu#0')]!);
    expect(d.level[lineOf(sh, 'cpu#0')]!).toBeGreaterThan(d.level[lineOf(sh, 'hdd:power#0')]!);
    expect(d.level[lineOf(sh, 'trace.pwrcpu.0')]!).toBeGreaterThan(d.level[lineOf(sh, 'trace.pwrcpu.1')]!);
    expect([...d.level].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
    expect(d.open.every((x) => x === 0)).toBe(true);
    expect(d.refW).toBe(60);
  });

  it('a machine that is off: every run idles, none glows', () => {
    const base = running();
    const { d } = draw({ ...base, powered: false, power: { ...base.power, off: true } });
    expect(d.state.every((x) => x === 0)).toBe(true);
    expect(d.level.every((x) => x === 0)).toBe(true);
    expect([...d.parts.values()].every((x) => x === 0)).toBe(true);
  });

  it('a cable that is out is missing, with a ring and its words at the socket; the rest run on', () => {
    const base = running();
    const { sh, d } = draw({ ...base, cables: base.cables.map((c) => (c.id === 'atx' ? { ...c, connected: false } : c)) as Snapshot['cables'] });
    expect(state(sh, d, 'atx#0')).toBe(2);
    expect(state(sh, d, 'atx#1')).toBe(2);
    expect(d.level[lineOf(sh, 'atx#0')]).toBe(0);
    expect(state(sh, d, 'cpu#0')).toBe(1);
    expect(d.open[sh.rings.findIndex((r) => r.cable === 'atx')]).toBe(1);
    expect(d.open.filter((x) => x === 1).length).toBe(1);
    const warn = d.tags.find((t) => t.id === 'p.atx.warn')!;
    expect(warn).toMatchObject({ text: 'NO MAIN POWER', tone: 'warn' });
    expect(warn.at.every(Number.isFinite)).toBe(true);
  });

  it('a cord that is out says to plug it in', () => {
    const { d } = draw(running({}, { pc: false, mon: false }));
    expect(d.tags.find((t) => t.id === 'p.pcmains.warn')!.text).toBe('PLUG THE PC IN');
    expect(d.tags.find((t) => t.id === 'p.monmains.warn')!.text).toBe('PLUG THE MONITOR IN');
  });

  it('says the wall, the supply\'s load, the monitor and each part kind once, with the scale under the first', () => {
    const { d } = draw(running());
    const text = Object.fromEntries(d.tags.map((t) => [t.id, t.text]));
    expect(text['p.wall']).toBe('WALL 60 W');
    expect(text['p.psu']).toBe('LOAD 54 W / 250 W');
    expect(text['p.monitor']).toBe('MONITOR 1.2 W');
    expect(text['p.cpu']).toBe('CPU 13 W');
    expect(text['p.ram']).toBe('RAM 4.0 W');
    expect(text['p.hdd']).toBe('DRIVE 5.0 W');
    const scale = d.tags.find((t) => t.id === 'p.scale')!;
    expect(scale).toMatchObject({ unit: 'W', under: 'p.wall', scale: [0, 60] });
    expect(d.tags.every((t) => t.at.every(Number.isFinite))).toBe(true);
    expect(new Set(d.tags.map((t) => t.id)).size).toBe(d.tags.length);
  });

  it('parts glow by what they draw; a supply over its budget glows red', () => {
    const { d } = draw(running());
    expect(d.parts.get('cpu')!).toBeGreaterThan(d.parts.get('ram')!);
    expect(d.parts.get('ram')!).toBeGreaterThan(0);
    expect(d.warn.size).toBe(0);
    const t = draw(running({ power: { vrmLossW: 0, totalW: 600, budgetW: 250, psuFactor: 0.4, off: false, tripped: true } }));
    expect(t.d.warn.has('psu')).toBe(true);
    expect(t.d.tags.find((x) => x.id === 'p.psu')!.tone).toBe('warn');
  });

  it('no supply: no flow, and it says so at the main connector', () => {
    const base = running();
    const s = { ...base, devices: base.devices.filter((x) => x.kind !== 'psu') };
    const { d } = draw(s, { psu: null });
    expect(d.tags.find((t) => t.id === 'p.nopsu')!.text).toBe('NO POWER SUPPLY');
    expect(d.tags.some((t) => t.id === 'p.psu')).toBe(false);
  });
});
