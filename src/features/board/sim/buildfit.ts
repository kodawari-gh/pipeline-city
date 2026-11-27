// A fit, run whole on the game (`buildsession.ts` `fit`): the parts in the way and the part the slot holds come out, the part is bought and installed, the
// others go back, the hoses go on last, the cables the machine needs go in, and the cables the new part brought run out. It keeps each as a step of the
// script (`buildscript.ts`).
import type { InstalledDevice } from '@/features/board/sim';
import { OUTSIDE } from './buildpreset';
import { RemovalJob, nameOf, stateOf } from './buildscript';
import { WALL_CABLES, cablesOf } from './cables';
import { HOSES, devNode, hasLoop } from './removal';

type Outcome = ReturnType<RemovalJob['run']>;

/** What a fit puts where: the catalogue part, its slot, the nodes that come out first (the removal graph's order), and the part the slot holds. */
export interface FitPlan {
  item: string;
  slot: string;
  steps: string[];
  occupant: InstalledDevice | null;
}

export class FitJob extends RemovalJob {
  /** The ids of the cables that stand (plugged, or free to plug) now. */
  private cableIds(): Set<string> {
    return new Set(this.game.snapshot().cables.flatMap((c) => (c.connected || c.blocked === undefined ? [c.id] : [])));
  }

  /** Run the fit; the script, and the game's refusal of it (nothing is left half done: the parts that came out go back). */
  fit(p: FitPlan): Outcome {
    const g = this.game,
      before = stateOf(g),
      looped = hasLoop(g.board),
      had = this.cableIds();
    this.target = p.occupant ? devNode(p.occupant.id) : '';
    for (const n of p.steps) {
      this.takeOut(n);
    }
    if (this.refusal === null) {
      this.install(p);
    }
    this.goBack(looped);
    if (this.refusal === null) {
      this.plugNeeded();
      // (every cable the part brought, plugged or not: the stage runs the ones still held back out of their hole)
      for (const id of this.cableIds()) {
        if (!had.has(id)) {
          this.push({ kind: 'cable-run', node: `cable:${id}` });
        }
      }
    }
    // (what could not go back is listed on the first step of the fit: the part taken out, else the new one)
    const rec = this.steps.find((s) => s.target) ?? this.steps.at(-1);
    if (rec !== undefined && this.along.length > 0) {
      rec.along = this.along;
    }
    return { script: this.steps, before, refusals: this.pending, refusal: this.refusal };
  }

  /** The part is bought and goes into its slot. */
  private install(p: FitPlan): void {
    const g = this.game,
      name = nameOf(p.item),
      bought = g.purchase(p.item);
    if (!bought.ok) {
      this.refusal = `Cannot get ${name}: ${bought.reason}`;
      return;
    }
    const put = g.install(bought.invId, p.slot);
    if (!put.ok) {
      this.refusal = `${name} does not fit: ${put.reason}`;
      return;
    }
    const id = put.deviceId ?? '';
    // (the same part in the same socket: the one that came out stands as the new one)
    const same = p.occupant !== null && p.occupant.spec === p.item && id !== '';
    this.push({
      kind: 'part-in',
      node: devNode(id),
      target: true,
      spec: p.item,
      slot: p.slot,
      ids: same && p.occupant ? new Map([[p.occupant.id, id]]) : new Map(),
    });
  }

  /** The parts that came out go back, then the hoses (the loop stood, or the new part made it), then the cables. */
  private goBack(looped: boolean): void {
    const undo = this.undo.toReversed();
    for (const u of undo) {
      if (u.t === 'dev') {
        this.putBackPart(u);
      }
    }
    if ((undo.some((u) => u.t === 'hoses') || !looped) && hasLoop(this.game.board)) {
      this.push({ kind: 'hoses-on', node: HOSES });
    }
    for (const u of undo) {
      if (u.t === 'cable') {
        this.plugBack(u.id);
      }
    }
  }

  /** The cables the machine needs go in. The cords from the wall go in too; the video cable and the LAN lead stay out: they are the player's. */
  protected plugNeeded(): void {
    for (const c of cablesOf(this.game.board)) {
      if (!OUTSIDE.has(c.id) || WALL_CABLES.includes(c.id)) {
        this.plugBack(c.id);
      }
    }
  }
}
