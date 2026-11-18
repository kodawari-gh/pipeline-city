/// <reference lib="webworker" />
import { runAoJob, type AoAnswer, type AoAsk } from './aojob';

// A worker of the baked occlusion's pool (`aopool.ts`): it casts the job in each message and sends the open shares back (by transfer).
const scope = self as unknown as DedicatedWorkerGlobalScope;
const answer = (a: AoAnswer, transfer: Transferable[] = []): void => scope.postMessage(a, transfer);

scope.onmessage = (e: MessageEvent<AoAsk>) => {
  const { id, job } = e.data;
  try {
    const ao = runAoJob(job);
    answer({ id, ao }, [ao.buffer]);
  } catch (err) {
    answer({ id, error: String(err) });
  }
};
