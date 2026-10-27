// The job log: one record per job that ended (finished, taken back by its client, or declined), with where its time went and what the
// machine was doing meanwhile (docs/JOBS.md "The log"). Pure data and small helpers; the sim keeps the list and the UI draws it.

import { COUNTER_NAMES } from "../engines/view";

const COUNTER_INDEX = new Map<string, number>(COUNTER_NAMES.map((n, i) => [n, i]));

/** How a job ended. */
export type JobOutcome = "done" | "expired" | "declined";

/** What the engine counted between the job being taken and its result landing. It is the whole machine, so with several programs running it is shared. */
export interface JobWindow {
  cycles: number;
  retired: number;
  /** Stall cycles by cause. */
  stallLoad: number;
  stallData: number;
  stallFlush: number;
  stallStruct: number;
  stallCache: number;
  cacheHits: number;
  cacheMisses: number;
  tlbMisses: number;
  pageFaults: number;
}

export interface JobLogEntry {
  /** Key id (the job number on the monitor is separate). */
  id: number;
  /** Job type id (the almanac's id: "log", "db.index", ...). */
  type: string;
  scale: number;
  outcome: JobOutcome;
  /** Base ticks: the client's key arrived, the machine took it (key plugged, or the download began), the result landed, the client collected it. */
  arrival: number;
  start: number;
  finish: number;
  end: number;
  deadline: number;
  payout: number;
  late: boolean;
  attempts: number;
  /** OS tier installed when it ended (0 none). */
  os: number;
  /** Absent for jobs that never ran, and when the machine rebooted mid-job. */
  win?: JobWindow;
}

/** How many entries the game keeps and sends. */
export const JOB_LOG_CAP = 60;

/** The counter names a window is made of, in the order `windowOf` reads them. */
export const WINDOW_COUNTERS = ["cycles", "retired", "stallLoad", "stallData", "stallFlush", "stallStruct", "stallCache", "cacheHits", "cacheMisses", "tlbMisses", "pageFaults"] as const;

/** The change in the counters between two readings, or undefined when they went backwards (the machine was reset in between). */
export function windowOf(before: readonly number[] | undefined, after: readonly number[]): JobWindow | undefined {
  if (!before || before.length !== after.length) return undefined;
  const w: Record<string, number> = {};
  for (const n of WINDOW_COUNTERS) {
    const i = COUNTER_INDEX.get(n)!;
    const d = after[i]! - before[i]!;
    if (d < 0) return undefined;
    w[n] = d;
  }
  return w as unknown as JobWindow;
}


export interface Phases { wait: number; run: number; collect: number; total: number }

/** Where a finished job's time went: waiting for the machine, running on it, and the result waiting to be collected. */
export function phasesOf(e: JobLogEntry): Phases {
  if (e.outcome !== "done") return { wait: Math.max(0, e.end - e.arrival), run: 0, collect: 0, total: Math.max(0, e.end - e.arrival) };
  const wait = Math.max(0, e.start - e.arrival), run = Math.max(0, e.finish - e.start), collect = Math.max(0, e.end - e.finish);
  return { wait, run, collect, total: wait + run + collect };
}

export interface Verdict {
  /** What dominated: the machine was busy, the job was slow to run, or the result sat. */
  where: "wait" | "run" | "collect" | "none";
  /** One line: what happened. */
  text: string;
  /** What to try. */
  hint: string;
}

const pc = (x: number) => `${Math.round(x * 100)}%`;

/** A plain reading of a log entry: the largest phase, and for a run, what the machine spent its cycles on. */
export function verdictOf(e: JobLogEntry): Verdict {
  if (e.outcome === "expired") return { where: "wait", text: "A client took it back at its deadline: the machine could not run it.", hint: "Look at what it needs in the almanac (OS, drive, RAM, network) and add that." };
  if (e.outcome === "declined") return { where: "none", text: "You declined it.", hint: "Declining costs a little reputation outside the sandbox." };
  const p = phasesOf(e);
  if (p.total <= 0) return { where: "none", text: "Too quick to tell.", hint: "" };
  const top = (["wait", "run", "collect"] as const).reduce((a, b) => (p[b] > p[a] ? b : a), "wait");
  const share = p[top] / p.total;
  if (top === "collect" && share > 0.4) return { where: "collect", text: `The result sat ${p.collect}s waiting to be collected (${pc(share)} of the time).`, hint: "Take the key out as soon as the machine shows the result; the key's auto-eject does it for you." };
  if (top === "wait" && share > 0.4) return {
    where: "wait", text: `It waited ${p.wait}s for the machine (${pc(share)} of the time).`,
    hint: "The machine was busy or off: a faster CPU shortens each job, an OS runs several at once, and a network plan feeds it without keys.",
  };
  const w = e.win;
  if (!w || w.cycles <= 0) return { where: "run", text: `It ran ${p.run}s.`, hint: "No counters for this run (the machine restarted during it)." };
  const stalls: Array<[number, string, string]> = [
    [w.stallCache, "waiting on memory (cache misses)", "More cache, faster RAM, or a CPU with a better cache; the almanac shows how much the job leans on memory."],
    [w.stallFlush, "throwing away mispredicted work", "A CPU with a better branch predictor; the almanac shows how many branches the job has."],
    [w.stallLoad + w.stallData, "waiting on earlier results", "A CPU that forwards results or issues out of order."],
    [w.stallStruct, "queuing for the memory port", "A CPU with a wider memory path."],
  ];
  const [sv, sn, sh] = stalls.reduce((a, b) => (b[0] > a[0] ? b : a));
  const sShare = sv / w.cycles, cpi = w.retired > 0 ? w.cycles / w.retired : 0;
  const tlbBad = w.tlbMisses + w.pageFaults > w.retired * 0.02;
  if (w.pageFaults > 50 || (tlbBad && w.pageFaults > 0 && w.pageFaults > w.tlbMisses * 0.05)) return {
    where: "run", text: `It ran ${p.run}s with ${w.pageFaults} page faults and ${w.tlbMisses} TLB misses: the paged OS spent its time mapping memory.`,
    hint: "Fewer pages touched helps: more RAM does not, the faults come from first touches. A smaller working set or a later OS tier's lazy mapping.",
  };
  if (sShare >= 0.2) return { where: "run", text: `It ran ${p.run}s, ${pc(sShare)} of the cycles ${sn} (CPI ${cpi.toFixed(2)}).`, hint: sh };
  return { where: "run", text: `It ran ${p.run}s and kept the CPU busy (CPI ${cpi.toFixed(2)}, ${pc(sShare)} stalls).`, hint: "Compute bound: a higher clock, a wider or out-of-order CPU, or a multiplier if the job multiplies." };
}

/** Totals over a list of entries for the summary line. */
export interface LogSummary { done: number; expired: number; declined: number; wait: number; run: number; collect: number; late: number; slowest: JobLogEntry | null }

export function summarise(list: readonly JobLogEntry[]): LogSummary {
  const s: LogSummary = { done: 0, expired: 0, declined: 0, wait: 0, run: 0, collect: 0, late: 0, slowest: null };
  for (const e of list) {
    if (e.outcome !== "done") { s[e.outcome]++; continue; }
    const p = phasesOf(e);
    s.done++; s.wait += p.wait; s.run += p.run; s.collect += p.collect;
    if (e.late) s.late++;
    if (!s.slowest || p.total > phasesOf(s.slowest).total) s.slowest = e;
  }
  return s;
}
