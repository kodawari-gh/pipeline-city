// The room's settings: its cap of real-time lights, its shadow maps and their redraws, the city's detail, and what it frees.
import { LightShadow } from 'three';
import { catchUp } from '@/core/render/three/shadows';
import { LIGHT_ORDER, MACHINE_LIGHTS, chooseLights } from '../roomlights';
import { loadCappedDirect } from './bake';
import { theCity, wantedDetail } from './city';
import {
  BEDSIDE_FAR,
  BEDSIDE_LAYER,
  CASTER_IDS,
  LANTERN_FAR,
  SHADOW_LEVELS,
  SHADOW_SOFT,
  SHADOW_TURN_MS,
} from './consts';
import { castersOf, lightsOf } from './lights';
import type { CityDetail, PointLight, RoomParts, SpotLight } from './types';

/**
 * At most `cap` real-time lights in the scene (0: all of them), the machine's two included, and whether the lamps cast shadows
 * (`chooseLights`). A capped light leaves the scene (the renderer counts a light at 0), so the lit programs are made again: call it when
 * the setting changes, never by the frame. Its fixture still glows and its baked light stands in (`mixLight`); the frame still sets its
 * level. The machine takes its share from `liveLights`.
 */
export function setLights(room: RoomParts, cap: number, lampShadows: boolean): void {
  room.choice = chooseLights(cap, lampShadows, (id) => (MACHINE_LIGHTS.includes(id) ? 1 : lightsOf(room, id).length));
  for (const id of LIGHT_ORDER) {
    for (const l of lightsOf(room, id)) {
      l.visible = room.choice.live.has(id);
    }
  }
  room.mixKey = '';
  // (a cap set later: the capped lamps' direct light loads now, and the next frame's mix takes it)
  if (cap > 0 && room.bake && !room.bake.direct) {
    void loadCappedDirect(room, room.bake);
  }
  setShadows(room, room.shadowLevel);
}

/** The map sizes a caster may take at a level: the level's, and the smallest (a lamp that casts with the lamps' shadows off: `ALWAYS_CASTS`). */
interface Sizes {
  sizes: readonly number[] | null;
  least: readonly number[] | null;
}

/** The bedside lantern at the smallest map holds only its drawer and the bed (`BEDSIDE_LAYER`) and casts only round it. */
function bedsideReach(l: SpotLight | PointLight, small: boolean): void {
  // (past `BEDSIDE_FAR` its light is not shadowed, as with no map. A shadow camera on layer 0 alone draws the view's layers: three's `WebGLShadowMap`)
  l.shadow.camera.far = small ? BEDSIDE_FAR : LANTERN_FAR;
  l.shadow.camera.layers.set(small ? BEDSIDE_LAYER : 0);
  l.shadow.camera.updateProjectionMatrix();
}

/** Caster `i`'s map at the sizes of the level: none if it may not cast, drawn again on the next frame. */
function casterMap(room: RoomParts, [i, l]: [number, SpotLight | PointLight], { sizes, least }: Sizes): void {
  const id = CASTER_IDS[i];
  if (id === undefined) {
    return;
  }
  const size = room.choice.shadows.has(id) ? ((room.choice.small.has(id) ? least : sizes)?.[i] ?? 0) : 0;
  l.castShadow = size > 0;
  l.shadow.autoUpdate = false;
  l.shadow.needsUpdate = true;
  if (l === room.bedLight) {
    bedsideReach(l, room.choice.small.has(id));
  }
  if (l.shadow.mapSize.x !== size || !size) {
    l.shadow.map?.dispose();
    l.shadow.map = null;
  }
  if (!size) {
    return;
  }
  l.shadow.mapSize.set(size, size);
  l.shadow.radius = (SHADOW_SOFT[i] ?? 0) * (size / (SHADOW_LEVELS[3]?.[i] ?? size));
}

/**
 * The shadow maps at `level` of the graphics settings, for the lights that may cast (`setLights`). A new map is drawn on the next frame; no
 * shadows frees them.
 */
export function setShadows(room: RoomParts, level: number): void {
  room.shadowLevel = level;
  room.outside.setShadows(level);
  const sizes = { sizes: SHADOW_LEVELS[level] ?? null, least: SHADOW_LEVELS[Math.min(level, 1)] ?? null };
  for (const caster of castersOf(room).entries()) {
    casterMap(room, caster, sizes);
  }
}

/**
 * Swaps the city in the window for the one of `d`: the old view is freed at once, the new one is built now (it takes seconds). The swap
 * is synchronous, so the window shows no old picture while the new one waits for its first draw.
 */
export function setCityDetail(room: RoomParts, d: CityDetail): void {
  if (d === room.cityDetail && room.outside.detail === d) {
    return;
  }
  room.outside = theCity(d);
  room.cityDetail = d;
  room.window.add(room.outside.mesh);
  room.outside.setShadows(room.shadowLevel);
}

/** The city in the window at the detail the settings want now, if it changed (`drawOutside`). */
export function followDetail(room: RoomParts): void {
  const want = wantedDetail();
  if (want !== room.cityDetail) {
    setCityDetail(room, want);
  }
}

/** Free what is not under the root: the baked bounce's target. The city stays for the next room: call it before the root is freed. */
export function disposeRoom(room: RoomParts): void {
  room.gone = true;
  // the city first: it is not under the root, and the root's textures go next
  room.outside.mesh.removeFromParent();
  room.lightmap?.dispose();
  room.ispText?.tex.dispose();
  // each caster's shadow map and its depth texture: this room drew them
  room.root.traverse((o) => {
    const s = 'shadow' in o && o.shadow instanceof LightShadow ? o.shadow : undefined;
    if (!s?.map) {
      return;
    }
    s.map.depthTexture?.dispose();
    s.map.dispose();
    s.map = null;
  });
}

/**
 * The lights hold still (the sun moves a step a few times a game hour), so a shadow map holds until a caster moves. Every light asks to catch
 * up (`catchUp`) for the next frame when one moved (`ShadowCache.scan`, which then redraws only the movers), else one light per turn asks:
 * a map redraws only if a caster in its light's range changed since its last draw (a fan's rotor turned), so a still room draws no shadow
 * map. A light at 0 draws none until it is lit (`ShadowCache`).
 */
export function redrawShadows(room: RoomParts, moved: boolean, now: number): void {
  const lights = castersOf(room);
  if (moved) {
    for (const l of lights) {
      catchUp(l);
    }
    return;
  }
  if (now - room.shadowAt < SHADOW_TURN_MS) {
    return;
  }
  room.shadowAt = now;
  const l = lights[room.shadowTurn++ % lights.length];
  if (l) {
    catchUp(l);
  }
}
