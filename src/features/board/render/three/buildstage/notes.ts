// The hint line and the step log: what the stage says it does, a refusal, the alerts of the machine.
import { signal } from '@preact/signals';
import type { Shown } from '@/features/board/sim/buildspecs';
import { buildAlerts, newAlerts } from '@/features/board/sim/buildalerts';
import { REFUSAL_MS } from './tuning';
import type { Alert } from './types';
import { StagePrograms } from './programs';

export abstract class StageNotes extends StagePrograms {
  /** The last refusal (a part that fits no socket, a removal that cannot be done): the hint line shows it for a few seconds, whatever the log (for `?debug`) holds. */
  readonly refusal = signal<{ text: string; n: number } | null>(null);
  protected refusalTimer: ReturnType<typeof setTimeout> | undefined;
  protected refusals = 0;
  protected alertMemo: { rev: string; shown: Shown; list: readonly Alert[] } | null = null;

  protected setStep(step: string): void {
    const st = this.status.peek();
    if (st.step !== step) {
      this.status.value = { ...st, step };
    }
  }

  protected note(line: string): void {
    const st = this.status.peek();
    this.status.value = { ...st, log: [...st.log.slice(-39), line] };
  }

  /** A refusal goes in the log like any step, and is raised for the hint line too (the player does not see the log). */
  protected refuse(line: string): void {
    this.note(line);
    this.refusal.value = { text: line, n: ++this.refusals };
    this.holdRefusal();
  }

  /** The refusal goes after a few seconds, counted from the end of the job that raised it (while a job runs the hint line says its steps). */
  protected holdRefusal(): void {
    clearTimeout(this.refusalTimer);
    if (this.refusal.peek() && !this.status.peek().busy) {
      this.refusalTimer = setTimeout(() => {
        this.refusal.value = null;
      }, REFUSAL_MS);
    }
  }

  /** Let the refusal go at once (the player dismissed it, or a new job or machine made it stale). */
  clearRefusal(): void {
    clearTimeout(this.refusalTimer);
    if (this.refusal.peek()) {
      this.refusal.value = null;
    }
  }

  protected bump(): void {
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
  }

  /**
   * What is wrong with the machine as it stands (`buildAlerts`): a supply too small, a card with no lead, a part too hot. One run per change of the machine (the
   * heat is a dry run of the thermal model, some milliseconds), and none while a job runs: the machine is half taken apart then, and the list stays as it was.
   */
  get alerts(): readonly Alert[] {
    if (this.alertMemo && this.status.peek().busy) {
      return this.alertMemo.list;
    }
    // (keyed on the game's changes and on what has burnt, not on its snapshot: a machine that runs gives a new snapshot every tick, and its parts and cables have not changed)
    const rev = `${this.editRev}|${this.board.burnt === true ? 'b' : ''}${this.board.devices
        .filter((d) => d.burnt === true)
        .map((d) => d.id)
        .join(',')}`,
      shown = this.shown.peek();
    if (!this.alertMemo || this.alertMemo.rev !== rev || this.alertMemo.shown !== shown) {
      this.alertMemo = { rev, shown, list: buildAlerts(this.board, this.cables, shown, this.game.fanPower()) };
    }
    return this.alertMemo.list;
  }
  /**
   * The machine takes any part that fits its socket and answers as it would in real life, so a change that leaves it with a problem it did not have, or a worse
   * one (a supply too small, a card with no lead, a CPU too hot: `newAlerts`) must not pass in silence: the hint line says it, amber, as it does a refusal. The
   * pill and the list say it too, for as long as it holds; this is for the player who is looking at the parts. A refusal of the same job is the news, and stays.
   * `had`: what the machine had before the job (`standing`).
   */
  protected caution(had: ReadonlyMap<string, number>): void {
    if (this.refusal.peek()) {
      return;
    }
    const [news] = newAlerts(this.alerts, this.board, had);
    if (news) {
      this.refuse(`${news.title}: ${news.text}`);
    }
  }
}
