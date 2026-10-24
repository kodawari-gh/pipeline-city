// Speed benchmark for the sandbox. Not a test: `npm run bench:speed` loads this file through Vite (tools/bench-speed.mjs),
// so `npm test` never runs it. It drives the host loop the worker runs (src/sim/worker.ts: `advance` with the wall time
// since the last call, then a snapshot when something advanced) on a busy high-end sandbox build: powered, the OS on
// NVMe, a job running all the time. Two measurements per speed:
//   - flat out: back-to-back calls, each 100 ms of game time, for the ticks this machine simulates per second when
//     nothing waits. That gives the cost of one tick and the ceiling;
//   - paced: 8 s of real time with the worker's 100 ms timer, the ticks really delivered against the ticks owed.
// Output lines start with "SPEED". The write-up is in docs/SANDBOX.md.
import { advance, newHost, type HostState } from "../host";
import { Game } from "../game/game";
import { Operator } from "../game/operator";
import type { Speed } from "../protocol";

export const BENCH_SPEEDS: Speed[] = [1, 4, 16, 64];

/** The top of every ladder: Enthusiast board, cpu2, ram2, the 250 W PSU, liquid cooler, VRM fins with fan, NVMe with the OS. */
export function highEndBuild(): Game {
  const g = new Game({ seed: 5, sandbox: true, preassembled: true });
  // Each part is installed before the next is bought: a purchase is checked against the PSU that is installed now.
  for (const id of ["board3", "psu2", "cpu2", "ram2", "cooler2", "vsink2", "nvme2", "os1"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  const op = new Operator(g);
  op.assemble(true); // cables, then power on
  for (let t = 0; t < 1200 && !g.snapshot().os?.up; t++) { keepBusy(g); g.advanceBaseTick(); op.step(); } // cold boot, OS boot
  if (!g.powered || !g.snapshot().os?.up) throw new Error(`high-end build did not come up (phase ${g.currentPhase()})`);
  return g;
}

/** Keep the OS busy: the longest scan job (scale 16) whenever the tray runs low, the way a player would keep it stocked. */
const keepBusy = (g: Game): void => {
  if (g.trayKeyIds().length < 3) g.spawnKey("cli.scan", 16);
};

interface Call { ticks: number; advMs: number; snapMs: number; snapped: boolean; running: boolean; phase: string }

/** One worker call: advance by `elapsedMs` of wall time, then the snapshot the worker posts when something advanced. */
function call(g: Game, host: HostState, elapsedMs: number): Call {
  const a = performance.now();
  const ticks = advance(host, elapsedMs);
  const b = performance.now();
  if (ticks === 0) return { ticks, advMs: b - a, snapMs: 0, snapped: false, running: false, phase: "" };
  const snap = g.snapshot();
  const c = performance.now();
  return { ticks, advMs: b - a, snapMs: c - b, snapped: true, running: snap.os?.runningKeyId != null, phase: snap.phase };
}

function machine(speed: Speed): { g: Game; host: HostState; op: Operator } {
  const g = highEndBuild();
  const host = newHost();
  host.game = g;
  host.speed = speed;
  const op = new Operator(g);
  for (let i = 0; i < 300 && g.baseTick < 300; i++) { keepBusy(g); op.step(); call(g, host, 100); } // warm-up, not timed
  return { g, host, op };
}

/** Flat out: back-to-back calls, each 100 ms of game time, until `targetTicks` ticks have run. */
export function flatOut(speed: Speed, targetTicks = 1500): Record<string, number | string> {
  const { g, host, op } = machine(speed);
  let ticks = 0, advMs = 0, snapMs = 0, snaps = 0, samples = 0, running = 0;
  // Ticks and time split by phase: `running-os` is a job on the CPU, the rest is the OS waiting on USB or the CPU idling.
  const busy = { ticks: 0, ms: 0 }, other = { ticks: 0, ms: 0 };
  const callMs: number[] = [];
  const phases = new Map<string, number>();
  while (ticks < targetTicks) {
    keepBusy(g);
    op.step();
    const r = call(g, host, 100);
    ticks += r.ticks;
    advMs += r.advMs;
    snapMs += r.snapMs;
    callMs.push(r.advMs + r.snapMs);
    const grp = r.running ? busy : other;
    grp.ticks += r.ticks;
    grp.ms += r.advMs;
    if (r.snapped) {
      snaps++;
      samples++;
      if (r.running) running++;
      phases.set(r.phase, (phases.get(r.phase) ?? 0) + 1);
    }
  }
  callMs.sort((x, y) => x - y);
  const msPerTick = advMs / ticks;
  const msPerSnap = snaps > 0 ? snapMs / snaps : 0;
  const msBusy = busy.ticks ? busy.ms / busy.ticks : NaN;
  // The worker's second: 10 calls, each with a snapshot, and the rest is ticks. The busy figure is the one to plan for.
  const ceiling = (1000 - 10 * msPerSnap) / (busy.ticks ? msBusy : msPerTick);
  return {
    speed: `${speed}x`,
    ticks,
    msPerTick: +msPerTick.toFixed(3),
    msPerTickJobRunning: +msBusy.toFixed(3),
    msPerTickOther: other.ticks ? +(other.ms / other.ticks).toFixed(3) : NaN,
    msPerSnapshot: +msPerSnap.toFixed(3),
    ticksPerSecondFlatOut: Math.round(ticks / ((advMs + snapMs) / 1000)),
    ceilingX: Math.floor(ceiling),
    snapshotKB: Math.round(JSON.stringify(g.snapshot()).length / 1024), // what the main thread receives (structured clone is similar)
    p95CallMs: +callMs[Math.floor(callMs.length * 0.95)]!.toFixed(2),
    maxCallMs: +callMs[callMs.length - 1]!.toFixed(2),
    jobRunningShare: samples ? +(running / samples).toFixed(3) : 0,
    phases: [...phases].map(([p, n]) => `${p}:${n}`).join(" "),
  };
}

/** Paced: `seconds` of real time with the worker's 100 ms interval. Ticks delivered against the ticks owed (speed x wall time). */
export function paced(speed: Speed, seconds = 8): Promise<Record<string, number | string>> {
  const { g, host, op } = machine(speed);
  host.owed = 0; // the warm-up's fraction of a tick is not part of the run
  return new Promise((resolve) => {
    let last = performance.now();
    const t0 = last;
    let ticks = 0;
    let worst = 0;
    const id = setInterval(() => {
      const now = performance.now();
      keepBusy(g);
      op.step();
      const r = call(g, host, now - last);
      last = now;
      ticks += r.ticks;
      worst = Math.max(worst, r.advMs + r.snapMs);
      const elapsed = (now - t0) / 1000;
      if (elapsed >= seconds) {
        clearInterval(id);
        resolve({
          speed: `${speed}x`,
          seconds: +elapsed.toFixed(2),
          achievedTicksPerSec: +(ticks / elapsed).toFixed(2),
          deliveredShare: +(ticks / (speed * elapsed)).toFixed(3),
          worstCallMs: +worst.toFixed(2),
        });
      }
    }, 100);
  });
}

/** Runs every measurement and prints one "SPEED" line each. */
export async function main(): Promise<void> {
  console.log(`SPEED start ${new Date().toISOString()} cores ${navigator.hardwareConcurrency}`);
  for (const s of BENCH_SPEEDS) console.log("SPEED flat", JSON.stringify(flatOut(s)));
  for (const s of BENCH_SPEEDS) console.log("SPEED paced", JSON.stringify(await paced(s)));
}
