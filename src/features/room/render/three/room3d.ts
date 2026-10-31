// The 3D room, modelled on the owner's reference image (docs/LOWPOLY_STYLE.md "Look decision"): a dark slatted wall, a white window on a sunny city
// with a plant on the sill, a dark wood desk with a drawer pedestal, the monitor, keyboard, mouse, mug, architect lamp, a digital clock, the key rack,
// the router on its shelf, the letterbox, wall plates, light planks and a blue low-poly rug. x and y come from the 2D layout (`roomGeo`, `layout.ts`,
// y flipped), z is the distance out of the wall. The props live in `props3d.ts`. The sim knows nothing of it.
import {
  BoxGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight,
  SpotLight, type Texture,
} from 'three';
import type { KeySnap } from '@/worker/game/types';
import { CASE, MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, type Rect } from '@/features/board/render/layout/layout';
import { disposeTree, drum, instanced, paint, place, rectBox, softBox, tube } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DigitalClock, Monitor, city, keyboard, lamp, mouse, mug, plant, skyTexture, steam, type Lamp, type Mug, type Screen } from './props3d';
import { DESK_D, MONITOR_Z, SLAT_W, daylight, slatRuns, wallAround } from './roomplan';

const KEY_W = 230;
const DESK_TOP = 360;

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
      c.globalAlpha = 0.5; c.strokeStyle = '#5a3a20'; c.lineWidth = 3;
      for (let y = 0; y <= h; y += h / 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      for (let k = 0; k < 6; k++) { const x = ((k * 0.43 + 0.17) % 1) * w; c.beginPath(); c.moveTo(x, k * h / 6); c.lineTo(x, (k + 1) * h / 6); c.stroke(); }
      for (let k = 0; k < 6; k++) { c.globalAlpha = 0.06 + (k % 3) * 0.04; c.fillStyle = k % 2 ? '#fff3dc' : '#3b2412'; c.fillRect(0, k * h / 6, w, h / 6); }
    }
    c.globalAlpha = 1;
  }, o.repeat);
}

/** The rug: a field of triangles in blues, a lighter border. */
function rugTex(): Texture | null {
  const blues = ['#2d5a9b', '#3a6db3', '#22477f', '#4b84c6', '#30609f', '#5a93cf'];
  return paint(512, 256, (c, w, h) => {
    c.fillStyle = '#20406f'; c.fillRect(0, 0, w, h);
    const s = 32;
    for (let y = 0; y < h; y += s) for (let x = -s; x < w + s; x += s) {
      for (const up of [true, false]) {
        c.fillStyle = blues[Math.floor(rnd() * blues.length)]!;
        c.beginPath();
        if (up) { c.moveTo(x, y + s); c.lineTo(x + s / 2, y); c.lineTo(x + s, y + s); } else { c.moveTo(x + s / 2, y); c.lineTo(x + s, y + s); c.lineTo(x + 1.5 * s, y); }
        c.fill();
      }
    }
    c.strokeStyle = '#7fa9da'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
  });
}

export interface RoomFrame { hour: number; lamp: boolean; blind: boolean; screen: Screen; t: number }

export class Room3D {
  readonly root = new Group();
  readonly geo: RoomGeo;
  private keys = new Group();
  private sun = new DirectionalLight(0xfff0d8, 1);
  private front = new DirectionalLight(0xfff4e6, 1);
  private hemi = new HemisphereLight(0xe4ecff, 0x8a6a50, 1);
  private lampLight = new SpotLight(0xffd29a, 0, 0, 0.6, 0.7, 0);
  private screenLight = new PointLight(0xa8cfff, 0, 9000, 0);
  private skyMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private cityLit: MeshStandardMaterial[] = [];
  private blind = new Mesh();
  private blindK = 0;
  private skyKey = -1;
  private keysKey = '';
  private lamp: Lamp;
  private monitor: Monitor;
  private clock: DigitalClock;
  private mug: Mug;

  constructor() {
    this.geo = roomGeo();
    const g = this.geo, R = this.root, ys = g.ys, floor = g.floor, deskTop = -ys;
    const white = mat(0xf3f1ec, { roughness: 0.4 });
    const deskWood = mat(0xffffff, { map: woodTex('#3f2a1e', '#160c06', { across: true }), roughness: 0.55 });
    const slatM = mat(0xffffff, { map: woodTex('#3a281d', '#150c06'), roughness: 0.7 });
    const chrome = mat(0xc9cdd2, { metalness: 0.85, roughness: 0.25 });
    const dark = mat(0x2a2c31, { roughness: 0.5 });

    // ---- the wall: a dark backing, dense slats down to the floor, cut round the window ----
    const x0 = g.desk.x0 - 18000, x1 = g.desk.x1 + 18000, top = g.ceil - 3000;
    const win = g.window, hole: Rect = { x: win.x - 200, y: win.y - 200, w: win.w + 400, h: win.h + 400 };
    const backing = mat(0x1a110b, { roughness: 0.95 });
    for (const r of wallAround(x0, x1, top, floor, hole)) R.add(rectBox(r, -260, 0, backing));
    const runs = slatRuns(x0, x1, top, floor, hole);
    R.add(instanced(new BoxGeometry(1, 1, 1), slatM, runs.map((s) => ({ x: s.x + SLAT_W / 2, y: -(s.y0 + s.y1) / 2, z: 60, sx: SLAT_W, sy: s.y1 - s.y0, sz: 120 }))));

    // ---- the floor and the rug ----
    const fl = place(new Mesh(new PlaneGeometry(x1 - x0, 60000), mat(0xffffff, { map: woodTex('#b5865a', '#6a4426', { planks: true, across: true, repeat: [9, 7] }), roughness: 0.6 })));
    fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, -floor, 30000);
    R.add(fl);
    const rugW = (g.desk.x1 - g.desk.x0) * 0.72;
    const rug = place(new Mesh(new BoxGeometry(rugW, 40, rugW * 0.42), mat(0xffffff, { map: rugTex(), roughness: 0.95 })));
    rug.position.set((g.desk.x0 + g.desk.x1) / 2 + 600, -floor + 20, DESK_D + rugW * 0.21 - 1500);
    R.add(rug);

    // ---- the window: a white frame with muntins, a deep sill with a plant, the blind, the city and the sky ----
    const winG = tag(new Group(), 'blind');
    const bar = 170, rows = [0.27, 0.62];
    const frame: Rect[] = [
      { x: hole.x, y: hole.y, w: hole.w, h: 200 }, { x: hole.x, y: win.y + win.h, w: hole.w, h: 200 },
      { x: hole.x, y: win.y, w: 200, h: win.h }, { x: win.x + win.w, y: win.y, w: 200, h: win.h },
      { x: win.x + win.w / 2 - bar / 2, y: win.y, w: bar, h: win.h },
      ...rows.map((k) => ({ x: win.x, y: win.y + win.h * k - bar / 2, w: win.w, h: bar })),
    ];
    for (const r of frame) winG.add(softBox(r, -220, 120, white, 30));
    const sillY = win.y + win.h + 200;
    winG.add(softBox({ x: hole.x - 500, y: sillY, w: hole.w + 1000, h: 200 }, -220, 1100, white, 50));
    winG.add(seeThrough(new Mesh(new PlaneGeometry(win.w, win.h), new MeshStandardMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.06, roughness: 0.05, depthWrite: false }))));
    winG.children[winG.children.length - 1]!.position.set(win.x + win.w / 2, -(win.y + win.h / 2), -120);
    this.blind = place(new Mesh(new BoxGeometry(win.w + 160, 1, 40), mat(0xeee4d0, { roughness: 0.85, side: DoubleSide })));
    this.blind.position.set(win.x + win.w / 2, -win.y, 160);
    winG.add(this.blind, softBox({ x: win.x - 100, y: win.y - 260, w: win.w + 200, h: 230 }, 40, 330, white, 60));
    R.add(winG);
    R.add(plant(win.x + win.w - 500, sillY, 550));
    const sky = new Mesh(new PlaneGeometry(win.w * 3.2, win.h * 2.4), this.skyMat);
    sky.position.set(win.x + win.w / 2, -(win.y + win.h * 0.5), -16000);
    R.add(seeThrough(sky));
    const town = city(win, win.y + win.h + 600);
    this.cityLit = town.lit;
    R.add(town.root);

    // ---- the desk: a thick top, a panel leg at the west end, three drawers at the east end ----
    R.add(softBox({ x: g.desk.x0, y: ys, w: g.desk.x1 - g.desk.x0, h: DESK_TOP }, 0, DESK_D, deskWood, 60));
    R.add(softBox({ x: g.desk.x0 + 250, y: ys + DESK_TOP, w: 500, h: floor - ys - DESK_TOP }, 300, DESK_D - 300, deskWood, 40));
    const ped = { x: g.desk.x1 - 4800, y: ys + DESK_TOP, w: 4500, h: floor - ys - DESK_TOP };
    R.add(softBox(ped, 300, DESK_D - 400, deskWood, 40));
    const dh = (ped.h - 240) / 3;
    for (let k = 0; k < 3; k++) {
      const d = { x: ped.x + 110, y: ped.y + 70 + k * (dh + 50), w: ped.w - 220, h: dh - 40 };
      R.add(softBox(d, DESK_D - 420, DESK_D - 300, deskWood, 40));
      R.add(softBox({ x: d.x + d.w / 2 - 550, y: d.y + d.h * 0.35, w: 1100, h: 90 }, DESK_D - 300, DESK_D - 200, chrome, 40));
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
    // the LAN lead: from the router along the wall into the top of the case
    R.add(tag(tube([[ROUTER_SPOT.x + ROUTER_SPOT.w, -(ROUTER_SPOT.y + ROUTER_SPOT.h * 0.6), 700], [ROUTER_SPOT.x + ROUTER_SPOT.w + 700, -(ROUTER_SPOT.y + ROUTER_SPOT.h * 0.6), 300], [CASE.x - 500, -(ROUTER_SPOT.y + ROUTER_SPOT.h * 0.6), 250], [CASE.x - 500, -(CASE.y + 900), 600], [CASE.x - 80, -(CASE.y + 1100), 1600]], 45, mat(0x8cc3e0, { roughness: 0.5 })), 'cable.lan'));
    const box = tag(new Group(), 'mail');
    box.add(softBox(OUTBOX, 0, 700, mat(0xb8342c, { roughness: 0.45 }), 70));
    box.add(rectBox({ x: OUTBOX.x + 180, y: OUTBOX.y - 10, w: OUTBOX.w - 360, h: 30 }, 200, 500, dark));
    R.add(box);
    const plate = g.socket.plate, socket = tag(new Group(), 'socket');
    socket.add(softBox(plate, 0, 80, white, 30));
    for (const o of [g.socket.mon, g.socket.pc]) socket.add(drum(o.x, o.y, 80, 100, 220, mat(0xdcd8d0), 20));
    R.add(socket, tag(softBox(WALL_PLATE, 0, 80, white, 30), 'wall'));

    // ---- light: an even daylight fill, a soft key from the front, the sun through the window, the lamp, the screen ----
    R.add(this.hemi);
    const cx = (g.desk.x0 + g.desk.x1) / 2;
    this.front.position.set(cx - 6000, deskTop + 16000, DESK_D + 30000);
    this.front.target.position.set(cx, deskTop, 0);
    this.front.castShadow = true;
    this.front.shadow.mapSize.set(4096, 4096);
    Object.assign(this.front.shadow.camera, { left: -26000, right: 26000, top: 18000, bottom: -18000, near: 1000, far: 90000 });
    this.front.shadow.bias = -0.0003; this.front.shadow.normalBias = 20; this.front.shadow.radius = 10;
    R.add(this.front, this.front.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -24000, right: 24000, top: 18000, bottom: -18000, near: 100, far: 80000 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 30; this.sun.shadow.radius = 8;
    this.sun.position.set(win.x + win.w * 0.3 - 9000, -win.y + 11000, -26000);
    this.sun.target.position.set(cx - 4000, deskTop, DESK_D * 0.6);
    R.add(this.sun, this.sun.target);
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 2500);
    R.add(this.screenLight);
  }

  /** The keys on the rack: a white stick on its lanyard per hook. */
  setKeys(tray: readonly KeySnap[]): void {
    const key = tray.map((k) => `${k.id}:${k.type}:${k.label}`).join(',');
    if (key === this.keysKey) return;
    this.keysKey = key;
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
      this.keys.add(g);
    });
  }

  frame(f: RoomFrame, dt: number): void {
    const day = daylight(f.hour), night = 1 - day;
    const hk = Math.round(f.hour * 20);
    if (hk !== this.skyKey) {
      this.skyKey = hk;
      const s = skyAt(f.hour);
      this.skyMat.map?.dispose(); this.skyMat.map = skyTexture(s.top, s.hor, day); this.skyMat.needsUpdate = true;
      this.sun.color.set(s.hor).lerp(new Color(0xfff2dc), day * 0.7);
      if (day <= 0) this.sun.color.set(0x8fa6ff);
    }
    this.blindK += ((f.blind ? 1 : 0) - this.blindK) * (1 - Math.pow(0.02, dt));
    const wh = this.geo.window.h + 100, bh = Math.max(1, this.blindK * wh);
    this.blind.scale.y = bh; this.blind.position.y = -this.geo.window.y - bh / 2;
    const open = 1 - this.blindK * 0.85;
    this.sun.intensity = (day * 2.2 + night * 0.2) * open;
    this.front.intensity = 0.35 + day * 0.95;
    this.hemi.intensity = 0.55 + day * 0.85;
    this.hemi.color.set(day > 0.5 ? 0xe4ecff : 0x9aa8d8);
    for (const m of this.cityLit) m.emissiveIntensity = night * 0.9;
    this.lampLight.intensity = f.lamp ? 1.8 + night * 1.2 : 0;
    this.lamp.bulb.emissiveIntensity = f.lamp ? 3 : 0.05;
    this.lamp.inner.emissiveIntensity = f.lamp ? 0.6 : 0;
    this.screenLight.intensity = f.screen.powered ? 0.25 + night * 0.4 : 0;
    this.monitor.set(f.screen, f.hour);
    this.clock.set(f.hour);
    steam(this.mug, f.t);
  }
}
