// The two lamps by the desk and the door: the wall sconce (`sconce`) and the arc floor lamp over the desk (`arcLamp`).
import {
  CircleGeometry,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { SEG, place, post, rectBox, rod, softBox, tube } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { OPAL, kelvin } from '../palette';
import { ARC_LAMP, FLOOR_Y, RUG, SCONCE, WEST_X, onRug } from '../roomplan';
import { stream } from './seed';
import { floorShadow } from './shapes';
import { RIBS, washiShade, washiTex } from './washi';
import type { Material, MeshStandardMaterial, V3 } from './types';

/** The arc lamp's dome: how wide its mouth is round, how tall it is. */
const DOME_R = 2600,
  DOME_H = 1900;

/**
 * The wall sconce north of the door (`SCONCE`): a slim black box off the west wall on a plate, open at both ends; a warm glow in each opening
 * and the two spots (2700 K) it stands for, one up and one down the plaster.
 */
export function sconce(): { root: Group; glow: MeshStandardMaterial; up: SpotLight; down: SpotLight } {
  const g = new Group(),
    { z, y } = SCONCE,
    xs = WEST_X,
    h = 4200,
    w = 1500,
    d = 1500,
    x0 = xs + 700,
    black = mat(0x1d_1e_22, { metalness: 0.3, roughness: 0.5 });
  // (in the wall's plane: 2D y down, z along the wall; x out of the wall into the room)
  g.add(
    softBox({ x: xs, y: y - 900, w: 120, h: 1800 }, z - 500, z + 500, black, 30),
    rectBox({ x: xs + 120, y: y - 200, w: x0 - xs - 120, h: 400 }, z - 200, z + 200, black),
  );
  g.add(softBox({ x: x0, y: y - h / 2, w: d, h }, z - w / 2, z + w / 2, black, 60));
  const glow = mat(0x13_15_18, { roughness: 0.6, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  for (const gy of [y - h / 2 - 10, y + h / 2 - 10]) {
    g.add(rectBox({ x: x0 + 160, y: gy, w: d - 320, h: 20 }, z - w / 2 + 160, z + w / 2 - 160, glow));
  }
  // the two spots, each out of its opening along the wall: a cone up to the ceiling, a wider one down, its head turned a little to the door
  // (`lean`: along z, a part of the way down)
  const spot = (dy: number, angle: number, lean: number) => {
    const s = new SpotLight(kelvin(2700), 0, 0, angle, 0.6, 2),
      sy = -(y + dy);
    s.position.set(x0 + d / 2, sy, z);
    s.target.position.set(x0 + d / 2, sy - Math.sign(dy) * 20_000, z + lean * 20_000);
    g.add(s, s.target);
    return s;
  };
  return { root: g, glow, up: spot(-h / 2 - 100, 0.5, 0), down: spot(h / 2 + 100, 0.6, 0.3) };
}

/**
 * The arc floor lamp east of the desk (`ARC_LAMP`): a round slab of dark stone on the rug, a black steel stem straight up from it that arcs over
 * and down onto a knuckle over a washi dome on bamboo ribs (the lanterns' paper), hung level over the desk east of the case, its mouth down.
 * A warm diffuser in its mouth, the paper glowing with it; the wide spot it stands for (2700 K) is an overhead cozy light: a soft pool on the
 * desk, the case's top and its open side.
 */
export function arcLamp(): { root: Group; shade: MeshStandardMaterial; glow: MeshStandardMaterial; light: SpotLight } {
  const g = new Group(),
    { x, z, head } = ARC_LAMP,
    on = onRug(x, z),
    fl = FLOOR_Y - (on ? RUG.h : 0);
  const black = mat(0x1d_1e_22, { metalness: 0.5, roughness: 0.4 }),
    stone = mat(0x2a_2d_32, { roughness: 0.3 });
  g.add(
    post(x, fl, z, 2600, 800, stone, SEG.wideDisc),
    post(x, fl - 800, z, 360, 600, black, SEG.disc),
    floorShadow([x, z], [7000, 7000], { k: 0.4, lift: on ? RUG.h + 140 : 140 }),
  );
  // the dome: its mouth, its axis straight down, its crown over it; the arc comes down onto a knuckle over the crown
  const mouth = new Vector3(head.x, -head.y, head.z),
    axis = new Vector3(0, -1, 0);
  const crown = mouth.clone().addScaledVector(axis, -DOME_H),
    knuckle = crown.clone().add(new Vector3(0, 900, 0));
  arcStem(g, black, { base: new Vector3(x, -fl + 1400, z), knuckle, crown });
  const { shade, glow } = arcDome(g, black, mouth);

  // (the bulb sits just inside the mouth: the paper lets it light nearly a half sphere, fading out to its edge)
  const light = new SpotLight(kelvin(2700), 0, 0, 1.25, 0.3, 2);
  light.position.copy(mouth).addScaledVector(axis, -300);
  light.target.position.copy(mouth).addScaledVector(axis, 20_000);
  g.add(light, light.target);
  return { root: g, shade, glow, light };
}

/** The arc lamp's stem: a black steel tube from its base up and over onto the knuckle, a rod down from it to the dome's crown, a ball on it. */
function arcStem(g: Group, black: Material, at: { base: Vector3; knuckle: Vector3; crown: Vector3 }): void {
  const { knuckle, crown } = at;
  // (a cubic curve: straight up out of the base, straight down onto the knuckle, its top about 2.1 m over the floor)
  const b0 = at.base,
    b1 = new Vector3(b0.x, 28_000, b0.z),
    b2 = new Vector3(knuckle.x, 28_000, knuckle.z),
    arc: V3[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16,
      u = 1 - t,
      p = b0
        .clone()
        .multiplyScalar(u * u * u)
        .addScaledVector(b1, 3 * u * u * t)
        .addScaledVector(b2, 3 * u * t * t)
        .addScaledVector(knuckle, t * t * t);
    arc.push([p.x, p.y, p.z]);
  }
  g.add(
    tube(arc, 200, black, SEG.arm),
    rod([knuckle.x, knuckle.y, knuckle.z], [crown.x, crown.y, crown.z], 110, black, SEG.frameBar),
  );
  const ball = new Mesh(new SphereGeometry(280, SEG.post, SEG.ringsMid), black);
  ball.position.copy(knuckle);
  g.add(place(ball));
}

/**
 * The arc lamp's dome at `mouth`: the paper's side, mouth to crown (a quarter round, a little flattened, a small hole at the crown for the
 * stem; the paper glows most near the bulb, a little in from its mouth), a black wire ring round the mouth, a warm diffuser in it.
 */
function arcDome(
  g: Group,
  black: Material,
  mouth: Vector3,
): { shade: MeshStandardMaterial; glow: MeshStandardMaterial } {
  const R = DOME_R,
    H = DOME_H;
  const dome = new Group(),
    prof: Vector2[] = [];
  for (let k = 0; k <= RIBS * 2; k++) {
    const t = (k / (RIBS * 2)) * (Math.PI / 2 - 0.12);
    prof.push(new Vector2(R * Math.cos(t), H * Math.sin(t)));
  }
  const paper = washiTex(undefined, stream(53)),
    lit = washiTex((v) => 0.45 + 0.55 * Math.exp(-(((v - 0.3) / 0.4) ** 2)), stream(53));
  const shade = washiShade(paper, lit);
  const rim = new Mesh(new TorusGeometry(R, 30, SEG.tube, SEG.lathe), black);
  rim.rotation.x = Math.PI / 2;
  const glow = mat(OPAL, { roughness: 0.4, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  const disc = new Mesh(new CircleGeometry(R * 0.8, SEG.lathe), glow);
  disc.rotation.x = Math.PI / 2;
  disc.position.y = 500;
  // (the paper lets the light through: it casts no shadow)
  dome.add(new Mesh(new LatheGeometry(prof, SEG.lathe), shade), place(rim), seeThrough(disc));
  dome.position.copy(mouth);
  g.add(dome);
  return { shade, glow };
}
