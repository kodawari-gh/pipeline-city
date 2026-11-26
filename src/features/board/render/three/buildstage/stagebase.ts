// What the constructor makes (`buildstage.ts`) and calls of the later layers, declared for the layers between.
import type { OrbitView } from '@/core/render/three/camera';
import type { Post } from '@/core/render/three/post';
import type { HandHost, PlugHand } from '../plughand3d';
import type { BoardLive3D } from '../boardlive3d';
import type { Lens3D } from '../lens3d';
import type { RenderContext } from '@/core/render/three/init';
import { StageState } from './stagestate';

export abstract class StageBase extends StageState {
  /** What the constructor makes (`BuildStage`): the renderer, its passes and the layers drawn over the machine. */
  protected abstract readonly host: HTMLElement;
  protected abstract readonly ctx: RenderContext;
  protected abstract readonly post: Post;
  protected abstract readonly lens: Lens3D;
  protected abstract readonly live: BoardLive3D;
  protected abstract readonly hand: PlugHand;
  protected abstract view: OrbitView;
  protected abstract goal: OrbitView;
  protected abstract W: number;
  protected abstract H: number;
  /** What the constructor calls of the later layers. */
  protected abstract frameView(): OrbitView;
  protected abstract handHost(): HandHost;
  protected abstract listen(el: HTMLCanvasElement): void;
  protected abstract warmModels(): void;
  protected abstract watchGraphics(): void;
  protected abstract watchHost(host: HTMLElement): void;

  /** Is the hand holding a plug (`PlugHand.kind`, the cable's id)? */
  protected get holding(): boolean {
    return this.hand.kind !== null && this.hand.kind !== '';
  }
}
