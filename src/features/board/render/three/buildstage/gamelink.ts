// The stage's sandbox game and its machine: the snapshot drawn, the board, the cables, an edit made on the game.
import { signal } from '@preact/signals';
import type { Cables } from '@/features/board/sim/cables';
import type { Machine3D } from '../machine3d';
import { OFF, runState, sameRun } from '@/features/board/sim/buildrun';
import { studioMachine } from '@/app/audio/studio';
import { SnapCache } from './parts';
import type { Board, Game, RunState, Snapshot } from './types';
import { StageScores } from './scores';

export abstract class StageGame extends StageScores {
  // ------------------------------------------------------------------ the running machine
  /** What the machine is doing (`runState`): off, or on in this phase. It changes with the phase, not with every tick. */
  readonly state = signal<RunState>(OFF);
  /** Ticks owed: time that passed at the machine's speed and has not been run yet. */
  protected owed = 0;
  /** Counts up with every change to the game: what memoizes on the machine as it stands (`alerts`) keys on it, as a running game gives a new snapshot every tick. */
  protected editRev = 0;

  protected readonly snaps = new SnapCache();
  /** The sandbox game. Change it only through `edit` (or put a new game here): the stage keeps its snapshot until then. */
  override get game(): Game {
    return this.alive(this._game);
  }
  override set game(g: Game) {
    this._game = g;
    this.owed = 0;
    this.editRev++;
    this.snaps.drop();
    this.syncRun();
    this.benchChanged();
  }
  protected get machine(): Machine3D {
    return this.alive(this._machine);
  }
  /**
   * A closed stage lets go of its machine and its game (PERF12): the UI's last render can keep a closure that holds the stage until the next
   * open. A job that wakes after the close (a timer) stops here, and `job` drops the error.
   */
  protected alive<T extends object>(x: T | null): T {
    if (this.dead || x === null) {
      throw new Error('Build my PC is closed');
    }
    return x;
  }
  /** The machine as it stands: one snapshot per change of the game, not one per frame. */
  get snapshot(): Snapshot {
    return this.snaps.of(this.game);
  }
  get board(): Board {
    return this.game.board;
  }
  get cables(): Cables {
    return this.game.cables;
  }
  /** Every change to the stage's game goes through here (install, uninstall, purchase, a cable): it drops the kept snapshot. */
  protected edit<T>(change: (g: Game) => T): T {
    try {
      return change(this.game);
    } finally {
      this.snaps.drop();
      this.editRev++;
      this.benchChanged();
      this.demand.ask();
      // (a cord pulled from a running machine, or a change that stops it: the chip follows at once, not at the next tick)
      if (this._game && this._game.powered !== this.state.peek().on) {
        this.syncRun();
      }
    }
  }

  /** The OS follows its drive (`Game.keepOs`): when a job ends, the OS that left with a drive that came out is put on the drive that went back in, or the first one that holds it. */
  protected keepOs(): void {
    const was = this.game.os;
    this.game.keepOs();
    if (this.game.os !== was) {
      this.snaps.drop();
      this.editRev++;
      this.benchChanged();
    }
  }

  /** What the chip says: the game's power and phase, set when they change (a tick, a power button, a cord pulled). */
  protected syncRun(): void {
    if (!this._game) {
      return;
    }
    const s = this.snapshot,
      next = runState(s.powered, s.phase, s.phaseReason);
    if (!sameRun(this.state.peek(), next)) {
      this.state.value = next;
    }
    // (the hum follows this machine: its power and fans, each tick)
    studioMachine.value = { powered: s.powered, devices: s.devices ?? [] };
  }
}
