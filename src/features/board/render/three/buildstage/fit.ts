// Fitting a part from the bin: the slot it goes in, the steps, the way cleared.
import {
  accessBlockers,
  buildGraph,
  devNode,
  hasLoop,
  removalPlan,
  removalPlanAll,
  SIDE,
} from '@/features/board/sim/removal';
import { boardSlots, freeSlots, slotAccepts, slotFits } from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';
import { netKindOf } from '@/features/board/sim/buildnet';
import type { Aim, DeviceSpec, SlotInfo, Undo } from './types';
import { inTurn, QUICK } from './tuning';
import { StageShell } from './shell';

export abstract class StageFit extends StageShell {
  /** Fit a catalogue part (its id; the shelf is unlimited, there is no inventory here). `drop`: the socket it was dropped on
   *  (`slotAt`) when that socket takes it; otherwise (or without one) the first free socket that takes it, else the socket of the part it replaces. */
  override async fit(item: string, drop?: string): Promise<void> {
    await this.job(async () => this.fitItem(item, drop));
  }

  /** The job of `fit`: a case or a board (`fitShell`), an OS, a router or a plan (`fitNet`), or a part in the socket it picks. */
  protected async fitItem(itemId: string, drop?: string): Promise<void> {
    if (/^(?:case|board)\d$/u.test(itemId)) {
      return this.fitShell(itemId);
    }
    const kind = netKindOf(itemId);
    if (kind !== null) {
      this.fitNet(itemId, kind);
      return;
    }
    const spec = this.fitSpec(itemId);
    if (!spec) {
      return;
    }
    const slot = this.fitSlot(spec, drop);
    if (slot === undefined || slot === '') {
      return;
    }
    const occupant = this.board.devices.find((d) => d.slot === slot) ?? null;
    await this.fitPart({ item: itemId, spec, slot, occupant });
  }

  /** The part's spec, or null when the stage cannot take a part now (no case, no board) or the id is unknown: the hint line says why. */
  protected fitSpec(itemId: string): DeviceSpec | null {
    // (a bare case has no socket: every part plugs into the board; with no case there is nothing to plug into)
    if (this.shown.peek() === 'nothing') {
      this.refuse('Fit a case first: every part goes in it');
      return null;
    }
    if (this.bare.peek()) {
      this.refuse('Fit a motherboard first: every other part plugs into it');
      return null;
    }
    const spec = getSpec(itemId);
    if (!spec) {
      this.refuse(`Unknown part ${itemId}`);
      return null;
    }
    return spec;
  }

  /** The socket the part goes in (`fit`'s rule), or undefined when none takes it: the hint line says why. */
  protected fitSlot(spec: DeviceSpec, drop?: string): string | undefined {
    const fits = (s: SlotInfo) => slotAccepts(s.type, spec.slot) && slotFits(s, spec);
    const [free] = freeSlots(this.board, spec.slot, spec);
    const taken = boardSlots(this.board).find((s) => fits(s) && this.board.devices.some((d) => d.slot === s.id));
    const aimed =
      drop !== undefined && drop !== '' && boardSlots(this.board).some((s) => s.id === drop && fits(s))
        ? drop
        : undefined;
    const slot = aimed ?? free?.id ?? taken?.id;
    if (slot === undefined || slot === '') {
      this.refuse(
        spec.kind === 'fan'
          ? `Nothing in this machine takes a ${spec.size} mm fan`
          : `${spec.name} fits no socket on this board`,
      );
    }
    return slot;
  }

  /** The steps that clear the way to the socket: the part in it, or what blocks it; the side panel first. */
  protected fitSteps(aim: Aim): string[] {
    const graph = buildGraph(this.board, this.cables);
    const steps = this.assemble(
      aim.occupant
        ? removalPlan(graph, devNode(aim.occupant.id))
        : removalPlanAll(
            graph,
            accessBlockers({ board: this.board, slotId: aim.slot, kind: aim.spec.kind, specId: aim.item }).filter((n) =>
              graph.has(n),
            ),
          ),
    );
    if (steps.length === 0) {
      steps.push(SIDE);
    }
    if (steps[0] !== SIDE) {
      steps.unshift(SIDE);
    }
    return steps;
  }

  /** A part in a socket: what is in the way comes out, the part goes in, the others go back, then the hoses and the cables. */
  protected async fitPart(aim: Aim): Promise<void> {
    const steps = this.fitSteps(aim);
    const undo: Undo[] = [],
      looped = hasLoop(this.board),
      had = new Set<string>(
        this.snapshot.cables.filter((c) => c.connected || c.blocked === undefined || c.blocked === '').map((c) => c.id),
      );
    await this.clearWay(steps, aim, undo);
    const { fresh, recorded } = this.fitNew(aim);
    const { back, cables } = this.restoreAll(undo);
    if (recorded[0] && this.stayed.length > 0) {
      recorded[0].along = this.stayed.splice(0);
    }
    // a part that just made the loop (a pump with a radiator in, a radiator with a pump in): its hoses are built off and go on last
    if (!looped && hasLoop(this.board)) {
      this.hosesOff = true;
    }
    // (one patch or one build: the part that came is built, the others stand as they are, hidden until they go back in)
    this.rebuild();
    // what the new part brought (a supply's leads and cord, a monitor's cables) stays out of sight until the part is in: then it runs out of its hole
    for (const c of this.snapshot.cables) {
      if ((c.connected || c.blocked === undefined || c.blocked === '') && !had.has(c.id)) {
        this.reeled.add(c.id);
      }
    }
    this.holdReeled();
    await this.showFitted([...(fresh ? [fresh] : []), ...back]);
    this.pace = 1;
    // (the loop's hoses go on once the pump and the radiator are both in, then the cables)
    await this.connectHoses();
    await inTurn(cables.values(), async (u) => {
      await this.putBack(u);
    });
    await this.plugNeeded();
    await this.runLoose();
  }

  /** Take out what is in the way (the part it replaces at its own pace). The parts in the way are hidden, not built again: the one build after has them all back. */
  protected async clearWay(steps: string[], aim: Aim, undo: Undo[]): Promise<void> {
    const { occupant } = aim;
    // (the parts in the way are hidden, not built again: the one build below has them all back)
    this.deferring = true;
    try {
      await inTurn(steps.values(), async (n) => {
        this.pace = steps.length > 2 && !(occupant && n === devNode(occupant.id)) ? QUICK : 1;
        await this.takeOut(n, occupant && n === devNode(occupant.id) ? null : undo);
      });
    } finally {
      this.deferring = false;
      this.pace = 1;
    }
  }
}
