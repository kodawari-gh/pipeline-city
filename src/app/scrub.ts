// The die's cycle scrubber (docs/DIE.md "Stepping"): the Trace panel sets the cycle to look at while the game is paused, the die
// view reports which cycles it can show.
import { signal } from '@preact/signals';

/** What the scrubber moves: the CPU die (`cpu`) or the card in a PCIe slot (`gpu:pcie0`...). The cursor, range and shown cycle below belong to it. */
export type ScrubTarget = 'cpu' | `gpu:${string}`;
export const scrubTarget = signal<ScrubTarget>('cpu');
/** Whether the Trace panel is open (the die marks the core it follows only then). */
export const traceOpen = signal(false);
/** Move the scrubber to another target: the old cursor, range and shown cycle mean nothing there. */
export function selectScrub(t: ScrubTarget): void {
  if (scrubTarget.peek() === t) return;
  scrubTarget.value = t;
  scrubCursor.value = null;
  scrubRange.value = null;
  scrubShown.value = -1;
}
/** The engine cycle the paused die should show, or null to follow the newest. */
export const scrubCursor = signal<number | null>(null);
/** The cycles the die can show (its history of windows), or null. */
export const scrubRange = signal<{ lo: number; hi: number } | null>(null);
/** The engine cycle the die shows now, -1 when none. */
export const scrubShown = signal(-1);
