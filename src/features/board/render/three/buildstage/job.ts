// A job on the machine: power off, take out what stands in the way, do it, put the rest back.
import { buildGraph, devNode, isDevNode, removalPlan } from '@/features/board/sim/removal';
import { boardSlots, freeSlots, slotAccepts, slotFits } from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';
import { netKindOf } from '@/features/board/sim/buildnet';
import { standing } from '@/features/board/sim/buildalerts';
import type { InstalledDevice, PartStep, SlotInfo, Undo } from './types';
import { inTurn, QUICK, steelCase } from './tuning';
import { StageAssembly } from './assembly';

export abstract class StageJob extends StageAssembly {
  protected async job(work: () => Promise<void> | void): Promise<void> {
    if (this.status.peek().busy || this.dead) {
      return;
    }
    this.clearRefusal(); // (what was refused before is stale once the player tries again)
    this.powerOffForJob();
    // (the picked part is the one in its socket after the job: a part that came out and went back in has a new id)
    const sel = this.selected.peek(),
      was = sel !== null && sel !== '' ? this.board.devices.find((d) => d.id === sel) : undefined;
    const had = standing(this.alerts, this.board);
    this.stayed = [];
    this.reeled.clear();
    this.hover.value = null;
    this.status.value = { ...this.status.peek(), busy: true, step: '' };
    this.pace = 1;
    this.skipping = false;
    try {
      await work();
    } catch (error) {
      if (!this.dead) {
        throw error;
      }
    } finally {
      // (a close in the middle of a job: the stage is gone, nothing to put back)
      if (!this.dead) {
        this.endJob(was, had);
      }
    }
  }

  /** Parts and the supply's cables only move while the machine is off: a job switches it off first, as a player would. */
  protected powerOffForJob(): void {
    if (this._game?.powered !== true) {
      return;
    }
    this.game.powerButton();
    this.snaps.drop();
    this.editRev++;
    this.owed = 0;
    this.syncRun();
    this.note('Powered off: parts only move while the machine is off');
  }

  /** The job is over: what it held back shows, the side panel is the zoom's again, and the machine is checked and drawn as it stands. `was`: the part picked before it. */
  protected endJob(was: InstalledDevice | undefined, had: ReadonlyMap<string, number>): void {
    // (a cable still held back shows as it stands)
    this.hand.cancel();
    this.releaseReeled();
    this.panelHome();
    // (the side panel is the zoom's again: it stays while the view is on the board; a loop's hoses are never left off.
    // A steel panel shows nothing shut, so what the job did stays in view: the panel stays open until the player shuts it)
    this.jobOpen = false;
    if (steelCase() && this.machine.doorOpen) {
      this.wantOpen = true;
    }
    this.pace = 1;
    this.skipping = false;
    this.hosesOff = false;
    const h = this._machine?.hoses;
    if (h && !h.root.visible) {
      h.rest();
      h.root.visible = true;
      this.demand.ask();
    }
    this.status.value = { ...this.status.peek(), busy: false, step: '' };
    this.holdRefusal(); // (a refusal the job raised: its seconds count from now)
    this.keepOs();
    this.caution(had);
    this.rebuild();
    this.selected.value = was
      ? (this.board.devices.find((d) => d.slot === was.slot && d.spec === was.spec)?.id ?? null)
      : null;
  }

  /** The nodes to take out for a target, in order (the target last). */
  plan(node: string): string[] {
    return this.dead ? [] : removalPlan(buildGraph(this.board, this.cables), node);
  }

  /** Take a part out with everything in its way, then put the others back. The part goes to the bin (the game's inventory). */
  async remove(node: string): Promise<void> {
    await this.job(async () => {
      this.deferring = true;
      try {
        await this.removeSteps(node);
      } finally {
        this.deferring = false;
      }
    });
  }

  protected async removeSteps(node: string): Promise<void> {
    const undo: Undo[] = [],
      steps = this.assemble(this.plan(node));
    const gone = isDevNode(node) ? this.board.devices.find((x) => devNode(x.id) === node) : undefined;
    const step: PartStep | null = gone ? { t: 'remove', spec: gone.spec, slot: gone.slot } : null;
    if (step) {
      this.record(step);
    }
    const quick = steps.length > 2 ? QUICK : 1;
    await inTurn(steps.values(), async (n) => {
      this.pace = n === node ? 1 : quick;
      await this.takeOut(n, n === node ? null : undo);
    });
    this.pace = quick;
    await inTurn(undo.toReversed().values(), async (u) => {
      await this.putBack(u);
    });
    this.pace = 1;
    // (what could not go back, as the part's removal left it: Undo brings it back after the part)
    if (step && this.stayed.length > 0) {
      step.along = this.stayed.splice(0);
    }
    this.note(`Done: ${steps.length} step${steps.length === 1 ? '' : 's'}`);
  }

  /** The socket a part would be fitted in when dropped at a client point (or by a click when `x` is not given): what `fit` picks. Null when none takes it. */
  dropTarget(item: string, x?: number, y?: number): string | null {
    // (a case or a board lands on the PC itself; with no case on the stage a board has nothing to land on)
    if (/^(?:case|board)\d$/u.test(item)) {
      return this.shown.peek() === 'nothing' && item.startsWith('board') ? null : item;
    }
    // (an OS, a router and a plan fit the room, not a socket: any drop on the stage takes them)
    if (netKindOf(item)) {
      return item;
    }
    const spec = getSpec(item);
    if (!spec || this.bare.peek()) {
      return null;
    } // (a bare case has no socket)
    const fits = (s: SlotInfo) => slotAccepts(s.type, spec.slot) && slotFits(s, spec);
    const at = x === undefined || y === undefined ? null : this.slotAt(x, y);
    if (at !== null && at !== '' && boardSlots(this.board).some((s) => s.id === at && fits(s))) {
      return at;
    }
    return (
      freeSlots(this.board, spec.slot, spec)[0]?.id ??
      boardSlots(this.board).find((s) => fits(s) && this.board.devices.some((d) => d.slot === s.id))?.id ??
      null
    );
  }
}
