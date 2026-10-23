import { Container, Graphics } from 'pixi.js';
import { BOARD_TIERS } from '../sim/board/specs';
import {
  BD, BOARD_SEED, BR, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, PCIE_RAILS, PKG, SOCKET_E, VIDEO_Y, rng,
} from './layout';
import { box, disc, label } from './ink';
import { buildBuses, type Bus, type Lane } from './routes';
import { makePalette, type Palette, type Theme } from './theme';

export interface BoardArt {
  root: Container;
  /** Text labels, hidden when zoomed far out. */
  labels: Container;
  /** Routed buses (dim base is drawn here; the live layer lights them). */
  buses: Bus[];
  pal: Palette;
}

const hexPoly = (cx: number, cy: number, r: number): number[] => {
  const p: number[] = [];
  for (let k = 0; k < 6; k++) { const a = k * 1.047 + 0.52; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return p;
};

export function strokeLane(g: Graphics, l: Lane) {
  g.moveTo(l.pts[0]![0], l.pts[0]![1]);
  for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]);
}

/**
 * The static motherboard, built once per (theme, tier) and never touched per frame. Visual hierarchy: the working parts
 * (CPU, DIMMs, cooler, PSU, monitor) are drawn by devices.ts at full contrast; everything here is mixed toward the
 * board colour. Routing is deliberate (routes.ts); there is no random scatter.
 */
export function buildBoard(T: Theme, tier: number): BoardArt {
  const rand = rng(BOARD_SEED);
  const P = makePalette(T);
  const root = new Container();
  const labels = new Container();
  const slots = BOARD_TIERS[tier]?.slots ?? {};
  const nDimm = slots.dimm ?? 0, nPcie = slots.pcie ?? 0, nSata = slots.sata ?? 0;

  const g = new Graphics();
  root.addChild(g);
  const lbl = (t: string, x: number, y: number, s = 38, a = 1) => labels.addChild(label(t, x, y, s, P.silk, { a }));

  // ---- plate ----
  box(g, BD.x, BD.y, BD.w, BD.h, 150, { fill: P.board, stroke: P.edge, lw: 12 });
  box(g, BD.x + 70, BD.y + 70, BD.w - 140, BD.h - 140, 110, { stroke: P.edge, lw: 4, sa: 0.5 });
  for (const [x, y] of [[-3250, -2350], [3250, -2380], [-3250, 2350], [3250, 2350], [0, -2350], [0, 2350]] as const) {
    disc(g, x, y, 90, { fill: P.panel, stroke: P.edge, lw: 8 }); disc(g, x, y, 42, { fill: P.dark });
  }

  // ---- buses: base strokes, all dim and the same colour (the live layer lights the active ones) ----
  const buses = buildBuses();
  const dimm = (b: Bus) => (b.taps ? b.taps.filter((_, i) => i < nDimm) : []);
  for (const b of buses) {
    const power = b.id === 'pwr12' || b.id === 'pwrcpu' || b.id === 'pwr5' || b.id === 'vcore';
    for (const l of b.lanes) strokeLane(g, l);
    g.stroke({ width: b.w, color: power ? P.copper : P.trace, alpha: power ? 0.75 : 0.9, cap: 'round', join: 'round' });
    for (const t of dimm(b)) for (const l of t.lanes) strokeLane(g, l);
    g.stroke({ width: b.w * 0.55, color: P.trace, alpha: 0.7, cap: 'round' });
    if (!power) {
      // via pads where the lanes end
      for (const l of b.lanes) { const a = l.pts[0]!, z = l.pts[l.pts.length - 1]!; g.circle(a[0], a[1], b.w * 0.9).circle(z[0], z[1], b.w * 0.9); }
      g.fill({ color: P.via, alpha: 0.6 });
    }
  }

  // ---- VRM row (core power) ----
  {
    const v = BR.vrm;
    box(g, v.x, v.y, v.w, v.h, 28, { fill: P.sub, stroke: P.edge, lw: 6 });
    for (let i = 0; i < 9; i++) {
      const x = v.x + 60 + i * 282, y = v.y + 50;
      box(g, x, y, 200, 210, 18, { fill: P.panel, stroke: P.edge, lw: 5 });
      disc(g, x + 100, y + 105, 62, { stroke: P.via, lw: 7, sa: 0.7 }); disc(g, x + 100, y + 105, 26, { stroke: P.via, lw: 6, sa: 0.7 });
      disc(g, x + 100, y + 340, 42, { fill: P.dark, stroke: P.via, lw: 5, sa: 0.6 });
    }
    lbl('VRM · CPU CORE', v.x + 10, v.y - 36);
  }
  // ---- DRAM VRM ----
  {
    const v = BR.dvrm;
    box(g, v.x, v.y, v.w, v.h, 22, { fill: P.sub, stroke: P.edge, lw: 6 });
    for (let i = 0; i < 5; i++) {
      const x = v.x + 50 + i * 225;
      box(g, x, v.y + 50, 160, 140, 14, { fill: P.panel, stroke: P.edge, lw: 5 });
      disc(g, x + 80, v.y + 120, 44, { stroke: P.via, lw: 6, sa: 0.7 });
      disc(g, x + 80, v.y + 300, 38, { fill: P.dark, stroke: P.via, lw: 5, sa: 0.6 });
    }
    lbl('VRM · DRAM', v.x + 10, v.y - 36);
  }

  // ---- DIMM sockets (positions beyond this tier are faint) ----
  for (let d = 0; d < 4; d++) {
    const sx = DIMM_X(d), live = d < nDimm, a = live ? 1 : 0.28;
    box(g, sx, DIMM_Y, DIMM_W, DIMM_H, 10, { fill: P.sub, stroke: P.edge, lw: 6, fa: a, sa: a });
    box(g, sx + 20, DIMM_Y + 60, DIMM_W - 40, DIMM_H - 120, 6, { fill: P.dark, fa: a * 0.8 });
    g.rect(sx + 20, DIMM_Y - 20, 130, 22).rect(sx + 20, DIMM_Y + DIMM_H - 2, 130, 22).fill({ color: P.edge, alpha: a });
    if (live) lbl('DIMM_' + (d + 1), sx + 6, DIMM_Y - 62, 34);
  }

  // ---- PCIe rails (first nPcie are real for this tier) ----
  PCIE_RAILS.forEach((r, i) => {
    const live = i < nPcie, a = live ? 1 : 0.3;
    box(g, r.x, r.y, r.w, r.h, 10, { fill: P.sub, stroke: P.edge, lw: 6, fa: a, sa: a });
    g.rect(r.x + 40, r.y + 18, r.w - 80, 24).fill({ color: P.dark, alpha: a });
    for (let k = 0; k < Math.floor(r.w / 60); k++) g.rect(r.x + 56 + k * 60, r.y + 22, 14, 16);
    g.fill({ color: P.via, alpha: 0.55 * a });
  });
  lbl('PCIe x16 · GPU', -2850, 990);
  lbl('PCIe x4', -2850, 2110, 34, 0.7); lbl('PCIe x1', -2850, 2250, 34, 0.7);

  // ---- M.2 SSD ----
  {
    const m = BR.m2;
    box(g, m.x, m.y, m.w, m.h, 12, { fill: P.sub, stroke: P.edge, lw: 6 });
    box(g, m.x + 22, m.y + 24, m.w - 44, m.h - 150, 8, { fill: P.dark, stroke: T.mul, lw: 4, sa: 0.4 });
    for (let i = 0; i < 3; i++) box(g, m.x + 45, m.y + 60 + i * 260, 110, 210, 8, { fill: P.panel, stroke: P.edge, lw: 4 });
    disc(g, m.x + 100, m.y + m.h - 60, 28, { fill: P.via, fa: 0.6 });
    lbl('M.2 NVMe', m.x - 20, m.y - 36);
  }

  // ---- chipset (west of the CPU) ----
  {
    const q = BR.chip;
    box(g, q.x, q.y, q.w, q.h, 26, { fill: P.panel, stroke: T.mul, lw: 6, sa: 0.5 });
    for (let x = q.x + 60; x < q.x + q.w - 40; x += 40) g.moveTo(x, q.y + 44).lineTo(x, q.y + q.h - 44);
    g.stroke({ width: 7, color: P.edge, alpha: 0.9 });
    labels.addChild(label('PCH', q.x + q.w / 2, q.y + q.h / 2, 110, T.mul, { head: true, anchor: [0.5, 0.5], a: 0.6 }));
  }
  // ---- SATA ----
  for (let i = 0; i < 5; i++) {
    const x = BR.sata.x + i * 170, live = i < nSata, a = live ? 1 : 0.35;
    box(g, x, BR.sata.y, 140, BR.sata.h, 10, { fill: P.sub, stroke: P.edge, lw: 5, fa: a, sa: a });
    g.rect(x + 20, BR.sata.y + 20, 100, 30).fill({ color: P.dark, alpha: a });
    g.rect(x + 20, BR.sata.y + 66, 70, 14).fill({ color: P.via, alpha: 0.5 * a });
  }
  lbl('SATA 1-5', BR.sata.x, BR.sata.y + BR.sata.h + 40);

  // ---- power connectors on the east edge (plugs from the PSU sit on these) ----
  const conn = (r: { x: number; y: number; w: number; h: number }, rows: number, cols: number, name: string, a = 1) => {
    box(g, r.x, r.y, r.w, r.h, 14, { fill: P.sub, stroke: P.via, lw: 6, fa: a, sa: a * 0.8 });
    const pw = 70, ph = Math.min(60, (r.h - 60) / rows - 18);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) g.rect(r.x + 40 + j * 110, r.y + 30 + i * ((r.h - 60) / rows) + 6, pw, ph);
    g.fill({ color: P.via, alpha: 0.8 * a });
    labels.addChild(label(name, r.x + r.w, r.y - 34, 32, P.silk, { a, anchor: [1, 0.5] }));
  };
  conn(BR.atx, 12, 2, 'ATX 24-PIN');
  conn(BR.cpw, 4, 2, 'CPU 8-PIN');
  conn(BR.pciew, 3, 2, 'PCIe 6-PIN', 0.55);

  // ---- battery ----
  {
    const b = BR.bat, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    disc(g, cx, cy, 145, { fill: P.panel, stroke: P.edge, lw: 8 }); disc(g, cx, cy, 90, { stroke: P.edge, lw: 6 });
    labels.addChild(label('CR2032', cx, cy, 44, P.silk, { anchor: [0.5, 0.5], weight: '700' }));
  }

  // ---- rear I/O (west edge): ports face left ----
  {
    const q = BR.io;
    box(g, q.x, q.y, q.w, q.h, 30, { fill: P.panel, stroke: P.edge, lw: 10 });
    const port = (x: number, y: number, w: number, h: number, tongue: string | null, ta = 0.5) => {
      box(g, x, y - h / 2, w, h, 10, { fill: P.dark, stroke: P.edge, lw: 5 });
      if (tongue) g.rect(x + 18, y - h * 0.14, w - 36, h * 0.28).fill({ color: tongue, alpha: ta });
    };
    // audio jacks
    ([[T.st], [T.br], [T.ld]] as const).forEach(([c], k) => { port(q.x + 30 + k * 215, -1870, 180, 90, c, 0.55); });
    // ethernet
    port(q.x + 30, -1560, 330, 260, null);
    for (let k = 0; k < 8; k++) g.rect(q.x + 70 + k * 30, -1640, 14, 70);
    g.fill({ color: P.via, alpha: 0.5 });
    g.rect(q.x + 50, -1405, 40, 22).fill({ color: T.st, alpha: 0.55 }); g.rect(q.x + 130, -1405, 40, 22).fill({ color: T.ld, alpha: 0.55 });
    // video outputs (HDMI working, DisplayPort spare)
    const hdmi = (x: number, y: number, w: number, h: number, active: boolean) => {
      const c = 26;
      g.poly([x, y - h / 2 + c, x + c, y - h / 2, x + w, y - h / 2, x + w, y + h / 2, x + c, y + h / 2, x, y + h / 2 - c]);
      g.fill({ color: P.dark }).stroke({ width: 6, color: active ? T.st : P.edge, alpha: active ? 0.85 : 1 });
      g.rect(x + 40, y - h * 0.12, w - 70, h * 0.24).fill({ color: P.via, alpha: 0.7 });
    };
    hdmi(q.x, VIDEO_Y, 240, 120, true);
    hdmi(q.x, VIDEO_Y + 220, 240, 120, false);
    labels.addChild(label('HDMI', q.x + 270, VIDEO_Y, 34, P.silkHi, { anchor: [0, 0.5] }));
    labels.addChild(label('DP', q.x + 270, VIDEO_Y + 220, 34, P.silk, { anchor: [0, 0.5] }));
    // USB-A, two columns
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) port(q.x + 18 + c * 320, (r - 1) * 150, 290, 108, c === 0 ? T.alu : T.alu, 0.5);
    labels.addChild(label('USB', q.x + q.w - 20, 235, 34, P.silk, { anchor: [1, 0.5] }));
    lbl('REAR I/O', q.x + 6, q.y - 36);
  }
  // ---- audio codec (low-key) ----
  {
    const a = BR.audio;
    for (let i = 0; i < 4; i++) disc(g, a.x + 60 + i * 120, a.y + 70, 40, { fill: P.dark, stroke: P.via, lw: 5, sa: 0.6 });
    box(g, a.x + 160, a.y + 160, 200, 140, 12, { fill: P.panel, stroke: P.edge, lw: 5 });
    labels.addChild(label('CODEC', a.x + 260, a.y + 230, 32, P.silk, { anchor: [0.5, 0.5] }));
  }

  // ---- CPU socket frame (empty-socket look; the package covers it when a CPU is installed) ----
  {
    const k = PKG, e = SOCKET_E;
    box(g, k.x - e, k.y - e, k.w + 2 * e, k.h + 2 * e, 90, { fill: P.dark, stroke: T.pin, lw: 10, fa: 0.8, sa: 0.55 });
    for (const [x, y] of [[k.x - e + 30, k.y - e + 30], [k.x + k.w + e - 30, k.y - e + 30], [k.x - e + 30, k.y + k.h + e - 30], [k.x + k.w + e - 30, k.y + k.h + e - 30]] as const) {
      disc(g, x, y, 28, { fill: P.panel });
      g.moveTo(x - 15, y).lineTo(x + 15, y).moveTo(x, y - 15).lineTo(x, y + 15).stroke({ width: 5, color: T.pin, alpha: 0.7 });
    }
    for (let x = k.x + 90; x < k.x + k.w - 80; x += 36) for (let y = k.y + 90; y < k.y + k.h - 80; y += 36) g.rect(x, y, 14, 14);
    g.fill({ color: T.pin, alpha: 0.25 });
    lbl('CPU_SOCKET · LGA-1337', k.x - e, k.y - e - 36, 38);
  }

  // ---- quiet decoration: a few tidy SMD rows, a tiny QR and hex patch, silkscreen ----
  {
    const row = (x: number, y: number, n: number, dx: number, vertical = false) => {
      for (let i = 0; i < n; i++) {
        const px = vertical ? x : x + i * dx, py = vertical ? y + i * dx : y;
        const w = vertical ? 22 : 34, h = vertical ? 34 : 22;
        g.rect(px, py, w, h);
      }
    };
    row(-1250, -1060, 14, 60); row(-2300, 420, 10, 60); row(-2300, 360, 10, 60); row(1100, 1720, 12, 62); row(1100, 1780, 12, 62);
    row(2700, 900, 8, 60, true); row(-1250, 820, 10, 60);
    g.fill({ color: P.panel });
    row(-1250, -1060, 14, 60); row(-2300, 420, 10, 60); row(1100, 1720, 12, 62);
    g.fill({ color: P.via, alpha: 0.25 });
  }
  {
    const hx = BR.hex, hr = 46, cells: [number, number, number][] = [];
    for (let q = 0; q < 8; q++) for (let r = 0; r < 3; r++) {
      const cx = hx.x + 60 + q * hr * 1.73 + (r % 2) * hr * 0.865, cy = hx.y + 50 + r * hr * 1.5;
      cells.push([cx, cy, rand()]);
    }
    for (const c of cells) g.poly(hexPoly(c[0], c[1], hr - 4));
    g.stroke({ width: 4, color: P.edge, alpha: 0.7 });
    for (const c of cells) if (c[2] < 0.2) g.poly(hexPoly(c[0], c[1], hr - 4));
    g.fill({ color: T.br, alpha: 0.14 });
  }
  {
    const q = BR.qr, n = 14, s = (q.w - 40) / n;
    box(g, q.x, q.y, q.w, q.h, 10, { fill: P.dark, stroke: P.edge, lw: 4 });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const corner = (i < 4 && j < 4) || (i > n - 5 && j < 4) || (i < 4 && j > n - 5);
      const on = corner ? i % 3 !== 1 || j % 3 !== 1 : rand() < 0.45;
      if (on) g.rect(q.x + 20 + i * s, q.y + 20 + j * s, s - 1, s - 1);
    }
    g.fill({ color: P.silkHi, alpha: 0.5 });
  }
  labels.addChild(label('PIPELINE CITY', -800, 2330, 90, P.silk, { head: true, a: 0.5 }));
  lbl('MB-9000 · REV A', 1500, 2390, 40, 0.8);

  root.addChild(labels);
  return { root, labels, buses, pal: P };
}
