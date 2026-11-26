// The room's light bake (`public/bake/room/`): its load, its lightmap on the meshes, and the merges that wait for it.

import { effective } from '@/app/graphics';
import { LightmapMix, applyLightmap, loadBake, loadDirect } from '@/core/render/three/lightmapmix';
import { shareMaterials } from '@/core/render/three/materials';
import { mergePalette } from '@/core/render/three/merge';
import { M } from '../outside/plan';
import { PALETTE_CELL } from './consts';
import type { Bake, Material, Object3D, RoomEnv, RoomParts, WebGLRenderer } from './types';

/** The room's light bake (`public/bake/room/`), loaded once a page: null when there is none or it cannot be read. */
const BAKE_URL = `${import.meta.env.BASE_URL}bake/room/`;
let bakeLoad: Promise<Bake | null> | null = null,
  bakeRenderer: WebGLRenderer | undefined;

/** The bake's files, and with a lamp cap the capped lamps' direct light (so the first probe sees it); null when they cannot be read. */
async function fetchBake(): Promise<Bake | null> {
  if (typeof createImageBitmap === 'undefined') {
    return null;
  }
  try {
    const b = await loadBake(BAKE_URL, bakeRenderer);
    if (effective.peek().lights > 0) {
      await loadDirect(BAKE_URL, b);
    }
    return b;
  } catch {
    // (no bake, or one that cannot be read: the room lights by its probe alone)
    return null;
  }
}

/** The room's light bake, its load begun on the first call. */
async function roomBake(): Promise<Bake | null> {
  bakeLoad ??= fetchBake();
  return bakeLoad;
}

/**
 * Starts loading the room's light bake now, before the room is built (its files load while the build holds the page). With the page's
 * renderer the maps come as KTX2 (the formats of its GPU); a call with none, or a load begun before, takes the PNGs.
 */
export const preloadRoomBake = (renderer?: WebGLRenderer): void => {
  bakeRenderer ??= renderer;
  void roomBake();
};

/**
 * The room's merge by palette after the bake (`Room3D.mergeByPalette`): only a material that takes the room's reflections joins (`envs`), the
 * palette materials join them, and a material no mesh draws with any more leaves them. Each merged mesh keeps its hash and its place for the
 * bake's export (`partsOf`, `tools/bake/scene.ts`), so the next bake finds the same receivers and blockers.
 */
export function mergeAfterBake(root: Object3D, envs: RoomEnv, skip: readonly Object3D[]): number {
  // (the register's materials as materials of any kind: a merge asks of each material it meets)
  const mats: Set<Material> = envs.mats;
  return mergePalette(root, {
    skip,
    cell: PALETTE_CELL,
    ok: (m) => mats.has(m),
    twin: (src, c) => {
      envs.twin(src, c);
    },
    drop: (m) => {
      mats.delete(m);
    },
  });
}

/** The bake's lightmap on the meshes it knows. The others keep the probe; the dev build names them (the bake is older than the room). */
export function takeBake(room: RoomParts, b: Bake): void {
  const mix = new LightmapMix(b),
    blinds = new Set<Object3D>(room.blinds);
  // (the bake is of the first board in the first case: there each mesh has its hash. With another tier the desk and what stands on it
  // move, and those meshes are found by their count of corners, `loose`; a mesh with no pair keeps the probe's light)
  applyLightmap(room.root, b, mix.texture, {
    metre: M,
    skip: (o) => blinds.has(o),
    twin: (src, c) => {
      room.envs.twin(src, c);
    },
  });
  room.lightmap = mix;
  room.bake = b;
  room.mixKey = '';
  shareRoom(room);
}

/**
 * Equal materials as one (`shareMaterials`: fewer uniform uploads per frame), once built and again once the bake has lit its meshes. The key
 * rack is built again with each new key; a replaced material leaves the reflections' register.
 */
export function shareRoom(room: RoomParts): void {
  const mats: Set<Material> = room.envs.mats;
  shareMaterials(room.root, {
    skip: [room.keys],
    onReplace: (m) => {
      mats.delete(m);
    },
  });
}

/**
 * The still meshes whose materials differ only in colour, roughness and metalness as one mesh a cell of space (`mergePalette`): fewer draws
 * and fewer changes of material a frame. After the bake, as each keeps its light map's UVs (the bake's export reads the meshes it took in).
 * Only materials that take the room's reflections join; the key rack is built again with each key, the mouse's stand-in hides when the
 * model is in (it can come after the bake).
 */
function mergeByPalette(room: RoomParts): void {
  mergeAfterBake(room.root, room.envs, [room.keys, room.mouse]);
}

/** The baked bounce once its files are in; until then, and on a mesh the bake does not know, the probe's. Then the still scenery by palette. */
export async function settleBake(room: RoomParts): Promise<void> {
  const b = await roomBake();
  if (room.gone) {
    return;
  }
  if (b) {
    takeBake(room, b);
  }
  mergeByPalette(room);
}

/** A lamp cap set after the load: the capped lamps' direct light loads now, and the next frame's mix takes it. */
export async function loadCappedDirect(room: RoomParts, bake: Bake): Promise<void> {
  try {
    await loadDirect(BAKE_URL, bake);
    room.mixKey = '';
  } catch {
    /* the lifted bounce stays */
  }
}
