// The shelves' warm LED strips (`shelfStrips`) and the books' stand-in for them when the lamp cap takes them out (`stripLit`).
import { Color, Group, RectAreaLight } from 'three';
import { rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { kelvin } from '../palette';
import { BOOKCASE, EAST_X, FLOOR_Y, SHELF } from '../roomplan';
import type { Material, Mesh, MeshStandardMaterial } from './types';

/** The bookcase's sides' and boards' thickness, and how many shelves of books it holds (a board over each, one under the last). */
export const CASE_BOARDS = { side: 450, board: 400, n: 5 } as const;

/** A shelf strip's width (units; about 1 cm), its line's and its light's. */
export const STRIP_W = 200;
/** The shelf strips' tilt back toward the books (radians; `shelfStrips`). */
const STRIP_TILT = 0.6;

/**
 * The books' stand-in for the bookcase's strips when the lamp cap takes them out of the scene (Low): `colour` is a strip's colour times its
 * level, black while the strips are real lights (the room sets it each frame). The books are instances, so the light bake has no map for
 * them; without this they lose the strips' light, which is most of theirs at night.
 */
export const STRIP_STAND_IN = { colour: { value: new Color(0, 0, 0) } };

/**
 * Patches a book material to take its shelf's strip as one line light, worked out in closed form (no area-light tables, no loop): the strip
 * over the fragment's own shelf only, as the boards shut the others out. Positions are the bookcase's (the room's units).
 */
export function stripLit<T extends MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms['uStripColour'] = STRIP_STAND_IN.colour;
    sh.vertexShader = stripVertex(sh.vertexShader);
    sh.fragmentShader = stripFragment(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => 'strip-lit';
  return m;
}

/** The vertex shader of `stripLit`: it hands the fragment its place and its normal in the bookcase's frame (an instance's too). */
function stripVertex(src: string): string {
  return src.replace('#include <common>', '#include <common>\nvarying vec3 vStripPos;\nvarying vec3 vStripN;').replace(
    '#include <project_vertex>',
    `#include <project_vertex>
        #ifdef USE_INSTANCING
          vStripPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
          vStripN = mat3(instanceMatrix) * (objectNormal / vec3(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz), dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz)));
        #else
          vStripPos = transformed; vStripN = objectNormal;
        #endif`,
  );
}

/** A length as a GLSL float, to a tenth. */
const glsl = (v: number): string => v.toFixed(1);

/** The fragment shader of `stripLit`: the strip over the fragment's shelf as a line light, lit by `uStripColour`. */
function stripFragment(src: string): string {
  const { x, w, z0, z1, top } = BOOKCASE,
    { side, board, n } = CASE_BOARDS,
    gap = (FLOOR_Y - top - 1400) / n;
  return src
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uStripColour;\nvarying vec3 vStripPos;\nvarying vec3 vStripN;',
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
        if (uStripColour.r + uStripColour.g + uStripColour.b > 0.0) {
          // the strip over this shelf: a line along z at the board's front edge, shining down and back (its tilt)
          float shelf = clamp(floor((-vStripPos.y - ${glsl(top)}) / ${glsl(gap)}), 0.0, ${glsl(n - 1)});
          vec2 toL = vec2(${glsl(x + w - 120 - STRIP_W / 2)}, -(${glsl(top + board + 120)} + shelf * ${glsl(gap)})) - vStripPos.xy;
          float d = max(length(toL), 60.0), d2 = d * d;
          vec2 dir = toL / d;
          vec3 sn = normalize(vStripN);
          float ce = max(dot(vec2(${(-Math.sin(STRIP_TILT)).toFixed(4)}, ${(-Math.cos(STRIP_TILT)).toFixed(4)}), -dir), 0.0);
          float a = ${glsl(z0 + side + 200)} - vStripPos.z, b = ${glsl(z1 - side - 200)} - vStripPos.z;
          float ra = d2 + a * a, rb = d2 + b * b;
          // the line's form factor: the part square to the line, and the part along it (a face that looks along the shelf)
          float across = dot(sn.xy, dir) * (0.5 * (b / rb - a / ra) + 0.5 * (atan(b / d) - atan(a / d)) / d);
          float along = sn.z * d * 0.5 * (1.0 / ra - 1.0 / rb);
          reflectedLight.directDiffuse += uStripColour * material.diffuseColor * (${glsl(STRIP_W)} * RECIPROCAL_PI * ce * max(across + along, 0.0));
        }`,
    );
}

/** A shelf strip's place: `x` its front's x, `y` the board's underside (2D y down), along z from `z0` to `z1`, its light tilted `tilt`. */
interface StripAt {
  x: number;
  y: number;
  z0: number;
  z1: number;
  tilt: number;
}

/** A warm LED strip's line under a board, along z. */
function stripLine(s: StripAt, glow: Material): Mesh {
  return rectBox({ x: s.x - STRIP_W, y: s.y, w: STRIP_W, h: 110 }, s.z0, s.z1, glow);
}

/**
 * The warm LED strips (2700 K) under the bookcase's boards, one over each shelf of books at its front edge, and under the east wall's shelf:
 * each a thin glowing line and the area light it stands for, shining down. Their light comes on with the evening (the room sets it).
 */
export function shelfStrips(): { root: Group; glow: MeshStandardMaterial; lights: RectAreaLight[] } {
  const g = new Group(),
    lights: RectAreaLight[] = [],
    glow = mat(0x13_15_18, { roughness: 0.6, emissive: new Color(kelvin(2700)), emissiveIntensity: 0 });
  // (each at its board's front edge, its light tilted `tilt` back toward the books, or toward the wall: a strip in an angled profile)
  const add = (s: StripAt) => {
    g.add(stripLine(s, glow));
    const l = new RectAreaLight(kelvin(2700), 0, STRIP_W, s.z1 - s.z0);
    l.position.set(s.x - STRIP_W / 2, -s.y - 120, (s.z0 + s.z1) / 2);
    l.rotation.set(-Math.PI / 2, s.tilt, 0);
    lights.push(l);
  };

  const { x, w, z0, z1, top } = BOOKCASE,
    { side, board, n } = CASE_BOARDS,
    gap = (FLOOR_Y - top - 1400) / n;
  // (the books' stand-in for these five reads the same places: `stripLit`)
  for (let s = 0; s < n; s++) {
    add({ x: x + w - 120, y: top + s * gap + board, z0: z0 + side + 200, z1: z1 - side - 200, tilt: STRIP_TILT });
  }
  add({ x: EAST_X - SHELF.d + STRIP_W + 120, y: SHELF.y + 900, z0: SHELF.z0 + 400, z1: SHELF.z1 - 400, tilt: -0.6 });

  g.add(...lights);
  return { root: g, glow, lights };
}
