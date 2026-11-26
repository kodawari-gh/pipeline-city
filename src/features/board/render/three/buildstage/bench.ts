// The benchmark: load it, run it, stop it.
import type { Stop } from '@/features/sandbox/sim/pcbench';
import { playCue } from '@/app/audio/engine';
import { StageMarker } from './marker';

export abstract class StageBench extends StageMarker {
  /** Load the benchmark's code (once): `benchIssues` has an answer after it. */
  async loadBench(): Promise<void> {
    if (this.benchMod || this.dead) {
      return;
    }
    this.benchMod = await import('@/features/sandbox/sim/pcbench');
    if (!this.dead) {
      this.benchLoaded.value = true;
    }
  }

  /**
   * Run the benchmark's tasks (`ids`; every task this machine can run when omitted) on copies of the machine as it stands, one after the other (the stage's game
   * is not changed). Each result lands in `bench` as it comes. A change to the machine or `stopBenchmark` ends the run: the task in progress has no result.
   */
  async runBenchmark(ids?: readonly string[]): Promise<void> {
    if (this.dead || this.benching.peek() || this.status.peek().busy) {
      return;
    }
    const stop: Stop = { aborted: false };
    this.benchStop = stop;
    playCue('ui_confirm');
    this.benching.value = { id: null, n: 0, total: 0 };
    try {
      await this.loadBench();
      if (this.dead || stop.aborted || !this.benchMod) {
        return;
      }
      const { benchable, runBenchTasks } = this.benchMod;
      const list = benchable(this.game, ids).map((t) => t.id);
      await runBenchTasks(this.game, list, {
        stop,
        onStart: (t, i, n) => {
          this.benching.value = { id: t.id, n: i + 1, total: n };
        },
        onResult: (r) => {
          this.bench.value = { ...this.bench.peek(), [r.id]: r };
        },
      });
      if (!stop.aborted) {
        playCue('job_fulfilled');
      }
    } finally {
      this.benching.value = null;
    }
  }

  /** End the benchmark that runs now (the task in progress has no result). */
  stopBenchmark(): void {
    this.benchStop.aborted = true;
  }
}
