import { Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import { getSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/protocol';
import { PKG, SCREEN, pointAt, type Lane, type Rect } from './layout';
import { box, MONO, mix } from './ink';
import { drawPsuMeter } from './devices';
import type { Theme } from './theme';

/** Per-device rectangle the glow is drawn around, keyed by device id (set by the scene). */
export interface GlowTarget { id: string; kind: string; spec: string; rect: Rect }

interface Glow { t: GlowTarget; g: Graphics; dim: Graphics; base: number; level: number }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Everything that changes with the sim: glow per device (power, heat), burnt dimming, throttle badge, fan spin,
 * bus activity dots, DRAM chip flashes, the CLI monitor text. Cheap by design: per-snapshot work redraws a few
 * small Graphics, per-frame work moves sprites and rotates fans.
 */
export class Live {
  readonly root = new Container();
  private glows = new Map<string, Glow>();
  private fans: { c: Container; kind: string; speed: number; target: number }[] = [];
  private dots: Sprite[] = [];
  private dotTex: Texture;
  private lanes: Lane[] = [];
  private flows: Lane[] = [];
  private badge: Text;
  private screenText: Text;
  private meter = new Graphics();
  private dramFlash = new Graphics();
  private dramChips: Rect[] = [];
  private act = 0.12;
  private actTarget = 0.12;
  private phase = 0;
  private missAt = -1e9;
  private lastMisses = 0;
  private lastCycles = 0;
  private cpuHeat = 0;
  private clockRatio = 1;
  private shownText = '\u0000';
  private zoom = 0.15;
  private T!: Theme;

  constructor(renderer: Renderer, private additive: boolean) {
    const dg = new Graphics().circle(0, 0, 16).fill({ color: '#ffffff' });
    this.dotTex = renderer.generateTexture(dg);
    dg.destroy();
    this.badge = new Text({ text: '', style: { fontFamily: MONO, fontSize: 70, fontWeight: '700', fill: '#ffffff' }, resolution: 2 });
    this.badge.anchor.set(0.5, 0.5);
    this.screenText = new Text({ text: '', style: { fontFamily: MONO, fontSize: 34, lineHeight: 44, fill: '#ffffff' }, resolution: 2 });
    this.screenText.position.set(SCREEN.x + 44, SCREEN.y + 36);
  }

  /** (Re)build live objects for a scene. Called when the theme or the installed set changes. */
  setScene(T: Theme, targets: GlowTarget[], lanes: Lane[], flows: Lane[], fans: { c: Container; kind: string }[], dramChips: Rect[]) {
    this.T = T;
    const keep = new Set<unknown>([this.badge, this.screenText, this.meter, this.dramFlash]);
    for (const ch of this.root.removeChildren()) if (!keep.has(ch)) ch.destroy({ children: true });
    this.glows.clear();
    this.dots = [];
    this.lanes = lanes;
    this.flows = flows;
    this.fans = fans.map((f) => ({ ...f, speed: 0, target: 0 }));
    this.dramChips = dramChips;
    for (const t of targets) {
      const g = new Graphics(), dim = new Graphics();
      if (this.additive) g.blendMode = 'add';
      this.root.addChild(g, dim);
      this.glows.set(t.id, { t, g, dim, base: 0, level: 0 });
    }
    this.root.addChild(this.dramFlash);
    // dots: every other lane carries data, a few more light up on a RAM access
    const n = lanes.length + flows.length + lanes.filter((l) => l.kind === 'mem').length;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.dotTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.dots.push(s);
      this.root.addChild(s);
    }
    this.root.addChild(this.meter, this.badge, this.screenText);
    this.badge.position.set(0, PKG.y - 120);
    this.shownText = '\u0000';
    this.screenText.style.fill = T.st;
  }

  setZoom(z: number) { this.zoom = z; }

  /** Per-snapshot update. `s` may be null before the sim has started. */
  update(s: Snapshot | null, now: number) {
    const T = this.T;
    if (!s) return;
    const cpu = s.devices.find((d) => d.kind === 'cpu');
    const running = !!s.request && !!cpu && !cpu.burnt && !s.power.off && !s.power.tripped && cpu.effectiveClock > 0;
    this.actTarget = running ? 1 : 0.1;
    const spec = cpu && getSpec(cpu.spec);
    this.clockRatio = cpu && spec?.clock ? clamp(cpu.effectiveClock / spec.clock.base, 0.25, 3) : 1;
    // RAM traffic: a cache miss or a cache-stalled cycle since the last snapshot
    const misses = (s.counters.cacheMisses ?? 0), cycles = s.counters.cycles ?? 0;
    if (cycles < this.lastCycles) this.lastMisses = 0; // new attempt
    if (misses > this.lastMisses) this.missAt = now;
    this.lastMisses = misses; this.lastCycles = cycles;
    this.cpuHeat = cpu ? clamp((cpu.tempC - 35) / 55) : 0;

    for (const d of s.devices) {
      const gl = this.glows.get(d.id);
      const sp = getSpec(d.spec);
      if (d.kind === 'cooler') {
        const f = this.fans.find((x) => x.kind === 'cooler');
        if (f) f.target = d.burnt ? 0 : 1.2 + 9 * this.cpuHeat + (running ? 2 : 0);
      }
      if (d.kind === 'psu') {
        const f = this.fans.find((x) => x.kind === 'psu');
        const ratio = s.power.budgetW > 0 ? s.power.totalW / s.power.budgetW : 0;
        if (f) f.target = s.power.tripped || s.power.off ? 0 : 1 + 8 * clamp(ratio);
        drawPsuMeter(this.meter, T, ratio, s.power.tripped);
        if (gl) { gl.base = s.power.tripped ? 1 : clamp(ratio) * 0.8; this.drawGlow(gl, s.power.tripped ? T.bad : ratio > 0.85 ? T.ld : T.st, false); }
        continue;
      }
      if (!gl) continue;
      const load = sp && sp.loadW > 0 ? clamp(d.powerW / sp.loadW) : 0;
      const heat = clamp((d.tempC - 35) / 55);
      let col = heat < 0.5 ? mix(T.alu, T.ld, heat * 2) : mix(T.ld, T.bad, (heat - 0.5) * 2);
      if (d.unstable) col = T.bad;
      gl.base = d.burnt ? 0 : 0.25 + 0.6 * Math.max(load, heat);
      this.drawGlow(gl, col, d.burnt);
    }
    // PSU hard trip with no PSU glow target still dims everything else via effective clocks (0)

    // badge over the CPU
    if (cpu?.burnt) this.setBadge('CPU BURNT OUT', T.bad);
    else if (s.power.tripped) this.setBadge('PSU TRIPPED', T.bad);
    else if (s.power.off) this.setBadge('NO POWER', T.bad);
    else if (cpu?.unstable) this.setBadge('UNSTABLE', T.bad);
    else if (cpu && cpu.throttle < 0.985) this.setBadge(`THROTTLED ${Math.round(cpu.throttle * 100)}%`, T.ld);
    else this.badge.visible = false;

    // CLI monitor
    const txt = s.display || (s.request ? '' : 'READY.');
    if (txt !== this.shownText) { this.shownText = txt; this.screenText.text = txt; }
    this.screenText.alpha = s.request ? 1 : 0.55;
  }

  private setBadge(text: string, color: string) {
    this.badge.visible = true;
    if (this.badge.text !== text) this.badge.text = text;
    this.badge.style.fill = color;
  }

  private drawGlow(gl: Glow, color: string, burnt: boolean) {
    const { g, dim, t } = gl, r = t.rect;
    g.clear(); dim.clear();
    if (burnt) {
      box(dim, r.x, r.y, r.w, r.h, 24, { fill: this.T.bg, fa: 0.62 });
      dim.moveTo(r.x + r.w * 0.2, r.y + r.h * 0.2).lineTo(r.x + r.w * 0.8, r.y + r.h * 0.8).moveTo(r.x + r.w * 0.8, r.y + r.h * 0.2).lineTo(r.x + r.w * 0.2, r.y + r.h * 0.8);
      dim.stroke({ width: Math.max(16, Math.min(r.w, r.h) * 0.03), color: this.T.bad, alpha: 0.85, cap: 'round' });
      return;
    }
    for (let i = 0; i < 4; i++) {
      const e = 8 + i * 14;
      box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 40 + e, { stroke: color, lw: 14, sa: 0.5 * (1 - i / 4) });
    }
  }

  /** Per-frame animation. dt in seconds. */
  frame(dt: number, now: number) {
    this.act += (this.actTarget - this.act) * Math.min(1, dt * 3);
    this.phase += dt * 280 * (0.3 + this.act) * this.clockRatio;
    for (const f of this.fans) {
      f.speed += (f.target - f.speed) * Math.min(1, dt * 2);
      f.c.rotation += f.speed * dt;
    }
    for (const gl of this.glows.values()) {
      const pulse = 0.85 + 0.15 * Math.sin(now * 0.004 + gl.t.rect.x);
      gl.g.alpha = clamp(gl.base * pulse * 1.2, 0, 1);
    }
    // bus dots
    const T = this.T;
    const r = Math.max(10, 2.4 / this.zoom) / 16;
    const mf = Math.max(0, 1 - (now - this.missAt) / 1100);
    let k = 0;
    const put = (p: [number, number], col: string, a: number, scale = 1) => {
      const s = this.dots[k++];
      if (!s) return;
      s.visible = a > 0.02;
      s.position.set(p[0], p[1]);
      s.tint = col; s.alpha = a; s.scale.set(r * scale);
    };
    const lanes = this.lanes;
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i]!, col = l.kind === 'mem' ? T.alu : l.kind === 'pcie' ? T.br : T.mul;
      put(pointAt(l, this.phase + l.ph), col, i % 2 === 0 ? 0.35 + 0.6 * this.act : 0);
    }
    for (const f of this.flows) put(pointAt(f, this.phase * 0.8 + f.ph), f.kind === 'mem' ? T.alu : T.br, 0.9 * this.act);
    for (const l of lanes) if (l.kind === 'mem') put(pointAt(l, this.phase * 3 + l.ph), T.ld, mf * 0.9, 1.3);
    while (k < this.dots.length) this.dots[k++]!.visible = false;
    // DRAM chip flash on a miss
    this.dramFlash.clear();
    if (mf > 0) {
      let n = 0;
      for (const c of this.dramChips) {
        if ((Math.floor(now / 140) + n++) % 3 === 0) box(this.dramFlash, c.x, c.y, c.w, c.h, 8, { fill: T.ld, fa: mf * 0.7, stroke: T.ld, lw: 5 });
      }
    }
  }
}
