// Undo and redo, the whole machines swapped included.
import { devNode } from '@/features/board/sim/removal';
import type { Game } from '@/worker/game/game';
import type { Shown } from '@/features/board/sim/buildspecs';
import { netName } from '@/features/board/sim/buildnet';
import { playCue } from '@/app/audio/engine';
import type { PartStep, Step } from './types';
import { inTurn, KEEP_SWAPS, steelCase } from './tuning';
import { stepCue } from './parts';
import { StageNet } from './net';

export abstract class StageHistory extends StageNet {
  // ------------------------------------------------------------------ undo and redo (a part fitted or taken out; the whole machine swapped for a preset, a saved build, the full rig or an empty case; a new case or board starts over)
  protected past: Step[] = [];
  protected future: Step[] = [];
  protected replay = false;
  /** How many times the machine was swapped for another (a preset, a saved build, Undo of one): the UI tells a swap it just made from a later one by it. */
  protected swapCount = 0;
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  protected override record(s: Step): void {
    if (this.replay) {
      return;
    }
    const cue = stepCue(s);
    if (cue) {
      playCue(cue);
    }
    this.past.push(s);
    this.future = [];
    // (a swap keeps a whole game: past the limit the oldest goes, and with it the steps made on the machines before it)
    let swaps = 0;
    for (const x of this.past) {
      if (x.t === 'swap') {
        swaps++;
      }
    }
    if (swaps > KEEP_SWAPS) {
      this.past = this.past.slice(this.past.findIndex((x) => x.t === 'swap') + 1);
    }
  }
  protected forget(): void {
    this.past = [];
    this.future = [];
  }
  protected async run(s: PartStep): Promise<void> {
    this.replay = true;
    try {
      if (s.t === 'fit') {
        await this.fit(s.spec, s.slot);
      } else {
        const d = this.board.devices.find((x) => x.slot === s.slot && x.spec === s.spec);
        if (d) {
          await this.remove(devNode(d.id));
        }
      }
    } finally {
      this.replay = false;
    }
  }
  /**
   * Do a step, or its opposite (`undo`). The step to keep for the way back: a part's as it was, a swap's as the game it left. The opposite of a step also puts back
   * the parts that step took out for good (`along`): Undo of a cooler's removal brings back the cooler and the fan that sat on it.
   */
  protected async apply(s: Step, undo: boolean): Promise<Step> {
    if (s.t === 'swap') {
      return this.swapIn(s.game, undo ? 'Went back to the machine before' : 'Went forward again', s.shown);
    }
    if (s.t === 'net') {
      const to = undo ? s.from : s.to,
        r = this.setNetItem(s.kind, to);
      if (!r.ok) {
        this.refuse(`Cannot ${to !== null && to !== '' ? `fit ${netName(to)}` : 'take it out'}: ${r.reason}`);
      }
      return s;
    }
    await this.run(undo ? { t: s.t === 'fit' ? 'remove' : 'fit', spec: s.spec, slot: s.slot } : s);
    if (undo) {
      await inTurn((s.along ?? []).values(), async (a) => {
        await this.run({ t: 'fit', spec: a.spec, slot: a.slot });
      });
    }
    return s;
  }
  async undo(): Promise<void> {
    const s = this.past.pop();
    if (!s || this.status.peek().busy) {
      if (s) {
        this.past.push(s);
      }
      return;
    }
    this.future.push(await this.apply(s, true));
    this.bump();
  }
  async redo(): Promise<void> {
    const s = this.future.pop();
    if (!s || this.status.peek().busy) {
      if (s) {
        this.future.push(s);
      }
      return;
    }
    this.past.push(await this.apply(s, false));
    this.bump();
  }

  get swaps(): number {
    return this.swapCount;
  }
  /** Is the last step of the history a swap? Then Undo brings back the machine that was on the stage before. */
  get lastWasSwap(): boolean {
    return this.past.at(-1)?.t === 'swap';
  }

  /**
   * Put `g` on the stage in place of the machine, and give the step that puts the old one back. What was picked, lit or scored belonged to the old
   * machine. `shown`: what stands on the stage for it (`shown`, the signal): a bare case, or nothing at all.
   */
  protected swapIn(g: Game, line: string, shown: Shown = 'machine'): Step {
    const left = this.game,
      was = this.shown.peek(),
      wasSteel = steelCase();
    this.clearRefusal();
    this.swapCount++;
    this.shown.value = shown; // (before the build: it draws the machine as it is now)
    this.game = g; // (the scores of the old machine become the ones to compare with: `benchChanged`, in the setter)
    this.panelOut.clear(); // (the machine that comes has its leads in their headers)
    this.panelRev++;
    this.select(null);
    this.glow(null);
    this.status.value = { busy: false, step: '', log: [line], rev: this.status.peek().rev };
    this.rebuild();
    // (a steel panel opens for the new machine, there is nothing to see shut; a glass one is left to the zoom, as it was; with no case there is no panel)
    if (shown === 'nothing') {
      this.wantOpen = false;
    } else if (steelCase()) {
      this.wantOpen = true;
    } else if (wasSteel) {
      this.wantOpen = false;
    }
    return { t: 'swap', game: left, shown: was };
  }
}
