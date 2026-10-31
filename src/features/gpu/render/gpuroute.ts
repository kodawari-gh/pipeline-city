import type { GpuStep } from '../sim/ref';
import type { GpuLink, GpuPlan } from './gpuplan';

// The way an instruction goes through a card, as the wires of its floorplan (the card's `Player` counterpart of the CPU die's routes, die/diemotion.ts):
// the front end (the program counter or the fetch, the decoder, the scheduler) down to the register file, the operands into the lanes, and for a load or
// a store the address and the data out through the coalescer, the arbiter, the banks or the caches to the card memory. Pure geometry on the plan, so it
// is testable; the card view sends packets along it (board/gpuview.ts).

/** One wire on the way, and whether the packet runs it against its direction. */
export interface Hop { link: GpuLink; reverse: boolean }

/** The shortest chain of links from block `from` to block `to`, following the links' directions (null when there is none). */
export function pathBetween<L extends { from: string; to: string }>(links: readonly L[], from: string, to: string): L[] | null {
  if (from === to) return [];
  const prev = new Map<string, L>(), seen = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const l of links) {
        if (l.from !== at || seen.has(l.to)) continue;
        seen.add(l.to);
        prev.set(l.to, l);
        if (l.to === to) {
          const out: L[] = [];
          for (let k = to; k !== from; k = prev.get(k)!.from) out.unshift(prev.get(k)!);
          return out;
        }
        next.push(l.to);
      }
    }
    frontier = next;
  }
  return null;
}

/** The block ids of SM `sm` on a card (the ids are prefixed `sm<k>.` only when the card has several). */
const prefix = (plan: Pick<GpuPlan, 'input'>, sm: number): string => (plan.input.sms > 1 ? `sm${sm}.` : '');

/** Where an SM's instructions enter: the program counter of the unit, the fetch of a warp SM. */
export const entryOf = (plan: Pick<GpuPlan, 'input'>, sm: number): string => (plan.input.kind === 'simd' ? 'pc' : `${prefix(plan, sm)}fetch`);

/** The links a launch crosses: the host link, the launch registers, the entry of SM `sm`. */
export function launchRoute(plan: Pick<GpuPlan, 'input' | 'links'>, sm = 0): Hop[] {
  return (pathBetween(plan.links, 'pcie', entryOf(plan, sm)) ?? []).map((link) => ({ link, reverse: false }));
}

/** The links an instruction of kind `step.kind` runs on SM `sm`, in order. */
export function gpuRoute(plan: Pick<GpuPlan, 'input' | 'links'>, step: Pick<GpuStep, 'kind'>, sm: number): Hop[] {
  const p = prefix(plan, sm), regs = `${p}regs`, lanes = `${p}lanes`, out: Hop[] = [];
  const add = (a: string, b: string) => { for (const link of pathBetween(plan.links, a, b) ?? []) out.push({ link, reverse: false }); };
  add(entryOf(plan, sm), regs);
  if (step.kind === 'sys' || step.kind === 'br') return out; // the front end alone: a halt, a jump
  add(regs, lanes);
  if (step.kind === 'mask') {
    // a mask set reads two registers, compares them in the lanes and writes the mask (the link runs from the mask to the lanes: against it)
    const m = plan.links.find((l) => l.id === `${p}mask-lanes`);
    if (m) out.push({ link: m, reverse: true });
    return out;
  }
  if (step.kind === 'ld' || step.kind === 'st') add(lanes, 'dram');
  return out;
}
