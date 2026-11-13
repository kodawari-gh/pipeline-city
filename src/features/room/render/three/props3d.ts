// The room's props in 3D, modelled on the owner's reference image (docs/3D_STYLE.md "Look decision"): the architect lamp, the monitor with its
// standby screen, the digital clock, a tea cup steaming on its saucer, the keyboard, the mouse and a notebook (the sill's aloe: `plants3d.ts`).
// Each builder returns a group in world units (x and y from the 2D layout, y flipped; z out of the wall) and keeps what `frame` animates.
import {
  AdditiveBlending, BackSide, Box3, BoxGeometry, DoubleSide, CanvasTexture, Color, CylinderGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NoColorSpace, PlaneGeometry, RectAreaLight, SRGBColorSpace, SphereGeometry, SplineCurve, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, type BufferGeometry, type Object3D, type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { anisotropy, paint, place, post, rectBox, rod, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { loadModel } from '@/core/render/three/gltf';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import { oak } from './furniture3d';
import { monitorBody } from './monitor3d';
import { NEON, NEON_WASH, STEEL } from './palette';

type V3 = [number, number, number];
/** The clock's digits: the cyan of what glows in tech. */
const CLOCK_INK = `#${NEON.toString(16).padStart(6, '0')}`;

// ------------------------------------------------------------------ lamp
export interface Lamp { root: Group; bulb: MeshStandardMaterial; inner: MeshStandardMaterial; mouth: V3; dir: [number, number] }

/**
 * An architect lamp in black powder-coated steel: a round weighted base, paired lower arms with a spring, an elbow, paired upper arms, a cone
 * shade pointing down at the desk, warm white inside.
 */
export function lamp(base: { x: number; y: number }, elbowXY: { x: number; y: number }, head: { x: number; y: number }, mouthXY: { x: number; y: number }, z: number): Lamp {
  const coat = mat(STEEL, { roughness: 0.4, metalness: 0.3 }), joint = mat(0x6d7178, { metalness: 0.6, roughness: 0.3 });
  const g = tag(new Group(), 'lamp');
  // (its baked occlusion: the joints between the paired arms, the base under them; `vertexao.ts`)
  g.userData.ao = 30 * MM;
  g.add(post(base.x, base.y, z, 950, 150, coat, 40, 880));
  g.add(post(base.x, base.y - 150, z, 230, 280, coat, 20, 200));
  const b0: V3 = [base.x, -(base.y - 400), z], el: V3 = [elbowXY.x, -elbowXY.y, z], hd: V3 = [head.x, -head.y, z];
  for (const dz of [-90, 90]) {
    g.add(rod([b0[0], b0[1], z + dz], [el[0], el[1], z + dz], 55, coat));
    g.add(rod([el[0], el[1], z + dz], [hd[0], hd[1], z + dz], 50, coat));
  }
  g.add(rod([b0[0] + 160, b0[1] + 250, z], [el[0] + 180, el[1] - 200, z], 22, joint, 6)); // the spring
  for (const p of [b0, el, hd]) { const j = place(new Mesh(new CylinderGeometry(120, 120, 300, 16), joint)); j.rotation.x = Math.PI / 2; j.position.set(...p); g.add(j); }
  // the shade: its narrow end at the head, its mouth toward the desk
  const dx = mouthXY.x - head.x, dy = -(mouthXY.y - head.y), len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const shade = new Group(), L = 1500;
  shade.position.set(...hd);
  shade.rotation.z = Math.atan2(ux, -uy);
  const outer = place(new Mesh(new CylinderGeometry(300, 820, L, 32, 1, true), coat));
  const inner = mat(0xfff4dc, { roughness: 0.6, side: BackSide, emissive: new Color(0xffd9a0), emissiveIntensity: 0 });
  const innerM = new Mesh(new CylinderGeometry(296, 812, L, 32, 1, true), inner);
  const cap = place(new Mesh(new SphereGeometry(300, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), coat));
  outer.position.y = innerM.position.y = -L / 2; cap.position.y = 0;
  // the mouth's rolled lip, the head's knob that sets the shade's tilt
  const lip = place(new Mesh(new TorusGeometry(816, 40, 8, 48), coat));
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
  private faceMat: MeshBasicMaterial | null = null;
  private liveTex: Texture | null = null;
  private liveRev: number | undefined;
  private liveSize = '';
  private led = mat(0x111111, { emissive: new Color(0x4cff8a), emissiveIntensity: 0 });
  /**
   * The bias light: a cyan strip round the back's edge (`NEON_WASH`), as one area light the back's size facing the wall (its east end over the
   * column); the room sets its level while the screen is on. The room holds it, not this root: hidden with an absent monitor, it would change
   * the count of lights, and with it every lit program (`docs/render/load.md`).
   */
  readonly bias: RectAreaLight;

  /** `toneMapped`: the face takes the tone mapping (the game room's: its picture is tone mapped by the post chain); off for the shop's showcase. */
  constructor(m: RectLike, screen: RectLike, deskY: number, z0: number, { toneMapped = false }: { toneMapped?: boolean } = {}) {
    const R = this.root, cx = m.x + m.w / 2;
    // (its baked occlusion: the column into the back, the foot on the desk; `vertexao.ts`)
    R.userData.ao = 40 * MM;
    // the body: the panel, the back housing, the bracket, the stand, the ports (monitor3d.ts)
    R.add(monitorBody(m, screen, deskY, z0));
    this.bias = new RectAreaLight(NEON_WASH, 0, m.w - 400, m.h - 400);
    this.bias.position.set(cx, -(m.y + m.h / 2), z0 - 20);
    const led = new Mesh(new CylinderGeometry(28, 28, 20, 10), this.led);
    led.rotation.x = Math.PI / 2; led.position.set(m.x + m.w - 260, -(m.y + m.h - 70), z0 + 186);
    R.add(seeThrough(led));
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1280; this.canvas.height = 720;
      this.tex = rawSrgb(this.canvas);
      this.tex.anisotropy = anisotropy;
    }
    const face = new Mesh(new BoxGeometry(screen.w, screen.h, 4), Object.assign(new MeshBasicMaterial({ map: this.tex, toneMapped }), { defines: { ...DECODE_SRGB } }));
    this.faceMat = face.material as MeshBasicMaterial;
    face.position.set(screen.x + screen.w / 2, -(screen.y + screen.h / 2), z0 + 182);
    // the panel's glass: no colour of its own, only what it mirrors (the window, the lamp, the room), added over the picture. The lights'
    // own glints are left out: the screen's light stands just in front of it and would shine back as a white spot in its middle
    const glassM = new MeshStandardMaterial({ color: 0x000000, roughness: 0.12, metalness: 0, transparent: true, blending: AdditiveBlending, depthWrite: false });
    glassM.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular = vec3(0.0);'); };
    const glass = new Mesh(new PlaneGeometry(screen.w, screen.h), glassM);
    glass.position.set(screen.x + screen.w / 2, -(screen.y + screen.h / 2), z0 + 186);
    R.add(face, seeThrough(glass));
  }

  /**
   * The screen drawn by the 2D game's own `Live` (boardlive3d.ts: the text rows, the OS rows, the dashboard of the graphics display, what a GPU
   * draws, the boot and no-signal screens) in place of the plain picture; null brings that back. `w` x `h` is the drawn part of `canvas`.
   */
  useLive(img: { canvas: HTMLCanvasElement; w: number; h: number; rev?: number } | null): void {
    const m = this.faceMat;
    if (!m) return;
    if (!img) { this.liveRev = undefined; if (m.map !== this.tex) { m.map = this.tex; m.needsUpdate = true; } return; } // (off: the next show uploads again)
    // a new texture uploads by itself; an old one only when the canvas was drawn again (`rev`) or its size changed
    if (!this.liveTex || this.liveTex.image !== img.canvas) { this.liveTex?.dispose(); this.liveTex = rawSrgb(img.canvas); this.liveTex.anisotropy = this.tex?.anisotropy ?? 1; this.liveRev = img.rev; this.liveSize = ''; }
    this.liveTex.repeat.set(img.w / img.canvas.width, img.h / img.canvas.height);
    this.liveTex.offset.set(0, 1 - img.h / img.canvas.height);
    const size = `${img.w}x${img.h}`;
    if (img.rev === undefined || img.rev !== this.liveRev || size !== this.liveSize) { this.liveTex.needsUpdate = true; this.liveRev = img.rev; this.liveSize = size; }
    if (m.map !== this.liveTex) { m.map = this.liveTex; m.needsUpdate = true; }
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
    // (its baked occlusion: the bezel round the face, the case against the column; `vertexao.ts`)
    this.root.userData.ao = 20 * MM;
    this.root.add(softBox(r, 0, 260, mat(STEEL, { roughness: 0.45, metalness: 0.3 }), 50));
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
    c.fillStyle = 'rgba(59,227,255,0.1)'; c.fillText('88:88', 256, 86);
    c.fillStyle = CLOCK_INK; c.fillText(t, 256, 86);
    if (this.tex) this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ tea cup
export interface Cup { root: Group; wisps: Sprite[]; top: V3 }

/** Room units per millimetre. */
const MM = 18.7;
/** Where the glaze stops on the cup's outside (mm up from its foot) round it (`a`, radians): a wavy line, a few drips running lower. */
const DRIPS: readonly (readonly [number, number, number])[] = [[0.6, 0.09, 7], [1.9, 0.06, 5], [2.7, 0.11, 8.5], [4.1, 0.07, 4], [5.2, 0.1, 6.5]];
function glazeEdge(a: number): number {
  let y = 19 + 1.6 * Math.sin(3 * a + 1) + 0.9 * Math.sin(7 * a + 0.4);
  for (const [at, w, len] of DRIPS) {
    const d = Math.atan2(Math.sin(a - at), Math.cos(a - at)) / w;
    if (Math.abs(d) < 1) y -= len * Math.sqrt(1 - d * d);
  }
  return y;
}

/**
 * The yunomi's side, a lathe profile in mm: the recess under the foot and the foot ring (unglazed), the wall turned up from it (a full
 * belly, throwing rings on it), the rounded lip, the inside down to its floor. `outer` is the wall's first and last index (for the glaze map).
 */
function cupProfile(): { pts: Vector2[]; outer: [number, number] } {
  const pts = [[0, 3], [17.5, 3], [18.6, 2.2], [19.3, 0.6], [20.2, 0], [23, 0], [23.9, 0.6], [24.2, 2]].map(([r, y]) => new Vector2(r, y));
  const wall = new SplineCurve([[24.2, 5.2], [26.6, 6.9], [29.6, 9.6], [32, 14], [33.3, 22], [34, 34], [34.2, 46], [33.9, 60], [33.4, 72], [33.3, 77]].map(([r, y]) => new Vector2(r, y)));
  const first = pts.length;
  for (const p of wall.getPoints(56)) pts.push(new Vector2(p.x + (p.y > 13 && p.y < 75 ? 0.2 * Math.sin((2 * Math.PI * p.y) / 6.5) : 0), p.y));
  const last = pts.length - 1;
  for (const [r, y] of [[33.1, 78], [32.5, 78.7], [31.7, 78.8], [31, 78.2], [30.6, 77]]) pts.push(new Vector2(r, y));
  const inside = new SplineCurve([[30.6, 76], [30.9, 66], [31.1, 52], [30.8, 38], [29.8, 26], [27.6, 17], [23.5, 12.2], [15, 10.4], [0, 10]].map(([r, y]) => new Vector2(r, y)));
  pts.push(...inside.getPoints(30));
  return { pts, outer: [first, last] };
}

/** A walnut chataku under the cup: a shallow well for its foot, a broad flat, a raised rim, a foot ring under it. In mm. */
const SAUCER = [[0, 4.5], [24.8, 4.5], [25.6, 5.2], [26.2, 6.6], [27.5, 7.2], [40, 7.6], [43.4, 8.6], [45, 9.1], [45.8, 8.6], [46, 7], [45.4, 4], [44, 2.6], [41.5, 2.2], [40.6, 1], [40, 0], [0, 0]];

/**
 * A Japanese tea cup (a yunomi, 68 mm across, 79 tall) of green tea on a walnut saucer: an ash glaze, oatmeal white, pooling blue-grey where
 * it ran thick at its edge and thinning brown at the lip, the toasted clay bare under it; the tea steaming faintly. Real sizes.
 */
export function teaCup(x: number, deskY: number, z: number): Cup {
  const g = new Group(), { pts, outer } = cupProfile(), n = pts.length - 1;
  // the glaze map, painted down the profile (v: a point's index along it) and round (u), and its roughness map the same way (glaze glossy,
  // the pooled glaze glassier, the bare clay rough)
  const vAt = (y: number): number => {
    let i = outer[0];
    while (i < outer[1] && pts[i + 1]!.y < y) i++;
    const a = pts[i]!, b = pts[Math.min(outer[1], i + 1)]!;
    return (i + Math.min(1, Math.max(0, (y - a.y) / Math.max(1e-6, b.y - a.y)))) / n;
  };
  const glazeMap = (rough: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    const row = (v: number) => (1 - v) * h;
    c.fillStyle = rough ? '#2e2e2e' : '#d6cfbf'; c.fillRect(0, 0, w, h);
    for (let px = 0; px < w; px++) {
      const ye = glazeEdge(((px + 0.5) / w) * Math.PI * 2), top = row(vAt(ye));
      c.fillStyle = rough ? '#e6e6e6' : '#7b5237'; c.fillRect(px, top, 1, h - top);
      // the pooled glaze over its edge: thick, blue-grey, a deeper line where it stopped
      const pool = row(vAt(ye + 4));
      const gr = c.createLinearGradient(0, pool, 0, top);
      gr.addColorStop(0, rough ? 'rgba(30,30,30,0)' : 'rgba(110,128,136,0)'); gr.addColorStop(0.7, rough ? 'rgba(22,22,22,0.9)' : 'rgba(110,128,136,0.85)'); gr.addColorStop(1, rough ? 'rgba(22,22,22,1)' : 'rgba(78,92,100,1)');
      c.fillStyle = gr; c.fillRect(px, pool, 1, top - pool);
    }
    if (rough) return;
    // the lip, where the glaze thins over the edge, and the iron in the clay speckling through
    const lip0 = row(vAt(74)), lip1 = row((outer[1] + 6) / n), lg = c.createLinearGradient(0, lip0, 0, lip1);
    lg.addColorStop(0, 'rgba(138,104,74,0)'); lg.addColorStop(0.6, 'rgba(138,104,74,0.55)'); lg.addColorStop(1, 'rgba(138,104,74,0.2)');
    c.fillStyle = lg; c.fillRect(0, lip1, w, lip0 - lip1);
    for (let k = 0; k < 260; k++) { c.fillStyle = `rgba(70,48,30,${0.25 + 0.4 * Math.abs(Math.sin(k * 7.3))})`; const s = 0.6 + Math.abs(Math.sin(k * 3.1)) * 1.4; c.fillRect(Math.abs(Math.sin(k * 12.9898)) * w, Math.abs(Math.sin(k * 78.233)) * h * 0.92, s, s); }
  };
  const map = paint(512, 256, glazeMap(false)), roughMap = paint(512, 256, glazeMap(true));
  if (roughMap) roughMap.colorSpace = NoColorSpace;
  const glaze = mat(0xffffff, { map, roughnessMap: roughMap, roughness: 1 });
  const cup = place(new Mesh(new LatheGeometry(pts, 56), glaze));
  // (thrown by hand: a touch out of round)
  cup.scale.set(1.012, 1, 0.99);
  cup.rotation.y = 2.1;
  cup.position.y = 4.5;
  const tea = new Mesh(new CylinderGeometry(30.6, 30.6, 0.4, 40), mat(0x8d8a34, { roughness: 0.04 }));
  tea.position.y = 4.5 + 70;
  // the saucer, its grain straight across it
  const walnut = mat(0xffffff, { map: oak('#5a3f2c', '#2a1b11'), roughness: 0.45 }), sg = new LatheGeometry(SAUCER.map(([r, y]) => new Vector2(r, y)), 48);
  const sp = sg.attributes.position!, suv = sg.attributes.uv!;
  // (the grain runs along x; up the rim's side it climbs across the grain, as on a turned block)
  for (let i = 0; i < sp.count; i++) suv.setXY(i, sp.getX(i) / 92 + 0.5, sp.getZ(i) / 92 + 0.5 + sp.getY(i) / 40);
  const saucer = place(new Mesh(sg, walnut));
  const held = new Group();
  held.add(cup, tea, saucer);
  held.scale.setScalar(MM);
  held.position.set(x, -deskY, z);
  g.add(held);
  // the steam: thin wisps, faint (tea, not a boiling kettle)
  const wispTex = paint(32, 96, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.setTransform(1, 0, 0, h / w, 0, 0); c.fillStyle = gr; c.fillRect(0, 0, w, w);
  });
  const wisps = Array.from({ length: 9 }, (_, i) => { const s = new Sprite(new SpriteMaterial({ map: wispTex, transparent: true, depthWrite: false, opacity: 0, rotation: (i % 3 - 1) * 0.35 })); g.add(seeThrough(s)); return s; });
  return { root: g, wisps, top: [x, -deskY + (4.5 + 76) * MM, z] };
}

/** The steam at game time t (s): wisps rise slowly from the tea, lean and widen as they go, and fade, each on its own phase. */
export function steam(m: Cup, t: number): void {
  m.wisps.forEach((p, i) => {
    const life = (t / 6 + i / m.wisps.length) % 1, sway = Math.sin(t * 0.6 + i * 2.3) * 220 * life + Math.cos(i * 1.9) * 160;
    p.position.set(m.top[0] + sway, m.top[1] + 150 + life * 1700, m.top[2] + Math.sin(i * 3.1) * 140);
    p.scale.set(160 + life * 380, 480 + life * 700, 1);
    (p.material as SpriteMaterial).opacity = 0.13 * Math.sin(life * Math.PI) ** 1.5;
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

/** Where the keyboard's cable ends on the desk (x, z from the keyboard's middle): the grommet that takes it down through the top (`room3d.ts`). */
export const KEY_LEAD = [-2650, -6100] as const;

/**
 * A 75% mechanical keyboard on the mat: an aluminium case with a raised rim round a dark plate, tapered caps (letters, darker modifiers, terracotta
 * Esc and Enter) with their legends, the board tilted up at the back, its cable off the back to the grommet near the wall (`KEY_LEAD`).
 */
export function keyboard(cx: number, deskY: number, z: number): Group {
  const g = new Group(), board = new Group(), U = KEY_U, W = 15 * U, D = 6.25 * U;
  // (its baked occlusion: the gaps between the caps, the plate inside the rim; `vertexao.ts`)
  g.userData.ao = 25 * MM;
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
  g.add(tube([[-1800, 160, -D / 2 - rim], [-1950, 35, -D / 2 - 520], [-2450, 30, -1990], [-2560, -15, -2300], [-2620, -15, -3600], [KEY_LEAD[0], -15, KEY_LEAD[1]]], 45, mat(0x24272c, { roughness: 0.6 }), 6));
  g.position.set(cx, -deskY + 40, z);
  return g;
}

/** The owner's gaming mouse (`res/computer-mouse.zip`, converted to `public/models/mouse.glb`): its buttons at +x, its palm at -x. */
const MOUSE_MODEL = `${import.meta.env.BASE_URL}models/mouse.glb`, MOUSE_LEN = 1800;

/**
 * A soft white mouse on the mat: the owner's model, scaled to the shell's length and set on its flat base. Until it loads, and when it fails, the
 * primitive shell stays: a palm-high shell on a flat base, a scroll wheel between its two buttons. `loaded` gets the model once it is in (the
 * room gives it its reflections).
 */
export function mouse(x: number, deskY: number, z: number, loaded?: (o: Object3D) => void): Group {
  const g = new Group(), prim = new Group(), shell = mat(0x9d9b96, { roughness: 0.6 }), dark = mat(0x2a2d32, { roughness: 0.5 });
  const geo = new SphereGeometry(1, 28, 16), p = geo.attributes.position!;
  // the shell's height: flat underneath, higher at the palm (+z, toward the room) than at the nose
  const lift = (y: number, zz: number) => (y < -0.1 ? -0.1 + (y + 0.1) * 0.15 : y) * (1 + 0.18 * zz);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + 0.08 * p.getZ(i)), lift(p.getY(i), p.getZ(i)), p.getZ(i));
  geo.computeVertexNormals();
  const sx = 360, sy = 230, sz = 600, y0 = -deskY + 40 + 64;
  const body = place(new Mesh(geo, shell));
  body.scale.set(sx, sy, sz); body.position.set(x, y0, z);
  prim.add(body);
  const top = (zz: number) => y0 + lift(Math.sqrt(1 - zz * zz), zz) * sy;
  const wheel = place(new Mesh(new CylinderGeometry(72, 72, 64, 16), dark));
  wheel.rotation.z = Math.PI / 2; wheel.position.set(x, top(-0.43) - 32, z - 0.43 * sz);
  prim.add(wheel);
  // the seam between the buttons, before and behind the wheel
  for (const [a, b] of [[-0.08, -0.3], [-0.56, -0.9]] as const) {
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) { const zz = a + ((b - a) * k) / 4; pts.push([x, top(zz) + 2, z + zz * sz]); }
    prim.add(tube(pts, 9, dark, 4));
  }
  g.add(prim);
  // the model: turned so its buttons face the far side (-z) and its palm the room; its length is the 2D mouse's (`MOUSE.l`, 1800), uniformly scaled, its flat base on the mat
  void loadModel(MOUSE_MODEL).then((m) => {
    if (!m || !g.parent) return;
    const model = m.clone(true);
    model.rotation.y = Math.PI / 2;
    const box = new Box3().setFromObject(model), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3());
    const k = MOUSE_LEN / (size.z || 1), base = y0 - 0.1 * sy;
    model.scale.setScalar(k);
    model.position.set(x - mid.x * k, base - box.min.y * k, z - mid.z * k);
    // one colour: the shell's, in place of the model's own materials; both sides drawn, the file's faces are not all wound one way
    const skin = shell.clone(); skin.side = DoubleSide;
    model.traverse((o) => { if (o instanceof Mesh) { o.material = skin; place(o); } });
    g.add(model);
    prim.visible = false;
    loaded?.(model);
  });
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
