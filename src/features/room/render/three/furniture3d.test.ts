import { Box3, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3, type InstancedMesh, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { Room } from '@/core/render/three/camera';
import { MONITOR } from '@/features/board/render/layout/layout';
import { roomGeo } from '../shell/room';
import { mess } from './clutter3d';
import { OAK_ROUGH, OAK_TILE, bed, bookcase, eastWall, nightstand } from './furniture3d';
import { OAK } from './palette';
import { floorPlant } from './plants3d';
import { KEY_LEAD } from './props3d';
import { deskSlab, oakFloor } from './room3d';
import { BED, BOOKCASE, DESK_TOP, EAST_X, FIG_AT, FLOOR_Y, MONITOR_Z, PED, RUG, WEST_X, eyeBlocks, eyeRoom } from './roomplan';

/** A decal (a contact shadow on the floor): drawn over what is under it, not a thing. */
const decal = (m: Mesh) => [m.material].flat().every((x) => x.depthWrite === false);

/** The vertices of the meshes under `o` where they stand (each instance too), every `step`-th one; not the decals. */
function vertices(o: Object3D, step = 1): Vector3[] {
  o.updateMatrixWorld(true);
  const out: Vector3[] = [], m = new Matrix4();
  o.traverse((c) => {
    const mesh = c as Mesh;
    if (!mesh.isMesh || decal(mesh)) return;
    const p = mesh.geometry.attributes.position!, inst = (c as InstancedMesh).isInstancedMesh ? (c as InstancedMesh) : null;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      if (inst) inst.getMatrixAt(k, m); else m.identity();
      m.premultiply(mesh.matrixWorld);
      for (let i = 0; i < p.count; i += step) out.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
    }
  });
  return out;
}

const inBox = (p: Vector3, b: Room, pad = 0) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad && p.z >= b.z0 - pad && p.z <= b.z1 + pad;
const short = (ps: Vector3[]) => ps.slice(0, 3).map((p) => p.toArray().map(Math.round).join(',')).join(' | ');

/** A mesh where it stands, both faces of each triangle hit by a ray. */
function solid(m: Mesh): Mesh {
  m.updateMatrixWorld(true);
  return new Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld), new MeshBasicMaterial({ side: DoubleSide }));
}
const RAYS = [new Vector3(0.31, 0.83, 0.47).normalize(), new Vector3(-0.62, 0.27, -0.74).normalize()];
/** Is p inside the closed mesh? An odd count of crossings on two rays out of it. */
const within = (p: Vector3, m: Mesh) => RAYS.every((d) => new Raycaster(p, d).intersectObject(m, false).length % 2 === 1);

/** How far p is outside a box with rounded edges (negative: inside it). */
function outside(p: Vector3, b: Box3, r: number): number {
  const c = b.getCenter(new Vector3()), h = b.getSize(new Vector3()).multiplyScalar(0.5);
  const q = [Math.abs(p.x - c.x) - (h.x - r), Math.abs(p.y - c.y) - (h.y - r), Math.abs(p.z - c.z) - (h.z - r)];
  return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - r;
}

describe('3D furniture', () => {
  it('lies inside the boxes the eye keeps out of, wherever the eye or its near plane could reach', () => {
    const g = roomGeo(), blocks = eyeBlocks(g), r = eyeRoom(), reach = 2500;
    const kx = MONITOR.x + MONITOR.w / 2, kz = MONITOR_Z + 3600;
    const pack = mess(g.desk.x1 - PED.in, g.ys + DESK_TOP, { x: kx + KEY_LEAD[0], z: kz + KEY_LEAD[1] }).getObjectByName('backpack')!;
    const pieces: Record<string, Object3D> = {
      bed: bed().root, nightstand: nightstand().root, bookcase: bookcase(), fig: floorPlant(FIG_AT.x, FIG_AT.z), shelf: eastWall(), backpack: pack,
    };
    for (const [name, o] of Object.entries(pieces)) {
      const loose = vertices(o, 2).filter((p) => inBox(p, r, reach) && !blocks.some((b) => inBox(p, b, 1)));
      expect(loose.length, `${name}: ${short(loose)}`).toBe(0);
    }
  });

  it('keeps the plants out of the walls', () => {
    const box = (o: Object3D) => new Box3().setFromPoints(vertices(o));
    expect(box(eastWall()).max.x).toBeLessThanOrEqual(EAST_X + 1);
    expect(box(bookcase()).min.x).toBeGreaterThanOrEqual(WEST_X - 1);
    expect(box(floorPlant(FIG_AT.x, FIG_AT.z)).min.x).toBeGreaterThan(WEST_X);
  });

  describe('the bed', () => {
    const b = bed().root;
    b.updateMatrixWorld(true);
    const named = (n: string) => b.children.filter((c) => c.name === n) as Mesh[];
    const box = (m: Object3D) => new Box3().setFromObject(m, true);
    const [mattress] = named('mattress'), [duvet] = named('duvet'), [runner] = named('runner'), pillows = named('pillow');
    const frame = [...named('headboard'), ...named('platform')].map(box);
    // (the mattress's rounded edge, `bed()`)
    const mBox = box(mattress!), mR = 700;

    it('lays the duvet, the runner and the pillows over the mattress and the frame, never into them', () => {
      for (const [name, m] of [['duvet', duvet!], ['runner', runner!], ...pillows.map((p, i) => [`pillow ${i}`, p] as const)] as const) {
        const vs = vertices(m);
        const inMattress = vs.filter((p) => outside(p, mBox, mR) < -5);
        expect(inMattress.length, `${name} in the mattress: ${short(inMattress)}`).toBe(0);
        const inFrame = vs.filter((p) => frame.some((f) => p.x > f.min.x + 5 && p.x < f.max.x - 5 && p.y > f.min.y + 5 && p.y < f.max.y - 5 && p.z > f.min.z + 5 && p.z < f.max.z - 5));
        expect(inFrame.length, `${name} in the frame: ${short(inFrame)}`).toBe(0);
      }
    });

    it('hangs the duvet clear of the floor and the rug', () => {
      expect(box(duvet!).min.y).toBeGreaterThan(-(FLOOR_Y - RUG.h) + 1000);
      expect(box(duvet!).max.z).toBeLessThan(BED.z1 + 2000);
    });

    it('lays the runner on the duvet, not in it', () => {
      // (the test's own check: the mattress's middle is in the mattress)
      expect(within(mBox.getCenter(new Vector3()), solid(mattress!))).toBe(true);
      const d = solid(duvet!), sunk = vertices(runner!, 9).filter((p) => within(p, d));
      expect(sunk.length, short(sunk)).toBe(0);
    });

    it('stands the pillows two by two, the front ones leant on the back ones, none in another', () => {
      expect(pillows).toHaveLength(4);
      const solids = pillows.map(solid);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if (i === j || !box(pillows[i]!).intersectsBox(box(pillows[j]!))) continue;
        const sunk = vertices(pillows[i]!, 3).filter((p) => within(p, solids[j]!));
        expect(sunk.length, `pillow ${i} in pillow ${j}: ${short(sunk)}`).toBe(0);
      }
      // the front ones lean back on the back ones: they touch
      for (const [f, k] of [[2, 0], [3, 1]] as const) expect(box(pillows[f]!).min.z).toBeLessThan(box(pillows[k]!).max.z);
    });
  });

  it('makes the floor, the desk top and the bookcase of the palette\'s one oak, its grain along each board', () => {
    const oak = (m: Mesh) => { const s = m.material as MeshStandardMaterial; return s.color.getHexString() === OAK.slice(1) && s.roughness === OAK_ROUGH; };
    // how far u runs over the face whose normal is along `axis` (0 x, 1 y, 2 z)
    const span = (m: Mesh, axis: number) => {
      const { uv, normal } = m.geometry.attributes, us: number[] = [];
      for (let i = 0; i < uv!.count; i++) if (Math.abs(normal!.getComponent(i, axis)) > 0.99) us.push(uv!.getX(i));
      return Math.max(...us) - Math.min(...us);
    };
    const g = roomGeo(), desk = deskSlab(g);
    expect(oak(oakFloor()), 'the floor').toBe(true);
    expect(oak(desk), 'the desk top').toBe(true);
    // the grain runs the desk's length
    expect(span(desk, 1)).toBeCloseTo((g.desk.x1 - g.desk.x0) / OAK_TILE, 1);
    // the bookcase's boards: its sides, its back, its shelves and its plinth (all that runs most of its height or its width)
    const tall = BOOKCASE.z1 - BOOKCASE.z0, high = FLOOR_Y - BOOKCASE.top, boards: Mesh[] = [];
    bookcase().traverse((o) => {
      const s = new Box3().setFromObject(o, true).getSize(new Vector3());
      if ((o as Mesh).isMesh && !(o as InstancedMesh).isInstancedMesh && !decal(o as Mesh) && (s.y > 0.8 * high || s.z > 0.8 * tall)) boards.push(o as Mesh);
    });
    expect(boards.length).toBeGreaterThanOrEqual(10);
    for (const b of boards) expect(oak(b), `a board of the bookcase, ${b.geometry.type}`).toBe(true);
    // a side's grain stands up it
    const side = boards.find((b) => new Box3().setFromObject(b).getSize(new Vector3()).z < 1000)!;
    expect(span(side, 2)).toBeCloseTo(high / OAK_TILE, 1);
  });
});
