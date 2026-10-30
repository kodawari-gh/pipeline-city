import { Container, Graphics, Text } from 'pixi.js';
import { disassemble } from '../../sim/isa';
import { Ev } from '../../sim/engines/common';
import { IRQ } from '../../sim/isa/memmap';
import type { PipeSnap } from '../../sim/game/pipesnap';
import { scrubCursor, scrubRange, scrubShown, scrubTarget } from '../../game/scrub';
import type { Block, CpuPlan, Rect } from './cpuplan';
import { cellRects, isTall, dieNear, type DieArt } from './dieart';
import { CellTexts, drawPackets, drawPulse, drawTrails, packetOn, type Dot, type Packet, type Trail } from './diepulse';
import { CYCLES_PER_SEC, opClass, packetsFor, Player, regsRead, type CacheView, type ChipState, type OpClass, type PacketPlan, type StoreEvent, type StoreReplay } from './diemotion';
import { box, MONO, mix } from '../ink';
import { controlsOf, glyphArea, glyphLive, hasSymbol } from './blockart';
import { readsOf } from './tokentext';
import { idColor, pcText, writesOf } from './tokentext';
import type { Theme } from '../theme';
import { DEVICE_LOD, SHOWN, bandAlpha, onBand } from '../lod';

// The CPU die in motion (docs/DIE.md "Motion" and "What is stored"). It draws the near layer of the die (traces, cell arrays, names;
// `dieart.ts`) faded in by zoom, and plays back the engine's recent cycles in slow motion (`diemotion.ts`):
//  - instruction chips glide from block to block along the die's own wires, and everything that moves because of an instruction is
//    painted in the colour of its class (arithmetic, multiply, load, store, branch): the address going out to memory, the instruction
//    word coming back from RAM, the operands read from the registers, the data of a load, the result written back; the wire stays lit
//    behind it for a moment, so the path an instruction took can be read off the die;
//  - the register file, the cache lines and the predictor counters show what they hold, and change when the replay writes them;
//  - blocks glow while an instruction is in them, the clock beats once per cycle.
// A snapshot is a sampled instant: the replay is a slow-motion sample of the run.

const CHIP_W = 176, CHIP_H = 92;
const TOKEN_W = CHIP_W, TOKEN_H = CHIP_H;
const CYCLE_MS = 1000 / CYCLES_PER_SEC;
/** How long an instruction takes to settle into a block's symbol or a queue cell (wall ms). */
const WIPE_MS = 320;

/** What the memory sticks should show: the CPU asked RAM for an address (a fetch, a load, a store), `at` is game time in ms. */
/** A reach for RAM. `core` is the logical core that made it, on a multicore die (diemulti.ts adds it). */
export interface MemoryTouch { kind: 'fetch' | 'load' | 'store'; addr: number; cls: OpClass; at: number; core?: number }

/** The scale a chip has in a block: it fits inside it. */
const fitOf = (r: Rect) => Math.max(0.3, Math.min(1, (r.w - 12) / CHIP_W, (r.h - 22) / CHIP_H));

const hex = (v: number, min = 1) => (v >>> 0).toString(16).padStart(min, '0');
/** A register or memory value in a few characters. */
export function showValue(v: number): string {
  if (v >= -999 && v <= 99999) return String(v);
  return '0x' + hex(v);
}

const CLASS_LABEL: [OpClass, string][] = [['alu', 'ARITHMETIC'], ['mul', 'MULTIPLY'], ['ld', 'LOAD'], ['st', 'STORE'], ['br', 'BRANCH']];

/** The live view of one floorplan: the single-core die, or one core tile of a multicore die (`DieView` below holds the tiles and the shared part). */
export class PlanView {
  readonly root = new Container();
  /** Draw the colour key under the die (off for a core tile). */
  legendOn = true;
  /** Whether this view tells the Trace panel's scrubber what it can show (on a multicore die only the selected core's view does). */
  scrubLead = true;
  private plan: CpuPlan | null = null;
  /** What the replay moves on: the plan, or for a core tile also the shared blocks and the wires out to them. */
  private motion: CpuPlan | null = null;
  private art: DieArt | null = null;
  private glowG = new Graphics();
  private dataG = new Graphics();
  private dataTexts = new Container();
  private cellLive = new Graphics();
  private glyphG = new Graphics();
  private tailG = new Graphics();
  /** The address each load and store reached for, by instruction id (a token shows it in its memory stage). */
  private addrs = new Map<number, number>();
  private glyphSig = '#';
  private glyphAnim = false;
  /** When each instruction (id + stage) was first seen in its place, wall ms. */
  private born = new Map<string, number>();
  private cellBorn = new Map<string, number>();
  private cellAnim = false;
  private texts = new Container();
  private trailG = new Graphics();
  private packetG = new Graphics();
  private legend = new Container();
  private dots = new Map<string, Dot>();
  private cellTexts = new Map<string, CellTexts>();
  private player: Player | null = null;
  private byId = new Map<string, Block>();
  private packets: Packet[] = [];
  private trails = new Map<string, Trail>();
  private glow = new Map<string, { v: number; color: string }>();
  private flash = { miss: -1e9, retire: -1e9, result: -1e9, flush: -1e9, clock: -1e9 };
  private regWrite: number[] = [];
  private regRead: number[] = [];
  private running = false;
  private z = 1;
  /** The zoom the die is seen at (lod.ts `seenZoom`): the layers fade on it, the line widths on `z`. */
  private zSeen = 1;
  private cellSig = '';
  private dataSig = '';
  /** Told every time the CPU reaches out to RAM, for the memory sticks (set by board.ts). */
  onMemory: ((e: MemoryTouch) => void) | null = null;
  /** Told when the replay takes an interrupt, with its line (`IRQ`): the board lights the path the device's signal came along. */
  onInterrupt: ((line: number) => void) | null = null;
  T!: Theme;

  constructor() {
    this.root.addChild(this.glowG, this.dataG, this.dataTexts, this.cellLive, this.glyphG, this.texts, this.trailG, this.packetG, this.tailG, this.legend);
  }

  /**
   * Build (or rebuild, on a theme change) the near layer of a plan. `motion` is the plan the replay moves on when it is more than the one drawn:
   * a core tile of a multicore die also knows the shared blocks and the wires out to them (`splitPlan`), so packets and flashes reach them.
   */
  setPlan(T: Theme, plan: CpuPlan, motion: CpuPlan = plan) {
    this.T = T;
    this.plan = plan;
    this.motion = motion;
    this.dropChips();
    for (const ct of this.cellTexts.values()) ct.clear();
    this.cellTexts.clear();
    this.art?.root.destroy({ children: true });
    this.art = dieNear(T, plan);
    this.root.addChildAt(this.art.root, 0);
    this.byId = new Map(motion.blocks.map((b) => [b.id, b]));
    this.player = new Player(motion);
    this.packets = [];
    this.trails.clear();
    this.glow.clear();
    this.regWrite = []; this.regRead = []; this.slotTime.clear(); this.sysAt.clear(); this.tlbKind.clear();
    this.cellSig = ''; this.dataSig = ''; this.glyphSig = '#';
    this.buildLegend(T, plan);
    this.setZoom(this.z, this.zSeen);
  }

  /** The colour key under the die: what each colour of chip, packet and lit wire means. */
  private buildLegend(T: Theme, plan: CpuPlan) {
    for (const c of this.legend.removeChildren()) c.destroy({ children: true });
    if (!this.legendOn) return;
    const g = new Graphics();
    this.legend.addChild(g);
    let x = plan.die.x + 40;
    const y = plan.die.y + plan.die.h + 62;
    for (const [cls, name] of CLASS_LABEL) {
      g.roundRect(x, y - 9, 18, 18, 5).fill({ color: T[cls as 'alu'] });
      const t = new Text({ text: name, style: { fontFamily: MONO, fontSize: 18, fontWeight: '700', fill: T.mute }, resolution: 2 });
      t.anchor.set(0, 0.5); t.position.set(x + 28, y);
      this.legend.addChild(t);
      x += 28 + name.length * 11.5 + 30;
    }
    const note = new Text({ text: 'THE COLOUR OF AN INSTRUCTION FOLLOWS IT THROUGH THE CHIP', style: { fontFamily: MONO, fontSize: 16, fill: T.mute }, resolution: 2 });
    note.anchor.set(0, 0.5); note.position.set(x + 20, y); note.alpha = 0.7;
    this.legend.addChild(note);
  }

  /** No CPU in the socket. */
  clear() {
    this.plan = null;
    this.motion = null;
    this.player = null;
    this.dropChips();
    for (const ct of this.cellTexts.values()) ct.clear();
    this.cellTexts.clear();
    this.art?.root.destroy({ children: true });
    this.art = null;
    for (const c of this.legend.removeChildren()) c.destroy({ children: true });
    this.glowG.clear(); this.dataG.clear(); this.cellLive.clear(); this.glyphG.clear(); this.glyphSig = '#'; this.packetG.clear(); this.trailG.clear();
    this.packets = [];
    this.trails.clear();
  }

  private dropChips() { this.dots.clear(); this.tailG.clear(); }

  /** Levels of detail (lod.ts `DEVICE_LOD.die`): the die is a lit machine from far out (wires, cell arrays, symbols, pulses from about 0.3), texts from 0.8, the second line of a block from 1.2. Each layer fades in over a short band instead of popping. */
  setZoom(z: number, seen = z) {
    this.z = z; this.zSeen = seen;
    if (!this.art) return;
    const L = DEVICE_LOD.die, fade = (n: { visible: boolean; alpha: number }, z0: number) => { const a = bandAlpha(seen, onBand(z0)); n.alpha = a; n.visible = a > SHOWN; };
    fade(this.art.wires, L.wires);
    fade(this.art.cells, L.cells);
    fade(this.cellLive, L.cells);
    fade(this.glyphG, L.cells);
    fade(this.dataG, L.cells);
    fade(this.texts, L.texts);
    fade(this.dataTexts, L.dataTexts);
    fade(this.art.subs, L.subs);
    fade(this.packetG, L.packets);
    fade(this.trailG, L.packets);
    fade(this.legend, L.legend);
  }

  /** A new snapshot of this plan's pipeline: its trace and stored state join the replay; nothing is drawn here (frame() draws). */
  update(pipe: PipeSnap | null) {
    if (!this.plan || !this.player) return;
    if (!pipe || !pipe.trace) {
      // no machine running: the replay stops and the chips go
      if (this.running) { this.player.reset(); this.dropChips(); this.cellSig = ''; this.dataSig = ''; this.glyphSig = '#'; this.running = false; }
      return;
    }
    this.running = true;
    this.player.push(pipe.trace, pipe.stored);
  }

  private colorOf(cls: OpClass): string { return cls === 'sys' ? this.T.mute : this.T[cls]; }

  /**
   * The CPU read or wrote a register of a unit on the die: the interrupt controller, the timer, the MPU, or the MMU (whose TLB block flashes).
   * A packet runs along the unit's system-bus wire (out for a write, back for a read) and the block flashes. `now` is game ms.
   */
  poke(unit: 'intc' | 'timer' | 'mpu' | 'mmu', write: boolean, now: number) {
    const plan = this.motion;
    if (!plan) return;
    this.sysAt.set('mm:' + unit, now);
    const link = plan.links.find((l) => l.id === 'fab-' + unit);
    if (link) this.send([{ link, reverse: !write, delay: 0, color: 'inst' }], now, 'ld');
  }

  private send(pk: PacketPlan[], now: number, cls: OpClass) {
    const T = this.T;
    for (const p of pk) {
      const color = p.color === 'bad' ? T.bad : p.color === 'mute' ? mix(T.mute, this.colorOf(cls), 0.45) : this.colorOf(cls);
      const { packet, trail } = packetOn(p.link, p.reverse, now + p.delay * CYCLE_MS, CYCLE_MS * 1.1, color);
      this.packets.push(packet);
      this.trails.set(p.link.id, trail);
    }
  }

  /**
   * An instruction between two blocks is a pulse on the wires, in its class colour with a halo in its own colour and a short tail; there are no
   * boxes on the die. Inside a block it is what the block shows (a symbol filling, a cell, the block glowing), see `glyphs`, `cells`, `frame`.
   */
  private pulse(st: ChipState, seen: Set<string>) {
    const T = this.T;
    // a pulse runs on the die's traces only: with no trace between the two blocks there is none (the blocks light instead)
    const moving = st.from !== undefined && st.from !== st.to && st.wx !== undefined;
    drawPulse(this.tailG, this.dots, seen, { key: st.key, x: st.wx ?? st.x, y: st.wy ?? st.y, moving, e: st.e, alpha: st.alpha, core: st.flushed ? T.bad : this.colorOf(opClass(st.op)), halo: idColor(st.id, T.dark) });
  }

  /** Draw one frame at game time `now` (ms). `draw` false (the die is out of view or faded out): the replay still runs and feeds the sticks and the interrupt hook, but nothing is drawn. */
  frame(now: number, paused = false, draw = true) {
    const plan = this.motion, player = this.player;
    if (!plan || !player) return;
    const T = this.T;
    // a paused game can be scrubbed: the Trace panel names a cycle and the die shows the machine at it
    const cur = paused && scrubTarget.peek() === 'cpu' ? scrubCursor.peek() : null;
    if (cur !== null && cur !== player.shown() && player.seek(cur)) { this.packets = []; this.trails.clear(); this.cellSig = ''; this.glyphSig = '#'; }
    const fr = player.update(now, paused);
    const rg = player.range(), sh = player.shown();
    const old = scrubRange.peek();
    if (this.scrubLead && scrubTarget.peek() === 'cpu') {
      if ((rg?.lo ?? -1) !== (old?.lo ?? -1) || (rg?.hi ?? -1) !== (old?.hi ?? -1)) scrubRange.value = rg;
      if (sh !== scrubShown.peek()) scrubShown.value = sh;
    }

    // beats: packets on the wires, flashes, reads of the register file, the memory sticks told
    const byCycle = new Map<number, StoreEvent[]>();
    for (const e of fr.applied) { const l = byCycle.get(e.cycle); if (l) l.push(e); else byCycle.set(e.cycle, [e]); }
    for (const e of fr.applied) {
      if (e.kind === Ev.Reg) this.regWrite[e.a] = now;
      else if (e.kind === Ev.Hit || e.kind === Ev.Fill) this.slotTime.set(WHICH[e.a]! + e.b, now);
      else if (e.kind === Ev.Pred) this.slotTime.set('p' + e.a, now);
      else if (e.kind === Ev.Tlb) { if (e.a === 2) this.sysAt.set('fault', now); else { this.slotTime.set('t' + e.b, now); this.tlbKind.set(e.b, e.a); } }
      else if (e.kind === Ev.Irq) {
        this.sysAt.set('irq', now); this.sysLine = e.a;
        const wire = plan.links.find((l) => l.kind === 'irq');
        // where the line came from: the timer (on the die) along its tick wire, any other (disk, network, USB) in over the system bus
        const from = plan.links.find((l) => l.id === (e.a === IRQ.TIMER ? 'timer-intc' : 'fab-intc'));
        if (e.a === IRQ.TIMER) this.sysAt.set('mm:timer', now);
        if (from) this.send([{ link: from, reverse: false, delay: 0, color: 'inst' }], now, 'br');
        if (wire) this.send([{ link: wire, reverse: false, delay: from ? 1 : 0, color: 'inst' }], now, 'br'); // the interrupt comes in along its wire from the controller
        this.onInterrupt?.(e.a);
      }
      else if (e.kind === Ev.Iret) this.sysAt.set('iret', now);
      else if (e.kind === Ev.Space) this.sysAt.set('space', now);
    }
    for (const ev of fr.beats) {
      const events = byCycle.get(ev.cycle) ?? [];
      const cls = opClass(ev.op);
      this.send(packetsFor(plan, ev, { events }), now, cls);
      if (ev.to === 'D') for (const r of regsRead(ev.text)) this.regRead[r] = now + CYCLE_MS * 0.1;
      if (ev.to === 'M' && ev.miss) this.flash.miss = now;
      if (ev.to === 'W' || ev.to === 'C') this.flash.retire = now;
      if (ev.to === 'R') this.flash.result = now;
      if (ev.to === 'x') this.flash.flush = now;
      if (cls === 'ld' || cls === 'st') { const m = events.find((e) => e.kind === Ev.Mem); if (m && (plan.arch === 'ooo' ? ev.to === 'X' : ev.to === 'M')) { this.addrs.set(ev.id, m.b >>> 0); if (this.addrs.size > 400) this.addrs.delete(this.addrs.keys().next().value!); } }
      this.touchMemory(ev, events, now, cls);
    }
    if (fr.tick) {
      this.flash.clock = now;
      const l = plan.links.find((x) => x.id === 'clk-core');
      if (l) this.send([{ link: l, reverse: false, delay: 0, color: 'mute' }], now, 'sys');
    }

    if (!draw) {
      // what was drawn is dropped and the signatures reset, so the first frame back in view draws everything fresh
      this.dropChips(); this.glow.clear(); this.packets = []; this.trails.clear();
      this.glowG.clear(); this.dataG.clear(); this.cellLive.clear(); this.glyphG.clear(); this.packetG.clear(); this.trailG.clear();
      this.cellSig = ''; this.dataSig = ''; this.glyphSig = '#';
      return;
    }

    // the instructions: pulses between blocks, and everything inside the blocks (glyphs, cells, glow)
    const seen = new Set<string>();
    this.tailG.clear();
    for (const c of fr.fading) this.pulse(c, seen);
    for (const c of fr.chips) this.pulse(c, seen);
    for (const k of this.dots.keys()) if (!seen.has(k)) this.dots.delete(k);

    // blocks glow while an instruction is in them
    const want = new Map<string, string>();
    for (const c of fr.chips) {
      if (c.alpha < 0.5) continue;
      want.set(c.host, c.flushed ? T.bad : this.colorOf(opClass(c.op)));
    }
    for (const [id, color] of want) this.glow.set(id, { v: Math.min(1, (this.glow.get(id)?.v ?? 0) + 0.2), color });
    for (const [id, g] of this.glow) if (!want.has(id)) { g.v *= 0.9; if (g.v < 0.02) this.glow.delete(id); }
    const gg = this.glowG;
    gg.clear();
    for (const [id, g] of this.glow) {
      const b = this.byId.get(id);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: g.color, fa: 0.16 * g.v, stroke: g.color, lw: 2.5, sa: 0.55 * g.v });
    }
    for (const c of fr.chips) {
      if (!c.stalled || c.alpha < 0.5) continue;
      const b = this.byId.get(c.host);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { stroke: T.ld, lw: 3, sa: 0.8 });
    }
    const fl = (t: number, ms: number) => Math.max(0, 1 - (now - t) / ms);
    const hot = (b: Block | undefined, k: number, color: string, w = 4) => { if (b && k > 0) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: color, fa: k * 0.4, stroke: color, lw: w, sa: k }); };
    hot(plan.blocks.find((b) => b.kind === 'dcache'), fl(this.flash.miss, 1400), T.ld);
    hot(plan.blocks.find((b) => b.kind === 'resultbus'), fl(this.flash.result, 450), T.mul, 3);
    hot(plan.blocks.find((b) => b.kind === 'clock'), fl(this.flash.clock, CYCLE_MS * 0.9) * 0.9, T.mute, 2);
    if (fl(this.flash.flush, 900) > 0) hot(plan.blocks.find((b) => b.kind === 'fetch'), fl(this.flash.flush, 900), T.bad, 3);

    this.cells(player);
    this.glyphs(player);
    this.storage(fr.store, now);
    drawTrails(this.trailG, this.trails, now, this.z);
    this.packets = drawPackets(this.packetG, this.packets, now, this.z, this.T.ink);
  }

  /** Tell the memory sticks which address the CPU is reaching for (the instruction fetch, the load and the store each have one). */
  private touchMemory(ev: { to: string; op: string; pc: number; cycle: number; dwell: number }, events: StoreEvent[], now: number, cls: OpClass) {
    const cb = this.onMemory;
    if (!cb) return;
    if (ev.to === 'F') cb({ kind: 'fetch', addr: ev.pc, cls, at: now + CYCLE_MS * 0.6 });
    const mem = events.find((e) => e.kind === Ev.Mem);
    if (mem && ((this.plan!.arch === 'ooo' ? ev.to === 'X' : ev.to === 'M') && (cls === 'ld' || cls === 'st'))) {
      cb({ kind: mem.a === 1 ? 'store' : 'load', addr: mem.b >>> 0, cls, at: now + CYCLE_MS * (mem.a === 1 ? 0.5 : 0.8) });
    }
  }

  private texts_(id: string, used: Set<string>): CellTexts {
    used.add(id);
    let ct = this.cellTexts.get(id);
    if (!ct) { ct = new CellTexts(id.startsWith('data:') ? this.dataTexts : this.texts); this.cellTexts.set(id, ct); }
    return ct;
  }

  /** The out-of-order structures as cells: the fetch queue, the scheduler and the reorder buffer, from the stage of each instruction in the replay. */
  private cells(player: Player) {
    const plan = this.plan!, T = this.T, g = this.cellLive;
    if (plan.arch !== 'ooo') { if (this.cellSig !== '-') { g.clear(); this.cellSig = '-'; } return; }
    const rows = player.now();
    const sig = rows.map((r) => r.id + r.ch).join(',');
    if (sig === this.cellSig && !this.cellAnim) return;
    this.cellSig = sig;
    g.clear();
    const wall = performance.now(), cb = new Map<string, number>();
    for (const r of rows) { const k = r.id + r.ch; cb.set(k, this.cellBorn.get(k) ?? wall); const rk = r.id + 'rat'; cb.set(rk, this.cellBorn.get(rk) ?? wall); }
    this.cellBorn = cb;
    this.cellAnim = false;
    const used = new Set<string>();
    const fq = plan.blocks.find((b) => b.id === 'fq'), sched = plan.blocks.find((b) => b.kind === 'sched'), rob = plan.blocks.find((b) => b.kind === 'rob');
    const fill = (b: Block | undefined, items: { op: string; color: string; pc: number; id: number; ch: string }[]) => {
      if (!b) return;
      const cs = cellRects(b), ct = this.texts_(b.id, used);
      cs.forEach((r, k) => {
        const it = items[k];
        let u = 1;
        if (it) {
          u = Math.min(1, (wall - (cb.get(it.id + it.ch) ?? wall)) / WIPE_MS);
          if (u < 1) this.cellAnim = true;
          const e = u * u * (3 - 2 * u);
          // a new entry grows into its cell from the middle and flashes white once
          const gw = r.w * (0.35 + 0.65 * e), gh = r.h * (0.35 + 0.65 * e);
          box(g, r.x + (r.w - gw) / 2, r.y + (r.h - gh) / 2, gw, gh, 1.5, { fill: it.color, fa: 0.85 * (0.3 + 0.7 * e) });
          if (u < 1) box(g, r.x, r.y, r.w, r.h, 1.5, { stroke: T.ink, lw: 2, sa: 1 - e });
          if (r.w >= 28 && r.h >= 22) box(g, r.x + r.w - 10, r.y + 4, 6, 6, 3, { fill: idColor(it.id, T.dark) }); // the instruction's own colour, as on its token
        }
        if (it && u < 0.6) ct.hide(k); else ct.set(k, it?.op ?? '', it && r.h >= 40 ? pcText(it.pc) : '', r, T.on);
      });
    };
    // the rename table: for each register, the newest instruction in flight that will write it (its address and colour), the rest idle
    const rat = plan.blocks.find((b) => b.kind === 'rename');
    if (rat) {
      const prod = new Map<number, (typeof rows)[number]>();
      for (const r of rows) {
        if (r.ch !== 'S' && r.ch !== 'X' && r.ch !== 'R') continue;
        const w = writesOf(r.word);
        const old = w > 0 ? prod.get(w) : undefined;
        if (w > 0 && (!old || r.id > old.id)) prod.set(w, r);
      }
      const ct = this.texts_('rat', used);
      cellRects(rat).forEach((r, k) => {
        const it = prod.get(k);
        if (!it) { box(g, r.x, r.y, r.w, r.h, 1.5, { stroke: T.mute, lw: 1, sa: 0.35 }); ct.set(k, REG[k] ?? 'x' + k, '', r, T.mute); return; }
        const u = Math.min(1, (wall - (cb.get(it.id + 'rat') ?? wall)) / WIPE_MS), e = u * u * (3 - 2 * u);
        if (u < 1) this.cellAnim = true;
        const gw = r.w * (0.35 + 0.65 * e), gh = r.h * (0.35 + 0.65 * e);
        box(g, r.x + (r.w - gw) / 2, r.y + (r.h - gh) / 2, gw, gh, 1.5, { fill: this.colorOf(opClass(it.op)), fa: 0.85 * (0.3 + 0.7 * e) });
        box(g, r.x + r.w - 8, r.y + 3, 5, 5, 2.5, { fill: idColor(it.id, T.dark) });
        if (u < 0.6) ct.hide(k); else ct.set(k, REG[k] ?? 'x' + k, r.h >= 24 ? pcText(it.pc) : '', r, T.on);
      });
    }
    fill(fq, rows.filter((r) => r.ch === 'F').map((r) => ({ op: r.op, color: T.alu, pc: r.pc, id: r.id, ch: r.ch })));
    fill(sched, rows.filter((r) => r.ch === 'S').map((r) => ({ op: r.op, color: T.ld, pc: r.pc, id: r.id, ch: r.ch })));
    // the reorder buffer holds everything between dispatch and commit, oldest first: waiting, executing, done
    const live = rows.filter((r) => r.ch === 'S' || r.ch === 'X' || r.ch === 'R');
    fill(rob, live.map((r) => ({ op: r.op, color: r.ch === 'S' ? T.ld : r.ch === 'X' ? T.alu : T.st, pc: r.pc, id: r.id, ch: r.ch })));
    if (rob && live.length) {
      const cs = cellRects(rob);
      const h = cs[0];
      if (h) box(g, h.x - 1, h.y - 1, h.w + 2, h.h + 2, 2, { stroke: T.ink, lw: 2 });
      const tl = cs[live.length];
      if (tl) box(g, tl.x - 1, tl.y - 1, tl.w + 2, tl.h + 2, 2, { stroke: T.mute, lw: 1.2, sa: 0.8 });
    }
  }

  /** The symbols inside the blocks (blockart.ts) show the instructions in them: the PC's digits, the words fetched, the decoded word and the control lines it raises, the operation in the ALU. */
  private glyphs(player: Player) {
    const plan = this.plan!, T = this.T, g = this.glyphG;
    const rows = player.now();
    const sig = rows.map((r) => r.id + r.ch + r.lane).join(',');
    const wall = performance.now();
    if (sig === this.glyphSig && !this.glyphAnim) return;
    this.glyphSig = sig;
    g.clear();
    // when each instruction got into its block: its words wipe in, the control lines light one after another
    const born = new Map<string, number>();
    for (const r of rows) { const k = r.id + r.ch; born.set(k, this.born.get(k) ?? wall); }
    this.born = born;
    this.glyphAnim = false;
    const by = new Map<string, { op: string; text: string; pc: number; word: number; id: number; ch: string; flags?: number }[]>();
    for (const r of rows) {
      const host = player.hostOf(r.ch, r.lane, r.op, r.id);
      if (!host) continue;
      const l = by.get(host.id);
      if (l) l.push(r); else by.set(host.id, [r]);
    }
    const fetched = rows.filter((r) => r.ch === 'F').sort((a, b) => a.id - b.id)[0];
    const used = new Set<string>();
    for (const b of plan.blocks) {
      if (!hasSymbol(b)) continue;
      const a = glyphArea(b);
      if (!a) continue;
      // the immediate lights when the instruction being decoded has one, the dispatch lanes when instructions go to the scheduler
      // the hazard unit's lamp lights while an instruction waits in decode; the forwarding unit's multiplexer when an operand of the instruction executing is the result of one ahead of it
      const ahead = rows.filter((r) => r.ch === 'M' || r.ch === 'W').flatMap((r) => (writesOf(r.word) > 0 ? [writesOf(r.word)] : []));
      const here = b.kind === 'hazard' ? rows.filter((r) => r.ch === 'D' && r.stalled)
        : b.kind === 'forward' ? rows.filter((r) => r.ch === 'X').map((r) => { const rs = readsOf(r.word); return { ...r, flags: (rs[0] !== undefined && ahead.includes(rs[0]) ? 1 : 0) | (rs[1] !== undefined && ahead.includes(rs[1]) ? 2 : 0) }; }).filter((r) => r.flags > 0)
        : b.kind === 'imm' ? rows.filter((r) => r.ch === 'D' && controlsOf(r.op).includes(4)) : b.id === 'disp' ? rows.filter((r) => r.ch === 'S' && r.fresh) : by.get(b.id) ?? [];
      const prog = here.map((r) => Math.min(1, (wall - (born.get(r.id + r.ch) ?? wall)) / WIPE_MS));
      if (prog.some((x) => x < 1)) this.glyphAnim = true;
      const live = glyphLive(b, a, here, b.kind === 'pc' ? fetched?.pc : undefined, prog.map((x) => x * x * (3 - 2 * x)));
      for (const l of live.lit) box(g, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: T[l.color], fa: l.a });
      if (live.texts.length === 0) continue;
      const ct = this.texts_('g:' + b.id, used);
      live.texts.forEach((t, k) => ct.set(k, t.top, t.bottom, t.rect, T.on));
      ct.hideFrom(live.texts.length);
    }
    for (const [id, ct] of this.cellTexts) if (id.startsWith('g:') && !used.has(id)) ct.hideFrom(0);
  }

  /** What the register file, the caches and the predictor hold at the cycle being shown; reads and writes flash. */
  private storage(st: StoreReplay | null, now: number) {
    const plan = this.plan!, T = this.T, g = this.dataG;
    g.clear();
    if (!st) return;
    const used = new Set<string>();
    const fade = (t: number, ms: number) => (t < 0 ? 0 : Math.max(0, 1 - (now - t) / ms));
    const sigParts: string[] = [];

    // the register file: a name and a value in each cell
    const rf = plan.blocks.find((b) => b.kind === 'regfile');
    if (rf) {
      const cs = cellRects(rf), ct = this.texts_('data:rf', used);
      cs.forEach((r, k) => {
        const w = fade(this.regWrite[k] ?? -1, 900), rd = fade(this.regRead[k] ?? -1, 600);
        if (w > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: T.st, fa: 0.75 * w });
        if (rd > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { stroke: T.alu, lw: 3, sa: rd });
        const v = st.regs[k] ?? 0;
        if (v !== 0 || k === 0) box(g, r.x + 1, r.y + r.h - 4, Math.max(1, Math.min(r.w - 2, ((Math.abs(v) % 4096) / 4096) * (r.w - 2))), 3, 1, { fill: T.st, fa: 0.5 });
        const s1 = REG[k] ?? 'x' + k, s2 = showValue(v);
        sigParts.push(s2);
        ct.set(k, s1, s2, r, T.ink);
      });
    }

    // the caches: the line in each slot (its address and what is in it)
    const cacheBlock = (kind: string) => plan.blocks.find((b) => b.kind === kind);
    const drawCache = (id: string, b: Block | undefined, c: CacheView | undefined, content: (words: number[] | undefined) => string, color: string) => {
      if (!b || !c) return;
      const cs = cellRects(b), ct = this.texts_('data:' + id, used);
      cs.forEach((r, k) => {
        const tag = c.tags[k] ?? -1;
        if (tag < 0) { ct.hide(k); return; }
        box(g, r.x, r.y, r.w, r.h, 1.5, { fill: color, fa: 0.3 });
        const f = fade(this.slotTime.get(id + k) ?? -1, 900);
        if (f > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: color, fa: 0.7 * f, stroke: T.ink, lw: 2, sa: f });
        const words = c.words.get(tag);
        const s2 = content(words);
        sigParts.push(String(tag) + s2);
        ct.set(k, '@' + hex(tag * c.lineBytes, 4), s2, r, T.ink);
      });
    };
    drawCache('d', cacheBlock('dcache'), st.d, (w) => (w ? showValue(w[0]!) : '··'), T.ld);
    drawCache('i', cacheBlock('icache'), st.i, (w) => (w ? (disassemble(w[0]!).split(' ')[0] ?? '') : '··'), T.ld);
    drawCache('l2', cacheBlock('l2'), st.l2, (w) => (w ? showValue(w[0]!) : '··'), T.ld);

    // the TLB: the virtual page each entry stands for and the frame it maps to
    const tl = cacheBlock('tlb');
    if (tl && st.tlb) {
      const cs = cellRects(tl), ct = this.texts_('data:tlb', used), tb = st.tlb;
      cs.forEach((r, k) => {
        const vpn = tb.vpn[k] ?? -1;
        if (vpn < 0) { ct.hide(k); return; }
        box(g, r.x, r.y, r.w, r.h, 1.5, { fill: T.st, fa: 0.3 });
        const f = fade(this.slotTime.get('t' + k) ?? -1, 900);
        if (f > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: this.tlbKind.get(k) === 1 ? T.st : T.alu, fa: 0.7 * f, stroke: T.ink, lw: 2, sa: f }); // a fill (after a walk) or a hit
        ct.set(k, 'v' + hex(vpn * 256, 4), 'p' + hex((tb.frame[k] ?? 0) * 256, 4), r, T.ink);
      });
    }

    // the OS at work: the interrupt controller lights when an interrupt is taken and when iret returns; the TLB block when the address space changes or a page faults
    const flash = (b: Block | undefined, key: string, ms: number, color: string, lw = 3) => {
      const f = fade(this.sysAt.get(key) ?? -1, ms);
      if (b && f > 0) box(g, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { stroke: color, lw, sa: f, fill: color, fa: 0.18 * f });
    };
    const ic = this.motion!.blocks.find((b) => b.id === 'intc' || b.kind === 'intc');
    flash(ic, 'irq', 1100, T.br, 4);
    flash(ic, 'iret', 800, T.alu, 3);
    flash(tl, 'space', 1100, T.ld, 4);
    flash(tl, 'fault', 1100, T.br, 4);
    // a register of a unit touched by a load or store: the unit flashes (the MMU's registers flash the TLB block)
    flash(ic, 'mm:intc', 700, T.ld, 3);
    flash(this.motion!.blocks.find((b) => b.kind === 'timer'), 'mm:timer', 700, T.ld, 3);
    flash(this.motion!.blocks.find((b) => b.kind === 'mpu'), 'mm:mpu', 700, T.mul, 3);
    flash(tl, 'mm:mmu', 700, T.ld, 3);

    // the branch predictor: a counter per entry, brighter the more sure it is of "taken"
    const bp = cacheBlock('predictor');
    if (bp) {
      const cs = cellRects(bp), max = st.pred.bits === 2 ? 3 : 1;
      cs.forEach((r, k) => {
        const v = st.pred.table[k] ?? 0;
        if (v > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { fill: T.br, fa: 0.15 + 0.7 * (v / max) });
        const f = fade(this.slotTime.get('p' + k) ?? -1, 700);
        if (f > 0) box(g, r.x, r.y, r.w, r.h, 1.5, { stroke: T.ink, lw: 2, sa: f });
      });
    }
    void sigParts;
    for (const [id, ct] of this.cellTexts) if (id.startsWith('data:') && !used.has(id)) ct.hideFrom(0);
  }

  /** The replay clock of the last hit or fill of each cache slot and predictor entry, in game ms (for the flash). */
  private slotTime = new Map<string, number>();
  /** What each TLB entry last did (0 hit, 1 filled by a walk) and when the interrupt controller / address space last did something. */
  private tlbKind = new Map<number, number>();
  private sysAt = new Map<string, number>();
  private sysLine = 0;
}

const WHICH = ['d', 'i', 'l2'];
const REG = ['zero', 'ra', 'sp', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 's0', 's1', 's2', 's3'];
