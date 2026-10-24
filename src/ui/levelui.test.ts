import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../sim/game/game';
import { levelRows } from '../sim/game/levels';
import { canShowBanner, celebrationFor, hasArt, isNextLevelLock, levelBar, lockBadge, lockTooltip, milestoneRows, reconcileSeen, toastRoom, unlockedFirst } from './levelui';
import { pickerFor } from './picker';
import { boardCards } from './vrm';
import { snap } from './testdata';

const at = (o: Partial<Snapshot['level']>): Snapshot => {
  const base = snap();
  return snap({ level: { ...base.level, ...o } });
};

describe('level bar', () => {
  it('shows the level, the fraction to the next threshold and the fill', () => {
    const m = levelBar(at({ level: 2, name: 'Hobby Shop', clientBase: 6.4, floor: 4, next: 12, progress: 0.3 }));
    expect(m.level).toBe(2);
    expect(m.label).toBe('6 / 12');
    expect(m.pct).toBeCloseTo(30);
    expect(m.atMax).toBe(false);
    expect(m.tooltip).toContain('Client base is how many clients trust you');
    expect(m.tooltip).toContain('Client base 6 of 12 for level 3');
  });

  it('clamps the fill and names what the next level unlocks', () => {
    const m = levelBar(at({ progress: 1.4 }));
    expect(m.pct).toBe(100);
    expect(m.tooltip).toContain('Next level unlocks:');
    expect(m.tooltip).toContain(levelRows()[1]!.unlocks[0]!.name);
  });

  it('at the last level the bar is full and shows the raw score', () => {
    const m = levelBar(at({ level: 18, name: 'Metropolis', clientBase: 1402.7, floor: 1350, next: null, progress: 1 }));
    expect(m.atMax).toBe(true);
    expect(m.pct).toBe(100);
    expect(m.label).toBe('1402');
    expect(m.tooltip).toContain('top level');
    expect(m.tooltip).not.toContain('Next level unlocks');
  });

  it('in the sandbox it is a rules-level chip with no progress', () => {
    const m = levelBar(at({ sandbox: true, level: 7, name: 'District' }));
    expect(m.sandbox).toBe(true);
    expect(m.label).toBe('rules level 7');
    expect(m.pct).toBe(0);
  });
});

describe('milestone list', () => {
  const s = at({ level: 3, name: 'Local Gigs', progress: 0.5 });
  const rows = milestoneRows(s);

  it('has all 18 levels in order with passed, current and upcoming', () => {
    expect(rows.map((r) => r.level)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(rows.filter((r) => r.status === 'passed').map((r) => r.level)).toEqual([1, 2]);
    expect(rows.filter((r) => r.status === 'current').map((r) => r.level)).toEqual([3]);
    expect(rows[3]!.status).toBe('upcoming');
  });

  it('only the current row carries progress', () => {
    expect(rows[2]!.progress).toBe(0.5);
    expect(rows[3]!.progress).toBe(0);
  });

  it('lists what each level unlocks, with art only for real parts', () => {
    const l10 = rows[9]!;
    expect(l10.unlocks.map((u) => u.id)).toContain('gpu1');
    const router = l10.unlocks.find((u) => u.id === 'gpu1')!;
    expect(router.planned).toBe(true);
    expect(hasArt(router.id, router.kind, router.planned)).toBe(false);
    expect(router.icon).toBe('screen');
    const cpu = rows[0]!.unlocks.find((u) => u.id === 'cpu1')!;
    expect(hasArt(cpu.id, cpu.kind, cpu.planned)).toBe(true);
    expect(hasArt('board1', 'board', false)).toBe(true);
  });

  it('names the job classes that arrive at a level and compares with the level before', () => {
    expect(rows[2]!.newJobs.map((j) => j.id)).toEqual(['db']);
    expect(rows[3]!.newJobs.map((j) => j.label)).toEqual(['Web']);
    expect(rows[0]!.patience).toBeNull();
    expect(rows[1]!.patience).toBe('same');
    expect(rows[2]!.patience).toBe('stricter');
    expect(rows[2]!.pay).toBe('bigger');
    expect(rows[2]!.waitS).toBe(540);
  });
});

describe('locked items', () => {
  const lock = { level: 4, name: 'Small Office' };

  it('the level reason comes first, then the hardware and money reasons', () => {
    const t = lockTooltip(lock, { blocked: 'needs a 100 W power supply', priceShort: 50 });
    expect(t.indexOf('Unlocks at Level 4, Small Office')).toBe(0);
    expect(t.indexOf('needs a 100 W power supply')).toBeGreaterThan(t.indexOf('Level 4'));
    expect(t).toContain('more money');
    expect(lockTooltip(lock)).not.toContain('Then:');
    expect(lockBadge(lock)).toBe('Level 4');
  });

  it('outlines only what the very next level opens', () => {
    expect(isNextLevelLock(lock, 3)).toBe(true);
    expect(isNextLevelLock(lock, 2)).toBe(false);
    expect(isNextLevelLock(undefined, 3)).toBe(false);
  });

  it('shelf order: open items first, then the gated ones by level, stably', () => {
    const items = [
      { id: 'a', lock: { level: 8, name: 'x' } }, { id: 'b' }, { id: 'c', lock: { level: 3, name: 'x' } },
      { id: 'd' }, { id: 'e', lock: { level: 3, name: 'x' } },
    ];
    expect(unlockedFirst(items, (i) => i.lock).map((i) => i.id)).toEqual(['b', 'd', 'c', 'e', 'a']);
  });

  it('a gated purchase is a visible "level" rung with the lock, before money and hardware reasons', () => {
    const s = snap({
      purchases: [
        { id: 'cpu1', name: 'Tiny-5', kind: 'cpu', price: 200, affordable: false, blocked: 'needs a 100 W power supply', locked: lock },
        { id: 'cpu2', name: 'Tiny-5F', kind: 'cpu', price: 800, affordable: false, locked: { level: 6, name: 'Neighbourhood' } },
      ],
    });
    const m = pickerFor('cpu1', s)!;
    const r1 = m.ladder.find((r) => r.specId === 'cpu1')!;
    expect(r1.state).toBe('level');
    expect(r1.lock).toEqual(lock);
    expect(r1.reason!.startsWith('Unlocks at Level 4')).toBe(true);
    expect(r1.reason).toContain('needs a 100 W power supply');
    expect(r1.soon).toBe(false);
    expect(snap({ level: { ...s.level, level: 3 }, purchases: s.purchases }).purchases[0]!.locked).toBeDefined();
    const r3 = pickerFor('cpu1', snap({ level: { ...s.level, level: 3 }, purchases: s.purchases }))!.ladder.find((r) => r.specId === 'cpu1')!;
    expect(r3.soon).toBe(true);
  });

  it('nothing is locked in the sandbox (the sim sends no lock): the rung is a normal buy', () => {
    const s = snap({ sandbox: true, purchases: [{ id: 'cpu1', name: 'Tiny-5', kind: 'cpu', price: 200, affordable: true }] });
    expect(pickerFor('cpu1', s)!.ladder.find((r) => r.specId === 'cpu1')!.state).toBe('ready');
  });

  it('a locked motherboard tier is a "level" card', () => {
    const s = snap({ purchases: [{ id: 'board1', name: 'Board 1', kind: 'board', price: 100, affordable: true, locked: { level: 2, name: 'Hobby Shop' } }] });
    const c = boardCards(s).find((x) => x.id === 'board1')!;
    expect(c.state).toBe('level');
    expect(c.canBuy).toBe(false);
    expect(c.soon).toBe(true);
    expect(c.reason).toContain('Level 2');
  });
});

describe('level-up celebration', () => {
  const up = (o: Partial<Snapshot['level']> = {}) => at({ level: 4, name: 'Small Office', leveledUpAt: 900, recentlyUnlocked: levelRows()[3]!.unlocks, ...o });

  it('shows once for a level above the seen one, with what it unlocked', () => {
    const c = celebrationFor(up(), 3)!;
    expect(c.level).toBe(4);
    expect(c.name).toBe('Small Office');
    expect(c.unlocked.map((u) => u.id)).toEqual(levelRows()[3]!.unlocks.map((u) => u.id));
    expect(celebrationFor(up(), 4)).toBeNull();
    expect(celebrationFor(up(), 5)).toBeNull();
  });

  it('a reload or a legacy save never replays: no stamp, no banner, and the seen level follows', () => {
    const loaded = up({ leveledUpAt: null, recentlyUnlocked: [] });
    expect(celebrationFor(loaded, 1)).toBeNull();
    expect(reconcileSeen(loaded, 1)).toBe(4);
    expect(celebrationFor(up(), null)).toBeNull();
    expect(reconcileSeen(up(), null)).toBe(4);
  });

  it('keeps the seen level while a banner is owed, and drops to a lower level on a new game', () => {
    expect(reconcileSeen(up(), 3)).toBe(3);
    expect(reconcileSeen(at({ level: 1, leveledUpAt: null }), 7)).toBe(1);
  });

  it('never in the sandbox', () => {
    expect(celebrationFor(at({ sandbox: true, level: 6, leveledUpAt: 10 }), 1)).toBeNull();
  });

  it('waits behind a tutorial step and the two-toast cap, and takes one toast of room', () => {
    expect(canShowBanner(0, false)).toBe(true);
    expect(canShowBanner(1, false)).toBe(true);
    expect(canShowBanner(2, false)).toBe(false);
    expect(canShowBanner(0, true)).toBe(false);
    expect(toastRoom(true)).toBe(1);
    expect(toastRoom(false)).toBe(2);
  });
});
