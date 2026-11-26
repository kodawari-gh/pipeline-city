// The shader programs of the first picture and of a model that joins late (docs/render/load.md "Build my PC's first open").
import type { Group } from 'three';
import { ProgramGate, startPrograms } from '@/core/render/three/compile';
import { warmLateModels } from '@/core/render/three/gltf';
import { StageGame } from './gamelink';

export abstract class StagePrograms extends StageGame {
  /** A new build: the see-through programs of its parts' fades start to link after the next draw (`PartFade`). */
  protected warm = false;
  /**
   * The first picture waits for its programs (docs/render/load.md "Build my PC's first open"). They start to link before the first draw, and the
   * page runs on while the driver links them, as the game's first frame does (`board3d.ts`). Drawn unlinked, the 60 and more programs of the
   * machine and the passes link at that draw and hold the page for about 2 s. The machine's, the see-through variants of its fades, the passes'.
   */
  protected readonly programs = new ProgramGate(() => {
    const { scene, camera, renderer } = this.ctx;
    this.warm = false; // (the fades' programs are in that batch)
    return [
      ...startPrograms(renderer, scene, camera, {
        fades: [this.machine.root, ...(this.monitor ? [this.monitor] : [])],
      }),
      ...this.post.startPrograms(renderer),
    ];
  });
  protected monitor: Group | null = null;
  /** A model that joins after the first picture's programs have started (a slow network) links its own while it is hidden (`joinModel`); its parts fade. */
  protected override warmModels(): void {
    const { scene, camera, renderer } = this.ctx;
    // (a model that joins after the first picture's programs have started, a slow network, links its own while it is hidden: `joinModel`; its parts fade)
    warmLateModels(scene, (model) =>
      this.programs.started ? startPrograms(renderer, model, camera, { scene, fades: [model] }) : null,
    );
  }
}
