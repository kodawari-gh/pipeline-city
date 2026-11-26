import { describe, expect, it } from 'vitest';
import { runAoJob } from './aojob';
import type * as aojobTypes from './aojob';
import { inlinePool, makeAoPool, poolOf, poolSize } from './aopool';
import type * as aopoolTypes from './aopool';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const job = (cast = 0): aojobTypes.AoJob => ({
  pos: new Float32Array(0),
  nrm: new Float32Array(0),
  tris: new Uint32Array(0),
  weld: new Int32Array(0),
  one: new Uint8Array(0),
  reach: 1,
  cast,
});

/** A worker that does nothing until the test answers for it. */
class Fake implements aopoolTypes.AoWorker {
  posted: aojobTypes.AoAsk[] = [];
  stopped = false;
  constructor(readonly on: aopoolTypes.AoEvents) {}
  post(ask: aojobTypes.AoAsk): void {
    this.posted.push(ask);
  }
  stop(): void {
    this.stopped = true;
  }
  /** Answer the `i`th job it was sent. */
  reply(i: number, ao = new Float32Array([i])): void {
    this.on.answer({ id: must(this.posted[i]).id, ao });
  }
}

/** How a job ended: 'ok', or the message it failed with. */
async function outcome(x: Promise<unknown>): Promise<string> {
  try {
    await x;
    return 'ok';
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Sets `flag.done` once `p` has settled well. */
async function markWhenDone(p: Promise<unknown>, flag: { done: boolean }): Promise<void> {
  await p;
  flag.done = true;
}
/** One triangle in the plane z = 0, its three points cast. */
const triangle = (): aojobTypes.AoJob => ({
  pos: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
  nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  tris: new Uint32Array([0, 1, 2]),
  weld: new Int32Array([0, 1, 2]),
  one: new Uint8Array(3),
  reach: 50,
  cast: 3,
});

function pool(size: number): { pool: ReturnType<typeof poolOf>; fakes: Fake[] } {
  const fakes: Fake[] = [];
  return {
    pool: poolOf((on) => {
      const f = new Fake(on);
      fakes.push(f);
      return f;
    }, size),
    fakes,
  };
}

describe('poolSize', () => {
  it('leaves the page two cores, takes three workers at most, and none on a small machine', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 16].map((c) => poolSize(c))).toStrictEqual([0, 0, 0, 0, 2, 3, 3, 3]);
  });

  it('has no pool where there is no Worker (a test, a page that cannot)', () => {
    expect('Worker' in globalThis).toBe(false);
    expect(makeAoPool()).toBeNull();
    expect(makeAoPool(3)).toBeNull();
  });
});

describe('poolOf', () => {
  it('sends a job to each free worker, queues the rest, and sends the next to the first worker to answer', async () => {
    const { pool: p, fakes } = pool(2);
    const a = p.run(job()),
      b = p.run(job()),
      c = p.run(job());
    expect(fakes.map((f) => f.posted.length)).toStrictEqual([1, 1]);
    must(fakes[1]).reply(0, new Float32Array([7]));
    await expect(b).resolves.toStrictEqual(new Float32Array([7]));
    // (the third job goes to the worker that is free: the second)
    expect(fakes.map((f) => f.posted.length)).toStrictEqual([1, 2]);
    must(fakes[0]).reply(0, new Float32Array([5]));
    must(fakes[1]).reply(1, new Float32Array([9]));
    expect([await a, await c]).toStrictEqual([new Float32Array([5]), new Float32Array([9])]);
  });

  it('fails the job of a worker that says it failed, stops that worker, and goes on with the others', async () => {
    const { pool: p, fakes } = pool(2);
    const a = p.run(job()),
      b = p.run(job());
    must(fakes[0]).on.fail();
    await expect(a).rejects.toThrow('worker failed');
    expect(must(fakes[0]).stopped).toBe(true);
    const c = p.run(job());
    // (the dead worker takes no more)
    expect(must(fakes[0]).posted).toHaveLength(1);
    expect(must(fakes[1]).posted).toHaveLength(1);
    must(fakes[1]).reply(0);
    must(fakes[1]).reply(1);
    const doneB = await b,
      doneC = await c;
    expect([doneB.length, doneC.length]).toStrictEqual([1, 1]);
  });

  it('fails what waits when no worker is left', async () => {
    const { pool: p, fakes } = pool(2);
    const all = [p.run(job()), p.run(job()), p.run(job())];
    const out = all.map(async (x) => outcome(x));
    must(fakes[0]).on.fail();
    must(fakes[1]).on.fail();
    await expect(Promise.all(out)).resolves.toStrictEqual(['worker failed', 'worker failed', 'no worker left']);
    await expect(p.run(job())).rejects.toThrow('no worker left');
  });

  it('fails the one job a worker threw on, and keeps the worker', async () => {
    const { pool: p, fakes } = pool(1);
    const a = p.run(job()),
      b = p.run(job());
    must(fakes[0]).on.answer({ id: must(must(fakes[0]).posted[0]).id, error: 'RangeError: too big' });
    await expect(a).rejects.toThrow('RangeError');
    expect(must(fakes[0]).stopped).toBe(false);
    expect(must(fakes[0]).posted).toHaveLength(2);
    must(fakes[0]).reply(1);
    await expect(b).resolves.toHaveLength(1);
  });

  it('ignores an answer for a job it did not send that worker', async () => {
    const { pool: p, fakes } = pool(1);
    const a = p.run(job());
    must(fakes[0]).on.answer({ id: 999, ao: new Float32Array(1) });
    const flag = { done: false },
      watching = markWhenDone(a, flag);
    await Promise.resolve();
    expect(flag.done).toBe(false);
    must(fakes[0]).reply(0);
    await watching;
  });

  it('stops every worker on dispose, fails what is pending, and takes no more', async () => {
    const { pool: p, fakes } = pool(2);
    const out = [p.run(job()), p.run(job()), p.run(job())].map(async (x) => outcome(x));
    p.dispose();
    expect(fakes.every((f) => f.stopped)).toBe(true);
    await expect(Promise.all(out)).resolves.toStrictEqual(['pool closed', 'pool closed', 'pool closed']);
    await expect(p.run(job())).rejects.toThrow('pool closed');
  });
});

describe('inlinePool', () => {
  it('casts here what it is asked: the same as `runAoJob`', async () => {
    const ao = await inlinePool().run(triangle());
    expect(ao).toStrictEqual(runAoJob(triangle()));
    // (two open shares a point, an open plane: all 1)
    expect([...ao]).toStrictEqual([1, 1, 1, 1, 1, 1]);
  });

  it('rejects a job that cannot be cast, as a worker that fails does', async () => {
    await expect(inlinePool().run(job())).rejects.toThrow(RangeError);
  });
});
