// The stage (`BuildStage`): its constructor and `open`. The class is a chain of layers, one a file, from `stagestate.ts` up to this one.

import { createRenderContext } from '@/core/render/three/init';
import { Post } from '@/core/render/three/post';
import { startBaker } from '../bake';
import { PlugHand } from '../plughand3d';
import { BoardLive3D } from '../boardlive3d';
import { Lens3D } from '../lens3d';
import { lightStudio } from './studio';
import type { OrbitView, RenderContext } from './types';
import { StageTeardown } from './teardown';

declare global {
  /** Dev only: the Build my PC stage the shot tools drive (`tools/buildstills.mjs`, `tools/jobsheet.mjs`); set by `open`, cleared by `close`. */
  var __build: unknown;
}

export class BuildStage extends StageTeardown {
  protected override readonly ctx: RenderContext;
  protected override readonly post: Post;
  /** The power and airflow lenses (the `powerLens` / `airflowLens` signals), over the machine as in the game. */
  protected override readonly lens: Lens3D;
  /** The board's live layer and the monitor's screen, drawn by the game's own `Live` while the machine is on (`screen`). */
  protected override readonly live: BoardLive3D;
  protected override readonly hand: PlugHand;
  protected override readonly host: HTMLElement;
  protected override view: OrbitView;
  protected override goal: OrbitView;
  protected override W: number;
  protected override H: number;
  private constructor(host: HTMLElement) {
    super();
    this.host = host;
    this.ctx = createRenderContext(host, '#49484a');
    const { scene, camera, renderer } = this.ctx;
    this.W = Math.max(1, host.clientWidth);
    this.H = Math.max(1, host.clientHeight);
    lightStudio(scene, renderer);
    this.post = new Post(renderer, scene, camera, this.W, this.H);
    this.warmModels();
    this.lens = new Lens3D(scene, renderer.domElement);
    this.live = new BoardLive3D(scene);
    // the hand that pulls a cable's plug out and pushes it in: by itself in a job (plughand3d.ts `pullOut`, `plugIn`), under the player's pointer otherwise
    // (`beginCable`), on this stage's own game (the case's front-panel leads are not the game's cables: the stage keeps which are plugged, `panelOut`, and shows
    // them to the hand as cables)
    this.hand = new PlugHand(this.handHost(), renderer.domElement);
    scene.add(this.hand.root);
    this.watchGraphics();
    this.view = this.frameView();
    this.goal = this.view;
    this.listen(renderer.domElement);
    this.watchHost(host);
  }

  /**
   * Open the stage in `host` (a sized element) with a fresh sandbox game that holds the biggest machine. It resolves with the first picture. A
   * `signal` that aborts before that frees the stage and ends the wait (the stage comes back closed).
   */
  static async open(host: HTMLElement, signal?: AbortSignal): Promise<BuildStage> {
    const { Game } = await import('@/worker/game/game');
    startBaker();
    const s = new BuildStage(host);
    if (signal?.aborted === true) {
      s.dispose();
    } else {
      signal?.addEventListener(
        'abort',
        () => {
          s.dispose();
        },
        { once: true },
      );
    }
    if (s.dead) {
      return s;
    }
    s.game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
    // (the machine builds a slice at a time: the page answers meanwhile, and a player who leaves frees the stage at once)
    await s.buildFirst();
    if (s.dead) {
      return s;
    }
    if (import.meta.env.DEV) {
      globalThis.__build = s;
    }
    s.last = performance.now();
    s.raf = requestAnimationFrame(s.frame);
    // (the skeleton stays up until the first picture: its programs link meanwhile, the page alive)
    await s.picture;
    return s;
  }
}
