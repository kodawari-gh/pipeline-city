import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { StorageCmd } from '../../sim/machine/storage';
import type { Theme } from '../theme';
import { DiskPlay } from './diskplay';
import { diskPlan } from './diskfloor';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const cmd = (o: Partial<StorageCmd> = {}): StorageCmd => ({ seq: 1, op: 'r', lba: 100, seek: 0, xfer: 4, queued: 0, ...o });

describe('the drive at work', () => {
  for (const kind of ['hdd', 'ssd-sata', 'ssd-nvme'] as const) {
    it(`${kind}: nothing is drawn while idle, a command draws and says what it does, then it is idle again`, () => {
      const plan = diskPlan(kind, 600, 340, 48), p = new DiskPlay(), g = new Graphics(), t = new Graphics(), k = new Graphics();
      p.ingest(kind, plan, [], 512, 0);
      p.frame(16, T, kind, plan, g, t, k);
      expect(g.context.instructions.length + k.context.instructions.length).toBe(0);
      expect(p.label()).toBe('');
      p.ingest(kind, plan, [cmd({ seq: 1, seek: kind === 'hdd' ? 200 : 0, lba: 300 })], 512, 0);
      const labels = new Set<string>();
      let drew = false;
      for (let i = 0; i < 300; i++) {
        p.frame(20, T, kind, plan, g, t, k);
        if (p.label()) labels.add(p.label());
        if (g.context.instructions.length > 0 && k.context.instructions.length > 0) drew = true;
      }
      expect(drew).toBe(true);
      expect(labels.size).toBeGreaterThanOrEqual(5);
      expect([...labels][0]).toContain('READ #300');
      expect(p.label()).toBe('');
      expect(p.busy).toBe(false);
    });
  }

  it('the arm of a hard disk is on the new track after a long seek', () => {
    const plan = diskPlan('hdd', 600, 340, 48), p = new DiskPlay(), g = new Graphics();
    p.ingest('hdd', plan, [], 512, 0);
    p.ingest('hdd', plan, [cmd({ lba: 500, seek: 250, xfer: 70 })], 512, 0);
    expect(p.track).toBe(0);
    for (let i = 0; i < 300; i++) p.frame(20, T, 'hdd', plan, g, new Graphics(), new Graphics());
    expect(p.track).toBeGreaterThan(plan.platter!.tracks - 2);
  });
});
