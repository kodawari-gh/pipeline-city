// What a timed engine is to the rest of the game: the `PipelineEngine` interface, the settings it is built from, and the stored state the die view reads.

/* oxlint-disable typescript/method-signature-style -- methods keep the looser (method) parameter check the engine classes are written against; moved unchanged from common.ts (#133) */
import type { Engine } from '@/core/sim/engine';
import type { DramSettings } from '@/features/memory/sim/dram';
import type { EngineView } from './view';
import type { EventLog } from './events';

export interface CacheState {
  lines: number;
  ways: number;
  lineBytes: number;
  tags: number[];
}
export interface EngineState {
  regs: number[];
  d: CacheState;
  i?: CacheState;
  l2?: CacheState;
  pred: { entries: number; bits: number; table: number[] };
  /** The DRAM behind the caches, when the engine has one: geometry and the open row of every bank (-1: closed). */
  dram?: { channels: number; banks: number; rowBytes: number; open: number[] };
  events: EventLog;
}

export interface PipelineEngine extends Engine {
  readonly view: EngineView;
  /** Drop every data cache line (the next accesses miss). */
  invalidateCache(): void;
  /** Flip the 1-bit branch predictor entry for `pc`, or every entry if omitted. No-op for engines without prediction. */
  flipPredictor(pc?: number): void;
  /** What is stored right now (registers, cache lines, predictor counters) and the recent writes, for the die view. */
  storedState(): EngineState;
}

export interface EngineSettings {
  /** Data cache: number of lines (power of two). Default 8. */
  cacheLines?: number;
  /** Data cache: bytes per line (power of two). Default 16. */
  cacheLineBytes?: number;
  /** Data cache: lines per set (power of two, default 1 = direct mapped; least recently used replacement). */
  ways?: number;
  /** Extra cycles a load miss freezes the pipeline (a miss that also misses the L2, when there is one). Default 4. */
  missPenalty?: number;
  /** Instruction cache lines (power of two, same line size as the data cache). Default 0: none, every fetch reads RAM at once. */
  icacheLines?: number;
  /** Shared second-level cache lines (power of two, 4-way, same line size) behind both L1 caches. Default 0: none. */
  l2Lines?: number;
  /** Cycles an L1 miss that hits the L2 costs. Default 2. */
  l2Penalty?: number;
  /**
   * Cycles a jump (a taken branch, a jump, a flush, an interrupt) waits for its target when there is no instruction cache: the
   * target has to come from RAM. Fetch that carries on in sequence is free. Default 0 (instruction memory is ideal, as in the engine tests); the game
   * sets it for every CPU (apply.ts), so an instruction cache has something to save. With an instruction cache it does not apply.
   */
  redirectPenalty?: number;
  /** Branch predictor: entries (default 64) and bits per entry, 1 or 2 (default 1). */
  predEntries?: number;
  predBits?: number;
  /**
   * The DRAM behind the caches (docs/RAM.md): banks with an open row each; a miss that reaches RAM costs a row hit, an empty bank's activate, or a
   * conflict instead of the flat `missPenalty`. Default: none (the flat penalty), so the engine tests are unchanged.
   */
  dram?: DramSettings | undefined;
  /** Timeline ring: instructions kept (>= 8, default 32) and cycles kept (default 64). */
  timelineRows?: number;
  timelineCols?: number;
}
