import { Container, Graphics, type Text } from 'pixi.js';
import type { DeviceSnap, GpuSnap } from '../../sim/game/types';
import type { GpuStepKind } from '../../sim/ref/gpuref';
import { label, mix } from '../ink';
import type { Theme } from '../theme';
import { EdgeFan } from '../room/case';
import { gpuCover } from './accelart';
import type { Pt } from '../die/cpuplan';
import { gpuFar, gpuNear } from '../gpu/gpuart';
import { gpuPlan, type GpuPlan } from './gpulayout';
import type { Rect } from './layout';
import { bankState, conflicted, GpuPlayer, laneActive, stepText, type GpuTick } from '../gpu/gpuplayer';

// The graphics cards of the board, alive (docs/ACCEL.md "Art as built"). Along the top edge the fans spin, at a speed that follows the card's
// temperature and load. Zoomed in, the shroud fades away like an x-ray and the die shows through: the lanes lit by the execution mask (the idle
// ones dark: divergence), the vector registers, the memory banks with the addresses queued on each (a conflict serves them one round at a time),
// the mask stack, the program counter and the instruction on show. The picture is a slow-motion replay of the snapshot's last instructions
// (gpumotion.ts), like the die view's. Everything below the fans is drawn only when something changes.

// Zoom levels (board scale; the card is large, up to 3800 units, so they sit below the die's): the cover fades 0.16 -> 0.28, the traces and cells
// are there with it, the names come at 0.3, the second lines and the counters at 0.6.
const FADE_FROM = 0.16, FADE_TO = 0.28, TEXT_Z = 0.3, DETAIL_Z = 0.6;
/** Fan speed in turns per second: idle (just powered, cold), and at the card's throttle point. */
const FAN_IDLE = 0.5, FAN_FULL = 3.5;
/** Seen edge-on a turn is some blade spacings sliding past (the case fans do the same, a little slower). */
const BLADES_PER_TURN = 1.6;

/** The point a fraction `f` of the way along a polyline (by length). */
export function along(pts: Pt[], f: number): Pt {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i]![0] - pts[i - 1]![0]) + Math.abs(pts[i]![1] - pts[i - 1]![1]);
  let d = Math.max(0, Math.min(1, f)) * len;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (d <= seg || i === pts.length - 1) { const u = seg === 0 ? 0 : Math.min(1, d / seg); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
    d -= seg;
  }
  return pts[0]!;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How fast a card's fans turn (turns per second): from cold to hot, a little faster under load, faster again once throttled. */
export function fanTurns(tempC: number, busy: boolean, throttled: boolean): number {
  const heat = Math.max(0, Math.min(1, (tempC - 28) / 45));
  return FAN_IDLE + (FAN_FULL - FAN_IDLE) * heat + (busy ? 0.6 : 0) + (throttled ? 0.5 : 0);
}

/** The colour of an instruction kind (the die's colours: ALU cyan, load amber, store green, branch pink). */
export function kindColor(T: Theme, kind: GpuStepKind): string {
  return kind === 'ld' ? T.ld : kind === 'st' ? T.st : kind === 'mask' ? T.mul : kind === 'br' ? T.br : kind === 'sys' ? T.mute : T.alu;
}

/** What a card is called while it does what, for the link block. */
export const PHASE_TEXT: Record<GpuSnap['phase'], string> = { idle: 'IDLE', in: 'LAUNCH', run: 'RUNNING', out: 'DONE' };

export interface GpuCardScene { slot: string; visual: string; origin: { x: number; y: number } }

interface CardView {
  slot: string;
  plan: GpuPlan;
  root: Container;
  /** The die's insides: a still plate, the live layer over it, and the texts. */
  inner: Container;
  dyn: Graphics;
  cover: Graphics;
  fans: { fan: EdgeFan; turns: number }[];
  wires: Container;
  cells: Container;
  names: Container;
  subs: Container;
  pcText: Text;
  decText: Text;
  linkText: Text;
  ctrText: Text;
  player: GpuPlayer;
  tick: GpuTick;
  snap: GpuSnap | undefined;
  tempC: number;
  throttled: boolean;
  sig: string;
}

export class GpuView {
  readonly root = new Container();
  private T: Theme | null = null;
  private cards: CardView[] = [];
  private zoom = 1;

  constructor() {
    this.root.visible = false;
  }

  /** The graphics cards of a new scene (board space origin of each card's PCB). */
  setScene(T: Theme, scene: GpuCardScene[]): void {
    this.T = T;
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.cards = scene.map((c) => this.build(T, c));
    this.root.visible = this.cards.length > 0;
  }

  private build(T: Theme, c: GpuCardScene): CardView {
    const plan = gpuPlan(c.visual), root = new Container(), inner = new Container(), plate = new Graphics(), dyn = new Graphics();
    root.position.set(c.origin.x, c.origin.y);
    // the die at the card's offset: its floor and blocks drawn once, then the traces, cells and names the zoom brings in, then the live layer over them
    const art = new Container();
    art.position.set(plan.origin.x, plan.origin.y);
    gpuFar(plate, T, plan.die);
    const near = gpuNear(T, plan.die);
    art.addChild(plate, near.wires, near.cells);
    const live = new Container();
    live.addChild(dyn);
    inner.addChild(art, live);
    const names = new Container(), subs = new Container();
    names.position.set(plan.origin.x, plan.origin.y);
    subs.position.set(plan.origin.x, plan.origin.y);
    names.addChild(near.names);
    subs.addChild(near.subs);
    inner.addChild(names, subs);
    const low = (r: Rect, lines: number, size: number): number => r.y + r.h - 8 - lines * (size + 3);
    const pcText = label('', plan.pc.x + 7, low(plan.pc, 2, 11), 11, T.ink, { head: true, a: 0.95, minPx: 4 });
    const linkText = label('PCIe', plan.link.x + 7, low(plan.link, 1, 12), 12, T.mute, { head: true, a: 0.95, minPx: 4 });
    const ctrText = label('', plan.mem.x + 7, low(plan.mem, 4, 10), 10, T.mute, { a: 0.9, minPx: 4 });
    const decText = label('', plan.decode.x + 7, low(plan.decode, 1, 11), 11, T.ink, { head: true, a: 0.95, minPx: 4 });
    inner.addChild(pcText, decText, linkText, ctrText);

    const cover = gpuCover(new Graphics(), T, plan);
    const fans = plan.fans.map((f) => ({ fan: new EdgeFan(f, T), turns: 0 })); // the case fans' edge-on look, blades sliding along the module
    root.addChild(inner, cover, ...fans.map((f) => f.fan));
    this.root.addChild(root);
    return { slot: c.slot, plan, root, inner, dyn, cover, fans, wires: near.wires, cells: near.cells, names, subs, pcText, decText, linkText, ctrText, player: new GpuPlayer(), tick: { step: null, index: -1, length: 0, progress: 0, round: 0, playing: false, cycle: 0, sms: [], warps: [] }, snap: undefined, tempC: 25, throttled: false, sig: '' };
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The newest snapshot: each card's insides, and the devices for the temperatures that drive the fans. */
  update(gpus: GpuSnap[] | undefined, devices: DeviceSnap[] | undefined): void {
    for (const c of this.cards) {
      const g = gpus?.find((x) => x.slot === c.slot);
      c.snap = g;
      c.player.feed(g);
      const d = devices?.find((x) => x.slot === c.slot);
      c.tempC = d?.tempC ?? 25;
      c.throttled = !!d?.throttle;
    }
  }

  /** Per frame. `inner` is false while the case's exterior covers the board (nothing to draw). */
  frame(dt: number, inner: boolean): void {
    this.root.visible = inner && this.cards.length > 0;
    if (!this.root.visible || !this.T) return;
    const T = this.T, fade = smooth(FADE_FROM, FADE_TO, this.zoom);
    for (const c of this.cards) {
      // the fans: always on, whatever the zoom
      const target = c.snap ? fanTurns(c.tempC, c.snap.phase !== 'idle', c.throttled) : 0;
      for (const f of c.fans) {
        f.turns += (target - f.turns) * Math.min(1, dt * 1.2);
        f.fan.spin(f.turns * dt * BLADES_PER_TURN, Math.min(1, f.turns / FAN_FULL));
      }
      c.tick = c.player.advance(dt);
      c.cover.alpha = 1 - fade;
      c.inner.alpha = fade;
      c.inner.visible = fade > 0.02;
      if (!c.inner.visible) continue;
      const showText = this.zoom >= TEXT_Z, showDetail = this.zoom >= DETAIL_Z;
      c.names.visible = c.pcText.visible = c.decText.visible = c.linkText.visible = showText;
      c.subs.visible = c.ctrText.visible = showDetail;
      const t = c.tick, s = c.snap;
      const sig = `${t.index}|${t.round}|${Math.round(t.progress * 6)}|${t.step?.mask ?? -1}|${s?.phase ?? '-'}|${s?.stack.length ?? 0}|${s ? s.stats.cycles : -1}|${s?.launches ?? 0}|${showText ? 1 : 0}${showDetail ? 1 : 0}`;
      if (sig === c.sig) continue;
      c.sig = sig;
      this.draw(T, c);
    }
  }

  private draw(T: Theme, c: CardView): void {
    const g = c.dyn, p = c.plan, t = c.tick, s = c.snap, step = t.step;
    g.clear();
    const col = step ? kindColor(T, step.kind) : T.alu, pulse = 1 - t.progress * 0.6;
    const on = !!s && s.phase !== 'idle' || t.playing;
    // lanes: lit under the mask, dark when the mask turned them off
    const smTick = (sm: number) => t.sms.find((x) => x.sm === sm), smStep = (sm: number) => smTick(sm)?.step ?? step;
    const laneOn = (k: number): boolean => { const st = smStep(Math.floor(k / p.perSm)); return st ? ((st.mask >>> (k % p.perSm)) & 1) === 1 : true; };
    p.laneCells.forEach((r, k) => {
      const act = laneOn(k);
      if (!s) g.rect(r.x, r.y, r.w, r.h).fill({ color: T.line, alpha: 0.18 });
      else if (act) g.rect(r.x, r.y, r.w, r.h).fill({ color: col, alpha: on ? 0.28 + 0.55 * pulse : 0.2 }).stroke({ width: 2, color: col, alpha: on ? 0.8 : 0.35 });
      else g.rect(r.x, r.y, r.w, r.h).fill({ color: '#000000', alpha: 0.55 }).stroke({ width: 1.5, color: T.line, alpha: 0.5 });
    });
    // the execution mask, one bit per lane
    p.maskBits.forEach((r, k) => {
      const act = laneOn(k);
      g.rect(r.x, r.y, r.w, r.h).fill({ color: act && s ? T.alu : '#000000', alpha: act && s ? 0.75 : 0.45 });
    });
    // the mask stack: slots filled to the card's current depth
    const depth = s?.stack.length ?? 0;
    p.maskSlots.forEach((r, k) => { if (k < depth) g.rect(r.x, r.y, r.w, r.h).fill({ color: T.mul, alpha: 0.85 }); });
    // the registers: a cell is bright when the lane holds something, the destination of the instruction on show glows in its colour
    for (const set of p.regSets) set.rows.forEach((row, ri) => {
      const cw = row.w / set.cols, vals = s?.regs[ri];
      for (let l = 0; l < set.cols; l++) g.rect(row.x + l * cw + 0.5, row.y, Math.max(1, cw - 1), row.h).fill({ color: T.alu, alpha: vals && vals[set.lane0 + l] !== 0 ? 0.5 : 0.1 });
      if (step && step.dest === ri) g.rect(row.x, row.y, row.w, row.h).fill({ color: col, alpha: 0.55 * pulse }).stroke({ width: 1.5, color: col, alpha: 0.9 });
    });
    // the banks: the addresses queued on each, served one round at a time
    const t0: GpuTick = { ...t, step: smStep(0), round: smTick(0)?.round ?? t.round };
    const mem = t0.step?.kind === 'ld' || t0.step?.kind === 'st';
    const bad = conflicted(t0);
    p.bankBars.forEach((r, b) => {
      const { queued, served } = bankState(t0, b), along = r.w >= r.h, len = (along ? r.w : r.h) - 4, segL = len / 8;
      for (let k = 0; k < Math.min(queued, 8); k++) {
        const f = { color: k < served ? col : T.line, alpha: k < served ? 0.9 : 0.5 };
        if (along) g.rect(r.x + 2 + k * segL + 1, r.y + 1, segL - 2, r.h - 2).fill(f);
        else g.rect(r.x + 1, r.y + r.h - 2 - (k + 1) * segL + 1, r.w - 2, segL - 2).fill(f);
      }
      if (queued > 1) g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).stroke({ width: 3, color: T.bad, alpha: 0.9 });
    });
    if (mem) {
      // the memory links of the die light up, and the card memory answers
      for (const l of p.links) {
        if (l.kind !== 'mem') continue;
        g.moveTo(l.pts[0]![0], l.pts[0]![1]);
        for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]);
        g.stroke({ width: 3, color: bad ? T.bad : col, alpha: 0.8 * pulse, join: 'round' });
      }
      g.rect(p.mem.x, p.mem.y, p.mem.w, p.mem.h).fill({ color: col, alpha: 0.12 * pulse });
    }
    // the warps: a chip each, lit by the instruction it holds (its mask as a bar) and outlined while it is the one issuing
    for (const w of p.warpCells) {
      const wt = t.warps.find((x) => x.sm === w.sm && x.warp === w.warp), r = w.rect;
      if (!wt) { g.rect(r.x, r.y, r.w, r.h).fill({ color: '#000000', alpha: 0.3 }); continue; }
      let on = 0;
      for (let k = 0; k < p.perSm; k++) if ((wt.mask >>> k) & 1) on++;
      g.rect(r.x + 2, r.y + r.h - 6, (r.w - 4) * (on / p.perSm), 4).fill({ color: T.alu, alpha: 0.85 });
      if (wt.busy) g.rect(r.x, r.y, r.w, r.h).stroke({ width: 2, color: wt.index === t.index ? col : T.mul, alpha: 0.9 });
    }
    // the instruction flows along the routed links: control wires carry it down the front end, data wires into the lanes, memory wires out
    if (on && step) {
      for (const l of p.links) {
        const sm = /^sm(\d+)\./.exec(l.id)?.[1], st = smStep(sm ? Number(sm) : 0);
        if (!st) continue;
        const memory = st.kind === 'ld' || st.kind === 'st';
        if (l.kind === 'launch' || (l.kind === 'mem' && !memory) || (l.kind === 'data' && st.kind === 'sys')) continue;
        const pt = along(l.pts, smTick(sm ? Number(sm) : 0)?.progress ?? t.progress);
        g.circle(pt[0], pt[1], 4).fill({ color: l.kind === 'mem' && bad ? T.bad : kindColor(T, st.kind), alpha: 0.95 });
      }
    }
    // the PCIe link: lit while a launch crosses it
    const hop = s?.phase === 'in' || s?.phase === 'out';
    if (hop) {
      g.rect(p.link.x, p.link.y, p.link.w, p.link.h).fill({ color: T.mul, alpha: 0.18 });
      for (const l of p.links) {
        if (l.kind !== 'launch') continue;
        g.moveTo(l.pts[0]![0], l.pts[0]![1]);
        for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]);
        g.stroke({ width: 3, color: T.mul, alpha: 0.9, join: 'round' });
      }
    }
    // the texts
    c.linkText.text = s ? `PCIe ${PHASE_TEXT[s.phase]}` : 'PCIe';
    c.decText.text = s && step ? `${step.name}${step.dest !== null ? ` v${step.dest}` : ''}${step.sm !== undefined ? `  sm${step.sm}.w${step.warp ?? 0}` : ''}` : '';
    c.pcText.text = s ? `pc 0x${(step?.pc ?? s.pc).toString(16).padStart(3, '0')}
${stepText(t, p.lanes)}` : '';
    c.ctrText.text = s ? `${s.launches} launches
${s.stats.instructions} instr
${s.stats.idleLaneSlots} idle lane slots
${s.stats.conflictCycles} conflict cycles` : '';
  }
}
