// The two moves of the Build session on a part: take it out, or fit one. Each asks the game why it refuses before anything moves, then runs the whole job
// (`buildscript.ts`, `buildfit.ts`). No history here: that is the session's (`buildsession.ts`).
import type { Game } from '@/worker/game/game';
import { boardSlots, freeSlots, slotAccepts, slotFits, uninstall } from './board';
import { FitJob } from './buildfit';
import { RemovalJob, assemble, stateOf } from './buildscript';
import type { Shown } from './buildspecs';
import { SIDE, accessBlockers, buildGraph, devNode, isDevNode, removalPlan, removalPlanAll } from './removal';
import { getSpec } from './specs';

type Outcome = ReturnType<RemovalJob['run']>;

/** Why a removal of `node` cannot start, or null. */
function removalRefusal(g: Game, node: string): string | null {
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

/** Take `node` out with everything in its way. A refused job moves nothing and has no script. */
export function takeOut(g: Game, node: string): Outcome {
  const refusal = removalRefusal(g, node);
  if (refusal !== null) {
    return { script: [], before: stateOf(g), refusals: [], refusal };
  }
  return new RemovalJob(g).run(node);
}

/** Why the fit of `item` into `slot` is refused, asked of the game before anything moves (its board and money are not touched), or null. */
function fitRefusal(g: Game, item: string, slot: string): string | null {
  const name = getSpec(item)?.name ?? item;
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

/** Fit a catalogue part (`item`) into a socket (`drop`, when it takes the part), as `BuildSession.fit` says. A refused fit moves nothing and has no script. */
export function putIn(g: Game, ask: { item: string; drop?: string | undefined }, shown: Shown): Outcome {
  const { item, drop } = ask,
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
  const why = fitRefusal(g, item, slot);
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
