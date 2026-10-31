// The 3D room (docs/LOWPOLY_STYLE.md, "the room first"): a warm wood-slat wall with the window, a desk with a drawer pedestal, the monitor, keyboard,
// mouse, mug, drum lamp, wall clock, rug, key rack, router shelf and wall plates. Low poly with soft edges and soft light. x and y come from the 2D
// layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the wall. The sim knows nothing of it.
import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, PointLight, SRGBColorSpace, SphereGeometry, SpotLight, TorusGeometry, type Texture,
} from 'three';
import type { KeySnap } from '@/worker/game/types';
import { DESK_SLAB, MONITOR, OUTBOX, ROUTER_SPOT, SCREEN, SHELF_Y, WALL_PLATE, type Rect } from '@/features/board/render/layout/layout';
import { drum, face, instanced, paint, place, post, rectBox, shadowBlob, softBox, tube } from '@/core/render/three/geometry';
import { PALETTE, mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../desk/props/props';
import { roomGeo, skyAt, type RoomGeo } from '../shell/room';
import { DESK_D, MONITOR_Z, slatRuns, SLAT_W, wallAround, daylight } from './roomplan';

const KEY_W = 230;

function woodTex(base: string, line: string, planks: boolean): Texture | null {
  return paint(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.strokeStyle = line;
    for (let i = 0; i < 70; i++) {
      c.globalAlpha = 0.05 + rnd() * 0.1; c.lineWidth = 1 + rnd() * 2;
      const x = rnd() * w;
      c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + rnd() * 18 - 9, h * 0.3, x + rnd() * 18 - 9, h * 0.7, x + rnd() * 10 - 5, h); c.stroke();
    }
    if (planks) {
      c.globalAlpha = 0.35; c.lineWidth = 3;
      for (let x = 0; x <= w; x += w / 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      for (let k = 0; k < 4; k++) { const y = ((k * 0.37 + 0.2) % 1) * h; c.beginPath(); c.moveTo(k * w / 4, y); c.lineTo((k + 1) * w / 4, y); c.stroke(); }
    }
    c.globalAlpha = 1;
  }, planks ? [6, 6] : undefined);
}

function rugTex(): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = '#8c4f3f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e3c9a4'; c.lineWidth = 6; c.strokeRect(14, 14, w - 28, h - 28);
    c.strokeStyle = '#5b3127'; c.lineWidth = 3; c.strokeRect(28, 28, w - 56, h - 56);
    c.fillStyle = '#c98d5a';
    for (let y = 60; y < h - 50; y += 34) for (let x = 60; x < w - 50; x += 34) { c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x + 8, y); c.lineTo(x, y + 8); c.lineTo(x - 8, y); c.fill(); }
  });
}

/** The city behind the window: lit windows in rows, shown at night. */
function cityTex(): Texture | null {
  return paint(256, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 8; y < h; y += 16) for (let x = 6; x < w; x += 14) if (rnd() < 0.35) { c.fillStyle = rnd() < 0.8 ? '#ffd38a' : '#9fd8ff'; c.fillRect(x, y, 7, 9); }
  });
}

export interface RoomFrame { hour: number; lamp: boolean; blind: boolean; screen: { installed: boolean; powered: boolean; live: boolean; text: string } }

export class Room3D {
  readonly root = new Group();
  readonly geo: RoomGeo;
  private keys = new Group();
  private sun = new DirectionalLight(0xffe2b8, 2);
  private hemi = new HemisphereLight(0xfff1dc, 0x6b4a32, 0.8);
  private lampLight = new SpotLight(0xffc98a, 0, 0, 0.62, 0.65, 0);
  private screenLight = new PointLight(0x9ec8ff, 0, 9000, 0);
  private bulb = mat(0xfff3d6, { emissive: new Color(0xffd79a), emissiveIntensity: 0 });
  private skyMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private cityMat = mat(0x1b2030, { roughness: 0.9 });
  private blind = new Group();
  private blindK = 0;
  private hands: { h: Mesh; m: Mesh } | null = null;
  private screenMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenKey = '';
  private skyKey = -1;
  private keysKey = '';
  private monitor = new Group();

  constructor() {
    this.geo = roomGeo();
    const g = this.geo, R = this.root;
    const oak = mat(PALETTE.oak, { map: woodTex('#b98655', '#5e3a1e', false), roughness: 0.55 });
    const walnut = mat(PALETTE.walnut, { map: woodTex('#7a4f2e', '#2e1a0c', false), roughness: 0.6 });
    const slat = mat(0xffffff, { map: woodTex('#a87446', '#4a2a12', false), roughness: 0.6 });
    const backing = mat(0x5c3b22, { roughness: 0.9 });
    const floorM = mat(0xffffff, { map: woodTex('#6f4a2c', '#2a170a', true), roughness: 0.7 });
    const white = mat(PALETTE.lamp, { roughness: 0.45 });
    const dark = mat(PALETTE.plastic, { roughness: 0.5 });
    const metal = mat(0x9aa0a8, { metalness: 0.6, roughness: 0.35 });

    // ---- wall, floor ----
    const x0 = g.desk.x0 - 16000, x1 = g.desk.x1 + 16000, top = g.ceil - 2500, floor = g.floor;
    const win = g.window, hole: Rect = { x: win.x - 190, y: win.y - 190, w: win.w + 380, h: win.h + 380 };
    for (const r of wallAround(x0, x1, top, floor, hole)) R.add(rectBox(r, -240, 0, backing));
    const slats = slatRuns(x0, x1, top, floor - 900, hole);
    for (const s of slats) R.add(softBox({ x: s.x, y: s.y0, w: SLAT_W, h: s.y1 - s.y0 }, 0, 110, slat, 30));
    R.add(softBox({ x: x0, y: floor - 900, w: x1 - x0, h: 900 }, 0, 160, walnut, 30)); // the skirting under the slats
    const fl = place(new Mesh(new PlaneGeometry(x1 - x0, 60000), floorM));
    fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, -floor, 30000);
    R.add(fl);
    const rug = place(new Mesh(new BoxGeometry(g.desk.x1 - g.desk.x0 - 3000, 30, 11000), mat(0xffffff, { map: rugTex(), roughness: 0.95 })));
    rug.position.set((g.desk.x0 + g.desk.x1) / 2, -floor + 15, DESK_D + 3500);
    R.add(rug);

    // ---- the window: frame, sill, glass, the blind, the city and the sky behind ----
    const winG = tag(new Group(), 'blind');
    for (const r of [{ x: hole.x, y: hole.y, w: hole.w, h: 190 }, { x: hole.x, y: win.y + win.h, w: hole.w, h: 190 }, { x: hole.x, y: win.y, w: 190, h: win.h }, { x: win.x + win.w, y: win.y, w: 190, h: win.h }, { x: win.x + win.w / 2 - 60, y: win.y, w: 120, h: win.h }, { x: win.x, y: win.y + win.h * 0.42, w: win.w, h: 110 }])
      winG.add(softBox(r, -200, 140, white, 30));
    winG.add(softBox({ x: hole.x - 200, y: win.y + win.h + 190, w: hole.w + 400, h: 160 }, -200, 700, white, 40));
    const glass = seeThrough(face(win, -120, new MeshStandardMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false })));
    winG.add(glass);
    const blindM = mat(0xefe4cf, { roughness: 0.85, side: DoubleSide });
    const roll = place(new Mesh(new CylinderGeometry(150, 150, win.w + 200, 16), white));
    roll.rotation.z = Math.PI / 2; roll.position.set(win.x + win.w / 2, -(win.y - 60), 260);
    const sheet = place(new Mesh(new BoxGeometry(win.w + 100, 1, 30), blindM));
    sheet.position.set(win.x + win.w / 2, -0.5, 230);
    this.blind.position.set(0, -(win.y - 60), 0);
    this.blind.add(sheet);
    winG.add(roll, this.blind);
    R.add(winG);
    const sky = new Mesh(new PlaneGeometry(win.w * 5, win.h * 4), this.skyMat);
    sky.position.set(win.x + win.w / 2, -(win.y + win.h / 2), -9000);
    R.add(seeThrough(sky));
    this.cityMat.emissive.set(0xffffff); this.cityMat.emissiveMap = cityTex();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 9; k++) {
      const w = 1400 + rnd() * 1800, h = 2500 + rnd() * 6000, x = win.x - 3000 + k * (win.w + 6000) / 9;
      const b = new Mesh(new BoxGeometry(w, h, 1600), this.cityMat);
      b.position.set(x, -(win.y + win.h + 2600) + h / 2, -5200 - rnd() * 1800);
      R.add(seeThrough(b));
    }

    // ---- the desk: top, west side panel, drawer pedestal under the PC ----
    const ys = g.ys;
    R.add(softBox({ x: g.desk.x0, y: ys, w: g.desk.x1 - g.desk.x0, h: DESK_SLAB }, 0, DESK_D, oak, 70));
    R.add(softBox({ x: g.desk.x0 + 300, y: ys + DESK_SLAB, w: 420, h: floor - ys - DESK_SLAB }, 400, DESK_D - 400, oak, 50));
    const ped = { x: g.desk.x1 - 4600, y: ys + DESK_SLAB, w: 4300, h: floor - ys - DESK_SLAB };
    R.add(softBox(ped, 400, DESK_D - 500, oak, 50));
    const dh = (ped.h - 260) / 3;
    for (let k = 0; k < 3; k++) {
      const d = { x: ped.x + 120, y: ped.y + 80 + k * (dh + 50), w: ped.w - 240, h: dh - 50 };
      R.add(softBox(d, DESK_D - 520, DESK_D - 380, walnut, 40));
      R.add(softBox({ x: d.x + d.w / 2 - 500, y: d.y + 260, w: 1000, h: 110 }, DESK_D - 380, DESK_D - 280, metal, 40));
    }

    // ---- the monitor (a part: the machine tells it whether it is installed and on) ----
    this.buildMonitor(dark);

    // ---- keyboard on its mat, the mouse ----
    const kx = MONITOR.x + MONITOR.w / 2, kz = DESK_D - 3300;
    const deskTop = -ys;
    const matM = mat(0x2c2f36, { roughness: 0.95 });
    const deskMat = place(new Mesh(new BoxGeometry(11000, 40, 4200), matM));
    deskMat.position.set(kx + 1200, deskTop + 20, kz);
    R.add(deskMat);
    const kb = new Group();
    const kbBody = softBox({ x: -3100, y: -260, w: 6200, h: 260 }, -1000, 1000, mat(0x34363d, { roughness: 0.5 }), 60);
    kb.add(kbBody);
    const caps: { x: number; y: number; z: number; sx?: number }[] = [];
    for (let row = 0; row < 5; row++) for (let col = 0; col < 15; col++) {
      if (row === 4 && col > 3 && col < 11) { if (col === 7) caps.push({ x: 0, y: 300, z: -800 + row * 380 + 180, sx: 7 }); continue; }
      caps.push({ x: -2850 + col * 407 + 200, y: 300, z: -800 + row * 380 + 180 });
    }
    kb.add(instanced(new BoxGeometry(340, 90, 320), mat(0xe9e4da, { roughness: 0.55 }), caps));
    kb.position.set(kx, deskTop + 40, kz);
    kb.rotation.y = -0.03;
    R.add(kb);
    const mouse = place(new Mesh(new SphereGeometry(1, 16, 10), mat(0x34363d, { roughness: 0.45 })));
    mouse.scale.set(380, 230, 620); mouse.position.set(kx + 4300, deskTop + 60, kz + 200);
    R.add(mouse);

    // ---- the mug on its coaster, a soft shadow under it ----
    const mugZ = DESK_D - 4600, mx = g.mug;
    R.add(post(mx, ys, mugZ, 560, 40, walnut, 24));
    const ceramic = mat(PALETTE.ceramic, { roughness: 0.35 });
    R.add(post(mx, ys - 40, mugZ, 360, 920, ceramic, 24, 400));
    R.add(post(mx, ys - 340, mugZ, 386, 220, mat(0xc0392b, { roughness: 0.5 }), 24, 392));
    R.add(post(mx, ys - 960, mugZ, 372, 6, mat(0x3b2416, { roughness: 0.2 }), 24));
    const handle = place(new Mesh(new TorusGeometry(230, 60, 8, 16, Math.PI * 1.2), ceramic));
    handle.rotation.z = -Math.PI * 0.6; handle.position.set(mx + 400, -(ys - 520), mugZ);
    R.add(handle);
    const blob = shadowBlob();
    if (blob) {
      const sh = new Mesh(new PlaneGeometry(1600, 1600), new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(mx + 150, deskTop + 3, mugZ + 120);
      R.add(seeThrough(sh));
    }

    // ---- the drum lamp: a weighted base, two arms, a white drum shade over a warm bulb ----
    const lamp = tag(new Group(), 'lamp');
    const lx = g.lamp.x, lz = 2200, head = g.lamp.head, mouth = g.lamp.mouth;
    lamp.add(post(lx, ys, lz, 820, 260, white, 28, 760));
    const elbow: [number, number, number] = [lx - 900, -(ys - 3900), lz - 300];
    const hz = lz + 2600;
    lamp.add(tube([[lx, -(ys - 260), lz], [lx - 500, -(ys - 2000), lz - 200], elbow], 70, metal));
    lamp.add(tube([elbow, [(elbow[0] + head.x) / 2, -(head.y - 700), (elbow[2] + hz) / 2], [head.x, -head.y, hz]], 70, metal));
    const shade = new Group();
    const cone = place(new Mesh(new CylinderGeometry(560, 980, 1300, 28, 1, true), new MeshStandardMaterial({ color: PALETTE.lamp, roughness: 0.6, side: DoubleSide })));
    cone.position.y = -650;
    const bulb = new Mesh(new SphereGeometry(260, 16, 12), this.bulb);
    bulb.position.y = -900;
    shade.add(cone, seeThrough(bulb));
    shade.position.set(head.x, -head.y, hz);
    const dir = { x: mouth.x - head.x, y: -(mouth.y - head.y) };
    shade.rotation.z = Math.atan2(dir.x, -dir.y) * 0.6;
    lamp.add(shade);
    R.add(lamp);
    this.lampLight.position.set(head.x, -head.y - 500, hz);
    this.lampLight.target.position.set(mouth.x + 2500, deskTop, DESK_D * 0.55);
    this.lampLight.castShadow = true; this.lampLight.shadow.mapSize.set(1024, 1024); this.lampLight.shadow.bias = -0.0005;
    R.add(this.lampLight, this.lampLight.target);

    // ---- the wall clock: a round face with two hands ----
    const clock = tag(new Group(), 'clock');
    const cc = { x: g.clock.x + g.clock.w / 2, y: g.clock.y + g.clock.h / 2 }, cr = 760;
    clock.add(drum(cc.x, cc.y, 0, 160, cr, walnut, 40));
    const dial = paint(256, 256, (c, w) => {
      c.fillStyle = '#f6efe2'; c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3b2a1e';
      for (let k = 0; k < 12; k++) { c.save(); c.translate(w / 2, w / 2); c.rotate((k * Math.PI) / 6); c.fillRect(-3, -w / 2 + 12, 6, k % 3 ? 14 : 26); c.restore(); }
    });
    const dialM = new Mesh(new CylinderGeometry(cr - 90, cr - 90, 10, 40), [mat(0xf6efe2), mat(0xffffff, { map: dial }), mat(0xf6efe2)]);
    dialM.rotation.x = Math.PI / 2; dialM.position.set(cc.x, -cc.y, 170);
    clock.add(dialM);
    const handM = mat(0x2a1d14);
    const mk = (len: number, wd: number) => { const m = new Mesh(new BoxGeometry(wd, len, 20), handM); m.geometry.translate(0, len / 2, 0); m.position.set(cc.x, -cc.y, 190); return m; };
    this.hands = { h: mk(cr * 0.5, 60), m: mk(cr * 0.75, 36) };
    clock.add(this.hands.h, this.hands.m);
    R.add(clock);

    // ---- the key rack: two walnut rails with pegs; the keys hang from them (setKeys) ----
    const rack = tag(new Group(), 'tray');
    for (let row = 0; row < 2; row++) {
      const y = trayHook(row * 5).y;
      rack.add(softBox({ x: g.keyRack.x + 100, y: y - 90, w: g.keyRack.w - 200 + row * 330, h: 180 }, 0, 160, walnut, 30));
      for (let col = 0; col < 5; col++) { const h = trayHook(row * 5 + col); rack.add(drum(h.x, h.y, 160, 360, 38, metal, 10)); }
    }
    R.add(rack, this.keys);

    // ---- the router on its shelf, the letterbox, the wall plates ----
    R.add(softBox({ x: ROUTER_SPOT.x - 300, y: SHELF_Y, w: ROUTER_SPOT.w + 600, h: 140 }, 0, 1700, oak, 30));
    const router = tag(new Group(), 'router');
    router.add(softBox(ROUTER_SPOT, 300, 1400, mat(0x24262c, { roughness: 0.45 }), 60));
    for (const k of [0.2, 0.8]) router.add(post(ROUTER_SPOT.x + ROUTER_SPOT.w * k, ROUTER_SPOT.y, 600, 40, 900, dark, 8));
    for (let k = 0; k < 4; k++) router.add(drum(ROUTER_SPOT.x + 400 + k * 260, ROUTER_SPOT.y + ROUTER_SPOT.h / 2, 1400, 1420, 40, mat(0x63ff9a, { emissive: new Color(0x63ff9a), emissiveIntensity: 1.2 }), 8));
    R.add(router);
    const box = tag(new Group(), 'mail');
    box.add(softBox(OUTBOX, 0, 700, mat(0xb8382f, { roughness: 0.5 }), 60));
    box.add(rectBox({ x: OUTBOX.x + 180, y: OUTBOX.y - 10, w: OUTBOX.w - 360, h: 30 }, 200, 500, dark));
    R.add(box);
    const plate = g.socket.plate;
    const socket = tag(new Group(), 'socket');
    socket.add(softBox(plate, 0, 70, white, 30));
    for (const o of [g.socket.mon, g.socket.pc]) socket.add(drum(o.x, o.y, 70, 90, 220, mat(0xdcd6cc), 20));
    R.add(socket);
    R.add(tag(softBox(WALL_PLATE, 0, 70, white, 30), 'wall'));

    // ---- light: the sky's fill, the sun (or moon) through the window, the lamp, the screen ----
    R.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -24000, right: 24000, top: 18000, bottom: -18000, near: 100, far: 80000 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 30;
    this.sun.position.set(win.x - 9000, -win.y + 9000, -26000);
    this.sun.target.position.set((g.desk.x0 + g.desk.x1) / 2 - 3000, deskTop, DESK_D * 0.6);
    R.add(this.sun, this.sun.target);
    this.screenLight.position.set(SCREEN.x + SCREEN.w / 2, -(SCREEN.y + SCREEN.h / 2), MONITOR_Z + 2500);
    R.add(this.screenLight);
  }

  private buildMonitor(dark: MeshStandardMaterial) {
    const M = this.monitor, z0 = MONITOR_Z, cx = MONITOR.x + MONITOR.w / 2, ys = this.geo.ys;
    M.add(softBox(MONITOR, z0, z0 + 260, dark, 60));
    M.add(softBox({ x: MONITOR.x + MONITOR.w * 0.2, y: MONITOR.y + MONITOR.h * 0.15, w: MONITOR.w * 0.6, h: MONITOR.h * 0.6 }, z0 - 420, z0, dark, 120));
    M.add(softBox({ x: cx - 260, y: MONITOR.y + MONITOR.h * 0.5, w: 520, h: ys - MONITOR.y - MONITOR.h * 0.5 - 60 }, z0 - 560, z0 - 260, dark, 60));
    M.add(softBox({ x: cx - 1800, y: ys - 70, w: 3600, h: 70 }, z0 - 1700, z0 + 900, dark, 30));
    if (typeof document !== 'undefined') {
      this.screenCanvas = document.createElement('canvas');
      this.screenCanvas.width = 1024; this.screenCanvas.height = 576;
      const t = new CanvasTexture(this.screenCanvas);
      t.colorSpace = SRGBColorSpace;
      this.screenMat.map = t;
    }
    M.add(face(SCREEN, z0 + 264, this.screenMat));
    this.root.add(tag(M, 'monitor'));
  }

  /** The keys on the rack (a stick on a lanyard per hook, the job on its face). */
  setKeys(tray: readonly KeySnap[]): void {
    const key = tray.map((k) => `${k.id}:${k.type}:${k.label}`).join(',');
    if (key === this.keysKey) return;
    this.keysKey = key;
    for (const c of [...this.keys.children]) { this.keys.remove(c); c.traverse((o) => { const m = o as Mesh; m.geometry?.dispose(); }); }
    tray.slice(0, 10).forEach((k, i) => {
      const hook = trayHook(i), c = trayKeyCentre(i), g = tag(new Group(), 'key:' + k.id);
      const label = paint(64, 256, (cx, w, h) => {
        cx.fillStyle = '#2a2d34'; cx.fillRect(0, 0, w, h);
        cx.save(); cx.translate(w / 2, h / 2); cx.rotate(Math.PI / 2);
        cx.fillStyle = '#e8ecf4'; cx.font = 'bold 26px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(k.label, 0, 0); cx.restore();
      });
      const body = rectBox({ x: c.x - KEY_W / 2, y: c.y - KEY_LEN / 2, w: KEY_W, h: KEY_LEN }, 240, 360, mat(0x2a2d34, { roughness: 0.45 }));
      if (label) body.material = [body.material as MeshStandardMaterial, body.material as MeshStandardMaterial, body.material as MeshStandardMaterial, body.material as MeshStandardMaterial, mat(0xffffff, { map: label }), body.material as MeshStandardMaterial];
      g.add(body);
      g.add(rectBox({ x: c.x - 70, y: c.y + KEY_LEN / 2, w: 140, h: 190 }, 260, 340, mat(0xb9bec6, { metalness: 0.7, roughness: 0.3 })));
      const col = new Color(lanyardColour(k)).getHex();
      g.add(tube([[hook.x, -hook.y, 330], [hook.x - 30, -(hook.y + 200), 320], [c.x, -(c.y - KEY_LEN / 2), 300]], 26, mat(col, { roughness: 0.7 }), 5));
      this.keys.add(g);
    });
  }

  frame(f: RoomFrame, dt: number): void {
    const day = daylight(f.hour), night = 1 - day;
    // the sky: a gradient painted again only when the hour moves on
    const hk = Math.round(f.hour * 20);
    if (hk !== this.skyKey) {
      this.skyKey = hk;
      const s = skyAt(f.hour);
      const tex = paint(4, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, s.top); gr.addColorStop(1, s.hor); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
      this.skyMat.map?.dispose(); this.skyMat.map = tex; this.skyMat.needsUpdate = true;
      const warm = new Color(s.hor);
      this.sun.color.copy(warm).lerp(new Color(0xfff4e0), day * 0.6);
      if (day <= 0) this.sun.color.set(0x8fa6ff);
    }
    const blind = this.blindK += ((f.blind ? 1 : 0) - this.blindK) * (1 - Math.pow(0.02, dt));
    const sheet = this.blind.children[0] as Mesh, wh = this.geo.window.h + 120;
    sheet.scale.y = Math.max(1, blind * wh); sheet.position.y = -Math.max(1, blind * wh) / 2;
    const open = 1 - blind * 0.85;
    this.sun.intensity = (day * 2.6 + night * 0.25) * open;
    this.hemi.intensity = (0.75 + day * 0.6) * (0.6 + open * 0.4) + (f.lamp ? 0.08 : 0);
    this.cityMat.emissiveIntensity = night * 0.9;
    this.lampLight.intensity = f.lamp ? 2.4 : 0;
    this.bulb.emissiveIntensity = f.lamp ? 2.2 : 0.05;
    this.screenLight.intensity = f.screen.live ? 0.55 : 0;
    // the clock's hands
    if (this.hands) { this.hands.h.rotation.z = -((f.hour % 12) / 12) * Math.PI * 2; this.hands.m.rotation.z = -((f.hour % 1)) * Math.PI * 2; }
    this.drawScreen(f.screen);
  }

  private drawScreen(s: RoomFrame['screen']): void {
    const key = `${s.installed}|${s.powered}|${s.live}|${s.text}`;
    if (key === this.screenKey || !this.screenCanvas) return;
    this.screenKey = key;
    this.monitor.visible = s.installed;
    const c = this.screenCanvas.getContext('2d')!, w = this.screenCanvas.width, h = this.screenCanvas.height;
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, s.live ? '#0b1626' : '#07090d'); gr.addColorStop(1, s.live ? '#05080f' : '#030405');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.035)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.45, 0); c.lineTo(w * 0.2, h); c.lineTo(0, h); c.fill();
    if (s.live) {
      c.fillStyle = '#d8f3ff'; c.font = '28px "JetBrains Mono", Consolas, monospace'; c.textBaseline = 'top';
      const lines = (s.text || '_').split('\n').slice(-14);
      lines.forEach((l, i) => c.fillText(l.slice(0, 62), 40, 36 + i * 36));
    } else if (s.powered) {
      c.fillStyle = 'rgba(180,200,230,0.35)'; c.font = '30px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('NO SIGNAL', w / 2, h / 2); c.textAlign = 'left';
    }
    if (this.screenMat.map) this.screenMat.map.needsUpdate = true;
  }
}
