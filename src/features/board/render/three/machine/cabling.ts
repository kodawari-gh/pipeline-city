// The machine's cables (machine3d.ts): `MachineLive` (live.ts) with its cables built again, a plug at a time, and the stage's say over its
// front-panel leads and the cables it keeps out of sight.
import { isPanelId } from '../casetray3d';
import { setCable, setCables, syncCables } from './cables';
import { MachineLive } from './live';
import { placeRig, showRig } from './rigs';
import type { RoomGeo, Snapshot } from './types';

/** The machine's cables as the stage and the sim move them: `Machine3D` (machine.ts) is this with its build. */
export class MachineCables extends MachineLive {
  /** Keep these cables out of sight (they are built hidden too) until `letRun`: the stage runs them out of their hole once their part is in (`PlugHand.feed`). */
  holdBack(ids: Iterable<string>): void {
    for (const id of ids) {
      this.unrun.add(id);
      showRig(this, id);
    }
  }

  /** Show these cables again (as they stand). */
  letRun(ids: Iterable<string>): void {
    for (const id of ids) {
      this.unrun.delete(id);
      showRig(this, id);
    }
  }

  /** Is this cable kept out of sight (`holdBack`)? */
  isHeldBack(id: string): boolean {
    return this.unrun.has(id);
  }

  /** The case's front-panel leads this board has (`panelRigs`), west to east. */
  panelIds(): string[] {
    return [...this.rigs.keys()].filter((id) => isPanelId(id));
  }

  /**
   * Bring the front-panel leads in line with the stage's say of which are out of their headers (`panelOut`, kept by reference): each stands as that says.
   * A lead built so already stays as it is (one the hand moved keeps its rest pose).
   */
  syncPanel(out: ReadonlySet<string>): void {
    this.panelOut = out;
    let changed = false;
    for (const [id, b] of this.built) {
      if (isPanelId(id) && b.seated === out.has(id)) {
        changed = placeRig(this, id, !out.has(id)) || changed;
      }
    }
    if (changed) {
      this.partLod?.build(this.wires);
    }
  }

  /** Build one draggable cable again as it stands (`seated`, default as it was; a dropped plug at its rest pose): the others stay as they are. */
  setCable(kind: string, seated?: boolean): void {
    setCable(this, kind, seated);
  }

  /** Build all the cables and the key again: the parts stay as they are. */
  setCables(s: Snapshot, geo: RoomGeo): void {
    setCables(this, s, geo);
  }

  /** Bring the cables in line with the sim: a plug in or out builds only its own cable, a key in or out only the key, a cable come or gone all. */
  syncCables(s: Snapshot, geo: RoomGeo): void {
    syncCables(this, s, geo);
  }
}
