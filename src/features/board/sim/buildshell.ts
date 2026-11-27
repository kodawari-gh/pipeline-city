// The case and the board of Build my PC (docs/PC_PARTS.md "Build my PC mode"): why a new one is refused, and its fit, run whole on the game: the parts in
// its way come out, the case or board is fitted, and those parts go back. The Build session's commands (`buildsession.ts`) use both. Pure TS: no DOM.
import type { Game } from '@/worker/game/game';
import { caseHolds, upgradeBoard, upgradeCase } from './board';
import { FitJob } from './buildfit';
import { stateOf } from './buildscript';
import type { Shown } from './buildspecs';
import { BOARD, CASE, buildGraph, removalPlan } from './removal';

type Board = Game['board'];
/** The script of a job (`buildscript.ts`). */
type Outcome = ReturnType<FitJob['run']>;

/**
 * Why the game would refuse a new case or board (`itemId`: "case2", "board1"), asked of a copy of the machine with its parts out (a swap takes them out
 * first, so what they need does not count); null when it takes it.
 */
export function shellRefusal(board: Board, itemId: string): string | null {
  const copy: Board = { ...board, devices: [] },
    tier = Number(itemId.slice(-1));
  const r = itemId.startsWith('case') ? upgradeCase(copy, tier) : upgradeBoard(copy, tier);
  return r.ok ? null : r.reason;
}

/** Why a new case or board is refused on this stage, or null (`BuildSession.shellRefusal`). */
export function stageShellRefusal(g: Game, itemId: string, at: { shown: Shown; held: boolean }): string | null {
  const b = g.board,
    { shown, held } = at,
    isCase = itemId.startsWith('case'),
    tier = Number(itemId.slice(-1)),
    bare = shown !== 'machine';
  if (shown === 'nothing' && !isCase) {
    return 'Fit a case first: every part goes in it';
  }
  if (!held && (isCase ? tier === b.caseTier : tier === b.tier && b.burnt !== true && !bare)) {
    return 'That one is already fitted';
  }
  const why = held ? null : shellRefusal(b, itemId);
  return why === null ? null : `Cannot fit it: ${why}`;
}

/** A case or board fit, as `BuildSession.fitShell` says. */
class ShellJob extends FitJob {
  swapShell(itemId: string, at: { shown: Shown; held: boolean }): Outcome {
    const g = this.game,
      before = stateOf(g),
      why = stageShellRefusal(g, itemId, at);
    if (why !== null) {
      return { script: [], before, refusals: [], refusal: why };
    }
    const isCase = itemId.startsWith('case');
    if (at.shown === 'machine') {
      const tier = Number(itemId.slice(-1)),
        caseOff = isCase || !caseHolds(g.board, tier);
      this.clearWay(caseOff ? CASE : BOARD);
    }
    if (!at.held) {
      this.swapIn(itemId);
    }
    // (a step even when the game refuses the item: what came out for it goes back after it)
    this.push({ kind: 'shell-in', node: isCase ? CASE : BOARD, target: true });
    for (const u of this.undo.toReversed()) {
      this.putBack(u);
    }
    // (a new board makes a machine of a bare case; a case alone stays bare)
    if (at.shown === 'machine' || (!isCase && this.refusal === null)) {
      this.plugNeeded();
    }
    return { script: this.steps, before, refusals: this.pending, refusal: this.refusal };
  }

  /** Take out what holds `shell` (the case or the board) in: the removal graph's order, up to the board itself. */
  private clearWay(shell: string): void {
    const g = this.game;
    for (const n of removalPlan(buildGraph(g.board, g.cables), shell)) {
      if (n === BOARD || n === CASE) {
        break;
      }
      this.takeOut(n);
    }
  }

  /** The case or board is bought and takes the place of the old one. */
  private swapIn(itemId: string): void {
    const g = this.game,
      bought = g.purchase(itemId),
      fitted = bought.ok ? g.install(bought.invId) : bought;
    if (!fitted.ok) {
      this.refusal = `Cannot fit it: ${fitted.reason}`;
    }
  }
}

/** Fit the case or board `itemId`, as `BuildSession.fitShell` says. */
export function fitShellOn(g: Game, itemId: string, at: { shown: Shown; held: boolean }): Outcome {
  return new ShellJob(g).swapShell(itemId, at);
}
