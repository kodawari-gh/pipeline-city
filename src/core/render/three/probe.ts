// A light probe: the scene seen from one point into a cube, which three prefilters (PMREM) when a material takes it as its environment. The room's
// materials take it for their ambient light and their reflections, so the light that falls into the room bounces off what is in it: the wood's
// warmth on the plaster, the window in the desk's varnish, the dark of the night on the case. Each capture sees the last one on the walls, so a
// few captures add a bounce each. A capture draws one face a frame: a sixth of a scene draw at a time, never the six in one frame.
import { CubeCamera, HalfFloatType, WebGLCubeRenderTarget, type Camera, type CubeTexture, type Object3D, type WebGLRenderer } from 'three';

/** The cube's size: the PMREM's least (256), the same as the studio environment's, so a material keeps its program when it changes to the probe. */
const SIZE = 256;

/** What a probe draws with: the renderer's target and its draw (a stub in the tests). */
type Drawer = Pick<WebGLRenderer, 'getRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel' | 'setRenderTarget' | 'render' | 'coordinateSystem'>;

export class Probe {
  private target = new WebGLCubeRenderTarget(SIZE, { type: HalfFloatType });
  private cam: CubeCamera;
  /** The face the capture draws next; -1 while none is under way. */
  private face = -1;
  /** A capture asked for while one was under way: the next one starts when it ends. */
  private again = false;
  /** Has a capture ended? Until then the texture holds nothing. */
  ready = false;

  constructor(near: number, far: number) {
    this.cam = new CubeCamera(near, far, this.target);
  }

  /** The cube a material takes as its `envMap` (once `ready`): three prefilters it again after each capture. */
  get texture(): CubeTexture { return this.target.texture; }

  /** Is a capture under way? */
  get busy(): boolean { return this.face >= 0; }

  /** The point it sees from (world). */
  at(x: number, y: number, z: number): void {
    this.cam.position.set(x, y, z);
    this.cam.updateMatrixWorld(true);
  }

  /** Capture again; one under way ends first, then the new one starts. */
  request(): void {
    if (this.face < 0) this.face = 0;
    else this.again = true;
  }

  /** Draws the capture's next face; true when that ended a capture (the texture is new). */
  step(renderer: Drawer, scene: Object3D): boolean {
    if (this.face < 0) return false;
    if (this.cam.coordinateSystem !== renderer.coordinateSystem) { this.cam.coordinateSystem = renderer.coordinateSystem; this.cam.updateCoordinateSystem(); }
    const was = renderer.getRenderTarget(), wasFace = renderer.getActiveCubeFace(), wasLevel = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, this.cam.children[this.face] as Camera);
    renderer.setRenderTarget(was, wasFace, wasLevel);
    if (++this.face < 6) return false;
    this.texture.needsPMREMUpdate = true;
    this.ready = true;
    this.face = this.again ? 0 : -1;
    this.again = false;
    return true;
  }

  dispose(): void { this.target.dispose(); }
}
