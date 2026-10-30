import { NpuOp } from '../../sim/isa/memmap';
import type { NpuLink, NpuPlan } from './npuplan';

// The way a launch goes through the card, as the wires of its floorplan (the card's counterpart of tpm/tpmroute.ts and gpu/gpuroute.ts): in through the
// link to the control registers and the descriptor queue, then for each descriptor the fetch from card memory and the datapath its operation uses, and
// the answer back out the same way. Pure geometry on the plan, so it is testable; the card view sends packets along it (board/npuview.ts).

/** One wire on the way, and whether the packet runs it against its direction. */
export interface NpuHop { link: NpuLink; reverse: boolean }

type Phase = 'in' | 'run' | 'out';

/** The wires of one descriptor of kind `op` (0 or unknown: fetched, then nothing to do). */
const STEP: Record<number, [id: string, reverse?: boolean][]> = {
  [NpuOp.Load]: [['desc-tiles'], ['mem-tiles']],
  [NpuOp.Matmul]: [['desc-array'], ['tiles-array']],
  [NpuOp.Macc]: [['desc-array'], ['tiles-array']],
  [NpuOp.Bias]: [['desc-array'], ['post-mem', true]],
  [NpuOp.Relu]: [['desc-array'], ['array-post']],
  [NpuOp.Store]: [['desc-array'], ['array-post'], ['post-mem']],
  [NpuOp.Layer]: [['desc-array'], ['mem-tiles'], ['tiles-array'], ['array-post'], ['post-mem']],
};

/** The links a launch runs in `phase`; in the run phase, those of the descriptor of kind `op`, in order. */
export function npuRoute(plan: Pick<NpuPlan, 'links'>, op: number, phase: Phase): NpuHop[] {
  const out: NpuHop[] = [];
  const hop = (id: string, reverse = false) => { const link = plan.links.find((l) => l.id === id); if (link) out.push({ link, reverse }); };
  if (phase === 'in') { hop('host-ctl'); hop('ctl-desc'); return out; }
  if (phase === 'out') { hop('ctl-desc', true); hop('host-ctl', true); return out; }
  hop('desc-mem', true); // the descriptor is read out of card memory first
  for (const [id, reverse] of STEP[op] ?? []) hop(id, reverse);
  return out;
}
