// The machine running in the sandbox: power, the simulation rate, a skip ahead.
import { signal } from '@preact/signals';
import { DEFAULT_RUN_SPEED, MAX_TICKS_PER_FRAME } from '@/features/board/sim/buildrun';
import { playCue } from '@/app/audio/engine';
import { crashReport } from '@/worker/crash';
import type { BenchProgress, RunSpeed } from './types';
import { SKIP } from './tuning';
import { StageNotes } from './notes';

export abstract class StageRun extends StageNotes {
  readonly benching = signal<BenchProgress | null>(null);
  /** Playback speed: 1 is the animations' own time. */
  readonly speed = signal(1);
  /** A long chain of steps plays its parts in the way faster (`QUICK`), and a press of Space or Escape fast-forwards what is left of a job. */
  protected pace = 1;
  protected skipping = false;
  /** Counts up with each batch of ticks the game ran: what shows live numbers (the OS sheet) draws again on it. */
  readonly ticks = signal(0);
  /** How fast the machine runs while it is on, in base ticks a second (`RUN_SPEEDS`; the game's 1x is one a second). */
  readonly simSpeed = signal<RunSpeed>(DEFAULT_RUN_SPEED);
  /** The base ticks the machine has run on the stage (a second each at 1x): the OS sheet's graphs take a sample for each. */
  protected ran = 0;
  protected rate(): number {
    return this.speed.peek() * this.pace * (this.skipping ? SKIP : 1);
  }
  /** Fast-forward the job that runs now (its steps all play, quicker). */
  skip(): void {
    if (this.status.peek().busy) {
      this.skipping = true;
    }
  }
  get simulated(): number {
    return this.ran;
  }
  /**
   * The power button (the toolbar's, or a click on the case's own). Off to on starts the machine, which then runs at `simSpeed`; on to off is a hard power-off, as
   * in the game (a job in flight is lost). A machine that cannot start says why on the hint line.
   */
  power(): void {
    if (this.dead || !this._machine || this.status.peek().busy || this.shown.peek() !== 'machine') {
      return;
    }
    const r = this.game.powerButton();
    this.snaps.drop();
    this.editRev++;
    this.owed = 0;
    this.demand.ask();
    this.syncRun();
    if (!r.ok) {
      this.refuse(r.reason.startsWith('no power: ') ? `Cannot power on: ${r.reason.slice(10)}` : r.reason);
      return;
    }
    this.clearRefusal();
    playCue(r.powered ? 'power_on' : 'power_off');
    this.note(r.powered ? 'Powered on' : 'Powered off');
    this.bump();
  }

  /**
   * The machine runs: while the game is powered it ticks at the chosen speed (as the worker's host does: whole ticks, a cap on a frame, the backlog beyond it dropped),
   * the snapshot is made again after the ticks, and the chip follows. A job that moves parts powers the machine off first (`job`), so nothing runs under a step.
   */
  protected simulate(dt: number): void {
    const g = this._game;
    // (a benchmark run takes the page's time for its own copy of the machine: this one waits, as it does under a step)
    if (!g || !g.powered || this.status.peek().busy || this.benching.peek()) {
      this.owed = 0;
      return;
    }
    this.owed += Math.min(dt, 0.1) * this.simSpeed.peek();
    const n = Math.min(Math.floor(this.owed), MAX_TICKS_PER_FRAME);
    this.owed -= Math.floor(this.owed);
    if (n <= 0) {
      return;
    }
    this.ran += n;
    try {
      for (let i = 0; i < n; i++) {
        g.advanceBaseTick();
      }
    } catch (error) {
      // (a fault in the sim: the machine is switched off and the stage goes on, and the hint line says what failed and where, as the crash report's
      // headline does for the game's own sim: `crashReport`)
      const { headline } = crashReport(g, error);
      try {
        g.powerButton();
      } catch {
        /* already down */
      }
      this.refuse(`The machine stopped: ${headline}`);
    }
    this.snaps.drop();
    this.ticks.value++;
    this.syncRun();
    this.demand.ask();
  }
}
