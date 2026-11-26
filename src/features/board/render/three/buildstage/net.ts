// The OS, the router and the internet plan: fitted to the room, not to a socket.
import type { Game } from '@/worker/game/game';
import type { Result } from '@/worker/game/types';
import { netName, netState, setNet } from '@/features/board/sim/buildnet';
import type { NetKind } from './types';
import { StageFitBack } from './fitback';

export abstract class StageNet extends StageFitBack {
  /** Put an OS, a router or an internet plan in its place (`id`), or take it out (`id` null): the game's own answer, and no step is recorded here. */
  protected setNetItem(kind: NetKind, id: string | null): Result {
    const r = this.edit((g) => setNet(g, kind, id));
    if (r.ok) {
      this.bump();
    }
    return r;
  }

  /**
   * An OS, a router or an internet plan from the shelf. They fit the room, not a socket: the OS goes on the first drive that holds it (the one it
   * replaces comes off), the router stands by the wall and is cabled to the machine's jack, and the plan comes in by the wall jack. Each replaces
   * the one of its kind; the same item again is refused. Undo sets the item that was there.
   */
  protected fitNet(itemId: string, kind: NetKind): void {
    const was = netState(this.game)[kind],
      name = netName(itemId);
    if (was === itemId) {
      this.refuse(`${name} is already in place`);
      return;
    }
    const r = this.setNetItem(kind, itemId);
    if (!r.ok) {
      this.refuse(`Cannot fit ${name}: ${r.reason}`);
      return;
    }
    this.record({ t: 'net', kind, from: was, to: itemId });
    this.note(`Fit ${name}`);
  }

  /**
   * One change from the OS sheet's disk page (a drive formatted, a drive's spool slots, the dataset reserve): the game's own method on the stage's machine. A refusal
   * says why on the hint line. The scores no longer describe the machine, as after any change to it.
   */
  osDo(what: string, change: (g: Game) => { ok: boolean; reason?: string }): void {
    if (this.dead || !this._game || this.status.peek().busy) {
      return;
    }
    const r = this.edit(change);
    this.bump();
    if (!r.ok) {
      this.refuse(`${what}: ${r.reason}`);
    }
  }

  /** The processor's cores as the OS sees them (`hardware` cores, `logical` ones), for the OS sheet: what each OS would do with them. */
  get cpuCores(): { hardware: number; logical: number } {
    return { hardware: this.game.cpuCores(), logical: this.game.cpuLogicalCores() };
  }

  /** Take the OS, the router or the internet plan out (what the right panel's row does). Undo puts it back. */
  async removeNet(kind: NetKind): Promise<void> {
    await this.job(() => {
      const was = netState(this.game)[kind];
      if (was === null || was === '') {
        return;
      }
      const r = this.setNetItem(kind, null);
      if (!r.ok) {
        this.refuse(`Cannot take ${netName(was)} out: ${r.reason}`);
        return;
      }
      this.record({ t: 'net', kind, from: was, to: null });
      this.note(`Took out ${netName(was)}`);
    });
  }
}
