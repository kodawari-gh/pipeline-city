// The benchmark's last result, kept with the machine it ran on (`benchChanged`).
import { signal } from '@preact/signals';
import type { Stop } from '@/features/sandbox/sim/pcbench';
import type { TaskResult } from '@/features/sandbox/sim/benchtasks';
import { StageBase } from './stagebase';

export abstract class StageScores extends StageBase {
  /** What the benchmark has scored on the machine as it stands, by task id (any change to the machine empties it), and how far a run has got (null: none runs). */
  readonly bench = signal<Readonly<Record<string, TaskResult>>>({});
  /** The scores of the machine before the last change that had any: the screen shows the change from them. */
  readonly benchWas = signal<Readonly<Record<string, TaskResult>>>({});
  protected benchStop: Stop = { aborted: false };
  /** The machine changed: the scores no longer describe it (they stay as the ones to compare with), and a run on its old copy ends. */
  protected benchChanged(): void {
    this.benchStop.aborted = true;
    const now = this.bench.peek();
    if (Object.keys(now).length > 0) {
      this.benchWas.value = now;
      this.bench.value = {};
    }
  }
}
