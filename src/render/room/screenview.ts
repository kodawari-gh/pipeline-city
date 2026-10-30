import { Container, Graphics, Text, type TextStyleFontWeight } from 'pixi.js';
import { MONO } from '../ink';
import { dashSig, frameColor, type DashModel, type FrameModel, type Tone } from './screenmodel';

// The graphics display's screen (docs/render/live.md "Screen modes"): the OS dashboard drawn at the screen's design size
// (SCREEN_D, 3120x1755) with a Graphics for gauges and pooled Texts for the words. It repaints only when the model changes.

const INK = '#7dffb0', DIM = '#52a981', RULE = '#2f5a46', AMBER = '#ffc247', CYAN = '#4fe3ff', RED = '#ff6b5e', TRACK = '#16241e';
const TONE: Record<Tone, string> = { ok: INK, warn: AMBER, bad: RED, dim: DIM };

const W = 3120, X0 = 90, X1 = W - 90;
/** Left column (machine gauges) and right column (process table). */
const LX = X0, LR = 1340, RX = 1440;
const BAR_X = 540, BAR_W = 360;

export class ScreenView extends Container {
  private g = new Graphics();
  private pool: Text[] = [];
  private used = 0;
  private sig = '';

  constructor() {
    super();
    this.addChild(this.g);
    this.visible = false;
  }

  /** Show the dashboard for `m` (null hides it). */
  show(m: DashModel | null) {
    this.visible = !!m;
    if (!m) { this.sig = ''; return; }
    const sig = dashSig(m);
    if (sig === this.sig) return;
    this.sig = sig;
    this.draw(m);
  }

  private put(str: string, x: number, y: number, size: number, color: string, right = false, weight = '600') {
    let t = this.pool[this.used++];
    if (!t) {
      t = new Text({ text: '', style: { fontFamily: MONO, fontSize: size, fontWeight: weight as TextStyleFontWeight, fill: color }, resolution: 2 });
      this.pool.push(t);
      this.addChild(t);
    }
    t.visible = true;
    if (t.text !== str) t.text = str;
    const st = t.style;
    if (st.fontSize !== size) st.fontSize = size;
    if (st.fill !== color) st.fill = color;
    if (st.fontWeight !== weight) st.fontWeight = weight as TextStyleFontWeight;
    t.anchor.set(right ? 1 : 0, 0);
    t.position.set(x, y);
  }

  private draw(m: DashModel) {
    const g = this.g;
    g.clear();
    this.used = 0;

    // header
    this.put(m.title, X0, 40, 120, INK, false, '700');
    this.put(m.status, X1, 56, 96, m.status === 'READY' ? DIM : m.status === 'RUNNING' ? INK : AMBER, true, '700');
    this.put(m.sub, X0, 180, 70, DIM);
    g.rect(X0, 290, X1 - X0, 5).fill({ color: RULE });

    // machine gauges
    let y = 330;
    for (const b of m.bars) {
      this.put(b.label, LX, y + 14, 70, DIM);
      g.roundRect(BAR_X, y + 20, BAR_W, 56, 14).fill({ color: TRACK });
      if (b.frac > 0) g.roundRect(BAR_X, y + 20, Math.max(28, BAR_W * b.frac), 56, 14).fill({ color: TONE[b.tone], alpha: 0.9 });
      if (b.mark !== undefined) g.rect(BAR_X + BAR_W * b.mark - 3, y + 8, 6, 80).fill({ color: AMBER, alpha: 0.9 });
      this.put(b.text, LR, y + 14, 70, TONE[b.tone === 'ok' ? 'dim' : b.tone], true);
      y += 120;
    }
    y += 10;
    if (m.mem) {
      this.put(m.mem.label, LX, y + 14, 70, DIM);
      let x = BAR_X;
      g.roundRect(BAR_X, y + 20, BAR_W, 56, 14).fill({ color: TRACK });
      for (const p of m.mem.parts) {
        const w = BAR_W * Math.max(0, p.frac);
        if (p.tone !== 'free' && w > 0) g.rect(x, y + 20, Math.max(4, w), 56).fill({ color: p.tone === 'sys' ? DIM : CYAN, alpha: 0.9 });
        x += w;
      }
      this.put(m.mem.text, LX, y + 100, 56, DIM);
      y += 190;
    }
    // IPC sparkline
    this.put(m.ipcText, LX, y, 64, INK);
    const gy = y + 90, gh = 200, gw = LR - LX;
    g.rect(LX, gy, gw, gh).fill({ color: TRACK });
    if (m.ipc.length > 1) {
      const top = Math.max(1, ...m.ipc) * 1.15, step = gw / Math.max(1, m.ipc.length - 1);
      m.ipc.forEach((v, i) => { const px = LX + i * step, py = gy + gh - 10 - (gh - 20) * (v / top); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke({ width: 7, color: INK, alpha: 0.95 });
    }
    this.put(m.net, LX, gy + gh + 50, 64, DIM);

    // process table
    g.rect(RX - 30, 330, 5, 1090).fill({ color: RULE });
    const hy = 330, cols = { pid: RX, name: RX + 200, state: RX + 740, mem: RX + 950, time: X1 };
    this.put('PID', cols.pid, hy, 64, DIM);
    this.put('NAME', cols.name, hy, 64, DIM);
    this.put('STATE', cols.state, hy, 64, DIM);
    this.put('MEM', cols.mem, hy, 64, DIM);
    this.put('TIME', cols.time, hy, 64, DIM, true);
    g.rect(RX, hy + 84, X1 - RX, 4).fill({ color: RULE });
    let ry = hy + 110;
    for (const p of m.procs) {
      const c = p.tone === 'run' ? INK : p.tone === 'done' ? AMBER : DIM;
      if (p.tone === 'run') g.roundRect(RX - 14, ry - 8, X1 - RX + 28, 112, 14).fill({ color: INK, alpha: 0.12 });
      this.put(p.pid, cols.pid, ry, 76, c);
      this.put(p.name.slice(0, 11), cols.name, ry, 76, c);
      this.put(p.state, cols.state, ry, 76, c);
      this.put(p.mem, cols.mem, ry, 76, c);
      this.put(p.time, cols.time, ry, 76, c, true);
      ry += 124;
    }
    if (m.more) this.put(`+${m.more} MORE`, cols.name, ry, 66, DIM);

    // the line at the bottom
    if (m.prompt) this.put(m.prompt, X0, 1590, 90, m.promptTone === 'warn' ? AMBER : m.promptTone === 'ok' ? INK : DIM, false, '700');

    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }
}

/**
 * The GPU's picture, a panel of the dashboard under the process table (the graphics display with its cable on a card): the card's output as a
 * grid of coloured cells (`frameColor`) with a status strip under it. Repainted only when the frame or the strip changes.
 */
export class FrameView extends Container {
  private g = new Graphics();
  private strip = new Text({ text: '', style: { fontFamily: MONO, fontSize: 46, fontWeight: '600' as TextStyleFontWeight, fill: INK }, resolution: 2 });
  private sig = '';

  constructor() {
    super();
    this.addChild(this.g, this.strip);
    this.visible = false;
  }

  show(m: FrameModel | null) {
    this.visible = !!m;
    if (!m) { this.sig = ''; return; }
    const sig = m.status + '|' + m.cells.map((c) => Math.round(c * 255)).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.g, area = { x: RX, y: 940, w: X1 - RX, h: 690 }; // the 64 x 40 picture (16:10) takes the rest of the screen's height
    const cell = Math.min(area.w / m.cols, area.h / m.rows);
    const ox = area.x + (area.w - cell * m.cols) / 2, oy = area.y;
    g.clear();
    g.rect(RX, 900, X1 - RX, 5).fill({ color: RULE });
    g.rect(ox - 10, oy - 10, cell * m.cols + 20, cell * m.rows + 20).fill({ color: TRACK }).stroke({ width: 4, color: RULE });
    // a seamless picture (no gaps), with a dark line under every row like a scanline
    m.cells.forEach((v, i) => g.rect(ox + (i % m.cols) * cell, oy + Math.floor(i / m.cols) * cell, cell + 0.5, cell + 0.5).fill({ color: frameColor(v) }));
    for (let r = 0; r < m.rows; r++) g.rect(ox, oy + r * cell + cell * 0.8, cell * m.cols, cell * 0.2).fill({ color: 0x000000, alpha: 0.18 });
    this.strip.position.set(RX, oy + cell * m.rows + 36);
    this.strip.text = m.status;
    this.strip.style.fill = m.status.includes('FAULT') ? RED : m.status.includes('DRAWING') ? CYAN : INK;
  }
}
