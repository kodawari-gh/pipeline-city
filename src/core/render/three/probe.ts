// A light probe: the scene seen from one point into a cube, which three prefilters (PMREM) when a material takes it as its environment. The room's
// materials take it for their ambient light and their reflections, so the light that falls into the room bounces off what is in it: the wood's
// warmth on the plaster, the window in the desk's varnish, the dark of the night on the case. Each capture sees the last one on the walls, so a
// few captures add a bounce each. A capture draws one face a frame: a sixth of a scene draw at a time, never the six in one frame.
import { BackSide, BoxGeometry, CubeCamera, HalfFloatType, Mesh, Scene, ShaderMaterial, WebGLCubeRenderTarget, type Camera, type CubeTexture, type Light, type LightShadow, type Object3D, type WebGLRenderer } from 'three';
import { startPrograms, type Program } from './compile';

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

/**
 * Leaves `root` out of one draw; the call it gives puts it back. The lights under it stay in the scene's light state, at no strength. Three keys
 * each lit material's program to the count of lights of each kind: a light that leaves for one draw makes every material look its program up
 * again in that draw and in the next frame's (CITY-06: each of a capture's frames took twice a frame's script time). A light at no strength
 * lights as a hidden one does, so the capture is the same picture. A root with no shown light is hidden whole.
 */
export function leaveOut(root: Object3D): () => void {
  const lights: (Light & { shadow?: LightShadow })[] = [];
  root.traverseVisible((o) => { if ((o as Light).isLight) lights.push(o as Light); });
  if (!lights.length) {
    const shown = root.visible;
    root.visible = false;
    return () => { root.visible = shown; };
  }
  // what leads to a light stays in three's walk; the rest is hidden whole
  const kept = new Set<Object3D>();
  for (const l of lights) for (let o: Object3D | null = l; o && !kept.has(o); o = o === root ? null : o.parent) kept.add(o);
  const hidden: Object3D[] = [], layers: [Object3D, number][] = [];
  const walk = (o: Object3D): void => {
    for (const c of o.children) {
      if (!kept.has(c)) { if (c.visible) { c.visible = false; hidden.push(c); } continue; }
      // an object over a light leaves by its layers: three does not draw it and still walks to its children
      if (!(c as Light).isLight) { layers.push([c, c.layers.mask]); c.layers.mask = 0; }
      walk(c);
    }
  };
  walk(root);
  // a shadow map owed is drawn by the next frame, with the root in it
  const strengths = lights.map((l) => l.intensity), owed = lights.filter((l) => l.shadow?.needsUpdate);
  for (const l of lights) l.intensity = 0;
  for (const l of owed) l.shadow!.needsUpdate = false;
  return () => {
    for (const o of hidden) o.visible = true;
    for (const [o, mask] of layers) o.layers.mask = mask;
    lights.forEach((l, i) => { l.intensity = strengths[i]!; });
    for (const l of owed) l.shadow!.needsUpdate = true;
  };
}

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

  /** Starts linking the calm pass's program (`compile.ts`): the first capture's end would link it then, in a frame of the page. */
  startPrograms(r: WebGLRenderer): Program[] { return this.wash && this.outCam ? startPrograms(r, this.wash, this.outCam.children[0] as Camera) : []; }

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
   * draw only (`leaveOut`): it is put back in the same call, so the frame never sees it hidden and the case does not reflect itself.
   */
  step(renderer: Drawer, scene: Object3D, hide: Object3D | null = null): boolean {
    if (this.face < 0) return false;
    if (this.cam.coordinateSystem !== renderer.coordinateSystem) { this.cam.coordinateSystem = renderer.coordinateSystem; this.cam.updateCoordinateSystem(); }
    const was = renderer.getRenderTarget(), wasFace = renderer.getActiveCubeFace(), wasLevel = renderer.getActiveMipmapLevel();
    const back = hide ? leaveOut(hide) : null;
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, this.cam.children[this.face] as Camera);
    renderer.setRenderTarget(was, wasFace, wasLevel);
    back?.();
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
