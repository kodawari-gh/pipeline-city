import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the lens model is pure data.
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));

import type { Snapshot } from '@/worker/protocol';
import { dev, snap } from '@/core/ui/testdata';
import { flowSpeed, flowWidth, lensModel, type LensCord, type LensIn } from './lens';
import { PSU, setLayoutTier } from '../../board/render/layout';
import { buildCables } from '../../board/render/routes';
import { emptyScene } from '@/core/render/interact';

const cord = (kind: LensCord['kind'], connected: boolean): LensCord => ({ kind, connected, plugAt: connected ? [1000, 9000] : [1400, 11000], route: [[0, 0], [100, 100], [1000, 8000]], outlet: [1000, 9000] });

/** A running machine: PSU, CPU, RAM, a SATA drive and a monitor, 54 W on the PSU. */
function running(over: Partial<Snapshot> = {}, cordsOn = { pc: true, mon: true }): LensIn {
  setLayoutTier(2, 2);
  const s = snap({
    powered: true, phase: 'idle-os' as never, power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false }, energy: { wallW: 54, wh: 1 },
    devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0', powerW: 0 }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13 }), dev({ id: 'ram', kind: 'ram', slot: 'dimm0', powerW: 4 }),
      dev({ id: 'hdd', kind: 'storage', slot: 'sata0', powerW: 5 }), dev({ id: 'mon', kind: 'display', slot: 'display0', powerW: 1.2 })],
    storage: [{ deviceId: 'hdd', slot: 'sata0' } as never],
    cables: [
      { id: 'atx', name: 'ATX', connected: true }, { id: 'cpu', name: 'CPU', connected: true }, { id: 'video', name: 'Video', connected: true },
      { id: 'pcmains', name: 'PC cord', connected: cordsOn.pc }, { id: 'monmains', name: 'Monitor cord', connected: cordsOn.mon },
    ] as Snapshot['cables'],
    ...over,
  });
  const slots = emptyScene().slots;
  slots.set('cpu0', { x: 0, y: 0, w: 500, h: 500 }); slots.set('dimm0', { x: 800, y: 0, w: 100, h: 600 });
  return { s, cords: [cord('pcmains', cordsOn.pc), cord('monmains', cordsOn.mon)], cables: buildCables(), slots, monitor: { x: -9000, y: 2000, w: 6000, h: 4000 } };
}

const flow = (m: ReturnType<typeof lensModel>, id: string) => m.flows.find((f) => f.id === id);

describe('the power lens model', () => {
  it('a running machine: the PC cord carries what the machine takes less the monitor, the monitor cord the monitor, and the cables split the rest', () => {
    const m = lensModel(running());
    expect(flow(m, 'pcmains')).toMatchObject({ state: 'on', watts: 54 - 1.2 });
    expect(flow(m, 'monmains')).toMatchObject({ state: 'on', watts: 1.2 });
    expect(flow(m, 'cpu')!.watts).toBe(13);
    expect(flow(m, 'sata')!.watts).toBe(5);
    const w = (id: string) => flow(m, id)!.watts;
    expect(w('atx') + w('cpu') + w('sata')).toBeCloseTo(w('pcmains'), 6); // what the wall gives the PC is what the cables hand on
  });

  it('the PC cord runs wall to machine: it ends in the PSU bay', () => {
    const f = flow(lensModel(running()), 'pcmains')!;
    expect(f.pts[0]).toEqual([1000, 8000]); // the plug end first
    expect(f.pts[f.pts.length - 1]![0]).toBeGreaterThanOrEqual(PSU.x);
  });

  it('a cord that is out is missing: a red flow, a ring on the plug and a warning', () => {
    const m = lensModel(running({}, { pc: false, mon: true }));
    expect(flow(m, 'pcmains')).toMatchObject({ state: 'missing', watts: 0 });
    expect(flow(m, 'monmains')!.state).toBe('on');
    expect(m.marks.find((k) => k.id === 'pcmains')).toMatchObject({ tone: 'warn' });
    expect(m.tags.some((t) => t.tone === 'warn' && /PC/.test(t.text))).toBe(true);
    expect(m.marks.find((k) => k.id === 'monmains')).toMatchObject({ tone: 'ok' });
  });

  it('a PSU cable that is out is missing too, with a warning at its connector', () => {
    const base = running();
    const s = { ...base.s, cables: base.s.cables.map((c) => (c.id === 'atx' ? { ...c, connected: false } : c)) } as Snapshot;
    const m = lensModel({ ...base, s });
    expect(flow(m, 'atx')!.state).toBe('missing');
    expect(m.tags.some((t) => t.text === 'NO MAIN POWER')).toBe(true);
  });

  it('a machine that is off carries nothing: every linked run idles', () => {
    const base = running();
    const m = lensModel({ ...base, s: { ...base.s, powered: false, power: { ...base.s.power, off: true } } });
    expect(m.flows.every((f) => f.watts === 0 && f.state !== 'on')).toBe(true);
    expect(flow(m, 'pcmains')!.state).toBe('idle');
  });

  it('shows the wall total, the PSU load and each part kind once', () => {
    const t = lensModel(running()).tags.map((x) => x.text);
    expect(t).toContain('WALL 54 W');
    expect(t.some((x) => x.startsWith('LOAD 54 W / 250 W'))).toBe(true);
    expect(t).toContain('CPU 13 W');
    expect(t).toContain('RAM 4.0 W');
  });

  it('more watts: a thicker line and faster dots', () => {
    expect(flowWidth(100)).toBeGreaterThan(flowWidth(4));
    expect(flowSpeed(100)).toBeGreaterThan(flowSpeed(4));
    expect(flowWidth(100, true)).toBeLessThan(flowWidth(100));
  });
});
