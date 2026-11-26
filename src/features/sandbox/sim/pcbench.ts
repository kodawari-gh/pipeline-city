// "Build my PC" benchmark: the almanac's jobs, run on a copy of the machine and scored against a reference machine. Pure TS, no DOM.
//
// Tasks (`benchtasks.ts`, which a screen loads alone). Every kind of job in the almanac is a task: the player picks any of them, one or a set. One more is not
// a job, the drive test: no job reads a drive in place, so it drives the OS drive's port directly (64 sequential block reads, then 64 scattered ones, stride 37;
// the port's own clock sets the time).
//
// A run. A task runs its generator template at `BenchTask.scale` on a fresh copy of the machine (`Game.fromSave`): no keys, no inventory (so the bot installs
// nothing), no arrivals (`setJobClasses` turns them all off), a fixed random state. Same build and same task, same score, whatever else was picked. The copy
// boots (OS up, link up for a network job), the key is added with `spawnKey` and the game's own bot plugs it. The time is the game's execution time,
// `Game.lastCompleted.execTicks`: one base tick is one simulated second at 1x. The work is `Key.work`, the reference step count of the program, the same
// on every machine. So rate = work / seconds (the drive test: bytes / seconds).
//
// Score. score = 1000 x rate / REFERENCE_RATE[task], rounded. The reference is a machine built for the task (`referenceRig`): a mid machine (Mainstream
// board, 250 W PSU, cpu2, ram2, NVMe with the OS, GbE card, router and a Cable plan, a GPU and an NPU) that has what the job needs too (a fibre plan, a TPM
// with ECC memory, a multicore CPU under OS 4). It scores about 1000 on its task, by construction (`pcbench.test.ts`). Higher is better. overall = the
// geometric mean of the scores that are not null (0 when none is).
//
// What cannot run says why (`benchIssue`, from the needs the almanac lists, and a card for the jobs a card does: without one they run on the CPU for
// minutes). A machine that crashes during a run (a thermal error, a VRM droop) says so: the time includes the restarts, and after `CRASH_LIMIT` it stops.
// A machine that does not start or stops says the cause (`stoppedBy`: the power button does nothing, the power-on check fails, the supply trips, a part burns out),
// and one that runs slower than its parts allow says why (`TaskResult.slowed`: a supply too small, a part that ran hot): no silent low score.
//
// Cost. Every task boots its own copy (8 to 13 base ticks with an OS) and runs 20 to 1900 base ticks, about 0.3 ms each (a threaded job 0.5 ms): all 51 tasks
// take about 6 s on the reference machine, a weaker machine up to 4 times longer. The run is sliced: it gives the event loop a turn every `SLICE_MS`, so the
// 3D stage keeps drawing, and it stops at once on `Stop.aborted`. A job that has run 8 times the reference time is given up (`LIMIT_FACTOR`).

import { Game } from '@/worker/game/game';
import { Prng } from '@/core/sim/prng';
import { BLOCK_BYTES, PchPhase, STORAGE_REG } from '@/core/sim/memmap';
import { deviceSpec, fullDrawW, installedPsu, type DeviceKind } from '../../board/sim';
import { KIND_NAME } from '../../board/sim/buildalerts';
import { Operator } from '../../economy/sim/operator';
import { describeNeed, JOB_CLASSES, needsMet, type Need } from '../../economy/sim/levels';
import { getOsSpec } from '../../os/sim';
import { BENCH_TASKS, type BenchTask, type RigId, type TaskResult } from './benchtasks';

export {
  BENCH_GROUPS,
  BENCH_TASKS,
  benchTask,
  overallOf,
  QUICK_TASKS,
  type BenchGroup,
  type BenchTask,
  type RigId,
  type TaskResult,
} from './benchtasks';

/** Where a run is stopped from: set `aborted` and it ends at the next tick. */
export interface Stop {
  aborted: boolean;
}

// ---------- the reference ----------

/**
 * Rate of the reference machine per task (work per second; the drive test in bytes per second), measured by `measureTask` on `referenceRig(task.rig)`.
 * `pcbench.test.ts` checks every task scores about 1000 there: when the sim's balance moves it names the rate to put here.
 */
export const REFERENCE_RATE: Record<string, number> = {
  // everyday
  log: 1.77143,
  calc: 1.77778,
  checksum: 1.22,
  fib: 4.925,
  reverse: 3.37705,
  gcd: 6,
  popcount: 10.6349,
  sort: 7.87342,
  matmul: 13.2105,
  crc: 19.1266,
  // memory
  scan: 1.86139,
  chase: 1.15134,
  stream: 8.31338,
  stencil: 12.1754,
  transpose: 8.24375,
  sieve: 27.6903,
  db: 1.88924,
  hashtab: 4.15318,
  // network
  page: 5.65385,
  api: 2.51389,
  dns: 6.65517,
  form: 15.2874,
  search: 9.39167,
  upload: 4.45455,
  image: 9.54599,
  video: 6.52263,
  // trust
  secure: 8.21429,
  verify: 5.30435,
  measure: 5.78125,
  encrypt: 18.1667,
  vault: 6.84615,
  rotate: 6.7907,
  attest: 7.69231,
  // accelerators
  vadd: 286.821,
  saxpy: 297.161,
  thresh: 279.35,
  blur3: 331.095,
  poly: 303.014,
  mandel: 362.288,
  sphere: 314.473,
  perceptron: 24.1506,
  npu: 24.1381,
  deep: 26.8726,
  // high-performance
  'hpc-reduce': 4.2525,
  'hpc-matmul': 15.7363,
  'hpc-nbody': 16.7271,
  'hpc-montecarlo': 16.3443,
  'hpc-sort': 19.1457,
  'hpc-bfs': 10.672,
  'hpc-fft': 9.72032,
  // the drive test (bytes per second)
  disk: 20605.2,
};

/** The mid machine the reference rates are measured on (see the header). Exported for the test and for re-measuring. */
export function referenceBuild(): Game {
  return rig({});
}

const MID = {
  board: 'board2',
  psu: 'psu2',
  cpu: 'cpu2',
  ram: 'ram2',
  storage: 'nvme2',
  nic: 'nic1',
  router: 'router2',
  gpu: 'gpu1',
  npu: 'npu1',
  os: 'os1',
};

function rig(over: Partial<Record<keyof typeof MID | 'tpm', string>>, isp = 'isp2'): Game {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true });
  // (the stock stick holds 16K and is not ECC: a rig with its own memory drops it)
  if (over.ram) for (const d of g.snapshot().devices) if (d.kind === 'ram') g.uninstall(d.id);
  for (const id of Object.values({ ...MID, ...over })) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`reference build: buy ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`reference build: install ${id}: ${r.reason}`);
  }
  const plan = g.purchase(isp); // a plan needs no install: it is the link's ISP
  if (!plan.ok) throw new Error(`reference build: ${isp}: ${plan.reason}`);
  const lan = g.connectLan();
  if (!lan.ok) throw new Error(`reference build: lan: ${lan.reason}`);
  return g;
}

/** The biggest machine with only a CPU (and two sticks of memory: more draw the memory VRM down under a threaded load) of its own. */
function coresRig(cpu: string): Game {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  let kept = 0;
  for (const d of g.snapshot().devices) if (d.kind === 'ram' && ++kept > 2) g.uninstall(d.id);
  const b = g.purchase(cpu);
  if (!b.ok) throw new Error(`reference build: buy ${cpu}: ${b.reason}`);
  const r = g.install(b.invId);
  if (!r.ok) throw new Error(`reference build: install ${cpu}: ${r.reason}`);
  return g;
}

/** The machine a task is scored against: the mid machine, plus what the job needs (ECC memory and a TPM, a fibre plan) or, for the threaded jobs, a multicore CPU on the biggest shell. */
export function referenceRig(id: RigId): Game {
  switch (id) {
    case 'mid':
      return rig({});
    case 'fibre':
      return rig({}, 'isp3');
    case 'trust':
      return rig({ ram: 'ram3', tpm: 'tpm1' });
    case 'trust2':
      return rig({ ram: 'ram3', tpm: 'tpm2' });
    case 'cores2':
      return coresRig('cpu2d');
    case 'cores4':
      return coresRig('cpu3t');
    case 'cores8':
      return coresRig('cpu5s');
  }
}

// ---------- what can run ----------

/** A need, as the bench says it (the almanac's phrase for the OS and the cores does not name the tier or the count). */
function say(n: Need): string {
  if (n.kind === 'os') return n.min > 1 ? `${getOsSpec(`os${n.min}`)?.name ?? `OS ${n.min}`} or newer` : 'an OS';
  if (n.kind === 'cores') return `a CPU with ${n.min} logical cores`;
  return describeNeed(n).long;
}

/** "a", "a and b", "a, b and c". */
const listOf = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const has = (game: Game, kind: string): boolean =>
  game.board.devices.some((d) => !d.burnt && deviceSpec(d).kind === kind);

/**
 * Why each of the tasks (all when `ids` is omitted) cannot run on this machine as it stands; null when it can. The machine is not run: this reads the parts
 * and the link's wiring (a plan, a router, the cable, an OS and its memory; whether the link is up needs the machine on). Worked out once for all of them.
 */
export function benchIssues(game: Game, ids?: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const tasks = BENCH_TASKS.filter((t) => !ids || ids.includes(t.id));
  if (!game.sandbox) return new Map(tasks.map((t) => [t.id, 'The benchmark needs a sandbox game']));
  const link = game.computeLink();
  const wired = link.state !== 'no-device' && link.state !== 'no-cable' && link.state !== 'no-os' && link.port.mbps > 0;
  const caps = game.capsWith(wired),
    gpu = has(game, 'gpu'),
    npu = has(game, 'npu');
  for (const t of tasks) {
    const missing = t.needs.filter((n) => !needsMet([n], caps).ok);
    let why: string | null = null;
    if (t.template === null) why = has(game, 'storage') ? null : 'Needs a storage drive';
    else if (!wired && missing.some((n) => n.kind === 'net'))
      why = link.reason ? `${link.reason.charAt(0).toUpperCase()}${link.reason.slice(1)}` : 'Needs a network link';
    else if (missing.length > 0) why = `Needs ${listOf(missing.map(say))}`;
    else if (t.accel === 'gpu' && !gpu)
      why = 'Needs a graphics card: without one it runs on the CPU, many times slower';
    else if (t.accel === 'npu' && !npu && !gpu)
      why = 'Needs an AI card or a graphics card: without one it runs on the CPU, many times slower';
    out.set(t.id, why);
  }
  return out;
}

/** Why this task cannot run on this machine as it stands, or null when it can (`benchIssues` for one). */
export const benchIssue = (game: Game, task: BenchTask): string | null =>
  benchIssues(game, [task.id]).get(task.id) ?? null;

/** The tasks of `ids` (all when omitted) this machine can run. */
export function benchable(game: Game, ids?: readonly string[]): BenchTask[] {
  const issues = benchIssues(game, ids);
  return BENCH_TASKS.filter((t) => issues.has(t.id) && issues.get(t.id) === null);
}

// ---------- a run ----------

/**
 * A job is given up when it has run `LIMIT_FACTOR` times the reference time (a machine that slow has no useful score), but not before `MIN_JOB_TICKS` and not
 * after `MAX_JOB_TICKS` base ticks. A boot is given up after `MAX_BOOT_TICKS`, and a machine that crashes `CRASH_LIMIT` times.
 */
const LIMIT_FACTOR = 8,
  MIN_JOB_TICKS = 600,
  MAX_JOB_TICKS = 16000,
  MAX_BOOT_TICKS = 3000,
  CRASH_LIMIT = 4;
/** The event loop gets a turn after this many milliseconds of work. */
const SLICE_MS = 8;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A turn of the event loop. A message is a task like a timer, without the timer's 4 ms floor (a run would take half as long again). */
function yieldTurn(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => {
      c.port1.close();
      resolve();
    };
    c.port2.postMessage(0);
  });
}

/** Hands the event loop a turn every `SLICE_MS`: a run of seconds does not freeze the page. */
class Pace {
  private since = now();
  due(): boolean {
    return now() - this.since >= SLICE_MS;
  }
  async turn(): Promise<void> {
    await yieldTurn();
    this.since = now();
  }
}

/** Run `ids` (the tasks, in the almanac's order; all when omitted) one after the other, each on its own copy. Does not change `game`. Stops after `stop.aborted`. */
export async function runBenchTasks(
  game: Game,
  ids?: readonly string[],
  opts: {
    stop?: Stop;
    onStart?: (task: BenchTask, index: number, total: number) => void;
    onResult?: (result: TaskResult, task: BenchTask) => void;
  } = {},
): Promise<TaskResult[]> {
  const list = BENCH_TASKS.filter((t) => !ids || ids.includes(t.id));
  const stop = opts.stop ?? { aborted: false },
    pace = new Pace(),
    out: TaskResult[] = [];
  for (let i = 0; i < list.length && !stop.aborted; i++) {
    const task = list[i]!;
    opts.onStart?.(task, i, list.length);
    const result = await runTask(game, task, task.scale, pace, stop);
    if (stop.aborted) break; // (a run that was stopped has no result)
    out.push(result);
    opts.onResult?.(result, task);
    await pace.turn();
  }
  return out;
}

/** One task, run now at `scale` (the reference rates are measured at the task's own). Not sliced: for the tests and for re-measuring. */
export async function measureTask(game: Game, task: BenchTask, scale = task.scale): Promise<TaskResult> {
  return runTask(game, task, scale, new Pace(), { aborted: false });
}

async function runTask(game: Game, task: BenchTask, scale: number, pace: Pace, stop: Stop): Promise<TaskResult> {
  const none = (note: string): TaskResult => ({ id: task.id, score: null, seconds: null, note });
  const issue = benchIssue(game, task);
  if (issue) return none(issue);
  const ref = REFERENCE_RATE[task.id];
  const g = await bootedCopy(game, task, pace, stop);
  if (!(g instanceof Game)) return none(g.note);
  const run = task.template === null ? storageRate(g) : await jobRate(g, task, scale, ref, pace, stop);
  if ('note' in run) return none(run.note);
  const crashed = g.errors > 0 ? (faultOf(g) ?? 'the machine crashed') : undefined;
  return {
    id: task.id,
    score: ref ? Math.round((1000 * run.rate) / ref) : null,
    seconds: run.seconds,
    rate: run.rate,
    ...(ref ? {} : { note: 'No reference rate for this task yet' }),
    ...(crashed ? { crashed } : {}),
    ...(run.slowed ? { slowed: run.slowed } : {}),
  };
}

/** The first thing the copy logged as a fault since it was made, as a cause ("VRM voltage droop"). */
function faultOf(g: Game): string | null {
  const l = g.log.find((x) => x.kind === 'fault');
  return l ? l.text.replace(/: the machine crashed and rebooted$/, '') : null;
}

/**
 * What has stopped a copy for good, in the machine's own terms (the benchmark says the cause, not "it did not finish"): a supply that tripped, the board's
 * regulators that burnt out, a start-up check that fails. Null while the machine can still run.
 */
function stoppedBy(g: Game): string | null {
  if (g.thermal.power.tripped)
    return `The power supply tripped: the parts draw ${Math.round(fullDrawW(g.board))} W at full load and it gives ${installedPsu(g.board)?.spec.watts ?? 0} W`;
  if (g.board.burnt) return "The board's voltage regulators burnt out: they ran too hot or too hard";
  // (a CPU that burnt out in the run fails the power-on check as well, which says only "burnt out": the heat is the cause)
  if (g.postError) return burntPart(g, 'cpu') ?? `The machine does not start: ${g.postError.reason}`;
  return null;
}

/** The first part that burnt out (a burnt card or drive does not stop the others: this is for a job that did not finish), as a cause. `kind`: only a part of that kind. */
function burntPart(g: Game, kind?: DeviceKind): string | null {
  const d = g.board.devices.find(
    (x) => x.burnt && KIND_NAME[deviceSpec(x).kind] && (!kind || deviceSpec(x).kind === kind),
  );
  return d ? `The ${KIND_NAME[deviceSpec(d).kind]} burnt out: it ran too hot` : null;
}

/**
 * What slows the machine right now below what its parts allow, and why: the supply too small for the load (every clock is cut to what it can carry), or the
 * part that throttles from heat (the board's regulators too). Null at full speed. `Slow` keeps the worst of a run.
 */
function slowNow(g: Game): { speed: number; why: string } | null {
  const th = g.thermal;
  if (th.power.off) return null;
  const found = [
    {
      speed: th.power.psuFactor,
      why: `The power supply is too small (${Math.round(th.power.budgetW)} W for ${Math.round(fullDrawW(g.board))} W at full load)`,
    },
  ];
  for (const d of g.board.devices) {
    const name = KIND_NAME[deviceSpec(d).kind],
      st = th.state(d.id);
    if (name && st) found.push({ speed: st.throttle, why: `The ${name} ran hot (${Math.round(st.tempC)} C)` });
  }
  found.push(
    { speed: th.vrm.throttle, why: `The board's voltage regulator ran hot (${Math.round(th.vrm.tempC)} C)` },
    { speed: th.ramVrm.throttle, why: `The memory's regulator ran hot (${Math.round(th.ramVrm.tempC)} C)` },
  );
  const worst = found.reduce((a, b) => (b.speed < a.speed ? b : a));
  return worst.speed < 0.995 ? worst : null;
}

/** The slowest the machine ran in a job and the cause, as the result says it ("The CPU ran hot (88 C): it ran at 80% of its speed"). */
class Slow {
  private worst: { speed: number; why: string } | null = null;
  look(g: Game): void {
    const s = slowNow(g);
    if (s && (!this.worst || s.speed < this.worst.speed)) this.worst = s;
  }
  get text(): string | undefined {
    return this.worst ? `${this.worst.why}: it ran at ${Math.round(this.worst.speed * 100)}% of its speed` : undefined;
  }
}

/** A copy of the build, powered and booted (OS up, and the link up for a network job). Never the live game. A copy that cannot come up says why. */
async function bootedCopy(game: Game, task: BenchTask, pace: Pace, stop: Stop): Promise<Game | { note: string }> {
  // (fromSave resets the power, the tray and the drives' in-flight commands; the copy starts cold, as a saved game does.)
  const s = game.toSave();
  const g = Game.fromSave({ ...s, tray: [], plugged: null, inventory: [], prngState: new Prng(s.seed).getState() });
  g.setJobClasses(JOB_CLASSES.map((c) => c.id)); // no arrivals: the job is the only key
  g.errors = 0; // (the save keeps the player's count and log: only what this copy does counts)
  g.log = [];
  if (!g.powered) {
    const pressed = g.powerButton();
    if (!pressed.ok) return { note: `The machine does not switch on: ${pressed.reason.replace(/^no power: /, '')}` };
  }
  const op = new Operator(g);
  const link = task.needs.some((n) => n.kind === 'net');
  // (the OS is up as the kernel loads, but the boot phase runs every clock at `osBootBoost`: the copy is ready once the kernel reaches its idle loop, so the drive test reads the drive at the normal boost)
  const ready = (): boolean =>
    (!g.hasOs() || (!!g.snapshot().os?.up && g.pch.phase !== PchPhase.OsBoot)) && (!link || g.linkUsable);
  for (let t = 0; t < MAX_BOOT_TICKS && !ready() && g.errors < CRASH_LIMIT && !stoppedBy(g); t++) {
    if (stop.aborted) return { note: 'stopped' };
    g.advanceBaseTick();
    op.step();
    if (pace.due()) await pace.turn();
  }
  if (!ready())
    return {
      note:
        stoppedBy(g) ??
        burntPart(g) ??
        (g.errors > 0
          ? `The machine crashed: ${faultOf(g) ?? 'it would not stay up'}`
          : link
            ? 'No network link (an OS and a linked router are needed)'
            : 'The OS did not come up'),
    };
  return g;
}

/** Work per second of the task's job on the booted copy, or a note when it could not run or finish. `ref` is the reference rate (undefined when there is none). */
async function jobRate(
  g: Game,
  task: BenchTask,
  scale: number,
  ref: number | undefined,
  pace: Pace,
  stop: Stop,
): Promise<{ rate: number; seconds: number; slowed?: string | undefined } | { note: string }> {
  const r = g.spawnKey(task.template!, scale);
  if (!r.ok) return { note: r.reason };
  const queued = g.snapshot().tray.find((k) => k.id === r.keyId);
  if (queued && !queued.runnable) return { note: `Needs ${listOf(queued.missing)}` };
  const work = g.tray.waiting().find((k) => k.id === r.keyId)?.work ?? 0;
  const limit = ref
    ? Math.min(MAX_JOB_TICKS, Math.max(MIN_JOB_TICKS, Math.ceil((LIMIT_FACTOR * work) / ref)))
    : MAX_JOB_TICKS;
  const op = new Operator(g),
    slow = new Slow();
  for (let t = 0; t < limit && g.lastCompleted?.id !== r.keyId && g.errors < CRASH_LIMIT && !stoppedBy(g); t++) {
    if (stop.aborted) return { note: 'stopped' };
    g.advanceBaseTick();
    op.step();
    slow.look(g);
    if (pace.due()) await pace.turn();
  }
  const done = g.lastCompleted;
  if (!done || done.id !== r.keyId)
    return {
      note:
        stoppedBy(g) ??
        burntPart(g) ??
        (g.errors >= CRASH_LIMIT
          ? `The machine kept crashing: ${faultOf(g) ?? 'it would not stay up'}`
          : `The job did not finish in ${limit} s`),
    };
  const seconds = Math.max(1, done.execTicks);
  return { rate: work / seconds, seconds, slowed: slow.text };
}

/** Bytes per second of the storage plan on the OS drive (or the first drive), timed by the port's own clock. */
function storageRate(g: Game): { rate: number; seconds: number; slowed?: string } | { note: string } {
  const port = g.osPort() ?? g.ports.find((p) => p.media !== null) ?? null;
  if (!port?.media) return { note: 'No drive is attached' };
  const clock = g.machine.clock;
  const rate = clock.getRate(port.name);
  if (rate.mul <= 0) return { note: "The drive's clock is stopped" };
  const blocks = port.media.blocks;
  const plan: number[] = [];
  for (let i = 0; i < STORAGE_SEQ; i++) plan.push(i % blocks);
  for (let i = 0; i < STORAGE_SCATTER; i++) plan.push((i * STORAGE_STRIDE) % blocks);
  const before = clock.ticks(port.name);
  for (const lba of plan) {
    for (let k = 0; k < 4; k++) port.write(STORAGE_REG.LBA + k, (lba >>> (8 * k)) & 0xff);
    port.write(STORAGE_REG.CMD, 1); // 1 = read block LBA into the buffer
    for (let guard = 0; port.isBusy && guard < 1_000_000; guard++) clock.advance(1);
    if (port.isBusy) return { note: 'The drive did not answer' };
  }
  const domainTicks = clock.ticks(port.name) - before;
  const seconds = (domainTicks * rate.div) / rate.mul; // domain ticks per base tick = mul / div; one base tick = 1 s
  return { rate: (plan.length * BLOCK_BYTES) / Math.max(1e-9, seconds), seconds: Math.max(1, Math.round(seconds)) };
}

/** The storage plan: sequential blocks from 0, then scattered blocks (stride 37 blocks apart). */
const STORAGE_SEQ = 64,
  STORAGE_SCATTER = 64,
  STORAGE_STRIDE = 37;
