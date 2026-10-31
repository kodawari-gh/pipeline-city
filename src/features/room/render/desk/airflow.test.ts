import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the airflow model is pure data.
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));

import type { Snapshot } from '@/worker/protocol';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import type { Rect } from '@/features/board/render/layout/layout';
import { airColor, airSpeed, airflowModel, laneHeat, type AirIn, type AirMount } from './airflow';
import { CASE_GLASS, PSU, REAR_FAN, REAR_FAN_FITTED, setLayoutTier } from '@/features/board/render/layout/layout';
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
  return { s, mounts, radiator: null, rearFitted: REAR_FAN_FITTED, rear: REAR_FAN, glass: CASE_GLASS, slots, psu: PSU };
}

describe('the airflow lens model', () => {
  it('one lane per fan, the front ones taking air in and the rest blowing it out', () => {
    const m = airflowModel(running());
    const mounts = fanMounts();
    expect(m.lanes.length).toBe(mounts.length);
    for (const l of m.lanes) expect(l.intake).toBe(l.id.startsWith('front'));
    expect(m.lanes.every((l) => l.state === 'on')).toBe(true);
  });

  it('an unplugged fan keeps its lane, dead, with no strength and a warning', () => {
    const m = airflowModel(running(40, ['fan:front0']));
    const l = m.lanes.find((x) => x.id === 'front0')!;
    expect(l).toMatchObject({ state: 'dead', strength: 0 });
    expect(m.tags.some((t) => t.id === 'dead.front0' && t.tone === 'warn')).toBe(true);
  });

  it('the hub unplugged kills every case fan', () => {
    const m = airflowModel(running(40, ['sysfan']));
    expect(m.lanes.every((l) => l.state === 'dead')).toBe(true);
    expect(m.tags.some((t) => t.id === 'none')).toBe(true);
  });

  it('no fan blowing out is flagged', () => {
    const r = running();
    const m = airflowModel(running(40, fanMounts().filter((x) => x.side !== 'front').map((x) => `fan:${x.id}`)));
    expect(m.tags.some((t) => t.id === 'noexit')).toBe(true);
    expect(r.mounts.length).toBeGreaterThan(0);
  });

  it('a hot CPU makes a hot zone, and the air that passes it carries the heat downstream', () => {
    const cool = airflowModel(running(32)), hot = airflowModel(running(88));
    const zc = cool.zones.find((z) => z.id === 'cpu')!, zh = hot.zones.find((z) => z.id === 'cpu')!;
    expect(zh.heat).toBeGreaterThan(zc.heat);
    const gain = (m: typeof hot) => Math.max(...m.lanes.map((l) => laneHeat(l, 1)));
    expect(gain(hot)).toBeGreaterThan(gain(cool));
    for (const l of hot.lanes) expect(laneHeat(l, 0)).toBeLessThanOrEqual(laneHeat(l, 1));
  });

  it('the VRMs glow too: a zone per regulator, one shape per phase, hot against its own throttle point', () => {
    const i = running(40, [], { board: boardSnap({ vrm: { tempC: 80 } }) });
    const phase = (n: number): Rect[] => Array.from({ length: n }, (_, k) => ({ x: k * 300, y: 0, w: 250, h: 400 }));
    const m = airflowModel({ ...i, vrmShapes: phase(4), ramVrmShapes: phase(2) });
    const v = m.zones.find((z) => z.id === 'vrm')!, r = m.zones.find((z) => z.id === 'rvrm')!;
    expect(v.rects).toHaveLength(4);
    expect(r.rects).toHaveLength(2);
    expect(v.heat).toBeGreaterThan(r.heat);
    expect(m.tags.some((t) => t.text.startsWith('VRM '))).toBe(true);
    expect(m.tags.some((t) => t.text.startsWith('MEM VRM '))).toBe(true);
    expect(airflowModel({ ...i }).zones.some((z) => z.id === 'vrm')).toBe(false);
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
