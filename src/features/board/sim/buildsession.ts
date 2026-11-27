// The Build session (docs/PC_PARTS.md "Build my PC"): Build my PC's game and its rules, with no picture. A command runs the whole job on the game at once
// (each part in the way taken out, the part taken out, the others put back) and returns a script (`buildscript.ts`): one step per thing that happens, each
// with the game as the step leaves it. The stage (render/three/buildmode3d.ts) plays the script; it makes no change to the game while it plays.
// The order of a removal is the removal graph's (`removal.ts`). The two moves on a part are `buildmoves.ts`'s, the starts `buildpreset.ts`'s, the case and
// board rules `buildshell.ts`'s.
// The session also owns the history (`buildhistory.ts`): Undo and Redo are commands that return a script, and a swap (a preset, a saved build, reset,
// clear) is one step that puts another game in the place of the session's and returns a swap step.
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { BuildHistory, replayPart } from './buildhistory';
import { putIn, takeOut } from './buildmoves';
import { changeNet } from './buildnet';
import { bareGame, fullGame, layoutGame, presetGame, startGame } from './buildpreset';
import { stateOf } from './buildscript';
import { fitShellOn, stageShellRefusal } from './buildshell';
import type { BuildLayout, BuildPreset, Shown } from './buildspecs';
import { devNode } from './removal';

export { isOutStep } from './buildscript';
export { shellRefusal } from './buildshell';

type Way = Parameters<BuildHistory['next']>[0];
type HistoryStep = NonNullable<ReturnType<BuildHistory['next']>>;
/** A net kind as the game names it, what `setNet` did, and the change it made (`buildnet.ts`). */
type NetKind = Parameters<typeof changeNet>[1];
type NetOutcome = ReturnType<typeof changeNet>;
type NetStep = NonNullable<NetOutcome['step']>;
/** The script, the refusals and why the job was not done (nothing moved, the game is unchanged), or null (`buildscript.ts`). */
type Outcome = ReturnType<typeof takeOut>;
type ScriptStep = Outcome['script'][number];
type PartStep = Extract<HistoryStep, { t: 'fit' | 'remove' }>;

/** What Undo or Redo did. `jobs`: one for each part it fitted or took out, to play one after the other (`script`: their steps in a row, or the swap step). */
interface Replay extends Outcome {
  jobs: Outcome[];
}

/** What a job could not put back, as its steps say it. */
const alongOf = (job: Outcome): NonNullable<ScriptStep['along']> => job.script.flatMap((s) => s.along ?? []);

export class BuildSession {
  private current: Game;
  private readonly history = new BuildHistory();
  /** What stands on the stage for the game: the machine, a bare case or nothing. A command that is told nothing else keeps it with the game it leaves. */
  private standing: Shown = 'machine';

  constructor(game: Game) {
    this.current = game;
  }

  /** The game of the session: a swap, and the Undo or Redo of one, puts another here. */
  get game(): Game {
    return this.current;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  /** How many times the machine was swapped for another (a swap, and the Undo or Redo of one): a UI tells a swap it just made from a later one by it. */
  get swaps(): number {
    return this.history.swaps;
  }
  /** Is the last step of the history a swap? Then Undo brings back the machine that was on the stage before. */
  get lastWasSwap(): boolean {
    return this.history.lastWasSwap;
  }
  /** The kind of the step Undo (or Redo) takes next: a part plays as a job, a swap and an OS, router or plan change happen at once. */
  next(way: Way): HistoryStep['t'] | undefined {
    return this.history.next(way)?.t;
  }

  /** A session on a ready-made machine (`presetGame`), or on a start of the Start list by its key (`startGame`: "empty", "full", a machine's key). */
  static async fromPreset(p: BuildPreset | string): Promise<BuildSession> {
    if (typeof p !== 'string') {
      return new BuildSession(await presetGame(p));
    }
    const { game } = await startGame(p);
    return new BuildSession(game);
  }

  /** The game as it stands. */
  snapshot(): Snapshot {
    return this.game.snapshot();
  }

  /**
   * Take `node` (a removal graph node: `dev:<id>`, `cable:<id>`) out with everything in its way, then put the others back in reverse order. A refused job
   * moves nothing and has no script. A part taken out is a step of the history; a cable is not.
   */
  remove(node: string): Outcome {
    const job = takeOut(this.game, node),
      gone = job.before.board.devices.find((d) => devNode(d.id) === node);
    if (job.refusal === null && gone !== undefined) {
      const along = alongOf(job),
        step: PartStep = { t: 'remove', spec: gone.spec, slot: gone.slot };
      if (along.length > 0) {
        step.along = along;
      }
      this.history.record(step);
    }
    return job;
  }

  /**
   * Fit a catalogue part (`item`) into a socket: `drop` (when it takes the part), else the first free socket that takes it, else the socket of the part it
   * replaces. The parts in the way come out, the part in the slot comes out, the part is bought and installed, the others go back, the hoses go on last when
   * the part made the loop, and the cables it brought run out. `shown`: what the stage shows (a bare case has no board to plug into). A refused fit moves
   * nothing and has no script. A part that went in is a step of the history, after the removal of the part it replaced. Cases, boards and the OS, router
   * and plan are not sockets: `fitShell` fits cases and boards (the stage calls `bareStep` or `forget` first), and `setNet` the others.
   */
  fit(item: string, drop?: string, shown: Shown = 'machine'): Outcome {
    const job = putIn(this.game, { item, drop }, shown),
      put = job.script.find((s) => s.kind === 'part-in'),
      { slot, spec } = put ?? {};
    if (slot === undefined || spec === undefined) {
      return job;
    }
    const occupant = job.before.board.devices.find((d) => d.slot === slot),
      along = alongOf(job),
      steps: PartStep[] = [{ t: 'fit', spec, slot }];
    if (occupant !== undefined) {
      steps.unshift({ t: 'remove', spec: occupant.spec, slot });
    }
    // (what could not go back is on the first step: Undo brings it back last)
    const [first] = steps;
    if (first !== undefined && along.length > 0) {
      first.along = along;
    }
    for (const s of steps) {
      this.history.record(s);
    }
    return job;
  }

  /**
   * Put the OS, router or plan `id` in its place, or take the one of `kind` out (`id` null): a step of the history when the game takes it. The same item
   * again is refused. `step` is the change (`from` is the item that was there), and a refused change has no step: `reason` is the words for the hint line
   * (none when there was nothing to take out).
   */
  setNet(kind: NetKind, id: string | null): NetOutcome {
    const r = changeNet(this.game, kind, id);
    if (r.ok) {
      this.history.record({ t: 'net', ...r.step });
    }
    return r;
  }

  /** Reverse a `setNet`: set the item that was there. It records no step. */
  undoNet(step: NetStep): NetOutcome {
    return changeNet(this.game, step.kind, step.from);
  }

  /** Why a new case or board (`case2`, `board1`) is refused, or null. `shown` is what stands on the stage, `held` a case or board the game holds aside. */
  shellRefusal(itemId: string, shown: Shown, held: boolean): string | null {
    return stageShellRefusal(this.game, itemId, { shown, held });
  }

  /**
   * Fit the case or board `itemId` on the machine as it stands (`held`: the game already holds it, nothing to change): one step. The parts in its way are
   * the stage's (it takes them out and puts them back step by step, before and after); every other part stays in place and moves with it (`Game.install`:
   * the same ids, the drives' data and the OS kept). A refused fit has no step: `refusal` is the words for the hint line.
   */
  fitShell(itemId: string, held = false): Outcome {
    return fitShellOn(this.game, itemId, held);
  }

  /** One change from the OS sheet's disk page: the game's own method. The refusal text (`what: reason`), or null when it was done. */
  osDo(what: string, change: (g: Game) => { ok: boolean; reason?: string }): string | null {
    const r = change(this.game);
    return r.ok ? null : `${what}: ${r.reason}`;
  }

  /** The player plugs a cable in (outside a job): the game's answer. */
  connectCable(id: string, port?: string): CableOutcome {
    return this.game.connectCable(id, port);
  }

  /** The player pulls a cable out (outside a job): the game's answer. */
  disconnectCable(id: string): CableOutcome {
    return this.game.disconnectCable(id);
  }

  /**
   * Undo the last step of the history. `shown`: what stands on the stage for the game now. A part step is reversed, and then what the step took out for
   * good goes back. The script is empty when there is nothing to undo.
   */
  undo(shown: Shown = this.standing): Replay {
    return this.replay('undo', shown);
  }

  /** Do the step Undo took last, again. */
  redo(shown: Shown = this.standing): Replay {
    return this.replay('redo', shown);
  }

  private replay(way: Way, shown: Shown): Replay {
    const before = stateOf(this.game),
      step = this.history.take(way),
      done = (script: ScriptStep[], jobs: Outcome[], refusal: string | null = null): Replay => ({
        script,
        before,
        refusals: jobs.flatMap((j) => j.refusals),
        refusal,
        jobs,
      });
    if (step === undefined) {
      return done([], []);
    }
    if (step.t === 'swap') {
      this.history.give(way, { t: 'swap', game: this.game, shown });
      const line = way === 'undo' ? 'Went back to the machine before' : 'Went forward again';
      return done([this.swapTo(step.game, step.shown, line)], []);
    }
    this.history.give(way, step);
    if (step.t === 'net') {
      const r = way === 'undo' ? this.undoNet(step) : changeNet(this.game, step.kind, step.to);
      return done([], [], r.ok ? null : (r.reason ?? null));
    }
    const jobs = replayPart(this.game, step, { undo: way === 'undo', shown });
    return done(
      jobs.flatMap((j) => j.script),
      jobs,
      jobs.find((j) => j.refusal !== null)?.refusal ?? null,
    );
  }

  /** `g` takes the place of the session's game: the step that says so. */
  private swapTo(g: Game, shown: Shown, line: string): ScriptStep {
    this.current = g;
    this.standing = shown;
    return { kind: 'swap', node: 'swap', target: true, ids: new Map(), refusals: [], shown, line, ...stateOf(g) };
  }

  /** A swap: one step of the history, which keeps the game that leaves with what stood on the stage for it (`left`). */
  private swap(coming: { game: Game; line: string; shown?: Shown }, left: Shown = this.standing): Outcome {
    const before = stateOf(this.game);
    this.history.record({ t: 'swap', game: this.game, shown: left });
    const step = this.swapTo(coming.game, coming.shown ?? 'machine', coming.line);
    return { script: [step], before, refusals: [], refusal: null };
  }

  /** A ready-made machine in the place of this one. `left`, here and below: what stands on the stage for the game that leaves. */
  async buildPreset(p: BuildPreset, left?: Shown): Promise<Outcome> {
    const game = await presetGame(p);
    return this.swap({ game, line: `Built the ${p.name} machine` }, left);
  }

  /** A saved layout in the place of this machine. Parts that no longer fit are skipped. */
  async loadLayout(l: BuildLayout, name: string, left?: Shown): Promise<Outcome> {
    const game = await layoutGame(l);
    return this.swap({ game, line: `Loaded ${name}` }, left);
  }

  /** The biggest rig, as at the start. */
  async reset(left?: Shown): Promise<Outcome> {
    const game = await fullGame();
    return this.swap({ game, line: 'Fitted every part' }, left);
  }

  /** Nothing on the stage, not even a case. */
  async clear(left?: Shown): Promise<Outcome> {
    const game = await bareGame();
    return this.swap({ game, line: 'Cleared the stage', shown: 'nothing' }, left);
  }

  /**
   * Before the stage fits a case or a board on a bare case or an empty stage (`left`): a swap step keeps what stands there, as a copy, since the game is
   * about to change.
   */
  async bareStep(left: Shown): Promise<void> {
    const copy = await bareGame(this.game.board.caseTier);
    this.history.record({ t: 'swap', game: copy, shown: left });
  }

  /** Start the history over (a new case or board on a built machine is not a step to undo). */
  forget(): void {
    this.history.forget();
  }
}

/** The game's answer to a cable the player moved: done, or why not. */
export interface CableOutcome {
  ok: boolean;
  reason?: string;
}
