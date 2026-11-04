// The desk chair in 3D: a modern task chair at real sizes (seat 490 mm up, back to about 1.05 m), pulled out from the desk and turned a little,
// as left after use. A five-star base on twin-wheel castors, a gas lift, a fabric seat and a mesh back in a black frame, two armrests, and a
// hoodie thrown over the back (the room is lived in). Built in its own frame (millimetres, y up from the floor, the sitter facing -z), then set
// on the floor and turned. Pure scenery: nothing answers a click; the room merges its still parts by material (`mergeStatic`).
import { CylinderGeometry, Group, Mesh, type Material } from 'three';
import { rod, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { cushion, floorShadow, pillow, weave } from './furniture3d';
import { FLOOR_Y } from './roomplan';

/** Room units per millimetre (the room's metre is 18 700 units). */
const MM = 18.7;

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
  const hoodie = cloth(0xffffff, { map: weave('#6d7a5f', { knit: true, repeat: [4, 4] }) });

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

  // ---- the back: a spine from the tilt box, a black frame round a mesh panel, laid back a little, a lumbar pad ----
  const lean = 0.16, back = new Group();
  back.position.set(0, 540 * MM, 255 * MM);
  back.rotation.x = -lean;
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

  // ---- the hoodie: thrown over the back, its body hanging behind, the hood over the top, a sleeve down the side ----
  const drop = new Group();
  drop.position.copy(back.position);
  drop.rotation.x = -lean;
  const body = new Mesh(pillow(400 * MM, 36 * MM, 250 * MM, { pinch: 0.04, lumps: 0.14, seed: 3 }), hoodie);
  body.rotation.set(Math.PI / 2 - 0.12, 0, 0.03);
  body.position.set(-30 * MM, (60 + H - 100) * MM, 46 * MM);
  body.castShadow = body.receiveShadow = true;
  drop.add(body);
  // its ribbed hem and the front pocket (the hoodie hangs front out, toward the room)
  const rib = cloth(0xffffff, { map: weave('#5f6b53', { knit: true, repeat: [12, 1] }) });
  drop.add(slab(-28, 60 + H - 236, 66, 396, 34, 38, rib, 14), slab(-30, 60 + H - 170, 70, 230, 90, 12, hoodie, 5));
  const hood = new Mesh(cushion(300 * MM, 60 * MM, 120 * MM, 1.2), hoodie);
  hood.rotation.set(0.2, 0.15, 0.05);
  hood.position.set(-30 * MM, (60 + H + 18) * MM, 10 * MM);
  hood.castShadow = hood.receiveShadow = true;
  drop.add(hood);
  drop.add(tube([[-200, 60 + H + 6, 10], [-232, 60 + H - 40, -20], [-245, 60 + H - 180, -12], [-250, 60 + H - 300, 30], [-236, 60 + H - 380, 52]].map(([a, b, d]) => [a! * MM, b! * MM, d! * MM] as const), 42 * MM, hoodie, 9));
  c.add(drop);

  c.rotation.y = turn;
  c.position.set(x, -FLOOR_Y, z);
  root.add(c, floorShadow(x, z, 760 * MM, 760 * MM, 0.7));
  return root;
}
