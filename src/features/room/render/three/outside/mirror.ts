// The room's own picture in the window's glass at night (`view.ts`): the room drawn from the eye mirrored in the glass, cut off at the glass's
// plane (the camera's near plane tilted to lie on it, so what stands behind the glass does not get in the way), small and in the frame's light.
// The window's quad lays it faintly over the city.
import { HalfFloatType, Matrix4, PerspectiveCamera, Plane, Vector3, Vector4, WebGLRenderTarget, type Scene, type WebGLRenderer } from 'three';

/** The picture's size, as a share of the frame's: it is blurred anyway. */
const SCALE = 0.5;

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
    renderer.render(scene, cam);
    return true;
  }

  dispose(): void { this.target?.dispose(); }
}
