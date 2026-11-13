// The 3D room: a bedroom in a high-rise flat round the desk, modern and minimal, dark to sit with the game's interface (slate walls in one even
// plaster whose fine relief only raking light shows, `plasterMaps`; smoked oak,
// black-brown flat-pack furniture, cyan LED light at night; tones in `palette.ts`). A closed box at real sizes (`roomplan.ts`): a glass wall
// behind the desk, floor to ceiling, onto the city in 3D (`outside/view.ts`; the glass looks north and is tinted, so the day stays soft), the
// building's column in it, a stone bench along it; oak planks and a rug, the bed and its bedside drawer east of the desk, a bookcase and the door
// on the west wall (`furniture3d.ts`). On and over the desk: the monitor, keyboard, mouse, tea cup, architect lamp, the key stand; on the
// column: the digital clock, the router on its shelf, the letterbox and the wall plates (`props3d.ts`). x and y of the desk's things come from
// the 2D layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the back wall. The lamps are real lamps (lumens, kelvin) and the
// evening turns them on in steps: the floor lantern and the shelves' strips at dusk, the bed's cyan strips, then the bedside lantern, the
// picture light and the door's sconce; the arc lamp stays on at every hour (the desk's overhead light, through the case's glass: the board
// reads by the room's light, a case needs none of its own); the desk lamp is the player's, the monitor's bias light is on with its screen. The
// lamps and the sun light directly, with their shadows; their bounce on the still meshes is baked (`npm run bake`, `LightmapMix`). The window
// (its sky, by day the sunlit city below it, at night the city's glow) is a wide light: the bake holds all of it on the still meshes, and the
// `key` stands in for it on what moves. The room's probe is the bounce on all that moves. No light fills from nowhere; the eye adapts to the
// dark (`localeye.ts`). The sim knows nothing of it.
import {
  BoxGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, PlaneGeometry, PointLight, Shape, ShapeGeometry, SphereGeometry,
  RectAreaLight, SpotLight, Vector2, type CanvasTexture, type Light, type Material, type Object3D, type PerspectiveCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { KeySnap } from '@/worker/game/types';
import { MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, routerLan, type Rect } from '@/features/board/render/layout/layout';
import { outlinePts, shapeOf, slab } from '@/features/board/render/three/casekit3d';
import { jackFace, jackLook } from '@/features/board/render/three/rj45jack3d';
import { disposeTree, drum, paint, place, post, rectBox, rod, softBox, tube, worldUv } from '@/core/render/three/geometry';
import { mergePalette, mergeStatic } from '@/core/render/three/merge';
import { catchUp } from '@/core/render/three/shadows';
import type { Program } from '@/core/render/three/compile';
import { LightmapMix, STAND_IN_DECAY, applyLightmap, keyFrames, loadBake, type Bake } from '@/core/render/three/lightmapmix';
import { vertexAo } from '@/core/render/three/vertexao';
import { boxEnv, type BoxEnv } from '@/core/render/three/boxenv';
import { cloth, mat, shareMaterials } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { ENV_H, ENV_W, MAIL_S, keyPose, letterPose, mailStage } from '../desk/props/mail';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DigitalClock, KEY_LEAD, Monitor, keyboard, lamp, mouse, notebook, steam, teaCup, type Cup, type Lamp, type Screen } from './props3d';
import { GLASS_T, OutsideView } from './outside/view';
import { M } from './outside/plan';
import {
  OAK_TILE, STRIP_W, arcLamp, bed, board, bookcase, ceilingLight, door, eastWall, floorLantern, grainUv, nightstand, oak, pictureLight, print, sconce, shelfStrips,
  smokedOak, type Lantern,
} from './furniture3d';
import { deskChair } from './chair3d';
import { RoomEnv } from './roomenv';
import { mess } from './clutter3d';
import { FIG_AT, aloe, floorPlant } from './plants3d';
import { CEILING, LANTERN, NEON, NEON_WASH, OAK, OAK_GRAIN, RUG_LINE, RUG_WOOL, STEEL, STONE, TRIM, VENEER, VENEER_GRAIN, WALL, kelvin, rgbOf, shadeOf } from './palette';
import {
  BED, BENCH, CEIL_Y, CLOCK_Y, DESK_D, DESK_TOP, DOOR, EAST_X, FLOOR_Y, FRONT_Z, KEY_STAND, MONITOR_Z, MULLION_X, PED, PIER, RUG, TRAY,
  WALL_T, WEST_X, WINDOW,
  daylight, sunDir, wallAround,
} from './roomplan';
import { LIGHT_ORDER, bounceLift, chooseLights, type LightId } from './roomlights';

const KEY_W = 230;

/**
 * The shadow map sizes at each level of the graphics settings (the window's sky light, the sun, the lamp, the bedside lantern, the floor
 * lantern: a lantern's is a cube of six faces this size; the arc lamp, whose shadows are the board's parts); 0 has no shadows, 3 is the tuned look.
 */
const SHADOW_LEVELS: readonly (readonly number[] | null)[] = [
  null, [1024, 1024, 512, 256, 256, 512], [2048, 1024, 1024, 512, 512, 1024], [4096, 2048, 1024, 1024, 1024, 2048], [8192, 4096, 2048, 2048, 2048, 4096],
];
/** Each light's softness at level 3. It is in map texels, so a map of another size takes its share and the shadow's edge stays as wide. */
const SHADOW_SOFT = [14, 5, 6, 5, 5, 4];
/** A lantern's shadow range (it has no cut-off distance): across the room. */
const LANTERN_FAR = 130000;
/** The bedside lantern's shadow range with the lamps' shadows off: the drawer's whole shadow on the wall, the floor and the bed's side. */
export const BEDSIDE_FAR = 21000;
/**
 * The layer of the casters in the bedside lantern's map with the lamps' shadows off: the drawer and the bed, with what stands on them (they
 * stay on layer 0 too). The drawer stops the light that lit the wall, the floor and the bed's side under it; the rest keeps the small shadows
 * that High shows there (the lantern's stand, the book, the mattress's edge). They do not move, so nothing else in the room redraws that map.
 */
export const BEDSIDE_LAYER = 5;
/** The casters' names in `LIGHT_ORDER`, in `SHADOW_LEVELS`' order. */
const CASTER_IDS: readonly LightId[] = ['key', 'sun', 'desk', 'bedside', 'floor', 'arc'];
/**
 * The window's sky light falls off as its distance to this power: a window is a wide source, gentler than a bulb's square. It marks the key as
 * the window's stand-in: a mesh with the baked light skips it (`STAND_IN_DECAY`).
 */
const KEY_DECAY = STAND_IN_DECAY;
/** The sky light's level is as set at this distance from its source (about the desk's middle). */
const KEY_REF = 24000;
/**
 * The share of the room's own light (the probe, `setProbe`) its materials take as ambient light and reflections. Under 1: one point stands for
 * the whole room, and a bounce loses some.
 */
export const PROBE_K = 1;
/**
 * While nothing large moves, one light at this pace (ms) redraws its shadow map if a fan's rotor turned since its last draw (`catchUp`): a whole
 * round costs one frame's worth, spread out. A still room redraws none.
 */
const SHADOW_TURN_MS = 400;
/** The window's frame sits this far back in its reveal (z of its room face), and the glass a little behind that. */
const FRAME_Z = -1000, GLASS_Z = -1500;
/** The sun is a spot this far out along its direction from the window: its cone covers the opening, its shadow the reveal and the frame. */
const SUN_D = 90000;
/** The plaster texture's size on the walls (units; about 43 cm). */
const PLASTER_TILE = 8000;
/** The sun's key frames for the bake (hours, `tools/bake/`): the baked bounce blends the two round the hour (the owner, 2026-11-06). */
export const SUN_HOURS = [6, 8, 10, 12, 14, 16, 18, 20];
/**
 * The bake's sky and city (a radiance of 1 over their half of the window) against the window's light (`key`): its level at the desk stands
 * for a window's worth of sky, so the radiance is about that level times this.
 */
const SKY_K = 1;
/** By day the city below the horizon is sunlit (its walls, roofs and streets): its light against the sky's, about what a city's ground throws back. */
const CITY_DAY = 0.3;
/**
 * The lamps are real lamps: their light falls off as the square of the distance in metres (decay 2, `M` units a metre), a lamp's level is its
 * lumens over the cone it lights, and a lux on a face is `LUX_K` of the scene's light (the camera's exposure for the room: a task lamp's
 * 2000 lux pool shows bright, a lantern's 60 lux a metre off dim). `lumens(lm, cone)` is a point or spot light's intensity (`cone` its
 * half-angle, a whole sphere by default); `nits(cd)` an area light's, for a face that shows `cd` candela a square metre.
 */
const LUX_K = 1.4e-3;
const lumens = (lm: number, cone = Math.PI): number => lm / (2 * Math.PI * (1 - Math.cos(cone))) * M * M * LUX_K;
const nits = (cd: number): number => cd * LUX_K;
/** The desk lamp's bulb, the bedside lantern's (a 60 W-equivalent bulb in paper), the screen's mean glow (a dark interface, half its white). */
const DESK_LM = 500, LANTERN_LM = 800, SCREEN_NITS = 120;
/** A shelf's LED strip, lumens a metre (a soft strip behind a diffuser); its face's level spreads them over its width, out of one side. */
const STRIP_LM_M = 450, STRIP_NITS = STRIP_LM_M / (Math.PI * STRIP_W / M);
/** The picture light's slot (spread over its face as the strips are), and each of the door sconce's two spots (up, down). */
const PICTURE_LM = 220, SCONCE_LM = 450;
/** The monitor's cyan bias strip round its back: about 2 m of RGB strip at cyan (its green and blue: about half its white's lumens). */
const BIAS_LM = 400;
/**
 * The arc lamp's bulb (a 100 W-equivalent behind the washi): an overhead cozy light, not a work lamp. Its wide pool's edge reaches the board
 * through the case's glass, by day too (the glass looks north and the case faces away from it: by day the board has only the room's bounce).
 */
const ARC_LM = 1600;
/** The print over the bed: its frame (2D y down) on the back wall. */
const PRINT = { x: BED.x + BED.w / 2 - 7600, y: -15800, w: 15200, h: 10800 };

/** The cells of space the palette merge keeps apart (`mergeByPalette`): 2 m, so a view of one corner still culls the rest. */
const PALETTE_CELL = 2 * M;

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The room's light bake (`public/bake/room/`), loaded once a page: null when there is none or it cannot be read. */
let bakeLoad: Promise<Bake | null> | null = null;
const roomBake = (): Promise<Bake | null> => (bakeLoad ??= typeof createImageBitmap === 'undefined' ? Promise.resolve(null)
  : loadBake(`${import.meta.env.BASE_URL}bake/room/`).catch((e: unknown) => { if (import.meta.env.DEV) console.warn('the room light bake did not load:', e); return null; }));
/** Starts loading the room's light bake now, before the room is built (its files load while the build holds the page). */
export const preloadRoomBake = (): void => { void roomBake(); };
/** The city in the window, one for every room (a case of another tier is a new room, but the same view): it takes seconds to build. */
let city: OutsideView | null = null;
const theCity = (): OutsideView => (city ??= new OutsideView(WINDOW.x + WINDOW.w / 2, -(WINDOW.y + WINDOW.h / 2), WINDOW.w, WINDOW.h, GLASS_Z));
/**
 * Builds the city in the window before the room, its sun's shadow at `shadows` of the graphics settings, and starts linking its programs
 * (`compile.ts`): the driver links them while the page builds the room.
 */
export function prepareCity(r: WebGLRenderer, shadows: number): void {
  const c = theCity();
  c.setShadows(shadows);
  c.startPrograms(r);
}

let seedN = 1;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);

/** The plaster's relief: its height in the normal map's slope (per texel), how much smoother the peel's tops are than its pits. */
const PLASTER_RELIEF = 0.12, PLASTER_SHEEN = 0.12;

/**
 * Plaster: one flat paint over a skimmed wall, an even modern finish. Its relief is a fine orange peel from the roller over a faint trowel
 * ripple, seamless across the tile's edges, and it shows only in the light that rakes it (the normal map); the peel's tops are a little
 * smoother than its pits (the roughness map). The paint itself has no clouds: a stain on a wall is the light's, not the paint's. Its own
 * stream of random numbers, so the room's other textures keep theirs.
 */
function plasterMaps(base: string): { map: Texture | null; normalMap: Texture | null; roughnessMap: Texture | null } {
  const N = 512, hgt = new Float32Array(N * N);
  let seed = 4271;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // a lattice of random values per scale (cells of about 1.7 cm, 3.4 mm, 1.7 mm), wrapped at the tile's edge, blended smoothly between its points
  const octaves = [[26, 0.3], [128, 0.75], [256, 0.4]].map(([n, amp]) => ({ n: n!, amp: amp!, v: Array.from({ length: n! * n! }, () => r() * 2 - 1) }));
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (const { n, amp, v } of octaves) {
      const fx = (x / N) * n, fy = (y / N) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = ease(fx - ix), ty = ease(fy - iy);
      const r0 = iy * n, r1 = ((iy + 1) % n) * n, i1 = (ix + 1) % n;
      s += amp * ((v[r0 + ix]! * (1 - tx) + v[r0 + i1]! * tx) * (1 - ty) + (v[r1 + ix]! * (1 - tx) + v[r1 + i1]! * tx) * ty);
    }
    hgt[y * N + x] = s + (r() - 0.5) * 0.2;
  }
  const at = (x: number, y: number) => hgt[((y + N) % N) * N + ((x + N) % N)]!;
  /** One map from the height field: `px(x, y, out)` fills a texel's rgb. */
  const field = (px: (x: number, y: number, o: Uint8ClampedArray, i: number) => void, colour: boolean) => {
    const t = paint(N, N, (c, w, h) => {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, img.data, (y * w + x) * 4);
      c.putImageData(img, 0, 0);
    }, [1, 1]);
    if (t && !colour) t.colorSpace = NoColorSpace;
    return t;
  };
  return {
    // the paint: flat, the peel's pits a hair darker with the dust in them
    map: field((x, y, d, i) => { const k = at(x, y) * 1.2; for (let j = 0; j < 3; j++) d[i + j] = d[i + j]! + k; }, true),
    // the slope by central differences; the canvas runs down, the texture's v up
    normalMap: field((x, y, d, i) => {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * PLASTER_RELIEF, ny = (at(x, y + 1) - at(x, y - 1)) * PLASTER_RELIEF, l = Math.hypot(nx, ny, 1);
      d[i] = 128 + 127 * (nx / l); d[i + 1] = 128 + 127 * (ny / l); d[i + 2] = 128 + 127 / l;
    }, false),
    roughnessMap: field((x, y, d, i) => { d[i] = d[i + 2] = 255; d[i + 1] = 255 * (1 - PLASTER_SHEEN * Math.min(1, Math.max(0, 0.5 + at(x, y) * 0.4))); }, false),
  };
}

/** The blinds' screen: a dark cloth with a soft cloud of light and shade (smooth noise over three scales, seamless) and a fine stipple. */
function screenTex(base: string, repeat: [number, number]): Texture | null {
  return paint(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), d = img.data;
    // a lattice of random values per scale, wrapped at the tile's edge, blended smoothly between its points
    const octaves = [[4, 5], [9, 3], [23, 1.6]].map(([n, amp]) => ({ n: n!, amp: amp!, v: Array.from({ length: n! * n! }, () => rnd() * 2 - 1) }));
    const ease = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (const { n, amp, v } of octaves) {
          const fx = (x / w) * n, fy = (y / h) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = ease(fx - ix), ty = ease(fy - iy);
          const r0 = iy * n, r1 = ((iy + 1) % n) * n, i1 = (ix + 1) % n;
          s += amp * ((v[r0 + ix]! * (1 - tx) + v[r0 + i1]! * tx) * (1 - ty) + (v[r1 + ix]! * (1 - tx) + v[r1 + i1]! * tx) * ty);
        }
        s += (rnd() - 0.5) * 4;
        const o = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) d[o + k] = Math.max(0, Math.min(255, d[o + k]! + s));
      }
    }
    c.putImageData(img, 0, 0);
  }, repeat);
}

/**
 * Smoked oak floor planks running east-west, as a shade of the oak (`smokedOak` gives them its colour and their relief): each board its own
 * tone and grain, a knot here and there, staggered butt joints, the joints dark with a lit edge (an eased bevel). A tile is eight boards; the
 * board that crosses the tile's edge carries on in the next tile, so no joint lines up.
 */
function planksTex(): Texture | null {
  const grain = `rgba(${rgbOf(shadeOf(OAK_GRAIN, OAK)).join(',')},`;
  return paint(1024, 1024, (c, w, h) => {
    const rows = 8, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * ph, cuts = [((r * 0.37 + 0.13) % 1) * w];
      if (r % 2) cuts.push(((r * 0.37 + 0.63) % 1) * w);
      cuts.sort((a, b) => a - b);
      // the boards of this row: between the cuts, and the one through the tile's edge (drawn in two parts, the same board)
      const boards: [number, number][][] = cuts.map((x, k) => (k + 1 < cuts.length ? [[x, cuts[k + 1]!]] : [[x, w], [0, cuts[0]!]]));
      for (const parts of boards) {
        // (a board a few shades from the next, a hair warmer or cooler: one wood, not a patchwork)
        const f = 0.86 + rnd() * 0.14, warm = rnd() * 6, seed = seedN;
        for (const [x0, x1] of parts) {
          seedN = seed;
          c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, ph); c.clip();
          c.fillStyle = `rgb(${255 * f},${255 * f - warm},${255 * f - 2 * warm})`; c.fillRect(0, y0, w, ph);
          // the grain along the board, waved a little; a few lighter streaks
          for (let i = 0; i < 16; i++) {
            const gy = y0 + rnd() * ph, amp = 2 + rnd() * 5;
            c.strokeStyle = rnd() < 0.8 ? `${grain}${0.14 + rnd() * 0.18})` : `rgba(255,255,255,${0.04 + rnd() * 0.05})`; c.lineWidth = 0.8 + rnd() * 1.8;
            c.beginPath(); c.moveTo(0, gy); for (let x = 0; x <= w; x += 64) c.lineTo(x, gy + Math.sin(x / 90 + i) * amp); c.stroke();
          }
          // a knot: dark heart, rings stretched along the board
          if (rnd() < 0.4) {
            const kx = x0 + (0.2 + rnd() * 0.6) * (x1 - x0), ky = y0 + ph * (0.3 + rnd() * 0.4);
            for (let k = 4; k >= 0; k--) { c.fillStyle = `${grain}${0.1 + (4 - k) * 0.08})`; c.beginPath(); c.ellipse(kx, ky, 5 + k * 7, 3 + k * 2.2, 0, 0, Math.PI * 2); c.fill(); }
          }
          c.restore();
        }
      }
      // the long joint above the row (dark, then its lit bevel), the butt joints
      c.fillStyle = 'rgba(22,14,8,0.75)'; c.fillRect(0, y0, w, 3);
      c.fillStyle = 'rgba(255,238,210,0.1)'; c.fillRect(0, y0 + 3, w, 2);
      for (const x of cuts) { c.fillStyle = 'rgba(22,14,8,0.7)'; c.fillRect(x - 1, y0, 2.5, ph); }
    }
  }, [2.4, 3.2]);
}

/** The floor: long smoked oak planks east-west (`planksTex`), wall to wall. */
export function oakFloor(): Mesh {
  const floor = new Mesh(new PlaneGeometry(EAST_X - WEST_X, FRONT_Z), smokedOak(planksTex()));
  floor.rotation.x = -Math.PI / 2; floor.position.set((WEST_X + EAST_X) / 2, -FLOOR_Y, FRONT_Z / 2);
  floor.receiveShadow = true;
  return floor;
}

/** The desk's top: one slab of the floor's smoked oak, its grain along the desk, its edges rounded as all the furniture's (`board`). */
export function deskSlab(g: RoomGeo): Mesh {
  return grainUv(board({ x: g.desk.x0, y: g.ys, w: g.desk.x1 - g.desk.x0, h: DESK_TOP }, 0, DESK_D, smokedOak()), OAK_TILE);
}

/**
 * The drawer unit under the desk's east end: a black-brown carcass from the floor to the top, five fronts with a dark gap round each, a grip
 * cut along each top edge. The carcass and the fronts are `board`s (the furniture's round edges).
 */
export function drawerUnit(g: RoomGeo): Mesh[] {
  const ped = { x: g.desk.x1 - PED.in, y: g.ys + DESK_TOP, w: PED.w, h: FLOOR_Y - g.ys - DESK_TOP };
  const alex = mat(0xffffff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.55 }), slot = mat(0x0c0c0d, { roughness: 0.9 });
  const out = [board(ped, 300, DESK_D - 400, alex), rectBox({ x: ped.x + 260, y: ped.y + 40, w: ped.w - 520, h: ped.h - 80 }, DESK_D - 400, DESK_D - 380, slot)];
  const dh = (ped.h - 160 - 4 * 90) / 5;
  for (let k = 0; k < 5; k++) {
    const d = { x: ped.x + 300, y: ped.y + 80 + k * (dh + 90), w: ped.w - 600, h: dh };
    out.push(board(d, DESK_D - 520, DESK_D - 300, alex), rectBox({ x: d.x + d.w / 2 - 1500, y: d.y, w: 3000, h: 220 }, DESK_D - 310, DESK_D - 290, slot));
  }
  return out;
}

/**
 * A flat-woven wool rug: charcoal, a faint weave of light and dark rows, a thin quiet line inside a plain edge; a fleck of pile (its bump too).
 * One quiet field: the weave and the line stay well under the floor's grain and the bed's cloth.
 */
function rugTex(): Texture | null {
  return paint(1024, 768, (c, w, h) => {
    c.fillStyle = RUG_WOOL; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) for (let y = 0; y < h; y += 6) {
      c.fillStyle = (Math.floor(x / 12) + Math.floor(y / 6)) % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.03)';
      c.fillRect(x, y, 12, 3);
    }
    for (let k = 0; k < 14000; k++) { c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.08})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    const m = 54;
    c.globalAlpha = 0.35; c.strokeStyle = RUG_LINE; c.lineWidth = 2; c.strokeRect(m, m, w - 2 * m, h - 2 * m); c.globalAlpha = 1;
  });
}

/**
 * The room's merge by palette after the bake (`Room3D.mergeByPalette`): only a material that takes the room's reflections joins (`envs`), the
 * palette materials join them, and a material no mesh draws with any more leaves them. Each merged mesh keeps its hash and its place for the
 * bake's export (`partsOf`, `tools/bake/scene.ts`), so the next bake finds the same receivers and blockers.
 */
export function mergeAfterBake(root: Object3D, envs: RoomEnv, skip: readonly Object3D[]): number {
  return mergePalette(root, {
    skip, cell: PALETTE_CELL, ok: (m) => envs.mats.has(m as MeshStandardMaterial),
    twin: (src, c) => envs.twin(src, c), drop: (m) => envs.mats.delete(m as MeshStandardMaterial),
  });
}

/** The area lights' tables (once per page): a `RectAreaLight` lights nothing without them. */
let areaLights = false;

export interface RoomFrame { hour: number; lamp: boolean; blind: boolean; screen: Screen; /** The tier of the router on its spot (1 to 4), or 0 for none. */ router: number; /** The ISP plan's tier (0 to 5), and whether an upload waits or goes out (the letterbox's light). */ isp: number; ispName: string; mail: boolean; t: number }

export class Room3D {
  readonly root = new Group();
  readonly geo: RoomGeo;
  private keys = new Group();
  /** The mouse: its stand-in shell hides once the model loads, so the palette merge leaves it alone. */
  private mouse!: Group;
  private sun = new SpotLight(0xfff0d8, 0, 0, 0.17, 0.35, 0);
  /** The sky's light through the window: a wide soft spot out behind it, so the wall's shadow lets it in by the opening only. */
  private key = new SpotLight(0xd4e2ff, 0, 0, 1.05, 0.9, KEY_DECAY);
  /** The window's light at the desk from the sky and from the lit city, and the sun's that comes in (the bake's levels: `mixLight`). */
  private skyK = 0;
  private cityK = 0;
  private sunK = 0;
  private hour = 12;
  /** The baked bounce once its files are in, and the light it was last summed for. */
  private lightmap: LightmapMix | null = null;
  private mixKey = '';
  private gone = false;
  private lampLight = new SpotLight(kelvin(3000), 0, 0, 0.6, 0.7, 2);
  private bedLight = new PointLight(LANTERN, 0, 0, 2);
  /** The screen's glow on the keyboard and the desk: an area light on its face, lighting only what is in front of it. */
  private screenLight = new RectAreaLight(0xa8cfff, 0, 1, 1);
  private outside: OutsideView;
  private blinds: Mesh[] = [];
  private blindK = 0;
  private sunKey = -1;
  private keysKey = '';
  private lamp: Lamp;
  private monitor: Monitor;
  private monitorSpot!: Mesh;
  private routerBody!: Group;
  private routerTier = 0;
  private readonly ispDots: MeshStandardMaterial[] = [];
  private mailLed!: MeshStandardMaterial;
  private ispText: { cv: HTMLCanvasElement; tex: CanvasTexture; shown: string } | null = null;
  private routerBuild!: (tier: number) => void;
  private routerSpot!: Mesh;
  private clock: DigitalClock;
  private cup: Cup;
  private shade: MeshStandardMaterial;
  private bulbGlow: MeshStandardMaterial;
  /** The tall paper lantern by the bookcase, and its bulb's light (it comes on at dusk). */
  private floorLamp: Lantern;
  private floorLight = new PointLight(LANTERN, 0, 0, 2);
  /** The warm strips under the bookcase's boards and the east shelf (`shelfStrips`): their lines and their lights. */
  private strips = shelfStrips();
  /** The picture light over the print and the sconce by the door (they come on as night falls). */
  private picture = pictureLight(PRINT, 0);
  private sconce = sconce();
  /** The arc lamp over the desk east of the case: an overhead cozy light (on at every hour: `ARC_LM`). */
  private arc = arcLamp();
  /** The bed's LED strips, and the area lights they stand for (the floor round the bed, the wall over the headboard). */
  private ledGlow: MeshStandardMaterial;
  private ledUnder: RectAreaLight;
  private ledHalo: RectAreaLight;
  /** The LED strip under the desk's front edge, the same light. */
  private deskLed = new RectAreaLight(NEON_WASH, 0, 1, 1);
  /** The room's materials that take the environment's reflections: the studio's, dimmed at night, until the probe has the room's own. */
  private envs: RoomEnv;
  private probe = false;
  /** The room's box for the probe's reflections (boxenv.ts): on once the probe holds the room. */
  private box: BoxEnv;
  /** Where the room's probe sees from (world): over the desk's front, in the room's middle height. */
  readonly probeAt: [number, number, number];
  /**
   * Resolves once the bake's lightmap is on the meshes (or there is none): it changes their programs, so they are linked after it
   * (`docs/render/load.md`). The bake's files load once a page.
   */
  readonly ready: Promise<void>;
  /** What the room's light depends on, coarsely: a new value asks for a new capture of the probe. */
  lightKey = '';

  constructor(env: Texture | null = null) {
    this.geo = roomGeo();
    const g = this.geo, R = this.root, ys = g.ys, fl = FLOOR_Y, deskTop = -ys, H = fl - CEIL_Y;
    if (!areaLights) { RectAreaLightUniformsLib.init(); areaLights = true; }
    const graphite = mat(0x23262b, { roughness: 0.3 }), trim = mat(TRIM, { roughness: 0.5 });
    const chrome = mat(0xc9cdd2, { metalness: 0.85, roughness: 0.25 });
    const dark = mat(0x2a2c31, { roughness: 0.5 });
    // one plaster on every wall, its texture at one size on each piece and running on across the pieces (`worldUv`)
    const plaster = mat(0xffffff, { ...plasterMaps(WALL), normalScale: new Vector2(1, 1), roughness: 0.92 }), wall = (r: Rect, z0: number, z1: number) => worldUv(rectBox(r, z0, z1, plaster), PLASTER_TILE);
    const W = WINDOW;

    // ---- the back wall: plaster round the glass (a slot over it, a low upstand under it, the corner to the west, the bed's wall to the east)
    // and the building's column in it, which carries the things on the wall ----
    for (const r of wallAround(WEST_X, EAST_X, CEIL_Y, fl, W)) R.add(wall(r, -WALL_T, 0));
    R.add(wall({ x: PIER.x0, y: W.y, w: PIER.x1 - PIER.x0, h: W.h }, -WALL_T, 0));

    // ---- the other walls, the ceiling (they take light, they cast no shadow: the eye is always inside) ----
    const shell = (m: Mesh) => { m.castShadow = false; return m; };
    R.add(shell(wall({ x: WEST_X - 1200, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200)));
    R.add(shell(wall({ x: EAST_X, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200)));
    R.add(shell(wall({ x: WEST_X - 1200, y: CEIL_Y, w: EAST_X - WEST_X + 2400, h: H }, FRONT_Z, FRONT_Z + 1200)));
    R.add(shell(rectBox({ x: WEST_X - 1200, y: CEIL_Y - 1200, w: EAST_X - WEST_X + 2400, h: 1200 }, -WALL_T, FRONT_Z + 1200, mat(CEILING, { roughness: 0.95 }))));
    // a low flush skirting, square-edged, and a shadow gap where the walls meet the ceiling (no cornice); the door breaks the skirting on the west wall
    const skirt = (r: Rect, z0: number, z1: number, m: Material = trim) => R.add(shell(softBox(r, z0, z1, m, 20)));
    const SK = 1100, run = (x0: number, x1: number, z0: number, z1: number, out: 'x' | '-x' | 'z' | '-z') => {
      const r = out === 'z' || out === '-z' ? { x: x0, y: fl - SK, w: x1 - x0, h: SK } : out === 'x' ? { x: x0, y: fl - SK, w: 110, h: SK } : { x: x1 - 110, y: fl - SK, w: 110, h: SK };
      skirt(r, out === 'z' ? z0 : out === '-z' ? z1 - 110 : z0, out === 'z' ? z0 + 110 : z1);
    };
    run(WEST_X, EAST_X, 0, 0, 'z');
    run(WEST_X, WEST_X, 0, DOOR.z0 - 980, 'x');
    run(WEST_X, WEST_X, DOOR.z1 + 980, FRONT_Z, 'x');
    run(EAST_X, EAST_X, 0, FRONT_Z, '-x');
    run(WEST_X, EAST_X, FRONT_Z, FRONT_Z, '-z');
    const gap = mat(0x16171a, { roughness: 0.9 });
    skirt({ x: WEST_X, y: CEIL_Y, w: EAST_X - WEST_X, h: 220 }, 0, 40, gap);
    skirt({ x: WEST_X, y: CEIL_Y, w: 40, h: 220 }, 0, FRONT_Z, gap);
    skirt({ x: EAST_X - 40, y: CEIL_Y, w: 40, h: 220 }, 0, FRONT_Z, gap);

    // ---- the floor: long smoked oak planks; a flat charcoal rug under the bed's west side (`RUG`) ----
    R.add(oakFloor());
    const pile = rugTex();
    const rug = softBox({ x: RUG.x0, y: fl - RUG.h, w: RUG.x1 - RUG.x0, h: RUG.h }, RUG.z0, RUG.z1, cloth(0xffffff, { map: pile, bumpMap: pile, bumpScale: 1, roughness: 0.97 }), 140);
    rug.castShadow = false;
    R.add(rug);

    // ---- the glass wall: slim black aluminium frames set back in the reveal, a pane a bay (the column parts two bays, a mullion parts the west
    // one), one picture of the city behind them all; a roller blind in each bay, its cassette at the top of the reveal ----
    // (matt enough that the sky light's one spot, a large light in truth, leaves no glint on a frame's rounded edge for the bloom to spread)
    const winG = tag(new Group(), 'blind'), bar = 300, fz0 = FRAME_Z - 700, alu = mat(0x1e1f22, { metalness: 0.5, roughness: 0.6 });
    const bays = [{ x0: W.x, x1: PIER.x0 }, { x0: PIER.x1, x1: W.x + W.w }];
    for (const b of bays) {
      const w = b.x1 - b.x0;
      for (const r of [{ x: b.x0, y: W.y, w, h: bar }, { x: b.x0, y: W.y + W.h - bar, w, h: bar }, { x: b.x0, y: W.y, w: bar, h: W.h }, { x: b.x1 - bar, y: W.y, w: bar, h: W.h }]) winG.add(softBox(r, fz0, FRAME_Z, alu, 30));
    }
    winG.add(softBox({ x: MULLION_X - bar / 2, y: W.y + bar, w: bar, h: W.h - 2 * bar }, fz0, FRAME_Z, alu, 30));
    const glass = seeThrough(new Mesh(new PlaneGeometry(W.w, W.h), new MeshStandardMaterial({ color: 0xdbeaff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.2, depthWrite: false })));
    glass.position.set(W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z + 100);
    this.outside = theCity();
    winG.add(this.outside.mesh, glass);
    const cassette = mat(0x2a2d33, { roughness: 0.5 }), screen = mat(0xffffff, { map: screenTex('#4b5059', [2, 4]), roughness: 0.9, side: DoubleSide });
    for (const b of bays) {
      winG.add(softBox({ x: b.x0 + 150, y: W.y, w: b.x1 - b.x0 - 300, h: 900 }, -900, -150, cassette, 120));
      const blind = place(new Mesh(new BoxGeometry(b.x1 - b.x0 - 500, 1, 40), screen));
      blind.position.set((b.x0 + b.x1) / 2, -(W.y + 900), -500);
      this.blinds.push(blind);
      winG.add(blind);
    }
    R.add(winG);
    // the bench along the glass west of the desk: a slab of dark stone at seat height on a plinth set in, in the trim's tone; the aloe on it
    const B = BENCH, stone = mat(STONE, { roughness: 0.3 });
    R.add(softBox({ x: B.x0, y: B.top, w: B.x1 - B.x0, h: 600 }, B.z0, B.z1, stone, 60));
    R.add(softBox({ x: B.x0 + 500, y: B.top + 600, w: B.x1 - B.x0 - 1000, h: fl - B.top - 600 }, B.z0 + 300, B.z1 - 700, trim, 40));
    R.add(aloe(B.x1 - 2600, B.top, (B.z0 + B.z1) / 2));

    // ---- the furniture: the bed and its LED strips, the bedside drawer and its lantern, the bookcase, the door, the ceiling light, a print over
    // the bed, plants ----
    const bd = bed(), ns = nightstand();
    this.ledGlow = bd.glow; this.ledUnder = bd.under; this.ledHalo = bd.halo;
    // (every strip casts the one pale wash, the desk's too)
    this.ledUnder.color.setHex(NEON_WASH); this.ledHalo.color.setHex(NEON_WASH);
    this.shade = ns.shade;
    this.bulbGlow = ns.glow;
    this.bedLight.position.set(...ns.bulb);
    // the lantern's shadow: the nightstand, the bed and the pillows in its light, softly
    // (a light with no cut-off distance keeps its shadow camera's own range: it must reach across the room)
    Object.assign(this.bedLight.shadow.camera, { near: 200, far: LANTERN_FAR }); this.bedLight.shadow.bias = -0.002; this.bedLight.shadow.normalBias = 20;
    // (a lantern's paper and its bulb let the light through: they cast no shadow, the paper glows with it)
    const glassy = (l: Lantern) => l.root.traverse((o) => { const m = (o as Mesh).material; if (m === l.shade || m === l.glow) o.castShadow = false; });
    glassy(ns);
    for (const r of [ns.root, bd.root]) r.traverse((o) => { if (o.castShadow) o.layers.enable(BEDSIDE_LAYER); });
    // the floor lantern's shadow: the bookcase's end, the fig's leaves on the west wall and the floor
    this.floorLamp = floorLantern();
    glassy(this.floorLamp);
    this.floorLight.position.set(...this.floorLamp.bulb);
    Object.assign(this.floorLight.shadow.camera, { near: 200, far: LANTERN_FAR }); this.floorLight.shadow.bias = -0.002; this.floorLight.shadow.normalBias = 20;
    const top = ceilingLight(4000, CEIL_Y, 30000);
    R.add(bd.root, ns.root, bookcase(), door(), top.root, floorPlant(FIG_AT.x, FIG_AT.z), eastWall(), this.bedLight, this.floorLamp.root, this.floorLight, this.strips.root);
    R.add(print(PRINT, 0), this.picture.root, this.sconce.root, this.arc.root);
    // (the arc lamp's shadow reaches from its dome to the floor)
    const al = this.arc.light;
    Object.assign(al.shadow.camera, { near: 300, far: 60000 }); al.shadow.bias = -0.0005; al.shadow.normalBias = 10;

    // ---- the desk: a smoked oak top (the floor's and the slats' wood) on two round black steel legs at the west end and a black-brown drawer
    // unit at the east end, a cable tray under its back edge ----
    const legH = fl - ys - DESK_TOP;
    R.add(deskSlab(g));
    // the legs: round steel tubes screwed into plates under the top, a plastic foot on each
    const steel = mat(STEEL, { roughness: 0.45, metalness: 0.4 }), tx = g.desk.x0 + 1000;
    for (const z of [1000, DESK_D - 1000]) {
      R.add(post(tx, fl - 200, z, 280, legH - 200, steel, 24), post(tx, fl, z, 300, 200, mat(0x111214, { roughness: 0.8 }), 24));
      R.add(softBox({ x: tx - 600, y: ys + DESK_TOP, w: 1200, h: 60 }, z - 600, z + 600, steel, 20));
    }
    // the drawer unit at the east end
    R.add(...drawerUnit(g));
    const pedX = g.desk.x1 - PED.in;
    // the cable tray: a black steel trough hung under the top's back edge (the power strip lies in it, `clutter3d.ts`) on two brackets
    const t = TRAY, under = ys + DESK_TOP, ty = under + t.drop;
    for (const [z0, z1] of [[t.z0, t.z0 + 60], [t.z1 - 60, t.z1]] as const) R.add(softBox({ x: t.x0, y: ty, w: t.x1 - t.x0, h: t.h }, z0, z1, steel, 20));
    R.add(softBox({ x: t.x0, y: ty + t.h - 60, w: t.x1 - t.x0, h: 60 }, t.z0, t.z1, steel, 20));
    for (const x of [t.x0, t.x1 - 60]) R.add(softBox({ x, y: ty, w: 60, h: t.h }, t.z0, t.z1, steel, 20));
    for (const x of [t.x0 + 1500, t.x1 - 1500]) R.add(softBox({ x: x - 200, y: under, w: 400, h: t.drop }, t.z1 - 400, t.z1, steel, 20));
    // a cyan LED strip under the top's front edge, as round the bed: at night the desk floats on its glow. Its area light is a narrow band
    // along the strip (a wide one would show as a bright box in the glass behind the desk), stopping short of the drawer unit so its side
    // does not catch the light at point-blank range (a hard bright edge)
    const knee0 = g.desk.x0 + 600, knee1 = pedX - 200, lit1 = pedX - 2200;
    R.add(rectBox({ x: knee0, y: under, w: knee1 - knee0, h: 120 }, DESK_D - 700, DESK_D - 540, this.ledGlow));
    this.deskLed.width = lit1 - knee0; this.deskLed.height = 1600;
    this.deskLed.position.set((knee0 + lit1) / 2, -under - 200, DESK_D - 1400);
    this.deskLed.rotation.x = -Math.PI / 2;
    R.add(this.deskLed);

    // ---- on the desk: the monitor, the keyboard on its felt mat, the mouse, a tea cup on its saucer, a notebook ----
    this.monitor = new Monitor(MONITOR, SCREEN, ys, MONITOR_Z);
    R.add(this.monitor.root, this.monitor.bias);
    const kx = MONITOR.x + MONITOR.w / 2, kz = MONITOR_Z + 3600;
    const felt = paint(512, 192, (c, w, h) => {
      c.fillStyle = '#5b6168'; c.fillRect(0, 0, w, h);
      for (let k = 0; k < 4000; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }
      // the stitched edge
      c.strokeStyle = 'rgba(30,32,36,0.8)'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
      c.strokeStyle = 'rgba(205,200,190,0.55)'; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.strokeRect(9, 9, w - 18, h - 18);
    });
    const matEnd = kx + 4800;
    R.add(softBox({ x: kx - 5200, y: ys - 40, w: matEnd - (kx - 5200), h: 40 }, kz - 2100, kz + 2100, mat(0xffffff, { map: felt, roughness: 0.97 }), 20));
    this.mouse = mouse(kx + 4100, ys, kz + 200, (o) => this.envs.adopt(o));
    R.add(keyboard(kx, ys, kz), this.mouse, notebook(-16600, ys, 10000, 0.22));
    // the grommet the keyboard's cable goes down through, near the wall: a black cap on the top, its sleeve under it, over the tray
    const grommet = { x: kx + KEY_LEAD[0], z: kz + KEY_LEAD[1] }, cap = mat(0x111214, { roughness: 0.6 });
    R.add(post(grommet.x, ys, grommet.z, 420, 20, cap, 24), post(grommet.x, under + 300, grommet.z, 300, 300, cap, 20));
    // the chair, half under the desk west of the keyboard, turned toward the window as left after use
    R.add(deskChair(kx - 7500, DESK_D + 2600, -0.3, (o) => this.envs.adopt(o)));
    // the things about: a backpack against the drawer unit, the power strip in the tray and its leads, books on the bench
    R.add(mess(pedX, under, grommet));
    // (the tea by the mat's end: west of the PC's mains cord, which runs from the case's side to the desk's grommet and must stay in view)
    this.cup = teaCup(matEnd + 560, ys, MONITOR_Z + 3200);
    R.add(this.cup.root);

    // ---- the architect lamp ----
    const lx = g.lamp.x;
    this.lamp = lamp({ x: lx, y: ys }, { x: lx - 1300, y: ys - 3900 }, g.lamp.head, g.lamp.mouth, 2600);
    R.add(this.lamp.root);
    const [mx, my, mz] = this.lamp.mouth;
    this.lampLight.position.set(mx, my, mz);
    this.lampLight.target.position.set(mx + this.lamp.dir[0] * 4000, deskTop, mz + 2500);
    this.lampLight.castShadow = true; this.lampLight.shadow.mapSize.set(1024, 1024); this.lampLight.shadow.bias = -0.0005; this.lampLight.shadow.radius = 6;
    Object.assign(this.lampLight.shadow.camera, { near: 200, far: 90000 });
    R.add(this.lampLight, this.lampLight.target);

    // ---- on the building's column: the clock over the router on its shelf, the letterbox, the plates ----
    this.clock = new DigitalClock({ ...g.clock, x: (PIER.x0 + PIER.x1) / 2 - g.clock.w / 2, y: CLOCK_Y });
    R.add(this.clock.root);
    // ---- the key stand on the desk west of the monitor: the 2D rack's two rows of hooks on a black steel frame, two uprights on feet. It is
    // the rack moved off the wall (`standAt`), so the keys keep their 2D places in it; the lowest key hangs clear of the desk ----
    const rack = tag(new Group(), 'tray'), kr = g.keyRack, bar1 = kr.x + kr.w + 210;
    const low = Math.max(...[5, 6, 7, 8, 9].map((i) => trayKeyCentre(i).y)) + KEY_LEN / 2, foot = low + 300;
    for (let row = 0; row < 2; row++) {
      const y = trayHook(row * 5).y;
      rack.add(softBox({ x: kr.x + 120, y: y - 110, w: kr.w - 240 + row * 330, h: 220 }, 0, 200, dark, 40));
      for (let col = 0; col < 5; col++) { const h = trayHook(row * 5 + col); rack.add(drum(h.x, h.y, 200, 420, 40, chrome, 10)); }
    }
    const rackTop = trayHook(0).y - 300;
    for (const x of [kr.x - 60, bar1]) {
      rack.add(softBox({ x, y: rackTop, w: 180, h: foot - rackTop }, -40, 240, steel, 40));
      rack.add(softBox({ x: x - 40, y: foot - 140, w: 260, h: 140 }, -900, 1300, steel, 40));
    }
    // (a new key's letter comes to the stand: it is in `keys`, so it floats in beside the rack as on the 2D wall)
    const stand = new Group();
    stand.position.set(KEY_STAND.x - kr.x, foot - ys, KEY_STAND.z);
    stand.add(rack, this.keys);
    R.add(stand);
    R.add(softBox({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 600, h: 140 }, 0, 1700, dark, 30));
    // the router: black, as the other things on the wall
    const router = tag(new Group(), 'router');
    // (its baked occlusion, 3 cm out: the antennas' hinges, its foot on the shelf; `vertexao.ts`)
    router.userData.ao = 560;
    // its tier's look (`net.router.visual`, as the 2D drawings): the home router with its two aerials and four lights; the gigabit one, broader,
    // with a row of ports and a bright status; the 10G switch-router: no aerials, a port row and a lit strip; the core router: a deep rack unit
    // with two rows of lights and a blue strip
    const rs = ROUTER_SPOT, ledY = rs.y + rs.h * 0.6, aerial = mat(0x2a2d31, { roughness: 0.45 }), jackSteel = mat(0x9ea5ae, { metalness: 0.8, roughness: 0.44 });
    // (its jacks are the board's rear I/O's, rj45jack3d's `jackFace`: 160 across, 124 tall, their mouths 180 deep)
    const PORT = { w: 160, h: 124 }, DEEP = 180, lan = routerLan();
    const build = (tier: number) => {
      for (const c of [...router.children]) { router.remove(c); disposeTree(c, true); }
      const strip = tier >= 3 ? 0x4aa8ff : NEON, led = mat(0x111111, { emissive: new Color(strip), emissiveIntensity: tier >= 2 ? 2.4 : 1.8 });
      const top = tier >= 4 ? 1500 : 1400, body = mat(tier >= 3 ? 0x1b1d21 : STEEL, { roughness: 0.4 }), look = jackLook(jackSteel);
      // its port row (the gigabit one and up): jacks sunk into the front. The body stops behind them, and a front slab open at each jack closes
      // it (a solid box would fill the mouths)
      const ports = tier >= 2 ? [0, 1, 2, 3].map((k) => rs.x + 1600 + k * 180) : [], front = ports.length ? top - DEEP : top;
      router.add(softBox(ROUTER_SPOT, 300, front, body, 80));
      router.add(softBox({ x: rs.x, y: rs.y, w: rs.w, h: 120 }, 300, Math.min(1400, front), mat(0x2a2c30, { roughness: 0.4 }), 40));
      if (ports.length) {
        const span = (px: number) => ({ y0: ledY - PORT.h / 2, y1: ledY + PORT.h / 2, z0: px - PORT.w / 2, z1: px + PORT.w / 2 });
        const holes = ports.map((px) => outlinePts({ x: px - PORT.w / 2, y: ledY - PORT.h / 2, w: PORT.w, h: PORT.h }, 0));
        router.add(slab(shapeOf(outlinePts(ROUTER_SPOT, 80, undefined, 2), holes), front - 80, top, body));
        // (the jacks are built as a wall across x: turned, their mouths face the room, across x, the latch slots down; the faces 3 in)
        const row = new Group();
        row.rotation.y = Math.PI / 2;
        for (const px of ports) jackFace(row, -(top - 3), span(px), DEEP, look);
        router.add(row);
      }
      // the LAN jack on its east side, where the lead's plug stays (turned to face east)
      const side = new Group();
      side.rotation.y = Math.PI;
      jackFace(side, -lan.x, { y0: lan.y - PORT.h / 2, y1: lan.y + PORT.h / 2, z0: -lan.z - PORT.w / 2, z1: -lan.z + PORT.w / 2 }, DEEP, look);
      router.add(side);
      // its front: a darker strip with the status lights, vents over its top
      router.add(softBox({ x: rs.x + 250, y: ledY - 70, w: 1250, h: 140 }, top - 5, top + 10, mat(0x0d0e10, { roughness: 0.5 }), 30));
      for (let k = 0; k < 4; k++) router.add(drum(rs.x + 420 + k * 280, ledY, top + 5, top + 25, 36, led, 8));
      for (let k = 0; k < 6; k++) router.add(rectBox({ x: rs.x + 500 + k * 220, y: rs.y - 4, w: 90, h: 8 }, 600, 1100, mat(0x08090a, { roughness: 0.8 })));
      if (tier >= 4) for (let k = 0; k < 8; k++) router.add(drum(rs.x + 420 + k * 140, ledY + 210, top + 5, top + 25, 24, led, 8));
      if (tier >= 3) return; // a switch-router has no aerials
      for (const [ax, lean] of [[rs.x + 260, -0.12], [rs.x + rs.w - 260, 0.12]] as const) {
        const base: [number, number, number] = [ax, -rs.y + 60, 450], tip: [number, number, number] = [ax + Math.sin(lean) * 3000, -rs.y + 60 + Math.cos(lean) * 3000, 300];
        const knuckle = new Mesh(new SphereGeometry(tier >= 2 ? 160 : 130, 12, 8), aerial);
        knuckle.position.set(...base);
        router.add(place(knuckle), rod(base, tip, tier >= 2 ? 120 : 95, aerial, 10));
      }
    };
    this.routerBuild = (tier) => { if (tier !== this.routerTier) { this.routerTier = tier; build(tier); } };
    this.routerBuild(1);
    R.add(router);
    // the router's empty place: an unseen box a router dragged from the inventory lands on (`router`), there while no router stands
    this.routerBody = router;
    this.routerSpot = tag(rectBox(ROUTER_SPOT, 300, 1400, new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false })), 'router');
    this.routerSpot.castShadow = this.routerSpot.receiveShadow = false;
    R.add(this.routerSpot);
    // (the LAN lead is the machine's: a cable with a plug to move, `Machine3D.buildRoomCords`)
    // the letterbox: powder-coated black steel, as the other things on the wall
    const box = tag(new Group(), 'mail');
    box.add(softBox(OUTBOX, 0, 700, mat(STEEL, { roughness: 0.45 }), 70));
    box.add(rectBox({ x: OUTBOX.x + 180, y: OUTBOX.y - 10, w: OUTBOX.w - 360, h: 30 }, 200, 500, mat(0x08090a, { roughness: 0.8 })));
    // its front door (a panel in a fine seam), a name plate, the lock
    const ob = OUTBOX, front = mat(0x232428, { roughness: 0.45 });
    box.add(rectBox({ x: ob.x + 70, y: ob.y + 150, w: ob.w - 140, h: ob.h - 220 }, 700, 704, mat(0x08090a, { roughness: 0.6 })));
    box.add(softBox({ x: ob.x + 85, y: ob.y + 165, w: ob.w - 170, h: ob.h - 250 }, 700, 730, front, 20));
    box.add(softBox({ x: ob.x + 260, y: ob.y + 260, w: ob.w - 520, h: 130 }, 730, 742, mat(0xefe7d4, { roughness: 0.6 }), 10));
    box.add(drum(ob.x + ob.w - 200, ob.y + ob.h - 220, 730, 760, 55, chrome, 12), rectBox({ x: ob.x + ob.w - 212, y: ob.y + ob.h - 250, w: 24, h: 60 }, 760, 764, dark));
    R.add(box);
    const plate = g.socket.plate, socket = tag(new Group(), 'socket');
    socket.add(softBox(plate, 0, 80, graphite, 30));
    for (const o of [g.socket.mon, g.socket.pc]) socket.add(drum(o.x, o.y, 80, 100, 220, mat(0x15161a, { roughness: 0.6 }), 20));
    // the ISP's wall plate: on the column under the letterbox, right of the monitor, where the room's view sees it (the 2D plate is under the desk)
    const ISP_PLATE: Rect = { x: OUTBOX.x + (OUTBOX.w - WALL_PLATE.w) / 2, y: -1700, w: WALL_PLATE.w, h: WALL_PLATE.h };
    const plateBox = tag(softBox(ISP_PLATE, 0, 80, graphite, 30), 'wall');
    // the ISP line's tier: five small lights along the wall plate, lit up to the plan's tier
    for (let k = 0; k < 5; k++) {
      const m = new MeshStandardMaterial({ color: 0x111111, emissive: new Color(NEON), emissiveIntensity: 0 });
      const d = drum(ISP_PLATE.x + ISP_PLATE.w * (0.14 + k * 0.18), ISP_PLATE.y + ISP_PLATE.h * 0.8, 80, 96, ISP_PLATE.w * 0.04, m, 8);
      this.ispDots.push(m);
      R.add(d);
    }
    // the plan's name under the lights, small print on the plate (drawn on a canvas when the plan changes)
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 128;
      const tex = rawSrgb(cv);
      const face = new Mesh(new PlaneGeometry(ISP_PLATE.w * 0.84, ISP_PLATE.h * 0.26), Object.assign(new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }), { defines: { ...DECODE_SRGB } }));
      face.position.set(ISP_PLATE.x + ISP_PLATE.w / 2, -(ISP_PLATE.y + ISP_PLATE.h * 0.5), 82);
      this.ispText = { cv, tex, shown: '\u0000' };
      R.add(seeThrough(face));
    }
    R.add(socket, plateBox);
    // the letterbox's light: on while an upload waits or goes out
    const mailM = new MeshStandardMaterial({ color: 0x111111, emissive: new Color(0xffb347), emissiveIntensity: 0 });
    box.add(drum(ob.x + 180, ob.y + 215, 730, 750, 28, mailM, 10));
    this.mailLed = mailM;

    // ---- light: the window carries the day (the sky's soft light and the sun, both let in by the opening alone, so the room is lit from one
    // side and falls off away from it); the room's bounce is baked on the still meshes (`takeBake`) and its probe on the rest (`setProbe`);
    // the lamps, the screen ----
    const cx = (g.desk.x0 + g.desk.x1) / 2;
    const wc = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const;
    // high and far out behind the glass's middle: the north sky's light comes down through the whole glass wall onto the desk
    this.key.position.set(wc[0], wc[1] + 12000, -WALL_T - 20000);
    this.key.target.position.set(cx - 4000, deskTop - 2000, DESK_D + 4000);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    Object.assign(this.key.shadow.camera, { near: 2000, far: 140000 });
    this.key.shadow.bias = -0.0003; this.key.shadow.normalBias = 20; this.key.shadow.radius = 14;
    R.add(this.key, this.key.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: SUN_D - 30000, far: SUN_D + 90000 });
    this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 30; this.sun.shadow.radius = 5;
    R.add(this.sun, this.sun.target);
    // (on the panel's face, turned to the room: an area light shines along its -z)
    this.screenLight.width = SCREEN.w; this.screenLight.height = SCREEN.h;
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 200);
    this.screenLight.rotation.y = Math.PI;
    R.add(this.screenLight);
    this.probeAt = [cx, deskTop + 3500, DESK_D + 5000];

    // the room's own reflections: the studio's environment at first, set on each of its materials so the evening can dim them, then the probe's;
    // a model that loads late (the mouse, the hoodie) joins them
    this.box = boxEnv([WEST_X, -FLOOR_Y, 0], [EAST_X, -CEIL_Y, FRONT_Z], this.probeAt);
    this.envs = new RoomEnv(env, this.box);
    this.envs.adopt(R);
    // the props' and the plants' baked occlusion (cast once here), then the still scenery in few draws
    vertexAo(R);
    mergeStatic(R);
    this.share();
    // the monitor's empty place on the desk: an unseen box a part dragged from the inventory lands on (`display0`), there only while no monitor stands
    const spotM = new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this.monitorSpot = tag(rectBox({ x: MONITOR.x, y: MONITOR.y, w: MONITOR.w, h: MONITOR.h }, MONITOR_Z - 300, MONITOR_Z + 400, spotM), 'display0');
    this.monitorSpot.castShadow = this.monitorSpot.receiveShadow = false;
    R.add(this.monitorSpot);
    // the baked bounce once its files are in; until then, and on a mesh the bake does not know, the probe's. Then the still scenery by palette
    this.ready = roomBake().then((b) => { if (this.gone) return; if (b) this.takeBake(b); this.mergeByPalette(); });
  }

  /**
   * The still meshes whose materials differ only in colour, roughness and metalness as one mesh a cell of space (`mergePalette`): fewer draws
   * and fewer changes of material a frame. After the bake, as each keeps its light map's UVs (the bake's export reads the meshes it took in).
   * Only materials that take the room's reflections join; the key rack is built again with each key, the mouse's stand-in hides when the
   * model is in (it can come after the bake).
   */
  private mergeByPalette(): void { mergeAfterBake(this.root, this.envs, [this.keys, this.mouse]); }

  /**
   * Starts linking the programs the window's view draws with (`compile.ts`): the room's own come with the scene it stands in. Call it after a
   * first `frame`, so its lights stand as they will be drawn.
   */
  startPrograms(r: WebGLRenderer, scene: Scene): Program[] { return this.outside.startPrograms(r, scene); }

  /**
   * The baked bounce's light groups: the lights the room scales by one value (a switch, a step of the evening). `tools/bake/` bakes each at
   * its lights' full power, and the mix scales it by its first light's intensity over the one baked.
   */
  lightGroups(): { id: string; lights: Light[] }[] {
    return [
      { id: 'desk', lights: [this.lampLight] }, { id: 'arc', lights: [this.arc.light] }, { id: 'floor', lights: [this.floorLight] }, { id: 'bedside', lights: [this.bedLight] },
      { id: 'strips', lights: this.strips.lights }, { id: 'picture', lights: [this.picture.light] }, { id: 'sconce', lights: [this.sconce.up, this.sconce.down] },
      { id: 'led', lights: [this.ledUnder, this.ledHalo, this.deskLed] }, { id: 'screen', lights: [this.screenLight, this.monitor.bias] },
    ];
  }

  /** The bake's lightmap on the meshes it knows. The others keep the probe; the dev build names them (the bake is older than the room). */
  private takeBake(b: Bake): void {
    const mix = new LightmapMix(b), blinds = new Set<Object3D>(this.blinds);
    const lit = applyLightmap(this.root, b, mix.texture, { metre: M, skip: (o) => blinds.has(o), twin: (src, c) => this.envs.twin(src, c) });
    if (import.meta.env.DEV && (lit.missing.length || lit.stale)) {
      console.warn(`the room light bake is old (run \`npm run bake\`): ${lit.meshes.length} meshes lit, ${lit.stale} baked ones not found, none for: ${lit.missing.join(', ')}`);
    }
    this.lightmap = mix;
    this.mixKey = '';
    this.share();
  }

  /**
   * Equal materials as one (`shareMaterials`: fewer uniform uploads per frame), once built and again once the bake has lit its meshes. The key
   * rack is built again with each new key; a replaced material leaves the reflections' register.
   */
  private share(): void {
    shareMaterials(this.root, { skip: [this.keys], onReplace: (m) => this.envs.mats.delete(m as MeshStandardMaterial) });
  }

  /** The baked bounce for the light as it stands, summed again only when that light changes (`lightKey`). */
  private mixLight(renderer: WebGLRenderer): void {
    const lm = this.lightmap;
    if (!lm || this.mixKey === this.lightKey) return;
    this.mixKey = this.lightKey;
    const levels = new Map<string, number | Color>();
    // (a capped lamp's light is out of the scene, its level is not: its bounce stays, lifted for the pool it lost, `CAPPED_BOUNCE`)
    for (const g of this.lightGroups()) levels.set(g.id, g.lights[0]!.intensity * bounceLift(g.lights.filter((l) => !l.visible).length, g.lights.length));
    levels.set('sky', this.key.color.clone().multiplyScalar(this.skyK * SKY_K));
    levels.set('city', this.key.color.clone().multiplyScalar(this.cityK * SKY_K));
    for (const [h, w] of keyFrames(this.hour, SUN_HOURS)) levels.set(`sun-${h}`, this.sun.color.clone().multiplyScalar(this.sunK * w));
    lm.mix(renderer, levels);
  }

  /**
   * The sun at an hour: a spot far out along its direction, aimed through the window's middle. Its shadow is drawn again when it moves; through
   * the night it stands still (`sunDir`), so the moon's shaft it gives keeps its map.
   */
  private aimSun(hour: number): void {
    const d = sunDir(hour), W = WINDOW, c = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const, p = this.sun.position;
    const x = c[0] + d[0] * SUN_D, y = c[1] + d[1] * SUN_D, z = c[2] + d[2] * SUN_D;
    if (p.x === x && p.y === y && p.z === z) return;
    p.set(x, y, z);
    this.sun.target.position.set(c[0] - d[0] * 20000, c[1] - d[1] * 20000, c[2] - d[2] * 20000);
    this.sun.shadow.needsUpdate = true;
  }

  /**
   * The room's own light for its materials' ambient light and reflections, in place of the studio's: a `Probe` of the room, which holds the day
   * and the night as they fall in it, so it is not dimmed by the hour.
   */
  setProbe(t: Texture): void {
    this.probe = true;
    this.box.on.value = 1;
    this.envs.setMap(t);
  }

  /** The lights that cast shadows, in `SHADOW_LEVELS`' order. */
  /** Does any light of the room cast a shadow? With none, no map is drawn and the shadow scan has nothing to serve. */
  get casting(): boolean { return this.casters.some((l) => l.castShadow); }

  private get casters(): (SpotLight | PointLight)[] { return [this.key, this.sun, this.lampLight, this.bedLight, this.floorLight, this.arc.light]; }

  /** The room's lights by their name in `LIGHT_ORDER` (roomlights.ts). */
  private lightsOf(id: LightId): Light[] {
    switch (id) {
      case 'key': return [this.key];
      case 'sun': return [this.sun];
      case 'arc': return [this.arc.light];
      case 'desk': return [this.lampLight];
      case 'floor': return [this.floorLight];
      case 'bedside': return [this.bedLight];
      case 'sconceUp': return [this.sconce.up];
      case 'sconceDown': return [this.sconce.down];
      case 'screen': return [this.screenLight];
      case 'deskLed': return [this.deskLed];
      case 'picture': return [this.picture.light];
      case 'ledHalo': return [this.ledHalo];
      case 'ledUnder': return [this.ledUnder];
      case 'bias': return [this.monitor.bias];
      case 'strips': return this.strips.lights;
    }
  }

  /** The graphics settings' shadow level and choice of lights, as last set. */
  private shadowLevel = 3;
  private choice = chooseLights(0, true);

  /**
   * At most `cap` real-time lights in the room (0: all of them), and whether its lamps cast shadows (`chooseLights`). A capped light leaves
   * the scene (the renderer counts a light at 0), so the lit programs are made again: call it when the setting changes, never by the frame.
   * Its fixture still glows and its baked bounce shows lifted (`mixLight`); the frame still sets its level.
   */
  setLights(cap: number, lampShadows: boolean): void {
    this.choice = chooseLights(cap, lampShadows, (id) => this.lightsOf(id).length);
    for (const id of LIGHT_ORDER) for (const l of this.lightsOf(id)) l.visible = this.choice.live.has(id);
    this.mixKey = '';
    this.setShadows(this.shadowLevel);
  }

  /**
   * The shadow maps at `level` of the graphics settings, for the lights that may cast (`setLights`). A new map is drawn on the next frame; no
   * shadows frees them.
   */
  setShadows(level: number): void {
    this.shadowLevel = level;
    this.outside.setShadows(level);
    const sizes = SHADOW_LEVELS[level] ?? null, least = SHADOW_LEVELS[Math.min(level, 1)] ?? null;
    this.casters.forEach((l, i) => {
      // (a lamp that casts with the lamps' shadows off takes the smallest map: `ALWAYS_CASTS`)
      const id = CASTER_IDS[i]!, size = this.choice.shadows.has(id) ? (this.choice.small.has(id) ? least : sizes)?.[i] ?? 0 : 0;
      l.castShadow = size > 0;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
      // (the bedside lantern at the smallest map holds only its drawer and the bed (`BEDSIDE_LAYER`) and casts only round it: past `BEDSIDE_FAR` its
      // light is not shadowed, as with no map. A shadow camera on layer 0 alone draws the view's layers: three's `WebGLShadowMap`)
      if (l === this.bedLight) {
        const small = this.choice.small.has(id);
        l.shadow.camera.far = small ? BEDSIDE_FAR : LANTERN_FAR;
        l.shadow.camera.layers.set(small ? BEDSIDE_LAYER : 0);
        l.shadow.camera.updateProjectionMatrix();
      }
      if (l.shadow.mapSize.x !== size || !size) { l.shadow.map?.dispose(); l.shadow.map = null; }
      if (!size) return;
      l.shadow.mapSize.set(size, size);
      l.shadow.radius = SHADOW_SOFT[i]! * (size / SHADOW_LEVELS[3]![i]!);
    });
  }

  /**
   * The window's view for this frame's camera, and the baked bounce for this frame's light (before the frame's draw); `scene`: the one the room
   * stands in; `samples`: the scene target's multisampling.
   */
  drawOutside(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, samples: number): void {
    this.mixLight(renderer);
    this.outside.draw(renderer, scene, camera, samples);
  }

  /**
   * The room's slow motion is due a frame: the city's beat (`OutsideView.due`, each few ticks), which also carries the cup's steam, the clock
   * and the hour's light as it turns. A frame drawn on demand (docs/render/load.md) draws on it.
   */
  get ambientDue(): boolean { return this.outside.due; }

  /** Free what is not under the root: the baked bounce's target. The city stays for the next room: call it before the root is freed. */
  dispose(): void { this.gone = true; this.outside.mesh.removeFromParent(); this.lightmap?.dispose(); }

  private shadowTurn = 0;
  private shadowAt = 0;

  /**
   * The lights hold still (the sun moves a step a few times a game hour), so a shadow map holds until a caster moves. Every light asks to catch
   * up (`catchUp`) for the next frame when one moved (`ShadowCache.scan`, which then redraws only the movers), else one light per turn asks:
   * a map redraws only if a caster in its light's range changed since its last draw (a fan's rotor turned), so a still room draws no shadow
   * map. A light at 0 draws none until it is lit (`ShadowCache`).
   */
  redrawShadows(moved: boolean, now: number): void {
    const lights = this.casters;
    if (moved) { for (const l of lights) catchUp(l); return; }
    if (now - this.shadowAt < SHADOW_TURN_MS) return;
    this.shadowAt = now;
    catchUp(lights[this.shadowTurn++ % lights.length]!);
  }

  /** The keys that have been on the rack (a key not in it is new mail), and the new ones still arriving: a letter drifts in, opens, the key rises out and is carried to its hook (the 2D's `mail.ts` poses). */
  private known: Set<number> | null = null;
  private arrivals: { g: Group; env: Group; flap: Mesh; mats: MeshStandardMaterial[]; rest: { x: number; y: number }; t0: number }[] = [];

  /** The envelope: paper, and its flap, which turns about the top edge. */
  private envelope(): { env: Group; flap: Mesh; mats: MeshStandardMaterial[] } {
    const paper = mat(0xf1e8d6, { roughness: 0.8 }), darker = mat(0xdccfb4, { roughness: 0.8 }), env = new Group();
    paper.transparent = darker.transparent = true;
    paper.side = darker.side = DoubleSide;
    env.add(softBox({ x: -ENV_W / 2, y: -ENV_H / 2, w: ENV_W, h: ENV_H }, 0, 40, paper, 20));
    const tri = new Shape();
    tri.moveTo(-ENV_W / 2, 0).lineTo(ENV_W / 2, 0).lineTo(0, -ENV_H * 0.55).closePath();
    const flap = new Mesh(new ShapeGeometry(tri), darker);
    flap.position.set(0, ENV_H / 2, 44);
    env.add(flap);
    return { env, flap, mats: [paper, darker] };
  }

  /** The keys on the rack: a white stick on its lanyard per hook. A key that arrives drops in from the mailbox. */
  setKeys(tray: readonly KeySnap[]): void {
    const key = tray.map((k) => `${k.id}:${k.type}:${k.label}`).join(',');
    if (key === this.keysKey) return;
    this.keysKey = key;
    this.arrivals = [];
    for (const c of [...this.keys.children]) { this.keys.remove(c); disposeTree(c, true); }
    tray.slice(0, 10).forEach((k, i) => {
      const hook = trayHook(i), c = trayKeyCentre(i), g = tag(new Group(), 'key:' + k.id), col = new Color(lanyardColour(k)).getHex();
      const label = paint(64, 256, (cx, w, h) => {
        cx.fillStyle = '#eceef2'; cx.fillRect(0, 0, w, h);
        cx.fillStyle = lanyardColour(k); cx.fillRect(0, 0, w, 34);
        cx.save(); cx.translate(w / 2, h / 2 + 14); cx.rotate(Math.PI / 2);
        cx.fillStyle = '#2b3140'; cx.font = 'bold 24px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(k.label, 0, 0); cx.restore();
      });
      const shell = mat(0xeceef2, { roughness: 0.35 });
      const body = softBox({ x: c.x - KEY_W / 2, y: c.y - KEY_LEN / 2, w: KEY_W, h: KEY_LEN }, 260, 400, shell, 40);
      g.add(body);
      if (label) { const f = new Mesh(new PlaneGeometry(KEY_W - 40, KEY_LEN - 60), mat(0xffffff, { map: label, roughness: 0.4 })); f.position.set(c.x, -c.y, 402); g.add(f); }
      g.add(rectBox({ x: c.x - 70, y: c.y + KEY_LEN / 2, w: 140, h: 190 }, 280, 380, mat(0xb9bec6, { metalness: 0.8, roughness: 0.3 })));
      g.add(tube([[hook.x, -hook.y, 400], [hook.x - 20, -(hook.y + 200), 380], [c.x, -(c.y - KEY_LEN / 2), 340]], 26, mat(col, { roughness: 0.7 }), 6));
      if (this.known && !this.known.has(k.id)) {
        const e = this.envelope();
        g.visible = false;
        this.keys.add(e.env);
        this.arrivals.push({ g, env: e.env, flap: e.flap, mats: e.mats, rest: c, t0: -1 });
      }
      this.keys.add(g);
    });
    this.known = new Set(tray.map((k) => k.id));
  }

  /** The monitor's screen as the 2D game's `Live` draws it, or null for the plain picture (props3d.ts `Monitor.useLive`). */
  setScreenImage(img: { canvas: HTMLCanvasElement; w: number; h: number; rev?: number } | null): void { this.monitor.useLive(img); }

  frame(f: RoomFrame, dt: number): void {
    // the mail, on the game's clock (it stops with the pause)
    const stage = mailStage();
    for (const a of this.arrivals) {
      if (a.t0 < 0) a.t0 = f.t;
      const u = (f.t - a.t0) / MAIL_S;
      if (u >= 1) { a.g.visible = true; a.g.position.set(0, 0, 0); a.g.rotation.z = 0; a.env.visible = false; continue; }
      const lp = letterPose(Math.max(0, u), stage), kp = keyPose(Math.max(0, u), stage, a.rest);
      a.env.position.set(lp.x, -lp.y, 330);
      a.env.rotation.z = -lp.rot;
      a.flap.scale.y = lp.flap;
      for (const m of a.mats) m.opacity = lp.alpha;
      a.env.visible = lp.alpha > 0.01;
      a.g.visible = kp.phase !== 'wait';
      // the key hangs from the carried end of its lanyard: it swings as it goes
      a.g.position.set(kp.x - a.rest.x, -(kp.y - a.rest.y), kp.phase === 'settle' ? 0 : 160);
    }
    this.arrivals = this.arrivals.filter((a) => (f.t - a.t0) / MAIL_S < 1 || a.t0 < 0);
    const day = daylight(f.hour), night = 1 - day;
    this.outside.frame(f.hour, f.t);
    const hk = Math.round(f.hour * 20);
    if (hk !== this.sunKey) {
      this.sunKey = hk;
      this.aimSun(f.hour);
      const s = skyAt(f.hour), low = 1 - Math.min(1, Math.max(0, sunDir(f.hour)[1] / 0.45));
      this.sun.color.set(0xfff2dc).lerp(new Color(s.hor), 0.25 + low * 0.6);
      if (day <= 0) this.sun.color.set(0x8fa6ff);
      // the sky's colour, paler; the low sun warms it a little; the night's is the moon's blue
      this.key.color.set(s.top).lerp(new Color(0xffffff), 0.5).lerp(this.sun.color, 0.2 * low * day).lerp(new Color(0x6f86d8), night);
    }
    this.blindK += ((f.blind ? 1 : 0) - this.blindK) * (1 - Math.pow(0.02, dt));
    const wh = WINDOW.h - 900, bh = Math.max(1, this.blindK * wh);
    for (const b of this.blinds) { b.scale.y = bh; b.position.y = -(WINDOW.y + 900) - bh / 2; }
    const open = 1 - this.blindK * 0.85;
    // the day comes in by the window, the sky's light and the sun; the rest of the room has what bounces (the probe). At night a dim blue
    // moonlight: the lamps, the screen and the machine carry the room
    // (the glass looks north: the sun comes in only low, at the day's two ends, from the side it stands to; the glass takes its share of all
    // of it, `GLASS_T`, at every hour)
    const sunIn = smooth(0.02, 0.12, -sunDir(f.hour)[2]);
    this.hour = f.hour;
    this.sunK = day * 5.8 * sunIn * open * GLASS_T;
    this.sun.intensity = this.sunK + night * 0.25 * open * GLASS_T;
    // (the sky's light, and the city's through the whole glass wall: by day its sunlit blocks, at night its glow, a soft blue light over the desk)
    this.skyK = (0.05 + day * 3) * open * GLASS_T;
    this.cityK = (day * 3 * CITY_DAY + night * 0.7) * open * GLASS_T;
    this.key.intensity = (this.skyK + this.cityK) * KEY_REF ** KEY_DECAY;
    const env = this.probe ? PROBE_K : 0.35 * (0.16 + 0.84 * day);
    this.envs.setStrength(env);
    // (a lamp is as bright by day as by night: the camera does not adapt)
    this.lampLight.intensity = f.lamp ? lumens(DESK_LM, this.lampLight.angle) : 0;
    this.lamp.bulb.emissiveIntensity = f.lamp ? 3 : 0.05;
    this.lamp.inner.emissiveIntensity = f.lamp ? 0.6 : 0;
    // the evening comes on in three steps (the ceiling light stays off): at dusk the floor lantern and the shelves' strips; then the bed's
    // cyan LED strips (the floor round the bed, the wall over the headboard, the desk's underside); as night falls the bedside lantern (a warm
    // pool round the bed, its bulb glowing through the paper), the picture light and the door's sconce
    const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (night - a) / (b - a)));
    const dusk = ramp(0.1, 0.4), led = ramp(0.2, 0.6), bedside = ramp(0.35, 0.65);
    this.floorLight.intensity = dusk * lumens(LANTERN_LM);
    this.floorLamp.shade.emissiveIntensity = dusk * 1.1;
    this.floorLamp.glow.emissiveIntensity = dusk * 4;
    for (const l of this.strips.lights) l.intensity = dusk * nits(STRIP_NITS);
    this.strips.glow.emissiveIntensity = dusk * 1.6;
    // (the arc lamp is the desk's overhead cozy light: on at every hour)
    this.arc.light.intensity = lumens(ARC_LM, this.arc.light.angle);
    this.arc.glow.emissiveIntensity = 4;
    this.arc.shade.emissiveIntensity = 1.2;
    this.bedLight.intensity = bedside * lumens(LANTERN_LM);
    const pl = this.picture.light;
    pl.intensity = bedside * nits(PICTURE_LM / (Math.PI * pl.width * pl.height / (M * M)));
    this.picture.glow.emissiveIntensity = bedside * 1.6;
    this.sconce.up.intensity = bedside * lumens(SCONCE_LM, this.sconce.up.angle);
    this.sconce.down.intensity = bedside * lumens(SCONCE_LM, this.sconce.down.angle);
    this.sconce.glow.emissiveIntensity = bedside * 2;
    this.shade.emissiveIntensity = bedside * 1.1;
    this.bulbGlow.emissiveIntensity = bedside * 4;
    this.ledGlow.emissiveIntensity = led * 3;
    this.ledUnder.intensity = led * 6;
    this.ledHalo.intensity = led * 10;
    this.deskLed.intensity = led * 18;
    // (both stay in the scene at 0 without a monitor: the count of lights does not change)
    const lit = f.screen.installed && f.screen.powered;
    this.screenLight.intensity = lit ? nits(SCREEN_NITS) : 0;
    const bias = this.monitor.bias;
    bias.intensity = lit ? nits(BIAS_LM / (Math.PI * bias.width * bias.height / (M * M))) : 0;
    this.lightKey = `${this.sunKey >> 1}|${f.lamp}|${Math.round(this.blindK * 6)}|${f.screen.powered}|${Math.round(bedside * 4)}|${Math.round(led * 4)}|${Math.round(dusk * 4)}|${this.choice.live.size}`;
    this.monitor.set(f.screen, f.hour);
    this.monitorSpot.visible = !f.screen.installed;
    this.routerBody.visible = f.router > 0;
    this.routerSpot.visible = f.router === 0;
    if (f.router > 0) this.routerBuild(f.router);
    this.ispDots.forEach((m, k) => { m.emissiveIntensity = k < f.isp ? 2 : 0; });
    this.mailLed.emissiveIntensity = f.mail ? 1.2 + 1.2 * Math.sin(f.t * 6) : 0;
    const it = this.ispText;
    if (it && it.shown !== f.ispName) {
      it.shown = f.ispName;
      const c = it.cv.getContext('2d')!;
      c.clearRect(0, 0, it.cv.width, it.cv.height);
      c.fillStyle = '#7fd8ff'; c.font = '600 54px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(f.ispName.toUpperCase(), it.cv.width / 2, it.cv.height / 2, it.cv.width - 24);
      it.tex.needsUpdate = true;
    }
    this.clock.set(f.hour);
    steam(this.cup, f.t);
  }
}
