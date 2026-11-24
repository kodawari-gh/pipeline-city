// A few workers that cast the baked occlusion's groups side by side (`vertexAoPooled`, `aojob.worker.ts`). The boot waits for the cast: with the
// workers it takes as long as the largest group (0.25 s), in place of all the groups in a row on the page's thread (0.8 s). Without `Worker`, or
// on a machine with few cores, there is no pool and the page casts the groups itself (`vertexAoSteps`).
import { runAoJob, type AoAnswer, type AoAsk, type AoJob } from './aojob';

/** A way to cast jobs off the page's thread. A job that fails rejects: the caller casts it itself (`runAoJob`). */
export interface AoPool {
  run(job: AoJob): Promise<Float32Array>;
  dispose(): void;
}

/** What the pool needs of a worker: it posts a job, and stops. */
export interface AoWorker {
  post(ask: AoAsk): void;
  stop(): void;
}

/** What a worker tells the pool: an answer, or that it died (it did not load, it threw). */
export interface AoEvents {
  answer(a: AoAnswer): void;
  fail(): void;
}

/** The workers to start for a number of cores: the cores less two (the page's thread and the GPU process), three at most (the largest group is a third of the work); none under four cores. */
export const poolSize = (
  cores: number = typeof navigator === 'undefined' ? 0 : navigator.hardwareConcurrency || 0,
): number => (cores < 4 ? 0 : Math.min(3, cores - 2));

interface Waiting {
  id: number;
  job: AoJob;
  done: (ao: Float32Array) => void;
  fail: (e: Error) => void;
}
interface Slot {
  w: AoWorker;
  at: Waiting | null;
  dead: boolean;
}

/**
 * A pool of `size` workers made by `spawn`: a job goes to the first worker that is free and waits for one if none is. A worker that dies fails
 * the job it held and takes no more; with none left, what waits fails.
 */
export function poolOf(spawn: (on: AoEvents) => AoWorker, size: number): AoPool {
  const slots: Slot[] = [],
    waiting: Waiting[] = [];
  let next = 0,
    over = false;
  const pump = (): void => {
    for (const s of slots) {
      if (s.dead || s.at) continue;
      const w = waiting.shift();
      if (!w) return;
      s.at = w;
      s.w.post({ id: w.id, job: w.job });
    }
    if (slots.every((s) => s.dead)) for (const w of waiting.splice(0)) w.fail(new Error('no worker left'));
  };
  for (let i = 0; i < size; i++) {
    const s = { w: null as unknown as AoWorker, at: null, dead: false } as Slot;
    s.w = spawn({
      answer: (a) => {
        const w = s.at;
        if (!w || w.id !== a.id) return;
        s.at = null;
        if ('error' in a) w.fail(new Error(a.error));
        else w.done(a.ao);
        pump();
      },
      fail: () => {
        if (s.dead) return;
        s.dead = true;
        s.w.stop();
        const w = s.at;
        s.at = null;
        w?.fail(new Error('worker failed'));
        pump();
      },
    });
    slots.push(s);
  }
  return {
    run: (job) =>
      new Promise((done, fail) => {
        if (over) {
          fail(new Error('pool closed'));
          return;
        }
        waiting.push({ id: next++, job, done, fail });
        pump();
      }),
    dispose: () => {
      over = true;
      for (const s of slots) {
        if (!s.dead) s.w.stop();
        s.dead = true;
        s.at?.fail(new Error('pool closed'));
        s.at = null;
      }
      for (const w of waiting.splice(0)) w.fail(new Error('pool closed'));
    },
  };
}

/** A real worker (`aojob.worker.ts`) for the pool. */
function spawnWorker(on: AoEvents): AoWorker {
  const w = new Worker(new URL('aojob.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<AoAnswer>) => on.answer(e.data);
  w.onerror = () => on.fail();
  w.onmessageerror = () => on.fail();
  return { post: (ask) => w.postMessage(ask), stop: () => w.terminate() };
}

/** A pool of workers, or null where there can be none (no `Worker`, a page in a test, too few cores). Call `dispose` when the casts are done. */
export function makeAoPool(size: number = poolSize()): AoPool | null {
  if (typeof Worker === 'undefined' || size < 2) return null;
  const made: AoWorker[] = [];
  try {
    return poolOf((on) => {
      const w = spawnWorker(on);
      made.push(w);
      return w;
    }, size);
  } catch {
    for (const w of made) w.stop();
    return null;
  }
}

/** A pool that casts here, a turn after it is asked: the pooled way's code without a worker (the tests', and any caller's). */
export const inlinePool = (): AoPool => ({
  run: (job) =>
    new Promise((done, fail) =>
      setTimeout(() => {
        try {
          done(runAoJob(job));
        } catch (e) {
          fail(e as Error);
        }
      }, 0),
    ),
  dispose: () => undefined,
});
