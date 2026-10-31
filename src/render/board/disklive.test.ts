import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { StorageSnap } from '../../sim/game/types';
import type { Theme } from '../theme';
import { DiskMotion } from './disklive';
import { diskPlan } from './diskfloor';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const snap = (o: Partial<StorageSnap> = {}) => ({ burnt: false, busy: false, bytesRead: 0, bytesWritten: 0, headLba: 0, queued: 0, queueDepth: 4, capacityBytes: 16384, ...o }) as StorageSnap;

describe('the motion of a drive', () => {
  it('rises when bytes move or a command runs, remembers the direction, and settles', () => {
    const m = new DiskMotion(1);
    m.note(snap());
    for (let i = 0; i < 20; i++) m.step(0.05);
    expect(m.act).toBe(0);
    m.note(snap({ bytesRead: 512 }));
    expect(m.dir).toBe(-1);
    for (let i = 0; i < 5; i++) m.step(0.05);
    expect(m.act).toBeGreaterThan(0.9);
    m.note(snap({ bytesRead: 512, bytesWritten: 4096 }));
    expect(m.dir).toBe(1);
    m.note(snap({ bytesRead: 512, bytesWritten: 4096 }));
    for (let i = 0; i < 200; i++) m.step(0.05);
    expect(m.act).toBe(0);
  });

  for (const kind of ['hdd', 'ssd-sata', 'ssd-nvme'] as const) {
    it(`${kind}: draws idle and busy, and a burnt drive stays dark`, () => {
      const plan = diskPlan(kind, 520, 344, 48), m = new DiskMotion(2), g = new Graphics(), a = new Graphics(), b = new Graphics();
      m.note(snap());
      m.note(snap({ bytesWritten: 256, busy: true, queued: 2, headLba: 100 }));
      for (let i = 0; i < 60; i++) { m.step(0.03); m.draw(g, a, b, T, kind, plan, snap({ busy: true, queued: 2, headLba: 100 }), 1); }
      expect(g.context.instructions.length).toBeGreaterThan(0);
      m.draw(g, a, b, T, kind, plan, snap({ burnt: true }), 0);
      expect(g.context.instructions.length).toBe(0);
    });
  }
});
