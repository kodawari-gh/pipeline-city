import { assert, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { airColor, airflowModel, clipPath } from './airflow';
import type * as airflowTypes from './airflow';
import { AIR_SOURCES, OUTSIDE_THE_CASE } from './airsources';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { CASE_GLASS, REAR_FAN, REAR_FAN_FITTED, setLayoutTier } from '@/features/board/render/layout/layout';
import { fanMounts } from '@/features/room/render/desk/props/case';
import type { Rect } from '@/core/render/camera';
import type { CableId } from '@/features/board/sim/cables';

// The labels go through Pixi's Text (a canvas): the airflow model is pure data.
// Labels are texts that never measure themselves here, with empty bounds like the empty containers they stood in for before.
vi.mock(import('@/core/render/ink'), async (orig) => {
  const pixi = await import('pixi.js');
  class BareText extends pixi.Text {
    protected override updateBounds(): void {
      this._bounds.clear();
    }
  }
  return { ...(await orig()), label: (str: string) => new BareText({ text: str }) };
});

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A running Mid tower with a fan on every mount: a CPU at `cpuC`, fans cabled but for `unplug`. */
function running(cpuC = 40, unplug: string[] = [], over: Partial<Snapshot> = {}): airflowTypes.AirIn {
  setLayoutTier(2, 2);
  const mounts: airflowTypes.AirMount[] = fanMounts();
  const ids: CableId[] = ['sysfan', ...mounts.map((m): CableId => `fan:${m.id}`)];
  const s = snap({
    powered: true,
    power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false },
    devices: [
      dev({ id: 'psu', kind: 'psu', spec: 'psu2', slot: 'atx0', powerW: 0 }),
      dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13, tempC: cpuC }),
      ...mounts.map((m) => dev({ id: `f-${m.id}`, kind: 'fan', spec: 'fan120', slot: m.id })),
    ],
    cables: ids.map((id) => ({ id, name: id, connected: !unplug.includes(id) })),
    ...over,
  });
  const slots = new Map<string, Rect>([
    ['cpu0', { x: CASE_GLASS.x + CASE_GLASS.w * 0.4, y: CASE_GLASS.y + CASE_GLASS.h * 0.4, w: 500, h: 500 }],
  ]);
  return {
    s,
    mounts,
    radiator: null,
    rearFitted: REAR_FAN_FITTED,
    rear: REAR_FAN,
    glass: CASE_GLASS,
    slots,
    sources: AIR_SOURCES,
  };
}
type Model = ReturnType<typeof airflowModel>;
type Lane = Model['lanes'][number];
const caseLanes = (m: Model) => m.lanes.filter((l) => l.local !== true);

/** Whether a lane is turned by one case fan. */
const caseFan = (l: Lane): boolean => l.fanIds.length === 1 && must(l.fanIds[0]).startsWith('case:');

/** Whether a slot or mount is the first front one or the rear one. */
const frontOrRear = (id: unknown): boolean => id === 'front0' || id === 'rear';

/** How long a lane's path is. */
function pathLength(pts: Lane['pts']): number {
  let a = 0;
  for (let k = 1; k < pts.length; k++) {
    const p = must(pts[k]),
      q = must(pts[k - 1]);
    a += Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  return a;
}

/** Whether a component's lane is a stream the view clips (not the PSU's, the VRM sink's or the cooler's). */
const clipped = (l: Lane): boolean => l.fanIds[0] !== 'psu' && l.fanIds[0] !== 'vrm' && l.fanIds[0] !== 'cooler';

/** The radiator lane of a front loop on a running tower. */
const radLane = (loop: NonNullable<ReturnType<typeof boardSnap>['loop']>): Lane => {
  const i = running(60, [], { board: boardSnap({ loop }) }),
    front = i.mounts.filter((m) => m.side === 'front');
  assert.exists(front[0]);
  const frontLane = airflowModel({
    ...i,
    radiator: { side: 'front', ids: front.map((m) => m.id), rect: front[0].rect },
  }).lanes.find((l) => l.id === 'rad-front');
  assert.exists(frontLane);
  return frontLane;
};

/** The sim's air in every area: its flow, and how much the cards warm it. */
const airOf = (flow: number, riseC = 0) =>
  (['north', 'cards', 'bay'] as const).map((id) => ({ id, flow, fans: 3, riseC }));

/** A zone's hover ids, none with no zone. */
const idsOf = (z: Model['zones'][number] | undefined): Model['zones'][number]['ids'] => z?.ids ?? [];

/** Whether a spec has thermals. */
const hasThermals = (sp: object): boolean => 'thermal' in sp && Boolean(sp.thermal);

/** Whether a part kind has an air source, or sits outside the case. */
const hasAir = (claimed: Set<string>, kind: string): boolean => claimed.has(kind) || OUTSIDE_THE_CASE.includes(kind);

/** How a case fan acts: a front one blows in, the rest draw out. */
const kindFor = (intake: boolean): Lane['kind'] => (intake ? 'in' : 'out');

describe('the airflow lens model', () => {
  it('one lane per case fan, the front ones taking air in and the rest blowing it out', () => {
    const m = airflowModel(running());
    const mounts = fanMounts();
    expect(caseLanes(m)).toHaveLength(mounts.length);
    for (const l of caseLanes(m)) {
      expect(l.intake).toBe(l.id.startsWith('front'));
    }
    expect(caseLanes(m).every((l) => l.state === 'on')).toBe(true);
    expect(caseLanes(m).every((l) => caseFan(l))).toBe(true);
  });

  it('a mount with no fan has no lane: only a fan moves air, and the rear opening still leaks by pressure', () => {
    const i = running(),
      rest = i.s.devices.filter((d) => !frontOrRear(d.slot));
    const m = airflowModel({ ...i, s: { ...i.s, devices: rest } });
    expect(caseLanes(m).some((l) => l.id === 'front0')).toBe(false);
    expect(m.mounts.some((x) => frontOrRear(x.id))).toBe(false);
    expect(m.tags.some((t) => t.id === 'dead.front0')).toBe(false);
    expect(caseLanes(m).find((l) => l.id === 'rear')).toMatchObject({ state: 'on', strength: 0.3 });
    const bare = airflowModel({ ...i, s: { ...i.s, devices: i.s.devices.filter((d) => d.kind !== 'fan') } });
    expect(caseLanes(bare).map((l) => l.id)).toStrictEqual(['rear']);
  });

  it('the components bring their own fans: a stream for a cooler, a card, a sink and the PSU, tied to the fan id the view spins', () => {
    const i = running(40, [], {
      devices: [
        dev({ id: 'psu', kind: 'psu', spec: 'psu2', slot: 'atx0' }),
        dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' }),
        dev({ id: 'cool', kind: 'cooler', spec: 'cooler1', slot: 'cooler0' }),
        dev({ id: 'gpu', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 }),
        dev({ id: 'vs', kind: 'vrm-sink', spec: 'vsink2', slot: 'vrm-sink0' }),
        dev({ id: 'vs2', kind: 'ram-sink', spec: 'rsink0', slot: 'ram-sink0' }),
        dev({ id: 'f1', kind: 'fan', spec: 'fan120', slot: 'cooler0.fan0' }),
        dev({ id: 'f2', kind: 'fan', spec: 'fan40', slot: 'vrm-sink0.fan0' }),
      ],
    });
    i.slots.set('pcie0', { x: CASE_GLASS.x + 3000, y: CASE_GLASS.y + 1500, w: 3000, h: 900 });
    const m = airflowModel(i),
      local = m.lanes.filter((l) => l.local === true);
    // a passive sink (rsink0) has no fan; the fan sink, the cooler, the card and the PSU do
    expect(local.map((l) => must(l.fanIds[0])).toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      'cooler',
      'gpu:pcie0',
      'psu',
      'vrm',
    ]);
    for (const l of local) {
      expect(l.pts.length).toBeGreaterThan(1);
    }
    expect(m.tags.some((t) => t.text.startsWith('GPU '))).toBe(true);
    for (const l of local.filter((x) => clipped(x))) {
      expect(pathLength(l.pts)).toBeLessThanOrEqual(1950);
    }
    // a heatsink fan blows along its fins toward the rear exhaust: a stream of its own that runs west, from the fan to the rear wall
    const vrm = local.find((l) => l.fanIds[0] === 'vrm');
    assert.exists(vrm);
    expect(vrm.channel).toBe(true);
    const lastPts = vrm.pts.at(-1);
    assert.exists(lastPts);
    assert.exists(vrm.pts[0]);
    expect(lastPts[0]).toBeLessThan(vrm.pts[0][0]);
    // what the lens draws for each: the tower cooler's fan is an edge-on slab (it blows along its fins), the sink's a rotor (it lies flat on its
    // bracket, blowing down into the fins), the card's are edge-on strips along its top
    const art = (id: string) => {
      const foundFanArt = m.fanArt.find((f) => f.id === id);
      assert.exists(foundFanArt);
      return foundFanArt;
    };
    const edge2 = art('cooler').edge;
    assert.exists(edge2);
    expect(edge2).toHaveLength(1);
    const rotor2 = art('vrm').rotor;
    assert.exists(rotor2);
    expect(rotor2.r).toBeGreaterThan(400);
    const cooler = local.find((l) => l.fanIds[0] === 'cooler');
    assert.exists(cooler); // the tower blows west through its fins, toward the rear exhaust
    expect(cooler.channel).toBe(true);
    const lastPts2 = cooler.pts.at(-1);
    assert.exists(lastPts2);
    assert.exists(cooler.pts[0]);
    expect(lastPts2[0]).toBeLessThan(cooler.pts[0][0]);
    const edge3 = art('gpu:pcie0').edge;
    assert.exists(edge3);
    expect(edge3.length).toBeGreaterThan(0);
    // the PSU draws air from under the case and blows it out the rear: its lane starts below the case, ends west of the rear wall
    const psu = local.find((l) => l.fanIds[0] === 'psu');
    assert.exists(psu);
    assert.exists(psu.pts[0]);
    expect(psu.pts[0][1]).toBeGreaterThan(must(psu.pts[Math.floor(psu.pts.length / 2)])[1]);
    const lastPts3 = psu.pts.at(-1);
    assert.exists(lastPts3);
    expect(lastPts3[0]).toBeLessThan(REAR_FAN.x);
  });

  it('the lens reads the room, the case air and the PSU, and every part that has a temperature carries it for the trend arrow', () => {
    const m = airflowModel(running(60, []));
    const tag = (id: string) => m.tags.find((t) => t.id === id);
    const gRoomTag = tag('g.room');
    assert.exists(gRoomTag);
    expect(gRoomTag.text).toContain('ROOM 25');
    const gRoomTag2 = tag('g.room');
    assert.exists(gRoomTag2);
    expect(gRoomTag2.tempC).toBeUndefined(); // the room does not move: no arrow
    const gCaseTag = tag('g.case');
    assert.exists(gCaseTag);
    expect(gCaseTag.tempC).toBeGreaterThanOrEqual(25);
    const gPsuTag = tag('g.psu');
    assert.exists(gPsuTag);
    expect(gPsuTag.tempC).toBeGreaterThan(25);
    for (const t of m.tags.filter((x) => x.id.startsWith('z.'))) {
      expect(t.tempC, `tag ${t.id}`).toBeTypeOf('number');
    }
  });

  it('a front radiator warms the air that comes in through it, by its coolant; a stopped loop does not', () => {
    expect(
      radLane({ coolantC: 55, rejectW: 90, side: 'front', flow: 1, hotC: 58, coldC: 52 }).intakeHeat,
    ).toBeGreaterThan(0.5);
    expect(
      radLane({ coolantC: 55, rejectW: 0, side: 'front', flow: 0, hotC: 55, coldC: 55 }).intakeHeat,
    ).toBeUndefined();
  });

  it("a part in an area the sim says is poorly ventilated is named on the lens, with the area's air; a well-ventilated one is not", () => {
    const poorIn = running(60, [], { board: boardSnap({ air: airOf(0.4) }) }),
      goodIn = running(60, [], { board: boardSnap({ air: airOf(1) }) });
    const poor = airflowModel(poorIn),
      good = airflowModel(goodIn);
    const poorCpu = must(poor.tags.find((t) => t.id === 'z.cpu'));
    expect(poorCpu).toMatchObject({ tone: 'warn' });
    expect(poorCpu.text).toContain('AIR 40%');
    const zVrmTag = poor.tags.find((t) => t.id === 'z.vrm');
    assert.exists(zVrmTag);
    expect(zVrmTag.text).toContain('AIR 40%'); // the regulators are in the north area
    const zCpuTag = good.tags.find((t) => t.id === 'z.cpu');
    assert.exists(zCpuTag);
    expect(zCpuTag.text).not.toContain('AIR');
  });

  it('a liquid loop names the radiator heat and the coolant, and says a front radiator warms the case', () => {
    const base = running(60, [], {
      board: boardSnap({ loop: { coolantC: 41, rejectW: 120, side: 'front', flow: 1, hotC: 46, coldC: 36 } }),
    });
    base.radiator = {
      side: 'front',
      ids: base.mounts.filter((m) => m.side === 'front').map((m) => m.id),
      rect: must(base.mounts.find((m) => m.side === 'front')).rect,
    };
    const tag = airflowModel(base).tags.find((t) => t.id === 'loop');
    expect(tag?.text).toContain('RAD 120 W');
    expect(tag?.text).toContain('COOLANT 41');
    expect(tag?.text).toContain('WARMS THE CASE');
    expect(airflowModel(running(60)).tags.find((t) => t.id === 'loop')).toBeUndefined();
  });

  it('the zones carry the air of their area from the sim into the field (flow and the cards warming it); a machine that is off carries none', () => {
    const air = airOf(0.4, 6);
    const m = airflowModel(running(60, [], { board: boardSnap({ air }) }));
    expect(m.zones.find((z) => z.id === 'cpu')).toMatchObject({ flow: 0.4, riseC: 6 });
    const off = airflowModel(running(60, [], { powered: false, board: boardSnap({ air }) }));
    const cpuZone = off.zones.find((z) => z.id === 'cpu');
    assert.exists(cpuZone);
    expect(cpuZone.flow).toBeUndefined();
  });

  it('a heat zone carries the hover id of each part, so the lens can trace its silhouette', () => {
    const m = airflowModel(running(60));
    const cpu = m.zones.find((z) => z.id === 'cpu');
    assert.exists(cpu);
    expect(cpu.ids).toStrictEqual(['cpu']);
    expect(idsOf(m.zones.find((z) => z.id === 'vrm'))).toStrictEqual([]); // the VRM phases are board art with no hit of their own: their rects
  });

  it('clipPath cuts a path at a length', () => {
    const p = clipPath(
      [
        [0, 0],
        [1000, 0],
        [1000, 1000],
      ],
      1500,
    );
    expect(p.at(-1)).toStrictEqual([1000, 500]);
    expect(
      clipPath(
        [
          [0, 0],
          [100, 0],
        ],
        500,
      ),
    ).toStrictEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it('every part kind with thermals has an air source (or sits outside the case): a new one must write its own', () => {
    const claimed = new Set(AIR_SOURCES.flatMap((s) => s.kinds));
    const withThermals = new Set(
      Object.values(DEVICE_SPECS)
        .filter((sp) => hasThermals(sp))
        .map((sp) => sp.kind),
    );
    expect(withThermals.size).toBeGreaterThan(5);
    for (const kind of withThermals) {
      expect(hasAir(claimed, kind), `no air source for '${kind}'`).toBe(true);
    }
  });

  it('an unplugged fan keeps its lane, dead, with no strength and a warning', () => {
    const m = airflowModel(running(40, ['fan:front0']));
    const l = m.lanes.find((x) => x.id === 'front0');
    assert.exists(l);
    expect(l).toMatchObject({ state: 'dead', strength: 0 });
    expect(m.tags.filter((t) => t.id === 'dead.front0').some((t) => t.tone === 'warn')).toBe(true);
  });

  it('the hub unplugged kills every case fan', () => {
    const m = airflowModel(running(40, ['sysfan']));
    expect(caseLanes(m).every((l) => l.state === 'dead')).toBe(true);
    expect(m.tags.some((t) => t.id === 'none')).toBe(true);
  });

  it('no fan blowing out is flagged', () => {
    const r = running();
    const m = airflowModel(
      running(
        40,
        fanMounts()
          .filter((x) => x.side !== 'front')
          .map((x) => `fan:${x.id}`),
      ),
    );
    expect(m.tags.some((t) => t.id === 'noexit')).toBe(true);
    expect(r.mounts.length).toBeGreaterThan(0);
  });

  it('a hot CPU makes a hot zone', () => {
    const cool = airflowModel(running(32)),
      hot = airflowModel(running(88));
    const zc = must(cool.zones.find((z) => z.id === 'cpu')),
      zh = must(hot.zones.find((z) => z.id === 'cpu'));
    expect(zh.heat).toBeGreaterThan(zc.heat);
  });

  it('a fan-less PSU (psu0, psu1) makes no stream of its own', () => {
    const i = running(40, [], {
      devices: [
        dev({ id: 'psu', kind: 'psu', spec: 'psu1', slot: 'atx0' }),
        dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' }),
      ],
    });
    const local = airflowModel(i).lanes.filter((l) => l.local === true);
    expect(local.map((l) => l.fanIds[0])).not.toContain('psu');
  });

  it('each fan is a port of the field: the front ones blow in at their edge, the rest draw out from their middle, a PSU channel keeps its own lane', () => {
    const i = running(40, [], {
      devices: [
        dev({ id: 'psu', kind: 'psu', spec: 'psu2', slot: 'atx0' }),
        dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' }),
      ],
    });
    const m = airflowModel(i);
    for (const l of caseLanes(m)) {
      expect(l.kind).toBe(kindFor(l.intake));
      expect(l.span.w * l.span.h).toBeGreaterThan(0);
    }
    expect(m.box).toStrictEqual(CASE_GLASS);
    const psu = m.lanes.find((l) => l.fanIds[0] === 'psu');
    assert.exists(psu);
    expect(psu.channel).toBe(true);
    expect(psu.kind).toBe('local');
    expect(m.lanes.filter((l) => l.channel === true)).toHaveLength(1);
  });

  it('the VRMs glow too: a zone per regulator, one shape per phase, hot against its own throttle point', () => {
    const i = running(40, [], { board: boardSnap({ vrm: { tempC: 80 } }) });
    const m = airflowModel(i);
    const v = must(m.zones.find((z) => z.id === 'vrm')),
      r = must(m.zones.find((z) => z.id === 'rvrm'));
    expect(v.rects).toHaveLength(i.s.board.vrm.phases);
    expect(r.rects).toHaveLength(i.s.board.ramVrm.phases);
    expect(v.heat).toBeGreaterThan(r.heat);
    expect(m.tags.some((t) => t.text.startsWith('VRM '))).toBe(true);
    expect(m.tags.some((t) => t.text.startsWith('MEM VRM '))).toBe(true);
    expect(airflowModel({ ...i, sources: [] }).zones).toHaveLength(0); // the lens knows no part by itself
  });

  it('a machine that is off moves no air', () => {
    const m = airflowModel(running(40, [], { powered: false }));
    expect(m.lanes.every((l) => l.state === 'idle')).toBe(true);
    expect(m.tags.some((t) => t.id === 'off')).toBe(true);
  });

  it('a radiator takes the fans of its side: one lane for it, its strength by the fans plugged', () => {
    const i = running(),
      front = i.mounts.filter((m) => m.side === 'front');
    const ids = front.map((m) => m.id);
    assert.exists(front[0]);
    const full = airflowModel({ ...i, radiator: { side: 'front', ids, rect: front[0].rect } });
    expect(full.lanes.some((l) => ids.includes(l.id))).toBe(false);
    const radFrontLane = full.lanes.find((l) => l.id === 'rad-front');
    assert.exists(radFrontLane);
    expect(radFrontLane.strength).toBeCloseTo(1);
    const half = running(40, [`fan:${ids[0]}`]);
    const h = airflowModel({ ...half, radiator: { side: 'front', ids, rect: front[0].rect } });
    const radFrontLane2 = h.lanes.find((l) => l.id === 'rad-front');
    assert.exists(radFrontLane2);
    expect(radFrontLane2.strength).toBeLessThan(1);
    // a mount of it with no fan counts as one that does not turn; with none at all the radiator's air stands still
    const noFan = airflowModel({
      ...i,
      s: { ...i.s, devices: i.s.devices.filter((d) => d.slot !== ids[0]) },
      radiator: { side: 'front', ids, rect: front[0].rect },
    });
    const radFrontLane3 = noFan.lanes.find((l) => l.id === 'rad-front');
    assert.exists(radFrontLane3);
    expect(radFrontLane3.strength).toBeLessThan(1);
    const bare = airflowModel({
      ...i,
      s: { ...i.s, devices: i.s.devices.filter((d) => !ids.includes(d.slot)) },
      radiator: { side: 'front', ids, rect: front[0].rect },
    });
    expect(bare.lanes.find((l) => l.id === 'rad-front')).toMatchObject({ state: 'dead', strength: 0 });
  });

  it('colours run blue to amber to red', () => {
    expect(airColor(0)).toBe('#6fd6ff');
    expect(airColor(0.5)).toBe('#ffb84a');
    expect(airColor(1)).toBe('#ff4538');
  });
});
