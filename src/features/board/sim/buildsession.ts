// The Build session (docs/PC_PARTS.md "Build my PC"): Build my PC's game and its rules, with no picture. A command runs the whole job on the game at once
// (each part in the way taken out, the part taken out, the others put back) and returns a script (`buildscript.ts`): one step per thing that happens, each
// with the game as the step leaves it. The stage (render/three/buildmode3d.ts) plays the script; it makes no change to the game while it plays.
// The order of a removal is the removal graph's (`removal.ts`). The starts are `buildpreset.ts`'s.
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { presetGame, startGame } from './buildpreset';
import { RemovalJob, stateOf } from './buildscript';
import type { BuildPreset } from './buildspecs';
import { buildGraph, devNode, isDevNode } from './removal';

export { assemble, isOutStep, railFans } from './buildscript';

/** The script, the refusals and why the job was not done (nothing moved, the game is unchanged), or null (`buildscript.ts`). */
type Outcome = ReturnType<RemovalJob['run']>;

export class BuildSession {
  constructor(readonly game: Game) {}

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

  /** Why a removal of `node` cannot start, or null. */
  private refusal(node: string): string | null {
    const g = this.game;
    if (isDevNode(node) && !g.board.devices.some((d) => devNode(d.id) === node)) {
      return `Cannot take it out: no installed device "${node.slice(4)}"`;
    }
    if (!buildGraph(g.board, g.cables).has(node)) {
      return `Cannot take it out: ${node} is not in the machine`;
    }
    if (g.powered) {
      return 'Cannot take it out: power the machine off first';
    }
    // (the game refuses the drive that holds the OS outside Build my PC: refused here, before a part in its way moves)
    const os = g.os?.deviceId;
    if (os !== undefined && node === devNode(os) && !g.looseFit) {
      return 'Cannot take it out: the OS is installed on this drive: uninstall the OS first';
    }
    return null;
  }

  /**
   * Take `node` (a removal graph node: `dev:<id>`, `cable:<id>`) out with everything in its way, then put the others back in reverse order. A refused job
   * moves nothing and has no step.
   */
  remove(node: string): Outcome {
    const refusal = this.refusal(node);
    if (refusal !== null) {
      return { script: [], before: stateOf(this.game), refusals: [], refusal };
    }
    return new RemovalJob(this.game).run(node);
  }
}
