// Mesh builders of the 3D scene. The layout is 2D with y down (`layout.ts`): a rect of it plus a depth range is a box in the world, x east, y up, z out of the wall.
import {
  BoxGeometry, CanvasTexture, CatmullRomCurve3, CylinderGeometry, DynamicDrawUsage, InstancedMesh, Mesh, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TubeGeometry, Vector3,
  type BufferGeometry, type Material, type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface RectLike { x: number; y: number; w: number; h: number }

export function place<T extends Object3D>(o: T, shadow = true): T {
  if (shadow) { o.castShadow = true; o.receiveShadow = true; }
  return o;
}

/** A sharp box over a layout rect, from depth z0 to z1. */
export function rectBox(r: RectLike, z0: number, z1: number, m: Material): Mesh {
  const g = new BoxGeometry(r.w, r.h, z1 - z0), o = new Mesh(g, m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), (z0 + z1) / 2);
  return place(o);
}

/** The same box with soft edges: the room's stylised look (a low segment count keeps the triangles down). */
export function softBox(r: RectLike, z0: number, z1: number, m: Material, radius = 40): Mesh {
  const rad = Math.min(radius, r.w / 2.01, r.h / 2.01, (z1 - z0) / 2.01);
  const g = new RoundedBoxGeometry(r.w, r.h, z1 - z0, 2, rad), o = new Mesh(g, m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), (z0 + z1) / 2);
  return place(o);
}

/** A cylinder standing on the layout point (x, y): its axis is world y. `y` is its base. */
export function post(x: number, y: number, z: number, r: number, h: number, m: Material, sides = 16, rTop = r): Mesh {
  const o = new Mesh(new CylinderGeometry(rTop, r, h, sides), m);
  o.position.set(x, -y + h / 2, z);
  return place(o);
}

/** A disc-like cylinder facing the viewer (its axis is world z), centred on the layout point. */
export function drum(x: number, y: number, z0: number, z1: number, r: number, m: Material, sides = 24): Mesh {
  const o = new Mesh(new CylinderGeometry(r, r, z1 - z0, sides), m);
  o.rotation.x = Math.PI / 2;
  o.position.set(x, -y, (z0 + z1) / 2);
  return place(o);
}

/** A flat quad facing the viewer over a layout rect, at depth z. */
export function face(r: RectLike, z: number, m: Material): Mesh {
  const o = new Mesh(new PlaneGeometry(r.w, r.h), m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z);
  return o;
}

/** A straight rod from world point a to b (a lamp arm, a pipe run). */
export function rod(a: readonly [number, number, number], b: readonly [number, number, number], r: number, m: Material, sides = 10): Mesh {
  const va = new Vector3(...a), vb = new Vector3(...b), len = va.distanceTo(vb);
  const o = new Mesh(new CylinderGeometry(r, r, len, sides), m);
  o.position.copy(va).add(vb).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vb.sub(va).normalize());
  return place(o);
}

/** A tube through 3D points (a cable, a lamp arm): a smooth curve, few sides. */
export function tube(points: readonly (readonly [number, number, number])[], radius: number, m: Material, sides = 7): Mesh {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const o = new Mesh(new TubeGeometry(curve, Math.max(8, points.length * 3), radius, sides, false), m);
  return place(o);
}

/** Keep every `step`-th point of a long path, always with its two ends: a dense 2D lane becomes a cheap tube. */
export function thin<T>(pts: readonly T[], step: number): T[] {
  const out = pts.filter((_, i) => i % step === 0);
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]!);
  return out;
}

/** Many copies of one geometry in one draw call. `at` gives each copy's position, and optionally its scale. */
export function instanced(g: BufferGeometry, m: Material, items: readonly { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number }[]): InstancedMesh {
  const o = new InstancedMesh(g, m, items.length), d = new Object3D();
  o.instanceMatrix.setUsage(DynamicDrawUsage);
  items.forEach((it, i) => {
    d.position.set(it.x, it.y, it.z);
    d.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    d.updateMatrix();
    o.setMatrixAt(i, d.matrix);
  });
  o.instanceMatrix.needsUpdate = true;
  return place(o);
}

/** A texture painted on a canvas, or null where no canvas exists (the tests run without a DOM). */
export function paint(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): Texture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** A soft dark blob: the baked contact shadow under a thing that stands on a surface. */
let blobTex: Texture | null = null;
export function shadowBlob(): Texture | null {
  return blobTex ??= paint(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(20,10,4,0.55)'); g.addColorStop(0.55, 'rgba(20,10,4,0.28)'); g.addColorStop(1, 'rgba(20,10,4,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

/** Free the geometries and the materials under `root`. Textures shared between rebuilds stay alive unless `textures` is set. */
export function disposeTree(root: Object3D, textures = false): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose?.();
    const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const x of ms) {
      if (textures) (x as Material & { map?: Texture | null }).map?.dispose();
      x.dispose();
    }
  });
}
