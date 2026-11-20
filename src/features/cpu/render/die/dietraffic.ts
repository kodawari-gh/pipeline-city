import type { Snapshot } from '@/worker/protocol';
import { Ev } from '../../sim/engines/common';
import type { CpuPlan } from '../core/cpuplan';
import { splitPlan } from '../core/coreplan';
import { CYCLES_PER_SEC, opClass, Player, type OpClass, type StoreEvent } from './diemotion';

// What the CPU reaches for, replayed with nothing drawn (docs/render/live.md "Activity"). The die's own replay (`PlanView`) tells the board what each core
// fetches, loads and stores and which interrupts it takes, and the board lights the lanes of the stick, the drive or the card that answers. A board that
// shows no die of its own (Build my PC, or a die that is out of view) still needs that, so this is the same replay without the drawing: one `Player` per
// hardware core, on the same trace, at the same pace, telling the same things (`fetchTouch`, `accessTouch`).

/** One cycle of the replay (ms). */
const CYCLE_MS = 1000 / CYCLES_PER_SEC;

/** A reach for RAM or a device's window. `core` is the logical core that made it, on a multicore die. `at` is game time in ms. */
export interface MemoryTouch { kind: 'fetch' | 'load' | 'store'; addr: number; cls: OpClass; at: number; core?: number }

/** The core fetches the instruction at `pc`: it enters the fetch stage. */
export const fetchTouch = (pc: number, cls: OpClass, now: number): MemoryTouch => ({ kind: 'fetch', addr: pc, cls, at: now + CYCLE_MS * 0.6 });

/**
 * The core loads or stores: an access the engine logged (`Ev.Mem`: `a` is 0 for a load and 1 for a store, `b` the address). The log is the one place that
 * says what was reached and when, whatever the engine: an in-order core logs it one cycle after its instruction enters the memory stage, an out-of-order
 * core a load as it executes and a store as it commits. (Matching it to the beat of the instruction by cycle found none of an in-order core's.)
 */
export const accessTouch = (e: Pick<StoreEvent, 'a' | 'b'>, now: number): MemoryTouch =>
  e.a === 1 ? { kind: 'store', addr: e.b >>> 0, cls: 'st', at: now + CYCLE_MS * 0.5 } : { kind: 'load', addr: e.b >>> 0, cls: 'ld', at: now + CYCLE_MS * 0.8 };

/** The replay of a CPU's cycles that only tells where the reaches for RAM and the interrupts are (`onMemory`, `onInterrupt`), and draws nothing. */
export class DieTraffic {
  /** Told every time a core reaches out to RAM or a device's window, and every time one takes an interrupt (as the die view's hooks are). */
  onMemory: ((e: MemoryTouch) => void) | null = null;
  onInterrupt: ((line: number) => void) | null = null;
  private lanes: Player[] = [];
  /** A multicore die: each hardware core has its own trace (`Snapshot.cores`), else the one pipeline's (`Snapshot.pipe`). */
  private split = false;
  /** For each hardware core, the logical core its reaches are put down to (as `DieView` does). */
  private logical: number[] = [];

  /** The CPU's floorplan (none: no CPU): a replay for each hardware core, from the same split as the die's tiles. The old replays go. */
  setPlan(plan: CpuPlan | null): void {
    this.lanes = [];
    this.logical = [];
    const sp = plan ? splitPlan(plan) : null;
    this.split = !!sp;
    if (!plan) return;
    // (the replay needs the plan's kind of engine, not its geometry: there are no blocks to place a chip in)
    const bare: CpuPlan = { arch: plan.arch, cores: 1, die: plan.die, blocks: [], links: [] };
    for (let k = 0; k < (sp ? sp.tiles.length : 1); k++) this.lanes.push(new Player(bare, CYCLES_PER_SEC, true));
  }

  /** A new snapshot: each core's newest cycles join its replay (a machine with no trace stops them). */
  update(s: Snapshot | null): void {
    this.lanes.forEach((player, k) => {
      const pipe = this.split ? s?.cores?.tiles[k] : s?.pipe;
      if (pipe?.trace) player.push(pipe.trace, pipe.stored); else player.reset();
    });
    this.logical = [];
    for (const c of s?.cores?.live ?? []) if (this.logical[c.hw] === undefined || (c.job !== 0 && !c.parked)) this.logical[c.hw] = c.core;
  }

  /** Play to game time `now` (ms): the cycles crossed since the last call tell their reaches. `paused`: a step shows its last cycle at once (`Player.update`). */
  frame(now: number, paused = false): void {
    this.lanes.forEach((player, k) => {
      const fr = player.update(now, paused);
      if (!fr.applied.length && !fr.beats.length) return;
      // (a multicore die puts each reach down to its logical core, a single core has none: `DieMulti` and `DieView`)
      const tell = (t: MemoryTouch) => this.onMemory?.(this.split ? { ...t, core: this.logical[k] ?? k } : t);
      for (const e of fr.applied) {
        if (e.kind === Ev.Irq) this.onInterrupt?.(e.a);
        else if (e.kind === Ev.Mem) tell(accessTouch(e, now));
      }
      for (const ev of fr.beats) if (ev.to === 'F') tell(fetchTouch(ev.pc, opClass(ev.op), now));
    });
  }
}
