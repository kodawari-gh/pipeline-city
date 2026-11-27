// The case and the board of Build my PC (docs/PC_PARTS.md "Build my PC mode"): why a new one is refused, and its fit on the machine as it stands. The
// Build session's commands (`buildsession.ts`) use both. Pure TS: no DOM.
import type { Game } from '@/worker/game/game';
import { upgradeBoard, upgradeCase } from './board';
import type { takeOut } from './buildmoves';
import { stateOf } from './buildscript';
import type { Shown } from './buildspecs';
import { BOARD, CASE } from './removal';

type Board = Game['board'];
/** The script of a job (`buildscript.ts`). */
type Outcome = ReturnType<typeof takeOut>;

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

/** Fit the case or board `itemId` on the machine as it stands, as `BuildSession.fitShell` says. */
export function fitShellOn(g: Game, itemId: string, held: boolean): Outcome {
  const before = stateOf(g),
    why = stageShellRefusal(g, itemId, { shown: 'machine', held });
  if (why !== null) {
    return { script: [], before, refusals: [], refusal: why };
  }
  if (!held) {
    const bought = g.purchase(itemId),
      fitted = bought.ok ? g.install(bought.invId) : bought;
    if (!fitted.ok) {
      return { script: [], before, refusals: [], refusal: `Cannot fit it: ${fitted.reason}` };
    }
  }
  const node = itemId.startsWith('case') ? CASE : BOARD,
    step: Outcome['script'][number] = {
      kind: 'shell-in',
      node,
      target: true,
      ids: new Map(),
      refusals: [],
      ...stateOf(g),
    };
  return { script: [step], before, refusals: [], refusal: null };
}
