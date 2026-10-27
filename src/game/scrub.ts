// The die's cycle scrubber (docs/DIE.md "Stepping"): the Trace panel sets the cycle to look at while the game is paused, the die
// view reports which cycles it can show.
import { signal } from '@preact/signals';

/** The engine cycle the paused die should show, or null to follow the newest. */
export const scrubCursor = signal<number | null>(null);
/** The cycles the die can show (its history of windows), or null. */
export const scrubRange = signal<{ lo: number; hi: number } | null>(null);
/** The engine cycle the die shows now, -1 when none. */
export const scrubShown = signal(-1);
