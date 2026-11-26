// Player levels (docs/PROGRESSION.md): the client base score, unlock gating, level-driven rules, job needs and expiry,
// declining, the POST time function, the save fields and the sandbox pin.
import { describe, expect, it } from 'vitest';
import { BOARD_TIERS, DEVICE_SPECS } from '../../board/sim';
import { OS_SPECS } from '../../os/sim';
import { handleMessage, newHost } from '@/worker/host';
import { ECONOMY, payout, postTicks } from './economy';
import { Game } from '@/worker/game/game';
import {
  JOB_CLASSES,
  jobMix,
  LEVELS,
  levelFor,
  MAX_LEVEL,
  needsMet,
  NO_CAPS,
  patienceMul,
  pointsFor,
  START_CRATE,
  unlockLevelOf,
} from './levels';
import { Operator, play } from './operator';
import * as saves from '@/worker/game/save';
import { econ, rig } from '@/worker/game/testkit';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.caseGating = false; // the level and price tests buy boards without a bigger case

const { parseSave } = saves;

/** The save as it comes back from storage: written out as JSON text, read in again and checked. */
function reload(save: unknown): unknown {
  const text = JSON.stringify(save);
  return JSON.parse(text);
}

/** The save as it comes back from storage, checked by the loader. */
const roundTrip = (save: unknown): saves.SaveV5 => parseSave(reload(save));

/** The new item's inventory id, or fails the test with the shop's reason. */
function bought(r: ReturnType<Game['purchase']>): string {
  if (!r.ok) {
    throw new Error(r.reason);
  }
  return r.invId;
}

/** The reason of a refusal, or fails the test when the action went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, the action went through');
  }
  return r.reason;
}

/** Each pair of neighbours in `xs`, in order. */
const neighbours = <T>(xs: readonly T[]): [T, T][] => xs.slice(1).map((x, i) => [must(xs[i]), x]);

/** Ticks `g` with operator `op` until the first job is delivered (at most `max` ticks); returns the client base just before that tick. */
function serveFirstJob(g: Game, op: Operator, max: number): number {
  let before = 0;
  for (let t = 0; t < max && g.completed === 0; t++) {
    before = g.clientBase;
    g.advanceBaseTick();
    op.step();
  }
  return before;
}

/** Ticks `g` with operator `op` until it reaches level 2 (at most 3000 ticks); returns the level after each tick. */
function levelsToLevel2(g: Game, op: Operator): number[] {
  const seen: number[] = [];
  for (let t = 0; t < 3000 && g.level < 2; t++) {
    g.advanceBaseTick();
    op.step();
    seen.push(g.level);
  }
  return seen;
}

/** Advances `g` until `cond` holds (at most 4000 ticks), then checks that it does. */
function advanceUntil(g: Game, cond: () => boolean): void {
  for (let i = 0; i < 4000 && !cond(); i++) {
    g.advanceBaseTick();
  }
  expect(cond()).toBe(true);
}

/** The OS is running key `keyId`. */
const runningKey = (g: Game, keyId: number | undefined): boolean =>
  must(g.snapshot().os).queue.some((j) => j.keyId === keyId && j.state === 'running');
/** One job is delivered and its key is out of the port. */
const deliveredOne = (g: Game): boolean => g.completed === 1 && g.pluggedKey() === null;
/** The id of the first key in the tray that can be declined, or -1 when none can. */
const firstDeclinable = (g: Game): number => g.snapshot().tray.find((k) => k.declinable)?.id ?? -1;

/** How often each value occurs in `values`, as a lookup (0 for a value that does not occur). */
function tally(values: Iterable<string>): (value: string) => number {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return (value) => counts.get(value) ?? 0;
}

/** Each class's share of an arrival mix (0..1). */
function shares(mix: ReturnType<typeof jobMix>): Record<string, number> {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  return Object.fromEntries(mix.map(([c, w]) => [c.id, w / total]));
}
/** One class's share of an arrival mix, 0 when the mix does not list it. */
const shareOf = (mix: ReturnType<typeof jobMix>, id: string): number => shares(mix)[id] ?? 0;
const ticks = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) {
    g.advanceBaseTick();
  }
};
const sandbox = (o: { preassembled?: boolean; level?: number; seed?: number } = {}): Game => {
  const g = new Game({ seed: o.seed ?? 3, sandbox: true, preassembled: o.preassembled ?? true, economy: econ() });
  const level = o.level ?? 0;
  if (level > 0) {
    g.setLevel(level);
  }
  return g;
};

describe('the level table', () => {
  it('has 18 rows with increasing thresholds from 0, mixes of 100, falling patience, rising pay and demand', () => {
    expect(LEVELS).toHaveLength(18);
    expect(MAX_LEVEL).toBe(18);
    expect(must(LEVELS[0]).threshold).toBe(0);
    for (const [i, l] of LEVELS.entries()) {
      expect(l.level).toBe(i + 1);
      expect(
        Object.values(l.mix).reduce((a, b) => a + b, 0),
        `level ${l.level} mix`,
      ).toBe(100);
      expect(l.payMul).toBeCloseTo(Math.round(1.11 ** i * 100) / 100, 2);
      expect(l.demandMul).toBeCloseTo(1 + 0.12 * i, 2);
    }
    for (const [p, l] of neighbours(LEVELS)) {
      expect(l.threshold).toBeGreaterThan(p.threshold);
      expect(l.patienceMul).toBeLessThanOrEqual(p.patienceMul);
      expect(l.payMul).toBeGreaterThanOrEqual(p.payMul);
      expect(l.demandMul).toBeGreaterThanOrEqual(p.demandMul);
    }
    // Every class in a row exists, and no class appears before its first level.
    for (const l of LEVELS) {
      for (const id of Object.keys(l.mix)) {
        expect(must(JOB_CLASSES.find((c) => c.id === id)).firstLevel, `${id} at ${l.level}`).toBeLessThanOrEqual(
          l.level,
        );
      }
    }
  });

  it('lists every spec, board tier and OS exactly once, or in the start crate', () => {
    const listed = LEVELS.flatMap((l) => l.unlocks);
    expect(new Set(listed).size).toBe(listed.length);
    const ids = [
      ...Object.keys(DEVICE_SPECS),
      ...BOARD_TIERS.map((t) => `board${t.tier}`),
      ...OS_SPECS.map((o) => o.id),
    ];
    for (const id of ids) {
      expect(listed.includes(id), `${id} in exactly one place`).not.toBe(START_CRATE.includes(id));
    }
    expect(unlockLevelOf('cpu0')).toBe(1);
    expect(unlockLevelOf('os1')).toBe(3);
    expect(unlockLevelOf('board2')).toBe(5);
    expect(unlockLevelOf('cpu2')).toBe(6);
  });
});

describe('the client base score and the level', () => {
  it('levelFor is monotonic and exact at the thresholds', () => {
    let last = 1;
    for (let cb = 0; cb < 1500; cb += 0.5) {
      const l = levelFor(cb);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
    for (const l of LEVELS) {
      expect(levelFor(l.threshold)).toBe(l.level);
    }
    for (const l of LEVELS.filter((x) => x.level > 1)) {
      expect(levelFor(l.threshold - 0.01)).toBe(l.level - 1);
    }
    expect(levelFor(1e9)).toBe(18);
  });

  it('a delivery adds clamp(reputation, 0.5, 2); nothing else adds', () => {
    expect(pointsFor(0.1)).toBe(0.5);
    expect(pointsFor(1.3)).toBe(1.3);
    expect(pointsFor(4)).toBe(2);
    const g = new Game({
      seed: 2,
      preassembled: true,
      economy: econ([{ template: 'cli.log' }, { template: 'cli.log' }]),
    });
    const op = new Operator(g, 0);
    expect(g.clientBase).toBe(0);
    const before = serveFirstJob(g, op, 400);
    expect(g.completed).toBe(1);
    const s = g.snapshot();
    expect(g.clientBase - before).toBeCloseTo(pointsFor(s.reputation), 9);
    expect(s.level.clientBase).toBe(g.clientBase);
    // A decline, an expiry and a drop give 0 points.
    const base = g.clientBase;
    g.declineKey(must(g.snapshot().tray[0]).id);
    expect(g.clientBase).toBe(base);
    const full = new Game({ seed: 3, preassembled: true, economy: { baseDemandPerTick: 1, queueCap: 2 } });
    ticks(full, 30);
    expect(full.dropped).toBeGreaterThan(0);
    expect(full.clientBase).toBe(0);
  });

  it('levels up at the threshold with a log event, a celebration tick and the unlocks, and never goes down', () => {
    const g = new Game({
      seed: 1,
      preassembled: true,
      economy: econ(Array.from({ length: 12 }, () => ({ template: 'cli.log' }))),
    });
    expect(g.snapshot().level).toMatchObject({
      level: 1,
      name: 'Garage Bench',
      floor: 0,
      next: 3,
      progress: 0,
      leveledUpAt: null,
      recentlyUnlocked: [],
    });
    const op = new Operator(g, 0);
    for (const [last, lv] of neighbours([1, ...levelsToLevel2(g, op)])) {
      expect(lv).toBeGreaterThanOrEqual(last);
    }
    const s = g.snapshot();
    expect(s.level.level).toBe(2);
    expect(s.level.leveledUpAt).not.toBeNull();
    const levelEvents = s.log.filter((e) => e.kind === 'level');
    expect(levelEvents.some((e) => /Level \d/u.test(e.text))).toBe(true);
    expect(s.level.recentlyUnlocked.length).toBeGreaterThan(0);
    expect(s.level.progress).toBeGreaterThanOrEqual(0);
    expect(s.level.progress).toBeLessThan(1);
    expect(s.level.upcoming).toHaveLength(18);
    expect(must(s.level.upcoming[2]).unlocks.map((u) => u.id)).toStrictEqual(['ssd1', 'os1', 'ram1b']);
  });

  it(
    'the level never decreases over a whole play with crashes, overclock burns and a reputation at the floor',
    { timeout: 60_000 },
    () => {
      for (const seed of [1, 2, 3, 4]) {
        const g = new Game({ seed, preassembled: true, startLevel: 3, economy: { coldBootTicks: 0 } });
        g.money = 1e6;
        g.setCpuClock(1.5);
        const op = new Operator(g, 2);
        let last = g.level;
        for (let t = 0; t < 1500; t++) {
          g.advanceBaseTick();
          op.step();
          expect(g.level).toBeGreaterThanOrEqual(last);
          last = g.level;
        }
      }
    },
  );
});

const buyer = (level: number) =>
  new Game({ seed: 1, preassembled: true, startLevel: level, economy: { ...econ(), levelGating: true } });

describe('unlock gating', () => {
  it('refuses a locked item with the level reason first, before money and hardware', () => {
    const g = buyer(1);
    g.money = 1e6;
    expect(g.purchase('board1')).toStrictEqual({ ok: false, reason: 'needs Level 2 (Hobby Shop)' });
    expect(refusal(g.purchase('os1'))).toMatch(/^needs Level 3/u);
    expect(refusal(g.purchase('hdd0'))).toMatch(/Level 2/u);
    // psu2 is hardware-blocked on this board too, but the level is named first.
    expect(refusal(g.purchase('psu2'))).toMatch(/Level 5/u);
    const poor = buyer(1);
    expect(poor.purchase('os1').ok).toBe(false);
    expect(refusal(poor.purchase('os1'))).toMatch(/Level 3/u);
    expect(g.purchase('cpu1').ok).toBe(true); // level 1 items are open
  });

  it('opens an item at exactly its level; money and hardware still apply on top', () => {
    const g = buyer(2);
    g.money = 100;
    expect(g.purchase('board1')).toMatchObject({ ok: false, reason: 'needs $150, have $100' });
    g.money = 150;
    expect(g.purchase('board1').ok).toBe(true);
    const h = buyer(3);
    h.money = 1000;
    expect(h.purchase('os1').ok).toBe(true); // level and money are all the shop asks: the inventory says it needs a drive
    const os1 = must(h.snapshot().inventory.find((i) => i.spec === 'os1'));
    expect(os1.installable).toBe(false);
    expect(os1.reason).toMatch(/storage drive/u);
    expect(buyer(1).snapshot().level.level).toBe(1);
  });

  it('lists locked items with their level in the snapshot, and unlocked ones without', () => {
    const g = buyer(1);
    const p = new Map(g.snapshot().purchases.map((x) => [x.id, x]));
    expect(must(p.get('board1')).locked).toStrictEqual({ level: 2, name: 'Hobby Shop' });
    expect(must(p.get('os1')).locked).toStrictEqual({ level: 3, name: 'Local Gigs' });
    expect(must(p.get('cpu2')).locked).toStrictEqual({ level: 6, name: 'Neighbourhood' });
    expect(p.get('os2')).toMatchObject({ locked: { level: 8 } });
    expect(must(p.get('os2')).later).toBeUndefined(); // the paged OS exists now
    expect(p.get('os3')).toMatchObject({ locked: { level: 13 } });
    expect(must(p.get('os3')).later).toBeUndefined(); // the preemptive OS exists now
    expect(p.get('os4')).toMatchObject({ locked: { level: 14 } });
    expect(must(p.get('os4')).later).toBeUndefined(); // the multicore OS exists now
    expect(must(p.get('cpu1')).locked).toBeUndefined();
    expect(must(p.get('ram1')).locked).toBeUndefined();
    for (const x of g.snapshot().purchases) {
      expect(x.locked !== undefined, `for ${x.id}`).toBe(unlockLevelOf(x.id) > 1);
    }
    // At level 3 the drive and the OS are open.
    const g3 = buyer(3);
    const q = new Map(g3.snapshot().purchases.map((x) => [x.id, x]));
    expect(must(q.get('hdd0')).locked).toBeUndefined();
    expect(must(q.get('os1')).locked).toBeUndefined();
    expect(must(q.get('nvme2')).locked).toMatchObject({ level: 7 });
  });

  it('the sandbox ignores levels; an installed part from a save keeps working whatever the level', () => {
    const sb = sandbox();
    expect(sb.purchase('cooler2').ok).toBe(true);
    expect(sb.purchase('os1').ok).toBe(true);
    expect(sb.snapshot().purchases.every((x) => !x.locked)).toBe(true);
    // A big machine with the score of a beginner (a hand-edited or old save): it loads, it powers on, the parts stay.
    const big = rig('nvme2', { cpu: 'cpu2' });
    const save = roundTrip(big.toSave());
    save.clientBase = 0;
    save.level = 1;
    save.levelTicks = { '1': 0 };
    const l = Game.fromSave(save);
    expect(l.level).toBe(1);
    expect(l.snapshot().devices.map((d) => d.spec)).toStrictEqual(expect.arrayContaining(['cpu2', 'nvme2']));
    expect(l.snapshot().os?.spec).toBe('os1');
    expect(l.powerButton().ok).toBe(true);
  });
});

const firstPayout = (level: number): number => {
  const g = new Game({ seed: 4, preassembled: true, startLevel: level, economy: econ() });
  const op = new Operator(g, 0);
  serveFirstJob(g, op, 400);
  return must(g.lastCompleted).payout;
};

describe('patience, payout and demand by level', () => {
  it("payout is the base formula times the level's pay multiplier", () => {
    const cfg = ECONOMY;
    expect(payout({ cfg, work: 30, turnaround: 60, late: false, levelPay: 1 })).toBe(56);
    expect(payout({ cfg, work: 30, turnaround: 60, late: false, levelPay: 1.52 })).toBe(Math.round(56 * 1.52));
    const p1 = firstPayout(1);
    const p5 = firstPayout(5);
    expect(p5 / p1).toBeGreaterThan(1.35);
    expect(p5 / p1).toBeLessThan(1.7);
  });

  it('demand follows baseDemandPerTick x demandMul x reputation; the deadline and target follow the patience', () => {
    for (const level of [1, 4, 9, 18]) {
      const g = new Game({ seed: 1, preassembled: true, startLevel: level });
      const s = g.snapshot();
      expect(s.demandRate).toBeCloseTo(ECONOMY.baseDemandPerTick * must(LEVELS[level - 1]).demandMul * s.reputation, 9);
      expect(s.patience.mul).toBe(patienceMul(level));
      expect(s.level).toMatchObject({ level, patienceMul: patienceMul(level), payMul: must(LEVELS[level - 1]).payMul });
    }
    // At level 18 the key deadline is 90 ticks and the reputation target 30 s.
    const g = new Game({ seed: 1, preassembled: true, startLevel: 18 });
    expect(g.snapshot().patience).toMatchObject({ mul: 0.5, targetTurnaround: 30, deadlineTicks: 90 });
  });
});

describe('the arrival mix', () => {
  it('levels 1 to 4 are plain cli work, scans and db arrive at level 5; a class ramps in over its ticks after its level; reputation shifts the heavy classes', () => {
    for (const level of [1, 2, 3]) {
      expect(shares(jobMix({ level, reputation: 1, levelTicks: {}, tick: 0 }))).toStrictEqual({ cli: 1 });
    }
    expect(shares(jobMix({ level: 4, reputation: 1, levelTicks: {}, tick: 0 }))['scan']).toBeUndefined();
    const s5 = shares(jobMix({ level: 5, reputation: 1, levelTicks: { 5: 1e9 }, tick: 1e9 + 10_000 })); // fully ramped
    expect(s5['scan']).toBeCloseTo(0.25, 2);
    expect(s5['cli']).toBeCloseTo(0.4, 2);
    // Scan ramps in over 300 ticks from its level; the moment the level is reached there is no scan at all.
    expect(shareOf(jobMix({ level: 5, reputation: 1, levelTicks: { 5: 0 }, tick: 0 }), 'scan')).toBe(0);
    expect(shares(jobMix({ level: 5, reputation: 1, levelTicks: { 5: 0 }, tick: 150 }))['scan']).toBeLessThan(0.2);
    // web arrives at level 4: nothing at the moment the level is reached, half its share after 300 ticks, all after 600.
    expect(shareOf(jobMix({ level: 4, reputation: 1, levelTicks: { 4: 1000 }, tick: 1000 }), 'web')).toBe(0);
    const [, half] = must(
      jobMix({ level: 4, reputation: 1, levelTicks: { 4: 1000 }, tick: 1300 }).find(([c]) => c.id === 'web'),
    );
    expect(half).toBeCloseTo(7.5, 6);
    expect(
      must(jobMix({ level: 4, reputation: 1, levelTicks: { 4: 1000 }, tick: 1600 }).find(([c]) => c.id === 'web'))[1],
    ).toBe(15);
    // Heavy classes scale with reputation, clamped to 0.5 .. 1.5.
    const heavy = (rep: number) =>
      must(jobMix({ level: 10, reputation: rep, levelTicks: {}, tick: 0 }).find(([c]) => c.id === 'gpu'))[1];
    expect(heavy(0.1)).toBe(10);
    expect(heavy(1)).toBe(20);
    expect(heavy(3)).toBe(30);
    const cli = (rep: number) =>
      must(jobMix({ level: 10, reputation: rep, levelTicks: {}, tick: 0 }).find(([c]) => c.id === 'cli'))[1];
    expect(cli(0.1)).toBe(cli(3)); // light classes do not move
  });

  it("generated arrivals match the level's row over many jobs", () => {
    const g = sandbox({ level: 10 });
    const big = new Game({
      seed: 11,
      sandbox: true,
      preassembled: true,
      economy: { baseDemandPerTick: 1, queueCap: 100_000 },
    });
    big.setLevel(10);
    big.purchase('isp1'); // the web class has no share before a plan exists; with one its jobs arrive as network offers
    const seen = new Map<number, string>();
    for (let t = 0; t < 1500; t++) {
      big.setReputation(1); // held at 1 so the heavy-class shift stays neutral
      big.advanceBaseTick();
      const s = big.snapshot();
      for (const k of [...s.tray, ...s.net.offers]) {
        seen.set(k.id, k.cls);
      }
    }
    const count = tally(seen.values());
    const total = seen.size;
    expect(total).toBeGreaterThan(500);
    const row = must(LEVELS[9]).mix;
    for (const [id, pct] of Object.entries(row)) {
      const got = (count(id) / total) * 100;
      expect(Math.abs(got - pct), `${id}: ${got.toFixed(0)}% vs ${pct}%`).toBeLessThan(6);
    }
    expect(g.level).toBe(10);
  }, 60_000);
});

describe('jobs the machine cannot run', () => {
  it('arrive with their needs, cannot be plugged, expire at exactly their deadline with a give-up feed, and do not hurt reputation while they wait', () => {
    const g = sandbox({ level: 10 });
    g.clearQueue(); // the starter key would age and set the reputation instead
    g.setReputation(54 / 50); // the doc's worked example: level 10, target 54, average 50
    const avg0 = g.snapshot().avgTurnaround;
    expect(avg0).toBeCloseTo(50, 6);
    const r0 = g.snapshot().reputation;
    expect(r0).toBeCloseTo(1.08, 6);
    expect(g.spawnKey('secure')).toMatchObject({ ok: true }); // the TPM job is the one class still waiting for its device (gpu jobs run on the CPU without a card)
    const k = must(g.snapshot().tray.find((x) => x.cls === 'secure'));
    expect(k).toMatchObject({
      runnable: false,
      needs: ['TPM', 'ECC'],
      missing: ['a TPM', 'ECC RAM'],
      type: 'secure',
      declinable: true,
    });
    expect(k.label).toMatch(/secure$/u);
    expect(k.expiresTick - k.arrivalTick).toBe(Math.round(180 * 0.9));
    const plug = g.plugKey(k.id);
    expect(refusal(plug)).toMatch(/TPM/u);
    expect(g.trayKeyIds()).not.toContain(k.id); // bots only see keys they can run
    // Waiting does not count as an age (the player is punished once, at the expiry).
    while (g.baseTick < k.expiresTick - 1) {
      g.advanceBaseTick();
    }
    expect(g.snapshot().tray.some((x) => x.id === k.id)).toBe(true);
    expect(g.snapshot().reputation).toBeCloseTo(r0, 6);
    g.advanceBaseTick();
    const s = g.snapshot();
    expect(s.tray.some((x) => x.id === k.id)).toBe(false);
    expect(s.expired).toBe(1);
    expect(s.avgTurnaround).toBeCloseTo(0.3 * 162 + 0.7 * 50, 6); // 83.6
    expect(s.reputation).toBeCloseTo(54 / 83.6, 6); // 0.65
    expect(s.log.some((e) => e.kind === 'expire')).toBe(true);
  });

  it('an expired job gives no client-base points', () => {
    const g = new Game({
      seed: 5,
      preassembled: true,
      startLevel: 5,
      economy: { baseDemandPerTick: 1, queueCap: 400 },
    });
    const base = g.clientBase;
    ticks(g, 700); // nobody serves: db jobs need an OS, they expire at 540 ticks
    expect(g.expired).toBeGreaterThan(0);
    expect(g.clientBase).toBe(base);
    expect(g.completed).toBe(0);
  });

  it('buying the missing device in time makes the job runnable at once', () => {
    const g = sandbox({ preassembled: true, level: 3 });
    g.powerButton(); // sandbox machines are assembled and off; power on to boot, then off to fit parts
    g.powerButton();
    expect(g.spawnKey('db')).toMatchObject({ ok: true });
    const { id } = must(g.snapshot().tray.find((x) => x.cls === 'db'));
    expect(g.snapshot().tray.find((x) => x.id === id)).toMatchObject({
      runnable: false,
      missing: ['an OS', 'a SATA SSD or better', '96K of RAM'],
    });
    for (const item of ['ram2', 'ssd1']) {
      const b = g.purchase(item);
      expect(b.ok, `for ${item}`).toBe(true);
      expect(g.install(bought(b)).ok, `for ${item}`).toBe(true);
    }
    expect(g.snapshot().tray.find((x) => x.id === id)).toMatchObject({ runnable: false, missing: ['an OS'] });
    const os = bought(g.purchase('os1'));
    expect(g.install(os).ok).toBe(true);
    expect(g.snapshot().tray.find((x) => x.id === id)).toMatchObject({ runnable: true, missing: [] });
    ticks(g, 400); // far past the deadline: a runnable job is just late, it is not taken back
    expect(g.snapshot().tray.some((x) => x.id === id)).toBe(true);
    expect(g.expired).toBe(0);
    expect(g.plugKey(id).ok).toBe(true);
  });

  it('needsMet reads the machine; unknown devices (network, TPM, multicore) are never there yet; the GPU and NPU classes need nothing', () => {
    expect(needsMet([{ kind: 'os', min: 1 }], NO_CAPS)).toStrictEqual({ ok: false, missing: ['an OS'] });
    expect(
      needsMet(
        [
          { kind: 'os', min: 1 },
          { kind: 'storage', minTier: 1 },
        ],
        { ...NO_CAPS, osTier: 1, storageTier: 2 },
      ).ok,
    ).toBe(true);
    expect(needsMet([{ kind: 'storage', minTier: 1 }], { ...NO_CAPS, storageTier: 0 }).ok).toBe(false);
    const hpc = must(JOB_CLASSES.find((x) => x.id === 'hpc'));
    expect(hpc.placeholder).toBeUndefined();
    expect(needsMet(hpc.needs, { ...NO_CAPS, osTier: 3, storageTier: 2, cores: 8 }).ok).toBe(false); // OS 3 does not start threaded programs
    expect(needsMet(hpc.needs, { ...NO_CAPS, osTier: 4, storageTier: 2, cores: 1 }).ok).toBe(false);
    expect(needsMet(hpc.needs, { ...NO_CAPS, osTier: 4, storageTier: 2, cores: 2 }).ok).toBe(true);
    // The network jobs are real now: a link of any plan meets the class, and a kind can ask for a faster plan.
    const web = must(JOB_CLASSES.find((x) => x.id === 'web'));
    expect(web.placeholder).toBeUndefined();
    // Only the web class has a latency SLA (docs/NETWORK.md "Web jobs"): 120 ticks at 1x, measured to leave the better plan mostly on time at levels 4 to 7.
    expect(web.slaTicks).toBe(120);
    expect(must(web.slaTicks)).toBeLessThan(ECONOMY.deadlineTicks);
    expect(JOB_CLASSES.filter((c) => c.slaTicks !== undefined).map((c) => c.id)).toStrictEqual(['web']);
    expect(needsMet(web.needs, { ...NO_CAPS, osTier: 3, storageTier: 2 }).ok).toBe(false);
    expect(needsMet(web.needs, { ...NO_CAPS, net: true, netTier: 1 }).ok).toBe(true);
    expect(needsMet([{ kind: 'net', minTier: 2 }], { ...NO_CAPS, net: true, netTier: 1 })).toStrictEqual({
      ok: false,
      missing: ['a Cable plan or better'],
    });
    expect(needsMet([{ kind: 'net', minTier: 2 }], { ...NO_CAPS, net: true, netTier: 2 }).ok).toBe(true);
    const secure = must(JOB_CLASSES.find((x) => x.id === 'secure'));
    expect(secure).toMatchObject({ template: 'secure.sign', needs: [{ kind: 'tpm' }, { kind: 'ecc' }] });
    expect(secure.placeholder).toBeUndefined();
    expect(needsMet(secure.needs, NO_CAPS).ok).toBe(false);
    expect(needsMet(secure.needs, { ...NO_CAPS, tpm: true, ecc: true }).ok).toBe(true);
    expect(needsMet(secure.needs, { ...NO_CAPS, tpm: true }).missing).toStrictEqual(['ECC RAM']);
    const npu = must(JOB_CLASSES.find((x) => x.id === 'npu'));
    expect(npu).toMatchObject({ template: 'npu.infer', needs: [] });
    expect(npu.placeholder).toBeUndefined();
    const gpu = must(JOB_CLASSES.find((x) => x.id === 'gpu'));
    expect(gpu).toMatchObject({ template: 'gpu.render', needs: [] });
    expect(gpu.placeholder).toBeUndefined();
    expect(needsMet(gpu.needs, NO_CAPS).ok).toBe(true);
  });
});

/** A game saved at level 10 or 4 with the doc's average turnaround, loaded back (keeps the level through the score). */
function at(level: number, avg: number, keys: number): Game {
  const g = new Game({
    seed: 6,
    preassembled: true,
    economy: econ(Array.from({ length: keys }, () => ({ template: 'cli.log' }))),
  });
  const save = roundTrip(g.toSave());
  save.clientBase = must(LEVELS[level - 1]).threshold;
  save.avgTurnaround = avg;
  save.levelTicks = {};
  return Game.fromSave(save, econ(Array.from({ length: keys }, () => ({ template: 'cli.log' }))));
}

describe('declining', () => {
  it("removes a waiting job at once and feeds exactly target x patience into the average (the doc's two worked examples)", () => {
    const a = at(10, 50, 2);
    a.powerButton(); // loaded games are off; the key stays in the tray either way
    expect(a.snapshot().reputation).toBeCloseTo(54 / 50, 6);
    const { id } = must(a.snapshot().tray[0]);
    const { money } = a;
    expect(a.declineKey(id)).toMatchObject({ ok: true });
    const s = a.snapshot();
    expect(s.tray.map((k) => k.id)).not.toContain(id);
    expect(s.avgTurnaround).toBeCloseTo(0.3 * 54 + 0.7 * 50, 6); // 51.2
    expect(s.reputation).toBeCloseTo(54 / 51.2, 6); // 1.05
    expect(s).toMatchObject({ declined: 1, expired: 0, completed: 0 });
    expect(a.money).toBe(money);
    expect(a.clientBase).toBe(must(LEVELS[9]).threshold);
    // Level 4, average 60: reputation 2.4 -> 1.69.
    const b = at(4, 60, 1);
    expect(b.snapshot().reputation).toBeCloseTo(2.4, 6);
    b.declineKey(must(b.snapshot().tray[0]).id);
    expect(b.snapshot().reputation).toBeCloseTo(144 / 85.2, 6);
    // One third of an expiry at the same level and average.
    const feedDecline = 0.3 * 144 + 0.7 * 60;
    const feedExpire = 0.3 * (180 * 2.4) + 0.7 * 60;
    expect(feedDecline - 60).toBeCloseTo(((feedExpire - 60) * (144 - 60)) / (432 - 60), 6);
  });

  it('is refused for the plugged key, an unknown id, a running job and a result waiting; the slot is freed and refilled', () => {
    const g = new Game({
      seed: 2,
      preassembled: true,
      economy: econ([{ template: 'cli.log' }, { template: 'cli.log' }]),
    });
    g.powerButton();
    const [a, b] = g.trayKeyIds();
    expect(g.plugKey(must(a)).ok).toBe(true);
    const pluggedDecline = g.declineKey(must(a));
    expect(refusal(pluggedDecline)).toMatch(/^plugged/u);
    expect(g.declineKey(999)).toMatchObject({ ok: false });
    expect(g.declined).toBe(0);
    expect(g.declineJob(must(b)).ok).toBe(true);
    expect(g.snapshot().queueLength).toBe(0);
    expect(g.snapshot().declined).toBe(1);

    // With an OS: the key it is working on stays plugged (so it cannot be declined); a key waiting in the tray still can.
    const os = rig('nvme2', { keys: [{ template: 'cli.scan', scale: 16 }, { template: 'cli.log' }] });
    os.powerButton();
    advanceUntil(os, () => os.currentPhase() === 'idle-os');
    const [k1, k2] = os.trayKeyIds();
    expect(os.plugKey(must(k1)).ok).toBe(true);
    advanceUntil(os, () => runningKey(os, k1));
    const runningDecline = os.declineKey(must(k1));
    expect(refusal(runningDecline)).toMatch(/^plugged/u);
    expect(os.declineJob(must(k2))).toMatchObject({ ok: true });
    advanceUntil(os, () => deliveredOne(os));
    expect(os.snapshot().declined).toBe(1);
  });

  it('is free in the sandbox: the job leaves and counts, but nothing is fed into the average', () => {
    const g = sandbox({ level: 10 });
    g.spawnKey('cli.log');
    const avg = g.snapshot().avgTurnaround;
    const { id } = must(g.snapshot().tray[g.snapshot().tray.length - 1]);
    expect(g.declineKey(id).ok).toBe(true);
    expect(g.snapshot().avgTurnaround).toBe(avg);
    expect(g.snapshot().declined).toBe(1);
    expect(g.clientBase).toBe(0);
  });
});

// cpu2, one ram2 (64K), NVMe and the monitor: 1 + 3 + 0.5 + 0.5 + 0.5 + 0.25 = 5.75, rounds to 6; with an HDD instead: 6.5, rounds to 7.
const build = (storage: Parameters<typeof rig>[0]): number => {
  const r = rig(storage, { os: false, cpu: 'cpu2' });
  r.uninstall(must(r.board.devices.find((d) => d.spec === 'ram1')).id);
  r.install(bought(r.purchase('ram2')));
  return r.snapshot().postTicks;
};

describe('POST time', () => {
  it('is 3 for the Starter machine and follows the formula for other builds', () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    expect(g.snapshot().postTicks).toBe(3);
    expect(postTicks(ECONOMY, g.board)).toBe(3);
    expect(build('nvme2')).toBe(6);
    expect(build('hdd0')).toBe(7);
  });

  it('caps at the configured maximum and can be overridden (the override wins, including 0)', () => {
    const g = new Game({ seed: 1, preassembled: true });
    expect(postTicks({ ...ECONOMY, coldBoot: { ...ECONOMY.coldBoot, max: 2 } }, g.board)).toBe(2);
    expect(postTicks({ ...ECONOMY, coldBootTicks: 7 }, g.board)).toBe(7);
    expect(postTicks({ ...ECONOMY, coldBootTicks: 0 }, g.board)).toBe(0);
    const big = rig('nvme2', { cpu: 'cpu2', os: false });
    expect(postTicks(ECONOMY, big.board)).toBeLessThanOrEqual(8);
  });

  it('the machine waits exactly its POST time before the first ROM line', () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    const post = g.snapshot().postTicks;
    ticks(g, post - 1);
    expect(g.snapshot().display).toBe('');
    ticks(g, 40);
    expect(g.snapshot().display).not.toBe('');
  });
});

const base = () => roundTrip(new Game({ seed: 1 }).toSave());

const run = (): string => {
  const g = new Game({ seed: 12, preassembled: true, startLevel: 3, economy: { baseDemandPerTick: 0.3 } });
  play(g, 600, 2);
  return JSON.stringify([g.snapshot(), g.toSave()]);
};

describe('the save fields', () => {
  it('round-trips clientBase, level, levelTicks, declined and expired; the job class of a key', () => {
    const g = new Game({ seed: 8, preassembled: true, startLevel: 4, economy: { baseDemandPerTick: 0.5 } });
    play(g, 200, 1);
    g.declineKey(firstDeclinable(g));
    const save = roundTrip(g.toSave());
    expect(save).toMatchObject({ clientBase: g.clientBase, level: g.level, declined: g.declined, expired: g.expired });
    expect(save.tray.every((k) => typeof k.cls === 'string')).toBe(true);
    const l = Game.fromSave(save, { baseDemandPerTick: 0.5 });
    expect(l.toSave()).toStrictEqual({ ...save, plugged: l.toSave().plugged });
    expect(l.level).toBe(g.level);
    expect(l.snapshot().tray.map((k) => k.cls)).toStrictEqual(g.snapshot().tray.map((k) => k.cls));
  });

  it('migrates a save without the fields: clientBase = completed x 1.1, the level derived, no celebration, parts kept', () => {
    const g = rig('nvme2', { cpu: 'cpu2' });
    g.completed = 30;
    const {
      clientBase: _clientBase,
      level: _level,
      levelTicks: _levelTicks,
      declined: _declined,
      expired: _expired,
      ...old
    } = g.toSave();
    const l = Game.fromSave(reload(old));
    expect(l.clientBase).toBeCloseTo(33, 9);
    expect(l.level).toBe(levelFor(33));
    const s = l.snapshot();
    expect(s.level.leveledUpAt).toBeNull();
    expect(s.log.some((e) => e.kind === 'level')).toBe(false);
    expect(s.declined).toBe(0);
    expect(s.devices.map((d) => d.spec)).toStrictEqual(expect.arrayContaining(['cpu2', 'nvme2']));
  });

  it('validates the new fields', () => {
    expect(() => parseSave({ ...base(), clientBase: -1 })).toThrow(/clientBase/u);
    expect(() => parseSave({ ...base(), clientBase: 'x' })).toThrow(/clientBase/u);
    expect(() => parseSave({ ...base(), level: 1.5 })).toThrow(/level/u);
    expect(() => parseSave({ ...base(), level: 19 })).toThrow(/level/u);
    expect(() => parseSave({ ...base(), declined: -2 })).toThrow(/declined/u);
    expect(() => parseSave({ ...base(), levelTicks: { a: 1 } })).toThrow(/levelTicks/u);
    const s = base();
    must(s.tray[0]).cls = 'nope';
    expect(() => parseSave(s)).toThrow(/cls/u);
    expect(parseSave(base()).version).toBe(5);
  });

  it('is deterministic for the same seed, start level and script', { timeout: 30_000 }, () => {
    expect(run()).toBe(run());
  });
});

describe('sandbox rules level', () => {
  it('is pinned at 8, set by setLevel, hides the score, and the tool is refused in a campaign', () => {
    const g = sandbox();
    expect(g.level).toBe(8);
    expect(g.snapshot().level).toMatchObject({ level: 8, sandbox: true, clientBase: 0 });
    expect(g.snapshot().patience.mul).toBe(patienceMul(8));
    expect(g.setLevel(3)).toMatchObject({ ok: true, level: 3 });
    expect(g.snapshot().patience.mul).toBe(3);
    expect(g.snapshot().level.level).toBe(3);
    for (const bad of [0, 19, 2.5, Number.NaN]) {
      expect(g.setLevel(bad).ok, `for ${String(bad)}`).toBe(false);
    }
    const c = new Game({ seed: 1 });
    expect(c.setLevel(5)).toStrictEqual({ ok: false, reason: 'sandbox mode only' });
    expect(c.level).toBe(1);
    // Delivering a job in the sandbox never grows the score.
    const op = new Operator(g, 0);
    g.spawnKey('cli.log');
    serveFirstJob(g, op, 600);
    expect(g.completed).toBeGreaterThan(0);
    expect(g.clientBase).toBe(0);
  });

  it('spawnKey accepts the new job classes', () => {
    const g = sandbox();
    for (const id of ['db', 'web', 'secure', 'gpu', 'npu', 'hpc']) {
      expect(g.spawnKey(id).ok, `for ${id}`).toBe(true);
    }
    expect(g.snapshot().tray.map((k) => k.cls)).toStrictEqual(expect.arrayContaining(['db', 'web', 'gpu']));
    expect(g.spawnKey('nope').ok).toBe(false);
  });
});

describe('host messages', () => {
  it('declineKey, declineJob and setLevel go through the host and refuse with a reason', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1, preassembled: true });
    const { id } = must(must(h.game).snapshot().tray[0]);
    expect(handleMessage(h, { type: 'declineKey', keyId: 999 }).map((m) => m.type)).toStrictEqual([
      'error',
      'snapshot',
    ]);
    expect(handleMessage(h, { type: 'setLevel', level: 5 })).toStrictEqual([
      { type: 'error', message: 'setLevel: sandbox mode only' },
      expect.objectContaining({ type: 'snapshot' }),
    ]);
    expect(handleMessage(h, { type: 'declineKey', keyId: id }).map((m) => m.type)).toStrictEqual(['snapshot']);
    expect(must(h.game).snapshot().declined).toBe(1);
    const k2 = must(h.game);
    expect(k2.snapshot().tray).toHaveLength(0);
    const s = newHost();
    handleMessage(s, { type: 'init', seed: 1, sandbox: true, preassembled: true });
    expect(handleMessage(s, { type: 'setLevel', level: 12 }).map((m) => m.type)).toStrictEqual(['snapshot']);
    expect(must(s.game).level).toBe(12);
    handleMessage(s, { type: 'spawnKey', template: 'cli.log' });
    const jid = must(must(s.game).snapshot().tray[0]).id;
    expect(handleMessage(s, { type: 'declineJob', id: jid }).map((m) => m.type)).toStrictEqual(['snapshot']);
  });
});
