// The room's props in 3D, modelled on the owner's reference image (docs/LOWPOLY_STYLE.md "Look decision"): the architect lamp, the monitor with its
// standby screen, the digital clock, the mug with its steam, the plant on the sill, the keyboard and mouse, and the city seen through the window.
// Each builder returns a group in world units (x and y from the 2D layout, y flipped; z out of the wall) and keeps what `frame` animates.
import {
  BackSide, Color, CylinderGeometry, DodecahedronGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, type Texture, BoxGeometry, ConeGeometry,
} from 'three';
import { anisotropy, instanced, paint, place, post, rectBox, rod, softBox, type RectLike } from '@/core/render/three/geometry';
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
  const body = place(new Mesh(new CylinderGeometry(390, 360, 950, 32, 1, false, -Math.PI / 2), [ceramic, mat(0xf4f2ee, { roughness: 0.3 }), mat(0xf4f2ee)]));
  body.position.set(x, -deskY + 475, z);
  const coffee = new Mesh(new CylinderGeometry(355, 355, 10, 32), mat(0x3a2214, { roughness: 0.15 }));
  coffee.position.set(x, -deskY + 900, z);
  const handle = place(new Mesh(new TorusGeometry(230, 62, 10, 20, Math.PI * 1.15), mat(0xf4f2ee, { roughness: 0.3 })));
  handle.rotation.z = -Math.PI * 0.575; handle.position.set(x + 400, -deskY + 500, z);
  g.add(body, coffee, handle);
  const puffTex = paint(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const puffs = Array.from({ length: 6 }, () => { const s = new Sprite(new SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); g.add(seeThrough(s)); return s; });
  return { root: g, puffs, top: [x, -deskY + 950, z] };
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

// ------------------------------------------------------------------ plant
export function plant(x: number, sillY: number, z: number): Group {
  const g = new Group();
  g.add(post(x, sillY, z, 260, 420, mat(0xb8643a, { roughness: 0.8 }), 16, 330));
  g.add(post(x, sillY - 420, z, 300, 60, mat(0xa45632, { roughness: 0.8 }), 16));
  const leaf = mat(0x4e9a4a, { roughness: 0.6, flatShading: true }), leaf2 = mat(0x3d7f3d, { roughness: 0.6, flatShading: true });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, tilt = 0.35 + (k % 3) * 0.18, h = 520 + (k % 4) * 110;
    const l = place(new Mesh(new ConeGeometry(70, h, 4), k % 2 ? leaf : leaf2));
    l.position.set(x + Math.sin(a) * 110, -(sillY - 480) + h / 2 * Math.cos(tilt), z + Math.cos(a) * 110);
    l.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
    g.add(l);
  }
  return g;
}

// ------------------------------------------------------------------ keyboard, mouse
export function keyboard(cx: number, deskY: number, z: number): Group {
  const g = new Group();
  g.add(softBox({ x: -3000, y: -230, w: 6000, h: 230 }, -1000, 1000, mat(0x2b2f35, { roughness: 0.45 }), 70));
  const caps: { x: number; y: number; z: number; sx?: number }[] = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 15; col++) {
    if (row === 4 && col > 3 && col < 11) { if (col === 7) caps.push({ x: 0, y: 270, z: -760 + row * 370, sx: 7.4 }); continue; }
    caps.push({ x: -2780 + col * 397, y: 270, z: -760 + row * 370 });
  }
  g.add(instanced(new BoxGeometry(330, 80, 300), mat(0x41464e, { roughness: 0.5 }), caps));
  g.position.set(cx, -deskY + 40, z);
  return g;
}

export function mouse(x: number, deskY: number, z: number): Mesh {
  const m = place(new Mesh(new SphereGeometry(1, 20, 12), mat(0x8e939a, { roughness: 0.4 })));
  m.scale.set(360, 210, 600); m.position.set(x, -deskY + 40, z);
  return m;
}

// ------------------------------------------------------------------ the view out of the window
/** A low-poly city behind the window: hills, two rows of towers (the far row hazier), a tall spire tower; windows that light at night. */
export function city(win: RectLike, horizonY: number): { root: Group; lit: MeshStandardMaterial[] } {
  const g = new Group(), lit: MeshStandardMaterial[] = [];
  const winTex = paint(64, 128, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 12) for (let x = 5; x < w; x += 11) if ((x * 7 + y * 13) % 5 < 2) { c.fillStyle = '#ffd890'; c.fillRect(x, y, 6, 7); }
  });
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hill = mat(0x86ad78, { roughness: 1, flatShading: true });
  for (let k = 0; k < 4; k++) {
    const h = place(new Mesh(new DodecahedronGeometry(4200 + k * 900, 0), hill), false);
    h.scale.set(1.6, 0.55, 0.6); h.position.set(win.x - 2000 + k * 4200, -horizonY - 600, -14000 - k * 500);
    g.add(seeThrough(h));
  }
  const row = (z: number, base: number, color: number, n: number, hMin: number, hMax: number) => {
    for (let k = 0; k < n; k++) {
      const w = 900 + rnd() * 1200, h = hMin + rnd() * (hMax - hMin), x = win.x - 2600 + k * ((win.w + 5200) / n) + rnd() * 400;
      const m = mat(color, { roughness: 0.9, emissive: new Color(0xffffff), emissiveMap: winTex, emissiveIntensity: 0 });
      lit.push(m);
      const b = place(new Mesh(new BoxGeometry(w, h, w * 0.8), m), false);
      b.position.set(x, -base + h / 2, z);
      g.add(seeThrough(b));
    }
  };
  row(-11000, horizonY + 300, 0x8796ad, 9, 1400, 3800);
  row(-7000, horizonY + 600, 0x5f6e86, 7, 700, 2400);
  // the spire tower: three tiers and a needle
  const tower = mat(0x6d7b92, { roughness: 0.8, emissive: new Color(0xffffff), emissiveMap: winTex, emissiveIntensity: 0 });
  lit.push(tower);
  const tx = win.x + win.w * 0.42;
  [[1300, 3600], [950, 1900], [600, 1300]].reduce((y, [w, h]) => {
    const b = place(new Mesh(new BoxGeometry(w!, h!, w!), tower), false);
    b.position.set(tx, y + h! / 2, -9000); g.add(seeThrough(b));
    return y + h!;
  }, -horizonY - 400);
  const needle = new Mesh(new ConeGeometry(110, 2000, 6), tower);
  needle.position.set(tx, -horizonY - 400 + 6800 + 1000, -9000);
  g.add(seeThrough(needle));
  return { root: g, lit };
}

/** The sky behind the city: a gradient, the sun (by day) and a few low-poly clouds. */
export function skyTexture(top: string, hor: string, day: number): Texture | null {
  return paint(512, 512, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, hor);
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    if (day > 0.05) {
      c.globalAlpha = day;
      const sx = w * 0.6, sy = h * 0.36;
      c.fillStyle = 'rgba(255,240,170,0.35)'; c.beginPath(); c.arc(sx, sy, 48, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffe680'; c.beginPath(); c.arc(sx, sy, 34, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.92)';
      for (const [cx, cy, s] of [[0.4, 0.42, 0.45], [0.66, 0.5, 0.35], [0.5, 0.3, 0.3]] as const) {
        const x = cx * w, y = cy * h, k = 40 * s;
        c.beginPath(); c.moveTo(x - 2.2 * k, y + k * 0.6); c.lineTo(x - 1.4 * k, y - k * 0.2); c.lineTo(x - 0.4 * k, y - k * 0.8); c.lineTo(x + 0.8 * k, y - k * 0.4);
        c.lineTo(x + 1.6 * k, y + 0.1 * k); c.lineTo(x + 2.2 * k, y + k * 0.6); c.closePath(); c.fill();
      }
      c.globalAlpha = 1;
    }
  });
}

