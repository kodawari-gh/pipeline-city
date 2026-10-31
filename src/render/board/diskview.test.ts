import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in gpuview.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => Object.assign(new Container(), { text: '', style: {} }) }));

import type { StorageSnap } from '../../sim/game/types';
import type { Theme } from '../theme';
import { DiskView } from './diskview';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const body = { x: 100, y: 200, w: 520, h: 344 };
const snap = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'd1', slot: 'sata0', spec: 'ssd1', name: 'SSD', burnt: false, capacityBytes: 16 * 1024, usedBytes: 4096, bytesRead: 0, bytesWritten: 0, busy: false,
  latencyTicks: 10, blockTicks: 2, bytesPerSecond: 1000, hasOs: true,
  fs: { runs: [{ start: 0, len: 16, kind: 'os', file: 1, filled: true }, { start: 16, len: 48, kind: 'free', file: 0, filled: false }], fragmentation: 0, byKind: { os: 16, spool: 0, program: 0, dataset: 0, meta: 0 }, files: [{ id: 1, owner: 'os', kind: 'os', lost: false }] },
  wear: [], headLba: 0, wearPct: 0, badGroups: 0, lostBlocks: 0, queueDepth: 4, queued: 0, mirror: false,
  mount: { state: 'clean', phase: 'mounted', progress: 1 }, format: null,
  ...o,
} as StorageSnap);
// centred on the drive, so it is read at the full zoom
const view = { x: -640, y: -228, w: 2000, h: 1200 };

describe('the drive view', () => {
  it('builds a node per drive and hides with the exterior', () => {
    const v = new DiskView();
    expect(v.root.visible).toBe(false);
    v.setScene(T, [{ slot: 'sata0', deviceId: 'd1', kind: 'ssd-sata', body }]);
    expect(v.root.visible).toBe(true);
    expect((v.root.children[0] as Container).position.x).toBe(100);
    v.frame(0.016, false);
    expect(v.root.visible).toBe(false);
  });

  it('shows the fill bar zoomed out, the cutaway zoomed in, and the architecture deeper', () => {
    const v = new DiskView();
    v.setScene(T, [{ slot: 'sata0', deviceId: 'd1', kind: 'ssd-sata', body }]);
    v.update([snap()]);
    const [, bar, cut] = (v.root.children[0] as Container).children as [Container, Container, Container];
    const arch = cut.children[2] as Container;
    const lod = { view, top: new Set<string>() };
    v.setZoom(0.1);
    v.frame(0.016, true, false, lod);
    expect(bar.visible).toBe(true);
    expect(cut.visible).toBe(false);
    v.setZoom(0.45);
    v.frame(0.016, true, false, lod);
    expect(cut.visible).toBe(true);
    expect(arch.alpha).toBeCloseTo(0, 1);
    v.setZoom(1.5);
    v.frame(0.016, true, false, lod);
    expect(arch.alpha).toBeGreaterThan(0.9);
  });

  it('a drive out of view is not drawn and wants no counters', () => {
    const v = new DiskView();
    v.setScene(T, [{ slot: 'sata0', deviceId: 'd1', kind: 'ssd-sata', body }]);
    v.update([snap()]);
    v.setZoom(3);
    const away = { x: 50000, y: 50000, w: 2000, h: 1200 };
    v.frame(0.016, true, false, { view: away, top: new Set<string>() });
    expect((v.root.children[0] as Container).visible).toBe(false);
    expect(v.candidates(away)).toHaveLength(0);
    expect(v.candidates(view).length).toBe(1);
  });

  it('runs for every tier and for a burnt or unmounted drive without error', () => {
    const v = new DiskView();
    v.setScene(T, [
      { slot: 'sata0', deviceId: 'd1', kind: 'hdd', body: { x: 0, y: 0, w: 640, h: 444 } },
      { slot: 'sata1', deviceId: 'd2', kind: 'ssd-sata', body: { x: 700, y: 0, w: 520, h: 344 } },
      { slot: 'm20', deviceId: 'd3', kind: 'ssd-nvme', body: { x: 1300, y: 0, w: 700, h: 300 } },
    ]);
    v.update([
      snap({ deviceId: 'd1', busy: true, headLba: 40, queued: 1 }),
      snap({ deviceId: 'd2', burnt: true }),
      snap({ deviceId: 'd3', mount: { state: 'clean', phase: 'unmounted', progress: 0 }, wear: [10, 50, 100], badGroups: 1, queued: 2, busy: true }),
    ]);
    v.setZoom(3);
    const lod = { view, top: new Set(['disk:sata0', 'disk:sata1', 'disk:m20']) };
    expect(() => { for (let i = 0; i < 40; i++) v.frame(0.05, true, false, lod); }).not.toThrow();
  });
});
