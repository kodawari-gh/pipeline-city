/// <reference lib="webworker" />
import { advance, handleMessage, newHost, recordCrash, takeCrash } from './host';
import type { FromSim, ToSim } from './protocol';

const post = (m: FromSim) => postMessage(m);
const host = newHost();
let last = performance.now();

onmessage = (e: MessageEvent<ToSim>) => {
  if (e.data.type === 'init') last = performance.now();
  for (const m of handleMessage(host, e.data)) post(m);
};

// At most ~10 snapshots per second, and only when something advanced.
// A throw (a machine fault, a bug) pauses the sim and posts a crash report instead of throwing again every tick.
setInterval(() => {
  const now = performance.now();
  try {
    const n = advance(host, now - last);
    last = now;
    if (n > 0 && host.game) post({ type: 'snapshot', snapshot: host.game.snapshot() });
  } catch (e) {
    last = now;
    recordCrash(host, e);
  }
  for (const m of takeCrash(host)) post(m);
}, 100);
