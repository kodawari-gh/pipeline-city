import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the airflow model is pure data.
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));

import type { Snapshot } from '@/worker/protocol';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { airColor, airSpeed, airflowModel, clipPath, laneHeat, type AirIn, type AirMount } from './airflow';
import { AIR_SOURCES, OUTSIDE_THE_CASE } from './airsources';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { CASE_GLASS, REAR_FAN, REAR_FAN_FITTED, setLayoutTier } from '@/features/board/render/layout/layout';
import { fanMounts } from '@/features/room/render/desk/props/case';
import { emptyScene } from '@/core/render/interact';

/** A running Mid tower: a CPU at `cpuC`, fans cabled as `plugged` says (default: all). */
function running(cpuC = 40, unplug: string[] = [], over: Partial<Snapshot> = {}): AirIn {
  setLayoutTier(2, 2);
  const mounts: AirMount[] = fanMounts();
  const ids = ['sysfan', ...mounts.map((m) => `fan:${m.id}`)];
  const s = snap({
    powered: true, power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false },
    devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0', powerW: 0 }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13, tempC: cpuC })],
    cables: ids.map((id) => ({ id, name: id, connected: !unplug.includes(id) })) as Snapshot['cables'],
    ...over,
  });
  const slots = emptyScene().slots;
  slots.set('cpu0', { x: CASE_GLASS.x + CASE_GLASS.w * 0.4, y: CASE_GLASS.y + CASE_GLASS.h * 0.4, w: 500, h: 500 });
  return { s, mounts, radiator: null, rearFitted: REAR_FAN_FITTED, rear: REAR_FAN, glass: CASE_GLASS, slots, sources: AIR_SOURCES };
}
const caseLanes = (m: ReturnType<typeof airflowModel>) => m.lanes.filter((l) => !l.local);

describe('the airflow lens model', () => {
  it('one lane per case fan, the front ones taking air in and the rest blowing it out', () => {
    const m = airflowModel(running());
    const mounts = fanMounts();
    expect(caseLanes(m).length).toBe(mounts.length);
    for (const l of caseLanes(m)) expect(l.intake).toBe(l.id.startsWith('front'));
    expect(caseLanes(m).every((l) => l.state === 'on')).toBe(true);
    expect(caseLanes(m).every((l) => l.fanIds.length === 1 && l.fanIds[0]!.startsWith('case:'))).toBe(true);
  });

  it('the components bring their own fans: a stream for a cooler, a card, a sink and the PSU, tied to the fan id the view spins', () => {
    const i = running(40, [], { devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0' }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' }), dev({ id: 'cool', kind: 'cooler', spec: 'cooler1', slot: 'cooler0' }),
      dev({ id: 'gpu', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 }), dev({ id: 'vs', kind: 'vrm-sink', spec: 'vsink2', slot: 'vrm-sink0' }), dev({ id: 'vs2', kind: 'ram-sink', spec: 'rsink0', slot: 'ram-sink0' })] });
    i.slots.set('pcie0', { x: CASE_GLASS.x + 3000, y: CASE_GLASS.y + 1500, w: 3000, h: 900 });
    const m = airflowModel(i), local = m.lanes.filter((l) => l.local);
    // a passive sink (rsink0) has no fan; the fan sink, the cooler, the card and the PSU do
    expect(local.map((l) => l.fanIds[0]).sort()).toEqual(['cooler', 'gpu:pcie0', 'psu', 'vrm']);
    for (const l of local) expect(l.pts.length).toBeGreaterThan(1);
    expect(m.tags.some((t) => t.text.startsWith('GPU '))).toBe(true);
    const len = (l: (typeof local)[number]) => l.pts.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - l.pts[k]![0], p[1] - l.pts[k]![1]), 0);
    for (const l of local.filter((x) => x.fanIds[0] !== 'psu' && x.fanIds[0] !== 'vrm' && x.fanIds[0] !== 'cooler')) expect(len(l)).toBeLessThanOrEqual(1950);
    // a heatsink fan blows along its fins toward the rear exhaust: a stream of its own that runs west, from the fan to the rear wall
    const vrm = local.find((l) => l.fanIds[0] === 'vrm')!;
    expect(vrm.channel).toBe(true);
    expect(vrm.pts[vrm.pts.length - 1]![0]).toBeLessThan(vrm.pts[0]![0]);
    // what the lens draws for each: the tower cooler's fan and the sink's are edge-on slabs (they blow along their fins), the card's are edge-on strips along its top
    const art = (id: string) => m.fanArt.find((f) => f.id === id)!;
    expect(art('cooler').edge!.length).toBe(1);
    expect(art('vrm').edge!.length).toBe(1);
    const cooler = local.find((l) => l.fanIds[0] === 'cooler')!; // the tower blows west through its fins, toward the rear exhaust
    expect(cooler.channel).toBe(true);
    expect(cooler.pts[cooler.pts.length - 1]![0]).toBeLessThan(cooler.pts[0]![0]);
    expect(art('gpu:pcie0').edge!.length).toBeGreaterThan(0);
    // the PSU draws air from under the case and blows it out the rear: its lane starts below the case, ends west of the rear wall
    const psu = local.find((l) => l.fanIds[0] === 'psu')!;
    expect(psu.pts[0]![1]).toBeGreaterThan(psu.pts[Math.floor(psu.pts.length / 2)]![1]);
    expect(psu.pts[psu.pts.length - 1]![0]).toBeLessThan(REAR_FAN.x);
  });

  it('the lens reads the room, the case air and the PSU, and every part that has a temperature carries it for the trend arrow', () => {
    const m = airflowModel(running(60, []));
    const tag = (id: string) => m.tags.find((t) => t.id === id);
    expect(tag('g.room')!.text).toContain('ROOM 25');
    expect(tag('g.room')!.tempC).toBeUndefined(); // the room does not move: no arrow
    expect(tag('g.case')!.tempC).toBeGreaterThanOrEqual(25);
    expect(tag('g.psu')!.tempC).toBeGreaterThan(25);
    for (const t of m.tags.filter((x) => x.id.startsWith('z.'))) expect(t.tempC, t.id).toBeTypeOf('number');
  });

  it('a front radiator warms the air that comes in through it, by its coolant; a stopped loop does not', () => {
    const model = (loop: NonNullable<ReturnType<typeof boardSnap>['loop']>) => {
      const i = running(60, [], { board: boardSnap({ loop }) }), front = i.mounts.filter((m) => m.side === 'front');
      return airflowModel({ ...i, radiator: { side: 'front', ids: front.map((m) => m.id), rect: front[0]!.rect } }).lanes.find((l) => l.id === 'rad-front')!;
    };
    expect(model({ coolantC: 55, rejectW: 90, side: 'front', flow: 1, hotC: 58, coldC: 52 }).intakeHeat).toBeGreaterThan(0.5);
    expect(model({ coolantC: 55, rejectW: 0, side: 'front', flow: 0, hotC: 55, coldC: 55 }).intakeHeat).toBeUndefined();
  });

  it('a part in an area the sim says is poorly ventilated is named on the lens, with the area\'s air; a well-ventilated one is not', () => {
    const air = (flow: number) => ['north', 'cards', 'bay'].map((id) => ({ id, flow, fans: 3, riseC: 0 }));
    const poor = airflowModel(running(60, [], { board: boardSnap({ air: air(0.4) as never }) })), good = airflowModel(running(60, [], { board: boardSnap({ air: air(1) as never }) }));
    expect(poor.tags.find((t) => t.id === 'z.cpu')).toMatchObject({ text: expect.stringContaining('AIR 40%'), tone: 'warn' });
    expect(poor.tags.find((t) => t.id === 'z.vrm')!.text).toContain('AIR 40%'); // the regulators are in the north area
    expect(good.tags.find((t) => t.id === 'z.cpu')!.text).not.toContain('AIR');
  });

  it('a liquid loop names the radiator heat and the coolant, and says a front radiator warms the case', () => {
    const base = running(60, [], { board: boardSnap({ loop: { coolantC: 41, rejectW: 120, side: 'front', flow: 1, hotC: 46, coldC: 36 } }) });
    base.radiator = { side: 'front', ids: base.mounts.filter((m) => m.side === 'front').map((m) => m.id), rect: base.mounts.find((m) => m.side === 'front')!.rect };
    const tag = airflowModel(base).tags.find((t) => t.id === 'loop');
    expect(tag?.text).toContain('RAD 120 W');
    expect(tag?.text).toContain('COOLANT 41');
    expect(tag?.text).toContain('WARMS THE CASE');
    expect(airflowModel(running(60)).tags.find((t) => t.id === 'loop')).toBeUndefined();
  });

  it('the zones carry the air of their area from the sim into the field (flow and the cards warming it); a machine that is off carries none', () => {
    const air = ['north', 'cards', 'bay'].map((id) => ({ id, flow: 0.4, fans: 3, riseC: 6 }));
    const m = airflowModel(running(60, [], { board: boardSnap({ air: air as never }) }));
    expect(m.zones.find((z) => z.id === 'cpu')).toMatchObject({ flow: 0.4, riseC: 6 });
    const off = airflowModel(running(60, [], { powered: false, board: boardSnap({ air: air as never }) }));
    expect(off.zones.find((z) => z.id === 'cpu')!.flow).toBeUndefined();
  });

  it('a heat zone carries the hover id of each part, so the lens can trace its silhouette', () => {
    const m = airflowModel(running(60));
    const cpu = m.zones.find((z) => z.id === 'cpu')!;
    expect(cpu.ids).toEqual(['cpu']);
    expect(m.zones.find((z) => z.id === 'vrm')?.ids ?? []).toEqual([]); // the VRM phases are board art with no hit of their own: their rects
  });

  it('clipPath cuts a path at a length', () => {
    const p = clipPath([[0, 0], [1000, 0], [1000, 1000]], 1500);
    expect(p[p.length - 1]).toEqual([1000, 500]);
    expect(clipPath([[0, 0], [100, 0]], 500)).toEqual([[0, 0], [100, 0]]);
  });

  it('every part kind with thermals has an air source (or sits outside the case): a new one must write its own', () => {
    const claimed = new Set(AIR_SOURCES.flatMap((s) => s.kinds));
    const withThermals = new Set(Object.values(DEVICE_SPECS).filter((sp) => 'thermal' in sp && sp.thermal).map((sp) => sp.kind));
    expect(withThermals.size).toBeGreaterThan(5);
    for (const kind of withThermals) expect(claimed.has(kind) || OUTSIDE_THE_CASE.includes(kind), `no air source for '${kind}'`).toBe(true);
  });

  it('an unplugged fan keeps its lane, dead, with no strength and a warning', () => {
    const m = airflowModel(running(40, ['fan:front0']));
    const l = m.lanes.find((x) => x.id === 'front0')!;
    expect(l).toMatchObject({ state: 'dead', strength: 0 });
    expect(m.tags.some((t) => t.id === 'dead.front0' && t.tone === 'warn')).toBe(true);
  });

  it('the hub unplugged kills every case fan', () => {
    const m = airflowModel(running(40, ['sysfan']));
    expect(caseLanes(m).every((l) => l.state === 'dead')).toBe(true);
    expect(m.tags.some((t) => t.id === 'none')).toBe(true);
  });

  it('no fan blowing out is flagged', () => {
    const r = running();
    const m = airflowModel(running(40, fanMounts().filter((x) => x.side !== 'front').map((x) => `fan:${x.id}`)));
    expect(m.tags.some((t) => t.id === 'noexit')).toBe(true);
    expect(r.mounts.length).toBeGreaterThan(0);
  });

  it('a hot CPU makes a hot zone (the air that passes it takes the heat up in the field: airfield.test.ts)', () => {
    const cool = airflowModel(running(32)), hot = airflowModel(running(88));
    const zc = cool.zones.find((z) => z.id === 'cpu')!, zh = hot.zones.find((z) => z.id === 'cpu')!;
    expect(zh.heat).toBeGreaterThan(zc.heat);
  });

  it('each fan is a port of the field: the front ones blow in at their edge, the rest draw out from their middle, a PSU channel keeps its own lane', () => {
    const i = running(40, [], { devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0' }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0' })] });
    const m = airflowModel(i);
    for (const l of caseLanes(m)) {
      expect(l.kind).toBe(l.intake ? 'in' : 'out');
      expect(l.span.w * l.span.h).toBeGreaterThan(0);
    }
    expect(m.box).toEqual(CASE_GLASS);
    const psu = m.lanes.find((l) => l.fanIds[0] === 'psu')!;
    expect(psu.channel).toBe(true);
    expect(psu.kind).toBe('local');
    expect(m.lanes.filter((l) => l.channel)).toHaveLength(1);
  });

  it('the VRMs glow too: a zone per regulator, one shape per phase, hot against its own throttle point', () => {
    const i = running(40, [], { board: boardSnap({ vrm: { tempC: 80 } }) });
    const m = airflowModel(i);
    const v = m.zones.find((z) => z.id === 'vrm')!, r = m.zones.find((z) => z.id === 'rvrm')!;
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
    const i = running(), front = i.mounts.filter((m) => m.side === 'front');
    const ids = front.map((m) => m.id);
    const full = airflowModel({ ...i, radiator: { side: 'front', ids, rect: front[0]!.rect } });
    expect(full.lanes.some((l) => ids.includes(l.id))).toBe(false);
    expect(full.lanes.find((l) => l.id === 'rad-front')!.strength).toBeCloseTo(1);
    const half = running(40, [`fan:${ids[0]}`]);
    const h = airflowModel({ ...half, radiator: { side: 'front', ids, rect: front[0]!.rect } });
    expect(h.lanes.find((l) => l.id === 'rad-front')!.strength).toBeLessThan(1);
  });

  it('colours run blue to amber to red, and more airflow moves faster', () => {
    expect(airColor(0)).toBe('#6fd6ff');
    expect(airColor(0.5)).toBe('#ffb84a');
    expect(airColor(1)).toBe('#ff4538');
    expect(airSpeed(1)).toBeGreaterThan(airSpeed(0.3));
  });
});
