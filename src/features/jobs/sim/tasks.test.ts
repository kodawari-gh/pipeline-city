// The kinds of job inside a class (docs/JOBS.md "The catalogue"): which ones a level has reached, what each needs, and that each one runs to the end in a game.
import { assert, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import { WEB_SIZES } from '../../network/sim';
import { JOB_DEX, pickTask, taskLevel, taskNeeds, taskOfTemplate } from './jobdex';
import { JOB_CLASSES, jobClass, MAX_LEVEL } from '../../economy/sim/levels';
import type * as levelsTypes from '../../economy/sim/levels';
import { econ, netRig, rig } from '@/worker/game/testkit';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const tasks = JOB_DEX.filter((e) => e.planned !== true);
type Task = (typeof tasks)[number];
type JobClass = (typeof JOB_CLASSES)[number];

/** The kinds of a class that its level has reached. */
const openAt = (c: JobClass, level: number): Task[] => tasks.filter((e) => e.cls === c.id && taskLevel(e) <= level);
/** The class sends its own template while every kind it has opened is one of the old ones (none opened: the same). */
const allLegacy = (open: Task[]): boolean => open.every((e) => e.legacy === true);
/** The kinds a class sends at `level`, one draw per seed (undefined: its own template). */
const drawsAt = (c: JobClass, level: number, seeds: number[]) =>
  seeds.map((seed) => pickTask(c, level, { seed: seed * 2_654_435_761 }));
/** A class with at least two new kinds to tell apart. */
const sendsSeveral = (c: JobClass): boolean => {
  const open = openAt(c, MAX_LEVEL);
  return open.length >= 2 && !allLegacy(open);
};
const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, k) => from + k * step);

/** Ticks the game until `done`, at most `max` base ticks. */
function tickUntil(g: Game, done: () => boolean, max: number): void {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
}

/** Ticks the game with a bot serving the queue until a job is done, at most `max` ticks. */
function serveOne(g: Game, max: number): void {
  const op = new Operator(g, 1);
  let ticks = 0;
  while (g.completed < 1 && ticks < max) {
    g.advanceBaseTick();
    op.step();
    ticks++;
  }
}

const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
/** A maxed sandbox machine with the module `id` installed and an empty queue. */
function withTpm(id: string): Game {
  const g = maxed();
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(r.reason);
  }
  expect(g.install(r.invId).ok).toBe(true);
  g.clearQueue();
  g.advanceBaseTick();
  return g;
}
/** The scale a kind's key is spawned at: its own, else 2. */
const keyScale = (e: Task): number => e.scale ?? 2;
/** The TPM tier a kind needs (1 when it names none). */
function tpmTier(e: Task): number {
  const tpmNeed = taskNeeds(e).find((n): n is Extract<levelsTypes.Need, { kind: 'tpm' }> => n.kind === 'tpm');
  return tpmNeed?.minTier ?? 1;
}

/** The everyday kinds that need nothing from the machine. */
const NEED_NOTHING = tasks.filter((x) => taskNeeds(x).length === 0 && x.cls === 'cli');

/** Offers a network job on the link, as a client would. */
const offer = (g: Game, template: string, scale: number): boolean =>
  g.enqueue({ template, scale, cls: 'web', net: true });

/** Runs the game until a job is done (at most `max` ticks): the sizes of the uploads seen on the way. */
function uploadsUntilDone(g: Game, max: number): Set<number> {
  const up = new Set<number>();
  for (let t = 0; t < max && g.completed < 1; t++) {
    g.advanceBaseTick();
    for (const x of g.snapshot().net.transfers) {
      if (x.dir === 'up') {
        up.add(x.totalMB);
      }
    }
  }
  return up;
}

/** The network plan a kind asks for (1 when it names none). */
function netTier(e: Task): number {
  const [need] = taskNeeds(e);
  return need?.kind === 'net' ? (need.minTier ?? 1) : 1;
}
/** The download and upload speeds of each plan, by tier. */
const PLANS: Partial<Record<number, { down: number; up: number }>> = {
  1: { down: 50, up: 10 },
  2: { down: 200, up: 50 },
  3: { down: 1000, up: 300 },
};

describe('the catalogue', () => {
  it('every kind of job has its own template, in a class that exists, arriving no earlier than its class', () => {
    expect(new Set(tasks.map((e) => e.template)).size).toBe(tasks.length - tasks.filter((e) => e.id === 'web').length);
    for (const e of tasks) {
      const c = jobClass(e.cls);
      expect(c, `for ${e.id}`).toBeDefined();
      assert.exists(c);
      expect(taskLevel(e), `for ${e.id}`).toBeGreaterThanOrEqual(c.firstLevel);
      expect(taskLevel(e), `for ${e.id}`).toBeLessThanOrEqual(MAX_LEVEL);
      expect(taskOfTemplate(e.template)?.cls, `for ${e.id}`).toBe(e.cls);
    }
  });

  it('a class sends only the kinds its level has reached, and the first level sends its own template', () => {
    for (const c of JOB_CLASSES) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const open = openAt(c, level);
        const draws = drawsAt(c, level, range(1, 400, 7));
        for (const t of draws.filter((x) => x !== undefined)) {
          expect(
            open.map((e) => e.id),
            `${c.id} at level ${level}`,
          ).toContain(t.id);
        }
        // a draw of the class's own template is only allowed while every opened kind is an old one
        const ownTemplate = draws.filter((x) => x === undefined).map(() => allLegacy(open));
        expect(ownTemplate, `${c.id} at level ${level}`).not.toContain(false);
      }
    }
  });

  it('over many draws every kind a class has opened is sent', () => {
    for (const c of JOB_CLASSES.filter((x) => sendsSeveral(x))) {
      const open = openAt(c, MAX_LEVEL);
      const seen = new Set(
        drawsAt(c, MAX_LEVEL, range(1, 3000))
          .filter((t) => t !== undefined)
          .map((t) => t.id),
      );
      expect([...seen].toSorted(), `for ${c.id}`).toStrictEqual(open.map((e) => e.id).toSorted());
    }
  });

  it('the first levels play as they always did: the everyday class sends its own mixed template until a new kind has arrived', () => {
    const cli = jobClass('cli');
    assert.exists(cli);
    for (let seed = 1; seed < 200; seed++) {
      expect(pickTask(cli, 1, { seed: seed * 40_503 })).toBeUndefined();
    }
    expect(pickTask(cli, 3, { seed: 5 })).toBeUndefined();
    expect(pickTask(cli, 4, { seed: 5 })).toBeDefined();
  });
});

describe('each kind of job that needs nothing runs to the end in a game', () => {
  it.each(NEED_NOTHING)('$id ($template) is delivered and paid, and the log and the almanac know it by name', (e) => {
    const g = rig('ssd1', { keys: [{ template: e.template }] });
    expect(g.snapshot().tray[0]).toMatchObject({ type: e.id, cls: e.cls });
    g.powerButton();
    tickUntil(g, () => g.currentPhase() === 'idle-os', 400);
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    g.plugKey(firstTrayKeyId);
    tickUntil(g, () => g.completed >= 1, 4000);
    expect(g.completed, `for ${e.id}`).toBe(1);
    const s = g.snapshot();
    assert.exists(s.jobLog);
    expect(s.jobLog[0]).toMatchObject({ type: e.id, outcome: 'done' });
    assert.exists(s.dex);
    expect(s.dex.find((d) => d.id === e.id)).toMatchObject({ state: 'done', runs: 1 });
  });
});

describe('the trust jobs run against a TPM, and the one that wants the second module says so', () => {
  const secure = tasks
    .filter((x) => x.cls === 'secure' && x.template !== 'secure.sign')
    .map((e) => ({ e, id: e.id, template: e.template, tier: tpmTier(e) }));
  it.each(secure)(
    '$id ($template) runs and is paid with a TPM of tier $tier',
    ({ e, tier }) => {
      const g = withTpm(`tpm${tier}`);
      expect(g.spawnKey(e.template, keyScale(e)).ok).toBe(true);
      expect(g.snapshot().tray[0]).toMatchObject({ type: e.id, cls: 'secure', runnable: true });
      serveOne(g, 3000);
      expect(g.completed, `for ${e.id}`).toBe(1);
      expect(g.errors).toBe(0);
      const dex2 = g.snapshot().dex;
      assert.exists(dex2);
      expect(dex2.find((d) => d.id === e.id)).toMatchObject({ state: 'done', runs: 1 });
    },
    60_000,
  );

  it('the attestation burst is refused with the first module and runs with the second', () => {
    const g = withTpm('tpm1');
    g.spawnKey('secure.attest', 2);
    expect(g.snapshot().tray[0]).toMatchObject({
      runnable: false,
      missing: ['a second-generation TPM (Secure module 2)'],
      needs: ['TPM 2', 'ECC'],
    });
  });
});

describe('the network jobs travel over the link, each with its own sizes and the plan it wants', () => {
  it('a page is offered, downloaded, run, uploaded at its own size, and paid', () => {
    const g = netRig('ssd1');
    expect(offer(g, 'web.page', 2)).toBe(true);
    expect(g.snapshot().net.offers[0]).toMatchObject({ type: 'page', cls: 'web', runnable: true });
    const up = uploadsUntilDone(g, 3000);
    expect(g.completed).toBe(1);
    assert.exists(WEB_SIZES['page']);
    expect([...up]).toStrictEqual([WEB_SIZES['page'].upMB]);
    const jobLog2 = g.snapshot().jobLog;
    assert.exists(jobLog2);
    expect(jobLog2[0]).toMatchObject({ type: 'page', outcome: 'done' });
  });

  it('a kind that wants a faster plan is refused on a slower one, and runnable on a faster one', () => {
    const slow = netRig('ssd1', { isp: 'isp1' });
    offer(slow, 'web.search', 2);
    expect(slow.snapshot().net.offers[0]).toMatchObject({
      type: 'search',
      runnable: false,
      missing: ['a Cable plan or better'],
      needs: ['NET 2'],
    });
    const fast = netRig('ssd1', { isp: 'isp2', router: 'router2' });
    offer(fast, 'web.search', 2);
    expect(fast.snapshot().net.offers[0]).toMatchObject({ type: 'search', runnable: true });
  });

  it('every network kind has its sizes, and the slower leg of a kind that asks for the first plan fits its first plan', () => {
    for (const e of tasks.filter((x) => x.cls === 'web')) {
      const z = WEB_SIZES[e.id];
      assert.exists(z);
      expect(z, `for ${e.id}`).toBeDefined();
      const tier = netTier(e);
      const plan = must(PLANS[tier]);
      const ticks = Math.max(z.downMB / (plan.down / 8), z.upMB / (plan.up / 8));
      expect(ticks, `${e.id} on plan ${tier}`).toBeLessThan(120);
    }
  });
});
