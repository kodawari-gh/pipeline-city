// The desk chair in 3D: a modern task chair at real sizes (seat 490 mm up, back to about 1.05 m), pulled out from the desk and turned a little,
// as left after use. A five-star base on twin-wheel castors, a gas lift, a fabric seat and a mesh back in a black frame, two armrests, and a
// hoodie the chair wears (the room is lived in). Built in its own frame (millimetres, y up from the floor, the sitter facing -z), then set on the
// floor and turned. Pure scenery: nothing answers a click; the room merges its still parts by material (`mergeStatic`).
import { CylinderGeometry, DoubleSide, Group, Mesh, type Material } from 'three';
import { bakedAo } from '@/core/render/three/bakedao';
import { paint, rod, softBox, tube } from '@/core/render/three/geometry';
import { loadModel } from '@/core/render/three/gltf';
import { cloth, mat } from '@/core/render/three/materials';
import { cushion, floorShadow, weave } from './furniture3d';
import { FLOOR_Y } from './roomplan';

/** Room units per millimetre (the room's metre is 18 700 units). */
const MM = 18.7;

// ---- the hoodie: a cloth bake (hoodiecloth.ts, docs/render/cloth.md), in millimetres in the chair's frame ----
const HOODIE_MODEL = `${import.meta.env.BASE_URL}models/hoodie.glb`;
/** The bake's uvs: millimetres of flat cloth over this (`bake.tile`). */
const TILE = 100;

/** A 1x1 rib knit: raised columns and the valleys between, a tile 12 mm across (the bake's uvs run a tile per `TILE` mm). */
const ribs = (base: string) => paint(64, 64, (c, w, h) => {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const x = (i * w) / 4, g = c.createLinearGradient(x, 0, x + w / 4, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.3, 'rgba(255,255,255,0.1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.12)'); g.addColorStop(0.85, 'rgba(0,0,0,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = g; c.fillRect(x, 0, w / 4, h);
  }
}, [TILE / 12, 1]);

/**
 * The hoodie the chair wears, folded over its back: the body down behind it, the hood over its front, the sleeves down the sides. Added to
 * `c` once the model loads (the chair stands bare until then, and when it fails); not while `alive` is false. The knit and the rib take the
 * bake's materials by name, and its occlusion (dark in the folds and where it lies on the chair).
 */
function hoodie(c: Group, alive: () => boolean): void {
  void loadModel(HOODIE_MODEL).then((m) => {
    if (!m || !alive()) return;
    const knit = cloth(0xffffff, { map: weave('#4b5443', { knit: true, repeat: [1, 1] }), side: DoubleSide });
    const rib = cloth(0xffffff, { map: ribs('#434b3a'), side: DoubleSide });
    bakedAo(knit); bakedAo(rib);
    const o = m.clone(true);
    o.traverse((x) => {
      if (!(x as Mesh).isMesh) return;
      const mesh = x as Mesh;
      mesh.material = (mesh.material as Material).name === 'rib' ? rib : knit;
      mesh.castShadow = mesh.receiveShadow = true;
    });
    o.scale.setScalar(MM);
    c.add(o);
  });
}

/** A soft box centred on (x, y, z) in millimetres, y up. */
function slab(x: number, y: number, z: number, w: number, h: number, d: number, m: Material, radius = 8): Mesh {
  return softBox({ x: (x - w / 2) * MM, y: -(y + h / 2) * MM, w: w * MM, h: h * MM }, (z - d / 2) * MM, (z + d / 2) * MM, m, radius * MM);
}

/** A rod between two points in millimetres. */
const bar = (a: readonly [number, number, number], b: readonly [number, number, number], r: number, m: Material, sides = 10): Mesh =>
  rod([a[0] * MM, a[1] * MM, a[2] * MM], [b[0] * MM, b[1] * MM, b[2] * MM], r * MM, m, sides);

/** A cylinder standing on (x, y0, z), in millimetres, `axisX` laid along x (a wheel). */
function can(x: number, y: number, z: number, r: number, h: number, m: Material, axisX = false, sides = 16): Mesh {
  const o = new Mesh(new CylinderGeometry(r * MM, r * MM, h * MM, sides), m);
  if (axisX) o.rotation.z = Math.PI / 2;
  o.position.set(x * MM, (axisX ? y : y + h / 2) * MM, z * MM);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** The chair, its seat's middle over the floor point (x, z) in room units, turned `turn` radians from square to the desk. */
export function deskChair(x: number, z: number, turn: number): Group {
  const root = new Group(), c = new Group();
  const black = mat(0x1d1f22, { roughness: 0.45 }), steel = mat(0xb9bdc2, { metalness: 0.9, roughness: 0.28 });
  const seatCloth = cloth(0xffffff, { map: weave('#4a4d52', { repeat: [3, 3] }) }), mesh = cloth(0xffffff, { map: weave('#2c2f33', { repeat: [10, 12] }), sheenColor: 0x6a6e74 });

  // ---- the base: a hub, five legs falling to the castors, each castor two wheels on a swivel ----
  c.add(can(0, 95, 0, 42, 70, black, false, 20));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a), tip = 315;
    c.add(bar([ca * 30, 125, sa * 30], [ca * tip, 88, sa * tip], 19, black, 6));
    c.add(can(ca * tip, 62, sa * tip, 12, 30, steel, false, 8));
    const wheel = new Group();
    for (const s of [-1, 1]) wheel.add(can(s * 12, 26, -14, 26, 18, black, true, 18));
    wheel.add(slab(0, 46, -10, 34, 26, 44, black, 6));
    wheel.position.set(ca * tip * MM, 0, sa * tip * MM);
    wheel.rotation.y = a * 1.7 + 0.4;
    c.add(wheel);
  }
  // ---- the gas lift: a black sleeve, the chrome piston, the tilt box under the seat ----
  c.add(can(0, 130, 0, 30, 160, black, false, 20), can(0, 285, 0, 21, 125, steel, false, 20));
  c.add(slab(0, 425, 10, 230, 45, 260, black, 10));
  // (the height lever out from under the seat's west side)
  c.add(bar([-60, 420, -100], [-245, 405, -140], 7, steel, 8));

  // ---- the seat: a moulded shell, the cushion on it ----
  c.add(slab(0, 458, 0, 470, 22, 450, black, 10));
  const seat = new Mesh(cushion(490 * MM, 80 * MM, 470 * MM, 0.8), seatCloth);
  seat.position.set(0, 505 * MM, -5 * MM);
  seat.castShadow = seat.receiveShadow = true;
  c.add(seat);

  // ---- the back: a spine from the tilt box, a black frame round a mesh panel, laid back a little (its top away from the sitter), a lumbar pad ----
  const lean = 0.16, back = new Group();
  back.position.set(0, 540 * MM, 255 * MM);
  back.rotation.x = lean;
  const H = 380, W = 440;
  const ring: [number, number, number][] = [];
  for (let k = 0; k <= 32; k++) {
    // a rounded rectangle, wider at the top, its middle bowed back (the panel's curve round the sitter)
    const t = (k / 32) * Math.PI * 2, sx = Math.cos(t), sy = Math.sin(t), ex = Math.sign(sx) * Math.pow(Math.abs(sx), 0.35), ey = Math.sign(sy) * Math.pow(Math.abs(sy), 0.35);
    const yy = (ey + 1) / 2, ww = W / 2 * (0.9 + 0.1 * yy);
    ring.push([ex * ww * MM, (60 + yy * H) * MM, (30 * ex * ex) * MM]);
  }
  back.add(tube(ring, 13 * MM, black, 8));
  const panel = new Mesh(cushion((W - 30) * MM, 18 * MM, (H - 30) * MM, 0.5), mesh);
  panel.rotation.x = Math.PI / 2;
  panel.position.set(0, (60 + H / 2) * MM, 8 * MM);
  panel.castShadow = panel.receiveShadow = true;
  back.add(panel);
  back.add(slab(0, 150, -6, 300, 60, 22, black, 10));
  c.add(back);
  c.add(slab(0, 470, 200, 70, 40, 120, black, 10), bar([0, 470, 255], [0, 600, 300], 22, black, 10));

  // ---- the armrests: a post up from under each side of the seat, a soft pad on it ----
  for (const s of [-1, 1]) {
    c.add(bar([s * 120, 440, 40], [s * 262, 440, 40], 14, black, 8), bar([s * 262, 440, 40], [s * 268, 650, 20], 18, black, 10));
    c.add(slab(s * 268, 662, 0, 72, 28, 250, black, 12));
  }

  hoodie(c, () => !!root.parent);

  c.rotation.y = turn;
  c.position.set(x, -FLOOR_Y, z);
  root.add(c, floorShadow(x, z, 760 * MM, 760 * MM, 0.7));
  return root;
}
