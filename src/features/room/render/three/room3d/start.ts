// The build's shared state (`Build`): the room's geometry and heights, the first materials, the plaster walls; and the area lights' tables.
import { Color, Vector2 } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { rectBox, worldUv } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { TRIM, WALL } from '../palette';
import { CEIL_Y, FLOOR_Y } from '../roomplan';
import { PLASTER_TILE } from './consts';
import { bakedPlaster, plasterMaps } from './plaster';
import type { AoPool, Group, Mesh, MeshStandardMaterial, Rect, RoomGeo, RoomParts } from './types';

/** The area lights' tables (once per page): a `RectAreaLight` lights nothing without them. */
let areaLights = false;

/** The baked occlusion's pool of workers, and what runs between its slices (`make`). */
export interface Ao {
  pool: AoPool;
  slice: () => Promise<void>;
}

/**
 * What the builders share: the room and its root, its geometry and heights (the desk's top `ys` down from the ceiling's line, the floor `fl`,
 * the desk's top up `deskTop`, the room's height `H`), the promise of the end of the build (`until`: the models that load late join after
 * it), the materials of the build's first lines, and the plaster walls (`wall`).
 */
export interface Build {
  room: RoomParts;
  R: Group;
  g: RoomGeo;
  ys: number;
  fl: number;
  deskTop: number;
  H: number;
  until: Promise<void>;
  graphite: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  chrome: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  wall: (r: Rect, z0: number, z1: number) => Mesh;
}

/** One plaster on every wall, its texture at one size on each piece and running on across the pieces (`worldUv`). */
function plasterWall(): Build['wall'] {
  // (the paint is the palette's `WALL` as it is: `mat` would move this grey to a step of the parts' grey ladder)
  const plaster = mat(0xff_ff_ff, {
    color: new Color(WALL),
    ...(bakedPlaster() ?? plasterMaps()),
    normalScale: new Vector2(1, 1),
    roughness: 0.92,
  });
  return (r, z0, z1) => worldUv(rectBox(r, z0, z1, plaster), PLASTER_TILE);
}

/** The build's shared state; `built` ends it (the models that load late, the mouse and the hoodie, join then: the merges and the bake must not see them). */
export function startBuild(room: RoomParts): { b: Build; built: () => void } {
  const g = room.geo,
    fl = FLOOR_Y;
  if (!areaLights) {
    RectAreaLightUniformsLib.init();
    areaLights = true;
  }
  let built!: () => void;
  const until = new Promise<void>((resolve) => {
    built = resolve;
  });
  const graphite = mat(0x2a_2d_32, { roughness: 0.3 }),
    trim = mat(TRIM, { roughness: 0.5 });
  const chrome = mat(0xb9_ba_bf, { metalness: 0.85, roughness: 0.25 });
  const dark = mat(0x2a_2d_32, { roughness: 0.5 });
  const wall = plasterWall();
  const b = {
    room,
    R: room.root,
    g,
    ys: g.ys,
    fl,
    deskTop: -g.ys,
    H: fl - CEIL_Y,
    until,
    graphite,
    trim,
    chrome,
    dark,
    wall,
  };
  return { b, built };
}
