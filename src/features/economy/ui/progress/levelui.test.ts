import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { levelRows } from '../../sim/levels';
import { cannotRunText, celebrationFor, DECLINE_ARM_MS, deadlineInfo, declineStep, declineWords, hasArt, isNextLevelLock, levelBar, lockBadge, lockTooltip, milestoneRows, needChips, postBreakdown, reconcileSeen, unlockedFirst } from './levelui';
import { osSection, pickerFor } from '../shop/picker';
import { boardCards } from '@/features/board/ui/vrm';
import { dev, key, snap } from '@/core/ui/testdata';

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
    expect(l10.unlocks.map((u) => u.id)).toContain('display1');
    const display = l10.unlocks.find((u) => u.id === 'display1')!;
    expect(display.planned).toBe(false);
    expect(hasArt(display.id, display.kind, display.planned)).toBe(true);
    expect(display.icon).toBe('screen');
    const planned = rows[6]!.unlocks.find((u) => u.id === 'fan1')!; // still only a name in the table
    expect(planned.planned).toBe(true);
    expect(hasArt(planned.id, planned.kind, planned.planned)).toBe(false);
    const cpu = rows[0]!.unlocks.find((u) => u.id === 'cpu1')!;
    expect(hasArt(cpu.id, cpu.kind, cpu.planned)).toBe(true);
    expect(hasArt('board1', 'board', false)).toBe(true);
  });

  it('names the job classes that arrive at a level and compares with the level before', () => {
    expect(rows[2]!.newJobs).toEqual([]); // plain work until the network opens
    // the classes come first, then the kinds of job that arrive after their class did (docs/JOBS.md "The catalogue")
    expect(rows[4]!.newJobs.map((j) => j.id)).toEqual(['scan', 'db', 'gcd', 'popcount', 'dns', 'form']);
    expect(rows[3]!.newJobs.map((j) => j.label)).toEqual(['Web', 'Cloud storage', 'Fibonacci', 'Reverse text']);
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
});

describe('job needs, deadlines and declining', () => {
  const job = (o: Partial<Parameters<typeof needChips>[0] & Parameters<typeof deadlineInfo>[0]> = {}) => ({
    needs: ['OS', 'SSD'], missing: ['a SATA SSD or better'], runnable: false, arrivalTick: 100, expiresTick: 300, ...o,
  });

  it('shows one chip per need with a device icon; the unmet ones are marked missing', () => {
    const chips = needChips(job());
    expect(chips.map((c) => [c.short, c.icon, c.missing])).toEqual([['OS', 'cpu', false], ['SSD', 'disk', true]]);
    expect(needChips({ needs: [], missing: [] })).toEqual([]);
    expect(needChips({ needs: ['GPU'], missing: ['a GPU'] })[0]!.icon).toBe('screen');
  });

  it('says plainly what a job cannot run on, and nothing for a runnable one', () => {
    expect(cannotRunText(job({ missing: ['a GPU', 'an OS'] }))).toBe('Cannot run yet: it needs a GPU and an OS.');
    expect(cannotRunText(job({ runnable: true, missing: [] }))).toBeNull();
  });

  it('the deadline turns red in the last quarter and is absent for a runnable job', () => {
    expect(deadlineInfo(job({ runnable: true }), 150)).toBeNull();
    expect(deadlineInfo(job(), 120)).toMatchObject({ left: 180, urgency: 'ok' });
    expect(deadlineInfo(job(), 210)).toMatchObject({ left: 90, urgency: 'warn' });
    expect(deadlineInfo(job(), 260)).toMatchObject({ left: 40, urgency: 'bad' });
    expect(deadlineInfo(job(), 999)).toMatchObject({ left: 0, frac: 0, urgency: 'bad' });
  });

  it('decline arms on the first press and confirms on a second within 3 seconds', () => {
    expect(declineStep(null, 1000)).toBe('arm');
    expect(declineStep(1000, 2500)).toBe('confirm');
    expect(declineStep(1000, 3999)).toBe('confirm');
    expect(declineStep(1000, 4000)).toBe('arm');
    expect(declineStep(1000, 900)).toBe('arm');
    expect(DECLINE_ARM_MS).toBe(3000);
  });

  it('the words name the reputation cost, and say it is free in the sandbox', () => {
    expect(declineWords(false, false).title).toContain('reputation');
    expect(declineWords(false, true).label).toContain('reputation');
    expect(declineWords(true, false).title).toContain('Free in the sandbox');
    expect(declineWords(true, true).label).not.toContain('reputation');
  });

  it('the key card carries the job, blocks plugging an unrunnable key and shows the expiry', () => {
    const k = key({ id: 7, cls: 'gpu', needs: ['GPU'], missing: ['a GPU'], runnable: false, arrivalTick: 0, expiresTick: 400 });
    const m = pickerFor('key:7', snap({ tray: [k], baseTick: 100 }))!;
    expect(m.job).toMatchObject({ id: 7, declinable: true, runnable: false });
    const plug = m.actions.find((a) => a.id === 'plug')!;
    expect(plug.why).toContain('a GPU');
    expect(m.lines[0]!.text).toContain('Cannot run yet');
    expect(m.lines.some((l) => l.text.includes('takes it back in'))).toBe(true);
    const ok = pickerFor('key:1', snap({ tray: [key()] }))!;
    expect(ok.actions.find((a) => a.id === 'plug')!.why).toBeUndefined();
  });

  it('OS queue rows carry the job of their key, for the needs chips and the decline button', () => {
    const k = key({ id: 3, stage: 'queued', needs: ['OS'], missing: [], declinable: true });
    const s = snap({
      tray: [k],
      os: { spec: 'os1', tier: 1, name: 'Mini OS', deviceId: 'd', slot: 'sata0', programSlots: 1, queueSlots: 2, up: true, runningKeyId: null,
        queue: [{ slot: 0, keyId: 3, label: '#3 log', state: 'queued', ahead: 0 }] } as unknown as Snapshot['os'],
    });
    const row = osSection(s)!.queue[0]!;
    expect(row.job).toMatchObject({ id: 3, declinable: true, needs: ['OS'] });
  });
});

describe('POST readout', () => {
  it('adds up to the snapshot total and names RAM, sticks and devices', () => {
    const s = snap({
      postTicks: 30,
      devices: [
        dev({ id: 'c', spec: 'cpu0', kind: 'cpu' }),
        dev({ id: 'r1', spec: 'ram0', kind: 'ram', slot: 'dimm0' }),
        dev({ id: 'r2', spec: 'ram0', kind: 'ram', slot: 'dimm1' }),
      ],
    });
    const p = postBreakdown(s);
    expect(p.total).toBe(30);
    expect(p.parts.map((x) => x.label)).toEqual(expect.arrayContaining(['Firmware', 'Memory check', '2 RAM sticks']));
    expect(Math.abs(p.parts.reduce((a, x) => a + x.ticks, 0) - 30)).toBeLessThanOrEqual(2);
  });

  it('a bare board is just the firmware', () => {
    const p = postBreakdown(snap({ postTicks: 22 }));
    expect(p.parts).toEqual([expect.objectContaining({ label: 'Firmware', ticks: 22 })]);
  });
});
