// The Build session (docs/PC_PARTS.md "Build my PC"): Build my PC's game and its rules, with no picture. A command runs the whole job on the game at once
// (each part in the way taken out, the part taken out, the others put back) and returns a script (`buildscript.ts`): one step per thing that happens, each
// with the game as the step leaves it. The stage (render/three/buildmode3d.ts) plays the script; it makes no change to the game while it plays.
// The order of a removal is the removal graph's (`removal.ts`). The starts are `buildpreset.ts`'s.
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { presetGame, startGame } from './buildpreset';
import { FitJob } from './buildfit';
import { RemovalJob, assemble, stateOf } from './buildscript';
import { boardSlots, freeSlots, slotAccepts, slotFits, uninstall } from './board';
import type { BuildPreset, Shown } from './buildspecs';
import { SIDE, accessBlockers, buildGraph, devNode, isDevNode, removalPlan, removalPlanAll } from './removal';
import { getSpec } from './specs';

export { isOutStep } from './buildscript';

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

  /** Why the fit of `item` into `slot` is refused, asked of the game before anything moves (its board and money are not touched), or null. */
  private fitRefusal(item: string, slot: string): string | null {
    const g = this.game,
      name = getSpec(item)?.name ?? item;
    if (g.powered) {
      return `${name} does not fit: power the machine off first`;
    }
    const offer = g.snapshot().purchases.find((p) => p.id === item);
    if (offer === undefined) {
      return `Cannot get ${name}: "${item}" is not for sale`;
    }
    if (offer.locked !== undefined) {
      return `Cannot get ${name}: unlocks at level ${offer.locked.level} (${offer.locked.name})`;
    }
    if (offer.blocked !== undefined && offer.blocked !== '') {
      return `Cannot get ${name}: ${offer.blocked}`;
    }
    if (!offer.affordable) {
      return `Cannot get ${name}: needs $${offer.price}, have $${g.money}`;
    }
    // (the part in the slot comes out before the install: a part of another kind there does not refuse the fit)
    const board = structuredClone(g.board),
      occupant = board.devices.find((d) => d.slot === slot);
    if (occupant !== undefined) {
      uninstall(board, occupant.id);
    }
    const r = g.placeInto(board, item, slot);
    return r.ok ? null : `${name} does not fit: ${r.reason}`;
  }

  /**
   * Fit a catalogue part (`item`) into a socket: `drop` (when it takes the part), else the first free socket that takes it, else the socket of the part it
   * replaces. The parts in the way come out, the part in the slot comes out, the part is bought and installed, the others go back, the hoses go on last when
   * the part made the loop, and the cables it brought run out. `shown`: what the stage shows (a bare case has no board to plug into). A refused fit moves
   * nothing and has no step. Cases, boards and the OS, router and plan are not sockets: the stage fits them.
   */
  fit(item: string, drop?: string, shown: Shown = 'machine'): Outcome {
    const g = this.game,
      refuse = (refusal: string): Outcome => ({ script: [], before: stateOf(g), refusals: [], refusal });
    if (shown === 'nothing') {
      return refuse('Fit a case first: every part goes in it');
    }
    if (shown === 'case') {
      return refuse('Fit a motherboard first: every other part plugs into it');
    }
    const spec = getSpec(item);
    if (spec === undefined) {
      return refuse(`Unknown part ${item}`);
    }
    const slots = boardSlots(g.board),
      fits = (s: ReturnType<typeof boardSlots>[number]): boolean => slotAccepts(s.type, spec.slot) && slotFits(s, spec),
      [free] = freeSlots(g.board, spec.slot, spec),
      taken = slots.find((s) => fits(s) && g.board.devices.some((d) => d.slot === s.id)),
      aimed = drop !== undefined && slots.some((s) => s.id === drop && fits(s)) ? drop : undefined,
      slot = aimed ?? free?.id ?? taken?.id;
    if (slot === undefined) {
      return refuse(
        spec.kind === 'fan'
          ? `Nothing in this machine takes a ${spec.size} mm fan`
          : `${spec.name} fits no socket on this board`,
      );
    }
    const why = this.fitRefusal(item, slot);
    if (why !== null) {
      return refuse(why);
    }
    const occupant = g.board.devices.find((d) => d.slot === slot) ?? null,
      graph = buildGraph(g.board, g.cables),
      plan = occupant
        ? removalPlan(graph, devNode(occupant.id))
        : removalPlanAll(
            graph,
            accessBlockers(g.board, slot, spec.kind, item).filter((n) => graph.has(n)),
          ),
      steps = assemble(g.board, plan);
    if (steps.length === 0) {
      steps.push(SIDE);
    }
    if (steps[0] !== SIDE) {
      steps.unshift(SIDE);
    }
    return new FitJob(g).fit({ item, slot, steps, occupant });
  }
}
