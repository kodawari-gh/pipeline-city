import { Container, Graphics } from 'pixi.js';
import { BOARD_TIERS } from '../sim/board/specs';
import {
  BD, BOARD_SEED, BR, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, PCIE_RAILS, PKG, buildLanes, inNoGo, rng, type Lane,
} from './layout';
import { box, dashed, disc, label } from './ink';
import type { Theme } from './theme';

export interface BoardArt {
  root: Container;
  /** Text labels, hidden when zoomed far out. */
  labels: Container;
  lanes: Lane[];
  /** Short flowing-dot paths on the decorative traces. */
  flows: Lane[];
}

const hexPoly = (cx: number, cy: number, r: number): number[] => {
  const p: number[] = [];
  for (let k = 0; k < 6; k++) { const a = k * 1.047 + 0.52; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return p;
};

/**
 * The static motherboard: plate, seeded traces, SMD parts, hex field, QR sticker, VRMs, connectors, bus lanes,
 * empty sockets for the slots of this board tier. Built once per (theme, tier) and never touched per frame.
 */
export function buildBoard(T: Theme, tier: number): BoardArt {
  const rand = rng(BOARD_SEED);
  const root = new Container();
  const labels = new Container();
  const slots = BOARD_TIERS[tier]?.slots ?? {};
  const nDimm = slots.dimm ?? 0, nPcie = slots.pcie ?? 0, nSata = slots.sata ?? 0;

  const g = new Graphics();
  root.addChild(g);
  const lbl = (t: string, x: number, y: number, s = 44, a = 0.5) => labels.addChild(label(t, x, y, s, T.ink, { a }));

  // plate, ground-plane hatch, neon border
  box(g, BD.x, BD.y, BD.w, BD.h, 150, { fill: T.board, stroke: T.line, lw: 14 });
  for (let x = BD.x - BD.h; x < BD.x + BD.w; x += 140) {
    // clip the diagonal to the plate by hand
    const x0 = Math.max(x, BD.x), x1 = Math.min(x + BD.h, BD.x + BD.w);
    if (x1 > x0) g.moveTo(x0, BD.y + BD.h - (x0 - x)).lineTo(x1, BD.y + BD.h - (x1 - x));
  }
  g.stroke({ width: 2, color: T.trace, alpha: 0.1 });
  {
    const bx = BD.x + 70, by = BD.y + 70, bw = BD.w - 140, bh = BD.h - 140, c = 130;
    const oct: [number, number][] = [[bx + c, by], [bx + bw - c, by], [bx + bw, by + c], [bx + bw, by + bh - c], [bx + bw - c, by + bh], [bx + c, by + bh], [bx, by + bh - c], [bx, by + c], [bx + c, by]];
    dashed(g, oct, 260, 50);
    g.stroke({ width: 6, color: T.alu, alpha: 0.6 });
  }

  // seeded random traces
  const base: [number, number][][] = [], hi: [number, number][][] = [], hi2: [number, number][][] = [];
  const vias: [number, number][] = [], flows: Lane[] = [];
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  let made = 0, tries = 0;
  while (made < 300 && tries++ < 6000) {
    let x = BD.x + 130 + rand() * (BD.w - 260), y = BD.y + 130 + rand() * (BD.h - 260);
    if (inNoGo(x, y)) continue;
    const pts: [number, number][] = [[x, y]], steps = 3 + Math.floor(rand() * 6);
    let d = Math.floor(rand() * 8), ok = true;
    for (let s = 0; s < steps; s++) {
      d = rand() < 0.25 ? (d + (rand() < 0.5 ? 1 : 7)) % 8 : d;
      const len = 70 + rand() * 280, v = D[d]!, k = v[0] && v[1] ? 0.7071 : 1;
      const nx = x + v[0] * len * k, ny = y + v[1] * len * k;
      if (inNoGo(nx, ny) || inNoGo((x + nx) / 2, (y + ny) / 2)) { if (s < 2) ok = false; break; }
      x = nx; y = ny; pts.push([x, y]);
    }
    if (!ok || pts.length < 3) continue;
    made++;
    const r = rand(), list = r < 0.09 ? hi : r < 0.17 ? hi2 : base;
    list.push(pts);
    vias.push(pts[0]!, pts[pts.length - 1]!);
    if (list !== base && flows.length < 36) flows.push(mkFlow(pts, list === hi ? 0 : 1, rand() * 1000));
  }
  const bund = (x0: number, y0: number, x1: number, y1: number, n: number, sp: number, list: [number, number][][]) => {
    for (let i = 0; i < n; i++) list.push([[x0, y0 + i * sp], [x1 - i * sp - 30, y0 + i * sp], [x1 - i * sp, y0 + i * sp + 30], [x1 - i * sp, y1]]);
  };
  bund(-1300, -2050, 1500, -1750, 10, 22, base); bund(900, -2300, 2850, -1650, 8, 22, hi);
  bund(-2800, 2230, -1000, 2560, 8, 22, base); bund(950, 2350, 2400, 2560, 6, 22, hi2);
  const strokeList = (list: [number, number][][], color: string, alpha: number, w = 10) => {
    for (const p of list) { g.moveTo(p[0]![0], p[0]![1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i]![0], p[i]![1]); }
    g.stroke({ width: w, color, alpha });
  };
  strokeList(base, T.trace, 0.9); strokeList(hi, T.alu, 0.75); strokeList(hi2, T.br, 0.65);
  for (const [x, y] of vias) g.circle(x, y, 16);
  g.fill({ color: T.pin, alpha: 0.8 });

  // small SMD parts in free space
  {
    const smd: [number, number, number, number, number][] = [];
    tries = 0;
    while (smd.length < 700 && tries++ < 9000) {
      const x = BD.x + 130 + rand() * (BD.w - 260), y = BD.y + 130 + rand() * (BD.h - 260);
      if (inNoGo(x, y) || inNoGo(x + 60, y + 40)) continue;
      smd.push([x, y, rand() < 0.5 ? 36 : 24, rand() < 0.5 ? 20 : 34, rand() < 0.12 ? 1 : 0]);
    }
    for (const s of smd) g.rect(s[0], s[1], s[2], s[3]);
    g.fill({ color: T.tile });
    for (const s of smd) if (s[4]) g.rect(s[0], s[1], s[2], s[3]);
    g.fill({ color: T.alu });
    for (const s of smd) { g.rect(s[0], s[1], 7, s[3]); g.rect(s[0] + s[2] - 7, s[1], 7, s[3]); }
    g.fill({ color: T.pin });
  }

  // hex field (cyber pattern)
  {
    const hr = 55, hx = BR.hex, cells: [number, number, number][] = [];
    for (let q = 0; q < 20; q++) for (let r = 0; r < 6; r++) {
      const cx = hx.x + 60 + q * hr * 1.73 + (r % 2) * hr * 0.865, cy = hx.y + 50 + r * hr * 1.5;
      if (cx < hx.x + hx.w - 40) cells.push([cx, cy, rand()]);
    }
    for (const c of cells) if (c[2] < 0.13) g.poly(hexPoly(c[0], c[1], 48));
    g.fill({ color: T.br, alpha: 0.4 });
    for (const c of cells) if (c[2] > 0.9) g.poly(hexPoly(c[0], c[1], 48));
    g.fill({ color: T.alu, alpha: 0.35 });
    for (const c of cells) g.poly(hexPoly(c[0], c[1], 48));
    g.stroke({ width: 5, color: T.trace, alpha: 0.8 });
  }
  // QR-like sticker
  {
    const q = BR.qr;
    box(g, q.x + 10, q.y + 10, 400, 400, 14, { fill: T.die });
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
      const corner = (i < 6 && j < 6) || (i > 13 && j < 6) || (i < 6 && j > 13);
      const on = corner ? i % 5 === 0 || j % 5 === 0 || (i % 5 > 1 && j % 5 > 1 && i % 5 < 4 && j % 5 < 4) : rand() < 0.45;
      if (on) g.rect(q.x + 30 + i * 17, q.y + 30 + j * 17, 15, 15);
    }
    g.fill({ color: T.ink, alpha: 0.75 });
  }
  // mounting holes
  for (const [x, y] of [[-3250, -2350], [3250, -2350], [-3250, 2550], [3250, 2550], [3250, 150], [-3250, 150], [-100, 2550], [1000, -2350], [-1000, -2350]] as const) {
    disc(g, x, y, 110, { fill: T.pin, fa: 0.8 }); disc(g, x, y, 60, { fill: T.bg });
  }

  // ---- VRMs ----
  const ind = (x: number, y: number, s: number) => {
    box(g, x - s / 2, y - s / 2, s, s, 18, { fill: T.tile, stroke: T.line, lw: 6 });
    disc(g, x, y, s * 0.32, { stroke: T.pin, lw: 6 }); disc(g, x, y, s * 0.15, { stroke: T.pin, lw: 6 });
    g.moveTo(x - s * 0.4, y - s / 2 + 8).lineTo(x + s * 0.4, y - s / 2 + 8).stroke({ width: 7, color: T.alu });
  };
  const cap = (x: number, y: number, r: number) => {
    disc(g, x, y, r, { fill: T.dot, stroke: T.pin, lw: 7 });
    g.moveTo(x, y).arc(x, y, r - 8, -1.2, 1.2).lineTo(x, y).fill({ color: T.line });
  };
  box(g, -2250, -760, 110, 1520, 16, { fill: T.tile, stroke: T.line, lw: 6 });
  for (let y = -730; y < 750; y += 28) g.moveTo(-2230, y).lineTo(-2160, y);
  g.stroke({ width: 6, color: T.line, alpha: 0.6 });
  for (let i = 0; i < 8; i++) { cap(-2000, -680 + i * 190, 62); ind(-1720, -690 + i * 200, 170); ind(-1490, -690 + i * 200, 170); }
  for (let i = 0; i < 10; i++) { ind(-990 + i * 220, -1480, 170); cap(-880 + i * 220, -1290, 52); }
  box(g, -1100, -1620, 2200, 70, 16, { fill: T.tile, stroke: T.line, lw: 6 });
  lbl('VRM_CORE', -2250, -800, 50); lbl('VRM_AUX', 800, -1640, 50);
  // copper pours + CPU power traces
  for (let y = -450; y <= 450; y += 150) g.moveTo(-1400, y).lineTo(PKG.x - 190, y);
  for (let x = -450; x <= 450; x += 150) g.moveTo(x, -1180).lineTo(x, PKG.y - 20);
  g.stroke({ width: 34, color: T.pin, alpha: 0.5 });
  g.moveTo(-1620, -2220).lineTo(-1620, -1700).lineTo(-1400, -1480).lineTo(-1100, -1480).stroke({ width: 30, color: T.pin, alpha: 0.5 });

  // ---- DIMM sockets (all positions; ones beyond this tier are faint) ----
  for (let d = 0; d < 4; d++) {
    const sx = DIMM_X(d), live = d < nDimm, a = live ? 1 : 0.28;
    box(g, sx, DIMM_Y, DIMM_W, DIMM_H, 10, { fill: T.sub, stroke: T.line, lw: 6, fa: a, sa: a });
    box(g, sx + 14, DIMM_Y + 50, 142, DIMM_H - 100, 6, { fill: T.die, stroke: live ? T.alu : T.line, lw: 4, fa: a, sa: live ? 0.5 : 0.3 });
    g.rect(sx + 20, DIMM_Y - 20, 130, 22).rect(sx + 20, DIMM_Y + DIMM_H - 2, 130, 22).fill({ color: T.line, alpha: a });
    for (let k = 0; k < 24; k++) g.rect(sx + 22 + k * 5.4, DIMM_Y + DIMM_H - 58, 3.4, 50);
    g.fill({ color: T.pin, alpha: 0.5 * a });
    if (live) lbl('DIMM_' + (d + 1), sx + 8, DIMM_Y + DIMM_H + 60, 32, 0.45);
  }
  // memory taps under the DIMMs
  for (let d = 0; d < 4; d++) for (let i = 0; i < 14; i++) { const x = DIMM_X(d) + 22 + i * 8; g.moveTo(x, 835).lineTo(x, 890 + i * 12); }
  g.stroke({ width: 4, color: T.alu, alpha: 0.45 });

  // ---- buses (base strokes) ----
  const lanes = buildLanes(rand);
  for (const [kind, col, a] of [['mem', T.alu, 0.55], ['pcie', T.br, 0.55], ['dmi', T.mul, 0.55]] as const) {
    for (const l of lanes) if (l.kind === kind) { g.moveTo(l.pts[0]![0], l.pts[0]![1]); for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]); }
    g.stroke({ width: 7, color: col, alpha: a });
  }

  // ---- PCIe rails (empty slots; first nPcie are real for this tier) ----
  PCIE_RAILS.forEach((r, i) => {
    const live = i < nPcie, a = live ? 1 : 0.3;
    box(g, r.x, r.y, r.w, r.h, 10, { fill: T.sub, stroke: live ? T.br : T.line, lw: 6, fa: a, sa: a });
    g.rect(r.x + 40, r.y + 18, r.w - 80, 24).fill({ color: T.die, alpha: a });
    for (let k = 0; k < Math.floor(r.w / 40); k++) g.rect(r.x + 50 + k * 40, r.y + 22, 14, 16);
    g.fill({ color: T.pin, alpha: 0.5 * a });
  });
  lbl('PCIEX16_1', -2850, 1000, 50); lbl('PCIEX4_2', -2850, 2090, 44, 0.35); lbl('PCIEX1_3', -2850, 2230, 44, 0.35);

  // ---- M.2 SSD (decor) ----
  {
    const m = BR.m2;
    box(g, m.x, m.y, m.w, m.h, 12, { fill: T.sub, stroke: T.line, lw: 6 });
    box(g, m.x + 20, m.y + 20, m.w - 40, m.h - 120, 8, { fill: T.die, stroke: T.mul, lw: 6 });
    for (let i = 0; i < 3; i++) box(g, m.x + 45, m.y + 50 + i * 270, 110, 230, 8, { fill: T.tile, stroke: T.line, lw: 6 });
    box(g, m.x + 55, m.y + 880, 90, 90, 8, { fill: T.mul }); disc(g, m.x + 100, m.y + 1230, 30, { fill: T.pin });
    lbl('M.2_1 NVME', m.x - 10, m.y - 30);
  }
  // ---- chipset ----
  {
    const q = BR.chip;
    box(g, q.x, q.y, q.w, q.h, 28, { fill: T.tile, stroke: T.mul, lw: 8 });
    for (let x = q.x + 50; x < q.x + q.w - 40; x += 34) g.moveTo(x, q.y + 40).lineTo(x, q.y + q.h - 40);
    g.stroke({ width: 8, color: T.line, alpha: 0.8 });
    labels.addChild(label('PCH', q.x + q.w / 2, q.y + q.h / 2, 120, T.mul, { head: true, anchor: [0.5, 0.5] }));
  }
  // ---- SATA, ATX, CPU power, battery ----
  for (let i = 0; i < 5; i++) {
    const x = 2420 + i * 170, live = i < nSata, a = live ? 1 : 0.3;
    box(g, x, 2290, 140, 100, 10, { fill: T.sub, stroke: T.line, lw: 6, fa: a, sa: a });
    g.rect(x + 20, 2310, 100, 28).fill({ color: T.tile, alpha: a });
    g.rect(x + 20, 2352, 70, 12).fill({ color: T.pin, alpha: a });
  }
  lbl('SATA_1-5', 2420, 2260);
  {
    const a = BR.atx;
    box(g, a.x, a.y, a.w, a.h, 14, { fill: T.sub, stroke: T.pin, lw: 7 });
    for (let r = 0; r < 12; r++) for (let c = 0; c < 2; c++) g.rect(a.x + 70 + c * 120, a.y + 50 + r * 76, 70, 44);
    g.fill({ color: T.pin, alpha: 0.9 });
    lbl('ATX_24PIN', a.x - 30, a.y - 30);
  }
  {
    const a = BR.cpw;
    box(g, a.x, a.y, a.w, a.h, 14, { fill: T.sub, stroke: T.pin, lw: 7 });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g.rect(a.x + 50 + c * 120, a.y + 40 + r * 70, 70, 44);
    g.fill({ color: T.pin });
    lbl('CPU_PWR_8PIN', a.x, a.y - 22);
  }
  {
    const b = BR.bat;
    disc(g, b.x + 170, b.y + 170, 165, { fill: T.pin, fa: 0.85, stroke: T.line, lw: 8 }); disc(g, b.x + 170, b.y + 170, 110, { stroke: T.line, lw: 8 });
    labels.addChild(label('CR2032', b.x + 170, b.y + 170, 50, T.line, { anchor: [0.5, 0.5], weight: '700' }));
  }
  // ---- rear I/O + audio ----
  {
    const q = BR.io;
    box(g, q.x - 40, q.y, q.w + 40, q.h, 30, { fill: T.sub, stroke: T.line, lw: 14 });
    for (let r = 0; r < 5; r++) {
      const y = q.y + 60 + r * 380;
      if (r < 3) {
        for (const [dx, dy, col] of [[0, 0, T.alu], [260, 0, T.alu], [0, 160, T.mul], [260, 160, T.mul]] as const) {
          box(g, q.x - 10 + dx, y + dy - 20, 230, 130, 10, { fill: col, fa: 0.75 });
          g.rect(q.x + 10 + dx, y + dy + 20, 190, 40).fill({ color: T.die });
        }
      } else if (r === 3) {
        box(g, q.x - 10, y - 20, 250, 250, 12, { fill: T.tile, stroke: T.pin, lw: 7 });
        g.rect(q.x + 20, y + 190, 40, 24).fill({ color: T.st }); g.rect(q.x + 170, y + 190, 40, 24).fill({ color: T.ld });
        box(g, q.x + 280, y, 300, 130, 10, { fill: T.line });
      } else {
        [T.st, T.br, T.ld].forEach((c, k) => { disc(g, q.x + 70 + k * 190, y + 80, 62, { fill: c }); disc(g, q.x + 70 + k * 190, y + 80, 26, { fill: T.bg }); });
      }
    }
    lbl('REAR_IO', q.x, q.y - 28);
    const a = BR.audio;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) cap(a.x + 100 + i * 160, a.y + 90 + j * 190, 66);
    box(g, a.x + 120, a.y + 520, 220, 220, 14, { fill: T.tile, stroke: T.line, lw: 6 });
    labels.addChild(label('CODEC', a.x + 230, a.y + 630, 40, T.mute, { anchor: [0.5, 0.5] }));
    lbl('AUDIO', a.x, a.y - 22);
  }
  // CPU socket frame (empty socket look; the package covers it when a CPU is installed)
  {
    const k = PKG, e = 46;
    box(g, k.x - e, k.y - e, k.w + 2 * e, k.h + 2 * e, 90, { fill: T.bg, stroke: T.pin, lw: 12, fa: 0.55, sa: 0.75 });
    for (const [x, y] of [[k.x - e + 30, k.y - e + 30], [k.x + k.w + e - 30, k.y - e + 30], [k.x - e + 30, k.y + k.h + e - 30], [k.x + k.w + e - 30, k.y + k.h + e - 30]] as const) {
      disc(g, x, y, 30, { fill: T.line });
      g.moveTo(x - 16, y).lineTo(x + 16, y).moveTo(x, y - 16).lineTo(x, y + 16).stroke({ width: 5, color: T.pin });
    }
    // land grid (visible only while the socket is empty)
    for (let x = k.x + 90; x < k.x + k.w - 80; x += 36) for (let y = k.y + 90; y < k.y + k.h - 80; y += 36) g.rect(x, y, 14, 14);
    g.fill({ color: T.pin, alpha: 0.35 });
    g.moveTo(k.x - e, k.y + 160).lineTo(k.x - 190, k.y + 160).lineTo(k.x - 190, k.y + k.h - 220).stroke({ width: 18, color: T.pin, alpha: 0.85, cap: 'round', join: 'round' });
    disc(g, k.x - 190, k.y + k.h - 220, 24, { fill: T.pin });
    lbl('CPU_SOCKET · LGA-1337', k.x - e, k.y - e - 40, 46, 0.7);
  }
  // ---- silkscreen ----
  labels.addChild(label('PIPELINE CITY', -1200, -1900, 150, T.ink, { head: true, a: 0.26 }));
  lbl('MB-9000 · REV A · MADE IN CYBERSPACE', 300, 2640, 60, 0.26);
  labels.addChild(label('»»»»»»»»', 1250, -2330, 90, T.br, { a: 0.85, weight: '700' }));

  root.addChild(labels);
  return { root, labels, lanes, flows };
}

function mkFlow(pts: [number, number][], hue: number, ph: number): Lane {
  let len = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); seg.push(d); len += d; }
  return { kind: hue === 0 ? 'mem' : 'pcie', pts, seg, len, ph };
}
