import {
  Box3,
  BufferAttribute,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it } from 'vitest';
import type { Room } from '@/core/render/three/camera';
import { setLowDetail } from '@/core/render/three/detail';
import { MONITOR } from '@/features/board/render/layout/layout';
import { roomGeo } from '../shell/room';
import { mess } from './clutter3d';
import { bed } from './furniture/bed';
import { SPINE_ROUND } from './furniture/books';
import { bookcase } from './furniture/bookcase';
import { eastWall } from './furniture/eastwall';
import { nightstand } from './furniture/lanterns';
import { OAK_ROUGH, OAK_TILE } from './furniture/oak';
import { EDGE_R, PILLOW_WELT, pillow } from './furniture/shapes';
import { OAK } from './palette';
import { floorPlant } from './plants3d';
import { KEY_LEAD } from './props3d';
import { deskSlab, drawerUnit, oakFloor } from './room3d';
import {
  BED,
  BOOKCASE,
  DESK_TOP,
  EAST_X,
  FIG_AT,
  FLOOR_Y,
  MONITOR_Z,
  PED,
  RUG,
  WEST_X,
  eyeBlocks,
  eyeRoom,
} from './roomplan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A decal (a contact shadow on the floor): drawn over what is under it, not a thing. */
const decal = (m: Mesh) => [m.material].flat().every((x) => !x.depthWrite);

/** Whether the object is a mesh (an instanced one too). */
const isMesh = (o: threeTypes.Object3D): o is Mesh => o instanceof Mesh;

/** Whether the object is an instanced mesh. */
const isInstanced = (o: threeTypes.Object3D): o is threeTypes.InstancedMesh => o instanceof InstancedMesh;

/** A thing's plain meshes: neither instanced nor a decal. */
const isPlain = (o: threeTypes.Object3D): o is Mesh => isMesh(o) && !isInstanced(o) && !decal(o);

/** The meshes among the object's children with that name. */
const meshesNamed = (o: threeTypes.Object3D, n: string): Mesh[] =>
  o.children.filter((c): c is Mesh => isMesh(c) && c.name === n);

/** The vertices of the meshes under `o` where they stand (each instance too), every `step`-th one; not the decals. */
function vertices(o: threeTypes.Object3D, step = 1): Vector3[] {
  o.updateMatrixWorld(true);
  const out: Vector3[] = [],
    m = new Matrix4();
  o.traverse((mesh) => {
    if (!isMesh(mesh) || decal(mesh)) {
      return;
    }
    const p = must(mesh.geometry.attributes['position']),
      inst = isInstanced(mesh) ? mesh : null;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      if (inst) {
        inst.getMatrixAt(k, m);
      } else {
        m.identity();
      }
      m.premultiply(mesh.matrixWorld);
      for (let i = 0; i < p.count; i += step) {
        out.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
      }
    }
  });
  return out;
}

const inBox = (p: Vector3, b: Room, pad = 0) =>
  p.x >= b.x0 - pad &&
  p.x <= b.x1 + pad &&
  p.y >= b.y0 - pad &&
  p.y <= b.y1 + pad &&
  p.z >= b.z0 - pad &&
  p.z <= b.z1 + pad;
const short = (ps: Vector3[]) =>
  ps
    .slice(0, 3)
    .map((p) =>
      p
        .toArray()
        .map((v) => Math.round(v))
        .join(','),
    )
    .join(' | ');

/** The points within `reach` of the eye's room that lie in none of the boxes the eye keeps out of. */
const loosePoints = (ps: Vector3[], eye: { room: Room; reach: number; blocks: Room[] }) =>
  ps.filter((p) => inBox(p, eye.room, eye.reach) && !eye.blocks.some((b) => inBox(p, b, 1)));

/** The box round the vertices of the meshes under `o`. */
const pointsBox = (o: threeTypes.Object3D) => new Box3().setFromPoints(vertices(o));

/** The box round an object where it stands (its geometry exactly). */
const objBox = (m: threeTypes.Object3D) => new Box3().setFromObject(m, true);

/** Is p inside the box by more than `pad` on every side? */
const deepIn = (p: Vector3, f: Box3, pad: number) =>
  p.x > f.min.x + pad &&
  p.x < f.max.x - pad &&
  p.y > f.min.y + pad &&
  p.y < f.max.y - pad &&
  p.z > f.min.z + pad &&
  p.z < f.max.z - pad;

/** The ordered pairs (i, j) of different objects whose boxes meet. */
function meeting(os: threeTypes.Object3D[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < os.length; i++) {
    for (let j = 0; j < os.length; j++) {
      if (i !== j && objBox(must(os[i])).intersectsBox(objBox(must(os[j])))) {
        out.push([i, j]);
      }
    }
  }
  return out;
}

/** A pillow's vertices as fractions of its half width (x) and half depth (z), its height (y) as it is; and its squarest corner (x + z). */
function pillowShape(
  p: threeTypes.BufferAttribute | threeTypes.InterleavedBufferAttribute,
  w: number,
  d: number,
): { corner: number; outline: { x: number; y: number; z: number }[] } {
  let corner = 0;
  const outline: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)) / (w / 2),
      y = Math.abs(p.getY(i)),
      z = Math.abs(p.getZ(i)) / (d / 2);
    // a square corner reaches x + z = 2
    corner = Math.max(corner, x + z);
    // the outline: the ends and the sides
    if (x > 0.985 || z > 0.985) {
      outline.push({ x, y, z });
    }
  }
  return { corner, outline };
}

/** The bookcase's covers: one instanced draw per spine design, the spine's map and the boards (an array of materials; the page blocks have one). */
function covers(): threeTypes.InstancedMesh[] {
  const out: threeTypes.InstancedMesh[] = [];
  bookcase().traverse((o) => {
    if (isInstanced(o) && Array.isArray(o.material)) {
      out.push(o);
    }
  });
  return out;
}

// each book as a rectangle across the shelf (z along it, y up): its centre, half sizes and its lean round x
interface B {
  z: number;
  y: number;
  hz: number;
  hy: number;
  lean: number;
}
const shelved = (): B[] =>
  covers().flatMap((m) =>
    Array.from({ length: m.count }, (_, i) => {
      const at = new Matrix4(),
        p = new Vector3(),
        q = new Quaternion(),
        s = new Vector3();
      m.getMatrixAt(i, at);
      at.decompose(p, q, s);
      return { z: p.z, y: p.y, hz: s.z / 2, hy: s.y / 2, lean: 2 * Math.atan2(q.x, q.w) };
    }),
  );
// the book's own axes in (z, y): its thickness and its height
const axes = (b: B) =>
  [
    [Math.cos(b.lean), -Math.sin(b.lean)],
    [Math.sin(b.lean), Math.cos(b.lean)],
  ] as const;
const reachAlong = (b: B, u: readonly number[]) => {
  const [t, h] = axes(b);
  assert.exists(u[0]);
  assert.exists(u[1]);
  return b.hz * Math.abs(t[0] * u[0] + t[1] * u[1]) + b.hy * Math.abs(h[0] * u[0] + h[1] * u[1]);
};
/** How deep two books go into each other (separating axes; 0 or less: apart). */
const depth = (a: B, b: B) =>
  Math.min(
    ...[...axes(a), ...axes(b)].map((u) => {
      const ca = a.z * u[0] + a.y * u[1],
        cb = b.z * u[0] + b.y * u[1];
      return (
        Math.min(ca + reachAlong(a, u), cb + reachAlong(b, u)) - Math.max(ca - reachAlong(a, u), cb - reachAlong(b, u))
      );
    }),
  );
const foot = (b: B) => b.y - reachAlong(b, [0, 1]);

/** Each cover's groups, materials and triangles, at Low or at High. */
function coverStats(low: boolean): { groups: number; mats: number; tris: number }[] {
  setLowDetail(low);
  try {
    return covers().map((m) => ({
      groups: m.geometry.groups.length,
      mats: [m.material].flat().length,
      tris: m.geometry.groups.reduce((n, g) => n + g.count / 3, 0),
    }));
  } finally {
    setLowDetail(false);
  }
}

/** Whether every cover has `n` groups and `n` materials. */
const allOf = (cs: { groups: number; mats: number }[], n: number) => cs.every((c) => c.groups === n && c.mats === n);

/** The spine's arc across the book: its height above the boards (x past 0.5) at each z, in order of z. */
function spineArc(p: threeTypes.BufferAttribute | threeTypes.InterleavedBufferAttribute): [number, number][] {
  const arc = new Map<number, number>();
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) > 0.49) {
      arc.set(Math.round(p.getZ(i) * 1e4) / 1e4, p.getX(i) - 0.5);
    }
  }
  return [...arc].toSorted((a, b) => a[0] - b[0]);
}

/** Whether a book leans a little: neither upright nor lying down. */
const isLeant = (b: { lean: number }) => Math.abs(b.lean) > 1e-6 && Math.abs(b.lean) < 1;

/**
 * A box's round on its +x +y edge: from how far out its farthest point along that diagonal lies (a square edge: 0), and how many
 * normals turn it (each a step of the round).
 */
function roundOf(m: Mesh): { r: number; steps: number; thin: number } {
  const g = m.geometry,
    p = must(g.attributes['position']),
    n = must(g.attributes['normal']),
    steps = new Set<number>();
  g.computeBoundingBox();
  const c = must(g.boundingBox).getCenter(new Vector3()),
    h = must(g.boundingBox).getSize(new Vector3()).multiplyScalar(0.5);
  let far = -Infinity;
  for (let i = 0; i < p.count; i++) {
    far = Math.max(far, p.getX(i) - c.x + p.getY(i) - c.y);
    if (Math.abs(n.getZ(i)) < 0.01 && n.getX(i) > 0.01 && n.getY(i) > 0.01) {
      const angle = Math.atan2(n.getY(i), n.getX(i));
      steps.add(Math.round(angle * 1000));
    }
  }
  return { r: (h.x + h.y - far) / (2 - Math.SQRT2), steps: steps.size, thin: Math.min(h.x, h.y, h.z) };
}

/** The volume of the box round a mesh's geometry. */
function volumeOf(m: Mesh): number {
  const pos = m.geometry.attributes['position'];
  assert.instanceOf(pos, BufferAttribute);
  const s = new Box3().setFromBufferAttribute(pos).getSize(new Vector3());
  return s.x * s.y * s.z;
}

/** The biggest plain mesh (not instanced) under `o`, by the volume of its geometry's box. */
function biggest(o: threeTypes.Object3D): Mesh {
  const ms: Mesh[] = [];
  o.traverse((c) => {
    if (isMesh(c) && !isInstanced(c)) {
      ms.push(c);
    }
  });
  const [first] = ms.toSorted((p, q) => volumeOf(q) - volumeOf(p));
  assert.exists(first);
  return first;
}

/** The bookcase's boards: its sides, its back, its shelves and its plinth (all that runs most of its height or its depth). */
function boardsOf(o: threeTypes.Object3D): Mesh[] {
  const tall = BOOKCASE.z1 - BOOKCASE.z0,
    high = FLOOR_Y - BOOKCASE.top,
    boards: Mesh[] = [];
  o.traverse((c) => {
    const s = new Box3().setFromObject(c, true).getSize(new Vector3());
    if (isPlain(c) && (s.y > 0.8 * high || s.z > 0.8 * tall)) {
      boards.push(c);
    }
  });
  return boards;
}

/** Whether the mesh is of the palette's one oak. */
const isOak = (m: Mesh) => {
  const s = m.material;
  return s instanceof MeshStandardMaterial && s.color.getHexString() === OAK.slice(1) && s.roughness === OAK_ROUGH;
};

/** How far u runs over the face whose normal is along `axis` (0 x, 1 y, 2 z). */
const span = (m: Mesh, axis: number) => {
  const { uv, normal } = m.geometry.attributes,
    us: number[] = [];
  for (let i = 0; i < must(uv).count; i++) {
    assert.exists(normal);
    if (Math.abs(normal.getComponent(i, axis)) > 0.99) {
      assert.exists(uv);
      us.push(uv.getX(i));
    }
  }
  return Math.max(...us) - Math.min(...us);
};

/** A mesh where it stands, both faces of each triangle hit by a ray. */
function solid(m: Mesh): Mesh {
  m.updateMatrixWorld(true);
  return new Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld), new MeshBasicMaterial({ side: DoubleSide }));
}
const RAYS = [new Vector3(0.31, 0.83, 0.47).normalize(), new Vector3(-0.62, 0.27, -0.74).normalize()];
/** Is p inside the closed mesh? An odd count of crossings on two rays out of it. */
const within = (p: Vector3, m: Mesh) =>
  RAYS.every((d) => new Raycaster(p, d).intersectObject(m, false).length % 2 === 1);

/** How far p is outside a box with rounded edges (negative: inside it). */
function outside(p: Vector3, b: Box3, r: number): number {
  const c = b.getCenter(new Vector3()),
    h = b.getSize(new Vector3()).multiplyScalar(0.5);
  const q = [Math.abs(p.x - c.x) - (h.x - r), Math.abs(p.y - c.y) - (h.y - r), Math.abs(p.z - c.z) - (h.z - r)];
  return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - r;
}

describe('3D furniture', () => {
  it('lies inside the boxes the eye keeps out of, wherever the eye or its near plane could reach', () => {
    const g = roomGeo(),
      blocks = eyeBlocks(g),
      r = eyeRoom(),
      reach = 2500;
    const kx = MONITOR.x + MONITOR.w / 2,
      kz = MONITOR_Z + 3600;
    const pack = mess(g.desk.x1 - PED.in, g.ys + DESK_TOP, {
      x: kx + KEY_LEAD[0],
      z: kz + KEY_LEAD[1],
    }).getObjectByName('backpack');
    assert.exists(pack);
    const pieces: Record<string, threeTypes.Object3D> = {
      bed: bed().root,
      nightstand: nightstand().root,
      bookcase: bookcase(),
      fig: floorPlant(FIG_AT.x, FIG_AT.z),
      shelf: eastWall(),
      backpack: pack,
    };
    for (const [name, o] of Object.entries(pieces)) {
      const loose = loosePoints(vertices(o, 2), { room: r, reach, blocks });
      expect(loose, `${name}: ${short(loose)}`).toHaveLength(0);
    }
  });

  it('keeps the plants out of the walls', () => {
    expect(pointsBox(eastWall()).max.x).toBeLessThanOrEqual(EAST_X + 1);
    expect(pointsBox(bookcase()).min.x).toBeGreaterThanOrEqual(WEST_X - 1);
    expect(pointsBox(floorPlant(FIG_AT.x, FIG_AT.z)).min.x).toBeGreaterThan(WEST_X);
  });

  describe('the bed', () => {
    const b = bed().root;
    b.updateMatrixWorld(true);
    const [mattress] = meshesNamed(b, 'mattress'),
      [duvet] = meshesNamed(b, 'duvet'),
      [runner] = meshesNamed(b, 'runner'),
      pillows = meshesNamed(b, 'pillow');
    const frame = [...meshesNamed(b, 'headboard'), ...meshesNamed(b, 'platform')].map((m) => objBox(m));
    // (the mattress's rounded edge, `bed()`)
    const mBox = objBox(must(mattress)),
      mR = 700;

    it('lays the duvet, the runner and the pillows over the mattress and the frame, never into them', () => {
      assert.exists(duvet);
      assert.exists(runner);
      for (const [name, m] of [
        ['duvet', duvet],
        ['runner', runner],
        ...pillows.map((p, i) => [`pillow ${i}`, p] as const),
      ] as const) {
        const vs = vertices(m);
        const inMattress = vs.filter((p) => outside(p, mBox, mR) < -5);
        expect(inMattress, `${name} in the mattress: ${short(inMattress)}`).toHaveLength(0);
        const inFrame = vs.filter((p) => frame.some((f) => deepIn(p, f, 5)));
        expect(inFrame, `${name} in the frame: ${short(inFrame)}`).toHaveLength(0);
      }
    });

    it('hangs the duvet clear of the floor and the rug', () => {
      assert.exists(duvet);
      expect(objBox(duvet).min.y).toBeGreaterThan(-(FLOOR_Y - RUG.h) + 1000);
      expect(objBox(duvet).max.z).toBeLessThan(BED.z1 + 2000);
    });

    it('lays the runner on the duvet, not in it', () => {
      // (the test's own check: the mattress's middle is in the mattress)
      assert.exists(mattress);
      const middle = mBox.getCenter(new Vector3());
      expect(within(middle, solid(mattress))).toBe(true);
      const d = solid(must(duvet)),
        sunk = vertices(must(runner), 9).filter((p) => within(p, d));
      expect(sunk, `the runner in the duvet: ${short(sunk)}`).toHaveLength(0);
    });

    it('stands the pillows two by two, the front ones leant on the back ones, none in another', () => {
      expect(pillows).toHaveLength(4);
      const solids = pillows.map((p) => solid(p));
      for (const [i, j] of meeting(pillows)) {
        const other = must(solids[j]);
        const sunk = vertices(must(pillows[i]), 3).filter((p) => within(p, other));
        expect(sunk, `pillow ${i} in pillow ${j}: ${short(sunk)}`).toHaveLength(0);
      }
      // the front ones lean back on the back ones: they touch
      for (const [f, k] of [
        [2, 0],
        [3, 1],
      ] as const) {
        const pillow3 = pillows[f];
        assert.exists(pillow3);
        expect(objBox(pillow3).min.z).toBeLessThan(objBox(must(pillows[k])).max.z);
      }
    });
  });

  it('sews a pillow soft: round corners, its panels down to a thin welt at the seam, no flat band round it', () => {
    const w = 14_000,
      h = 3000,
      d = 7200,
      p = must(pillow([w, h, d]).attributes['position']);
    const { corner, outline } = pillowShape(p, w, d);
    // at the outline (the ends and the sides) it is no thicker than the welt
    for (const { x, y, z } of outline) {
      expect(y, `${x.toFixed(3)},${z.toFixed(3)}`).toBeLessThanOrEqual((PILLOW_WELT * h) / 2 + 1);
    }
    expect(corner).toBeLessThan(1.75);
  });

  describe('the books', () => {
    // the covers (`covers`) are built in the tests, not here: the plants draw from one stream of numbers, and a bookcase built first would
    // change the vines the tests above see.

    it('draws a cover in two groups at Low (the spine, the boards), not four (CITY-06): the hidden top and foot have none', () => {
      const high = coverStats(false),
        low = coverStats(true);
      expect(allOf(high, 6)).toBe(true);
      expect(allOf(low, 2)).toBe(true);
      // (the hidden top and foot are 24 triangles each; the four shown faces are the same ones)
      expect(low.map((c) => c.tris)).toStrictEqual(high.map((c) => c.tris - 48));
    });

    it('rounds each spine across the book: from the boards to its middle, an even arc', () => {
      const [cover] = covers();
      const pts = spineArc(must(must(cover).geometry.attributes['position']));
      expect(pts.length).toBeGreaterThanOrEqual(9);
      assert.exists(pts[0]);
      expect(pts[0][1]).toBeCloseTo(0, 4);
      const lastPts = pts.at(-1);
      assert.exists(lastPts);
      expect(lastPts[1]).toBeCloseTo(0, 4);
      expect(Math.max(...pts.map((v) => v[1]))).toBeCloseTo(SPINE_ROUND, 4);
      // convex: it rises steepest at the boards and flattens toward the middle
      for (let i = 2; i < pts.length; i++) {
        const s0 = (must(pts[i - 1])[1] - must(pts[i - 2])[1]) / (must(pts[i - 1])[0] - must(pts[i - 2])[0]),
          s1 = (must(pts[i])[1] - must(pts[i - 1])[1]) / (must(pts[i])[0] - must(pts[i - 1])[0]);
        expect(s1).toBeLessThan(s0);
      }
    });

    it('leans a few books a little into the gaps, each on its shelf and none in another', () => {
      const books = shelved(),
        upright = books.filter((b) => Math.abs(b.lean) < 1e-6),
        leant = books.filter((b) => isLeant(b));
      expect(leant.length).toBeGreaterThanOrEqual(4);
      for (const b of leant) {
        expect(Math.abs(b.lean)).toBeLessThan(0.35);
      }
      // a leant book's foot stands on a shelf, as the upright ones do
      const shelves = upright.map((b) => foot(b));
      for (const b of leant) {
        expect(Math.min(...shelves.map((y) => Math.abs(foot(b) - y)))).toBeLessThan(1);
      }
      for (let i = 0; i < books.length; i++) {
        for (let j = i + 1; j < books.length; j++) {
          const book = books[i];
          assert.exists(book);
          const book2 = books[j];
          assert.exists(book2);
          expect(depth(book, book2), `book ${i} in book ${j}`).toBeLessThan(5);
        }
      }
    });
  });

  it("rounds the furniture's edges: the bookcase, the desk top, the drawer unit, the bed frame, the bedside drawer", () => {
    const b = bed().root,
      named = (n: string) => must(meshesNamed(b, n)[0]);
    const cases: [string, Mesh][] = [
      ['desk top', deskSlab(roomGeo())],
      ['drawer unit', must(drawerUnit(roomGeo())[0])],
      ['headboard', named('headboard')],
      ['platform', named('platform')],
      ['bedside drawer', biggest(nightstand().root)],
    ];
    for (const board of boardsOf(bookcase())) {
      cases.push(['a bookcase board', board]);
    }
    for (const [name, m] of cases) {
      const { r, steps, thin } = roundOf(m);
      expect(r, `${name}: its round`).toBeCloseTo(Math.min(EDGE_R, (2 * thin) / 2.01), -1);
      // four steps each side of the diagonal (two read as a hard corner)
      expect(steps, `${name}: its steps`).toBeGreaterThanOrEqual(7);
    }
  });

  it("makes the floor, the desk top and the bookcase of the palette's one oak, its grain along each board", () => {
    const g = roomGeo(),
      desk = deskSlab(g);
    expect(isOak(oakFloor()), 'the floor').toBe(true);
    expect(isOak(desk), 'the desk top').toBe(true);
    // the grain runs the desk's length
    expect(span(desk, 1)).toBeCloseTo((g.desk.x1 - g.desk.x0) / OAK_TILE, 1);
    // the bookcase's boards: its sides, its back, its shelves and its plinth (all that runs most of its height or its width)
    const high = FLOOR_Y - BOOKCASE.top,
      boards = boardsOf(bookcase());
    expect(boards.length).toBeGreaterThanOrEqual(10);
    for (const b of boards) {
      expect(isOak(b), `a board of the bookcase, ${b.geometry.type}`).toBe(true);
    }
    // a side's grain stands up it
    const side = boards.find((b) => new Box3().setFromObject(b).getSize(new Vector3()).z < 1000);
    assert.exists(side);
    expect(span(side, 2)).toBeCloseTo(high / OAK_TILE, 1);
  });
});
