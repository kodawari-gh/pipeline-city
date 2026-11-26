import { assert, describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { JOB_DEX } from '../../jobs/sim/jobdex';
import {
  BENCH_GROUPS,
  BENCH_TASKS,
  benchable,
  benchIssue,
  benchTask,
  measureTask,
  overallOf,
  QUICK_TASKS,
  referenceBuild,
  referenceRig,
  REFERENCE_RATE,
  runBenchTasks,
} from './pcbench';
import type * as pcbenchTypes from './pcbench';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A machine with the stock crate only: no drive, card, network, OS, and 16 KB of RAM. */
const stock = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true });
const task = (id: string) => {
  const benchTaskResult = benchTask(id);
  assert.exists(benchTaskResult);
  return benchTaskResult;
};
const result = (r: pcbenchTypes.TaskResult[], id: string): pcbenchTypes.TaskResult => {
  const foundR = r.find((x) => x.id === id);
  assert.exists(foundR);
  return foundR;
};

/** An almanac entry that is a program the bench can run: built, not a contract, with a generator template. */
const isProgramEntry = (e: (typeof JOB_DEX)[number]): boolean =>
  e.contract !== true && e.planned !== true && e.template !== '';

/** A task result with this score, and a time when it has one. */
const taskResult = (score: number | null): pcbenchTypes.TaskResult => ({
  id: 'x',
  score,
  seconds: score === null ? null : 1,
});

describe('the tasks', () => {
  it('has a task for every program in the almanac, and the drive test', () => {
    const programs = JOB_DEX.filter((e) => isProgramEntry(e)).map((e) => e.id);
    expect(BENCH_TASKS.map((t) => t.id).toSorted()).toStrictEqual([...programs, 'disk'].toSorted());
    expect(new Set(BENCH_TASKS.map((t) => t.id)).size).toBe(BENCH_TASKS.length);
  });

  it("lists every task once, under the almanac's groups and then the drive", () => {
    expect(BENCH_GROUPS.flatMap((g) => g.tasks.map((t) => t.id)).toSorted()).toStrictEqual(
      BENCH_TASKS.map((t) => t.id).toSorted(),
    );
    expect(BENCH_GROUPS.map((g) => g.id)).toStrictEqual([
      'everyday',
      'memory',
      'network',
      'trust',
      'accel',
      'hpc',
      'system',
    ]);
    for (const g of BENCH_GROUPS) {
      expect(g.tasks.length, `for ${g.id}`).toBeGreaterThan(0);
    }
  });

  it('names real tasks in the quick set, one of each kind of work', () => {
    for (const id of QUICK_TASKS) {
      expect(benchTask(id), `for ${id}`).toBeDefined();
    }
    expect(new Set(QUICK_TASKS.map((id) => task(id).group)).size).toBeGreaterThanOrEqual(5);
  });

  it('has a reference rate for every task', () => {
    for (const t of BENCH_TASKS) {
      expect(REFERENCE_RATE[t.id], `for ${t.id}`).toBeGreaterThan(0);
    }
  });
});

describe('the score', () => {
  // Every task on the machine built for it scores about 1000 (when the sim's balance moves, the failing line names the rate to put in REFERENCE_RATE).
  it.each(BENCH_TASKS.map((t) => t.id))(
    'scores about 1000 on the reference machine: %s',
    async (id) => {
      const t = task(id);
      const r = await measureTask(referenceRig(t.rig), t);
      expect(r.note, `for ${id}`).toBeUndefined();
      expect(r.crashed, `for ${id}`).toBeUndefined();
      assert.exists(r.score);
      expect(Math.abs(r.score - 1000), `${id}: the rate is ${r.rate}`).toBeLessThanOrEqual(10);
    },
    60_000,
  );

  it('gives the same score for the same build, whatever else is picked', async () => {
    const alone = await runBenchTasks(referenceBuild(), ['crc']);
    const again = await runBenchTasks(referenceBuild(), ['crc']);
    const among = await runBenchTasks(referenceBuild(), ['fib', 'crc', 'disk']);
    expect(again).toStrictEqual(alone);
    expect(result(among, 'crc')).toStrictEqual(alone[0]);
  }, 60_000);

  it('scores a stronger build higher than a weaker one', async () => {
    const ids = ['crc', 'popcount'];
    const weak = await runBenchTasks(stock(), ids);
    const strong = await runBenchTasks(referenceBuild(), ids);
    for (const id of ids) {
      const score2 = result(strong, id).score;
      assert.exists(score2);
      expect(score2, `for ${id}`).toBeGreaterThan(must(result(weak, id).score));
    }
    expect(overallOf(strong)).toBeGreaterThan(overallOf(weak));
  }, 60_000);

  it('takes the geometric mean of the scores that have one', () => {
    const r = taskResult;
    expect(overallOf([r(1000), r(250), r(null)])).toBe(500);
    expect(overallOf([r(null)])).toBe(0);
    expect(overallOf([])).toBe(0);
  });

  it("does not count the crashes the player's machine had before", async () => {
    const g = referenceBuild();
    g.errors = 7;
    const [r] = await runBenchTasks(g, ['crc']);
    assert.exists(r);
    expect(r.crashed).toBeUndefined();
    expect(r.score).not.toBeNull();
  }, 60_000);
});

describe('what cannot run', () => {
  it('says what is missing, from the needs the almanac lists', () => {
    const g = stock();
    expect(benchIssue(g, task('stream'))).toMatch(/Needs .*RAM/u);
    expect(benchIssue(g, task('hashtab'))).toMatch(/Needs an OS and .*RAM/u);
    expect(benchIssue(g, task('page'))).toMatch(/ISP plan/u);
    expect(benchIssue(g, task('secure'))).toMatch(/Needs a TPM and ECC RAM/u);
    expect(benchIssue(g, task('attest'))).toMatch(/second-generation TPM/u);
    expect(benchIssue(g, task('hpc-reduce'))).toMatch(/Needs a CPU with 2 logical cores and .*OS/u);
    expect(benchIssue(g, task('disk'))).toMatch(/storage drive/u);
  });

  it('asks for the card in the jobs a card does', () => {
    const g = stock();
    expect(benchIssue(g, task('vadd'))).toMatch(/graphics card/u);
    expect(benchIssue(g, task('npu'))).toMatch(/AI card or a graphics card/u);
  });

  it('lets a bare machine run the plain jobs', () => {
    const g = stock();
    for (const id of ['log', 'crc', 'scan']) {
      expect(benchIssue(g, task(id)), `for ${id}`).toBeNull();
    }
    expect(benchable(g).map((t) => t.id)).toStrictEqual(expect.arrayContaining(['log', 'crc', 'scan']));
    expect(benchable(g).map((t) => t.id)).not.toContain('vadd');
    expect(benchable(g, ['crc', 'vadd']).map((t) => t.id)).toStrictEqual(['crc']);
  });

  it('finds nothing missing on the machine built for the task', () => {
    for (const t of BENCH_TASKS) {
      expect(benchIssue(referenceRig(t.rig), t), `for ${t.id}`).toBeNull();
    }
  }, 60_000);

  it('needs a sandbox game', () => {
    expect(benchIssue(new Game({ seed: 1 }), task('crc'))).toMatch(/sandbox/u);
  });

  it('gives a note instead of a score, and still runs the rest', async () => {
    const r = await runBenchTasks(stock(), ['crc', 'vadd', 'page']);
    expect(r.map((x) => x.id)).toStrictEqual(['crc', 'page', 'vadd']);
    expect(result(r, 'crc').score).not.toBeNull();
    expect(result(r, 'vadd')).toMatchObject({ score: null, seconds: null });
    expect(result(r, 'vadd').note).toMatch(/graphics card/u);
    expect(result(r, 'page').note).toMatch(/ISP plan/u);
  }, 60_000);
});

describe('a run', () => {
  it("reports each task to the callbacks in the almanac's order", async () => {
    const started: string[] = [],
      got: string[] = [];
    const out = await runBenchTasks(stock(), ['crc', 'fib', 'vadd'], {
      onStart: (t, i, n) => {
        started.push(`${t.id} ${i + 1}/${n}`);
      },
      onResult: (r, t) => {
        got.push(`${t.id}:${r.id}`);
      },
    });
    expect(started).toStrictEqual(['fib 1/3', 'crc 2/3', 'vadd 3/3']);
    expect(got).toStrictEqual(['fib:fib', 'crc:crc', 'vadd:vadd']);
    expect(out.map((r) => r.id)).toStrictEqual(['fib', 'crc', 'vadd']);
  }, 60_000);

  it('stops when asked, with no result for the task it was in', async () => {
    const stop = { aborted: false },
      started: string[] = [];
    const out = await runBenchTasks(stock(), ['log', 'calc', 'fib'], {
      stop,
      onStart: (t) => {
        started.push(t.id);
      },
      onResult: () => {
        stop.aborted = true;
      },
    });
    expect(started).toStrictEqual(['log']);
    expect(out.map((r) => r.id)).toStrictEqual(['log']);
    const mid = { aborted: false };
    const cut = await runBenchTasks(stock(), ['crc'], {
      stop: mid,
      onStart: () => {
        setTimeout(() => {
          mid.aborted = true;
        }, 0);
      },
    });
    expect(cut).toStrictEqual([]);
  }, 60_000);

  it('leaves the game it was given unchanged', async () => {
    const g = referenceBuild();
    const before = JSON.stringify(g.toSave());
    await runBenchTasks(g, ['crc', 'page', 'disk']);
    expect(JSON.stringify(g.toSave())).toBe(before);
    expect(g.powered).toBe(false);
  }, 60_000);
});
