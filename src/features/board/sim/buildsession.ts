// The Build session (docs/PC_PARTS.md "Build my PC"): Build my PC's game and its rules, with no picture. A command runs the whole job on the game at once
// (each part in the way taken out, the part taken out, the others put back) and returns a script (`buildscript.ts`): one step per thing that happens, each
// with the game as the step leaves it. The stage (render/three/buildmode3d.ts) plays the script; it makes no change to the game while it plays.
// The order of a removal is the removal graph's (`removal.ts`). The starts are `buildpreset.ts`'s.
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { presetGame, startGame } from './buildpreset';
import { FitJob } from './buildfit';
import { RemovalJob, assemble, stateOf } from './buildscript';
import { netName, netState, setNet } from './buildnet';
import { boardSlots, freeSlots, slotAccepts, slotFits, uninstall, upgradeBoard, upgradeCase } from './board';
import type { BuildPreset, Shown } from './buildspecs';
import {
  BOARD,
  CASE,
  SIDE,
  accessBlockers,
  buildGraph,
  devNode,
  isDevNode,
  removalPlan,
  removalPlanAll,
} from './removal';
import { getSpec } from './specs';

export { isOutStep } from './buildscript';

/** A net kind and a board, as the game names them. */
type NetKind = keyof ReturnType<typeof netState>;
type Board = Game['board'];

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

  /**
   * Put the OS, router or plan `id` in its place, or take the one of `kind` out (`id` null). The same item again is refused. `step` is what the stage
   * records for Undo when the change was done (`from` is the item that was there: Undo sets it), and a refused change has no step: `reason` is the words for the
   * hint line (none when there was nothing to take out).
   */
  setNet(kind: NetKind, id: string | null): NetOutcome {
    const from = netState(this.game)[kind],
      step = { kind, from, to: id };
    if (id !== null && from === id) {
      return { ok: false, reason: `${netName(id)} is already in place` };
    }
    if (id === null && from === null) {
      return { ok: false };
    }
    const r = setNet(this.game, kind, id);
    if (r.ok) {
      return { ok: true, step };
    }
    const reason =
      id === null ? `Cannot take ${netName(from ?? '')} out: ${r.reason}` : `Cannot fit ${netName(id)}: ${r.reason}`;
    return { ok: false, reason };
  }

  /** Undo a `setNet`: set the item that was there. */
  undoNet(step: NetStep): NetOutcome {
    return this.setNet(step.kind, step.from);
  }

  /** Why a new case or board (`case2`, `board1`) is refused, or null. `shown` is what stands on the stage, `held` a case or board the game holds aside. */
  shellRefusal(itemId: string, shown: Shown, held: boolean): string | null {
    const b = this.game.board,
      isCase = itemId.startsWith('case'),
      tier = Number(itemId.slice(-1)),
      bare = shown !== 'machine';
    if (shown === 'nothing' && !isCase) {
      return 'Fit a case first: every part goes in it';
    }
    if (!held && (isCase ? tier === b.caseTier : tier === b.tier && b.burnt !== true && !bare)) {
      return 'That one is already fitted';
    }
    const why = held ? null : shellRefusal(b, itemId);
    return why === null ? null : `Cannot fit it: ${why}`;
  }

  /**
   * Fit the case or board `itemId` on the machine as it stands (`held`: the game already holds it, nothing to change): one step. The parts in its way are
   * the stage's (it takes them out and puts them back step by step, before and after); every other part stays in place and moves with it (`Game.install`:
   * the same ids, the drives' data and the OS kept). A refused fit has no step: `refusal` is the words for the hint line.
   */
  fitShell(itemId: string, held = false): Outcome {
    const g = this.game,
      before = stateOf(g),
      why = this.shellRefusal(itemId, 'machine', held);
    if (why !== null) {
      return { script: [], before, refusals: [], refusal: why };
    }
    if (!held) {
      const bought = g.purchase(itemId),
        fitted = bought.ok ? g.install(bought.invId) : bought;
      if (!fitted.ok) {
        return { script: [], before, refusals: [], refusal: `Cannot fit it: ${fitted.reason}` };
      }
    }
    const node = itemId.startsWith('case') ? CASE : BOARD,
      step: Outcome['script'][number] = {
        kind: 'shell-in',
        node,
        target: true,
        ids: new Map(),
        refusals: [],
        ...stateOf(g),
      };
    return { script: [step], before, refusals: [], refusal: null };
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

/** The game's answer to a cable the player moved: done, or why not. */
export interface CableOutcome {
  ok: boolean;
  reason?: string;
}

/** An OS, router or plan change as the stage records it for Undo: the item that was there (`from`) and the one that came (`to`). */
export interface NetStep {
  kind: NetKind;
  from: string | null;
  to: string | null;
}

/** What `setNet` did: a done change has the step to record; a refused one has no step and, when there is one, the reason. */
export type NetOutcome =
  { ok: true; step: NetStep; reason?: undefined } | { ok: false; step?: undefined; reason?: string };

/**
 * Why the game would refuse a new case or board (`itemId`: "case2", "board1"), asked of a copy of the machine with its parts out (a swap takes them out
 * first, so what they need does not count); null when it takes it.
 */
export function shellRefusal(board: Board, itemId: string): string | null {
  const copy: Board = { ...board, devices: [] },
    tier = Number(itemId.slice(-1));
  const r = itemId.startsWith('case') ? upgradeCase(copy, tier) : upgradeBoard(copy, tier);
  return r.ok ? null : r.reason;
}
