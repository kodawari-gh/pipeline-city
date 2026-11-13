// Mesh builders of the 3D scene. The layout is 2D with y down (`layout.ts`): a rect of it plus a depth range is a box in the world, x east, y up, z out of the wall.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, CylinderGeometry, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, Group, InstancedMesh, Mesh, Object3D, Path, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, Shape, ShapeUtils, SphereGeometry, TubeGeometry, Vector3, type ExtrudeGeometryOptions, type Material, type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface RectLike { x: number; y: number; w: number; h: number }

/** The anisotropic filtering of every painted or baked texture (the graphics settings; a new texture takes it, `refilter` moves the old ones). */
export let anisotropy = 8;

/** A new filtering for every canvas texture under `root`. Each is sent to the GPU again, so this is for a settings change, not for a frame. */
export function refilter(root: Object3D, n: number): void {
  anisotropy = n;
  const done = new Set<Texture>();
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(x)) {
      const t = v as CanvasTexture | null;
      if (!t?.isCanvasTexture || done.has(t)) continue;
      done.add(t);
      t.anisotropy = n;
      t.needsUpdate = true;
    }
  });
}

export function place<T extends Object3D>(o: T, shadow = true): T {
  if (shadow) { o.castShadow = true; o.receiveShadow = true; }
  return o;
}

/**
 * Give a grid surface's closed rows (where it comes to a point, `cols` vertices a row) the normals of the row next to them: a parametric
 * surface gets a zero normal there, and a zero normal turns the whole frame black (it is NaN in the shader, and the post passes spread it).
 */
export function healNormals<T extends BufferGeometry>(g: T, cols: number): T {
  const n = g.attributes.normal!, ok = (i: number) => i >= 0 && i < n.count && Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.5;
  for (let i = 0; i < n.count; i++) {
    if (ok(i)) continue;
    const j = ok(i - cols) ? i - cols : i + cols;
    if (ok(j)) n.setXYZ(i, n.getX(j), n.getY(j), n.getZ(j));
  }
  return g;
}

/** A sharp box over a layout rect, from depth z0 to z1. */
export function rectBox(r: RectLike, z0: number, z1: number, m: Material): Mesh {
  const g = new BoxGeometry(r.w, r.h, z1 - z0), o = new Mesh(g, m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), (z0 + z1) / 2);
  return place(o);
}

/**
 * Give a box's faces uvs from where they are, `tile` units to a texture's width, not 0 to 1 a face: the texture keeps one size on boxes of
 * every size and runs on across boxes that meet. Each face takes the two axes along it. For a mesh that is moved, not turned or scaled.
 */
export function worldUv<T extends Mesh>(o: T, tile: number): T {
  const g = o.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv'), at = o.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + at.x, y = p.getY(i) + at.y, z = p.getZ(i) + at.z, ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
  return o;
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

/** A polyline with each inner corner cut by a round of radius `r` (a few points along the arc): a bent pipe for `tube`, tight at its bends. */
export function rounded(pts: readonly (readonly [number, number, number])[], r: number, per = 5): [number, number, number][] {
  const v = pts.map((p) => new Vector3(p[0], p[1], p[2])), out: [number, number, number][] = [[pts[0]![0], pts[0]![1], pts[0]![2]]];
  for (let i = 1; i + 1 < v.length; i++) {
    const p = v[i]!, a = v[i - 1]!.clone().sub(p), b = v[i + 1]!.clone().sub(p);
    const k = Math.min(r, a.length() / 2, b.length() / 2), s = p.clone().addScaledVector(a.normalize(), k), e = p.clone().addScaledVector(b.normalize(), k);
    // a quadratic bend from the cut on the way in to the cut on the way out, the corner as its control point
    for (let j = 0; j <= per; j++) {
      const t = j / per, q = s.clone().multiplyScalar((1 - t) ** 2).addScaledVector(p, 2 * t * (1 - t)).addScaledVector(e, t * t);
      out.push([q.x, q.y, q.z]);
    }
  }
  const l = pts[pts.length - 1]!;
  out.push([l[0], l[1], l[2]]);
  return out;
}

/** Keep every `step`-th point of a long path, always with its two ends: a dense 2D lane becomes a cheap tube. */
export function thin<T>(pts: readonly T[], step: number): T[] {
  const out = pts.filter((_, i) => i % step === 0);
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]!);
  return out;
}

/** Many copies of one geometry in one draw call. Each item gives its copy's position, and optionally its scale and its turn round z (`rz`). */
export function instanced(g: BufferGeometry, m: Material, items: readonly { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; rz?: number }[]): InstancedMesh {
  const o = new InstancedMesh(g, m, items.length), d = new Object3D();
  o.instanceMatrix.setUsage(DynamicDrawUsage);
  items.forEach((it, i) => {
    d.position.set(it.x, it.y, it.z);
    d.rotation.z = it.rz ?? 0;
    d.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    d.updateMatrix();
    o.setMatrixAt(i, d.matrix);
  });
  o.instanceMatrix.needsUpdate = true;
  return place(o);
}

/**
 * One fan blade round the z axis, from radius `r0` to `r1`: a thin plate whose chord runs along the turn, tilted out of the plane by its pitch
 * (steep at the root, flatter at the tip), swept forward toward a rounded tip and cupped across the chord. One surface: draw it double-sided.
 */
export function fanBlade(r0: number, r1: number, chord: number, o: { sweep?: number; pitch?: number; cup?: number; seg?: number } = {}): BufferGeometry {
  const seg = o.seg ?? 10, sweep = o.sweep ?? 0.5, pitch = o.pitch ?? 0.6, cup = o.cup ?? 0.12, across = 5;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, R = r0 + (r1 - r0) * t, th = sweep * t * t, p = pitch * (1 - 0.45 * t);
    const c = chord * (0.75 + 0.5 * t) * Math.sqrt(Math.max(0.08, 1 - (Math.max(0, t - 0.75) / 0.25) ** 2));
    const ux = Math.cos(th), uy = Math.sin(th);
    for (let j = 0; j < across; j++) {
      const s = j / (across - 1) - 0.5, along = s * c, lift = cup * c * (0.25 - s * s);
      pos.push(R * ux - uy * along * Math.cos(p), R * uy + ux * along * Math.cos(p), along * Math.sin(p) + lift);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < across - 1; j++) {
    const a = i * across + j, c = a + across;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A fan's rotor round the z axis (radius `r`, `n` blades): a domed hub with a badge ring and curved blades. It spins by its `rotation.z`.
 * `chord`: the blades' width in parts of `r`; `pitch`: their tilt (`fanBlade`).
 */
export function fanRotor(r: number, n: number, blade: Material, hub: Material, o: { chord?: number; pitch?: number } = {}): Group {
  const rotor = new Group(), hr = r * 0.3;
  const hubM = new Mesh(new CylinderGeometry(hr, hr, r * 0.22, 28).rotateX(Math.PI / 2), hub);
  const dome = new Mesh(new SphereGeometry(hr, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.35), hub);
  dome.position.z = r * 0.11;
  rotor.add(place(hubM), place(dome));
  const g = fanBlade(hr * 0.92, r * 0.97, r * (o.chord ?? 0.62), o.pitch === undefined ? {} : { pitch: o.pitch });
  for (let k = 0; k < n; k++) {
    const b = place(new Mesh(g, blade));
    b.rotation.z = (k / n) * Math.PI * 2;
    rotor.add(b);
  }
  return rotor;
}

/** A fan's throat radius and how far off its axis its four screws stand (along x and y), in parts of its width: the same on every size, as on a real fan. */
export const FAN_THROAT = 0.475, FAN_SCREW = 0.4375;

/**
 * A fan's flange round the z axis (centred, `t` thick), for a fan `d` wide: a square plate with rounded corners, a round throat and a screw hole in
 * each corner. A case's fan mount is the same plate, `w` wide, so its holes meet the fan's.
 */
export function fanFlange(d: number, t: number, w = d): BufferGeometry {
  const h = w / 2, c = w * 0.07, b = Math.min(t * 0.2, d * 0.006), s = new Shape();
  s.moveTo(-h + c, -h).lineTo(h - c, -h).absarc(h - c, -h + c, c, -Math.PI / 2, 0, false);
  s.lineTo(h, h - c).absarc(h - c, h - c, c, 0, Math.PI / 2, false);
  s.lineTo(-h + c, h).absarc(-h + c, h - c, c, Math.PI / 2, Math.PI, false);
  s.lineTo(-h, -h + c).absarc(-h + c, -h + c, c, Math.PI, Math.PI * 1.5, false);
  const throat = new Path();
  throat.absarc(0, 0, d * FAN_THROAT, 0, Math.PI * 2, true);
  s.holes.push(throat);
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const p = new Path();
    p.absarc(x * d * FAN_SCREW, y * d * FAN_SCREW, d * 0.022, 0, Math.PI * 2, true);
    s.holes.push(p);
  }
  return extrude(s, { depth: t - 2 * b, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 48 }).translate(0, 0, -t / 2 + b);
}

/**
 * A shape extruded, its holes wound against its outline first. ExtrudeGeometry turns a hole only when it turns the outline: a hole that winds
 * the same way as a clockwise outline gets walls that face into the material, so they are culled and the background shows through the
 * opening's sides. Every extrusion with holes goes through here.
 */
export function extrude(s: Shape, o: ExtrudeGeometryOptions = {}): ExtrudeGeometry {
  const seg = o.curveSegments ?? 12, cw = ShapeUtils.isClockWise(s.getPoints(seg));
  s.holes = s.holes.map((h) => {
    const p = h.getPoints(seg);
    return ShapeUtils.isClockWise(p) === cw ? new Path(p.reverse()) : h;
  });
  return new ExtrudeGeometry(s, o);
}

/** A texture painted on a canvas, or null where no canvas exists (the tests run without a DOM). */
export function paint(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): Texture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Textures that outlive the rebuild that made them (the caches): `disposeTree` leaves them alive. */
const shared = new WeakSet<Texture>();
/** Marks a cached texture as shared (`shareTex(paint(...))`); a null passes through. */
export function shareTex<T extends Texture | null | undefined>(t: T): T {
  if (t) shared.add(t);
  return t;
}

/** A soft dark blob: the baked contact shadow under a thing that stands on a surface. */
let blobTex: Texture | null = null;
export function shadowBlob(): Texture | null {
  return blobTex ??= shareTex(paint(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(20,10,4,0.55)'); g.addColorStop(0.55, 'rgba(20,10,4,0.28)'); g.addColorStop(1, 'rgba(20,10,4,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }));
}

/**
 * Free the geometries and the materials under `root`, and every texture on them (each material slot: `map`, `normalMap`...) that is not shared
 * (`shareTex`). `textures` frees the shared ones too.
 */
export function disposeTree(root: Object3D, textures = false): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose?.();
    const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const x of ms) {
      for (const v of Object.values(x)) {
        const t = v as Texture | null;
        if (t?.isTexture && (textures || !shared.has(t))) t.dispose();
      }
      x.dispose();
    }
  });
}
