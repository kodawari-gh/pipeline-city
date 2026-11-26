// The power, airflow and network lenses in 3D (docs/render/interact.md, lenses): each is a view in the machine's own space, not a sheet over the picture. The power lens
// lights the real cables, the board's copper and the parts by what they draw (`power/view.ts`, docs/render/power.md); the airflow lens is the case's air as
// particles (`air/view.ts`, docs/render/air.md); the network lens lights the path data takes, from the wall plate to the router and down the LAN lead to the machine's
// port (`features/network/render/lens/view.ts`, docs/render/net.md). One is on at a time (`powerLens`, `airflowLens`, `networkLens`).
import type { PerspectiveCamera, Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { airflowLens, networkLens, powerLens } from '@/app/hover';
import { NetView3D } from '@/features/network/render/lens/view';
import { AirView3D } from './air/view';
import type { Machine3D } from './machine3d';
import { PowerView3D } from './power/view';

export class Lens3D {
  private readonly air: AirView3D;
  private readonly power: PowerView3D;
  private readonly net: NetView3D;

  /** `dom`: the canvas the scene draws on (the words of the lenses are pinned over it). */
  constructor(scene: Scene, dom: HTMLElement | null = null) {
    this.air = new AirView3D(scene, dom);
    this.power = new PowerView3D(scene, dom);
    this.net = new NetView3D(scene, dom);
  }

  /**
   * Does the lens that is drawing darken the picture on purpose (the power lens: all that is no power part goes near black)? The host then holds the eye
   * (`Eye.hold`, `Post.setDark`), or the exposure and the local eye would lift the dark back up. The airflow and network lenses only tint the room: the eye adapts to them.
   */
  get dark(): boolean {
    return this.power.shown;
  }

  /**
   * Per frame (after the camera): draw the lens that is on, or hide all. `dt` in game seconds, `dpr` the canvas pixels per CSS pixel.
   * `machine`: the machine the lens runs in (no machine, no lens).
   */
  frame(
    cam: PerspectiveCamera,
    H: number,
    s: Snapshot | null,
    dt: number,
    dpr: number,
    machine: Machine3D | null = null,
  ): void {
    if (airflowLens.peek() && s && machine) {
      this.air.frame(cam, H * dpr, s, machine, dt);
    } else {
      this.air.hide();
    }
    if (powerLens.peek() && s && machine) {
      this.power.frame(cam, H * dpr, s, machine, dt);
    } else {
      this.power.hide();
    }
    if (networkLens.peek() && s && machine) {
      this.net.frame(cam, H * dpr, s, machine, dt);
    } else {
      this.net.hide();
    }
  }

  dispose(): void {
    this.air.dispose();
    this.power.dispose();
    this.net.dispose();
  }
}
