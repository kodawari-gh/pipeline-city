import { describe, expect, it } from 'vitest';
import { runAoJob, type AoAsk, type AoJob } from './aojob';
import { inlinePool, makeAoPool, poolOf, poolSize, type AoEvents, type AoWorker } from './aopool';

const job = (cast = 0): AoJob => ({
  pos: new Float32Array(0),
  nrm: new Float32Array(0),
  tris: new Uint32Array(0),
  weld: new Int32Array(0),
  one: new Uint8Array(0),
  reach: 1,
  cast,
});

/** A worker that does nothing until the test answers for it. */
class Fake implements AoWorker {
  posted: AoAsk[] = [];
  stopped = false;
  constructor(readonly on: AoEvents) {}
  post(ask: AoAsk): void {
    this.posted.push(ask);
  }
  stop(): void {
    this.stopped = true;
  }
  /** Answer the `i`th job it was sent. */
  reply(i: number, ao = new Float32Array([i])): void {
    this.on.answer({ id: this.posted[i]!.id, ao });
  }
}

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
    expect([0, 1, 2, 3, 4, 5, 6, 16].map((c) => poolSize(c))).toEqual([0, 0, 0, 0, 2, 3, 3, 3]);
  });

  it('has no pool where there is no Worker (a test, a page that cannot)', () => {
    expect(typeof Worker).toBe('undefined');
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
    expect(fakes.map((f) => f.posted.length)).toEqual([1, 1]);
    fakes[1]!.reply(0, new Float32Array([7]));
    expect(await b).toEqual(new Float32Array([7]));
    // (the third job goes to the worker that is free: the second)
    expect(fakes.map((f) => f.posted.length)).toEqual([1, 2]);
    fakes[0]!.reply(0, new Float32Array([5]));
    fakes[1]!.reply(1, new Float32Array([9]));
    expect([await a, await c]).toEqual([new Float32Array([5]), new Float32Array([9])]);
  });

  it('fails the job of a worker that says it failed, stops that worker, and goes on with the others', async () => {
    const { pool: p, fakes } = pool(2);
    const a = p.run(job()),
      b = p.run(job());
    fakes[0]!.on.fail();
    await expect(a).rejects.toThrow('worker failed');
    expect(fakes[0]!.stopped).toBe(true);
    const c = p.run(job());
    // (the dead worker takes no more)
    expect(fakes[0]!.posted.length).toBe(1);
    expect(fakes[1]!.posted.length).toBe(1);
    fakes[1]!.reply(0);
    fakes[1]!.reply(1);
    expect([(await b).length, (await c).length]).toEqual([1, 1]);
  });

  it('fails what waits when no worker is left', async () => {
    const { pool: p, fakes } = pool(2);
    const all = [p.run(job()), p.run(job()), p.run(job())];
    const out = all.map((x) =>
      x.then(
        () => 'ok',
        (e: Error) => e.message,
      ),
    );
    fakes[0]!.on.fail();
    fakes[1]!.on.fail();
    expect(await Promise.all(out)).toEqual(['worker failed', 'worker failed', 'no worker left']);
    await expect(p.run(job())).rejects.toThrow('no worker left');
  });

  it('fails the one job a worker threw on, and keeps the worker', async () => {
    const { pool: p, fakes } = pool(1);
    const a = p.run(job()),
      b = p.run(job());
    fakes[0]!.on.answer({ id: fakes[0]!.posted[0]!.id, error: 'RangeError: too big' });
    await expect(a).rejects.toThrow('RangeError');
    expect(fakes[0]!.stopped).toBe(false);
    expect(fakes[0]!.posted.length).toBe(2);
    fakes[0]!.reply(1);
    expect((await b).length).toBe(1);
  });

  it('ignores an answer for a job it did not send that worker', async () => {
    const { pool: p, fakes } = pool(1);
    const a = p.run(job());
    fakes[0]!.on.answer({ id: 999, ao: new Float32Array(1) });
    let done = false;
    void a.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    fakes[0]!.reply(0);
    await a;
  });

  it('stops every worker on dispose, fails what is pending, and takes no more', async () => {
    const { pool: p, fakes } = pool(2);
    const out = [p.run(job()), p.run(job()), p.run(job())].map((x) =>
      x.then(
        () => 'ok',
        (e: Error) => e.message,
      ),
    );
    p.dispose();
    expect(fakes.every((f) => f.stopped)).toBe(true);
    expect(await Promise.all(out)).toEqual(['pool closed', 'pool closed', 'pool closed']);
    await expect(p.run(job())).rejects.toThrow('pool closed');
  });
});

describe('inlinePool', () => {
  /** One triangle in the plane z = 0, its three points cast. */
  const triangle = (): AoJob => ({
    pos: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tris: new Uint32Array([0, 1, 2]),
    weld: new Int32Array([0, 1, 2]),
    one: new Uint8Array(3),
    reach: 50,
    cast: 3,
  });

  it('casts here what it is asked: the same as `runAoJob`', async () => {
    const ao = await inlinePool().run(triangle());
    expect(ao).toEqual(runAoJob(triangle()));
    // (two open shares a point, an open plane: all 1)
    expect(Array.from(ao)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('rejects a job that cannot be cast, as a worker that fails does', async () => {
    await expect(inlinePool().run(job())).rejects.toThrow();
  });
});
