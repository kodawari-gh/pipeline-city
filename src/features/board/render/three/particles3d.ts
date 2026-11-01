// Particles over the machine: warm haze rising off parts that run hot (more as they near their limit), grey smoke off a burnt one, and a few sparks
// round the CPU while it works. One additive point cloud, a fixed pool; the emitters are the installed parts, placed by their slot's rect.
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Points, PointsMaterial, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { slotRects } from './slots3d';

const N = 600;
const HOT_C = 40, FULL_C = 85;
const RUNNING = new Set(['loading', 'running', 'writing']);

interface Kind { life: [number, number]; rise: number; spread: number; size: number; rgb: [number, number, number] }
const HAZE: Kind = { life: [1.6, 2.8], rise: 420, spread: 110, size: 230, rgb: [0.55, 0.3, 0.12] };
const SMOKE: Kind = { life: [2.5, 4], rise: 300, spread: 90, size: 330, rgb: [0.22, 0.22, 0.24] };
const SPARK: Kind = { life: [0.4, 0.9], rise: 0, spread: 700, size: 90, rgb: [0.4, 0.9, 1] };

function dot(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export class Particles3D {
  private readonly geo = new BufferGeometry();
  private readonly pos = new Float32Array(N * 3);
  private readonly col = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly age = new Float32Array(N).fill(Infinity);
  private readonly life = new Float32Array(N).fill(1);
  private readonly base = new Float32Array(N * 3);
  private readonly pts: Points;
  private readonly mat = new PointsMaterial({ size: 240, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, map: dot() });
  private next = 0;
  private carry = new Map<string, number>();
  private rects: Map<string, import('../layout/layout').Rect> | null = null;
  private rectsFor: Snapshot | null = null;

  constructor(scene: Scene) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.pts = new Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    this.pts.raycast = () => {};
    this.pts.renderOrder = 5;
    scene.add(this.pts);
    this.pos.fill(1e7);
  }

  private spawn(k: Kind, x: number, y: number, z: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const a = Math.random() * Math.PI * 2, sp = k === SPARK ? k.spread * (0.4 + Math.random() * 0.6) : k.spread * Math.random();
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = k === SPARK ? Math.cos(a) * sp : (Math.random() - 0.5) * k.spread;
    this.vel[i * 3 + 1] = k === SPARK ? Math.sin(a) * sp : k.rise * (0.7 + Math.random() * 0.6);
    this.vel[i * 3 + 2] = k === SPARK ? (Math.random() - 0.3) * sp : k.rise * 0.4 * Math.random();
    this.life[i] = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
    this.age[i] = 0;
    this.base.set(k.rgb, i * 3);
  }

  /** Per frame, with the snapshot and the game's elapsed seconds (the particles stop with the pause). */
  frame(s: Snapshot | null, dt: number): void {
    if (s && s !== this.rectsFor) { this.rectsFor = s; this.rects = slotRects(s); }
    // emit
    if (s && dt > 0 && this.rects) {
      const live = s.powered && !s.power.tripped;
      for (const d of s.devices) {
        const r = this.rects.get(d.slot);
        if (!r) continue;
        let rate = 0, kind = HAZE;
        if (d.burnt) { rate = 5; kind = SMOKE; }
        else if (live && d.tempC > HOT_C) rate = 16 * Math.min(1, (d.tempC - HOT_C) / (FULL_C - HOT_C));
        if (rate > 0) this.emit(d.id + kind.size, rate * dt, kind, r);
        if (live && d.kind === 'cpu' && RUNNING.has(s.phase)) this.emit(d.id + 'sp', 16 * dt, SPARK, r);
      }
    }
    // move, fade
    for (let i = 0; i < N; i++) {
      const a = this.age[i]! + dt;
      this.age[i] = a;
      const l = this.life[i]!;
      if (a >= l) { this.pos[i * 3] = this.pos[i * 3 + 1] = this.pos[i * 3 + 2] = 1e7; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      for (let j = 0; j < 3; j++) this.pos[i * 3 + j] = this.pos[i * 3 + j]! + this.vel[i * 3 + j]! * dt;
      const k = a / l, f = Math.sin(Math.PI * Math.min(1, k)) * 0.8;
      this.col[i * 3] = this.base[i * 3]! * f; this.col[i * 3 + 1] = this.base[i * 3 + 1]! * f; this.col[i * 3 + 2] = this.base[i * 3 + 2]! * f;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  /** `n` particles' worth of emission this frame (the fraction carries to the next), spread over the rect. */
  private emit(key: string, n: number, kind: Kind, r: { x: number; y: number; w: number; h: number }): void {
    let c = (this.carry.get(key) ?? 0) + n;
    while (c >= 1) {
      c -= 1;
      this.spawn(kind, r.x + r.w * Math.random(), -(r.y + r.h * Math.random()), BOARD_Z + 700);
    }
    this.carry.set(key, c);
  }

  dispose(): void {
    this.pts.removeFromParent();
    this.geo.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}
