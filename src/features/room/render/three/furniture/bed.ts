// The bed (`bed`): a low platform bed and its LED strips, made up with a fitted sheet, a duvet turned down, a runner and four pillows.
import { Color, Group, RectAreaLight } from 'three';
import { rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { NEON, STEEL, VENEER, VENEER_GRAIN } from '../palette';
import { BED, FLOOR_Y, RUG, onRug } from '../roomplan';
import { APRON, PLAT, SET, UNDER, bedCover, madeMattress } from './cover';
import { bedPillows } from './pillows';
import { board, floorShadow } from './shapes';
import { oak } from './textures';
import type { MeshStandardMaterial } from './types';

/** The bed and its night lights: the LED strips' glow, and the area lights they stand for (the floor round the bed, the wall over the headboard). */
export interface Bed {
  root: Group;
  glow: MeshStandardMaterial;
  under: RectAreaLight;
  halo: RectAreaLight;
}

/**
 * A low platform bed, plain and flat-pack: a thick black-brown top board on a recessed black apron and feet, so it seems to float, an LED
 * strip under its edge; a flat headboard panel just off the wall, a strip behind its top. Made up as a bed is: the mattress in its fitted
 * sheet, the duvet over it, turned down below the pillows, falling over the sides and the foot and round the foot's corners, a runner across
 * it, two pillows stood against the headboard and two in front leant on them. The cloth lies over what is under it, the pillows are set down
 * and leant back by contact (`bedding3d.ts`): nothing goes into what it lies on.
 */
export function bed(): Bed {
  const g = new Group(),
    { x, w, z0, z1 } = BED;
  bedFrame(g);
  const lights = bedStrips(g);
  const { mattress, form, mw } = madeMattress(g);
  // the duvet: from below the pillows (turned down there: doubled) over the foot, its hem down the platform's edge, thinner toward its edges
  const { duvet, runner } = bedCover(form);
  duvet.name = 'duvet';
  runner.name = 'runner';
  mattress.name = 'mattress';
  g.add(duvet, runner);
  bedPillows(g, { mattress, duvet, mw });
  g.add(floorShadow([x + w / 2, (z0 + z1) / 2 + 300], [w * 1.05, (z1 - z0) * 1.02], { k: 0.9, lift: 330 }));
  return { root: g, ...lights };
}

/** The frame: the headboard and the platform in veneer, the black apron under them and its feet (shorter where they stand on the rug). */
function bedFrame(g: Group): void {
  const { x, w, z0, z1, head: hd, headTop } = BED,
    fl = FLOOR_Y,
    x1 = x + w;
  const veneer = mat(0xff_ff_ff, { map: oak(VENEER, VENEER_GRAIN, { repeat: [3, 1] }), roughness: 0.5 }),
    black = mat(STEEL, { roughness: 0.8 });
  const headboard = board({ x, y: headTop, w, h: UNDER - headTop }, [z0, z0 + hd], veneer),
    platform = board({ x, y: PLAT, w, h: UNDER - PLAT }, [z0 + hd, z1], veneer);
  headboard.name = 'headboard';
  platform.name = 'platform';
  g.add(headboard, platform);
  g.add(softBox({ x: x + SET, y: UNDER, w: w - 2 * SET, h: APRON - UNDER }, z0 + hd + 600, z1 - SET, black, 30));
  // its feet under the apron's corners and middles (shorter where they stand on the rug)
  for (const fx of [x + SET + 700, x1 - SET - 700]) {
    for (const fz of [z0 + hd + 1300, (z0 + z1) / 2, z1 - SET - 700]) {
      const ground = onRug(fx, fz) ? fl - RUG.h : fl;
      g.add(softBox({ x: fx - 500, y: APRON, w: 1000, h: ground - APRON }, fz - 500, fz + 500, black, 30));
    }
  }
}

/** The LED strips, round the apron's top under the platform's edge and across the headboard's back near its top; each stands for an area light. */
function bedStrips(g: Group): Omit<Bed, 'root'> {
  const { x, w, z0, z1, head: hd, headTop } = BED,
    cx = x + w / 2;
  const glow = mat(0x13_15_18, { roughness: 0.6, emissive: new Color(NEON), emissiveIntensity: 0 });
  g.add(rectBox({ x: x + SET - 40, y: UNDER, w: w - 2 * SET + 80, h: 160 }, z0 + hd + 560, z1 - SET + 40, glow));
  g.add(rectBox({ x: x + 600, y: headTop + 300, w: w - 1200, h: 160 }, z0 - 60, z0, glow));
  const under = new RectAreaLight(NEON, 0, w - 800, z1 - z0 - hd - 800);
  under.position.set(cx, -UNDER - 60, (z0 + hd + z1) / 2);
  under.rotation.x = -Math.PI / 2;
  const halo = new RectAreaLight(NEON, 0, w - 1200, 300);
  halo.position.set(cx, -(headTop + 380), z0 - 80);
  g.add(under, halo);
  return { glow, under, halo };
}
