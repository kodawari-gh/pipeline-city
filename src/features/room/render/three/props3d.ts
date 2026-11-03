// The room's props in 3D, modelled on the owner's reference image (docs/LOWPOLY_STYLE.md "Look decision"): the architect lamp, the monitor with its
// standby screen, the digital clock, the mug with its steam on a cork coaster, the keyboard, the mouse and a notebook (the sill's aloe: `plants3d.ts`).
// Each builder returns a group in world units (x and y from the 2D layout, y flipped; z out of the wall) and keeps what `frame` animates.
import {
  BackSide, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, type BufferGeometry, type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { anisotropy, instanced, paint, place, post, rectBox, rod, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';

type V3 = [number, number, number];

// ------------------------------------------------------------------ lamp
export interface Lamp { root: Group; bulb: MeshStandardMaterial; inner: MeshStandardMaterial; mouth: V3; dir: [number, number] }

/** An architect lamp: a round weighted base, paired lower arms with a spring, an elbow, paired upper arms, a cone shade pointing down at the desk. */
export function lamp(base: { x: number; y: number }, elbowXY: { x: number; y: number }, head: { x: number; y: number }, mouthXY: { x: number; y: number }, z: number): Lamp {
  const white = mat(0xf2f0eb, { roughness: 0.35 }), joint = mat(0xc9ccd1, { metalness: 0.6, roughness: 0.3 });
  const g = tag(new Group(), 'lamp');
  g.add(post(base.x, base.y, z, 950, 150, white, 40, 880));
  g.add(post(base.x, base.y - 150, z, 230, 280, white, 20, 200));
  const b0: V3 = [base.x, -(base.y - 400), z], el: V3 = [elbowXY.x, -elbowXY.y, z], hd: V3 = [head.x, -head.y, z];
  for (const dz of [-90, 90]) {
    g.add(rod([b0[0], b0[1], z + dz], [el[0], el[1], z + dz], 55, white));
    g.add(rod([el[0], el[1], z + dz], [hd[0], hd[1], z + dz], 50, white));
  }
  g.add(rod([b0[0] + 160, b0[1] + 250, z], [el[0] + 180, el[1] - 200, z], 22, joint, 6)); // the spring
  for (const p of [b0, el, hd]) { const j = place(new Mesh(new CylinderGeometry(120, 120, 300, 16), joint)); j.rotation.x = Math.PI / 2; j.position.set(...p); g.add(j); }
  // the shade: its narrow end at the head, its mouth toward the desk
  const dx = mouthXY.x - head.x, dy = -(mouthXY.y - head.y), len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const shade = new Group(), L = 1500;
  shade.position.set(...hd);
  shade.rotation.z = Math.atan2(ux, -uy);
  const outer = place(new Mesh(new CylinderGeometry(300, 820, L, 32, 1, true), white));
  const inner = mat(0xfff4dc, { roughness: 0.6, side: BackSide, emissive: new Color(0xffd9a0), emissiveIntensity: 0 });
  const innerM = new Mesh(new CylinderGeometry(296, 812, L, 32, 1, true), inner);
  const cap = place(new Mesh(new SphereGeometry(300, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), white));
  outer.position.y = innerM.position.y = -L / 2; cap.position.y = 0;
  // the mouth's rolled lip, the head's knob that sets the shade's tilt
  const lip = place(new Mesh(new TorusGeometry(816, 40, 8, 48), white));
  lip.rotation.x = Math.PI / 2; lip.position.y = -L;
  const knob = place(new Mesh(new CylinderGeometry(150, 150, 220, 18), joint));
  knob.rotation.z = Math.PI / 2; knob.position.set(0, 120, 0);
  shade.add(lip, knob);
  const bulb = mat(0xfff6e0, { emissive: new Color(0xffe2b0), emissiveIntensity: 0 });
  const bulbM = new Mesh(new SphereGeometry(240, 20, 14), bulb);
  bulbM.position.y = -L + 380;
  shade.add(outer, innerM, cap, seeThrough(bulbM));
  g.add(shade);
  return { root: g, bulb, inner, mouth: [hd[0] + ux * (L - 300), hd[1] + uy * (L - 300), z], dir: [ux, uy] };
}

// ------------------------------------------------------------------ monitor
export interface Screen { installed: boolean; powered: boolean; live: boolean; text: string }

export class Monitor {
  readonly root = tag(new Group(), 'monitor');
  private canvas: HTMLCanvasElement | null = null;
  private tex: Texture | null = null;
  private key = '';
  private led = mat(0x111111, { emissive: new Color(0x4cff8a), emissiveIntensity: 0 });

  constructor(m: RectLike, screen: RectLike, deskY: number, z0: number) {
    const shell = mat(0x2d3137, { roughness: 0.45, metalness: 0.2 }), back = mat(0x24272c, { roughness: 0.6 });
    const R = this.root, cx = m.x + m.w / 2;
    R.add(softBox(m, z0, z0 + 180, shell, 50));
    R.add(softBox({ x: m.x + m.w * 0.18, y: m.y + m.h * 0.12, w: m.w * 0.64, h: m.h * 0.66 }, z0 - 380, z0, back, 160));
    R.add(softBox({ x: cx - 330, y: m.y + m.h * 0.55, w: 660, h: deskY - m.y - m.h * 0.55 - 90 }, z0 - 560, z0 - 300, shell, 80));
    R.add(softBox({ x: cx - 1700, y: deskY - 90, w: 3400, h: 90 }, z0 - 1500, z0 + 700, shell, 40));
    // the maker's mark on the chin, vents across the back, the cable's hole through the neck
    const chin = (screen.y + screen.h + m.y + m.h) / 2;
    R.add(softBox({ x: cx - 300, y: chin - 30, w: 600, h: 60 }, z0 + 180, z0 + 188, mat(0x8b9198, { roughness: 0.4, metalness: 0.5 }), 20));
    const hump = { x: m.x + m.w * 0.18, y: m.y + m.h * 0.12, w: m.w * 0.64 }, vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (let r = 0; r < 7; r++) for (let k = 0; k < 3; k++) vents.push({ x: hump.x + hump.w * (0.2 + k * 0.3), y: -(hump.y + 500 + r * 170), z: z0 - 384, sx: hump.w * 0.26, sy: 60, sz: 12 });
    R.add(instanced(new BoxGeometry(1, 1, 1), mat(0x15171a, { roughness: 0.8 }), vents));
    R.add(softBox({ x: cx - 200, y: deskY - 1400, w: 400, h: 520 }, z0 - 568, z0 - 560, mat(0x15171a, { roughness: 0.8 }), 60));
    const led = new Mesh(new CylinderGeometry(28, 28, 20, 10), this.led);
    led.rotation.x = Math.PI / 2; led.position.set(m.x + m.w - 260, -(m.y + m.h - 70), z0 + 186);
    R.add(seeThrough(led));
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1280; this.canvas.height = 720;
      this.tex = rawSrgb(this.canvas);
      this.tex.anisotropy = anisotropy;
    }
    const face = new Mesh(new BoxGeometry(screen.w, screen.h, 4), Object.assign(new MeshBasicMaterial({ map: this.tex, toneMapped: false }), { defines: { ...DECODE_SRGB } }));
    face.position.set(screen.x + screen.w / 2, -(screen.y + screen.h / 2), z0 + 182);
    R.add(face);
  }

  set(s: Screen, hour: number): void {
    this.root.visible = s.installed;
    this.led.emissiveIntensity = s.powered ? 1.4 : 0.1;
    const key = `${s.powered}|${s.live}|${s.live ? s.text : Math.floor(hour * 12)}`;
    if (key === this.key || !this.canvas) return;
    this.key = key;
    const c = this.canvas.getContext('2d')!, w = this.canvas.width, h = this.canvas.height;
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, s.powered ? '#2c3540' : '#101317'); gr.addColorStop(1, s.powered ? '#1a2027' : '#08090b');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    if (s.live) {
      c.fillStyle = '#dff4ff'; c.font = '30px "JetBrains Mono", Consolas, monospace'; c.textBaseline = 'top';
      (s.text || '_').split('\n').slice(-16).forEach((l, i) => c.fillText(l.slice(0, 70), 48, 40 + i * 40));
    } else if (s.powered) {
      // standby: the logo, the title, a progress line, a small chart (the reference's standby card)
      c.fillStyle = '#c9d3de';
      [18, 30, 24, 40, 32].forEach((bh, i) => c.fillRect(w / 2 - 50 + i * 20, h * 0.36 - bh, 13, bh));
      c.font = '600 46px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('PIPELINE CITY', w / 2, h * 0.47);
      c.fillStyle = '#3a4653'; c.fillRect(w / 2 - 200, h * 0.52, 400, 6);
      c.fillStyle = '#5fd0ff'; c.fillRect(w / 2 - 200, h * 0.52, 130, 6);
      c.fillStyle = '#8795a3'; c.font = '20px system-ui, sans-serif'; c.fillText('STANDBY', w / 2, h * 0.58);
      c.textAlign = 'left';
      c.strokeStyle = '#3a4653'; c.lineWidth = 2; c.strokeRect(60, h - 230, 330, 170);
      c.strokeStyle = '#5fd0ff'; c.lineWidth = 3; c.beginPath();
      for (let i = 0; i <= 24; i++) { const x = 70 + i * 13, y = h - 90 - (Math.sin(i * 0.9 + hour) * 0.5 + 0.5) * 70 - i * 2; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    } else {
      c.fillStyle = 'rgba(255,255,255,0.03)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.5, 0); c.lineTo(w * 0.25, h); c.lineTo(0, h); c.fill();
    }
    if (this.tex) this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ digital clock
export class DigitalClock {
  readonly root = tag(new Group(), 'clock');
  private canvas: HTMLCanvasElement | null = null;
  private tex: Texture | null = null;
  private shown = '';

  constructor(r: RectLike) {
    this.root.add(softBox(r, 0, 260, mat(0xd9cdb8, { roughness: 0.5 }), 50));
    this.root.add(rectBox({ x: r.x + 90, y: r.y + 90, w: r.w - 180, h: r.h - 180 }, 260, 270, mat(0x121212, { roughness: 0.3 })));
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 160;
      this.tex = rawSrgb(this.canvas);
    }
    const face = new Mesh(new BoxGeometry(r.w - 260, r.h - 260, 2), Object.assign(new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 1.3 }), { defines: { ...DECODE_SRGB } }));
    face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), 274);
    this.root.add(face);
  }

  set(hour: number): void {
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60), t = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (t === this.shown || !this.canvas) return;
    this.shown = t;
    const c = this.canvas.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, 512, 160);
    c.font = 'bold 128px "Courier New", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,140,40,0.12)'; c.fillText('88:88', 256, 86);
    c.fillStyle = '#ffa043'; c.fillText(t, 256, 86);
    if (this.tex) this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ mug
export interface Mug { root: Group; puffs: Sprite[]; top: V3 }

export function mug(x: number, deskY: number, z: number): Mug {
  const g = new Group();
  const decal = paint(512, 128, (c, w, h) => {
    c.fillStyle = '#f4f2ee'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c8302a'; c.fillRect(w * 0.25 - 46, h * 0.22, 92, 72);
    c.fillStyle = '#fff'; c.font = 'bold 38px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PC', w * 0.25, h * 0.22 + 36);
  });
  const ceramic = mat(0xf4f2ee, { roughness: 0.3, map: decal });
  // it stands on a cork coaster
  const cork = 60, y0 = -deskY + cork;
  g.add(post(x, deskY, z, 560, cork, mat(0xffffff, { map: paint(64, 64, (c, w, h) => { c.fillStyle = '#b48d5e'; c.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { c.fillStyle = (i % 2 ? 'rgba(70,45,20,0.25)' : 'rgba(255,235,200,0.2)'); c.fillRect((i * 37) % w, (i * 53) % h, 1 + (i % 3), 1 + (i % 2)); } }), roughness: 0.95 }), 28));
  const body = place(new Mesh(new CylinderGeometry(390, 360, 950, 32, 1, false, -Math.PI / 2), [ceramic, mat(0xf4f2ee, { roughness: 0.3 }), mat(0xf4f2ee)]));
  body.position.set(x, y0 + 475, z);
  const coffee = new Mesh(new CylinderGeometry(355, 355, 10, 32), mat(0x3a2214, { roughness: 0.15 }));
  coffee.position.set(x, y0 + 900, z);
  const handle = place(new Mesh(new TorusGeometry(230, 62, 10, 20, Math.PI * 1.15), mat(0xf4f2ee, { roughness: 0.3 })));
  handle.rotation.z = -Math.PI * 0.575; handle.position.set(x + 400, y0 + 500, z);
  g.add(body, coffee, handle);
  const puffTex = paint(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const puffs = Array.from({ length: 6 }, () => { const s = new Sprite(new SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); g.add(seeThrough(s)); return s; });
  return { root: g, puffs, top: [x, y0 + 950, z] };
}

/** The steam at game time t (s): puffs rise, widen and fade, each on its own phase. */
export function steam(m: Mug, t: number): void {
  m.puffs.forEach((p, i) => {
    const life = ((t / 4.5 + i / m.puffs.length) % 1), sway = Math.sin(t * 0.8 + i * 1.7) * 160 * life;
    p.position.set(m.top[0] + sway, m.top[1] + 100 + life * 1900, m.top[2]);
    const s = 260 + life * 700;
    p.scale.set(s, s, 1);
    (p.material as SpriteMaterial).opacity = 0.32 * Math.sin(life * Math.PI);
  });
}

// ------------------------------------------------------------------ keyboard, mouse
/** A key: its legend, its width in units (U), its kind (0 a letter, 1 a modifier, 2 an accent; -1 a gap, no key). */
type Key = readonly [string, number, number];
const GAP: Key = ['', 0.25, -1];
const keyRow = (s: string, kind = 0): Key[] => s.split(' ').map((k) => [k, 1, kind] as const);
/** A 75% board: the function row (a little apart), five rows of 15 U. */
const KEYS: readonly (readonly Key[])[] = [
  [['Esc', 1, 2], GAP, ...keyRow('F1 F2 F3 F4', 1), GAP, ...keyRow('F5 F6 F7 F8', 1), GAP, ...keyRow('F9 F10 F11 F12', 1), GAP, ['Del', 1, 1]],
  [...keyRow('` 1 2 3 4 5 6 7 8 9 0 - ='), ['Back', 2, 1]],
  [['Tab', 1.5, 1], ...keyRow('Q W E R T Y U I O P [ ]'), ['\\', 1.5, 1]],
  [['Caps', 1.75, 1], ...keyRow("A S D F G H J K L ; '"), ['Enter', 2.25, 2]],
  [['Shift', 2.25, 1], ...keyRow('Z X C V B N M , . /'), ['Shift', 1.75, 1], ['^', 1, 1]],
  [['Ctrl', 1.25, 1], ['Win', 1.25, 1], ['Alt', 1.25, 1], ['', 6.25, 0], ['Alt', 1, 1], ['Fn', 1, 1], ['<', 1, 1], ['v', 1, 1], ['>', 1, 1]],
];
const KEY_U = 372;

/** A keycap: a box whose top is drawn in to a smaller face (the cap's taper), `w` wide and `d` deep. */
function capGeo(w: number, d: number, h: number, inset: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d), p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) - Math.sign(p.getX(i)) * inset, p.getY(i), p.getZ(i) - Math.sign(p.getZ(i)) * inset);
  g.computeVertexNormals();
  return g;
}

/**
 * A 75% mechanical keyboard on the mat: an aluminium case with a raised rim round a dark plate, tapered caps (letters, darker modifiers, terracotta
 * Esc and Enter) with their legends, the board tilted up at the back, its cable off the back to the wall.
 */
export function keyboard(cx: number, deskY: number, z: number): Group {
  const g = new Group(), board = new Group(), U = KEY_U, W = 15 * U, D = 6.25 * U;
  const caseM = mat(0x2b2f35, { roughness: 0.4, metalness: 0.3 }), rim = 180;
  board.add(softBox({ x: -W / 2 - rim, y: -200, w: W + 2 * rim, h: 200 }, -D / 2 - rim, D / 2 + rim, caseM, 70));
  for (const r of [{ x: -W / 2 - rim, w: rim + 20 }, { x: W / 2 - 20, w: rim + 20 }] as const) board.add(softBox({ x: r.x, y: -300, w: r.w, h: 300 }, -D / 2 - rim, D / 2 + rim, caseM, 50));
  for (const [z0, z1] of [[-D / 2 - rim, -D / 2 + 20], [D / 2 - 20, D / 2 + rim]] as const) board.add(softBox({ x: -W / 2 - rim, y: -300, w: W + 2 * rim, h: 300 }, z0, z1, caseM, 50));
  board.add(rectBox({ x: -W / 2, y: -210, w: W, h: 10 }, -D / 2, D / 2, mat(0x17191c, { roughness: 0.7 })));
  // the caps, merged per kind; the legends drawn on one sheet over their tops
  const parts: BufferGeometry[][] = [[], [], []], px = 64;
  const sheet = typeof document === 'undefined' ? null : document.createElement('canvas');
  const c = sheet?.getContext('2d') ?? null;
  if (sheet && c) { sheet.width = 15 * px; sheet.height = Math.round(6.25 * px); }
  KEYS.forEach((row, r) => {
    let u = 0;
    const kz = -D / 2 + (r + (r ? 0.25 : 0)) * U + U / 2;
    for (const [label, wu, kind] of row) {
      if (kind >= 0) {
        const geo = capGeo(wu * U - 46, U - 46, 130, 42);
        geo.translate(-W / 2 + (u + wu / 2) * U, 265, kz);
        parts[kind]!.push(geo);
        if (c && label) {
          c.fillStyle = kind === 2 ? '#fff3ea' : kind === 1 ? '#9aa1ab' : '#d6dbe2';
          c.font = `600 ${label.length > 2 ? 13 : 19}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(label, (u + wu / 2) * px, (r + (r ? 0.25 : 0) + 0.5) * px);
        }
      }
      u += wu;
    }
  });
  [0x3b4048, 0x2b2f36, 0xc8643c].forEach((col, k) => {
    const geo = mergeGeometries(parts[k]!, false);
    if (geo) board.add(place(new Mesh(geo, mat(col, { roughness: 0.55 }))));
  });
  if (sheet) {
    const tex = new CanvasTexture(sheet);
    tex.colorSpace = SRGBColorSpace; tex.anisotropy = anisotropy;
    const legends = new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.55 }));
    legends.rotation.x = -Math.PI / 2; legends.position.y = 332;
    board.add(seeThrough(legends));
  }
  // tilted up at the back on its feet
  board.rotation.x = 0.05; board.position.y = 70;
  g.add(board);
  // the cable: out of the back, over the mat's edge, back to the wall west of the monitor's foot
  g.add(tube([[-1800, 160, -D / 2 - rim], [-1950, 35, -D / 2 - 520], [-2450, 30, -1990], [-2560, -15, -2300], [-2620, -15, -3600], [-2650, -15, -6100]], 45, mat(0x24272c, { roughness: 0.6 }), 6));
  g.position.set(cx, -deskY + 40, z);
  return g;
}

/** A soft white mouse on the mat: a palm-high shell on a flat base, a scroll wheel between its two buttons. */
export function mouse(x: number, deskY: number, z: number): Group {
  const g = new Group(), shell = mat(0xe9e8e4, { roughness: 0.35 }), dark = mat(0x2a2d32, { roughness: 0.5 });
  const geo = new SphereGeometry(1, 28, 16), p = geo.attributes.position!;
  // the shell's height: flat underneath, higher at the palm (+z, toward the room) than at the nose
  const lift = (y: number, zz: number) => (y < -0.1 ? -0.1 + (y + 0.1) * 0.15 : y) * (1 + 0.18 * zz);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + 0.08 * p.getZ(i)), lift(p.getY(i), p.getZ(i)), p.getZ(i));
  geo.computeVertexNormals();
  const sx = 360, sy = 230, sz = 600, y0 = -deskY + 40 + 64;
  const body = place(new Mesh(geo, shell));
  body.scale.set(sx, sy, sz); body.position.set(x, y0, z);
  g.add(body);
  const top = (zz: number) => y0 + lift(Math.sqrt(1 - zz * zz), zz) * sy;
  const wheel = place(new Mesh(new CylinderGeometry(72, 72, 64, 16), dark));
  wheel.rotation.z = Math.PI / 2; wheel.position.set(x, top(-0.43) - 32, z - 0.43 * sz);
  g.add(wheel);
  // the seam between the buttons, before and behind the wheel
  for (const [a, b] of [[-0.08, -0.3], [-0.56, -0.9]] as const) {
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) { const zz = a + ((b - a) * k) / 4; pts.push([x, top(zz) + 2, z + zz * sz]); }
    g.add(tube(pts, 9, dark, 4));
  }
  return g;
}

/** A closed notebook with its elastic band and a pen on it, lying askew on the desk (turned `a` about the vertical). */
export function notebook(x: number, deskY: number, z: number, a: number): Group {
  const g = new Group(), cover = mat(0x3f5a4a, { roughness: 0.7 }), pages = mat(0xf0e9d8, { roughness: 0.9 }), band = mat(0x1f2124, { roughness: 0.6 });
  g.add(softBox({ x: -1700, y: -60, w: 3400, h: 60 }, -2300, 2300, cover, 25), softBox({ x: -1700, y: -400, w: 3400, h: 60 }, -2300, 2300, cover, 25));
  g.add(rectBox({ x: -1640, y: -340, w: 3290, h: 280 }, -2250, 2250, pages), softBox({ x: -1770, y: -400, w: 160, h: 400 }, -2300, 2300, cover, 70));
  g.add(rectBox({ x: 1150, y: -410, w: 90, h: 420 }, -2310, 2310, band));
  // the pen: a barrel, its cap with a clip
  const blue = mat(0x2e3f66, { roughness: 0.35 }), steel = mat(0xc9cdd2, { metalness: 0.85, roughness: 0.25 });
  g.add(rod([-700, 490, -1500], [500, 490, 900], 85, blue, 12), rod([500, 490, 900], [760, 490, 1420], 92, steel, 12), rod([-700, 490, -1500], [-790, 490, -1680], 50, steel, 8));
  g.add(rod([560, 590, 980], [760, 590, 1380], 22, steel, 4));
  g.position.set(x, -deskY, z); g.rotation.y = a;
  return g;
}
