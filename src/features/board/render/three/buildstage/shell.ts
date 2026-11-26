// Swapping the case's shell or the board: the whole machine lifts away.
import { buildGraph, BOARD, CASE, removalPlan } from '@/features/board/sim/removal';
import { caseHolds } from '@/features/board/sim/board';
import { BOARD_TIERS, CASE_TIERS } from '@/features/board/sim/specs';
import { motionFor, poseAt } from '../buildmotion';
import { bareGame } from '@/features/board/sim/buildpreset';
import { playCue } from '@/app/audio/engine';
import type { Undo, ShellJob } from './types';
import { inTurn, steelCase, sure } from './tuning';
import { shellRefusal } from './parts';
import { StageHistory } from './history';

export abstract class StageShell extends StageHistory {
  /**
   * A new board or case: every part comes out first, the machine is swapped as one piece, then the parts go back (what no longer fits stays in the bin).
   * A bare case has no board and no part to lift: a new case is set down, and a board is lowered into it (the machine then stands as any other). With no
   * case on the stage (`nothing`) the first case is brought in, with nothing to take away. Each is a step Undo takes back, to the bare case or the empty
   * stage it left (a machine's own new case or board ends the history).
   */
  protected async fitShell(itemId: string): Promise<void> {
    const shown = this.shown.peek(),
      bare = shown !== 'machine';
    const held = this.shellHeld(itemId);
    if (held === null) {
      return;
    }
    if (bare) {
      // (the bare case or the empty stage as it stands, to come back to: a copy, as the game is about to change)
      this.record({ t: 'swap', game: await bareGame(this.board.caseTier), shown });
      this.swapCount++;
    } else {
      this.forget();
    } // (a new case or board is not a step to undo: the history ends here)
    if (this.dead) {
      return;
    }
    playCue('install');
    // the case comes off when it is the new part, and when the new board is too big for it (the sandbox lets the case follow the board: `Game.install`)
    const isCase = itemId.startsWith('case'),
      tier = Number(itemId.slice(-1));
    const job: ShellJob = {
      item: itemId,
      isCase,
      tier,
      held,
      bare,
      none: shown === 'nothing',
      newCase: isCase || !caseHolds(this.board, tier),
      glass: !steelCase(),
    };
    const undo = await this.liftShell(job);
    const ok = this.swapShell(job);
    this.rebuildAll();
    if (ok) {
      await this.lowerShell(job);
    }
    await inTurn(undo.toReversed().values(), async (u) => {
      await this.putBack(u);
    });
    if (!this.bare.peek()) {
      await this.plugNeeded();
    }
  }

  /**
   * Does the stage hold the new case or board aside already (a bare case's board, an empty stage's case: the game has nothing to change)? Null when it is
   * refused (no case for a board, the one fitted already, or what the game would refuse): the hint line says why.
   */
  protected shellHeld(itemId: string): boolean | null {
    const isCase = itemId.startsWith('case'),
      tier = Number(itemId.slice(-1)),
      shown = this.shown.peek(),
      bare = shown !== 'machine',
      none = shown === 'nothing';
    if (none && !isCase) {
      this.refuse('Fit a case first: every part goes in it');
      return null;
    }
    // (what the game holds for a bare case or an empty stage is only held aside: a board of its tier, or a case of its tier on an empty stage, is not "already fitted")
    const held = isCase ? none && tier === this.board.caseTier : bare && tier === this.board.tier;
    if (
      !held &&
      (isCase ? tier === this.board.caseTier : tier === this.board.tier && this.board.burnt !== true && !bare)
    ) {
      this.refuse('That one is already fitted');
      return null;
    }
    // (asked of the game before anything moves: a case it refuses is not lifted off for nothing, and a refusal keeps the history)
    const why = held ? null : shellRefusal(this.board, itemId);
    if (why !== null && why !== '') {
      this.refuse(`Cannot fit it: ${why}`);
      return null;
    }
    return held;
  }

  /** The parts in the way come out, the front-panel leads go back into their hole, then the board lifts out and (for a new case) the case goes away. */
  protected async liftShell(job: ShellJob): Promise<Undo[]> {
    const steps = job.bare ? [] : removalPlan(buildGraph(this.board, this.cables), job.newCase ? CASE : BOARD);
    const undo: Undo[] = [];
    await inTurn(steps.values(), async (n) => {
      if (n === BOARD || n === CASE) {
        return false;
      }
      await this.takeOut(n, undo);
      return true;
    });
    // the case's front-panel leads come off the board's headers and go back into their hole: the board lifts out bare
    if (!job.bare) {
      await this.unplugPanel();
    }
    // a glass panel shuts now: the board lifts out behind it. A steel one shows nothing shut, so it stands open for the board and shuts for the case
    if (!job.none) {
      await this.door(!job.glass);
    }
    // the board first (on a case swap too: the case cannot lift off with it inside), then the case
    if (!job.bare) {
      this.note('Undo the board screws and lift the board out');
      await this.playAll(this.machine.boardRoots(), 'board', 'out');
    }
    if (job.newCase && !job.none) {
      if (!job.glass) {
        await this.door(false, true);
      } // (the case lifts with its panel: it must stand shut)
      this.note('Take the old case away');
      await this.playAll(this.machine.caseRoots, 'case', 'out');
    }
    return undo;
  }

  /** The new case or board in the game (bought and installed, or the one held aside), and what stands on the stage then. False when the game refused it. */
  protected swapShell(job: ShellJob): boolean {
    // (the board a bare case holds aside, of the tier asked for, is the one that goes in: the game has nothing to change. The same for the first case of an empty stage)
    const bought = job.held ? { ok: true as const, invId: '' } : this.edit((g) => g.purchase(job.item));
    const fitted = !job.held && bought.ok ? this.edit((g) => g.install(bought.invId)) : bought;
    if (!fitted.ok) {
      this.refuse(`Cannot fit it: ${fitted.reason}`);
    }
    // (a case on an empty stage is a bare case now; a board in the case makes it a machine that stands as any other)
    else if (job.isCase) {
      if (job.none) {
        this.shown.value = 'case';
      }
    } else {
      this.shown.value = 'machine';
    }
    // (a board that goes in brings the case's leads: they wait out of sight in their hole until it is down)
    if (fitted.ok && this.shown.peek() === 'machine') {
      this.holdPanel();
    }
    return fitted.ok;
  }

  /** The new case comes down (the board held over it), then the board is lowered onto its standoffs and its front-panel leads go in. */
  protected async lowerShell(job: ShellJob): Promise<void> {
    const board = this.machine.boardRoots(),
      far = poseAt(motionFor('board'), 0, 'in').offset,
      seen = board.map((o) => o.visible);
    if (job.newCase) {
      // the new case comes down first, the board still held over it (out of sight: it fades in on its own way down)
      for (const o of board) {
        o.position.set(o.position.x + far[0], o.position.y + far[1], o.position.z + far[2]);
        o.visible = false;
      }
      this.note(`Set the ${sure(CASE_TIERS[this.board.caseTier]).name} down`);
      await this.playAll(this.machine.caseRoots, 'case', 'in');
    }
    // (a steel panel opens for the board to go in, and for the parts that follow it; the board waits out of sight meanwhile)
    if (steelCase()) {
      await this.door(true);
    }
    if (job.newCase) {
      for (const [i, o] of board.entries()) {
        o.position.set(o.position.x - far[0], o.position.y - far[1], o.position.z - far[2]);
        o.visible = seen[i] === true;
      }
    }
    // (a case set down bare has no board to lower)
    if (!this.bare.peek()) {
      this.note(`Lower the ${job.isCase ? 'board' : `${sure(BOARD_TIERS[job.tier]).name} board`} onto its standoffs`);
      await this.playAll(board, 'board', 'in');
      // the case's front-panel leads run out of their hole to the board's headers and go in
      await this.plugPanel();
    }
  }
}
