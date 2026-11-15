// A light probe: the scene seen from one point into a cube, which three prefilters (PMREM) when a material takes it as its environment. The room's
// materials take it for their ambient light and their reflections, so the light that falls into the room bounces off what is in it: the wood's
// warmth on the plaster, the window in the desk's varnish, the dark of the night on the case. Each capture sees the last one on the walls, so a
// few captures add a bounce each. A capture draws one face a frame: a sixth of a scene draw at a time, never the six in one frame.
import { BackSide, BoxGeometry, CubeCamera, HalfFloatType, Mesh, Scene, ShaderMaterial, WebGLCubeRenderTarget, type Camera, type CubeTexture, type Object3D, type WebGLRenderer } from 'three';

/** The cube's size: the PMREM's least (256), the same as the studio environment's, so a material keeps its program when it changes to the probe. */
const SIZE = 256;

/**
 * The share of its colour the probe's light loses (`Probe`'s `calm`). The window fills half the probe with a clear sky, and a view exposed for
 * the dark inside of the case shows that light at full strength: black steel read sky blue on one side and wood orange on the other. A camera
 * balances a part of a cast away; the probe keeps this much less of it, the light's level kept (the luminance is the same).
 */
export const PROBE_CALM = 0.55;

// the calm pass: a box round a second cube camera, each texel the capture's in the same direction with a share of its colour taken away
const CALM_VERT = /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CALM_FRAG = /* glsl */`
uniform samplerCube env; uniform float calm; varying vec3 vDir;
void main() { vec3 c = textureCube(env, vDir).rgb; gl_FragColor = vec4(mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), calm), 1.0); }`;

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

  // the calm pass's own cube, camera and box (none when `calm` is 0)
  private out: WebGLCubeRenderTarget | null = null;
  private outCam: CubeCamera | null = null;
  private wash: Scene | null = null;

  /** `calm`: the share of its colour the light loses (0: none, the capture as it is). */
  constructor(near: number, far: number, calm = 0) {
    this.cam = new CubeCamera(near, far, this.target);
    if (calm > 0) {
      this.out = new WebGLCubeRenderTarget(SIZE, { type: HalfFloatType });
      this.outCam = new CubeCamera(0.1, 10, this.out);
      const box = new Mesh(new BoxGeometry(2, 2, 2), new ShaderMaterial({ uniforms: { env: { value: this.target.texture }, calm: { value: calm } }, vertexShader: CALM_VERT, fragmentShader: CALM_FRAG, side: BackSide, depthTest: false, depthWrite: false }));
      this.wash = new Scene().add(box);
    }
  }

  /** The cube a material takes as its `envMap` (once `ready`): three prefilters it again after each capture. */
  get texture(): CubeTexture { return (this.out ?? this.target).texture; }

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

  /**
   * Draws the capture's next face; true when that ended a capture (the texture is new). `hide` (the machine's root) is left out of the face's
   * draw only: it is hidden and shown again in the same call, so the frame never sees it hidden and the case does not reflect itself.
   */
  step(renderer: Drawer, scene: Object3D, hide: Object3D | null = null): boolean {
    if (this.face < 0) return false;
    if (this.cam.coordinateSystem !== renderer.coordinateSystem) { this.cam.coordinateSystem = renderer.coordinateSystem; this.cam.updateCoordinateSystem(); }
    const was = renderer.getRenderTarget(), wasFace = renderer.getActiveCubeFace(), wasLevel = renderer.getActiveMipmapLevel();
    const shown = hide ? hide.visible : false;
    if (hide) hide.visible = false;
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, this.cam.children[this.face] as Camera);
    renderer.setRenderTarget(was, wasFace, wasLevel);
    if (hide) hide.visible = shown;
    if (++this.face < 6) return false;
    if (this.out && this.outCam && this.wash) {
      // the calm pass: six small draws of one box, at the capture's end only
      if (this.outCam.coordinateSystem !== renderer.coordinateSystem) { this.outCam.coordinateSystem = renderer.coordinateSystem; this.outCam.updateCoordinateSystem(); }
      for (let i = 0; i < 6; i++) { renderer.setRenderTarget(this.out, i); renderer.render(this.wash, this.outCam.children[i] as Camera); }
      renderer.setRenderTarget(was, wasFace, wasLevel);
    }
    this.texture.needsPMREMUpdate = true;
    this.ready = true;
    this.face = this.again ? 0 : -1;
    this.again = false;
    return true;
  }

  dispose(): void {
    this.target.dispose();
    this.out?.dispose();
    const box = this.wash?.children[0] as Mesh | undefined;
    if (box) { box.geometry.dispose(); (box.material as ShaderMaterial).dispose(); }
  }
}
