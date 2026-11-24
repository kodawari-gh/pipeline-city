// BUILD MY PC (docs/PC_PARTS.md "Running the machine"): the words for a machine that runs on the stage. Pure TS, no DOM.
// The stage ticks its sandbox game while the machine is on; the power chip and the OS sheet show what it is doing in these words.

import type { Phase } from '@/worker/game/types';

/** How the chip reads: off, working (a boot, a job), settled (idle, waiting) or stopped (an error). */
type RunTone = 'off' | 'busy' | 'ok' | 'bad';

/** What the machine is doing: on or off, the phase (`Game.currentPhase`), the words for it and, for a stop, why. */
export interface RunState {
  on: boolean;
  phase: Phase;
  text: string;
  tone: RunTone;
  why: string | null;
}

const WORDS: Record<Phase, { text: string; tone: RunTone }> = {
  off: { text: 'Off', tone: 'off' },
  posting: { text: 'Starting up', tone: 'busy' },
  mounting: { text: 'Mounting drives', tone: 'busy' },
  'waiting-for-key': { text: 'Waiting for a key', tone: 'ok' },
  loading: { text: 'Loading a job', tone: 'busy' },
  running: { text: 'Running a job', tone: 'busy' },
  writing: { text: 'Writing a result', tone: 'busy' },
  'done-remove-key': { text: 'Job done', tone: 'ok' },
  halted: { text: 'Halted', tone: 'ok' },
  error: { text: 'Stopped', tone: 'bad' },
  'booting-os': { text: 'Booting the OS', tone: 'busy' },
  'idle-os': { text: 'OS ready', tone: 'ok' },
  ingesting: { text: 'OS reading a job', tone: 'busy' },
  'running-os': { text: 'OS running jobs', tone: 'busy' },
  flashing: { text: 'OS writing a result', tone: 'busy' },
};

export const OFF: RunState = { on: false, phase: 'off', text: 'Off', tone: 'off', why: null };

/** The state for a snapshot's `powered`, `phase` and `phaseReason`. A machine that is off is `OFF` whatever its phase says. */
export function runState(on: boolean, phase: Phase, reason: string | null): RunState {
  if (!on) return OFF;
  const w = WORDS[phase] ?? WORDS.posting;
  return { on: true, phase, text: w.text, tone: w.tone, why: phase === 'error' ? reason : null };
}

/** The same state: the chip and the sheet redraw only when this is false. */
export const sameRun = (a: RunState, b: RunState): boolean => a.on === b.on && a.phase === b.phase && a.why === b.why;

/** How fast the machine runs on the stage, in base ticks a second (the game's own speeds: 1 is its 1x; 64 is the sandbox's). */
export const RUN_SPEEDS = [1, 4, 16, 64] as const;
export type RunSpeed = (typeof RUN_SPEEDS)[number];
/** A machine boots in about 15 ticks: 4x is a few seconds to the OS. */
export const DEFAULT_RUN_SPEED: RunSpeed = 4;
/** The most ticks one frame runs (the worker's cap is 128 per 100 ms call, `host.ts`; a frame is shorter): the time beyond it is dropped, so a slow tab does not owe a minute of ticks. */
export const MAX_TICKS_PER_FRAME = 64;
