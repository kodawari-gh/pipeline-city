import { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '../sim/protocol';
import { BLOCKS, CHIP_H, CHIP_W, STAGES, stageCentre } from './layout';
import { box, dashed, MONO } from './ink';
import type { Theme } from './theme';

// Zoomed-in CPU view: instruction chips moving through IF ID EX MEM WB, driven by snapshot.pipe.
// Chips are keyed by dynamic instruction id (bubbles by stage) and tween from where they were to where
// the new snapshot puts them. At higher game speeds (or fast snapshots) tweening is skipped.

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const BUBBLE_NAMES = ['', 'load', 'data', 'flush', 'struct'];

function opClass(op: string): 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'sys' {
  if (op === 'mul') return 'mul';
  if (op === 'lw' || op === 'lb' || op === 'lbu') return 'ld';
  if (op === 'sw' || op === 'sb') return 'st';
  if (op === 'jal' || op === 'jalr' || op[0] === 'b') return 'br';
  if (op === 'ecall') return 'sys';
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
      const pts: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
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

export class PipelineView {
  readonly root = new Container();
  private tiles = new Graphics();
  private dc = new Graphics();
  private chipLayer = new Container();
  private chips = new Map<string, Chip>();
  private free: Chip[] = [];
  private dying: Chip[] = [];
  private lastAt = 0;
  private lastMisses = 0;
  private lastCycles = 0;
  private dcAt = -1e9;
  T!: Theme;

  constructor() {
    this.root.addChild(this.tiles, this.dc, this.chipLayer);
  }

  setTheme(T: Theme) {
    this.T = T;
    for (const c of this.chips.values()) this.release(c);
    this.chips.clear();
    for (const c of this.dying) this.release(c);
    this.dying = [];
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

  /** `simple`: skip tweening (fast game speed). */
  update(s: Snapshot | null, simple: boolean, now: number) {
    const T = this.T;
    const gap = now - this.lastAt;
    this.lastAt = now;
    const dur = simple || gap < 350 ? 0 : Math.min(gap * 0.8, 900);
    const pipe = s?.pipe;
    const tg = this.tiles;
    tg.clear();

    // cache miss flash on the D-cache tile
    const misses = s?.counters.cacheMisses ?? 0, cycles = s?.counters.cycles ?? 0;
    if (cycles < this.lastCycles) this.lastMisses = 0;
    if (misses > this.lastMisses) this.dcAt = now;
    this.lastMisses = misses; this.lastCycles = cycles;

    const seen = new Set<string>();
    if (pipe) {
      pipe.stages.forEach((st, i) => {
        const tile = STAGES[i]!, ctr = stageCentre(i);
        if (st.kind === 0) return;
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
            const start = stageCentre(0);
            chip.x = start.x - 240; chip.y = start.y; chip.a = 0; chip.s = 0.8;
            chip.c.position.set(chip.x, chip.y);
          }
          chip.look(T, { bubble: false, text: st.op.toUpperCase(), sub, color, stalled: st.stalled, bad: false });
          tg.roundRect(tile.x, tile.y, tile.w, tile.h, 12).fill({ color: T.alu, alpha: 0.07 });
          if (st.stalled) tg.roundRect(tile.x - 4, tile.y - 4, tile.w + 8, tile.h + 8, 14).stroke({ width: 5, color: T.ld, alpha: 0.9 });
        } else {
          key = 'b' + i;
          chip = this.chips.get(key);
          const flush = st.cause === 3;
          if (!chip) {
            chip = this.take();
            this.chips.set(key, chip);
            chip.isBubble = true;
            chip.x = ctr.x; chip.y = ctr.y; chip.a = 0; chip.s = 1;
            chip.c.position.set(chip.x, chip.y);
          }
          chip.look(T, { bubble: true, text: BUBBLE_NAMES[st.cause] || 'bubble', sub: '', color: flush ? T.bad : T.ld, stalled: false, bad: false });
          if (flush) tg.roundRect(tile.x, tile.y, tile.w, tile.h, 12).fill({ color: T.bad, alpha: 0.16 });
        }
        chip.stage = i;
        chip.go(ctr.x, ctr.y, 1, 1, now, chip.isBubble ? 0 : dur);
        seen.add(key);
      });
    }
    // chips that left the pipeline: retired (from WB) slide out, others were squashed
    for (const [key, chip] of this.chips) {
      if (seen.has(key)) continue;
      this.chips.delete(key);
      if (chip.isBubble || dur <= 0) { this.release(chip); continue; }
      const retired = chip.stage >= 3;
      chip.dying = true;
      chip.look(T, { bubble: false, text: '', sub: '', color: retired ? T.st : T.bad, stalled: false, bad: !retired });
      if (retired) chip.go(chip.x + 250, chip.y, 0, 0.9, now, dur);
      else chip.go(chip.x, chip.y + 90, 0, 0.45, now, dur);
      this.dying.push(chip);
    }
  }

  frame(now: number) {
    for (const c of this.chips.values()) c.tick(now);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i]!.tick(now)) { this.release(this.dying[i]!); this.dying.splice(i, 1); }
    }
    this.dc.clear();
    const f = Math.max(0, 1 - (now - this.dcAt) / 900);
    if (f > 0) {
      const d = BLOCKS.find((b) => b.id === 'DC')!;
      box(this.dc, d.x, d.y, d.w, d.h, 12, { fill: this.T.ld, fa: f * 0.55, stroke: this.T.ld, lw: 4 });
    }
  }
}
