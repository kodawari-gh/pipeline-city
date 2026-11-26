import { beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import type { Rect } from '@/core/render/camera';
import type { V3 } from '@/core/render/three/rope';
import { setLayoutTier } from '../../layout/layout';
import { buildBuses } from '../../wiring/routes';
import type { PsuBay } from '../air/plan';
import { powerLedger } from './ledger';
import * as net from './net';
import type { CableRun } from './runs';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const BAY: PsuBay = {
  id: 'psu',
  min: [4000, -3000, 2400],
  max: [7000, -1500, 4000],
  fan: null,
  opening: { y: -2000, z: 3000, hw: 400, hh: 400 },
};
const strand = (...p: V3[]): V3[] => p;
const run = (id: string, strands: V3[][], over: Partial<CableRun> = {}): CableRun => ({
  id,
  strands,
  r: 24,
  seated: true,
  seat: { at: must(must(strands[0])[must(strands[0]).length - 1]), axis: [-1, 0, 0] },
  held: false,
  fed: false,
  ...over,
});

/** A running machine: PSU, CPU, RAM, a SATA drive and a monitor, 54 W on the supply. */
function running(over: Partial<Snapshot> = {}, cords = { pc: true, mon: true }): Snapshot {
  return snap({
    powered: true,
    phase: 'idle-os' as never,
    power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false },
    energy: { wallW: 60, wh: 1 },
    devices: [
      dev({ id: 'psu', kind: 'psu', slot: 'atx0', powerW: 0 }),
      dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13 }),
      dev({ id: 'ram', kind: 'ram', slot: 'dimm0', powerW: 4 }),
      dev({ id: 'hdd', kind: 'storage', slot: 'sata0', powerW: 5 }),
      dev({ id: 'mon', kind: 'display', slot: 'display0', powerW: 1.2 }),
    ],
    storage: [{ deviceId: 'hdd', slot: 'sata0' } as never],
    cables: [
      { id: 'atx', name: 'ATX', connected: true },
      { id: 'cpu', name: 'CPU', connected: true },
      { id: 'video', name: 'Video', connected: true },
      { id: 'pcmains', name: 'PC cord', connected: cords.pc },
      { id: 'monmains', name: 'Monitor cord', connected: cords.mon },
    ] as Snapshot['cables'],
    ...over,
  });
}

function input(s: Snapshot, over: Partial<net.ShapeIn> = {}): net.ShapeIn {
  const slots = new Map<string, Rect>([
    ['cpu0', { x: 0, y: 0, w: 500, h: 500 }],
    ['dimm0', { x: 800, y: 0, w: 100, h: 600 }],
  ]);
  const runs = [
    run(
      'atx',
      [
        strand([5000, -2000, 2500], [5000, -2400, 2600], [3000, -2500, 2700]),
        strand([5020, -2000, 2500], [3020, -2500, 2700]),
      ],
      { fed: true },
    ),
    run('cpu', [strand([5000, -1800, 2500], [3500, -900, 2700])]),
    run('video', [strand([100, 100, 2500], [200, 200, 2700])]),
    run('pcmains', [strand([9000, -5000, 2000], [8000, -4000, 2100], [7000, -3000, 2300])], {
      seat: { at: [9000, -5000, 2000], axis: [1, 0, 0] },
    }),
    run('monmains', [strand([9000, -4000, 2000], [-9000, -1000, 4000])], {
      seat: { at: [9000, -4000, 2000], axis: [1, 0, 0] },
    }),
    run('hdd:power', [strand([6000, -2000, 2500], [6000, -2500, 2700])], { fed: true }),
  ];
  return { s, runs, buses: buildBuses(), slots, psu: BAY, boardZ: 2460, hubZ: 2490, ...over };
}

const box = (id: string): { min: V3; max: V3 } | null =>
  id === 'cpu'
    ? { min: [0, -500, 2460], max: [500, 0, 2800] }
    : id === 'ram'
      ? { min: [800, -600, 2460], max: [900, 0, 2800] }
      : id === 'hdd'
        ? { min: [6000, -2000, 2500], max: [6800, -1700, 2900] }
        : null;
const lineOf = (sh: net.PowerShape, id: string) => sh.lines.findIndex((l) => l.id === id);

beforeAll(() => {
  setLayoutTier(2, 2);
});

function assert_the_mains_from_the_wall_are_a_source_s_lines_eve(): void {
  const sh = net.powerShape(input(running()));
  const tone = (id: string): string => must(sh.lines[lineOf(sh, id)]).tone;
  expect(tone('pcmains#0')).toBe('source');
  expect(tone('monmains#0')).toBe('source');
  expect(tone('atx~0')).toBe('use');
  for (const id of ['atx#0', 'cpu#0', 'hdd:power#0', 'trace.pwrcpu.0', 'trace.vdimm.0']) {
    expect(tone(id)).toBe('use');
  }
}

function assert_puts_a_plate_round_the_plugs_of_the_wall_a_source(): void {
  const sh = net.powerShape(input(running()));
  expect(sh.nodes.map((n) => n.id)).toStrictEqual(['node.wall', 'node.vrm', 'node.dvrm']);
  const [wall, ...regs] = sh.nodes;
  expect(must(wall).role).toBe('source');
  // (it centres on the two plugs, at x 9000, y -5000 and -4000, just in front of them, and is bigger than they are apart)
  expect(must(wall).at).toStrictEqual([9000, -4500, 1990]);
  expect(must(wall).ex[0]).toBeGreaterThan(0);
  expect(must(wall).ey[1]).toBeGreaterThan(500);
  expect(regs.every((n) => n.role === 'hub')).toBe(true);
  // (the regulators lie on the board's own, over its face)
  expect(regs.every((n) => n.at[2] > 2460 && n.at[2] < 2520)).toBe(true);
  expect(regs.every((n) => Number.isFinite(n.at[0]) && n.ex[0] > 0 && n.ey[1] > 0)).toBe(true);
  const i = input(running());
  const fan = net.powerShape({
    ...i,
    runs: [...i.runs, run('sysfan', [strand([1000, -1000, 2500], [1200, -900, 2500])])],
  });
  const hub = must(fan.nodes.find((n) => n.id === 'node.hub'));
  expect(hub.role).toBe('hub');
  expect(hub.at[2]).toBe(2490);
}

describe('the power shape', () => {
  it('has a line for each strand of each power cable, and none for the data cables', () => {
    const sh = net.powerShape(input(running()));
    const cables = sh.lines.filter((l) => l.kind === 'cable').map((l) => l.id);
    expect(cables).toStrictEqual(
      expect.arrayContaining(['atx#0', 'atx#1', 'cpu#0', 'pcmains#0', 'monmains#0', 'hdd:power#0']),
    );
    expect(cables.some((id) => id.startsWith('video'))).toBe(false);
    expect(sh.rings.map((r) => r.cable)).toStrictEqual(['atx', 'cpu', 'pcmains', 'monmains', 'hdd:power']);
  });

  it('a cable from the supply goes on behind the tray as a stub of each strand: the way it was heading, a short run, fading in toward the cable', () => {
    const sh = net.powerShape(input(running()));
    const stubs = sh.lines.filter((l) => l.kind === 'ghost');
    expect(stubs.map((l) => l.id)).toStrictEqual(['atx~0', 'atx~1', 'hdd:power~0']);
    const g = must(stubs[0]);
    // (the first strand starts at [5000, -2000, 2500] heading to [5000, -2400, 2600]: it came from the other way)
    const [back, root] = g.pts as [V3, V3];
    expect(root).toStrictEqual([5000, -2000, 2500]);
    expect(Math.hypot(back[0] - root[0], back[1] - root[1], back[2] - root[2])).toBeCloseTo(1500, 6);
    expect(back[1]).toBeGreaterThan(root[1]);
    expect(back[2]).toBeLessThan(root[2]);
    expect(g.fade).toBe(1500);
    expect(g.cable).toBe('atx');
    // a cable that is not from the supply (a cord, a lead the sim has no strand for) has none
    expect(
      net
        .powerShape(input(running(), { runs: [run('cpu', [strand([1, 2, 3], [4, 5, 6])])] }))
        .lines.some((l) => l.kind === 'ghost'),
    ).toBe(false);
  });

  it("follows the board's own copper: the CPU rails, the memory rails and a drop into the stick, in world space over the board", () => {
    const sh = net.powerShape(input(running()));
    const ids = sh.lines.filter((l) => l.kind === 'trace').map((l) => l.id);
    expect(ids).toStrictEqual(
      expect.arrayContaining([
        'trace.pwrcpu.0',
        'trace.vcore.0',
        'trace.pwr12.0',
        'trace.vdimm.0',
        'trace.vdimm.dimm0',
      ]),
    );
    const t = must(sh.lines[lineOf(sh, 'trace.pwrcpu.0')]);
    expect(t.pts.every((p) => p[2] === 2470)).toBe(true);
    expect(t.pts.every((p) => p.every(Number.isFinite))).toBe(true);
    // (layout y runs down, the world's runs up)
    const b = must(must(buildBuses().find((x) => x.id === 'pwrcpu')).lanes[0]);
    expect(must(t.pts[0])[1]).toBe(-must(b.pts[0])[1]);
  });

  it("the mains from the wall are a source's lines; every other line takes its power from the supply or the board, and is a use", () => {
    expect.hasAssertions();
    assert_the_mains_from_the_wall_are_a_source_s_lines_eve();
  });

  it('puts a plate round the plugs of the wall (a source) and one on each regulator (a hub); the fan hub has one when its cord is there', () => {
    expect.hasAssertions();
    assert_puts_a_plate_round_the_plugs_of_the_wall_a_source();
  });

  it("lets the studio's wall set the source plate: its real outline, lying over the plugs' seat, with the words beside it; the room's socket stays as it was", () => {
    const outlet = { padX: 860, padY: 920, lift: 14 };
    const draw = (over: Partial<net.ShapeIn> = {}) => {
      const s = running(),
        sh = net.powerShape(input(s, over));
      return { sh, d: net.powerDraw(sh, s, powerLedger(s), box) };
    };
    const room = draw(),
      studio = draw({ outlet });
    const a = must(room.sh.nodes[0]),
      b = must(studio.sh.nodes[0]);
    expect(b.id).toBe('node.wall');
    // (the plugs stand 1000 apart up the wall, both at x 9000: the plate is that and the pad each way, in front of the seat, not behind it)
    expect(b.at).toStrictEqual([9000, -4500, 2014]);
    expect(b.ex[0]).toBe(860);
    expect(b.ey[1]).toBe(500 + 920);
    expect(a.at[2]).toBe(1990);
    expect(a.ex[0]).toBe(760);
    // (the room's words stand over the plug; the studio's start east of the plate, level with its middle)
    expect(room.sh.wallWords).toBeUndefined();
    expect(studio.sh.wallWords).toStrictEqual([9000 + 860 + 260, -4500 + 260, 2014 + 120]);
    expect(must(room.d.tags.find((t) => t.id === 'p.wall')).at).toStrictEqual([9000, -5000 + 260, 2000 + 120]);
    expect(must(studio.d.tags.find((t) => t.id === 'p.wall')).at).toStrictEqual(studio.sh.wallWords);
  });

  it("takes the studio's plate whole when it is given as a box: its own middle and half-extents, not the plugs' (a plug in each of two of three sockets)", () => {
    const s = running(),
      sh = net.powerShape(input(s, { outlet: { lift: 14, box: { x: 8000, y: -4000, hx: 1046, hy: 1046 } } }));
    const n = must(sh.nodes[0]);
    expect(n.id).toBe('node.wall');
    expect(n.at).toStrictEqual([8000, -4000, 2014]);
    expect(n.ex[0]).toBe(1046);
    expect(n.ey[1]).toBe(1046);
    expect(sh.wallWords).toStrictEqual([8000 + 1046 + 260, -4000 + 260, 2014 + 120]);
  });

  it('has no plate for a regulator whose part is not there, none on a board with no supply, and none for a wall with no cord', () => {
    const base = running();
    const noCpu = { ...base, devices: base.devices.filter((d) => d.kind !== 'cpu') };
    expect(net.powerShape(input(noCpu)).nodes.map((n) => n.id)).toStrictEqual(['node.wall', 'node.dvrm']);
    expect(
      net.powerShape(input({ ...base, devices: base.devices.filter((d) => d.kind !== 'psu') })).nodes.map((n) => n.id),
    ).toStrictEqual(['node.wall']);
    expect(
      net
        .powerShape(input(base, { runs: input(base).runs.filter((r) => !r.id.endsWith('mains')) }))
        .nodes.some((n) => n.id === 'node.wall'),
    ).toBe(false);
  });

  it('a card is fed along its slot rail, a drive on its M.2 socket; with no supply there are no traces', () => {
    const base = running();
    const s = {
      ...base,
      devices: [...base.devices, dev({ id: 'gpu', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 })],
    };
    const i = input(s);
    i.slots = new Map([...i.slots, ['pcie0', { x: -2850, y: 1100, w: 3300, h: 60 }]]);
    const sh = net.powerShape(i);
    const feed = must(sh.lines[lineOf(sh, 'feed.pcie0')]);
    expect(feed.pts.length, 'a routed rail, not a straight line').toBeGreaterThan(3);
    expect(feed.branch).toBe(true);
    expect(
      net
        .powerShape(input({ ...s, devices: s.devices.filter((d) => d.kind !== 'psu') }))
        .lines.some((l) => l.kind === 'trace'),
    ).toBe(false);
  });
});

describe('a snapshot on the shape', () => {
  const draw = (s: Snapshot, over: Partial<net.ShapeIn> = {}) => {
    const sh = net.powerShape(input(s, over));
    return { sh, d: net.powerDraw(sh, s, powerLedger(s), box) };
  };
  const state = (sh: net.PowerShape, d: ReturnType<typeof draw>['d'], id: string) => d.state[lineOf(sh, id)];

  function assert_a_running_machine_cables_and_traces_on_the_busiest(): void {
    const { sh, d } = draw(running());
    expect(state(sh, d, 'pcmains#0')).toBe(1);
    expect(state(sh, d, 'cpu#0')).toBe(1);
    expect(must(d.level[lineOf(sh, 'pcmains#0')])).toBeGreaterThan(must(d.level[lineOf(sh, 'cpu#0')]));
    expect(must(d.level[lineOf(sh, 'cpu#0')])).toBeGreaterThan(must(d.level[lineOf(sh, 'hdd:power#0')]));
    expect(must(d.level[lineOf(sh, 'trace.pwrcpu.0')])).toBeGreaterThan(must(d.level[lineOf(sh, 'trace.pwrcpu.1')]));
    expect([...d.level].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
    expect(d.open.every((x) => x === 0)).toBe(true);
    expect(d.refW).toBe(60);
  }

  it('a running machine: cables and traces on, the busiest run the hottest, every number a number', () => {
    expect.hasAssertions();
    assert_a_running_machine_cables_and_traces_on_the_busiest();
  });

  it('a machine that is off: every run idles, none glows', () => {
    const base = running();
    const { d } = draw({ ...base, powered: false, power: { ...base.power, off: true } });
    expect(d.state.every((x) => x === 0)).toBe(true);
    expect(d.level.every((x) => x === 0)).toBe(true);
    expect(d.nodeState.every((x) => x === 0)).toBe(true);
    expect(d.nodeLevel.every((x) => x === 0)).toBe(true);
    expect([...d.parts.values()].every((x) => x === 0)).toBe(true);
  });

  function assert_the_plates_glow_by_what_passes_through_them_the_(): void {
    const { sh, d } = draw(running());
    const at = (id: string): number => sh.nodes.findIndex((n) => n.id === id);
    expect([...d.nodeState]).toStrictEqual([1, 1, 1]);
    expect(must(d.nodeLevel[at('node.wall')])).toBeGreaterThan(must(d.nodeLevel[at('node.vrm')]));
    expect(must(d.nodeLevel[at('node.vrm')])).toBeGreaterThan(must(d.nodeLevel[at('node.dvrm')]));
    expect(must(d.nodeLevel[at('node.dvrm')])).toBeGreaterThan(0);
    expect([...d.nodeLevel].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
  }

  it('the plates glow by what passes through them: the wall by the whole draw, a regulator by what it hands on', () => {
    expect.hasAssertions();
    assert_the_plates_glow_by_what_passes_through_them_the_();
  });

  function assert_a_plate_is_out_with_the_cable_that_feeds_it_the_(): void {
    const base = running();
    const out = (id: string) =>
      draw({
        ...base,
        cables: base.cables.map((c) => (c.id === id ? { ...c, connected: false } : c)) as Snapshot['cables'],
      });
    const stateOfNode = (r: ReturnType<typeof out>, id: string): number | undefined =>
      r.d.nodeState[r.sh.nodes.findIndex((n) => n.id === id)];
    expect(stateOfNode(out('pcmains'), 'node.wall')).toBe(2);
    expect(stateOfNode(out('monmains'), 'node.wall')).toBe(2);
    expect(stateOfNode(out('cpu'), 'node.vrm')).toBe(2);
    expect(stateOfNode(out('cpu'), 'node.dvrm')).toBe(1);
    expect(stateOfNode(out('atx'), 'node.dvrm')).toBe(2);
    expect(stateOfNode(out('atx'), 'node.vrm')).toBe(1);
  }

  it('a plate is out with the cable that feeds it: the wall with a cord, the CPU regulator with the 8-pin, the memory regulator with the 24-pin', () => {
    expect.hasAssertions();
    assert_a_plate_is_out_with_the_cable_that_feeds_it_the_();
  });

  it('says what a regulator hands on and what it wastes on the way, and keeps these among the words of detail', () => {
    const { d } = draw(running({ board: boardSnap({ vrm: { heatW: 2.5 } }) }));
    const word = must(d.tags.find((t) => t.id === 'p.node.vrm'));
    expect(word).toMatchObject({ text: 'CPU VRM 13 W (2.5 W lost)', role: 'hub', minor: true });
    // (the memory's regulator wastes nothing here: it says so with no second number)
    expect(must(d.tags.find((t) => t.id === 'p.node.dvrm')).text).toBe('RAM VRM 4.0 W');
    // (a machine that is off has none)
    const base = running();
    expect(
      draw({ ...base, powered: false, power: { ...base.power, off: true } }).d.tags.some((t) =>
        t.id.startsWith('p.node'),
      ),
    ).toBe(false);
  });

  it('says what the fan hub carries, and gives each power part its role: the supply hands on, the parts use, a part with no rating is none', () => {
    const base = running();
    const s = {
      ...base,
      devices: [...base.devices, dev({ id: 'fan0', kind: 'fan', spec: 'fan92', slot: 'front0', powerW: 2 })],
    };
    const i = input(s);
    const sh = net.powerShape({
      ...i,
      runs: [...i.runs, run('sysfan', [strand([1000, -1000, 2500], [1200, -900, 2500])])],
    });
    const d = net.powerDraw(sh, s, powerLedger(s), box);
    expect(d.tags.find((t) => t.id === 'p.fans')).toMatchObject({ text: 'FAN HUB 2.0 W', role: 'hub', minor: true });
    expect(d.roles.get('psu')).toBe('hub');
    expect(d.roles.get('cpu')).toBe('use');
    expect(d.roles.get('hdd')).toBe('use');
    expect(d.roles.get('fan0')).toBe('use');
  });

  function assert_a_cable_that_is_out_is_missing_with_a_ring_and_i(): void {
    const base = running();
    const { sh, d } = draw({
      ...base,
      cables: base.cables.map((c) => (c.id === 'atx' ? { ...c, connected: false } : c)) as Snapshot['cables'],
    });
    expect(state(sh, d, 'atx#0')).toBe(2);
    expect(state(sh, d, 'atx#1')).toBe(2);
    expect(d.level[lineOf(sh, 'atx#0')]).toBe(0);
    expect(state(sh, d, 'cpu#0')).toBe(1);
    expect(d.open[sh.rings.findIndex((r) => r.cable === 'atx')]).toBe(1);
    expect(d.open.filter((x) => x === 1)).toHaveLength(1);
    const warn = must(d.tags.find((t) => t.id === 'p.atx.warn'));
    expect(warn).toMatchObject({ text: 'NO MAIN POWER', tone: 'warn' });
    expect(warn.at.every(Number.isFinite)).toBe(true);
  }

  it('a cable that is out is missing, with a ring and its words at the socket; the rest run on', () => {
    expect.hasAssertions();
    assert_a_cable_that_is_out_is_missing_with_a_ring_and_i();
  });

  it('a cord that is out says to plug it in', () => {
    const { d } = draw(running({}, { pc: false, mon: false }));
    expect(must(d.tags.find((t) => t.id === 'p.pcmains.warn')).text).toBe('PLUG THE PC IN');
    expect(must(d.tags.find((t) => t.id === 'p.monmains.warn')).text).toBe('PLUG THE MONITOR IN');
  });

  it("says the wall, the supply's load, the monitor and each part kind once, with the scale and the legend under the first", () => {
    const { d } = draw(running());
    const text = Object.fromEntries(d.tags.map((t) => [t.id, t.text]));
    expect(text['p.wall']).toBe('WALL 60 W');
    expect(text['p.psu']).toBe('SUPPLY 54 W / 250 W');
    expect(text['p.monitor']).toBe('MONITOR 1.2 W');
    expect(text['p.cpu']).toBe('CPU 13 W');
    expect(text['p.ram']).toBe('RAM 4.0 W');
    expect(text['p.hdd']).toBe('DRIVE 5.0 W');
    const scale = must(d.tags.find((t) => t.id === 'p.scale'));
    expect(scale).toMatchObject({ unit: 'W', under: 'p.wall', scale: [0, 60] });
    expect(d.tags.find((t) => t.id === 'p.legend')).toMatchObject({ legend: true, under: 'p.scale' });
    expect(d.tags.every((t) => t.at.every(Number.isFinite))).toBe(true);
    expect(new Set(d.tags.map((t) => t.id)).size).toBe(d.tags.length);
  });

  function assert_gives_every_word_the_role_of_the_thing_it_names_(): void {
    const { d } = draw(running());
    const role = Object.fromEntries(d.tags.map((t) => [t.id, t.role]));
    expect(role['p.wall']).toBe('source');
    expect(role['p.psu']).toBe('hub');
    expect(role['p.monitor']).toBe('use');
    expect(role['p.cpu']).toBe('use');
    expect(role['p.hdd']).toBe('use');
    // (the warnings, the scale and the legend are no node)
    expect(
      d.tags.filter((t) => t.tone === 'warn' || t.id === 'p.scale' || t.id === 'p.legend').every((t) => !t.role),
    ).toBe(true);
  }

  it('gives every word the role of the thing it names: the wall a source, the supply a hub, the parts users', () => {
    expect.hasAssertions();
    assert_gives_every_word_the_role_of_the_thing_it_names_();
  });

  it('parts glow by what they draw; a supply over its budget glows red', () => {
    const { d } = draw(running());
    expect(must(d.parts.get('cpu'))).toBeGreaterThan(must(d.parts.get('ram')));
    expect(must(d.parts.get('ram'))).toBeGreaterThan(0);
    expect(d.warn.size).toBe(0);
    const t = draw(
      running({ power: { vrmLossW: 0, totalW: 600, budgetW: 250, psuFactor: 0.4, off: false, tripped: true } }),
    );
    expect(t.d.warn.has('psu')).toBe(true);
    expect(must(t.d.tags.find((x) => x.id === 'p.psu')).tone).toBe('warn');
  });

  it('no supply: no flow, and it says so at the main connector', () => {
    const base = running();
    const s = { ...base, devices: base.devices.filter((x) => x.kind !== 'psu') };
    const { d } = draw(s, { psu: null });
    expect(must(d.tags.find((t) => t.id === 'p.nopsu')).text).toBe('NO POWER SUPPLY');
    expect(d.tags.some((t) => t.id === 'p.psu')).toBe(false);
  });
});
