// Smoke over the machine: grey smoke rises off a part that burnt. One additive point cloud, a fixed pool; the emitters are the burnt parts, placed by their
// slot's rect. A part that runs, or runs hot, sends up nothing (heat shows in the airflow lens, `air/`). With no smoke in the air, nothing is moved,
// uploaded or drawn.
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Points, PointsMaterial } from 'three';
import type * as threeTypes from 'three';
import type { Snapshot } from '@/worker/protocol';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { slotRects } from './slots3d';

const N = 240;
/** What a burnt part sends up: puffs a second, how long a puff lives (s), how fast it rises, how far it drifts, its colour. */
const RATE = 5,
  LIFE: readonly [number, number] = [2.5, 4],
  RISE = 300,
  SPREAD = 90,
  RGB = [0.22, 0.22, 0.24] as const;

function dot(): CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null; // (the tests in Node)
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!,
    r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export class Particles3D {
  private readonly geo = new BufferGeometry();
  private readonly pos = new Float32Array(N * 3);
  private readonly col = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly age = new Float32Array(N).fill(Infinity);
  private readonly life = new Float32Array(N).fill(1);
  private readonly pts: Points;
  private readonly mat = new PointsMaterial({
    size: 240,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    map: dot(),
  });
  private next = 0;
  /** The puffs in the air after the last frame. */
  private alive = 0;
  private carry = new Map<string, number>();
  private rects: Map<string, import('../layout/layout').Rect> | null = null;
  private rectsFor: Snapshot | null = null;
  /** The share of the particles that are born (the graphics settings); 0 draws none. */
  density = 1;

  constructor(scene: threeTypes.Scene) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.pts = new Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    this.pts.raycast = () => {};
    this.pts.renderOrder = 5;
    this.pts.visible = false;
    scene.add(this.pts);
    this.pos.fill(1e7);
  }

  private spawn(x: number, y: number, z: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * SPREAD;
    this.vel[i * 3 + 1] = RISE * (0.7 + Math.random() * 0.6);
    this.vel[i * 3 + 2] = RISE * 0.4 * Math.random();
    this.life[i] = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
    this.age[i] = 0;
  }

  /** Per frame, with the snapshot and the game's elapsed seconds (the smoke stops with the pause). */
  frame(s: Snapshot | null, dt: number): void {
    if (this.density <= 0) {
      this.pts.visible = false;
      this.alive = 0;
      return;
    }
    if (s && dt > 0 && s.devices.some((d) => d.burnt)) {
      if (s !== this.rectsFor) {
        this.rectsFor = s;
        this.rects = slotRects(s);
      }
      for (const d of s.devices) {
        const r = d.burnt ? this.rects?.get(d.slot) : undefined;
        if (r) {
          this.emit(d.id, RATE * dt, r);
        }
      }
    }
    // nothing in the air: nothing to move, upload or draw
    this.pts.visible = this.alive > 0;
    if (this.alive === 0 || dt <= 0) {
      return;
    }
    // move, fade
    let alive = 0;
    for (let i = 0; i < N; i++) {
      const a = this.age[i]! + dt;
      this.age[i] = a;
      const l = this.life[i]!;
      if (a >= l) {
        this.pos[i * 3] = this.pos[i * 3 + 1] = this.pos[i * 3 + 2] = 1e7;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      alive++;
      for (let j = 0; j < 3; j++) {
        this.pos[i * 3 + j] = this.pos[i * 3 + j]! + this.vel[i * 3 + j]! * dt;
      }
      const k = a / l,
        f = Math.sin(Math.PI * Math.min(1, k)) * 0.8;
      this.col[i * 3] = RGB[0] * f;
      this.col[i * 3 + 1] = RGB[1] * f;
      this.col[i * 3 + 2] = RGB[2] * f;
    }
    this.alive = alive;
    this.pts.visible = alive > 0;
    this.geo.attributes['position']!.needsUpdate = true;
    this.geo.attributes['color']!.needsUpdate = true;
  }

  /** `n` puffs' worth of emission this frame (the fraction carries to the next), spread over the rect. */
  private emit(key: string, n: number, r: { x: number; y: number; w: number; h: number }): void {
    let c = (this.carry.get(key) ?? 0) + n * this.density;
    while (c >= 1) {
      c -= 1;
      this.spawn(r.x + r.w * Math.random(), -(r.y + r.h * Math.random()), BOARD_Z + 700);
      this.alive++;
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
