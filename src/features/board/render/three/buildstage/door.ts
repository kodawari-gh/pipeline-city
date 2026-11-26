// The case's side panel: open and shut, and the part labels.
import { devNode, HOSES, isCableNode, SIDE } from '@/features/board/sim/removal';
import { deviceSpec } from '@/features/board/sim/board';
import { DOOR_SECONDS, doorWait } from '../casedoor';
import { sleep, caseKind } from './tuning';
import { StageTick } from './tick';

export abstract class StageDoor extends StageTick {
  /**
   * The side panel for a step: it opens once, for the first step that needs the inside, and not at all when it stands open already (a click, the
   * zoom, the step before). The job holds it open to its end; then the zoom has it (`Machine3D.setOpen`), or the player when the panel is steel
   * (`job`). Only a new case or board shuts it. `settle`: wait for the whole swing (the case is about to lift: it must stand shut first).
   */
  protected async door(open: boolean, settle = false): Promise<void> {
    const was = this.machine.doorOpen,
      kind = caseKind();
    if (open) {
      if (this.jobOpen) {
        return;
      }
      this.jobOpen = true;
      // (the zoom opened it a moment ago and it still swings: the step waits for it as well)
      if (was) {
        await this.swung(doorWait(kind), true);
        return;
      }
    } else {
      this.jobOpen = false;
      this.wantOpen = false;
      if (!was) {
        return;
      }
      this.machine.closeDoor();
    }
    this.setStep(open ? 'Undo the side panel' : 'Close the side panel');
    // (the work starts while the panel is still swinging: it is clear of the inside once it has swung far enough, `doorWait`)
    await sleep((DOOR_SECONDS[kind] * 1000 * (settle ? 1 : doorWait(kind))) / this.rate() + (settle ? 60 : 0));
    if (open) {
      await this.swung(doorWait(kind), true);
    } else if (settle) {
      await this.swung(0, false);
    }
  }

  /**
   * Wait until the side panel itself has swung to `to` (0 shut .. 1 open): at least that far when `open`, at most when shut. The clock's wait in `door` is the pace of a
   * steady frame rate; a slow frame counts for at most a tenth of a second (`frameDt`), so the panel can lag behind the clock, and a part must not move through a panel
   * that is still in its way. No panel (or a stage with no drawing loop) leaves the clock's wait; the longest it waits is a few times a full swing.
   */
  protected async swung(to: number, open: boolean): Promise<void> {
    const until = Date.now() + (DOOR_SECONDS[caseKind()] * 3000) / Math.max(0.25, this.rate()) + 300;
    await this.swingTill(to, open, until);
  }

  /** Waits a frame at a time until the panel reaches `to` (or the stage closes, or `until` passes). */
  protected async swingTill(to: number, open: boolean, until: number): Promise<void> {
    const t = this._machine?.doorT;
    if (this.dead || t === undefined || t === null || (open ? t >= to - 0.01 : t <= to + 0.01) || Date.now() > until) {
      return;
    }
    await sleep(16);
    await this.swingTill(to, open, until);
  }

  protected labelOf(node: string, verb: 'Take out' | 'Put back'): string {
    if (node === SIDE) {
      return verb === 'Take out' ? 'Open the side panel' : 'Close the side panel';
    }
    if (node === HOSES) {
      return verb === 'Take out' ? 'Disconnect the loop hoses' : 'Connect the loop hoses';
    }
    if (isCableNode(node)) {
      return `${verb === 'Take out' ? 'Unplug' : 'Plug in'} ${this.snapshot.cables.find((c) => c.id === node.slice(6))?.name ?? node.slice(6)}`;
    }
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    return `${verb} ${d ? deviceSpec(d).name : node}`;
  }
}
