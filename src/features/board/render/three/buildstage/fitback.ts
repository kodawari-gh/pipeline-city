// Fitting a new part, and showing back what was fitted.
import { devNode } from '@/features/board/sim/removal';
import { deviceSpec } from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';
import type { PartStep, Gone, Undo, Aim, Fitted } from './types';
import { inTurn, QUICK, sure } from './tuning';
import { motionOf, refit } from './parts';
import { StageJob } from './job';

export abstract class StageFitBack extends StageJob {
  /** The new part bought and installed in the game, and the steps it records: the part it replaces comes out, the new one goes in. */
  protected fitNew(aim: Aim): { fresh: Fitted | null; recorded: PartStep[] } {
    const { item: itemId, spec, slot, occupant } = aim;
    let fresh: Fitted | null = null;
    // (the steps this fit records: the part it replaces comes out, the new one goes in; what cannot go back belongs to the first of them, as Undo brings it back last)
    const recorded: PartStep[] = [];
    const bought = this.edit((g) => g.purchase(itemId));
    if (bought.ok) {
      const put = this.edit((g) => g.install(bought.invId, slot));
      if (put.ok) {
        this.note(`Fit ${spec.name} in ${slot}`);
        if (occupant) {
          recorded.push({ t: 'remove', spec: occupant.spec, slot });
        }
        recorded.push({ t: 'fit', spec: itemId, slot });
        for (const s of recorded) {
          this.record(s);
        }
        fresh = { id: put.deviceId ?? '', kind: spec.kind, slot };
        // (the same part in the same socket: the one that came out stands as the new one)
        const same = this.held.get(`${itemId}@${slot}`);
        if (same && put.deviceId !== null && put.deviceId !== '') {
          this.held.delete(`${itemId}@${slot}`);
          refit(same, put.deviceId);
        }
      } else {
        this.refuse(`${spec.name} does not fit: ${put.reason}`);
      }
    } else {
      this.refuse(`Cannot get ${spec.name}: ${bought.reason}`);
    }
    return { fresh, recorded };
  }

  /** The parts that were in the way go back in the game now (one build shows them all); the cables wait for their parts. */
  protected restoreAll(undo: Undo[]): { back: Fitted[]; cables: Undo[] } {
    // the parts that were in the way go back in the game now; one build shows the new part and all of them
    const back: Fitted[] = [],
      cables: Undo[] = [];
    for (const u of undo.toReversed()) {
      if (u.t === 'cable') {
        cables.push(u);
        continue;
      }
      if (u.t === 'hoses') {
        continue;
      } // (they go on after every part is in: `connectHoses` below)
      for (const g of [u as Gone, ...(u.along ?? [])]) {
        const f = this.restoreOne(g, (u.along?.length ?? 0) > 0);
        if (f) {
          back.push(f);
        }
      }
    }
    return { back, cables };
  }

  /** One part that was in the way goes back in the game (`asm`: with a radiator, as one piece); null when it no longer fits and stays out. */
  protected restoreOne(g: Gone, asm: boolean): Fitted | null {
    // (a scrapped part has no inventory id: the game refuses it as `no inventory item "null"`)
    const r = this.edit((x) => x.install(g.invId ?? 'null', g.slot));
    if (!r.ok) {
      this.stays(g);
      this.refuse(
        getSpec(g.spec)?.kind === 'fan'
          ? `${sure(getSpec(g.spec)).name} no longer fits: it stays out`
          : `Cannot put ${getSpec(g.spec)?.name ?? g.spec} back: ${r.reason}`,
      );
      return null;
    }
    this.note(`Put back ${getSpec(g.spec)?.name ?? g.spec}`);
    // (a part that is still built stands again under its new id: the build below leaves it as it is)
    const kept = this.held.get(`${g.spec}@${g.slot}`);
    if (kept && r.deviceId !== null && r.deviceId !== '') {
      this.held.delete(`${g.spec}@${g.slot}`);
      refit(kept, r.deviceId);
    }
    return {
      id: r.deviceId ?? '',
      kind: deviceSpec(sure(this.board.devices.find((x) => x.id === r.deviceId))).kind,
      slot: g.slot,
      asm,
    };
  }

  /** The new part and the ones that went back are seen going in, one after the other (a radiator and its fans together). */
  protected async showFitted(list: Fitted[]): Promise<void> {
    const shown = list.map((x) => ({ ...x, obj: this.objectOf(devNode(x.id)) }));
    for (const x of shown) {
      if (x.obj) {
        x.obj.visible = false;
      }
    }
    const asm = shown.flatMap((x) => (x.asm === true && x.obj ? [x.obj] : []));
    let asmDone = false;
    await inTurn(shown.entries(), async ([i, x]) => {
      this.pace = i === 0 || shown.length < 3 ? 1 : QUICK;
      if (x.asm === true && x.obj) {
        // (a radiator and its fans go back together)
        if (!asmDone) {
          asmDone = true;
          for (const o of asm) {
            o.visible = true;
          }
          await this.playAll(asm, 'assembly', 'in');
        }
        return;
      }
      if (x.obj) {
        x.obj.visible = true;
      }
      await this.seat(devNode(x.id), motionOf(x.kind, x.slot, this.board));
    });
  }
}
