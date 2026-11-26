// The room's one board, smoked oak (`smokedOak`): its maps, painted or baked, and its grain laid along each board (`grainUv`).
import { Box3, Color, RepeatWrapping, Vector3 } from 'three';
import { bakedTex } from '@/core/render/three/baked';
import { shareTex } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { OAK, OAK_GRAIN, shadeOf } from '../palette';
import { reseed, seedNow } from './seed';
import { oak, relief } from './textures';
import type { Mesh, MeshStandardMaterial, Texture, Vector3Tuple } from './types';

/** Smoked oak's finish: oiled, a soft sheen (rough enough that the window's bars leave no streaks in it). */
export const OAK_ROUGH = 0.68;
/** World units to one width of the oak's grain (`smokedOak`): 60 cm. */
export const OAK_TILE = 11_200;
/** How deep the oak's grain is (`relief`). */
const OAK_DEPTH = 3;

/**
 * The room's one board (`OAK`, since art-style v3 a matte charcoal laminate): the floor, the desk top, the bookcase. The palette's `OAK` is
 * the material's colour; its map only
 * shades it (white, with the grain in `OAK_GRAIN`'s share of `OAK`), so the planks and every board read as one surface in every light; the
 * grain's relief is a normal map from the same strokes (`relief`). The map is a board's close straight grain by default (lay it along each
 * board with `grainUv`); the floor passes its planks. The grain is the same in every room built: its own stream of random numbers.
 */
export function smokedOak(maps?: OakMaps): MeshStandardMaterial {
  const { map, normal } = maps ?? bakedOak('room-oak', [1, 1]) ?? oakMaps();
  return mat(new Color(OAK).getHex(), { map, normalMap: normal, roughness: OAK_ROUGH });
}

/** The two maps of `smokedOak`: the shade and the relief of its strokes. */
export interface OakMaps {
  map: Texture | null;
  normal: Texture | null;
}

/**
 * The maps of `smokedOak`, painted: of `map`, or of a board's own grain (512 px, always the same strokes). The texture bake runs it
 * (`room-oak`, `tools/bake/textures.mjs`).
 */
export function oakMaps(map?: Texture | null): OakMaps {
  let m = map;
  if (m === undefined) {
    const keep = seedNow();
    reseed(7919);
    m = oak('#ffffff', shadeOf(OAK_GRAIN, OAK), { repeat: [1, 1], size: 512 });
    reseed(keep);
  }
  return { map: m, normal: relief(m, OAK_DEPTH) };
}

/** The baked maps of a key (`<key>` and `<key>-n` in `public/tex/`) with their repeat, or null: the caller paints. They outlive a rebuild. */
export function bakedOak(key: string, repeat: [number, number]): OakMaps | null {
  const map = bakedTex(key),
    normal = bakedTex(`${key}-n`);
  if (!map || !normal) {
    return null;
  }
  for (const t of [map, normal]) {
    t.wrapT = RepeatWrapping;
    t.wrapS = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    shareTex(t);
  }
  return { map, normal };
}

/**
 * Lay the grain along each board: as `worldUv`, uvs from where the faces are, `tile` units to the texture's width, but each face's u runs
 * along the longer of its two sides (the grain runs along u), so it stands up a bookcase's side and runs the length of a shelf.
 */
export function grainUv<T extends Mesh>(o: T, tile: number): T {
  const g = o.geometry,
    at = o.position.toArray(),
    p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    uv = g.getAttribute('uv');
  g.computeBoundingBox();
  const size = (g.boundingBox ?? new Box3()).getSize(new Vector3()).toArray();
  for (let i = 0; i < p.count; i++) {
    const q: Vector3Tuple = [p.getX(i) + at[0], p.getY(i) + at[1], p.getZ(i) + at[2]];
    // the face's two axes, the longer first
    const [a, b] = faceAxes(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)));
    const [u, v] = size[a] >= size[b] ? [a, b] : [b, a];
    uv.setXY(i, q[u] / tile, q[v] / tile);
  }
  uv.needsUpdate = true;
  return o;
}

/** An axis of the room: 0 x, 1 y, 2 z. */
type Axis = 0 | 1 | 2;

/** The two axes a face lies along, from its normal's size along each: all but the one it faces most. */
function faceAxes(ax: number, ay: number, az: number): [Axis, Axis] {
  if (ax >= ay && ax >= az) {
    return [1, 2];
  }
  return ay >= az ? [0, 2] : [0, 1];
}
