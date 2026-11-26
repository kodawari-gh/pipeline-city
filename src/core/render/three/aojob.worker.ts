/// <reference lib="webworker" />
import { runAoJob } from './aojob';
import type * as aojobTypes from './aojob';

// A worker of the baked occlusion's pool (`aopool.ts`): it casts the job in each message and sends the open shares back (by transfer).
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const answer = (a: aojobTypes.AoAnswer, transfer: Transferable[] = []): void => scope.postMessage(a, transfer);

scope.onmessage = (e: MessageEvent<aojobTypes.AoAsk>) => {
  const { id, job } = e.data;
  try {
    const ao = runAoJob(job);
    answer({ id, ao }, [ao.buffer]);
  } catch (err) {
    answer({ id, error: String(err) });
  }
};
