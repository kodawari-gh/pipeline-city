/// <reference lib="webworker" />
import type { FromSim, ToSim } from './protocol';

// Placeholder sim: a cycle counter. Real engines (unpipelined, in-order,
// out-of-order) and the device bus will live under src/sim/.
let cycle = 0;
let money = 0;
let cps = 60;

const post = (m: FromSim) => postMessage(m);

onmessage = (e: MessageEvent<ToSim>) => {
  const m = e.data;
  if (m.type === 'init') {
    money = m.save?.money ?? 0;
    post({ type: 'ready' });
  } else if (m.type === 'setSpeed') {
    cps = m.cyclesPerSecond;
  }
};

setInterval(() => {
  cycle += cps / 20;
  money += cps / 20;
  post({ type: 'snapshot', snapshot: { cycle: Math.floor(cycle), money: Math.floor(money) } });
}, 50);
