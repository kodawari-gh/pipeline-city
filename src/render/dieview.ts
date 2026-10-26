import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '../sim/protocol';
import type { OooSnap } from '../sim/game/pipesnap';
import type { Block, CpuPlan, Link, Pt, Rect } from './cpuplan';
import { cellRects, colorOf, dieNear, LINK_COLOR, offsetPts, LANE_GAP, type DieArt } from './dieart';
import { box, dashed, label, MONO, mix } from './ink';
import type { Theme } from './theme';

// The CPU die in motion (docs/DIE.md): instruction chips in the blocks they are in (per lane, per unit), the out-of-order queues and
// buffers as cells coloured by state, flashes on events (cache miss, flush, retire), pulses along the links. It draws the near layer of
// the die (traces, cell arrays, names; `dieart.ts`) and fades it in by zoom; the far layer (blocks) is baked with the CPU (`cpuArt`).
// A snapshot is a sampled instant, so everything here is a state or an event count since the last snapshot, never a per-cycle stream.

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const BUBBLE_NAMES = ['', 'load', 'data', 'flush', 'struct'];
const CHIP_W = 156, CHIP_H = 78;

function opClass(op: string): 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'sys' {
  if (op === 'mul') return 'mul';
  if (op === 'lw' || op === 'lb' || op === 'lbu') return 'ld';
  if (op === 'sw' || op === 'sb') return 'st';
  if (op === 'jal' || op === 'jalr' || op[0] === 'b') return 'br';
  if (op === 'ecall' || op === 'iret') return 'sys';
  return 'alu';
}

class Chip {
  readonly c = new Container();
  private bg = new Graphics();
  private t1: Text;
  private t2: Text;
  private sig = '';
  stage = 0;
  isBubble = false;
  dying = false;
  x = 0; y = 0; a = 1; s = 1;
  x0 = 0; y0 = 0; a0 = 1; s0 = 1;
  x1 = 0; y1 = 0; a1 = 1; s1 = 1;
  t0 = 0; dur = 0;

  constructor() {
    this.t1 = new Text({ text: '', style: { fontFamily: MONO, fontSize: 28, fontWeight: '700', fill: '#000' }, resolution: 2 });
    this.t2 = new Text({ text: '', style: { fontFamily: MONO, fontSize: 17, fill: '#000' }, resolution: 2 });
    this.t1.anchor.set(0.5); this.t2.anchor.set(0.5);
    this.t1.position.set(0, -10); this.t2.position.set(0, 20);
    this.c.addChild(this.bg, this.t1, this.t2);
  }

  look(T: Theme, o: { bubble: boolean; text: string; sub: string; color: string; stalled: boolean; bad: boolean }) {
    const sig = [o.bubble, o.text, o.sub, o.color, o.stalled, o.bad, T.on].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.bg;
    g.clear();
    const w = CHIP_W, h = CHIP_H;
    if (o.bubble) {
      const pts: Pt[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
      dashed(g, pts, 10, 8);
      g.stroke({ width: 4, color: o.color });
      this.t1.text = o.text; this.t1.style.fill = o.color; this.t1.style.fontSize = 24;
      this.t2.text = '';
      return;
    }
    box(g, -w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 20, { fill: o.color, fa: 0.25 });
    box(g, -w / 2, -h / 2, w, h, 14, { fill: o.bad ? T.bad : o.color });
    if (o.stalled) box(g, -w / 2 - 9, -h / 2 - 9, w + 18, h + 18, 22, { stroke: T.ld, lw: 5 });
    this.t1.text = o.text; this.t1.style.fill = T.on; this.t1.style.fontSize = 28;
    this.t2.text = o.sub; this.t2.style.fill = T.on;
  }

  /** Aim at a new place; keeps the current position as the start of the tween. */
  go(x: number, y: number, a: number, s: number, now: number, dur: number) {
    this.x0 = this.x; this.y0 = this.y; this.a0 = this.a; this.s0 = this.s;
    this.x1 = x; this.y1 = y; this.a1 = a; this.s1 = s;
    this.t0 = now; this.dur = dur;
    if (dur <= 0) this.apply(1);
  }

  apply(u: number) {
    this.x = this.x0 + (this.x1 - this.x0) * u;
    this.y = this.y0 + (this.y1 - this.y0) * u;
    this.a = this.a0 + (this.a1 - this.a0) * u;
    this.s = this.s0 + (this.s1 - this.s0) * u;
    this.c.position.set(this.x, this.y);
    this.c.alpha = this.a;
    this.c.scale.set(this.s);
  }

  tick(now: number): boolean {
    if (this.dur <= 0) return true;
    const u = Math.min(1, (now - this.t0) / this.dur);
    this.apply(ease(u));
    return u >= 1;
  }
}

/** Where a chip sits: the middle of the block, scaled to fit it. */
interface Slot { x: number; y: number; s: number }
const slotOf = (r: Rect): Slot => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 + 8, s: Math.max(0.3, Math.min(1, (r.w - 12) / CHIP_W, (r.h - 22) / CHIP_H)) });

/** The cell text of an out-of-order structure (ROB, scheduler, queues): a pool, one per cell. */
class CellTexts {
  private texts: Text[] = [];
  constructor(private layer: Container) {}
  set(i: number, str: string, r: Rect, color: string) {
    let t = this.texts[i];
    if (!t) {
      t = new Text({ text: '', style: { fontFamily: MONO, fontSize: 20, fontWeight: '700', fill: color }, resolution: 2 });
      t.anchor.set(0.5);
      this.texts[i] = t;
      this.layer.addChild(t);
    }
    t.visible = str !== '';
    if (!str) return;
    t.text = str; t.style.fill = color;
    t.position.set(r.x + r.w / 2, r.y + r.h / 2);
    t.scale.set(Math.min(1, (r.w - 4) / Math.max(1, str.length * 12.5), (r.h - 2) / 24));
  }
  hideFrom(n: number) { for (let i = n; i < this.texts.length; i++) if (this.texts[i]) this.texts[i]!.visible = false; }
  clear() { for (const t of this.texts) t?.destroy(); this.texts = []; }
}

interface Pulse { link: Link; len: number; segs: { a: Pt; b: Pt; at: number; len: number }[]; lines: Pt[][] }

function pulseOf(l: Link): Pulse {
  const lines = Array.from({ length: l.lanes }, (_, k) => offsetPts(l.pts, (k - (l.lanes - 1) / 2) * LANE_GAP));
  const segs: Pulse['segs'] = [];
  let at = 0;
  for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1]!, b = l.pts[i]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, at, len }); at += len;
  }
  return { link: l, len: at, segs, lines };
}

/** The point at distance `d` along line `k` of a pulse. */
function along(p: Pulse, k: number, d: number): Pt {
  const line = p.lines[k]!;
  let rest = Math.max(0, Math.min(p.len, d)) / (p.len || 1);
  // lines are offset copies of the centre line with the same corner order: walk by fraction of each segment
  for (let i = 1; i < line.length; i++) {
    const s = p.segs[i - 1]!, f0 = s.at / (p.len || 1), f1 = (s.at + s.len) / (p.len || 1);
    if (rest <= f1 + 1e-9 || i === line.length - 1) {
      const u = f1 > f0 ? Math.max(0, Math.min(1, (rest - f0) / (f1 - f0))) : 0;
      return [line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * u, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * u];
    }
  }
  return line[line.length - 1]!;
}

export class DieView {
  readonly root = new Container();
  private plan: CpuPlan | null = null;
  private art: DieArt | null = null;
  private tints = new Graphics();
  private cellLive = new Graphics();
  private texts = new Container();
  private pulseG = new Graphics();
  private chipLayer = new Container();
  private chips = new Map<string, Chip>();
  private free: Chip[] = [];
  private dying: Chip[] = [];
  private cellTexts = new Map<string, CellTexts>();
  private byId = new Map<string, Block>();
  private frames = new Map<number, Block>();
  private pulses: Pulse[] = [];
  private lastAt = 0;
  private last: Record<string, number> = {};
  private flash = { miss: -1e9, flush: -1e9, retire: -1e9, issue: -1e9 };
  private running = false;
  private z = 1;
  private liveSig = '';
  T!: Theme;

  constructor() {
    this.root.addChild(this.tints, this.cellLive, this.texts, this.chipLayer, this.pulseG);
  }

  /** Build (or rebuild, on a theme change) the near layer of a plan. */
  setPlan(T: Theme, plan: CpuPlan) {
    this.T = T;
    this.plan = plan;
    for (const c of this.chips.values()) this.release(c);
    this.chips.clear();
    for (const c of this.dying) this.release(c);
    this.dying = [];
    for (const ct of this.cellTexts.values()) ct.clear();
    this.cellTexts.clear();
    this.art?.root.destroy({ children: true });
    this.art = dieNear(T, plan);
    this.root.addChildAt(this.art.root, 0);
    this.byId = new Map(plan.blocks.map((b) => [b.id, b]));
    this.frames = new Map(plan.blocks.filter((b) => b.kind === 'stage' && b.stage !== undefined && !b.core).map((b) => [b.stage!, b]));
    this.pulses = plan.links.filter((l) => l.kind === 'data' || l.kind === 'control' || l.kind === 'mem' || l.kind === 'flush').map(pulseOf);
    this.liveSig = '';
    this.setZoom(this.z);
  }

  /** No CPU in the socket. */
  clear() {
    this.plan = null;
    for (const c of this.chips.values()) this.release(c);
    this.chips.clear();
    for (const c of this.dying) this.release(c);
    this.dying = [];
    this.art?.root.destroy({ children: true });
    this.art = null;
    this.tints.clear(); this.cellLive.clear(); this.pulseG.clear();
  }

  /** Levels of detail: wires from about 0.7, cell arrays from 0.8, the second line of a block from 1.2. */
  setZoom(z: number) {
    this.z = z;
    if (!this.art) return;
    this.art.wires.visible = z >= 0.7;
    this.art.cells.visible = z >= 0.8;
    this.cellLive.visible = z >= 0.8;
    this.texts.visible = z >= 0.8;
    this.art.subs.visible = z >= 1.2;
    this.pulseG.visible = z >= 0.7;
  }

  private take(): Chip {
    const c = this.free.pop() ?? new Chip();
    c.dying = false;
    this.chipLayer.addChild(c.c);
    return c;
  }

  private release(c: Chip) {
    this.chipLayer.removeChild(c.c);
    this.free.push(c);
  }

  /** The block a chip of this stage and lane sits in. */
  private host(stage: number, lane: number): Block | undefined {
    const frame = this.frames.get(stage);
    if (!frame) return undefined;
    const KIND = ['fetch', 'decode', 'alu', 'lsu', 'wb'][stage] ?? 'fetch';
    const in_ = this.plan!.blocks.filter((b) => b.parent === frame.id && b.kind === KIND);
    return in_.find((b) => b.lane === lane) ?? in_[0];
  }

  /** `simple`: skip tweening (fast game speed). */
  update(s: Snapshot | null, simple: boolean, now: number) {
    if (!this.plan) return;
    const T = this.T;
    const gap = now - this.lastAt;
    this.lastAt = now;
    const dur = simple || gap < 350 ? 0 : Math.min(gap * 0.8, 900);
    const c = s?.counters ?? {};
    if ((c.cycles ?? 0) < (this.last.cycles ?? 0)) this.last = {}; // a new attempt
    const rose = (k: string) => (c[k] ?? 0) > (this.last[k] ?? 0);
    if (rose('cacheMisses')) this.flash.miss = now;
    if (rose('flushes')) this.flash.flush = now;
    if (rose('retired')) this.flash.retire = now;
    if (rose('issued')) this.flash.issue = now;
    this.last = { ...c };
    const pipe = s?.pipe ?? null;
    this.running = !!pipe;

    const tg = this.tints;
    tg.clear();
    const seen = new Set<string>();
    if (pipe && pipe.stages.length) {
      const w = pipe.width || 1;
      pipe.stages.forEach((st, i) => {
        const stage = Math.floor(i / w), lane = i % w;
        if (st.kind === 0) return;
        const hb = this.host(stage, lane);
        if (!hb) return;
        const slot = slotOf(hb.rect);
        let key: string, chip: Chip | undefined;
        if (st.kind === 1) {
          key = 'i' + st.id;
          chip = this.chips.get(key);
          const cls = opClass(st.op);
          const color = cls === 'sys' ? T.mute : T[cls];
          const sub = st.text.slice(st.op.length + 1).slice(0, 17);
          if (!chip) {
            chip = this.take();
            this.chips.set(key, chip);
            chip.isBubble = false;
            chip.x = slot.x - 60; chip.y = slot.y; chip.a = 0; chip.s = slot.s * 0.8;
            chip.c.position.set(chip.x, chip.y);
          }
          chip.look(T, { bubble: false, text: st.op.toUpperCase(), sub, color, stalled: st.stalled, bad: false });
          box(tg, hb.rect.x, hb.rect.y, hb.rect.w, hb.rect.h, 3, { fill: color, fa: 0.1 });
          if (st.stalled) box(tg, hb.rect.x - 3, hb.rect.y - 3, hb.rect.w + 6, hb.rect.h + 6, 5, { stroke: T.ld, lw: 3, sa: 0.9 });
        } else {
          key = 'b' + i;
          chip = this.chips.get(key);
          const flush = st.cause === 3;
          if (!chip) {
            chip = this.take();
            this.chips.set(key, chip);
            chip.isBubble = true;
            chip.x = slot.x; chip.y = slot.y; chip.a = 0; chip.s = slot.s;
            chip.c.position.set(chip.x, chip.y);
          }
          chip.look(T, { bubble: true, text: BUBBLE_NAMES[st.cause] || 'bubble', sub: '', color: flush ? T.bad : T.ld, stalled: false, bad: false });
          if (flush) box(tg, hb.rect.x, hb.rect.y, hb.rect.w, hb.rect.h, 3, { fill: T.bad, fa: 0.16 });
        }
        chip.stage = stage;
        chip.go(slot.x, slot.y, 1, slot.s, now, chip.isBubble ? 0 : dur);
        seen.add(key);
      });
    }
    if (pipe?.ooo) this.oooChips(pipe.ooo, seen, now);
    // chips that left the pipeline: retired (from WB) slide out, others were squashed
    for (const [key, chip] of this.chips) {
      if (seen.has(key)) continue;
      this.chips.delete(key);
      if (chip.isBubble || chip.stage < 0 || dur <= 0) { this.release(chip); continue; }
      const retired = chip.stage >= 3;
      chip.dying = true;
      chip.look(T, { bubble: false, text: '', sub: '', color: retired ? T.st : T.bad, stalled: false, bad: !retired });
      if (retired) chip.go(chip.x + 60, chip.y, 0, chip.s * 0.9, now, dur);
      else chip.go(chip.x, chip.y + 40, 0, chip.s * 0.45, now, dur);
      this.dying.push(chip);
    }
    this.cells(pipe?.ooo ?? null);
  }

  /** Chips of the out-of-order engine: decode lanes and execution units (no tween, a slot keeps its chip). */
  private oooChips(o: OooSnap, seen: Set<string>, now: number) {
    const T = this.T, p = this.plan!;
    const put = (key: string, b: Block | undefined, op: string, sub: string) => {
      if (!b || !op) return;
      const slot = slotOf(b.rect);
      let chip = this.chips.get(key);
      if (!chip) { chip = this.take(); this.chips.set(key, chip); chip.isBubble = false; chip.stage = -1; }
      const cls = opClass(op);
      chip.look(T, { bubble: false, text: op.toUpperCase(), sub, color: cls === 'sys' ? T.mute : T[cls], stalled: false, bad: false });
      chip.x = slot.x; chip.y = slot.y; chip.a = 1; chip.s = slot.s; chip.dur = 0;
      chip.c.position.set(slot.x, slot.y); chip.c.alpha = 1; chip.c.scale.set(slot.s);
      seen.add(key);
    };
    o.decode.forEach((op, lane) => put('d' + lane, p.blocks.find((b) => b.kind === 'decode' && (b.lane ?? 0) === lane), op, ''));
    const UNITS = ['ALU0', 'ALU1', 'MUL', 'LSU'];
    o.units.forEach((u, k) => put('u' + k, p.blocks.find((b) => b.unit === UNITS[k]), u.op, u.total > 1 ? `${u.total - u.left}/${u.total}` : ''));
    void now;
  }

  /** The reorder buffer, scheduler and fetch queue as cells coloured by state, with their mnemonics. */
  private cells(o: OooSnap | null) {
    const T = this.T, g = this.cellLive;
    const sig = o ? JSON.stringify([o.fetchQ, o.rob, o.robHead, o.robCount, o.sched, o.stall]) : '';
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    g.clear();
    const used = new Set<string>();
    const layer = (id: string) => {
      used.add(id);
      let ct = this.cellTexts.get(id);
      if (!ct) { ct = new CellTexts(this.texts); this.cellTexts.set(id, ct); }
      return ct;
    };
    if (o) {
      const rob = this.plan!.blocks.find((b) => b.kind === 'rob'), sched = this.plan!.blocks.find((b) => b.kind === 'sched'), fq = this.plan!.blocks.find((b) => b.id === 'fq');
      if (rob) {
        const cs = cellRects(rob), ct = layer(rob.id), n = o.rob.length;
        const COL = [T.mute, T.ld, T.alu, T.st];
        o.rob.forEach((e, k) => {
          const r = cs[k];
          if (!r) return;
          // logical position: the ring from the head; empty entries are the free space
          const live = ((k - o.robHead + n) % n) < o.robCount;
          if (live) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: COL[e.state] ?? T.mute, fa: 0.85 });
          if (k === o.robHead && o.robCount > 0) box(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 2, { stroke: T.ink, lw: 2 });
          if (k === (o.robHead + o.robCount) % n) box(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 2, { stroke: T.mute, lw: 1.2, sa: 0.8 });
          ct.set(k, live ? e.op : '', r, T.on);
        });
      }
      if (sched) {
        const cs = cellRects(sched), ct = layer(sched.id);
        const COL = [T.alu, T.ld, T.ld, T.mul, T.br];
        o.sched.forEach((e, k) => {
          const r = cs[k];
          if (!r) return;
          if (e.op) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: COL[e.state] ?? T.alu, fa: 0.85 });
          ct.set(k, e.op, r, T.on);
        });
      }
      if (fq) {
        const cs = cellRects(fq), ct = layer(fq.id);
        cs.forEach((r, k) => {
          const op = o.fetchQ[k] ?? '';
          if (op) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: T.alu, fa: 0.8 });
          ct.set(k, op, r, T.on);
        });
      }
    }
    for (const [id, ct] of this.cellTexts) if (!used.has(id)) ct.hideFrom(0);
  }

  frame(now: number) {
    for (const c of this.chips.values()) c.tick(now);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i]!.tick(now)) { this.release(this.dying[i]!); this.dying.splice(i, 1); }
    }
    if (!this.plan) return;
    const T = this.T, F = this.flash;
    // flashes: the D-cache on a miss, the register file on a retire, the result bus on an issue, the fetch frame on a flush
    const fl = (t: number, ms: number) => Math.max(0, 1 - (now - t) / ms);
    const g = this.pulseG;
    g.clear();
    const hot = (b: Block | undefined, k: number, color: string, w = 4) => { if (b && k > 0) box(g, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: color, fa: k * 0.5, stroke: color, lw: w, sa: k }); };
    hot(this.plan.blocks.find((b) => b.kind === 'dcache'), fl(F.miss, 900), T.ld);
    hot(this.plan.blocks.find((b) => b.kind === 'regfile'), fl(F.retire, 260), T.st, 3);
    hot(this.plan.blocks.find((b) => b.kind === 'resultbus'), fl(F.issue, 260), T.mul, 3);
    if (fl(F.flush, 700) > 0) hot(this.frames.get(0), fl(F.flush, 700), T.bad, 3);
    if (this.z < 0.7) return;
    // pulses: dots running along the links that carry traffic right now
    const t = now / 1000;
    for (const p of this.pulses) {
      const kind = p.link.kind;
      const on = kind === 'mem' ? fl(F.miss, 900) > 0 : kind === 'flush' ? fl(F.flush, 700) > 0 : this.running;
      if (!on || p.len < 8) continue;
      const color = colorOf(T, LINK_COLOR[kind]);
      const speed = kind === 'flush' ? 500 : 160, n = Math.max(1, Math.round(p.len / 140));
      for (let k = 0; k < p.link.lanes; k++) {
        for (let i = 0; i < n; i++) {
          const d = (((t * speed + (i * p.len) / n + k * 23) % p.len) + p.len) % p.len;
          const q = along(p, k, d);
          g.circle(q[0], q[1], 2.2);
        }
      }
      g.fill({ color: mix(color, T.ink, 0.35), alpha: 0.95 });
    }
  }
}

