// The 3D room: a small, cozy bedroom round the desk (docs/LOWPOLY_STYLE.md "Look decision"). A closed box at real sizes (`roomplan.ts`): warm plaster
// walls, a slatted wood panel behind the desk, a deep window west of it onto a street in 3D (`outside/view.ts`), oak planks and a wool rug, the bed and
// its bedside table east of the desk, a bookcase and the door on the west wall (`furniture3d.ts`). On and over the desk: the monitor, keyboard,
// mouse, mug, architect lamp, digital clock, the key rack, the router on its shelf, the letterbox and the wall plates (`props3d.ts`). x and y of
// the desk's things come from the 2D layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the back wall. The sim knows nothing of it.
import {
  BoxGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Shape, ShapeGeometry, SphereGeometry,
  SpotLight, type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three';
import type { KeySnap } from '@/worker/game/types';
import { CASE, ETH0_RECT, MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, type Rect } from '@/features/board/render/layout/layout';
import { hung } from '@/features/board/render/three/wires3d';
import { disposeTree, drum, instanced, paint, place, rectBox, rod, softBox, tube } from '@/core/render/three/geometry';
import { mergeStatic } from '@/core/render/three/merge';
import { cloth, mat, varnish } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { ENV_H, ENV_W, MAIL_S, keyPose, letterPose, mailStage } from '../desk/props/mail';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DigitalClock, Monitor, keyboard, lamp, mouse, mug, notebook, steam, type Lamp, type Mug, type Screen } from './props3d';
import { OutsideView } from './outside/view';
import { bed, bookcase, ceilingLight, curtains, door, eastWall, nightstand, print, radiator } from './furniture3d';
import { deskChair } from './chair3d';
import { FIG_AT, aloe, floorPlant } from './plants3d';
import {
  BED, BOARD_Z, CASE_D, CASE_Z, CEIL_Y, DESK_D, DESK_TOP, DOOR, EAST_X, FLOOR_Y, FRONT_Z, MONITOR_Z, SLATS_X0, SLATS_X1, SLAT_W, WALL_T, WEST_X, WINDOW,
  daylight, slatRuns, sunDir, wallAround,
} from './roomplan';

const KEY_W = 230;

/** The shadow map sizes at each level of the graphics settings (the window's sky light, the sun, the lamp); 0 has no shadows, 3 is the tuned look. */
const SHADOW_LEVELS: readonly (readonly number[] | null)[] = [null, [1024, 1024, 512], [2048, 1024, 1024], [4096, 2048, 1024], [8192, 4096, 2048]];
/** Each light's softness at level 3. It is in map texels, so a map of another size takes its share and the shadow's edge stays as wide. */
const SHADOW_SOFT = [14, 5, 6];
/** The window's sky light falls off as its distance to this power: a window is a wide source, gentler than a bulb's square. */
const KEY_DECAY = 0.8;
/** The sky light's level is as set at this distance from its source (about the desk's middle). */
const KEY_REF = 24000;
/**
 * The share of the room's own light (the probe, `setProbe`) its materials take as ambient light and reflections. Under 1: one point stands for
 * the whole room, and a bounce loses some.
 */
export const PROBE_K = 1;
/** While nothing large moves, one light redraws its shadow map at this pace (ms): a whole round costs one frame's worth, spread out. */
const SHADOW_TURN_MS = 400;
/** The window's frame sits this far back in its reveal (z of its room face), and the glass a little behind that. */
const FRAME_Z = -1000, GLASS_Z = -1500;
/** The sun is a spot this far out along its direction from the window: its cone covers the opening, its shadow the reveal and the frame. */
const SUN_D = 90000;
/** The sky's fill colour at noon (the night's is a deep blue). */
const NOON_SKY = new Color(0xe4ecff);

let seedN = 1;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);

/** Wood: fine grain along the board (vertical or horizontal), optional plank seams. */
function woodTex(base: string, line: string, o: { planks?: boolean; across?: boolean; repeat?: [number, number] } = {}): Texture | null {
  return paint(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.save();
    if (o.across) { c.translate(w, 0); c.rotate(Math.PI / 2); }
    c.strokeStyle = line;
    for (let i = 0; i < 90; i++) {
      c.globalAlpha = 0.04 + rnd() * 0.09; c.lineWidth = 1 + rnd() * 2.5;
      const x = rnd() * w;
      c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + rnd() * 20 - 10, h * 0.33, x + rnd() * 20 - 10, h * 0.66, x + rnd() * 12 - 6, h); c.stroke();
    }
    c.restore();
    if (o.planks) {
      for (let k = 0; k < 6; k++) { c.globalAlpha = 0.05 + (k % 3) * 0.035; c.fillStyle = k % 2 ? '#fff3dc' : '#3b2412'; c.fillRect(0, k * h / 6, w, h / 6); }
      c.globalAlpha = 0.45; c.strokeStyle = '#4a2e18'; c.lineWidth = 2;
      for (let y = 0; y <= h; y += h / 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      for (let k = 0; k < 6; k++) { const x = ((k * 0.43 + 0.17) % 1) * w; c.beginPath(); c.moveTo(x, k * h / 6); c.lineTo(x, (k + 1) * h / 6); c.stroke(); }
    }
    c.globalAlpha = 1;
  }, o.repeat);
}

/**
 * Walnut, for the desk: glued boards along the grain (u), each its own tone; a straight grain waved a little, a cathedral (nested arches) in
 * some boards, fine dark pores; a dark glue line between boards.
 */
function walnutTex(): Texture | null {
  return paint(1024, 512, (c, w, h) => {
    const n = 5, bh = h / n;
    for (let b = 0; b < n; b++) {
      const y0 = b * bh, f = 0.88 + rnd() * 0.22;
      c.save(); c.beginPath(); c.rect(0, y0, w, bh); c.clip();
      c.fillStyle = `rgb(${108 * f},${72 * f},${50 * f})`; c.fillRect(0, y0, w, bh);
      for (let i = 0; i < 26; i++) {
        const gy = y0 + rnd() * bh, amp = 1 + rnd() * 3;
        c.strokeStyle = rnd() < 0.75 ? `rgba(46,26,14,${0.14 + rnd() * 0.2})` : `rgba(168,124,88,${0.1 + rnd() * 0.12})`;
        c.lineWidth = 0.7 + rnd() * 2;
        c.beginPath(); c.moveTo(0, gy); for (let x = 0; x <= w; x += 32) c.lineTo(x, gy + Math.sin(x / 140 + i) * amp); c.stroke();
      }
      if (rnd() < 0.7) {
        const ax = rnd() * w, ay = y0 + bh * (0.35 + rnd() * 0.3);
        for (let k = 0; k < 7; k++) {
          const s = 30 + k * 26, t = bh * (0.08 + k * 0.055);
          c.strokeStyle = `rgba(42,24,12,${0.3 - k * 0.03})`; c.lineWidth = 1.4 + rnd();
          c.beginPath(); c.moveTo(ax - s * 4, ay - t); c.quadraticCurveTo(ax + s, ay - t, ax + s * 1.4, ay); c.quadraticCurveTo(ax + s, ay + t, ax - s * 4, ay + t); c.stroke();
        }
      }
      for (let k = 0; k < 900; k++) { c.fillStyle = `rgba(28,15,7,${0.1 + rnd() * 0.15})`; c.fillRect(rnd() * w, y0 + rnd() * bh, 2 + rnd() * 6, 1); }
      c.restore();
      c.fillStyle = 'rgba(38,20,10,0.4)'; c.fillRect(0, y0, w, 1);
    }
  });
}

/**
 * Plaster: a flat warm paint over a hand-trowelled wall. A soft cloud of light and shade (smooth noise over three scales, seamless across the
 * tile's edges) and a fine roller stipple: no blotch stands out, the light shows it.
 */
function plasterTex(base: string, repeat: [number, number]): Texture | null {
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
 * Oak floor planks running east-west: each board its own tone and grain, a knot here and there, staggered butt joints, the joints dark with a lit
 * edge (an eased bevel). A tile is eight boards; the board that crosses the tile's edge carries on in the next tile, so no joint lines up.
 */
function planksTex(): Texture | null {
  return paint(1024, 1024, (c, w, h) => {
    const rows = 8, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * ph, cuts = [((r * 0.37 + 0.13) % 1) * w];
      if (r % 2) cuts.push(((r * 0.37 + 0.63) % 1) * w);
      cuts.sort((a, b) => a - b);
      // the boards of this row: between the cuts, and the one through the tile's edge (drawn in two parts, the same board)
      const boards: [number, number][][] = cuts.map((x, k) => (k + 1 < cuts.length ? [[x, cuts[k + 1]!]] : [[x, w], [0, cuts[0]!]]));
      for (const parts of boards) {
        const f = 0.84 + rnd() * 0.3, warm = rnd() * 14 - 7, seed = seedN;
        for (const [x0, x1] of parts) {
          seedN = seed;
          c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, ph); c.clip();
          c.fillStyle = `rgb(${Math.min(255, 185 * f + warm)},${138 * f},${94 * f - warm})`; c.fillRect(0, y0, w, ph);
          // the grain along the board, waved a little; a few lighter streaks
          for (let i = 0; i < 16; i++) {
            const gy = y0 + rnd() * ph, amp = 2 + rnd() * 5;
            c.strokeStyle = rnd() < 0.8 ? `rgba(90,56,30,${0.12 + rnd() * 0.16})` : `rgba(255,236,205,${0.1 + rnd() * 0.1})`; c.lineWidth = 0.8 + rnd() * 1.8;
            c.beginPath(); c.moveTo(0, gy); for (let x = 0; x <= w; x += 64) c.lineTo(x, gy + Math.sin(x / 90 + i) * amp); c.stroke();
          }
          // a knot: dark heart, rings stretched along the board
          if (rnd() < 0.4) {
            const kx = x0 + (0.2 + rnd() * 0.6) * (x1 - x0), ky = y0 + ph * (0.3 + rnd() * 0.4);
            for (let k = 4; k >= 0; k--) { c.fillStyle = `rgba(${86 + k * 14},${54 + k * 9},${30 + k * 6},${0.1 + (4 - k) * 0.07})`; c.beginPath(); c.ellipse(kx, ky, 5 + k * 7, 3 + k * 2.2, 0, 0, Math.PI * 2); c.fill(); }
          }
          c.restore();
        }
      }
      // the long joint above the row (dark, then its lit bevel), the butt joints
      c.fillStyle = 'rgba(48,28,14,0.8)'; c.fillRect(0, y0, w, 3);
      c.fillStyle = 'rgba(255,238,210,0.22)'; c.fillRect(0, y0 + 3, w, 2);
      for (const x of cuts) { c.fillStyle = 'rgba(48,28,14,0.75)'; c.fillRect(x - 1, y0, 2.5, ph); }
    }
  }, [2.4, 3.2]);
}

/** A wool rug: cream, a soft diamond lattice, a terracotta band inside a plain edge; a fleck of pile all over (its bump too). */
function rugTex(): Texture | null {
  return paint(1024, 576, (c, w, h) => {
    c.fillStyle = '#e9e0cf'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 14000; k++) { c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.06 + rnd() * 0.08})` : `rgba(90,60,30,${0.04 + rnd() * 0.06})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    const m = 70;
    c.save(); c.beginPath(); c.rect(m, m, w - 2 * m, h - 2 * m); c.clip();
    c.strokeStyle = 'rgba(120,92,64,0.45)'; c.lineWidth = 5;
    for (let x = -h; x < w + h; x += 72) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + h, h); c.stroke();
      c.beginPath(); c.moveTo(x + h, 0); c.lineTo(x, h); c.stroke();
    }
    c.restore();
    c.strokeStyle = '#b8694a'; c.lineWidth = 16; c.strokeRect(m - 24, m - 24, w - 2 * m + 48, h - 2 * m + 48);
    c.strokeStyle = '#d29a62'; c.lineWidth = 5; c.strokeRect(m - 4, m - 4, w - 2 * m + 8, h - 2 * m + 8);
  });
}

export interface RoomFrame { hour: number; lamp: boolean; blind: boolean; screen: Screen; t: number }

export class Room3D {
  readonly root = new Group();
  readonly geo: RoomGeo;
  private keys = new Group();
  private sun = new SpotLight(0xfff0d8, 0, 0, 0.17, 0.35, 0);
  /** The sky's light through the window: a wide soft spot out behind it, so the wall's shadow lets it in by the opening only. */
  private key = new SpotLight(0xd4e2ff, 0, 0, 1.05, 0.9, KEY_DECAY);
  /** A faint light from the viewer's side, for the fronts the window does not see (no shadow). */
  private fill = new DirectionalLight(0xfff4e6, 0);
  private hemi = new HemisphereLight(0xe4ecff, 0xe2d6c6, 1);
  private lampLight = new SpotLight(0xffd29a, 0, 0, 0.6, 0.7, 0);
  private bedLight = new PointLight(0xffb46a, 0, 42000, 1);
  private screenLight = new PointLight(0xa8cfff, 0, 9000, 0);
  private outside: OutsideView;
  private blind = new Mesh();
  private blindK = 0;
  private sunKey = -1;
  private keysKey = '';
  private lamp: Lamp;
  private monitor: Monitor;
  private clock: DigitalClock;
  private mug: Mug;
  private shade: MeshStandardMaterial;
  private bedGlow: MeshStandardMaterial;
  /** The room's materials that take the environment's reflections: the studio's, dimmed at night, until the probe has the room's own. */
  private envMats = new Set<MeshStandardMaterial>();
  private probe = false;
  /** Where the room's probe sees from (world): over the desk's front, in the room's middle height. */
  readonly probeAt: [number, number, number];
  /** What the room's light depends on, coarsely: a new value asks for a new capture of the probe. */
  lightKey = '';

  constructor(env: Texture | null = null) {
    this.geo = roomGeo();
    const g = this.geo, R = this.root, ys = g.ys, fl = FLOOR_Y, deskTop = -ys, H = fl - CEIL_Y;
    const white = mat(0xf3f1ec, { roughness: 0.4 });
    const walnut = walnutTex(), deskWood = varnish(0xffffff, { map: walnut, bumpMap: walnut, bumpScale: 0.6, roughness: 0.5 });
    const chrome = mat(0xc9cdd2, { metalness: 0.85, roughness: 0.25 });
    const dark = mat(0x2a2c31, { roughness: 0.5 });
    const plaster = mat(0xffffff, { map: plasterTex('#ece5d9', [10, 5]), roughness: 0.92 });
    const sage = mat(0xffffff, { map: plasterTex('#a9b39c', [6, 5]), roughness: 0.92 });
    const W = WINDOW;

    // ---- the back wall: plaster round the window, the slatted panel behind the desk (its slats flush with the plaster), a sage wall behind the bed ----
    for (const r of wallAround(WEST_X, SLATS_X0, CEIL_Y, fl, W)) R.add(rectBox(r, -WALL_T, 0, plaster));
    R.add(rectBox({ x: SLATS_X1, y: CEIL_Y, w: BED.x - 3000 - SLATS_X1, h: H }, -WALL_T, 0, plaster));
    R.add(rectBox({ x: BED.x - 3000, y: CEIL_Y, w: EAST_X - BED.x + 3000, h: H }, -WALL_T, 0, sage));
    R.add(rectBox({ x: SLATS_X0, y: CEIL_Y, w: SLATS_X1 - SLATS_X0, h: H }, -WALL_T, -140, mat(0x1a110b, { roughness: 0.95 })));
    const slatM = mat(0xffffff, { map: woodTex('#3a281d', '#150c06'), roughness: 0.7 });
    const runs = slatRuns(SLATS_X0 + 120, SLATS_X1 - 120, CEIL_Y, fl, { x: 0, y: 0, w: 0, h: 0 });
    R.add(instanced(new BoxGeometry(1, 1, 1), slatM, runs.map((s) => ({ x: s.x + SLAT_W / 2, y: -(s.y0 + s.y1) / 2, z: -70, sx: SLAT_W, sy: s.y1 - s.y0, sz: 140 }))));
    const trim = mat(0xffffff, { map: woodTex('#5a3d2a', '#24150b'), roughness: 0.6 });
    for (const x of [SLATS_X0 - 120, SLATS_X1 - 120]) R.add(softBox({ x, y: CEIL_Y, w: 240, h: H }, -160, 80, trim, 40));

    // ---- the other walls, the ceiling (they take light, they cast no shadow: the eye is always inside) ----
    const shell = (m: Mesh) => { m.castShadow = false; return m; };
    R.add(shell(rectBox({ x: WEST_X - 1200, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200, plaster)));
    R.add(shell(rectBox({ x: EAST_X, y: CEIL_Y, w: 1200, h: H }, -WALL_T, FRONT_Z + 1200, plaster)));
    R.add(shell(rectBox({ x: WEST_X - 1200, y: CEIL_Y, w: EAST_X - WEST_X + 2400, h: H }, FRONT_Z, FRONT_Z + 1200, plaster)));
    R.add(shell(rectBox({ x: WEST_X - 1200, y: CEIL_Y - 1200, w: EAST_X - WEST_X + 2400, h: 1200 }, -WALL_T, FRONT_Z + 1200, mat(0xf4f0e8, { roughness: 0.95 }))));
    // the skirting (a board, a rounded bead along its top) and a stepped cornice round the room (the door breaks the skirting on the west wall)
    const skirt = (r: Rect, z0: number, z1: number) => R.add(shell(softBox(r, z0, z1, white, 40)));
    const SK = 1700, run = (x0: number, x1: number, z0: number, z1: number, out: 'x' | '-x' | 'z' | '-z') => {
      const deep = (d: number): [Rect, number, number] => out === 'z' ? [{ x: x0, y: 0, w: x1 - x0, h: 0 }, z0, z0 + d] : out === '-z' ? [{ x: x0, y: 0, w: x1 - x0, h: 0 }, z1 - d, z1]
        : out === 'x' ? [{ x: x0, y: 0, w: d, h: 0 }, z0, z1] : [{ x: x1 - d, y: 0, w: d, h: 0 }, z0, z1];
      const [b, bz0, bz1] = deep(160), [t, tz0, tz1] = deep(250);
      skirt({ ...b, y: fl - SK, h: SK }, bz0, bz1);
      skirt({ ...t, y: fl - SK, h: 240 }, tz0, tz1);
    };
    run(WEST_X, EAST_X, 0, 0, 'z');
    run(WEST_X, WEST_X, 0, DOOR.z0 - 980, 'x');
    run(WEST_X, WEST_X, DOOR.z1 + 980, FRONT_Z, 'x');
    run(EAST_X, EAST_X, 0, FRONT_Z, '-x');
    run(WEST_X, EAST_X, FRONT_Z, FRONT_Z, '-z');
    for (const [d, y, h] of [[380, CEIL_Y, 700], [230, CEIL_Y + 700, 260]] as const) {
      skirt({ x: WEST_X, y, w: EAST_X - WEST_X, h }, 0, d);
      skirt({ x: WEST_X, y, w: d, h }, 0, FRONT_Z);
      skirt({ x: EAST_X - d, y, w: d, h }, 0, FRONT_Z);
    }

    // ---- the floor: long oak planks; a thick wool rug in front of the bed, fringed at its ends ----
    const planks = planksTex();
    const floor = new Mesh(new PlaneGeometry(EAST_X - WEST_X, FRONT_Z), mat(0xffffff, { map: planks, bumpMap: planks, bumpScale: 0.9, roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((WEST_X + EAST_X) / 2, -fl, FRONT_Z / 2);
    floor.receiveShadow = true;
    R.add(floor);
    const pile = rugTex(), rugR = { x: -18000, w: 48000, z0: 14000, z1: 41000 };
    const rug = softBox({ x: rugR.x, y: fl - 300, w: rugR.w, h: 300 }, rugR.z0, rugR.z1, cloth(0xffffff, { map: pile, bumpMap: pile, bumpScale: 2, roughness: 0.97 }), 140);
    rug.castShadow = false;
    R.add(rug);
    const fringe: { x: number; y: number; z: number; sx: number }[] = [];
    for (const [x, s] of [[rugR.x, -1], [rugR.x + rugR.w, 1]] as const) for (let z = rugR.z0 + 300; z < rugR.z1 - 300; z += 230) {
      const len = 700 + rnd() * 300;
      fringe.push({ x: x + s * len / 2, y: -fl + 25, z: z + rnd() * 60, sx: len });
    }
    R.add(instanced(new BoxGeometry(1, 40, 70), mat(0xe6dccb, { roughness: 0.95 }), fringe));

    // ---- the window: a white casement set back in its reveal, a deep sill, the roller blind, the world outside ----
    const winG = tag(new Group(), 'blind'), bar = 600, mull = 460, tr = W.y + W.h * 0.27;
    const fz0 = FRAME_Z - 700, sashZ = FRAME_Z - 150;
    const frame: Rect[] = [
      { x: W.x, y: W.y, w: W.w, h: bar }, { x: W.x, y: W.y + W.h - bar, w: W.w, h: bar },
      { x: W.x, y: W.y, w: bar, h: W.h }, { x: W.x + W.w - bar, y: W.y, w: bar, h: W.h },
      { x: W.x + bar, y: tr - mull / 2, w: W.w - 2 * bar, h: mull },
      { x: W.x + W.w / 2 - mull / 2, y: tr + mull / 2, w: mull, h: W.y + W.h - bar - tr - mull / 2 },
    ];
    for (const r of frame) winG.add(softBox(r, fz0, FRAME_Z, white, 50));
    // the two casements below the transom, each its own sash with a handle
    const paneW = (W.w - 2 * bar - mull) / 2, sy = tr + mull / 2, sh = W.y + W.h - bar - sy, sash = 300;
    [W.x + bar, W.x + bar + paneW + mull].forEach((x, i) => {
      for (const r of [{ x, y: sy, w: paneW, h: sash }, { x, y: sy + sh - sash, w: paneW, h: sash }, { x, y: sy, w: sash, h: sh }, { x: x + paneW - sash, y: sy, w: sash, h: sh }]) winG.add(softBox(r, sashZ - 500, sashZ, white, 40));
      const hx = i ? x + sash / 2 : x + paneW - sash / 2;
      winG.add(softBox({ x: hx - 70, y: sy + sh * 0.5 - 650, w: 140, h: 1300 }, sashZ, sashZ + 180, mat(0xd9d6cf, { metalness: 0.6, roughness: 0.3 }), 50));
    });
    const glass = seeThrough(new Mesh(new PlaneGeometry(W.w, W.h), new MeshStandardMaterial({ color: 0xdbeaff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.2, depthWrite: false })));
    glass.position.set(W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z + 100);
    this.outside = new OutsideView(W.x + W.w / 2, -(W.y + W.h / 2), W.w, W.h, GLASS_Z);
    winG.add(this.outside.mesh, glass);
    // the inside sill, over the radiator
    const sillY = W.y + W.h;
    winG.add(softBox({ x: W.x - 700, y: sillY, w: W.w + 1400, h: 380 }, fz0 - 200, 1100, white, 60));
    // the roller blind: its cassette at the top of the reveal, its cloth comes down in front of the frame
    winG.add(softBox({ x: W.x + 150, y: W.y, w: W.w - 300, h: 900 }, -900, -150, white, 120));
    this.blind = place(new Mesh(new BoxGeometry(W.w - 500, 1, 40), mat(0xffffff, { map: plasterTex('#efe6d4', [2, 4]), roughness: 0.9, side: DoubleSide })));
    this.blind.position.set(W.x + W.w / 2, -(W.y + 900), -500);
    winG.add(this.blind);
    R.add(winG);
    R.add(aloe(W.x + W.w - 2600, sillY, -300), radiator(), curtains());

    // ---- the furniture: the bed and its table, the bookcase, the door, the ceiling light, a print over the bed, plants ----
    const ns = nightstand();
    this.shade = ns.shade;
    this.bedGlow = ns.glow;
    this.bedLight.position.set(...ns.bulb);
    const top = ceilingLight(4000, CEIL_Y, 30000);
    R.add(bed(), ns.root, bookcase(), door(), top.root, floorPlant(FIG_AT.x, FIG_AT.z), eastWall(), this.bedLight);
    R.add(print({ x: BED.x + BED.w / 2 - 7600, y: -15800, w: 15200, h: 10800 }, 0));

    // ---- the desk: a walnut top, a panel leg at the west end, three drawers at the east end, on the floor ----
    // the top, thickened by an edge band under its front and its ends (the back stays thin over the cords' grommet)
    const dw = g.desk.x1 - g.desk.x0, band = 460;
    R.add(softBox({ x: g.desk.x0, y: ys, w: dw, h: DESK_TOP }, 0, DESK_D, deskWood, 150));
    R.add(softBox({ x: g.desk.x0 + 20, y: ys + DESK_TOP - 60, w: dw - 40, h: band }, DESK_D - 700, DESK_D - 15, deskWood, 110));
    for (const x of [g.desk.x0 + 20, g.desk.x1 - 720]) R.add(softBox({ x, y: ys + DESK_TOP - 60, w: 700, h: band }, 400, DESK_D - 15, deskWood, 110));
    R.add(softBox({ x: g.desk.x0 + 250, y: ys + DESK_TOP, w: 500, h: fl - ys - DESK_TOP }, 300, DESK_D - 300, deskWood, 40));
    // a back rail between the leg and the pedestal, under the top
    const ped = { x: g.desk.x1 - 7800, y: ys + DESK_TOP, w: 7500, h: fl - ys - DESK_TOP - 500 };
    R.add(softBox({ x: g.desk.x0 + 750, y: ys + DESK_TOP, w: ped.x - g.desk.x0 - 750, h: 2600 }, 700, 1000, deskWood, 40));
    // the pedestal: a carcass on a dark plinth, its front a dark recess with three drawer fronts set in it, a gap round each, brass bar pulls on
    // standoffs, a lock in the top drawer
    const brass = mat(0xc9a25a, { metalness: 0.85, roughness: 0.32 });
    R.add(softBox(ped, 300, DESK_D - 400, deskWood, 40));
    R.add(softBox({ x: ped.x + 300, y: ped.y + ped.h, w: ped.w - 600, h: 500 }, 600, DESK_D - 900, dark, 30));
    R.add(rectBox({ x: ped.x + 260, y: ped.y + 40, w: ped.w - 520, h: ped.h - 300 }, DESK_D - 400, DESK_D - 380, mat(0x140d08, { roughness: 0.9 })));
    const dh = (ped.h - 300 - 2 * 90) / 3;
    for (let k = 0; k < 3; k++) {
      const d = { x: ped.x + 300, y: ped.y + 80 + k * (dh + 90), w: ped.w - 600, h: dh };
      R.add(softBox(d, DESK_D - 520, DESK_D - 300, deskWood, 90));
      const py = d.y + Math.min(900, d.h * 0.3), px0 = d.x + d.w / 2 - 1100, px1 = d.x + d.w / 2 + 1100;
      for (const px of [px0, px1]) R.add(drum(px, py, DESK_D - 300, DESK_D - 280, 130, brass, 16), drum(px, py, DESK_D - 300, DESK_D - 110, 62, brass, 12));
      R.add(rod([px0 - 260, -py, DESK_D - 95], [px1 + 260, -py, DESK_D - 95], 90, brass, 14));
      for (const px of [px0 - 260, px1 + 260]) { const cap = new Mesh(new SphereGeometry(90, 12, 8), brass); cap.position.set(px, -py, DESK_D - 95); R.add(place(cap)); }
      if (k === 0) R.add(drum(d.x + d.w / 2, d.y + d.h - 700, DESK_D - 300, DESK_D - 270, 150, brass, 18), rectBox({ x: d.x + d.w / 2 - 25, y: d.y + d.h - 790, w: 50, h: 180 }, DESK_D - 270, DESK_D - 262, dark));
    }

    // ---- on the desk: the monitor, the keyboard on its felt mat, the mouse, the mug on its coaster, a notebook ----
    this.monitor = new Monitor(MONITOR, SCREEN, ys, MONITOR_Z);
    R.add(this.monitor.root);
    const kx = MONITOR.x + MONITOR.w / 2, kz = MONITOR_Z + 3600;
    const felt = paint(512, 192, (c, w, h) => {
      c.fillStyle = '#5b6168'; c.fillRect(0, 0, w, h);
      for (let k = 0; k < 4000; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }
      // the stitched edge
      c.strokeStyle = 'rgba(30,32,36,0.8)'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
      c.strokeStyle = 'rgba(205,200,190,0.55)'; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.strokeRect(9, 9, w - 18, h - 18);
    });
    R.add(softBox({ x: kx - 5200, y: ys - 40, w: 11200, h: 40 }, kz - 2100, kz + 2100, mat(0xffffff, { map: felt, roughness: 0.97 }), 20));
    R.add(keyboard(kx, ys, kz), mouse(kx + 4100, ys, kz + 200), notebook(-16600, ys, 10000, 0.22));
    // the chair, half under the desk west of the keyboard, turned toward the window as left after use
    R.add(deskChair(kx - 7500, DESK_D + 2600, -0.3));
    this.mug = mug(g.mug, ys, MONITOR_Z + 3200);
    R.add(this.mug.root);

    // ---- the architect lamp ----
    const lx = g.lamp.x;
    this.lamp = lamp({ x: lx, y: ys }, { x: lx - 1300, y: ys - 3900 }, g.lamp.head, g.lamp.mouth, 2600);
    R.add(this.lamp.root);
    const [mx, my, mz] = this.lamp.mouth;
    this.lampLight.position.set(mx, my, mz);
    this.lampLight.target.position.set(mx + this.lamp.dir[0] * 4000, deskTop, mz + 2500);
    this.lampLight.castShadow = true; this.lampLight.shadow.mapSize.set(1024, 1024); this.lampLight.shadow.bias = -0.0005; this.lampLight.shadow.radius = 6;
    R.add(this.lampLight, this.lampLight.target);

    // ---- on the wall: the clock, the key rack, the router on its shelf, the letterbox, the plates ----
    this.clock = new DigitalClock(g.clock);
    R.add(this.clock.root);
    const rack = tag(new Group(), 'tray');
    for (let row = 0; row < 2; row++) {
      const y = trayHook(row * 5).y;
      rack.add(softBox({ x: g.keyRack.x + 120, y: y - 110, w: g.keyRack.w - 240 + row * 330, h: 220 }, 0, 200, dark, 40));
      for (let col = 0; col < 5; col++) { const h = trayHook(row * 5 + col); rack.add(drum(h.x, h.y, 200, 420, 40, chrome, 10)); }
    }
    R.add(rack, this.keys);
    R.add(softBox({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 600, h: 140 }, 0, 1700, dark, 30));
    const router = tag(new Group(), 'router');
    router.add(softBox(ROUTER_SPOT, 300, 1400, mat(0xeceef0, { roughness: 0.4 }), 80));
    router.add(softBox({ x: ROUTER_SPOT.x, y: ROUTER_SPOT.y, w: ROUTER_SPOT.w, h: 120 }, 300, 1400, mat(0xb9bec4, { roughness: 0.4 }), 40));
    // its front: a dark strip with the status lights, vents over its top, two antennas on hinges at the back
    const rs = ROUTER_SPOT, ledY = rs.y + rs.h * 0.6;
    router.add(softBox({ x: rs.x + 250, y: ledY - 70, w: 1250, h: 140 }, 1395, 1410, mat(0x1d2024, { roughness: 0.5 }), 30));
    const led = mat(0x111111, { emissive: new Color(0x58e08a), emissiveIntensity: 1.8 });
    for (let k = 0; k < 4; k++) router.add(drum(rs.x + 420 + k * 280, ledY, 1405, 1425, 36, led, 8));
    for (let k = 0; k < 6; k++) router.add(rectBox({ x: rs.x + 500 + k * 220, y: rs.y - 4, w: 90, h: 8 }, 600, 1100, mat(0x8d9399, { roughness: 0.6 })));
    const aerial = mat(0x2a2d31, { roughness: 0.45 });
    for (const [ax, lean] of [[rs.x + 260, -0.12], [rs.x + rs.w - 260, 0.12]] as const) {
      const base: [number, number, number] = [ax, -rs.y + 60, 450], tip: [number, number, number] = [ax + Math.sin(lean) * 3000, -rs.y + 60 + Math.cos(lean) * 3000, 300];
      const knuckle = new Mesh(new SphereGeometry(130, 12, 8), aerial);
      knuckle.position.set(...base);
      router.add(place(knuckle), rod(base, tip, 95, aerial, 10));
    }
    R.add(router);
    // the LAN lead: from the router's port it hangs along the wall into the network port on the case's rear panel (`hung`, a cable under its weight)
    const lan = tag(new Group(), 'cable.lan'), ly = ETH0_RECT.y + ETH0_RECT.h / 2, lz = BOARD_Z + 300;
    lan.add(softBox({ x: CASE.x - 150, y: ly - 50, w: 150, h: 100 }, lz - 60, lz + 60, mat(0x8cc3e0, { roughness: 0.5 }), 14));
    lan.add(hung({ at: [ROUTER_SPOT.x + ROUTER_SPOT.w, -(ROUTER_SPOT.y + ROUTER_SPOT.h * 0.6), 800], dir: [1, 0, 0] }, { at: [CASE.x - 150, -ly, lz], dir: [-1, 0, 0] },
      { r: 40, base: '#8cc3e0', accent: null }, { planes: [{ n: [0, 0, 1], d: 40 }, { n: [0, 1, 0], d: -ys }], solids: [{ min: [CASE.x, -(CASE.y + CASE.h), CASE_Z], max: [CASE.x + CASE.w, -CASE.y, CASE_Z + CASE_D] }] },
      { slack: 1.1, extra: 600, stiff: 0.35, n: 30 }));
    R.add(lan);
    const box = tag(new Group(), 'mail');
    box.add(softBox(OUTBOX, 0, 700, mat(0xb8342c, { roughness: 0.45 }), 70));
    box.add(rectBox({ x: OUTBOX.x + 180, y: OUTBOX.y - 10, w: OUTBOX.w - 360, h: 30 }, 200, 500, dark));
    // its front door (a panel in a fine seam), a name plate, the lock
    const ob = OUTBOX, red = mat(0xa82f28, { roughness: 0.45 });
    box.add(rectBox({ x: ob.x + 70, y: ob.y + 150, w: ob.w - 140, h: ob.h - 220 }, 700, 704, mat(0x4a1512, { roughness: 0.6 })));
    box.add(softBox({ x: ob.x + 85, y: ob.y + 165, w: ob.w - 170, h: ob.h - 250 }, 700, 730, red, 20));
    box.add(softBox({ x: ob.x + 260, y: ob.y + 260, w: ob.w - 520, h: 130 }, 730, 742, mat(0xefe7d4, { roughness: 0.6 }), 10));
    box.add(drum(ob.x + ob.w - 200, ob.y + ob.h - 220, 730, 760, 55, chrome, 12), rectBox({ x: ob.x + ob.w - 212, y: ob.y + ob.h - 250, w: 24, h: 60 }, 760, 764, dark));
    R.add(box);
    const plate = g.socket.plate, socket = tag(new Group(), 'socket');
    socket.add(softBox(plate, 0, 80, white, 30));
    for (const o of [g.socket.mon, g.socket.pc]) socket.add(drum(o.x, o.y, 80, 100, 220, mat(0xdcd8d0), 20));
    R.add(socket, tag(softBox(WALL_PLATE, 0, 80, white, 30), 'wall'));

    // ---- light: the window carries the day (the sky's soft light and the sun, both let in by the opening alone, so the room is lit from one
    // side and falls off away from it); the room's bounce is its probe (`setProbe`); a faint fill from the viewer's side, the lamps, the screen ----
    R.add(this.hemi);
    const cx = (g.desk.x0 + g.desk.x1) / 2;
    this.fill.position.set(cx - 6000, deskTop + 16000, DESK_D + 30000);
    this.fill.target.position.set(cx, deskTop, 0);
    R.add(this.fill, this.fill.target);
    const wc = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const;
    // up and out behind the window, a little west of it: the sky's light comes down through the opening and rakes east over the desk
    this.key.position.set(wc[0] - 2500, wc[1] + 6000, -WALL_T - 5000);
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
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 2500);
    R.add(this.screenLight);
    this.probeAt = [cx, deskTop + 3500, DESK_D + 5000];

    // the room's own reflections: the studio's environment at first, set on each of its materials so the evening can dim them, then the probe's
    if (env) R.traverse((o) => {
      const m = (o as Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if ((x as MeshStandardMaterial).isMeshStandardMaterial && !(x as MeshStandardMaterial).envMap) { (x as MeshStandardMaterial).envMap = env; this.envMats.add(x as MeshStandardMaterial); }
    });
    // the still scenery in few draws
    mergeStatic(R);
  }

  /** The sun at an hour: a spot far out along its direction, aimed through the window's middle. Its shadow is drawn again when it moves. */
  private aimSun(hour: number): void {
    const d = sunDir(hour), W = WINDOW, c = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const;
    this.sun.position.set(c[0] + d[0] * SUN_D, c[1] + d[1] * SUN_D, c[2] + d[2] * SUN_D);
    this.sun.target.position.set(c[0] - d[0] * 20000, c[1] - d[1] * 20000, c[2] - d[2] * 20000);
    this.sun.shadow.needsUpdate = true;
  }

  /**
   * The room's own light for its materials' ambient light and reflections, in place of the studio's: a `Probe` of the room, which holds the day
   * and the night as they fall in it, so it is not dimmed by the hour.
   */
  setProbe(t: Texture): void {
    this.probe = true;
    for (const m of this.envMats) m.envMap = t;
  }

  /** The shadow maps at `level` of the graphics settings. A new map is drawn on the next frame; no shadows frees them. */
  setShadows(level: number): void {
    this.outside.setShadows(level);
    const sizes = SHADOW_LEVELS[level] ?? null;
    [this.key, this.sun, this.lampLight].forEach((l, i) => {
      const size = sizes?.[i] ?? 0;
      l.castShadow = size > 0;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
      if (l.shadow.mapSize.x !== size || !size) { l.shadow.map?.dispose(); l.shadow.map = null; }
      if (!size) return;
      l.shadow.mapSize.set(size, size);
      l.shadow.radius = SHADOW_SOFT[i]! * (size / SHADOW_LEVELS[3]![i]!);
    });
  }

  /** The window's view for this frame's camera (before the frame's draw); `samples`: the scene target's multisampling. */
  drawOutside(renderer: WebGLRenderer, camera: PerspectiveCamera, samples: number): void { this.outside.draw(renderer, camera, samples); }

  /** Free what is not under the root: the outside's scene and its targets. */
  dispose(): void { this.outside.dispose(); }

  private shadowTurn = 0;
  private shadowAt = 0;

  /**
   * The lights hold still (the sun moves a step a few times a game hour), so a shadow map holds until a caster moves. Every map redraws for the
   * next frame when one moved (`ShadowCache.scan`, which then redraws only the movers), else one light per turn, so what the scan leaves out (the
   * fans' rotors, instanced parts) catches up.
   */
  redrawShadows(moved: boolean, now: number): void {
    const lights = [this.key, this.sun, this.lampLight];
    if (moved) { for (const l of lights) l.shadow.needsUpdate = true; return; }
    if (now - this.shadowAt < SHADOW_TURN_MS) return;
    this.shadowAt = now;
    lights[this.shadowTurn++ % lights.length]!.shadow.needsUpdate = true;
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
    this.blind.scale.y = bh; this.blind.position.y = -(WINDOW.y + 900) - bh / 2;
    const open = 1 - this.blindK * 0.85;
    // the day comes in by the window, the sky's light and the sun; the rest of the room has what bounces (the probe). At night a dim blue
    // moonlight: the lamps, the screen and the machine carry the room
    this.sun.intensity = (day * 4.2 + night * 0.25) * open;
    this.key.intensity = (0.05 + day * 2.2) * open * KEY_REF ** KEY_DECAY;
    this.fill.intensity = 0.03 + day * 0.45;
    this.hemi.intensity = 0.06 + day * 0.45;
    this.hemi.color.set(0x5d6fae).lerp(NOON_SKY, day);
    const env = this.probe ? PROBE_K : 0.35 * (0.16 + 0.84 * day);
    for (const m of this.envMats) m.envMapIntensity = env;
    this.lampLight.intensity = f.lamp ? 1.8 + night * 1.2 : 0;
    this.lamp.bulb.emissiveIntensity = f.lamp ? 3 : 0.05;
    this.lamp.inner.emissiveIntensity = f.lamp ? 0.6 : 0;
    // the bedside lamp lights itself as the evening comes: a warm pool round the bed, its bulb glowing through the shade
    const bedside = Math.min(1, Math.max(0, (night - 0.35) / 0.3));
    this.bedLight.intensity = bedside * 9000;
    this.shade.emissiveIntensity = bedside * 1.1;
    this.bedGlow.emissiveIntensity = bedside * 4;
    this.screenLight.intensity = f.screen.powered ? 0.3 + night * 0.7 : 0;
    this.lightKey = `${this.sunKey >> 1}|${f.lamp}|${Math.round(this.blindK * 6)}|${f.screen.powered}|${Math.round(bedside * 4)}`;
    this.monitor.set(f.screen, f.hour);
    this.clock.set(f.hour);
    steam(this.mug, f.t);
  }
}
