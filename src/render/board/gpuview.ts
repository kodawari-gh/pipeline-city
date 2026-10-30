import { Container, Graphics, type Text } from 'pixi.js';
import type { DeviceSnap, GpuSnap } from '../../sim/game/types';
import { scrubCursor, scrubRange, scrubShown, scrubTarget } from '../../game/scrub';
import type { GpuStepKind } from '../../sim/ref/gpuref';
import { box, label, mix } from '../ink';
import type { Theme } from '../theme';
import { EdgeFan } from '../room/case';
import { gpuCover } from './accelart';
import type { Pt } from '../die/cpuplan';
import { gpuFar, gpuNear } from '../gpu/gpuart';
import { gpuGlyphArea, gpuGlyphLive } from '../gpu/gpuglyph';
import { gpuRoute, launchRoute, type Hop } from '../gpu/gpuroute';
import { CellTexts, drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../die/diepulse';
import { CYCLES_PER_SEC } from '../die/diemotion';
import { gpuPlan, type GpuPlan } from './gpulayout';
import type { Rect } from './layout';
import { bankState, conflicted, GpuPlayer, stepText, type GpuTick } from '../gpu/gpuplayer';

// The graphics cards of the board, alive (docs/ACCEL.md "Art as built"). Along the top edge the fans spin, at a speed that follows the card's
// temperature and load. Zoomed in, the shroud fades away like an x-ray and the die shows through: the lanes lit by the execution mask (the idle
// ones dark: divergence), the vector registers, the memory banks with the addresses queued on each (a conflict serves them one round at a time),
// the mask stack, the program counter and the instruction on show. The picture is a slow-motion replay of the snapshot's last instructions
// (gpuplayer.ts), like the die view's, and it moves the way the die's does (die/diepulse.ts): an instruction is packets running along the die's own
// wires, in its colour, the wires stay lit behind it, the block it has reached glows, the program counter, the word fetched and the decoder show what
// they hold. Everything below the fans is drawn only when something changes.

// Zoom levels (board scale; the card is large, up to 3800 units, so they sit below the die's): the cover fades 0.16 -> 0.28, the traces and cells
// are there with it, the names come at 0.3, the second lines and the counters at 0.6.
const FADE_FROM = 0.16, FADE_TO = 0.28, TEXT_Z = 0.3, DETAIL_Z = 0.6;
/** Fan speed in turns per second: idle (just powered, cold), and at the card's throttle point. */
const FAN_IDLE = 0.5, FAN_FULL = 3.5;
/** Seen edge-on a turn is some blade spacings sliding past (the case fans do the same, a little slower). */
const BLADES_PER_TURN = 1.6;
/** Milliseconds one card cycle lasts in the replay, and how long an instruction takes to settle into a block's symbol. */
const CYCLE_MS = 1000 / CYCLES_PER_SEC, WIPE_MS = 320;

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

/** A packet in flight toward a block: the block glows while it arrives. */
interface Flight { to: string; t0: number; dur: number; color: string }

interface CardView {
  slot: string;
  plan: GpuPlan;
  root: Container;
  /** The die's insides: a still plate, the live layers over it, and the texts. */
  inner: Container;
  dyn: Graphics;
  /** Blocks glowing while an instruction is in them, the symbols the instruction lights, their texts, the wires lit behind a packet, the packets. */
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  cellTexts: Map<string, CellTexts>;
  packets: Packet[];
  trails: Map<string, Trail>;
  flights: Flight[];
  glow: Map<string, { v: number; color: string }>;
  /** The instruction last sent along the wires on each SM (-1: the launch), and when each got into its block (wall ms). */
  sent: Map<number, string>;
  born: Map<string, number>;
  /** The shape of the animation last drawn, so a still card costs nothing. */
  animating: boolean;
  cover: Graphics;
  fans: { fan: EdgeFan; turns: number }[];
  wires: Container;
  cells: Container;
  names: Container;
  subs: Container;
  linkText: Text;
  ctrText: Text;
  memText: Text;
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
  /** The replay's own clock (ms): packets and glows run on it. */
  private now = 0;

  constructor() {
    this.root.visible = false;
  }

  /** The graphics cards of a new scene (board space origin of each card's PCB). */
  setScene(T: Theme, scene: GpuCardScene[]): void {
    this.T = T;
    for (const c of this.cards) for (const ct of c.cellTexts.values()) ct.clear();
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.cards = scene.map((c) => this.build(T, c));
    this.root.visible = this.cards.length > 0;
  }

  private build(T: Theme, c: GpuCardScene): CardView {
    const plan = gpuPlan(c.visual), root = new Container(), inner = new Container(), plate = new Graphics(), dyn = new Graphics();
    root.position.set(c.origin.x, c.origin.y);
    // the die at the card's offset: its floor and blocks drawn once, then the traces, cells and names the zoom brings in, then the live layers over them
    const art = new Container();
    art.position.set(plan.origin.x, plan.origin.y);
    gpuFar(plate, T, plan.die);
    const near = gpuNear(T, plan.die);
    art.addChild(plate, near.wires, near.cells);
    const glowG = new Graphics(), litG = new Graphics(), texts = new Container(), trailG = new Graphics(), packetG = new Graphics();
    const live = new Container();
    live.addChild(glowG, dyn, litG, texts, trailG, packetG);
    inner.addChild(art, live);
    const names = new Container(), subs = new Container();
    names.position.set(plan.origin.x, plan.origin.y);
    subs.position.set(plan.origin.x, plan.origin.y);
    names.addChild(near.names);
    subs.addChild(near.subs);
    inner.addChild(names, subs);
    const low = (r: Rect, lines: number, size: number): number => r.y + r.h - 8 - lines * (size + 3);
    const linkText = label('PCIe', plan.link.x + 7, low(plan.link, 1, 12), 12, T.mute, { head: true, a: 0.95, minPx: 4 });
    const ctrText = label('', plan.mem.x + 7, low(plan.mem, 4, 10), 10, T.mute, { a: 0.9, minPx: 4 });
    const memText = label('', plan.mem.x + plan.mem.w - 7, plan.mem.y + 12, 10, T.ink, { head: true, a: 0.95, anchor: [1, 0.5], minPx: 4 });
    inner.addChild(linkText, ctrText, memText);

    const cover = gpuCover(new Graphics(), T, plan);
    const fans = plan.fans.map((f) => ({ fan: new EdgeFan(f, T), turns: 0 })); // the case fans' edge-on look, blades sliding along the module
    root.addChild(inner, cover, ...fans.map((f) => f.fan));
    this.root.addChild(root);
    return {
      slot: c.slot, plan, root, inner, dyn, glowG, litG, texts, trailG, packetG, cellTexts: new Map(), packets: [], trails: new Map(), flights: [], glow: new Map(), sent: new Map(), born: new Map(), animating: false,
      cover, fans, wires: near.wires, cells: near.cells, names, subs, linkText, ctrText, memText, player: new GpuPlayer(),
      tick: { step: null, index: -1, length: 0, progress: 0, round: 0, playing: false, cycle: 0, sms: [], warps: [] }, snap: undefined, tempC: 25, throttled: false, sig: '',
    };
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
    this.now += dt * 1000;
    const T = this.T, fade = smooth(FADE_FROM, FADE_TO, this.zoom);
    for (const c of this.cards) {
      // the fans: always on, whatever the zoom
      const target = c.snap ? fanTurns(c.tempC, c.snap.phase !== 'idle', c.throttled) : 0;
      for (const f of c.fans) {
        f.turns += (target - f.turns) * Math.min(1, dt * 1.2);
        f.fan.spin(f.turns * dt * BLADES_PER_TURN, Math.min(1, f.turns / FAN_FULL));
      }
      // a paused game can be scrubbed: the Trace panel names a cycle of this card's last instructions and the card shows the machine at it
      const mine = scrubTarget.peek() === `gpu:${c.slot}`, cur = mine ? scrubCursor.peek() : null;
      if (cur !== null) c.tick = c.player.seek(0, cur);
      else { if (c.player.scrubbed) c.player.resume(); c.tick = c.player.advance(dt); }
      if (mine) {
        const hi = Math.floor(c.player.span), old = scrubRange.peek(), sh = Math.round(c.player.cycle);
        if (!old || old.lo !== 0 || old.hi !== hi) scrubRange.value = hi > 0 ? { lo: 0, hi } : null;
        if (sh !== scrubShown.peek()) scrubShown.value = sh;
      }
      c.cover.alpha = 1 - fade;
      c.inner.alpha = fade;
      c.inner.visible = fade > 0.02;
      if (!c.inner.visible) continue;
      const showText = this.zoom >= TEXT_Z, showDetail = this.zoom >= DETAIL_Z;
      c.names.visible = c.linkText.visible = c.texts.visible = showText;
      c.subs.visible = c.ctrText.visible = c.memText.visible = showDetail;
      this.animate(T, c, cur !== null);
      const t = c.tick, s = c.snap;
      const sig = `${t.index}|${t.round}|${Math.round(t.progress * 6)}|${t.step?.mask ?? -1}|${s?.phase ?? '-'}|${s?.stack.length ?? 0}|${s ? s.stats.cycles : -1}|${s?.launches ?? 0}|${showText ? 1 : 0}${showDetail ? 1 : 0}`;
      if (sig === c.sig) continue;
      c.sig = sig;
      this.draw(T, c);
    }
  }

  /** A hop of a route as a link in card coordinates, for the packets. */
  private hopLink(c: CardView, h: Hop) {
    const o = c.plan.origin;
    return { id: h.link.id, lanes: h.link.lanes, pts: h.link.pts.map((p): Pt => [p[0] + o.x, p[1] + o.y]) };
  }

  /** Send an instruction along its route: a packet on each wire in turn, in its colour. One card cycle a wire on the engines that pipeline, the instruction's own length shared out on the unit. */
  private fly(c: CardView, route: Hop[], color: string, cost: number): void {
    const n = route.length;
    if (n === 0) return;
    const pipelined = c.plan.die.input.kind !== 'simd', sp = pipelined ? CYCLE_MS * 0.9 : Math.max(CYCLE_MS * 0.9, (Math.max(1, cost) * CYCLE_MS) / n), dur = Math.max(sp * 1.1, 180);
    route.forEach((h, i) => {
      const link = this.hopLink(c, h), t0 = this.now + i * sp, { packet, trail } = packetOn(link, h.reverse, t0, dur, color);
      c.packets.push(packet);
      c.trails.set(link.id, trail);
      c.flights.push({ to: h.reverse ? h.link.from : h.link.to, t0, dur, color });
    });
  }

  /** The moving parts: packets on the wires, the glow of the blocks they reach, what the symbols of the front end hold. */
  private animate(T: Theme, c: CardView, frozen: boolean): void {
    const now = this.now, t = c.tick, s = c.snap, plan = c.plan;
    if (!s) { c.sent.clear(); c.packets = []; c.trails.clear(); c.flights = []; }
    else if (frozen) {
      // held on a cycle: nothing travels, the path the instruction on show took stays lit
      c.packets = []; c.flights = []; c.sent.clear();
      for (const sm of t.sms) {
        if (!sm.step) continue;
        for (const h of gpuRoute(plan.die, sm.step, sm.sm)) { const link = this.hopLink(c, h); const { trail } = packetOn(link, h.reverse, now, 1, kindColor(T, sm.step.kind)); c.trails.set(link.id, { ...trail, t0: now - 250 }); }
      }
    } else {
      if (s.phase === 'in' && c.sent.get(-1) !== `in:${s.launches}`) { c.sent.set(-1, `in:${s.launches}`); this.fly(c, launchRoute(plan.die), T.br, 4); }
      for (const sm of t.sms) {
        const key = `${s.launches}:${sm.index}`;
        if (c.sent.get(sm.sm) === key) continue;
        c.sent.set(sm.sm, key);
        if (sm.step) this.fly(c, gpuRoute(plan.die, sm.step, sm.sm), kindColor(T, sm.step.kind), sm.step.cost);
      }
    }
    c.flights = c.flights.filter((f) => f.t0 + f.dur > now);

    // blocks glow while a packet is arriving in them
    const want = new Map<string, string>();
    for (const f of c.flights) if (now >= f.t0) want.set(f.to, f.color);
    for (const [id, color] of want) c.glow.set(id, { v: Math.min(1, (c.glow.get(id)?.v ?? 0) + 0.25), color });
    for (const [id, g] of c.glow) if (!want.has(id)) { g.v *= 0.9; if (g.v < 0.02) c.glow.delete(id); }
    const byId = new Map(plan.blocks.map((b) => [b.id, b]));

    // the symbols of the front end: the program counter's digits, the word fetched, the decoded word and the control lines it raises
    const wall = performance.now(), used = new Set<string>(), born = new Map<string, number>();
    const lit: { rect: Rect; color: string; a: number }[] = [];
    for (const b of plan.blocks) {
      if (b.kind !== 'pc' && b.kind !== 'fetch' && b.kind !== 'decode') continue;
      const a = gpuGlyphArea({ kind: b.kind, rect: b.rect });
      const sm = t.sms.find((x) => x.sm === (b.sm ?? 0));
      if (!a || !sm?.step || !s) continue;
      const k = `${b.id}:${s.launches}:${sm.index}`;
      born.set(k, c.born.get(k) ?? wall);
      const u = Math.min(1, (wall - born.get(k)!) / WIPE_MS), prog = u * u * (3 - 2 * u);
      const live = gpuGlyphLive({ id: b.id, kind: b.kind, label: b.kind === 'fetch' ? 'FETCH' : b.kind.toUpperCase(), rect: b.rect }, a, sm.step, prog);
      for (const l of live.lit) lit.push({ rect: l.rect, color: T[l.color], a: l.a });
      let ct = c.cellTexts.get(b.id);
      if (!ct) { ct = new CellTexts(c.texts); c.cellTexts.set(b.id, ct); }
      used.add(b.id);
      live.texts.forEach((x, n) => ct!.set(n, x.top, x.bottom, x.rect, T.on));
      ct.hideFrom(live.texts.length);
    }
    c.born = born;
    for (const [id, ct] of c.cellTexts) if (!used.has(id)) ct.hideFrom(0);

    const busy = c.packets.length > 0 || c.glow.size > 0 || c.trails.size > 0 || lit.length > 0 || c.animating;
    if (!busy) return;
    c.animating = c.packets.length > 0 || c.glow.size > 0 || c.trails.size > 0;
    const gg = c.glowG;
    gg.clear();
    for (const [id, g] of c.glow) {
      const b = byId.get(id);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: g.color, fa: 0.16 * g.v, stroke: g.color, lw: 2.5, sa: 0.55 * g.v });
    }
    c.litG.clear();
    for (const l of lit) box(c.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: l.color, fa: l.a });
    drawTrails(c.trailG, c.trails, now, 1);
    c.packets = drawPackets(c.packetG, c.packets, now, 1, T.ink);
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
    if (mem) g.rect(p.mem.x, p.mem.y, p.mem.w, p.mem.h).fill({ color: bad ? T.bad : col, alpha: 0.12 * pulse }); // the card memory answers
    // the warps: a chip each, lit by the instruction it holds (its mask as a bar) and outlined while it is the one issuing
    for (const w of p.warpCells) {
      const wt = t.warps.find((x) => x.sm === w.sm && x.warp === w.warp), r = w.rect;
      if (!wt) { g.rect(r.x, r.y, r.w, r.h).fill({ color: '#000000', alpha: 0.3 }); continue; }
      let n = 0;
      for (let k = 0; k < p.perSm; k++) if ((wt.mask >>> k) & 1) n++;
      g.rect(r.x + 2, r.y + r.h - 6, (r.w - 4) * (n / p.perSm), 4).fill({ color: T.alu, alpha: 0.85 });
      if (wt.busy) g.rect(r.x, r.y, r.w, r.h).stroke({ width: 2, color: wt.index === t.index ? col : T.mul, alpha: 0.9 });
    }
    // the PCIe link: lit while a launch crosses it
    const hop = s?.phase === 'in' || s?.phase === 'out';
    if (hop) g.rect(p.link.x, p.link.y, p.link.w, p.link.h).fill({ color: T.mul, alpha: 0.18 });
    // the texts
    c.linkText.text = s ? `PCIe ${PHASE_TEXT[s.phase]}` : 'PCIe';
    const ms = smStep(0), accesses = ms?.banks ? ms.banks.reduce((n, v) => n + v, 0) : 0;
    c.memText.text = s && mem && ms ? `${ms.name} · ${accesses} access${accesses === 1 ? '' : 'es'}${bad ? ` · ${ms.cost} cycles` : ''}` : '';
    c.ctrText.text = s ? `${s.launches} launches
${s.stats.instructions} instr
${s.stats.idleLaneSlots} idle lane slots
${s.stats.conflictCycles} conflict cycles` : '';
    void stepText;
  }
}
