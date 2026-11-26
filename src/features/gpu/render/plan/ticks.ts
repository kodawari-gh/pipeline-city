import type { GpuTick } from './gpuplayer';

// What the card view reads off a replay tick (`GpuPlayer` in gpuplayer.ts): the lanes the instruction on show runs on, its banks, its text.

/** Is lane `k` active in the instruction on show? (No instruction: every lane is, the card's idle look.) */
export const laneActive = (t: GpuTick, k: number): boolean => (t.step ? ((t.step.mask >>> k) & 1) === 1 : true);

/** A bank's state during the instruction on show: the addresses queued on it and how many its rounds have served so far. */
export function bankState(t: GpuTick, b: number): { queued: number; served: number } {
  const queued = t.step?.banks?.[b] ?? 0;
  return { queued, served: Math.min(queued, t.round + 1) };
}

/** Did this instruction lose cycles to a bank conflict? */
export const conflicted = (t: GpuTick): boolean => t.step !== null && t.step.cost > 1;

/** The mnemonic on show, with the active lane count: `vld  6/8`. */
export function stepText(t: GpuTick, lanes: number): string {
  if (!t.step) {
    return '';
  }
  let n = 0;
  for (let k = 0; k < lanes; k++) {
    if (laneActive(t, k)) {
      n++;
    }
  }
  return `${t.step.name.padEnd(6)} ${n}/${lanes}`;
}
