// The 3D room: a bedroom in a high-rise flat round the desk, modern and minimal, dark to sit with the game's interface (slate walls, smoked oak,
// black-brown flat-pack furniture, cyan LED light at night; tones in `palette.ts`). A closed box at real sizes (`roomplan.ts`): a glass wall
// behind the desk, floor to ceiling, onto the city in 3D (`outside/view.ts`; the glass looks north and is tinted, so the day stays soft), the
// building's column in it, a stone bench along it; oak planks and a rug, the bed and its bedside drawer east of the desk, a bookcase and the door
// on the west wall (`furniture3d.ts`). On and over the desk: the monitor, keyboard, mouse, tea cup, architect lamp, the key stand; on the
// column: the digital clock, the router on its shelf, the letterbox and the wall plates (`props3d.ts`). x and y of the desk's things come from
// the 2D layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the back wall. The sim knows nothing of it.
import {
  BoxGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Shape, ShapeGeometry, SphereGeometry,
  RectAreaLight, SpotLight, type Material, type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { KeySnap } from '@/worker/game/types';
import { CASE, ETH0_RECT, MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, type Rect } from '@/features/board/render/layout/layout';
import { hung } from '@/features/board/render/three/wires3d';
import { disposeTree, drum, paint, place, post, rectBox, rod, softBox, tube, worldUv } from '@/core/render/three/geometry';
import { mergeStatic } from '@/core/render/three/merge';
import { boxEnv, boxProjected, type BoxEnv } from '@/core/render/three/boxenv';
import { cloth, mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { ENV_H, ENV_W, MAIL_S, keyPose, letterPose, mailStage } from '../desk/props/mail';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DigitalClock, KEY_LEAD, Monitor, keyboard, lamp, mouse, notebook, steam, teaCup, type Cup, type Lamp, type Screen } from './props3d';
import { OutsideView } from './outside/view';
import { bed, bookcase, ceilingLight, door, eastWall, nightstand, oak, print } from './furniture3d';
import { deskChair } from './chair3d';
import { mess } from './clutter3d';
import { FIG_AT, aloe, floorPlant } from './plants3d';
import { CEILING, LANTERN, NEON, OAK, OAK_GRAIN, RUG_LINE, RUG_WOOL, STEEL, STONE, TRIM, VENEER, VENEER_GRAIN, WALL, rgbOf } from './palette';
import {
  BED, BENCH, BOARD_Z, CASE_D, CASE_Z, CEIL_Y, CLOCK_Y, DESK_D, DESK_TOP, DOOR, EAST_X, FLOOR_Y, FRONT_Z, KEY_STAND, MONITOR_Z, MULLION_X, PED, PIER, RUG, TRAY,
  WALL_T, WEST_X, WINDOW,
  daylight, sunDir, wallAround,
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
/** The plaster texture's size on the walls (units; about 43 cm). */
const PLASTER_TILE = 8000;
/** The sky's fill colour at noon (the night's is a deep blue). */
const NOON_SKY = new Color(0xe4ecff);
/** The share of the day's light the tinted glass holds back at noon (`OutsideView.setTint` darkens the view as much). */
const TINT_CUT = 0.35;

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

let seedN = 1;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);

/**
 * Plaster: a flat paint over a hand-trowelled wall. A soft cloud of light and shade (smooth noise over three scales, seamless across the
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
 * Smoked oak floor planks running east-west: each board its own tone and grain, a knot here and there, staggered butt joints, the joints dark
 * with a lit edge (an eased bevel). A tile is eight boards; the board that crosses the tile's edge carries on in the next tile, so no joint
 * lines up.
 */
function planksTex(): Texture | null {
  const [pr, pg, pb] = rgbOf(OAK), grain = `rgba(${rgbOf(OAK_GRAIN).join(',')},`;
  return paint(1024, 1024, (c, w, h) => {
    const rows = 8, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * ph, cuts = [((r * 0.37 + 0.13) % 1) * w];
      if (r % 2) cuts.push(((r * 0.37 + 0.63) % 1) * w);
      cuts.sort((a, b) => a - b);
      // the boards of this row: between the cuts, and the one through the tile's edge (drawn in two parts, the same board)
      const boards: [number, number][][] = cuts.map((x, k) => (k + 1 < cuts.length ? [[x, cuts[k + 1]!]] : [[x, w], [0, cuts[0]!]]));
      for (const parts of boards) {
        const f = 0.84 + rnd() * 0.3, warm = rnd() * 10 - 5, seed = seedN;
        for (const [x0, x1] of parts) {
          seedN = seed;
          c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, ph); c.clip();
          c.fillStyle = `rgb(${Math.min(255, pr * f + warm)},${Math.min(255, pg * f)},${pb * f - warm})`; c.fillRect(0, y0, w, ph);
          // the grain along the board, waved a little; a few lighter streaks
          for (let i = 0; i < 16; i++) {
            const gy = y0 + rnd() * ph, amp = 2 + rnd() * 5;
            c.strokeStyle = rnd() < 0.8 ? `${grain}${0.14 + rnd() * 0.18})` : `rgba(255,236,205,${0.04 + rnd() * 0.05})`; c.lineWidth = 0.8 + rnd() * 1.8;
            c.beginPath(); c.moveTo(0, gy); for (let x = 0; x <= w; x += 64) c.lineTo(x, gy + Math.sin(x / 90 + i) * amp); c.stroke();
          }
          // a knot: dark heart, rings stretched along the board
          if (rnd() < 0.4) {
            const kx = x0 + (0.2 + rnd() * 0.6) * (x1 - x0), ky = y0 + ph * (0.3 + rnd() * 0.4);
            for (let k = 4; k >= 0; k--) { c.fillStyle = `rgba(${40 + k * 12},${26 + k * 9},${16 + k * 6},${0.06 + (4 - k) * 0.05})`; c.beginPath(); c.ellipse(kx, ky, 5 + k * 7, 3 + k * 2.2, 0, 0, Math.PI * 2); c.fill(); }
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

/** A flat-woven wool rug: charcoal, a fine herringbone of light and dark rows, a pale line inside a plain edge; a fleck of pile (its bump too). */
function rugTex(): Texture | null {
  return paint(1024, 768, (c, w, h) => {
    c.fillStyle = RUG_WOOL; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) for (let y = 0; y < h; y += 6) {
      c.fillStyle = (Math.floor(x / 12) + Math.floor(y / 6)) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
      c.fillRect(x, y, 12, 3);
    }
    for (let k = 0; k < 14000; k++) { c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.08})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    const m = 54;
    c.strokeStyle = RUG_LINE; c.lineWidth = 5; c.strokeRect(m, m, w - 2 * m, h - 2 * m);
  });
}

/** The area lights' tables (once per page): a `RectAreaLight` lights nothing without them. */
let areaLights = false;

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
  private bedLight = new PointLight(LANTERN, 0, 42000, 1);
  private screenLight = new PointLight(0xa8cfff, 0, 9000, 0);
  private outside: OutsideView;
  private blinds: Mesh[] = [];
  private blindK = 0;
  private sunKey = -1;
  private keysKey = '';
  private lamp: Lamp;
  private monitor: Monitor;
  private clock: DigitalClock;
  private cup: Cup;
  private shade: MeshStandardMaterial;
  private bulbGlow: MeshStandardMaterial;
  /** The bed's LED strips, and the area lights they stand for (the floor round the bed, the wall over the headboard). */
  private ledGlow: MeshStandardMaterial;
  private ledUnder: RectAreaLight;
  private ledHalo: RectAreaLight;
  /** The LED strip under the desk's front edge, the same light. */
  private deskLed = new RectAreaLight(NEON, 0, 1, 1);
  /** The room's materials that take the environment's reflections: the studio's, dimmed at night, until the probe has the room's own. */
  private envMats = new Set<MeshStandardMaterial>();
  private probe = false;
  /** The room's box for the probe's reflections (boxenv.ts): on once the probe holds the room. */
  private box: BoxEnv;
  /** Where the room's probe sees from (world): over the desk's front, in the room's middle height. */
  readonly probeAt: [number, number, number];
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
    const plaster = mat(0xffffff, { map: plasterTex(WALL, [1, 1]), roughness: 0.92 }), wall = (r: Rect, z0: number, z1: number) => worldUv(rectBox(r, z0, z1, plaster), PLASTER_TILE);
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
    const planks = planksTex();
    const floor = new Mesh(new PlaneGeometry(EAST_X - WEST_X, FRONT_Z), mat(0xffffff, { map: planks, bumpMap: planks, bumpScale: 0.9, roughness: 0.36 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((WEST_X + EAST_X) / 2, -fl, FRONT_Z / 2);
    floor.receiveShadow = true;
    R.add(floor);
    const pile = rugTex();
    const rug = softBox({ x: RUG.x0, y: fl - RUG.h, w: RUG.x1 - RUG.x0, h: RUG.h }, RUG.z0, RUG.z1, cloth(0xffffff, { map: pile, bumpMap: pile, bumpScale: 2, roughness: 0.97 }), 140);
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
    this.outside = new OutsideView(W.x + W.w / 2, -(W.y + W.h / 2), W.w, W.h, GLASS_Z);
    winG.add(this.outside.mesh, glass);
    const cassette = mat(0x2a2d33, { roughness: 0.5 }), screen = mat(0xffffff, { map: plasterTex('#4b5059', [2, 4]), roughness: 0.9, side: DoubleSide });
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
    this.shade = ns.shade;
    this.bulbGlow = ns.glow;
    this.bedLight.position.set(...ns.bulb);
    const top = ceilingLight(4000, CEIL_Y, 30000);
    R.add(bd.root, ns.root, bookcase(), door(), top.root, floorPlant(FIG_AT.x, FIG_AT.z), eastWall(), this.bedLight);
    R.add(print({ x: BED.x + BED.w / 2 - 7600, y: -15800, w: 15200, h: 10800 }, 0));

    // ---- the desk: a smoked oak top (the floor's and the slats' wood) on two round black steel legs at the west end and a black-brown drawer
    // unit at the east end, a cable tray under its back edge ----
    const dw = g.desk.x1 - g.desk.x0, legH = fl - ys - DESK_TOP;
    R.add(softBox({ x: g.desk.x0, y: ys, w: dw, h: DESK_TOP }, 0, DESK_D, mat(0xffffff, { map: oak(OAK, OAK_GRAIN, [2, 1]), roughness: 0.45 }), 60));
    // the legs: round steel tubes screwed into plates under the top, a plastic foot on each
    const steel = mat(STEEL, { roughness: 0.45, metalness: 0.4 }), tx = g.desk.x0 + 1000;
    for (const z of [1000, DESK_D - 1000]) {
      R.add(post(tx, fl - 200, z, 280, legH - 200, steel, 24), post(tx, fl, z, 300, 200, mat(0x111214, { roughness: 0.8 }), 24));
      R.add(softBox({ x: tx - 600, y: ys + DESK_TOP, w: 1200, h: 60 }, z - 600, z + 600, steel, 20));
    }
    // the drawer unit: a black-brown carcass from the floor to the top, five fronts with a dark gap round each, a grip cut along each top edge
    const ped = { x: g.desk.x1 - PED.in, y: ys + DESK_TOP, w: PED.w, h: legH };
    const alex = mat(0xffffff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.55 }), slot = mat(0x0c0c0d, { roughness: 0.9 });
    R.add(softBox(ped, 300, DESK_D - 400, alex, 40));
    R.add(rectBox({ x: ped.x + 260, y: ped.y + 40, w: ped.w - 520, h: ped.h - 80 }, DESK_D - 400, DESK_D - 380, slot));
    const dh = (ped.h - 160 - 4 * 90) / 5;
    for (let k = 0; k < 5; k++) {
      const d = { x: ped.x + 300, y: ped.y + 80 + k * (dh + 90), w: ped.w - 600, h: dh };
      R.add(softBox(d, DESK_D - 520, DESK_D - 300, alex, 50));
      R.add(rectBox({ x: d.x + d.w / 2 - 1500, y: d.y, w: 3000, h: 220 }, DESK_D - 310, DESK_D - 290, slot));
    }
    // the cable tray: a black steel trough hung under the top's back edge (the power strip lies in it, `clutter3d.ts`) on two brackets
    const t = TRAY, under = ys + DESK_TOP, ty = under + t.drop;
    for (const [z0, z1] of [[t.z0, t.z0 + 60], [t.z1 - 60, t.z1]] as const) R.add(softBox({ x: t.x0, y: ty, w: t.x1 - t.x0, h: t.h }, z0, z1, steel, 20));
    R.add(softBox({ x: t.x0, y: ty + t.h - 60, w: t.x1 - t.x0, h: 60 }, t.z0, t.z1, steel, 20));
    for (const x of [t.x0, t.x1 - 60]) R.add(softBox({ x, y: ty, w: 60, h: t.h }, t.z0, t.z1, steel, 20));
    for (const x of [t.x0 + 1500, t.x1 - 1500]) R.add(softBox({ x: x - 200, y: under, w: 400, h: t.drop }, t.z1 - 400, t.z1, steel, 20));
    // a cyan LED strip under the top's front edge, as round the bed: at night the desk floats on its glow. Its area light is a narrow band
    // along the strip (a wide one would show as a bright box in the glass behind the desk)
    const knee0 = g.desk.x0 + 600, knee1 = ped.x - 200;
    R.add(rectBox({ x: knee0, y: under, w: knee1 - knee0, h: 120 }, DESK_D - 700, DESK_D - 540, this.ledGlow));
    this.deskLed.width = knee1 - knee0; this.deskLed.height = 1600;
    this.deskLed.position.set((knee0 + knee1) / 2, -under - 200, DESK_D - 1400);
    this.deskLed.rotation.x = -Math.PI / 2;
    R.add(this.deskLed);

    // ---- on the desk: the monitor, the keyboard on its felt mat, the mouse, a tea cup on its saucer, a notebook ----
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
    const matEnd = kx + 4800;
    R.add(softBox({ x: kx - 5200, y: ys - 40, w: matEnd - (kx - 5200), h: 40 }, kz - 2100, kz + 2100, mat(0xffffff, { map: felt, roughness: 0.97 }), 20));
    R.add(keyboard(kx, ys, kz), mouse(kx + 4100, ys, kz + 200), notebook(-16600, ys, 10000, 0.22));
    // the grommet the keyboard's cable goes down through, near the wall: a black cap on the top, its sleeve under it, over the tray
    const grommet = { x: kx + KEY_LEAD[0], z: kz + KEY_LEAD[1] }, cap = mat(0x111214, { roughness: 0.6 });
    R.add(post(grommet.x, ys, grommet.z, 420, 20, cap, 24), post(grommet.x, under + 300, grommet.z, 300, 300, cap, 20));
    // the chair, half under the desk west of the keyboard, turned toward the window as left after use
    R.add(deskChair(kx - 7500, DESK_D + 2600, -0.3));
    // the things about: a backpack against the drawer unit, the power strip in the tray and its leads, books on the bench
    R.add(mess(ped.x, under, grommet));
    // (the tea in the gap between the mat and the case)
    this.cup = teaCup((matEnd + CASE.x) / 2, ys, MONITOR_Z + 3200);
    R.add(this.cup.root);

    // ---- the architect lamp ----
    const lx = g.lamp.x;
    this.lamp = lamp({ x: lx, y: ys }, { x: lx - 1300, y: ys - 3900 }, g.lamp.head, g.lamp.mouth, 2600);
    R.add(this.lamp.root);
    const [mx, my, mz] = this.lamp.mouth;
    this.lampLight.position.set(mx, my, mz);
    this.lampLight.target.position.set(mx + this.lamp.dir[0] * 4000, deskTop, mz + 2500);
    this.lampLight.castShadow = true; this.lampLight.shadow.mapSize.set(1024, 1024); this.lampLight.shadow.bias = -0.0005; this.lampLight.shadow.radius = 6;
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
    router.add(softBox(ROUTER_SPOT, 300, 1400, mat(STEEL, { roughness: 0.4 }), 80));
    router.add(softBox({ x: ROUTER_SPOT.x, y: ROUTER_SPOT.y, w: ROUTER_SPOT.w, h: 120 }, 300, 1400, mat(0x2a2c30, { roughness: 0.4 }), 40));
    // its front: a darker strip with the status lights, vents over its top, two antennas on hinges at the back
    const rs = ROUTER_SPOT, ledY = rs.y + rs.h * 0.6;
    router.add(softBox({ x: rs.x + 250, y: ledY - 70, w: 1250, h: 140 }, 1395, 1410, mat(0x0d0e10, { roughness: 0.5 }), 30));
    const led = mat(0x111111, { emissive: new Color(NEON), emissiveIntensity: 1.8 });
    for (let k = 0; k < 4; k++) router.add(drum(rs.x + 420 + k * 280, ledY, 1405, 1425, 36, led, 8));
    for (let k = 0; k < 6; k++) router.add(rectBox({ x: rs.x + 500 + k * 220, y: rs.y - 4, w: 90, h: 8 }, 600, 1100, mat(0x08090a, { roughness: 0.8 })));
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
    R.add(socket, tag(softBox(WALL_PLATE, 0, 80, graphite, 30), 'wall'));

    // ---- light: the window carries the day (the sky's soft light and the sun, both let in by the opening alone, so the room is lit from one
    // side and falls off away from it); the room's bounce is its probe (`setProbe`); a faint fill from the viewer's side, the lamps, the screen ----
    R.add(this.hemi);
    const cx = (g.desk.x0 + g.desk.x1) / 2;
    this.fill.position.set(cx - 6000, deskTop + 16000, DESK_D + 30000);
    this.fill.target.position.set(cx, deskTop, 0);
    R.add(this.fill, this.fill.target);
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
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 2500);
    R.add(this.screenLight);
    this.probeAt = [cx, deskTop + 3500, DESK_D + 5000];

    // the room's own reflections: the studio's environment at first, set on each of its materials so the evening can dim them, then the probe's
    if (env) R.traverse((o) => {
      const m = (o as Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if ((x as MeshStandardMaterial).isMeshStandardMaterial && !(x as MeshStandardMaterial).envMap) { (x as MeshStandardMaterial).envMap = env; this.envMats.add(x as MeshStandardMaterial); }
    });
    this.box = boxEnv([WEST_X, -FLOOR_Y, 0], [EAST_X, -CEIL_Y, FRONT_Z], this.probeAt);
    for (const m of this.envMats) boxProjected(m, this.box);
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
    this.box.on.value = 1;
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
    for (const b of this.blinds) { b.scale.y = bh; b.position.y = -(WINDOW.y + 900) - bh / 2; }
    const open = 1 - this.blindK * 0.85;
    // the day comes in by the window, the sky's light and the sun; the rest of the room has what bounces (the probe). At night a dim blue
    // moonlight: the lamps, the screen and the machine carry the room
    // (the glass looks north: the sun comes in only low, at the day's two ends, from the side it stands to; the tint takes its share of the sky)
    const sunIn = smooth(0.02, 0.12, -sunDir(f.hour)[2]), clear = 1 - day * TINT_CUT;
    this.outside.setTint(day);
    this.sun.intensity = (day * 4.2 * sunIn + night * 0.25) * open * clear;
    // (at night the lit city's glow through the whole glass wall: a soft blue light over the desk)
    this.key.intensity = (0.05 + night * 0.7 + day * 2.2) * open * clear * KEY_REF ** KEY_DECAY;
    this.fill.intensity = 0.03 + day * 0.45;
    this.hemi.intensity = 0.06 + day * 0.45;
    this.hemi.color.set(0x5d6fae).lerp(NOON_SKY, day);
    const env = this.probe ? PROBE_K : 0.35 * (0.16 + 0.84 * day);
    for (const m of this.envMats) m.envMapIntensity = env;
    this.lampLight.intensity = f.lamp ? 1.8 + night * 1.2 : 0;
    this.lamp.bulb.emissiveIntensity = f.lamp ? 3 : 0.05;
    this.lamp.inner.emissiveIntensity = f.lamp ? 0.6 : 0;
    // the bedside lantern lights itself as the evening comes: a warm pool round the bed, its bulb glowing through the paper; the bed's LED
    // strips come on a little before it, a cyan glow on the floor round the bed and on the wall over the headboard
    const bedside = Math.min(1, Math.max(0, (night - 0.35) / 0.3)), led = Math.min(1, Math.max(0, (night - 0.2) / 0.4));
    this.bedLight.intensity = bedside * 9000;
    this.shade.emissiveIntensity = bedside * 1.1;
    this.bulbGlow.emissiveIntensity = bedside * 4;
    this.ledGlow.emissiveIntensity = led * 3;
    this.ledUnder.intensity = led * 6;
    this.ledHalo.intensity = led * 10;
    this.deskLed.intensity = led * 18;
    this.screenLight.intensity = f.screen.powered ? 0.3 + night * 0.7 : 0;
    this.lightKey = `${this.sunKey >> 1}|${f.lamp}|${Math.round(this.blindK * 6)}|${f.screen.powered}|${Math.round(bedside * 4)}|${Math.round(led * 4)}`;
    this.monitor.set(f.screen, f.hour);
    this.clock.set(f.hour);
    steam(this.cup, f.t);
  }
}
