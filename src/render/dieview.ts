import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '../sim/protocol';
import type { Block, CpuPlan, Pt, Rect } from './cpuplan';
import { cellRects, dieNear, offsetPts, LANE_GAP, type DieArt } from './dieart';
import { CYCLES_PER_SEC, opClass, packetsFor, Player, pointAt, type ChipState, type PacketPlan } from './diemotion';
import { box, MONO, mix } from './ink';
import type { Theme } from './theme';

// The CPU die in motion (docs/DIE.md "Motion"). It draws the near layer of the die (traces, cell arrays, names; `dieart.ts`) faded in by
// zoom, and plays back the engine's recent cycles in slow motion (`diemotion.ts`): instruction chips glide from block to block along the
// die's own wires, packets of data run along the links they use (operands from the registers, a load asking the cache and the data coming
// back, a result written back), the block an instruction is in glows while it is there, the clock beats once per cycle. The out-of-order
// structures (fetch queue, scheduler, reorder buffer) are cells that change colour as instructions move through them.

const CHIP_W = 156, CHIP_H = 78;
const CYCLE_MS = 1000 / CYCLES_PER_SEC;

class Chip {
  readonly c = new Container();
  private bg = new Graphics();
  private t1: Text;
  private t2: Text;
  private sig = '';

  constructor() {
    this.t1 = new Text({ text: '', style: { fontFamily: MONO, fontSize: 28, fontWeight: '700', fill: '#000' }, resolution: 2 });
    this.t2 = new Text({ text: '', style: { fontFamily: MONO, fontSize: 17, fill: '#000' }, resolution: 2 });
    this.t1.anchor.set(0.5); this.t2.anchor.set(0.5);
    this.t1.position.set(0, -10); this.t2.position.set(0, 20);
    this.c.addChild(this.bg, this.t1, this.t2);
  }

  look(T: Theme, o: { text: string; sub: string; color: string; stalled: boolean; bad: boolean }) {
    const sig = [o.text, o.sub, o.color, o.stalled, o.bad, T.on].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.bg;
    g.clear();
    const w = CHIP_W, h = CHIP_H;
    box(g, -w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 20, { fill: o.bad ? T.bad : o.color, fa: 0.25 });
    box(g, -w / 2, -h / 2, w, h, 14, { fill: o.bad ? T.bad : o.color });
    if (o.stalled) box(g, -w / 2 - 9, -h / 2 - 9, w + 18, h + 18, 22, { stroke: T.ld, lw: 5 });
    this.t1.text = o.text; this.t1.style.fill = T.on; this.t1.style.fontSize = 28;
    this.t2.text = o.sub; this.t2.style.fill = T.on;
  }
}

/** The scale a chip has in a block: it fits inside it. */
const fitOf = (r: Rect) => Math.max(0.3, Math.min(1, (r.w - 12) / CHIP_W, (r.h - 22) / CHIP_H));

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

/** A packet of data running along a link. */
interface Packet { lines: Pt[][]; len: number; t0: number; dur: number; color: string }

const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

export class DieView {
  readonly root = new Container();
  private plan: CpuPlan | null = null;
  private art: DieArt | null = null;
  private glowG = new Graphics();
  private cellLive = new Graphics();
  private texts = new Container();
  private packetG = new Graphics();
  private chipLayer = new Container();
  private chips = new Map<string, Chip>();
  private free: Chip[] = [];
  private cellTexts = new Map<string, CellTexts>();
  private player: Player | null = null;
  private byId = new Map<string, Block>();
  private packets: Packet[] = [];
  private glow = new Map<string, { v: number; color: string }>();
  private flash = { miss: -1e9, retire: -1e9, result: -1e9, flush: -1e9, clock: -1e9 };
  private lastCounters = -1;
  private z = 1;
  private cellSig = '';
  T!: Theme;

  constructor() {
    this.root.addChild(this.glowG, this.cellLive, this.texts, this.packetG, this.chipLayer);
  }

  /** Build (or rebuild, on a theme change) the near layer of a plan. */
  setPlan(T: Theme, plan: CpuPlan) {
    this.T = T;
    this.plan = plan;
    this.dropChips();
    for (const ct of this.cellTexts.values()) ct.clear();
    this.cellTexts.clear();
    this.art?.root.destroy({ children: true });
    this.art = dieNear(T, plan);
    this.root.addChildAt(this.art.root, 0);
    this.byId = new Map(plan.blocks.map((b) => [b.id, b]));
    this.player = new Player(plan);
    this.packets = [];
    this.glow.clear();
    this.cellSig = '';
    this.setZoom(this.z);
  }

  /** No CPU in the socket. */
  clear() {
    this.plan = null;
    this.player = null;
    this.dropChips();
    this.art?.root.destroy({ children: true });
    this.art = null;
    this.glowG.clear(); this.cellLive.clear(); this.packetG.clear();
    this.packets = [];
  }

  private dropChips() {
    for (const c of this.chips.values()) this.release(c);
    this.chips.clear();
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
    this.packetG.visible = z >= 0.6;
  }

  private take(): Chip {
    const c = this.free.pop() ?? new Chip();
    this.chipLayer.addChild(c.c);
    return c;
  }

  private release(c: Chip) {
    this.chipLayer.removeChild(c.c);
    this.free.push(c);
  }

  /** A new snapshot: its trace joins the replay; nothing is drawn here (frame() draws). */
  update(s: Snapshot | null, _simple: boolean, _now: number) {
    if (!this.plan || !this.player) return;
    const pipe = s?.pipe ?? null;
    if (!pipe || !pipe.trace) {
      // no machine running: the replay stops and the chips go
      if (this.lastCounters !== 0) { this.player.reset(); this.dropChips(); this.cellSig = ''; this.lastCounters = 0; }
      return;
    }
    this.lastCounters = 1;
    this.player.push(pipe.trace);
  }

  private send(plan: CpuPlan, pk: PacketPlan[], now: number) {
    const T = this.T;
    for (const p of pk) {
      const pts = p.reverse ? [...p.link.pts].reverse() : p.link.pts;
      const lines = Array.from({ length: p.link.lanes }, (_, k) => offsetPts(pts, (k - (p.link.lanes - 1) / 2) * LANE_GAP));
      const color = p.color === 'bad' ? T.bad : T[p.color];
      this.packets.push({ lines, len: lengthOf(pts), t0: now + p.delay * CYCLE_MS, dur: CYCLE_MS * 1.1, color });
    }
    void plan;
  }

  /** The chip of a state, placed and looked. */
  private place(st: ChipState, seen: Set<string>) {
    const T = this.T;
    let chip = this.chips.get(st.key);
    if (!chip) { chip = this.take(); this.chips.set(st.key, chip); }
    const cls = opClass(st.op);
    chip.look(T, { text: st.op.toUpperCase(), sub: st.text.slice(st.op.length + 1).slice(0, 17), color: cls === 'sys' ? T.mute : T[cls], stalled: st.stalled, bad: st.flushed });
    const host = this.byId.get(st.host);
    const fit = host ? fitOf(host.rect) : 0.6;
    chip.c.position.set(st.x, st.y + 6);
    chip.c.scale.set(st.scale * fit);
    chip.c.alpha = st.alpha;
    seen.add(st.key);
  }

  /** Draw one frame at game time `now` (ms). */
  frame(now: number) {
    const plan = this.plan, player = this.player;
    if (!plan || !player) return;
    const T = this.T;
    const fr = player.update(now);

    // beats: packets on the wires, flashes
    for (const ev of fr.beats) {
      this.send(plan, packetsFor(plan, ev), now);
      if (ev.to === 'M' && ev.miss) this.flash.miss = now;
      if (ev.to === 'W' || ev.to === 'C') this.flash.retire = now;
      if (ev.to === 'R') this.flash.result = now;
      if (ev.to === 'x') this.flash.flush = now;
    }
    if (fr.tick) {
      this.flash.clock = now;
      this.send(plan, [clockPacket(plan)].filter((x): x is PacketPlan => !!x), now);
    }

    // chips
    const seen = new Set<string>();
    for (const c of fr.fading) this.place(c, seen);
    for (const c of fr.chips) this.place(c, seen);
    for (const [key, chip] of this.chips) if (!seen.has(key)) { this.chips.delete(key); this.release(chip); }

    // blocks glow while an instruction is in them
    const want = new Map<string, string>();
    for (const c of fr.chips) {
      if (c.alpha < 0.5) continue;
      const cls = opClass(c.op);
      want.set(c.host, c.flushed ? T.bad : cls === 'sys' ? T.mute : T[cls]);
    }
    for (const [id, color] of want) this.glow.set(id, { v: Math.min(1, (this.glow.get(id)?.v ?? 0) + 0.2), color });
    for (const [id, g] of this.glow) if (!want.has(id)) { g.v *= 0.9; if (g.v < 0.02) this.glow.delete(id); }
    const gg = this.glowG;
    gg.clear();
    for (const [id, g] of this.glow) {
      const b = this.byId.get(id);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: g.color, fa: 0.16 * g.v, stroke: g.color, lw: 2.5, sa: 0.55 * g.v });
    }
    // event flashes
    const fl = (t: number, ms: number) => Math.max(0, 1 - (now - t) / ms);
    const hot = (b: Block | undefined, k: number, color: string, w = 4) => { if (b && k > 0) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: color, fa: k * 0.4, stroke: color, lw: w, sa: k }); };
    hot(plan.blocks.find((b) => b.kind === 'dcache'), fl(this.flash.miss, 1400), T.ld);
    hot(plan.blocks.find((b) => b.kind === 'regfile'), fl(this.flash.retire, 500), T.st, 3);
    hot(plan.blocks.find((b) => b.kind === 'resultbus'), fl(this.flash.result, 450), T.mul, 3);
    hot(plan.blocks.find((b) => b.kind === 'clock'), fl(this.flash.clock, CYCLE_MS * 0.9) * 0.9, T.mute, 2);
    if (fl(this.flash.flush, 900) > 0) hot(plan.blocks.find((b) => b.kind === 'fetch'), fl(this.flash.flush, 900), T.bad, 3);

    this.cells(player);
    this.drawPackets(now);
  }

  /** Packets: a bright head with a short tail running along each line of the bundle. */
  private drawPackets(now: number) {
    const g = this.packetG;
    g.clear();
    this.packets = this.packets.filter((p) => now < p.t0 + p.dur);
    if (this.z < 0.6) return;
    const T = this.T;
    for (const p of this.packets) {
      const u = (now - p.t0) / p.dur;
      if (u < 0 || p.len < 2) continue;
      const e = u * u * (3 - 2 * u);
      const fade = Math.min(1, u * 8, (1 - u) * 5 + 0.2);
      for (const line of p.lines) {
        for (let i = 0; i < 4; i++) {
          const q = pointAt(line, Math.max(0, e - i * 0.03));
          g.circle(q[0], q[1], 3.4 - i * 0.6).fill({ color: i === 0 ? mix(p.color, T.ink, 0.45) : p.color, alpha: fade * (1 - i * 0.22) });
        }
      }
    }
  }

  /** The out-of-order structures as cells: the fetch queue, the scheduler and the reorder buffer, from the stage of each instruction in the replay. */
  private cells(player: Player) {
    const plan = this.plan!, T = this.T, g = this.cellLive;
    if (plan.arch !== 'ooo') { if (this.cellSig !== '-') { g.clear(); for (const ct of this.cellTexts.values()) ct.hideFrom(0); this.cellSig = '-'; } return; }
    const rows = player.now();
    const sig = rows.map((r) => r.id + r.ch).join(',');
    if (sig === this.cellSig) return;
    this.cellSig = sig;
    g.clear();
    const used = new Set<string>();
    const texts = (id: string) => {
      used.add(id);
      let ct = this.cellTexts.get(id);
      if (!ct) { ct = new CellTexts(this.texts); this.cellTexts.set(id, ct); }
      return ct;
    };
    const fq = plan.blocks.find((b) => b.id === 'fq'), sched = plan.blocks.find((b) => b.kind === 'sched'), rob = plan.blocks.find((b) => b.kind === 'rob');
    const fill = (b: Block | undefined, items: { op: string; color: string }[]) => {
      if (!b) return;
      const cs = cellRects(b), ct = texts(b.id);
      cs.forEach((r, k) => {
        const it = items[k];
        if (it) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: it.color, fa: 0.85 });
        ct.set(k, it?.op ?? '', r, T.on);
      });
    };
    fill(fq, rows.filter((r) => r.ch === 'F').map((r) => ({ op: r.op, color: T.alu })));
    fill(sched, rows.filter((r) => r.ch === 'S').map((r) => ({ op: r.op, color: T.ld })));
    // the reorder buffer holds everything between dispatch and commit, oldest first: waiting, executing, done
    const live = rows.filter((r) => r.ch === 'S' || r.ch === 'X' || r.ch === 'R');
    fill(rob, live.map((r) => ({ op: r.op, color: r.ch === 'S' ? T.ld : r.ch === 'X' ? T.alu : T.st })));
    if (rob && live.length) {
      const cs = cellRects(rob);
      const h = cs[0];
      if (h) box(g, h.x - 1, h.y - 1, h.w + 2, h.h + 2, 2, { stroke: T.ink, lw: 2 });
      const tl = cs[live.length];
      if (tl) box(g, tl.x - 1, tl.y - 1, tl.w + 2, tl.h + 2, 2, { stroke: T.mute, lw: 1.2, sa: 0.8 });
    }
    for (const [id, ct] of this.cellTexts) if (!used.has(id)) ct.hideFrom(0);
  }
}

/** A tick of the clock along its wire. */
function clockPacket(plan: CpuPlan): PacketPlan | null {
  const l = plan.links.find((x) => x.id === 'clk-core');
  return l ? { link: l, reverse: false, delay: 0, color: 'mute' } : null;
}
