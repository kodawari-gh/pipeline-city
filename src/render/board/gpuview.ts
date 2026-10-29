import { Container, Graphics, Text } from 'pixi.js';
import type { DeviceSnap, GpuSnap } from '../../sim/game/types';
import type { GpuStepKind } from '../../sim/ref/gpuref';
import { label, mix } from '../ink';
import type { Theme } from '../theme';
import { fanBlades, gpuCover } from './accelart';
import { gpuPlan, type GpuPlan } from './gpulayout';
import { bankState, conflicted, GpuPlayer, laneActive, stepText, type GpuTick } from './gpumotion';

// The graphics cards of the board, alive (docs/ACCEL.md "Art as built"). Along the top edge the fans spin, at a speed that follows the card's
// temperature and load. Zoomed in, the shroud fades away like an x-ray and the die shows through: the lanes lit by the execution mask (the idle
// ones dark: divergence), the vector registers, the memory banks with the addresses queued on each (a conflict serves them one round at a time),
// the mask stack, the program counter and the instruction on show. The picture is a slow-motion replay of the snapshot's last instructions
// (gpumotion.ts), like the die view's. Everything below the fans is drawn only when something changes.

// Zoom levels (board scale; the card is large, 3000 units, so they sit below the die's): the cover fades 0.28 -> 0.45, the texts come at 0.5, the counters at 0.9.
const FADE_FROM = 0.28, FADE_TO = 0.45, TEXT_Z = 0.5, DETAIL_Z = 0.9;
/** Fan speed in turns per second: idle (just powered, cold), and at the card's throttle point. */
const FAN_IDLE = 0.5, FAN_FULL = 3.5;

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
  fans: { spin: Container; turns: number; angle: number }[];
  titles: Text[];
  details: Text[];
  pcText: Text;
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
    const ink = T.dark ? '#070b14' : '#0f1626', dim = mix(T.line, '#000000', 0.2);
    // the plate: the die's floor with the outlines of every block, drawn once
    plate.roundRect(plan.body.x, plan.body.y - 6, plan.body.w, plan.body.h + 6, 8).fill({ color: ink, alpha: 0.96 });
    plate.roundRect(plan.body.x, plan.body.y - 6, plan.body.w, plan.body.h + 6, 8).stroke({ width: 3, color: T.line, alpha: 0.9 });
    const frame = (r: { x: number; y: number; w: number; h: number }): void => { plate.rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6).stroke({ width: 2, color: dim, alpha: 0.9 }); };
    frame(plan.lanesBlock); frame(plan.regs); frame(plan.mem); frame(plan.maskStack);
    for (const b of plan.bankBars) frame(b);
    plate.rect(plan.link.x, plan.link.y, plan.link.w, plan.link.h).fill({ color: ink }).stroke({ width: 2, color: dim });
    // the card memory as a grid of words (a flash runs over it on a load or a store)
    const gx = 40, gy = 8, cw = plan.mem.w / gx, ch = (plan.mem.h - 28) / gy;
    for (let a = 0; a < gx; a++) for (let b = 0; b < gy; b++) plate.rect(plan.mem.x + a * cw + 1, plan.mem.y + 22 + b * ch + 1, cw - 2, ch - 2);
    plate.fill({ color: T.alu, alpha: 0.07 });
    for (const m of plan.maskSlots) plate.rect(m.x, m.y, m.w, m.h).stroke({ width: 1.5, color: dim });
    inner.addChild(plate, dyn);

    const titles: Text[] = [], details: Text[] = [];
    const title = (s: string, x: number, y: number, size = 13, list = titles): Text => { const t = label(s, x, y, size, T.mute, { head: true, a: 0.9, minPx: 4 }); list.push(t); inner.addChild(t); return t; };
    title('LANES', plan.lanesBlock.x, plan.pc.y + 4);
    title(`REGISTERS v0-v7 x ${plan.lanes}`, plan.regs.x, plan.mem.y + plan.mem.h + 4);
    title(plan.banks === 1 ? 'BANK' : `BANKS x ${plan.banks}`, plan.bankBars[0]!.x, plan.mem.y + plan.mem.h + 4);
    title('MASK', plan.mask.x + plan.mask.w + 8, plan.mask.y + 3);
    title('MASK STACK', plan.maskStack.x + plan.maskStack.w + 8, plan.maskStack.y + 5);
    title(`CARD MEMORY ${Math.round(plan.memBytes / 1024)}K`, plan.mem.x + 4, plan.mem.y + 3);
    const pcText = label('', plan.pc.x + 90, plan.pc.y + 3, 16, T.ink, { head: true, a: 0.95, minPx: 4 });
    const linkText = label('PCIe', plan.link.x + 10, plan.link.y + 8, 15, T.mute, { head: true, a: 0.95, minPx: 4 });
    const ctrText = label('', plan.mem.x + 4, plan.mem.y + plan.mem.h - 18, 12, T.mute, { a: 0.9, minPx: 4 });
    inner.addChild(pcText, linkText, ctrText);
    details.push(ctrText);

    const cover = gpuCover(new Graphics(), T, plan);
    const fans = plan.fans.map((f) => {
      const spin = new Container(), blades = fanBlades(T, f.r);
      spin.addChild(blades);
      spin.position.set(f.cx, f.cy);
      return { spin, turns: 0, angle: Math.random() * Math.PI * 2 };
    });
    root.addChild(inner, cover, ...fans.map((f) => f.spin));
    this.root.addChild(root);
    return { slot: c.slot, plan, root, inner, dyn, cover, fans, titles, details, pcText, linkText, ctrText, player: new GpuPlayer(), tick: { step: null, index: -1, length: 0, progress: 0, round: 0, playing: false }, snap: undefined, tempC: 25, throttled: false, sig: '' };
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
        f.angle = (f.angle + f.turns * dt * Math.PI * 2) % (Math.PI * 2);
        f.spin.rotation = f.angle;
      }
      c.tick = c.player.advance(dt);
      c.cover.alpha = 1 - fade;
      c.inner.alpha = fade;
      c.inner.visible = fade > 0.02;
      if (!c.inner.visible) continue;
      const showText = this.zoom >= TEXT_Z, showDetail = this.zoom >= DETAIL_Z;
      for (const t of c.titles) t.visible = showText;
      c.pcText.visible = c.linkText.visible = showText;
      for (const t of c.details) t.visible = showDetail;
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
    p.laneCells.forEach((r, k) => {
      const act = laneActive(t, k);
      if (!s) g.rect(r.x, r.y, r.w, r.h).fill({ color: T.line, alpha: 0.18 });
      else if (act) g.rect(r.x, r.y, r.w, r.h).fill({ color: col, alpha: on ? 0.28 + 0.55 * pulse : 0.2 }).stroke({ width: 2, color: col, alpha: on ? 0.8 : 0.35 });
      else g.rect(r.x, r.y, r.w, r.h).fill({ color: '#000000', alpha: 0.55 }).stroke({ width: 1.5, color: T.line, alpha: 0.5 });
    });
    // the execution mask, one bit per lane
    p.maskBits.forEach((r, k) => {
      const act = laneActive(t, k);
      g.rect(r.x, r.y, r.w, r.h).fill({ color: act && s ? T.alu : '#000000', alpha: act && s ? 0.75 : 0.45 });
    });
    // the mask stack: slots filled to the card's current depth
    const depth = s?.stack.length ?? 0;
    p.maskSlots.forEach((r, k) => { if (k < depth) g.rect(r.x, r.y, r.w, r.h).fill({ color: T.mul, alpha: 0.85 }); });
    // the registers: a cell is bright when the lane holds something, the destination of the instruction on show glows in its colour
    p.regRows.forEach((row, ri) => {
      const cw = row.w / p.lanes, vals = s?.regs[ri];
      for (let l = 0; l < p.lanes; l++) g.rect(row.x + l * cw + 1, row.y, cw - 2, row.h).fill({ color: T.alu, alpha: vals && vals[l] !== 0 ? 0.5 : 0.1 });
      if (step && step.dest === ri) g.rect(row.x, row.y, row.w, row.h).fill({ color: col, alpha: 0.55 * pulse }).stroke({ width: 1.5, color: col, alpha: 0.9 });
    });
    // the banks: the addresses queued on each, served one round at a time
    const mem = step?.kind === 'ld' || step?.kind === 'st';
    const bad = conflicted(t);
    p.bankBars.forEach((r, b) => {
      const { queued, served } = bankState(t, b), segH = (r.h - 4) / 8;
      for (let k = 0; k < Math.min(queued, 8); k++) {
        const y = r.y + r.h - 2 - (k + 1) * segH;
        g.rect(r.x + 3, y + 1, r.w - 6, segH - 2).fill({ color: k < served ? col : T.line, alpha: k < served ? 0.9 : 0.5 });
      }
      if (queued > 1) g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).stroke({ width: 3, color: T.bad, alpha: 0.9 });
    });
    if (mem) {
      // the bus from the lanes to the banks, and the card memory answering
      const y = p.lanesBlock.y - 4, x1 = p.bankBars[p.bankBars.length - 1]!.x + p.bankBars[0]!.w;
      g.moveTo(p.lanesBlock.x, y).lineTo(x1, y).stroke({ width: 3, color: bad ? T.bad : col, alpha: 0.8 * pulse });
      p.bankBars.forEach((r, b) => { if (bankState(t, b).queued > 0) g.moveTo(r.x + r.w / 2, y).lineTo(r.x + r.w / 2, r.y).stroke({ width: 3, color: bad ? T.bad : col, alpha: 0.8 }); });
      g.rect(p.mem.x, p.mem.y + 22, p.mem.w, p.mem.h - 22).fill({ color: col, alpha: 0.12 * pulse });
    }
    // the PCIe link: lit while a launch crosses it
    const hop = s?.phase === 'in' || s?.phase === 'out';
    g.rect(p.link.x + 8, p.link.y + 34, p.link.w - 16, 8).fill({ color: hop ? T.mul : T.line, alpha: hop ? 0.9 : 0.5 });
    for (let k = 0; k < 4; k++) g.rect(p.link.x + 12 + k * 24, p.link.y + 48, 14, 10).fill({ color: hop ? T.mul : T.line, alpha: hop ? 0.4 + 0.15 * k : 0.35 });
    // the texts
    c.linkText.text = s ? `PCIe ${PHASE_TEXT[s.phase]}` : 'PCIe';
    c.pcText.text = s ? `pc 0x${(step?.pc ?? s.pc).toString(16).padStart(3, '0')}  ${stepText(t, p.lanes)}` : '';
    c.ctrText.text = s ? `${s.launches} launches   ${s.stats.instructions} instr   ${s.stats.idleLaneSlots} idle lane slots   ${s.stats.conflictCycles} conflict cycles` : '';
  }
}
