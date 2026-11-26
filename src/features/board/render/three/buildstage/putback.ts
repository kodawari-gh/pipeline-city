// Putting a part or a cable back where it was.
import { cableNode, devNode } from '@/features/board/sim/removal';
import { deviceSpec } from '@/features/board/sim/board';
import { CABLE_IDS, cableNeeded } from '@/features/board/sim/cables';
import { getSpec } from '@/features/board/sim/specs';
import type { Along, CableId, Undo } from './types';
import { CABLE_QUICK, sure, isBlocked } from './tuning';
import { motionOf, refit } from './parts';
import { StageGestures } from './gestures';

/** Is `id` one of the game's cables (a fixed one, or a fan's `fan:` cable)? */
const isCableId = (id: string): id is CableId => id.startsWith('fan:') || CABLE_IDS.some((c) => c === id);

export abstract class StagePutBack extends StageGestures {
  /** The parts this job took out and could not put back, in the order they would go back (`Along`): the step it records keeps them for Undo. */
  protected stayed: Along[] = [];
  protected stays(g: { spec: string; slot: string }): void {
    this.stayed.push({ spec: g.spec, slot: g.slot });
  }

  protected async putBack(u: Undo): Promise<void> {
    if (u.t === 'hoses') {
      await this.connectHoses();
      return;
    }
    if (u.t === 'cable') {
      await this.putBackCable(u.id);
      return;
    }
    if ((u.along?.length ?? 0) > 0) {
      await this.putBackAssembly(u);
      return;
    }
    await this.putBackDevice(u);
  }

  /** A cable goes back in: run out of its hole, carried by the hand, or (with no rig, or one the game refuses) connected at once. */
  protected async putBackCable(id: string): Promise<void> {
    // (an id the game has no cable for is never needed back: it stays out, as `cableBlocked` would answer)
    if (this.cables[id] === true || !isCableId(id) || !cableNeeded(this.board, id) || isBlocked(this.board, id)) {
      return;
    }
    // (the PC's cord goes into the supply's inlet: with the supply out it stays unplugged)
    if (id === 'pcmains' && !this.board.devices.some((d) => deviceSpec(d).kind === 'psu')) {
      return;
    }
    this.note(`Plug in ${this.snapshot.cables.find((c) => c.id === id)?.name ?? id}`);
    // a cable that came with its part runs out of its hole to its socket and is pushed in; the plug of one that lies loose is carried
    if (this.reeled.has(id)) {
      this.setStep('Run the cable to its socket');
      if (await this.runOut(id, true)) {
        this.bump();
        return;
      }
      if (this.dead) {
        return;
      }
    }
    // the loose plug is carried to its socket and pushed in; a cable with no rig (or one the game refuses) is connected at once
    this.setStep('Push the plug home');
    if (await this.hand.plugIn(id, this.pace > 1 ? CABLE_QUICK : 1)) {
      this.bump();
      return;
    }
    if (this.dead) {
      return;
    }
    this.edit((g) => g.connectCable(id));
    this.rebuild();
    await this.play(cableNode(id), 'cable', 'in');
  }

  /** A part goes back in its socket: shown again where it was when it is still built, or built and seated. */
  protected async putBackDevice(u: Undo & { t: 'dev' }): Promise<void> {
    // (a scrapped part has no inventory id: the game refuses it as `no inventory item "null"`)
    const r = this.edit((g) => g.install(u.invId ?? 'null', u.slot));
    // (a fan the new heatsink or case has no spot for stays out, as the game sends it to the inventory)
    if (!r.ok) {
      this.stays(u);
      this.refuse(
        getSpec(u.spec)?.kind === 'fan'
          ? `${sure(getSpec(u.spec)).name} no longer fits: it stays out`
          : `Cannot put ${getSpec(u.spec)?.name ?? u.spec} back: ${r.reason}`,
      );
      return;
    }
    this.note(`Put back ${getSpec(u.spec)?.name ?? u.spec}`);
    const kept = this.held.get(`${u.spec}@${u.slot}`);
    if (kept && r.deviceId !== null && r.deviceId !== '') {
      // the part that came out is still built: it goes back where it was, under the id the game gave it
      this.held.delete(`${u.spec}@${u.slot}`);
      refit(kept, r.deviceId);
      this.snaps.drop();
      this.bump();
      const { kind } = deviceSpec(sure(this.board.devices.find((x) => x.id === r.deviceId)));
      await this.seat(devNode(r.deviceId), motionOf(kind, u.slot, this.board));
      return;
    }
    this.rebuild();
    const node = devNode(r.deviceId ?? '');
    const { kind } = deviceSpec(sure(this.board.devices.find((x) => x.id === r.deviceId)));
    await this.seat(node, motionOf(kind, u.slot, this.board));
  }
}
