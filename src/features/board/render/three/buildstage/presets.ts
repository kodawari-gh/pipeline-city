// Preset builds and layouts, reset and clear.
import type { BuildLayout, BuildPreset } from '@/features/board/sim/buildspecs';
import { bareGame, fullGame, layoutGame, presetGame } from '@/features/board/sim/buildpreset';
import { StageFit } from './fit';

export abstract class StagePresets extends StageFit {
  /** A ready-made machine, built at once (no animation): `level` 0..1 picks how high a tier of each part; `ram`, `storage`, `gpus` and `npus` how many
   *  of each to fit. Parts that fit nowhere are skipped. */
  async buildPreset(p: BuildPreset): Promise<void> {
    if (this.status.peek().busy) {
      return;
    }
    const g = await presetGame(p);
    if (this.dead) {
      return;
    }
    this.record(this.swapIn(g, `Built the ${p.name} machine`));
  }

  /** What is in the machine now, to save under a name (`loadLayout` builds it again). */
  get layout(): BuildLayout {
    const g = this.game;
    return {
      caseTier: this.board.caseTier,
      boardTier: this.board.tier,
      parts: this.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })),
      os: this.snapshot.os?.tier ?? 0,
      router: g.routerTier,
      isp: g.ispTier,
    };
  }

  /** Build a saved layout at once (no animation). Parts that no longer fit are skipped. */
  async loadLayout(l: BuildLayout, name: string): Promise<void> {
    if (this.status.peek().busy) {
      return;
    }
    const g = await layoutGame(l);
    if (this.dead) {
      return;
    }
    // (the machine it replaces stays in the history: Undo brings it back)
    this.record(this.swapIn(g, `Loaded ${name}`));
  }

  /** A new sandbox machine: the biggest rig, as at the start. */
  async reset(): Promise<void> {
    if (this.status.peek().busy) {
      return;
    }
    const g = await fullGame();
    if (this.dead) {
      return;
    }
    this.record(this.swapIn(g, 'Fitted every part'));
  }

  /** Nothing on the stage, not even a case: build up from nothing, the case first (from the shelf), then the board, then the parts. */
  async clear(): Promise<void> {
    if (this.status.peek().busy) {
      return;
    }
    const g = await bareGame();
    if (this.dead) {
      return;
    }
    this.record(this.swapIn(g, 'Cleared the stage', 'nothing'));
  }
}
