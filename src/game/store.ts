import { signal } from '@preact/signals';
import type { FromSim, SaveV1, Snapshot } from '../sim/protocol';

export const snapshot = signal<Snapshot>({ cycle: 0, money: 0 });

export function startSim(save: SaveV1 | null) {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromSim>) => {
    if (e.data.type === 'snapshot') snapshot.value = e.data.snapshot;
  };
  worker.postMessage({ type: 'init', save });
  return worker;
}
