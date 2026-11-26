// Putting back an assembly (a radiator with its fans) and what it needs plugged.
import type { Object3D } from 'three';
import { devNode } from '@/features/board/sim/removal';
import { WALL_CABLES, cableNeeded, cablesOf } from '@/features/board/sim/cables';
import { getSpec } from '@/features/board/sim/specs';
import { OUTSIDE } from '@/features/board/sim/buildpreset';
import type { Gone, Undo } from './types';
import { refit } from './parts';
import { inTurn, isBlocked } from './tuning';
import { StagePutBack } from './putback';

export abstract class StageAssembly extends StagePutBack {
  /** The radiator and its fans go back as one piece: shown again where they were (or built again), then pressed onto the panel together. */
  protected override async putBackAssembly(u: Undo & { t: 'dev' }): Promise<void> {
    const list: Gone[] = [u, ...(u.along ?? [])],
      placed: { g: Gone; id: string }[] = [];
    for (const g of list) {
      // (a scrapped part has no inventory id: the game refuses it as `no inventory item "null"`)
      const r = this.edit((x) => x.install(g.invId ?? 'null', g.slot));
      if (r.ok && r.deviceId !== null && r.deviceId !== '') {
        placed.push({ g, id: r.deviceId });
      } else {
        this.stays(g);
        this.refuse(`Cannot put ${getSpec(g.spec)?.name ?? g.spec} back: ${r.ok ? 'no device' : r.reason}`);
      }
    }
    if (placed.length === 0) {
      return;
    }
    this.note(`Put back ${getSpec(u.spec)?.name ?? u.spec}${placed.length > 1 ? ' with its fans' : ''}`);
    if (!placed.every((p) => this.held.has(`${p.g.spec}@${p.g.slot}`))) {
      this.builtKey = '';
      this.rebuild();
    }
    const objs: Object3D[] = [];
    for (const p of placed) {
      const kept = this.held.get(`${p.g.spec}@${p.g.slot}`);
      if (kept) {
        this.held.delete(`${p.g.spec}@${p.g.slot}`);
        refit(kept, p.id);
        objs.push(kept.obj);
      } else {
        const o = this.objectOf(devNode(p.id));
        if (o) {
          objs.push(o);
        }
      }
    }
    this.snaps.drop();
    this.bump();
    await this.playAll(objs, 'assembly', 'in');
  }

  /**
   * Plug in the cables a part just fitted needs. The cords from the wall go in too (the game counted them plugged before the stage showed it; the video
   * cable and the LAN lead stay out: they are the player's).
   */
  protected async plugNeeded(): Promise<void> {
    await inTurn(cablesOf(this.board).values(), async (c) => {
      if (
        (OUTSIDE.has(c.id) && !WALL_CABLES.includes(c.id)) ||
        this.cables[c.id] === true ||
        !cableNeeded(this.board, c.id) ||
        isBlocked(this.board, c.id)
      ) {
        return;
      }
      await this.putBack({ t: 'cable', id: c.id });
    });
  }
}
