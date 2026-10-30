import type { TpmLink, TpmPlan } from './tpmplan';
import { ENGINE_OF } from './tpmglyph';

// The way a command goes through the module, as the wires of its floorplan (the module's counterpart of gpu/gpuroute.ts): in through the link to
// the registers and the sequencer, out to the engine that does the work (a measure also reads RAM through the bus master), and the answer back the
// same way. Pure geometry on the plan, so it is testable; the module view sends packets along it (board/tpmview.ts).

/** One wire on the way, and whether the packet runs it against its direction. */
export interface TpmHop { link: TpmLink; reverse: boolean }

type Phase = 'in' | 'work' | 'out';

/** The links a command of kind `cmd` (0 or unknown: refused before it reached an engine) runs in `phase`, in order. */
export function tpmRoute(plan: Pick<TpmPlan, 'links'>, cmd: number, phase: Phase): TpmHop[] {
  const engine = ENGINE_OF[cmd], out: TpmHop[] = [];
  const hop = (id: string, reverse = false) => { const link = plan.links.find((l) => l.id === id); if (link) out.push({ link, reverse }); };
  if (phase === 'in') { hop('lpc-regs'); hop('regs-seq'); return out; }
  if (phase === 'work') {
    if (!engine) return out;
    hop(`seq-${engine}`);
    if (engine === 'hash') hop('hash-ram'); // the module's own reads go out through the bus master; the guard only judges the CPU's accesses
    return out;
  }
  // the answer: the engine to the registers (the guard answers through the sequencer's status), then out over the link
  if (engine === 'guard') { hop('seq-guard', true); hop('regs-seq', true); } else if (engine) hop(`regs-${engine}`, true);
  hop('lpc-regs', true);
  return out;
}
