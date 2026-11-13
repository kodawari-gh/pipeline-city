// The room's own picture in the window's glass at night (`view.ts`): the room drawn from the eye mirrored in the glass, cut off at the glass's
// plane (the camera's near plane tilted to lie on it, so what stands behind the glass does not get in the way), small and in the frame's light.
// Only what glows is in it (`glowOnly`): the lamps, the screen and the LEDs, not the surfaces they light. The window's quad lays it faintly
// over the city. What does not glow draws black, so a plain black material takes its place: a tenth of the shading, and its draws sort together.
import {
  BackSide, DoubleSide, FrontSide, Group, HalfFloatType, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, NormalBlending, PerspectiveCamera, Plane, PlaneGeometry, Vector3, Vector4, WebGLRenderTarget,
  type Light, type Material, type MeshPhysicalMaterial, type MeshStandardMaterial, type Scene, type SkinnedMesh, type WebGLRenderer,
} from 'three';
import { startPrograms, type Program } from '@/core/render/three/compile';

/** The picture's size, as a share of the frame's: it is blurred anyway. */
const SCALE = 0.5;

/** The brightest a glow is in the picture: the window's quad lifts what passes its threshold, and a lamp's own brightness would show as a white blot. */
const GLOW_CAP = 0.08;

/**
 * Turns off all that lights the room (its lights, its light maps, its environment), holds each glow to `GLOW_CAP`, and gives back what turns
 * it all on again. The glass, far darker than the room it mirrors, shows only what glows, faintly: the lamps, the screen, the LEDs. Lit, the
 * room's surfaces would come through the window's lift as flat pale shapes (a chrome hook, the hoodie, a lamp's pool on the wall). Only
 * uniforms change, so no shader compiles again. A mesh that only hides what is behind it (`hidesOnly`) takes its black (`blacks`) meanwhile.
 */
export function glowOnly(scene: Scene, blacks: readonly Material[]): () => void {
  const lights: [Light, number][] = [], mats: [MeshStandardMaterial, number, number, number][] = [], seen = new Set<Material>(), hid: [Mesh, Material][] = [];
  scene.traverse((o) => {
    if ((o as Light).isLight) { const l = o as Light; lights.push([l, l.intensity]); l.intensity = 0; return; }
    const m = (o as Mesh).material;
    if (!m) return;
    if (!Array.isArray(m) && hidesOnly(o as Mesh, m as MeshStandardMaterial)) {
      hid.push([o as Mesh, m]);
      (o as Mesh).material = blacks[(m.side === DoubleSide ? KINDS : 0) + kindOf(o as Mesh)]!;
      return;
    }
    for (const x of Array.isArray(m) ? m : [m]) {
      const s = x as MeshStandardMaterial;
      if (seen.has(x) || s.envMapIntensity === undefined) continue;
      seen.add(x);
      mats.push([s, s.envMapIntensity, s.lightMapIntensity, s.emissiveIntensity]);
      s.envMapIntensity = 0; s.lightMapIntensity = 0;
      s.emissiveIntensity = glowIn(s.emissive.r, s.emissive.g, s.emissive.b, s.emissiveIntensity);
    }
  });
  const env = scene.environmentIntensity;
  scene.environmentIntensity = 0;
  return () => {
    for (const [l, i] of lights) l.intensity = i;
    for (const [s, e, lm, g] of mats) { s.envMapIntensity = e; s.lightMapIntensity = lm; s.emissiveIntensity = g; }
    for (const [o, x] of hid) o.material = x;
    scene.environmentIntensity = env;
  };
}

/**
 * Lit by nothing, does this mesh draw just what a plain opaque black does: no glow, no see-through or cut-out shape, no change to its shape or
 * its depth? A shadow due is drawn inside the picture's render, so the black must also cast the same depth (`shadowSide`).
 */
function hidesOnly(o: Mesh, s: MeshStandardMaterial): boolean {
  return !!o.isMesh && s.envMapIntensity !== undefined && (s.emissiveIntensity === 0 || (s.emissive.r === 0 && s.emissive.g === 0 && s.emissive.b === 0))
    && !s.transparent && s.alphaTest === 0 && !s.alphaHash && !s.alphaToCoverage && s.blending === NormalBlending && s.side !== BackSide && s.shadowSide === null
    && s.visible && s.colorWrite && s.depthWrite && s.depthTest && !s.polygonOffset && !s.wireframe && !s.clippingPlanes?.length && !s.displacementMap
    && !(s as MeshPhysicalMaterial).transmission && !(o as SkinnedMesh).isSkinnedMesh && !o.geometry.morphAttributes.position;
}

/** The kinds of mesh a black must suit, each with a program of its own: plain, instanced, instanced with its colours. */
const KINDS = 3;
const kindOf = (o: Mesh): number => (!(o as InstancedMesh).isInstancedMesh ? 0 : (o as InstancedMesh).instanceColor ? 2 : 1);

/** A glow's strength in the picture: its own, or less, so that its brightest channel is `GLOW_CAP`. */
function glowIn(r: number, g: number, b: number, k: number): number {
  const top = Math.max(r, g, b) * k;
  return top > GLOW_CAP ? (k * GLOW_CAP) / top : k;
}

export class GlassMirror {
  /** From a world point to its uv in the picture (divide by w). */
  readonly uvOf = new Matrix4();
  target: WebGLRenderTarget | null = null;
  private cam = new PerspectiveCamera();
  private plane = new Plane();
  private clip = new Vector4();
  private q = new Vector4();
  private eye = new Vector3();
  private dir = new Vector3();
  private up = new Vector3();
  private look = new Vector3();
  /** A black for each kind of mesh, front sided and then double sided: one program each, so a mesh's turn does not look its program up again. */
  private blacks = [FrontSide, DoubleSide].flatMap((side) => Array.from({ length: KINDS }, () => new MeshBasicMaterial({ color: 0, side })));

  /** Starts linking the blacks' programs (`compile.ts`), for the room's `scene`, whose lights are in their keys. */
  startPrograms(r: WebGLRenderer, scene: Scene): Program[] {
    const root = new Group(), g = new PlaneGeometry(1, 1);
    this.blacks.forEach((m, i) => {
      const kind = i % KINDS, o = kind ? new InstancedMesh(g, m, 1) : new Mesh(g, m);
      if (kind === 2) (o as InstancedMesh).instanceColor = new InstancedBufferAttribute(new Float32Array(3), 3);
      root.add(o);
    });
    const out = startPrograms(r, root, this.cam, { scene });
    g.dispose();
    return out;
  }

  /** Draw the room as the glass (a plane through `at`, its normal `n` toward the room) shows it to `camera`. False when the eye is behind the glass. */
  draw(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, at: Vector3, n: Vector3, fw: number, fh: number): boolean {
    const { cam, eye, dir, up, look, plane, clip, q } = this;
    camera.getWorldPosition(eye);
    const side = eye.clone().sub(at).dot(n);
    if (side <= 0) return false;
    camera.getWorldDirection(dir);
    up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(cam.quaternion));
    // the eye, where it looks and which way is up, each mirrored in the glass
    cam.position.copy(eye).addScaledVector(n, -2 * side);
    look.copy(eye).add(dir);
    look.addScaledVector(n, -2 * look.clone().sub(at).dot(n));
    cam.up.copy(up).addScaledVector(n, -2 * up.dot(n));
    cam.lookAt(look);
    cam.near = camera.near; cam.far = camera.far;
    cam.layers.mask = camera.layers.mask;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    this.uvOf.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // the near plane tilted onto the glass (Lengyel's oblique projection)
    plane.setFromNormalAndCoplanarPoint(n, at).applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = cam.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]!) / p[0]!, (Math.sign(clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const w = Math.max(1, Math.round(fw * SCALE)), h = Math.max(1, Math.round(fh * SCALE));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType });
    }
    renderer.setRenderTarget(this.target);
    renderer.clear();
    const lit = glowOnly(scene, this.blacks);
    renderer.render(scene, cam);
    lit();
    return true;
  }

  dispose(): void { this.target?.dispose(); for (const m of this.blacks) m.dispose(); }
}
