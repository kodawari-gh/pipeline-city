// The history of a Build session (`buildsession.ts`): the steps Undo and Redo walk, the replay of a part step, the swap count, and the limit on the whole
// machines it keeps.
import type { Game } from '@/worker/game/game';
import { putIn, takeOut } from './buildmoves';
import type { NetKind } from './buildnet';
import type { Along } from './buildscript';
import type { Shown } from './buildspecs';
import { devNode } from './removal';

/** A swap: the whole machine that Undo or Redo puts back, and what stands on the stage for it. */
interface SwapStep {
  t: 'swap';
  game: Game;
  shown: Shown;
}

/**
 * One step of the history: a part fitted or taken out (`along`: what the step took out for good, which Undo brings back after the step's own reversal), an
 * OS, router or internet plan changed, or a swap.
 */
type HistoryStep =
  | { t: 'fit' | 'remove'; spec: string; slot: string; along?: Along[] }
  | { t: 'net'; kind: NetKind; from: string | null; to: string | null }
  | SwapStep;

type Way = 'undo' | 'redo';

type PartStep = Extract<HistoryStep, { t: 'fit' | 'remove' }>;

/**
 * A part step done again on `g`, or its opposite (`undo`): then the parts the step took out for good go back too. One job for each part it fitted or took
 * out.
 */
export function replayPart(g: Game, s: PartStep, at: { undo: boolean; shown: Shown }): ReturnType<typeof takeOut>[] {
  const { undo, shown } = at,
    jobs: ReturnType<typeof takeOut>[] = [];
  if ((s.t === 'fit') === undo) {
    const d = g.board.devices.find((x) => x.slot === s.slot && x.spec === s.spec);
    if (d !== undefined) {
      jobs.push(takeOut(g, devNode(d.id)));
    }
  } else {
    jobs.push(putIn(g, { item: s.spec, drop: s.slot }, shown));
  }
  if (undo) {
    for (const a of s.along ?? []) {
      jobs.push(putIn(g, { item: a.spec, drop: a.slot }, shown));
    }
  }
  return jobs;
}

/** The most swaps the past holds: each keeps a whole game. */
const KEEP_SWAPS = 8;

export class BuildHistory {
  private past: HistoryStep[] = [];
  private future: HistoryStep[] = [];
  private count = 0;

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** How many times the machine was swapped for another (Undo and Redo of a swap count too). */
  get swaps(): number {
    return this.count;
  }
  /** Is the last step a swap? Then Undo brings back the machine that was on the stage before. */
  get lastWasSwap(): boolean {
    return this.past.at(-1)?.t === 'swap';
  }

  /** A new step: there is nothing to redo any more. Past the swap limit the oldest swap goes, and with it the steps made on the machines before it. */
  record(s: HistoryStep): void {
    if (s.t === 'swap') {
      this.count++;
    }
    this.past.push(s);
    this.future = [];
    if (this.past.filter((x) => x.t === 'swap').length > KEEP_SWAPS) {
      this.past = this.past.slice(this.past.findIndex((x) => x.t === 'swap') + 1);
    }
  }

  forget(): void {
    this.past = [];
    this.future = [];
  }

  /** The step Undo (or Redo) takes next. */
  next(way: Way): HistoryStep | undefined {
    return (way === 'undo' ? this.past : this.future).at(-1);
  }

  /** Take that step off its list. */
  take(way: Way): HistoryStep | undefined {
    return (way === 'undo' ? this.past : this.future).pop();
  }

  /** Keep a step Undo (or Redo) did, for the way back. */
  give(way: Way, back: HistoryStep): void {
    if (back.t === 'swap') {
      this.count++;
    }
    (way === 'undo' ? this.future : this.past).push(back);
  }
}
