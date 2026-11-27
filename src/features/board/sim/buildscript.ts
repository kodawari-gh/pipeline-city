// The script of a Build session's job (`buildsession.ts`): the job runs whole on the game, and each thing that happens is kept as a step with the game just
// after it. The stage (render/three/buildmode3d.ts, `playScript`) plays the steps. The order of a removal is the removal graph's (`removal.ts`).
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import type { Board, Cables, InstalledDevice } from '@/features/board/sim';
import { deviceSpec, fittedRadiator, mountFan } from './board';
import { cableBlocked, cableNeeded, cablesOf } from './cables';
import { HOSES, SIDE, buildGraph, devNode, hasLoop, isCableNode, removalPlan } from './removal';
import { getSpec } from './specs';

/** What a step does: the side panel opens, a part, a cable or the loop's hoses come out, a part goes in or back, a cable goes in or runs out, the hoses go on, a case or board is fitted. */
type StepKind =
  | 'door-open'
  | 'part-out'
  | 'cable-out'
  | 'hoses-out'
  | 'part-in'
  | 'put-back'
  | 'cable-in'
  | 'cable-run'
  | 'hoses-on'
  | 'shell-in';

/** The game at one moment of a job: its snapshot, and copies of its board and cables. */
export interface SessionState {
  snapshot: Snapshot;
  board: Board;
  cables: Cables;
}

/** A part the job took out and could not put back: it stays out (Undo brings it back after the part). */
interface Along {
  spec: string;
  slot: string;
}

export interface ScriptStep extends SessionState {
  kind: StepKind;
  /** The removal graph's node the step moves (`removal.ts`), as the game named it before the step. A part that went back: its old id. */
  node: string;
  /** Is it the part the job is for? */
  target: boolean;
  /** A part's spec and slot. */
  spec?: string;
  slot?: string;
  /** The parts that move with it as one piece (the fans on a radiator), as nodes before the step. */
  with?: string[];
  /** The parts whose id changed in this step (a part put back into the same slot): old id to new id. */
  ids: ReadonlyMap<string, string>;
  /** What the game refused at this step (a part that cannot go back): the words for the hint line. */
  refusals: string[];
  /** The step the job is recorded on (the target's): the parts that could not go back, in the order they would go back. */
  along?: Along[];
}

/** A job's result: the steps, the game before them, the refusals after the last step, and the game's refusal of the job (nothing moved), or null. */
export interface Outcome {
  script: ScriptStep[];
  before: SessionState;
  refusals: string[];
  refusal: string | null;
}

/** A part that came out, to put back (`along`: the fans of a radiator, which came out with it as one piece). */
interface Gone {
  id: string;
  spec: string;
  slot: string;
  invId: string;
}
type Undo = { t: 'cable'; id: string } | { t: 'hoses' } | ({ t: 'dev'; along: Gone[] } & Gone);
/** A step as the job names it: the state, the refusals and the defaults are added when it is kept (`RemovalJob.push`). */
type StepIn = Pick<ScriptStep, 'kind' | 'node'> &
  Partial<Pick<ScriptStep, 'target' | 'spec' | 'slot' | 'with' | 'ids'>>;

const OUT_KINDS: ReadonlySet<StepKind> = new Set(['door-open', 'part-out', 'cable-out', 'hoses-out']);
/** Does the step take something out (the side panel, a part, a cable, the hoses)? */
export const isOutStep = (s: ScriptStep): boolean => OUT_KINDS.has(s.kind);

/** The fans on a radiator's mounts. */
function railFans(board: Board): InstalledDevice[] {
  const rad = fittedRadiator(board);
  if (rad === null) {
    return [];
  }
  return rad.mounts.map((m) => mountFan(board, m)).filter((f): f is InstalledDevice => f !== undefined);
}

/** Steps with the fans of a radiator dropped when the radiator is in them: it takes them along. */
export function assemble(board: Board, steps: string[]): string[] {
  const rad = fittedRadiator(board);
  if (rad === null || !steps.includes(devNode(rad.dev.id))) {
    return steps;
  }
  const fans = new Set(railFans(board).map((f) => devNode(f.id)));
  return steps.filter((n) => !fans.has(n));
}

export const nameOf = (spec: string): string => getSpec(spec)?.name ?? spec;

/** The game at this moment, kept for a step. */
export function stateOf(g: Game): SessionState {
  return { snapshot: g.snapshot(), board: structuredClone(g.board), cables: { ...g.cables } };
}

/**
 * One removal, run whole on the game: each part in the way taken out, the target taken out, the others put back in reverse order. Each step is kept with
 * the game just after it, and with the refusals raised since the step before.
 */
export class RemovalJob {
  protected readonly steps: ScriptStep[] = [];
  protected readonly along: Along[] = [];
  protected readonly undo: Undo[] = [];
  protected pending: string[] = [];
  protected refusal: string | null = null;
  protected target = '';

  constructor(protected readonly game: Game) {}

  /** Take `node` out; the script, and the game's refusal of the target itself (null when it came out). */
  run(node: string): Outcome {
    const g = this.game,
      before = stateOf(g);
    this.target = node;
    for (const n of assemble(g.board, removalPlan(buildGraph(g.board, g.cables), node))) {
      this.takeOut(n);
    }
    for (const u of this.undo.toReversed()) {
      this.putBack(u);
    }
    // (what could not go back is listed on the step the job is recorded on: the target's, or the last one)
    const rec = this.steps.find((s) => s.target) ?? this.steps.at(-1);
    if (rec !== undefined && this.along.length > 0) {
      rec.along = this.along;
    }
    return { script: this.steps, before, refusals: this.pending, refusal: this.refusal };
  }

  protected push(step: StepIn): void {
    this.steps.push({ target: false, ids: new Map(), ...step, refusals: this.pending, ...stateOf(this.game) });
    this.pending = [];
  }

  /** Take one node out; what is to go back goes on `undo` (not the target). */
  protected takeOut(n: string): void {
    const g = this.game,
      target = n === this.target;
    if (n === SIDE || n === HOSES) {
      this.push({ kind: n === SIDE ? 'door-open' : 'hoses-out', node: n, target });
      if (n === HOSES && !target) {
        this.undo.push({ t: 'hoses' });
      }
      return;
    }
    if (isCableNode(n)) {
      const id = n.slice(6),
        r = g.disconnectCable(id);
      if (!r.ok) {
        this.pending.push(`Cannot pull it out: ${r.reason}`);
      }
      this.push({ kind: 'cable-out', node: n, target });
      if (!target) {
        this.undo.push({ t: 'cable', id });
      }
      return;
    }
    const d = g.board.devices.find((x) => devNode(x.id) === n);
    if (d !== undefined) {
      this.takeOutPart(d, target);
    }
  }

  /** A part comes out (a radiator with the fans on it, as one piece). */
  protected takeOutPart(d: InstalledDevice, target: boolean): void {
    const g = this.game,
      fans = deviceSpec(d).kind === 'radiator' ? railFans(g.board) : [],
      along: Gone[] = [];
    for (const f of fans) {
      const r = g.uninstall(f.id);
      if (r.ok && r.invId !== null) {
        along.push({ id: f.id, spec: f.spec, slot: f.slot, invId: r.invId });
      }
    }
    const r = g.uninstall(d.id);
    if (!r.ok) {
      if (target) {
        this.refusal = `Cannot take it out: ${r.reason}`;
      } else {
        this.pending.push(`Cannot take it out: ${r.reason}`);
      }
      return;
    }
    this.push({
      kind: 'part-out',
      node: devNode(d.id),
      target,
      spec: d.spec,
      slot: d.slot,
      ...(along.length > 0 ? { with: along.map((x) => devNode(x.id)) } : {}),
    });
    // (a burnt part is scrapped: there is nothing to put back)
    if (!target && r.invId !== null) {
      this.undo.push({ t: 'dev', id: d.id, spec: d.spec, slot: d.slot, invId: r.invId, along });
    }
  }

  protected putBack(u: Undo): void {
    if (u.t === 'hoses') {
      if (hasLoop(this.game.board)) {
        this.push({ kind: 'hoses-on', node: HOSES });
      }
      return;
    }
    if (u.t === 'cable') {
      this.plugBack(u.id);
      return;
    }
    this.putBackPart(u);
  }

  /** A cable goes back in, when the machine still needs it and nothing keeps it out. */
  protected plugBack(id: string): void {
    const g = this.game,
      c = cablesOf(g.board).find((x) => x.id === id);
    if (
      c === undefined ||
      g.cables[id] === true ||
      !cableNeeded(g.board, c.id) ||
      cableBlocked(g.board, c.id) !== null
    ) {
      return;
    }
    // (the PC's cord goes into the supply's inlet: with the supply out it stays unplugged)
    if (id === 'pcmains' && !g.board.devices.some((d) => deviceSpec(d).kind === 'psu')) {
      return;
    }
    const r = g.connectCable(id);
    if (r.ok) {
      this.push({ kind: 'cable-in', node: `cable:${id}` });
    } else {
      this.pending.push(`Cannot plug it in: ${r.reason}`);
    }
  }

  /** A part goes back into its slot (a radiator with its fans); one that cannot stays out. */
  protected putBackPart(u: Gone & { along: Gone[] }): void {
    const ids = new Map<string, string>();
    for (const x of [u, ...u.along]) {
      const r = this.game.install(x.invId, x.slot);
      if (r.ok && r.deviceId !== null) {
        ids.set(x.id, r.deviceId);
        continue;
      }
      // (a fan the new heatsink or case has no spot for stays out, as the game sends it to the inventory)
      this.along.push({ spec: x.spec, slot: x.slot });
      this.pending.push(
        getSpec(x.spec)?.kind === 'fan' && u.along.length === 0
          ? `${nameOf(x.spec)} no longer fits: it stays out`
          : `Cannot put ${nameOf(x.spec)} back: ${r.ok ? 'no device' : r.reason}`,
      );
    }
    if (ids.size === 0) {
      return;
    }
    this.push({
      kind: 'put-back',
      node: devNode(u.id),
      spec: u.spec,
      slot: u.slot,
      ids,
      ...(u.along.length > 0 ? { with: u.along.map((x) => devNode(x.id)) } : {}),
    });
  }
}
