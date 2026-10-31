// The moving parts of a floorplan view, shared by the CPU die (dieview.ts) and the GPU card (render/gpu): pulses that run along the wires,
// packets and the trail they leave, and the pooled texts of cell arrays. Pixi drawing only; what moves and when is the caller's.

import { Container, Graphics, Text } from 'pixi.js';
import { MONO, mix } from '@/core/render/ink';
import { offsetPts, LANE_GAP } from './dieart';
import { pointAt } from './diemotion';
import type { Pt, Rect } from '../core/cpuplan';

/** How long a wire stays lit behind a packet (ms). */
export const TRAIL_MS = 1500;

/** A packet of data running along a link. */
export interface Packet { lines: Pt[][]; len: number; t0: number; dur: number; color: string }
/** A wire lit by a packet that has gone along it. */
export interface Trail { lines: Pt[][]; t0: number; color: string }
/** A pulse running along the wires for one instruction: where it was last drawn and its short tail. */
export interface Dot { px: number; py: number; hist: Pt[]; lastHost: string; env: number }

export const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

/** A packet on a wire (and the trail it will leave, lit from 0.6 of its way on) starting at `t0` ms. */
export function packetOn(link: { id: string; pts: Pt[]; lanes: number }, reverse: boolean, t0: number, dur: number, color: string): { packet: Packet; trail: Trail } {
  const pts = reverse ? [...link.pts].reverse() : link.pts;
  const bundle = (p: Pt[]) => Array.from({ length: link.lanes }, (_, k) => offsetPts(p, (k - (link.lanes - 1) / 2) * LANE_GAP));
  return { packet: { lines: bundle(pts), len: lengthOf(pts), t0, dur, color }, trail: { lines: bundle(link.pts), t0: t0 + dur * 0.6 / 1.1, color } };
}

/** The wires a packet has gone along stay lit in its colour for a moment: the path an instruction took. */
export function drawTrails(g: Graphics, trails: Map<string, Trail>, now: number, zoom: number): void {
  g.clear();
  if (zoom < 0.2) return;
  for (const [id, t] of trails) {
    const age = now - t.t0;
    if (age > TRAIL_MS) { trails.delete(id); continue; }
    if (age < 0) continue;
    const a = 0.85 * (1 - age / TRAIL_MS);
    for (const line of t.lines) {
      g.moveTo(line[0]![0], line[0]![1]);
      for (let i = 1; i < line.length; i++) g.lineTo(line[i]![0], line[i]![1]);
      g.stroke({ width: 2.6, color: t.color, alpha: a, join: 'round' });
    }
  }
}

/** Packets: a bright head with a tail running along each line of the bundle. Returns the ones still on their way. */
export function drawPackets(g: Graphics, packets: Packet[], now: number, zoom: number, ink: string): Packet[] {
  g.clear();
  const live = packets.filter((p) => now < p.t0 + p.dur);
  if (zoom < 0.2) return live;
  for (const p of live) {
    const u = (now - p.t0) / p.dur;
    if (u < 0 || p.len < 2) continue;
    const e = u * u * (3 - 2 * u);
    const fade = Math.min(1, u * 8, (1 - u) * 5 + 0.2);
    for (const line of p.lines) {
      for (let i = 0; i < 6; i++) {
        const q = pointAt(line, Math.max(0, e - i * 0.025));
        g.circle(q[0], q[1], 4.6 - i * 0.6).fill({ color: i === 0 ? mix(p.color, ink, 0.35) : p.color, alpha: fade * (1 - i * 0.15) });
      }
    }
  }
  return live;
}

/** What a pulse needs of a moving thing: where it is now, how far along its wire (`e`, 0..1), its opacity and colours. */
export interface PulseAt { key: string; x: number; y: number; moving: boolean; e: number; alpha: number; core: string; halo: string }

/** One pulse: a dot with a halo and a short tail, fading in and out at the ends of its way. `seen` collects the keys drawn. */
export function drawPulse(g: Graphics, dots: Map<string, Dot>, seen: Set<string>, p: PulseAt): void {
  let d = dots.get(p.key);
  if (!d) { d = { px: NaN, py: NaN, hist: [], lastHost: '', env: 1 }; dots.set(p.key, d); }
  seen.add(p.key);
  const { x, y } = p;
  const dx = Number.isNaN(d.px) ? 0 : x - d.px, dy = Number.isNaN(d.py) ? 0 : y - d.py;
  d.px = x; d.py = y;
  if (!p.moving) { d.hist.length = 0; return; }
  if (Math.hypot(dx, dy) > 60) d.hist.length = 0; // it passed from one trace into the next at a block's edge: no streak across the block
  if (Math.hypot(dx, dy) > 1.2) { d.hist.push([x, y]); if (d.hist.length > 10) d.hist.shift(); } else if (d.hist.length) d.hist.shift();
  const ease = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
  const env = ease(p.e / 0.2) * ease((1 - p.e) / 0.2) * p.alpha;
  d.hist.forEach((q, i) => { const f = (i + 1) / d.hist.length; g.circle(q[0], q[1], 2 + 5 * f).fill({ color: p.core, alpha: 0.4 * f * env }); });
  g.circle(x, y, 11).fill({ color: p.halo, alpha: 0.3 * env });
  g.circle(x, y, 6).fill({ color: p.core, alpha: env }).stroke({ width: 1.6, color: p.halo, alpha: env });
}

/** Texts of the cells of a structure: a pool, one or two lines per cell, set only when the string changes. */
export class CellTexts {
  private a: Text[] = [];
  private b: Text[] = [];
  constructor(private layer: Container) {}
  private text(list: Text[], i: number, bold: boolean): Text {
    let t = list[i];
    if (!t) {
      t = new Text({ text: '', style: { fontFamily: MONO, fontSize: 20, fontWeight: bold ? '700' : '500', fill: '#fff' }, resolution: 2 });
      t.anchor.set(0.5);
      list[i] = t;
      this.layer.addChild(t);
    }
    return t;
  }
  private put(t: Text, str: string, x: number, y: number, size: number, color: string) {
    t.visible = str !== '';
    if (!str) return;
    if (t.text !== str) t.text = str;
    if (t.style.fill !== color) t.style.fill = color;
    t.position.set(x, y);
    t.scale.set(size / 20);
  }
  /** One line (the mnemonic of a queue entry) or two (a name above, a value below) in the cell `r`. */
  set(i: number, top: string, bottom: string, r: Rect, color: string) {
    const cx = r.x + r.w / 2, fit = (s: string, k: number) => Math.min(k, (r.w - 4) / Math.max(1, s.length * 0.62));
    if (r.h < 14 || r.w < 18) { this.hide(i); return; }
    if (bottom === '') {
      this.put(this.text(this.a, i, true), top, cx, r.y + r.h / 2, Math.min(fit(top, 20), r.h * 0.6), color);
      if (this.b[i]) this.b[i]!.visible = false;
      return;
    }
    const s = Math.min(r.h * 0.3, 15);
    this.put(this.text(this.a, i, false), top, cx, r.y + r.h * 0.3, Math.min(fit(top, s), s), color);
    this.put(this.text(this.b, i, true), bottom, cx, r.y + r.h * 0.68, Math.min(fit(bottom, s * 1.15), s * 1.15), color);
  }
  /** One line in a cell too small for `set`: as large as the cell's height and width allow, left out below 3 px. */
  line(i: number, str: string, r: Rect, color: string, fit = str.length) {
    const size = Math.min(r.h * 0.85, (r.w - 1) / Math.max(1, fit * 0.62), 15);
    if (size < 3) { this.hide(i); return; }
    this.put(this.text(this.a, i, false), str, r.x + r.w / 2, r.y + r.h / 2, size, color);
    if (this.b[i]) this.b[i]!.visible = false;
  }
  hide(i: number) { if (this.a[i]) this.a[i]!.visible = false; if (this.b[i]) this.b[i]!.visible = false; }
  hideFrom(n: number) { for (let i = n; i < Math.max(this.a.length, this.b.length); i++) this.hide(i); }
  clear() { for (const t of [...this.a, ...this.b]) t?.destroy(); this.a = []; this.b = []; }
}
