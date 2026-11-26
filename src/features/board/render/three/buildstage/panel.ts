// The case's front-panel leads: which are plugged, and the hand that pulls and pushes them.
import type { Result } from '@/worker/game/types';
import type { HandSnap, Snapshot } from './types';
import type { Machine3D } from '../machine3d';
import { PANEL_IDS, isPanelId } from '../casetray3d';
import { playCue } from '@/app/audio/engine';
import type { CueId } from '@/app/audio/mixTokens';
import { CABLE_QUICK, inTurn, sure } from './tuning';
import { StageRebuild } from './rebuild';

export abstract class StagePanel extends StageRebuild {
  /** Cables the job keeps out of sight until it runs them out of their hole (a part just fitted brings its cables) and after it took them back into it. */
  protected readonly reeled = new Set<string>();

  protected panelRev = 0;
  protected panelSnap: { src: Snapshot; m: Machine3D; rev: number; out: HandSnap } | null = null;

  /** The snapshot as the hand reads it: the game's, and each front-panel lead of the machine as a cable (plugged unless it is out). */
  protected handSnapshot(): HandSnap {
    const s = this.snapshot,
      m = this._machine,
      c = this.panelSnap;
    if (!m) {
      return s;
    }
    if (c && c.src === s && c.m === m && c.rev === this.panelRev) {
      return c.out;
    }
    // (an id the sim has no word for: the hand only reads it back)
    const leads = m.panelIds().map((id) => ({
      id,
      name: sure(m.rig(id)).name,
      connected: !this.panelOut.has(id),
    }));
    const out: HandSnap = { ...s, cables: [...s.cables, ...leads] };
    this.panelSnap = { src: s, m, rev: this.panelRev, out };
    return out;
  }

  /** The hand pushed a front-panel lead into its header or pulled it out: the stage says so and plays the cable cue, as for the game's cables (the machine's built lead follows the hand: `PlugHand`). */
  protected plugPanelLead(id: string, plugged: boolean): void {
    if (plugged) {
      this.panelOut.delete(id);
    } else {
      this.panelOut.add(id);
    }
    this.panelRev++;
    playCue(plugged ? 'cable_connect' : 'cable_disconnect');
  }

  /**
   * The game's answer to a plug in or out. A refusal is said on the hint line. A cable moved by the player (no job runs) brings the machine in line with the game:
   * the wall's lights (the LAN lead), the chip, the alerts. A job does that at its end.
   */
  protected cableChanged(r: Result, what: string, cue: CueId): void {
    if (!r.ok) {
      this.refuse(`Cannot ${what}: ${r.reason}`);
      return;
    }
    playCue(cue);
    if (!this.status.peek().busy) {
      this.rebuild();
    }
  }

  /** Every front-panel lead is in its header (a job is over; a machine the game built): the leads as the machine builds them. */
  protected panelHome(): void {
    if (this.panelOut.size === 0) {
      return;
    }
    this.panelOut.clear();
    this.panelRev++;
    this._machine?.syncPanel(this.panelOut);
  }

  /** The board that goes in brings its leads along: they wait out of their headers, out of sight in their hole (`plugPanel` runs them out once the board is in). */
  protected holdPanel(): void {
    for (const id of PANEL_IDS) {
      this.panelOut.add(id);
      this.reeled.add(id);
    }
    this.panelRev++;
  }

  /** The board is in: the hand runs each lead out of its hole to its header and pushes the plug home. */
  protected async plugPanel(): Promise<void> {
    const ids = this.machine.panelIds().filter((id) => this.reeled.has(id));
    if (ids.length === 0) {
      return;
    }
    this.note('Plug in the front-panel leads');
    await inTurn(ids.values(), async (id) => {
      this.setStep('Run the lead to its header');
      await this.runOut(id, true);
      return !this.dead;
    });
  }

  /** The board is to come out: the hand pulls each front-panel lead off its header and takes it back into its hole (the case keeps them: they come out again with the next board). */
  protected async unplugPanel(): Promise<void> {
    const ids = this.machine.panelIds().filter((id) => !this.reeled.has(id));
    if (ids.length === 0) {
      return;
    }
    this.note('Unplug the front-panel leads');
    await inTurn(ids.values(), async (id) => {
      await this.reelIn(id);
      return !this.dead;
    });
  }

  /** The cables a part brought that nobody plugs (the video cable) run out and lie where they fall. */
  protected async runLoose(): Promise<void> {
    const left = new Set<string>(
      this.snapshot.cables.filter((c) => c.connected || c.blocked === undefined || c.blocked === '').map((c) => c.id),
    );
    // (a copy: the run deletes from the set as it goes)
    await inTurn([...this.reeled].values(), async (id) => {
      if (!left.has(id)) {
        this.reeled.delete(id);
        return;
      }
      this.setStep('Lay the cable out');
      await this.runOut(id, false);
    });
  }

  /** The machine just built (or patched) hides the cables the job holds back. */
  protected override holdReeled(): void {
    if (this.reeled.size > 0) {
      this._machine?.holdBack(this.reeled);
    }
  }

  /** The job is over (or a new one begins): every cable shows as it stands. */
  protected releaseReeled(): void {
    if (this.reeled.size > 0) {
      this._machine?.letRun(this.reeled);
    }
    this.reeled.clear();
  }

  /** The cable runs out of its hole: pushed home at its socket (`plug`), or to where it lies. False when there is nothing to run (the built cable shows as it stands). */
  protected async runOut(id: string, plug: boolean): Promise<boolean> {
    if (!this.reeled.delete(id)) {
      return false;
    }
    const ok = await this.hand.feed(id, plug, this.pace > 1 ? CABLE_QUICK : 1);
    if (!ok && !this.dead) {
      this._machine?.letRun([id]);
    }
    return ok;
  }

  /** A cable that goes with the part that is leaving is taken back into its hole along the way it lies (one still plugged is pulled out first), and stays out of sight. */
  protected async reelIn(id: string): Promise<void> {
    const speed = this.pace > 1 ? CABLE_QUICK : 1;
    if (!this.machine.rig(id)) {
      return;
    }
    if ((isPanelId(id) ? !this.panelOut.has(id) : this.cables[id] === true) && !(await this.hand.pullOut(id, speed))) {
      return;
    }
    if (this.dead) {
      return;
    }
    this.setStep('Take the cable back into its hole');
    if (await this.hand.stow(id, speed)) {
      this.reeled.add(id);
    }
  }
}
