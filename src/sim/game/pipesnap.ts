// The CPU die's live state in the snapshot (docs/DIE.md "Levels of detail and live state"): the stage occupants of an in-order engine
// per lane, and the structures of the out-of-order engine (queues, scheduler, reorder buffer, execution units). A snapshot is a sampled
// instant (36 or more CPU cycles apart), so these are states, not streams; the renderer adds event counts by diffing `counters`.

import type { PipelineEngine } from "../engines";
import type { EngineView, OooView, TimelineView } from "../engines/view";
import { disassemble, OPS } from "../isa";
import type { StageSnap } from "./game";

/** One slot of an out-of-order structure: the mnemonic ("" when empty) and a state code (see each field). */
export interface OooSlot { op: string; state: number }

export interface OooSnap {
  /** Fetch queue, oldest first (its length is the occupancy). */
  fetchQ: string[];
  /** Per decode lane: mnemonic, "" when empty. */
  decode: string[];
  /** The reorder buffer's physical ring: state = RobState (0 empty .. 3 done). */
  rob: OooSlot[];
  robHead: number;
  robCount: number;
  /** Scheduler slots: state = SchedWhy (0 none, 1 operands, 2 memory, 3 unit, 4 head); op "" = empty slot. */
  sched: OooSlot[];
  /** ALU0 ALU1 MUL LSU: op "" when idle; `left` of `total` cycles to go. */
  units: { op: string; left: number; total: number }[];
  /** Why fetch, dispatch and commit made no progress this cycle (0 = fine). */
  stall: [number, number, number];
}

/**
 * The last `n` cycles of the engine as they happened, for the die view to play back slowly (docs/DIE.md "Motion"): a snapshot is a sampled
 * instant, the cycles between two snapshots are not in it, but the engine keeps a ring of what every instruction did in each recent cycle.
 */
export interface TraceSnap {
  /** The engine cycle of the last column. */
  end: number;
  /** Cycles covered (the columns are end - n + 1 .. end). */
  n: number;
  /** Instructions that did something in the window, oldest first. `codes` has one character per cycle (STAGE_CODE_CHARS: F D X M W for the in-order engines; F D S X R C for the out-of-order one; x flushed; space nothing). */
  rows: { id: number; pc: number; text: string; codes: string }[];
}

/** Cycles of history in a snapshot. */
export const TRACE_CYCLES = 24;

/** One cache: `tags[slot]` is the line number held (address / lineBytes), -1 empty; `words` the words of each line (slot-major, lineBytes / 4 each) as RAM holds them now. */
export interface CacheSnap { lines: number; ways: number; lineBytes: number; tags: number[]; words: number[] }

/**
 * What is stored, for the die to show: the register file, the cache lines, the predictor counters, and the writes of the trace window
 * (`events`, flat [cycle, kind, a, b, c, d]: Ev.Reg reg new old; Ev.Hit cache slot line; Ev.Fill cache slot line evicted; Ev.Pred index new old)
 * so the replay can rewind to the start of the window and apply them cycle by cycle.
 */
export interface StoredSnap {
  regs: number[];
  d: CacheSnap;
  i?: CacheSnap;
  l2?: CacheSnap;
  pred: { entries: number; bits: number; table: number[] };
  events: number[];
}

export interface PipeSnap {
  /** Lanes per stage. `stages` is indexed stage * width + lane. */
  width: number;
  stages: StageSnap[];
  ooo?: OooSnap;
  trace?: TraceSnap;
  stored?: StoredSnap;
}

const wordAt = (ram: Uint8Array, a: number): number => (a + 4 <= ram.length ? (ram[a]! | (ram[a + 1]! << 8) | (ram[a + 2]! << 16) | (ram[a + 3]! << 24)) : 0);

function cacheSnap(c: { lines: number; ways: number; lineBytes: number; tags: number[] }, ram: Uint8Array): CacheSnap {
  const words: number[] = [];
  const per = c.lineBytes / 4;
  for (const t of c.tags) for (let k = 0; k < per; k++) words.push(t < 0 ? 0 : wordAt(ram, t * c.lineBytes + 4 * k));
  return { lines: c.lines, ways: c.ways, lineBytes: c.lineBytes, tags: c.tags, words };
}

/** The stored state of an engine and the writes since cycle `from`. */
export function storedOf(eng: PipelineEngine, ram: Uint8Array, from: number): StoredSnap {
  const st = eng.storedState();
  return {
    regs: st.regs,
    d: cacheSnap(st.d, ram),
    ...(st.i ? { i: cacheSnap(st.i, ram) } : {}),
    ...(st.l2 ? { l2: cacheSnap(st.l2, ram) } : {}),
    pred: st.pred,
    events: st.events.since(from),
  };
}

/** How full the RAM is, in `RAM_BUCKETS` equal parts of the address space, for the memory sticks to show. */
export interface RamMap {
  bytes: number;
  /** Per bucket: 0..255, the share of its 16-byte lines that hold anything. */
  filled: number[];
  /** Per bucket: 0..255, the share of its lines that hold only legal instructions (the program, as opposed to data). */
  code: number[];
}
export const RAM_BUCKETS = 256;

export function ramMapOf(ram: Uint8Array): RamMap {
  const per = Math.max(16, Math.ceil(ram.length / RAM_BUCKETS / 16) * 16);
  const filled: number[] = [], code: number[] = [];
  for (let b = 0; b < RAM_BUCKETS; b++) {
    const lo = b * per, hi = Math.min(ram.length, lo + per);
    let lines = 0, nz = 0, cd = 0;
    for (let a = lo; a < hi; a += 16) {
      lines++;
      let any = false, legal = true;
      for (let k = 0; k < 4; k++) {
        const w = wordAt(ram, a + 4 * k);
        if (w !== 0) any = true;
        if (w === 0 || !LEGAL.has(w & 0x7f)) legal = false;
      }
      if (any) nz++;
      if (any && legal) cd++;
    }
    filled.push(lines ? Math.round((255 * nz) / lines) : 0);
    code.push(lines ? Math.round((255 * cd) / lines) : 0);
  }
  return { bytes: ram.length, filled, code };
}
const LEGAL = new Set<number>(OPS.map((o) => o.op));

function opOf(t: TimelineView, id: number): string {
  if (id < 0) return "";
  const row = id % t.rows;
  return t.id[row] === id ? disassemble(t.word[row]!).split(" ")[0] ?? "" : "";
}

function textOf(t: TimelineView, id: number): string {
  if (id < 0) return "";
  const row = id % t.rows;
  return t.id[row] === id ? disassemble(t.word[row]!) : "";
}

function oooOf(v: OooView): OooSnap {
  const t = v.timeline, occ = v.occ;
  const fetchQ: string[] = [];
  for (let k = 0; k < occ[0]!; k++) fetchQ.push(opOf(t, v.fetchId[k]!));
  const decode: string[] = [];
  for (let k = 0; k < v.decodeId.length; k++) decode.push(opOf(t, v.decodeId[k]!));
  const rob: OooSlot[] = [];
  for (let k = 0; k < v.robSize; k++) rob.push({ op: opOf(t, v.robId[k]!), state: v.robState[k]! });
  const sched: OooSlot[] = [];
  for (let k = 0; k < v.schedSize; k++) sched.push({ op: opOf(t, v.schedId[k]!), state: v.schedWhy[k]! });
  const units: OooSnap["units"] = [];
  for (let k = 0; k < v.unitId.length; k++) units.push({ op: opOf(t, v.unitId[k]!), left: v.unitLeft[k]!, total: v.unitTotal[k]! });
  return { fetchQ, decode, rob, robHead: occ[5]!, robCount: occ[2]!, sched, units, stall: [v.stall[0]!, v.stall[1]!, v.stall[2]!] };
}

/** The recent cycles of an engine's timeline ring. */
export function traceOf(v: EngineView, end: number, want = TRACE_CYCLES): TraceSnap {
  const t = v.timeline;
  const n = Math.max(1, Math.min(want, t.cols, end));
  const rows: TraceSnap["rows"] = [];
  const CH = " FDXMWxSRC";
  for (let r = 0; r < t.rows; r++) {
    const id = t.id[r]!;
    if (id < 0) continue;
    let codes = "", any = false;
    for (let k = 0; k < n; k++) {
      const c = end - n + 1 + k;
      const code = c > 0 ? t.codes[r * t.cols + (c % t.cols)]! : 0;
      if (code) any = true;
      codes += CH[code] ?? " ";
    }
    if (any) rows.push({ id, pc: t.pc[r]!, text: disassemble(t.word[r]!), codes });
  }
  rows.sort((a, b) => a.id - b.id);
  return { end, n, rows };
}

export function pipeSnapOf(eng: PipelineEngine, ram?: Uint8Array): PipeSnap {
  const v: EngineView = eng.view;
  const t = v.timeline;
  const stages: StageSnap[] = [];
  const n = 5 * v.width;
  for (let i = 0; i < n; i++) {
    const kind = v.stageKind[i]!;
    const id = v.stageId[i]!;
    const text = kind === 1 ? textOf(t, id) : "";
    stages.push({ kind, id, op: text.split(" ")[0] ?? "", text, cause: v.stageCause[i]!, stalled: v.stageStalled[i]! !== 0 });
  }
  const out: PipeSnap = { width: v.width, stages: "robId" in v ? [] : stages };
  if ("robId" in v) out.ooo = oooOf(v as OooView);
  if (eng.cycle > 0) {
    out.trace = traceOf(v, eng.cycle);
    if (ram) out.stored = storedOf(eng, ram, eng.cycle - out.trace.n + 1);
  }
  return out;
}
