// The 3D room: a small, cozy bedroom round the desk (docs/LOWPOLY_STYLE.md "Look decision"). A closed box at real sizes (`roomplan.ts`): warm plaster
// walls, a slatted wood panel behind the desk, a deep window west of it on a painted world (`outside3d.ts`), oak planks and a wool rug, the bed and
// its bedside table east of the desk, a bookcase and the door on the west wall (`furniture3d.ts`). On and over the desk: the monitor, keyboard,
// mouse, mug, architect lamp, digital clock, the key rack, the router on its shelf, the letterbox and the wall plates (`props3d.ts`). x and y of
// the desk's things come from the 2D layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the back wall. The sim knows nothing of it.
import {
  BoxGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Shape, ShapeGeometry,
  SpotLight, type Texture,
} from 'three';
import type { KeySnap } from '@/worker/game/types';
import { CASE, ETH0_RECT, MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, type Rect } from '@/features/board/render/layout/layout';
import { hung } from '@/features/board/render/three/wires3d';
import { disposeTree, drum, instanced, paint, place, rectBox, softBox, tube } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { ENV_H, ENV_W, MAIL_S, keyPose, letterPose, mailStage } from '../desk/props/mail';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DigitalClock, Monitor, keyboard, lamp, mouse, mug, plant, steam, type Lamp, type Mug, type Screen } from './props3d';
import { Outside, outsideMesh } from './outside3d';
import { basket, bed, bookcase, ceilingLight, curtains, door, floorPlant, nightstand, print, radiator } from './furniture3d';
import {
  BED, BOARD_Z, CASE_D, CASE_Z, CEIL_Y, DESK_D, DESK_TOP, DOOR, EAST_X, FLOOR_Y, FRONT_Z, MONITOR_Z, SLATS_X0, SLATS_X1, SLAT_W, WALL_T, WEST_X, WINDOW,
  daylight, slatRuns, sunDir, wallAround,
} from './roomplan';

const KEY_W = 230;

/** The shadow map sizes at each level of the graphics settings (the front key, the sun, the lamp); 0 has no shadows, 3 is the tuned look. */
const SHADOW_LEVELS: readonly (readonly number[] | null)[] = [null, [1024, 1024, 512], [2048, 1024, 1024], [4096, 2048, 1024], [8192, 4096, 2048]];
/** Each light's softness at level 3. It is in map texels, so a map of another size takes its share and the shadow's edge stays as wide. */
const SHADOW_SOFT = [10, 5, 6];
/** While nothing large moves, one light redraws its shadow map at this pace (ms): a whole round costs one frame's worth, spread out. */
const SHADOW_TURN_MS = 400;
/** The window's frame sits this far back in its reveal (z of its room face), and the glass a little behind that. */
const FRAME_Z = -1000, GLASS_Z = -1500;
/** The sun is a spot this far out along its direction from the window: its cone covers the opening, its shadow the reveal and the frame. */
const SUN_D = 90000;

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

/** Plaster: a flat warm paint with a faint mottle (the light shows it, a hand-finished wall). */
function plasterTex(base: string, repeat: [number, number]): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 600; k++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.012)' : 'rgba(60,40,20,0.01)';
      c.beginPath(); c.arc(rnd() * w, rnd() * h, 2 + rnd() * 6, 0, Math.PI * 2); c.fill();
    }
  }, repeat);
}

/** A wool rug: cream, a soft diamond lattice, a terracotta band inside a plain edge. */
function rugTex(): Texture | null {
  return paint(1024, 576, (c, w, h) => {
    c.fillStyle = '#e9e0cf'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 5000; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(90,60,30,0.05)'; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
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
  private front = new DirectionalLight(0xfff4e6, 1);
  private hemi = new HemisphereLight(0xe4ecff, 0x8a6a50, 1);
  private windowFill = new SpotLight(0xd4e2ff, 0, 0, 0.95, 1, 0);
  private lampLight = new SpotLight(0xffd29a, 0, 0, 0.6, 0.7, 0);
  private bedLight = new PointLight(0xffb46a, 0, 30000, 0);
  private screenLight = new PointLight(0xa8cfff, 0, 9000, 0);
  private outside: Outside;
  private blind = new Mesh();
  private blindK = 0;
  private sunKey = -1;
  private keysKey = '';
  private lamp: Lamp;
  private monitor: Monitor;
  private clock: DigitalClock;
  private mug: Mug;
  private shade: MeshStandardMaterial;

  constructor() {
    this.geo = roomGeo();
    const g = this.geo, R = this.root, ys = g.ys, fl = FLOOR_Y, deskTop = -ys, H = fl - CEIL_Y;
    const white = mat(0xf3f1ec, { roughness: 0.4 });
    const deskWood = mat(0xffffff, { map: woodTex('#3f2a1e', '#160c06', { across: true }), roughness: 0.55 });
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
    // the skirting and a small cornice round the room (the door breaks the skirting on the west wall)
    const skirt = (r: Rect, z0: number, z1: number) => R.add(shell(softBox(r, z0, z1, white, 40)));
    skirt({ x: WEST_X, y: fl - 1100, w: EAST_X - WEST_X, h: 1100 }, 0, 200);
    skirt({ x: WEST_X, y: fl - 1100, w: 200, h: 1100 }, 0, DOOR.z0 - 900);
    skirt({ x: WEST_X, y: fl - 1100, w: 200, h: 1100 }, DOOR.z1 + 900, FRONT_Z);
    skirt({ x: EAST_X - 200, y: fl - 1100, w: 200, h: 1100 }, 0, FRONT_Z);
    skirt({ x: WEST_X, y: fl - 1100, w: EAST_X - WEST_X, h: 1100 }, FRONT_Z - 200, FRONT_Z);
    skirt({ x: WEST_X, y: CEIL_Y, w: EAST_X - WEST_X, h: 700 }, 0, 380);
    skirt({ x: WEST_X, y: CEIL_Y, w: 380, h: 700 }, 0, FRONT_Z);
    skirt({ x: EAST_X - 380, y: CEIL_Y, w: 380, h: 700 }, 0, FRONT_Z);

    // ---- the floor: long oak planks; a wool rug in front of the bed ----
    const floor = new Mesh(new PlaneGeometry(EAST_X - WEST_X, FRONT_Z), mat(0xffffff, { map: woodTex('#b98a5e', '#6a4426', { planks: true, across: true, repeat: [3.4, 3.9] }), roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((WEST_X + EAST_X) / 2, -fl, FRONT_Z / 2);
    floor.receiveShadow = true;
    R.add(floor);
    const rug = place(new Mesh(new BoxGeometry(48000, 120, 27000), mat(0xffffff, { map: rugTex(), roughness: 0.97 })));
    rug.position.set(6000, -fl + 60, 27500);
    rug.castShadow = false;
    R.add(rug);

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
    this.outside = new Outside(W.x + W.w / 2, -(W.y + W.h / 2), W.w, W.h, GLASS_Z);
    winG.add(outsideMesh(this.outside), glass);
    // the inside sill, over the radiator
    const sillY = W.y + W.h;
    winG.add(softBox({ x: W.x - 700, y: sillY, w: W.w + 1400, h: 380 }, fz0 - 200, 1100, white, 60));
    // the roller blind: its cassette at the top of the reveal, its cloth comes down in front of the frame
    winG.add(softBox({ x: W.x + 150, y: W.y, w: W.w - 300, h: 900 }, -900, -150, white, 120));
    this.blind = place(new Mesh(new BoxGeometry(W.w - 500, 1, 40), mat(0xffffff, { map: plasterTex('#efe6d4', [2, 4]), roughness: 0.9, side: DoubleSide })));
    this.blind.position.set(W.x + W.w / 2, -(W.y + 900), -500);
    winG.add(this.blind);
    R.add(winG);
    const pot = plant(0, 0, 0);
    pot.scale.setScalar(3.4);
    pot.position.set(W.x + W.w - 2600, -sillY, -300);
    R.add(pot);
    R.add(radiator(), curtains());

    // ---- the furniture: the bed and its table, the bookcase, the door, the ceiling light, a print over the bed, plants, the basket ----
    const ns = nightstand();
    this.shade = ns.shade;
    this.bedLight.position.set(...ns.bulb);
    const top = ceilingLight(4000, CEIL_Y, 30000);
    R.add(bed(), ns.root, bookcase(), door(), top.root, floorPlant(-35500, 30000), basket(-15500, 6200), this.bedLight);
    R.add(print({ x: BED.x + BED.w / 2 - 7600, y: -15800, w: 15200, h: 10800 }, 0));

    // ---- the desk: a thick top, a panel leg at the west end, three drawers at the east end, on the floor ----
    R.add(softBox({ x: g.desk.x0, y: ys, w: g.desk.x1 - g.desk.x0, h: DESK_TOP }, 0, DESK_D, deskWood, 60));
    R.add(softBox({ x: g.desk.x0 + 250, y: ys + DESK_TOP, w: 500, h: fl - ys - DESK_TOP }, 300, DESK_D - 300, deskWood, 40));
    const ped = { x: g.desk.x1 - 7800, y: ys + DESK_TOP, w: 7500, h: fl - ys - DESK_TOP - 500 };
    R.add(softBox(ped, 300, DESK_D - 400, deskWood, 40));
    R.add(softBox({ x: ped.x + 300, y: ped.y + ped.h, w: ped.w - 600, h: 500 }, 600, DESK_D - 900, dark, 30));
    const dh = (ped.h - 240) / 3;
    for (let k = 0; k < 3; k++) {
      const d = { x: ped.x + 110, y: ped.y + 70 + k * (dh + 50), w: ped.w - 220, h: dh - 40 };
      R.add(softBox(d, DESK_D - 420, DESK_D - 300, deskWood, 40));
      R.add(softBox({ x: d.x + d.w / 2 - 900, y: d.y + d.h * 0.3, w: 1800, h: 110 }, DESK_D - 300, DESK_D - 190, chrome, 40));
    }

    // ---- on the desk: the monitor, the keyboard on its mat, the mouse, the mug ----
    this.monitor = new Monitor(MONITOR, SCREEN, ys, MONITOR_Z);
    R.add(this.monitor.root);
    const kx = MONITOR.x + MONITOR.w / 2, kz = MONITOR_Z + 3600;
    R.add(softBox({ x: kx - 5200, y: ys - 40, w: 11200, h: 40 }, kz - 2100, kz + 2100, mat(0x5b6168, { roughness: 0.95 }), 20));
    R.add(keyboard(kx, ys, kz), mouse(kx + 4100, ys, kz + 200));
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
    for (let k = 0; k < 4; k++) router.add(drum(ROUTER_SPOT.x + 400 + k * 260, ROUTER_SPOT.y + ROUTER_SPOT.h * 0.6, 1400, 1420, 36, mat(0x111111, { emissive: new Color(0x58e08a), emissiveIntensity: 1.5 }), 8));
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
    R.add(box);
    const plate = g.socket.plate, socket = tag(new Group(), 'socket');
    socket.add(softBox(plate, 0, 80, white, 30));
    for (const o of [g.socket.mon, g.socket.pc]) socket.add(drum(o.x, o.y, 80, 100, 220, mat(0xdcd8d0), 20));
    R.add(socket, tag(softBox(WALL_PLATE, 0, 80, white, 30), 'wall'));

    // ---- light: an even fill, a soft key from the front, the sun and the sky through the window, the lamps, the screen ----
    R.add(this.hemi);
    const cx = (g.desk.x0 + g.desk.x1) / 2;
    this.front.position.set(cx - 6000, deskTop + 16000, DESK_D + 30000);
    this.front.target.position.set(cx, deskTop, 0);
    this.front.castShadow = true;
    this.front.shadow.mapSize.set(4096, 4096);
    Object.assign(this.front.shadow.camera, { left: -30000, right: 30000, top: 20000, bottom: -20000, near: 1000, far: 90000 });
    this.front.shadow.bias = -0.0003; this.front.shadow.normalBias = 20; this.front.shadow.radius = 10;
    R.add(this.front, this.front.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: SUN_D - 30000, far: SUN_D + 90000 });
    this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 30; this.sun.shadow.radius = 5;
    R.add(this.sun, this.sun.target);
    const wc = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const;
    this.windowFill.position.set(wc[0], wc[1] + 3000, -WALL_T - 9000);
    this.windowFill.target.position.set(wc[0] + 3000, wc[1] - 9000, 30000);
    R.add(this.windowFill, this.windowFill.target);
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 2500);
    R.add(this.screenLight);
  }

  /** The sun at an hour: a spot far out along its direction, aimed through the window's middle. Its shadow is drawn again when it moves. */
  private aimSun(hour: number): void {
    const d = sunDir(hour), W = WINDOW, c = [W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z] as const;
    this.sun.position.set(c[0] + d[0] * SUN_D, c[1] + d[1] * SUN_D, c[2] + d[2] * SUN_D);
    this.sun.target.position.set(c[0] - d[0] * 20000, c[1] - d[1] * 20000, c[2] - d[2] * 20000);
    this.sun.shadow.needsUpdate = true;
  }

  /** The shadow maps at `level` of the graphics settings. A new map is drawn on the next frame; no shadows frees them. */
  setShadows(level: number): void {
    const sizes = SHADOW_LEVELS[level] ?? null;
    [this.front, this.sun, this.lampLight].forEach((l, i) => {
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

  private shadowTurn = 0;
  private shadowAt = 0;

  /**
   * The lights hold still (the sun moves a step a few times a game hour), so a shadow map holds until a caster moves. Every map redraws for the
   * next frame when one moved (`ShadowCache.scan`, which then redraws only the movers), else one light per turn, so what the scan leaves out (the
   * fans' rotors, instanced parts) catches up.
   */
  redrawShadows(moved: boolean, now: number): void {
    const lights = [this.front, this.sun, this.lampLight];
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
      this.windowFill.color.set(s.top).lerp(new Color(0xffffff), 0.55);
    }
    this.blindK += ((f.blind ? 1 : 0) - this.blindK) * (1 - Math.pow(0.02, dt));
    const wh = WINDOW.h - 900, bh = Math.max(1, this.blindK * wh);
    this.blind.scale.y = bh; this.blind.position.y = -(WINDOW.y + 900) - bh / 2;
    const open = 1 - this.blindK * 0.85;
    this.sun.intensity = (day * 3.2 + night * 0.25) * open;
    this.windowFill.intensity = (0.15 + day * 0.65) * open;
    this.front.intensity = 0.3 + day * 0.75;
    this.hemi.intensity = 0.45 + day * 0.7;
    this.hemi.color.set(day > 0.5 ? 0xe4ecff : 0x9aa8d8);
    this.lampLight.intensity = f.lamp ? 1.8 + night * 1.2 : 0;
    this.lamp.bulb.emissiveIntensity = f.lamp ? 3 : 0.05;
    this.lamp.inner.emissiveIntensity = f.lamp ? 0.6 : 0;
    // the bedside lamp lights itself as the evening comes
    const bedside = Math.min(1, Math.max(0, (night - 0.35) / 0.3));
    this.bedLight.intensity = bedside * 1.3;
    this.shade.emissiveIntensity = bedside * 0.9;
    this.screenLight.intensity = f.screen.powered ? 0.25 + night * 0.4 : 0;
    this.monitor.set(f.screen, f.hour);
    this.clock.set(f.hour);
    steam(this.mug, f.t);
  }
}
