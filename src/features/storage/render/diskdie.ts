// The dies inside a drive's chips and its platter, as the 3D drives show them (docs/render/live.md "Drives"): the same blocks the 2D cutaway names (`diskfloor.ts`), now each on the chip that
// holds them. A flash drive's controller die carries the host interface, the cores that run the flash translation layer, the queues (NVMe), the ECC engine, the DRAM controller and
// one engine per channel (`ARCH`); a NAND package holds its dies, each four planes of block cells with their page buffers over a strip of control and I/O; the cache DRAM is a DRAM die
// (`ramdie.ts`). A hard disk's platter is its tracks, its servo wedges and its hub. The plans are pure data (`ctrlDiePlan`, `nandDiePlan`, `platterPlan`); the `*Art` functions draw them in
// the die's style (the CPU die's tints and rim lines). Tested in diskdie.test.ts.
import { Container, Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { accentOf } from './diskart';
import { ARCH } from './diskplan';
import type { DriveKind } from './drives';

export interface DieRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CTRL_DIE = { w: 200, h: 200 } as const,
  NAND_DIE = { w: 252, h: 168 } as const,
  PLATTER = { w: 200, h: 200, R: 100 } as const;

export type CtrlKind = 'iface' | 'cores' | 'queue' | 'ecc' | 'cache' | 'channel';
export interface CtrlBlock {
  id: string;
  kind: CtrlKind;
  label: string;
  rect: DieRect;
  grid?: { cols: number; rows: number };
}
export interface CtrlLink {
  kind: 'host' | 'data' | 'channel' | 'ctl';
  pts: [number, number][];
}
export interface CtrlPlan {
  w: number;
  h: number;
  blocks: CtrlBlock[];
  links: CtrlLink[];
  channels: number;
}

const rc = (x: number, y: number, w: number, h: number): DieRect => ({ x, y, w, h });
const mid = (r: DieRect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** The plan of the controller die of a flash drive: the interface down the west edge, the cores with their ECC and DRAM controller in the middle, an engine for each channel down the east edge. */
export function ctrlDiePlan(kind: Exclude<DriveKind, 'hdd'>): CtrlPlan {
  const nvme = kind === 'ssd-nvme',
    n = ARCH[kind].channels,
    { w, h } = CTRL_DIE,
    blocks: CtrlBlock[] = [],
    links: CtrlLink[] = [];
  const iface = rc(8, 52, 40, 96),
    cores = rc(58, nvme ? 60 : 24, 86, nvme ? 56 : 66),
    ecc = rc(58, nvme ? 122 : 98, 86, 32),
    cache = rc(58, 160, 86, 32);
  blocks.push(
    { id: 'iface', kind: 'iface', label: nvme ? 'PCIe x4' : 'SATA', rect: iface },
    { id: 'cores', kind: 'cores', label: 'FTL CORES', rect: cores, grid: { cols: 4, rows: 2 } },
    { id: 'ecc', kind: 'ecc', label: 'LDPC ECC', rect: ecc },
    { id: 'cache', kind: 'cache', label: 'DRAM CTL', rect: cache },
  );
  // (the host link runs level with the middle of the interface, or the cores' edge where that lies outside them)
  const hy = Math.min(cores.y + cores.h - 6, Math.max(cores.y + 6, mid(iface)[1])),
    cx = mid(cores)[0];
  links.push(
    {
      kind: 'host',
      pts: [
        [iface.x + iface.w, hy],
        [cores.x, hy],
      ],
    },
    {
      kind: 'data',
      pts: [
        [cx, cores.y + cores.h],
        [cx, ecc.y],
      ],
    },
    {
      kind: 'data',
      pts: [
        [cx, ecc.y + ecc.h],
        [cx, cache.y],
      ],
    },
  );
  if (nvme) {
    const q = rc(58, 8, 86, 44);
    blocks.push({ id: 'queue', kind: 'queue', label: 'QUEUES', rect: q, grid: { cols: 4, rows: 2 } });
    links.push({
      kind: 'ctl',
      pts: [
        [mid(q)[0], q.y + q.h],
        [mid(q)[0], cores.y],
      ],
    });
  }
  // an engine per channel down the east edge, fed from the cores by a lane of its own (a stub down the gap, one apart from the next)
  const eh = n === 1 ? 64 : 38,
    gap = n === 1 ? 0 : 8,
    top = n === 1 ? 70 : 8;
  for (let i = 0; i < n; i++) {
    const r = rc(154, top + i * (eh + gap), 38, eh),
      ey = mid(r)[1],
      sy = cores.y + (cores.h * (i + 0.5)) / n,
      bx = cores.x + cores.w + 2 + i * 1.8;
    blocks.push({ id: `ch${i}`, kind: 'channel', label: `CH${i}`, rect: r });
    links.push({
      kind: 'channel',
      pts: [
        [cores.x + cores.w, sy],
        [bx, sy],
        [bx, ey],
        [r.x, ey],
      ],
    });
  }
  return { w, h, blocks, links, channels: n };
}

export interface NandPlane {
  rect: DieRect;
  array: DieRect;
  decoder: DieRect;
  buffer: DieRect;
}
export interface NandTile {
  rect: DieRect;
  planes: NandPlane[];
  periphery: { id: string; label: string; rect: DieRect }[];
}
export interface NandPlan {
  w: number;
  h: number;
  tiles: NandTile[];
}

/** One NAND die over `r`: four planes in two rows (the cell array with its row decoder at the west and its page buffer along the foot) over a strip of control and I/O. */
function nandTile(r: DieRect): NandTile {
  const k = r.w / NAND_DIE.w,
    m = 8 * k,
    pw = (r.w - 3 * m) / 2,
    ph = 58 * k,
    planes: NandPlane[] = [];
  for (let i = 0; i < 4; i++) {
    const p = rc(r.x + m + (i % 2) * (pw + m), r.y + m + Math.floor(i / 2) * (ph + m * 0.9), pw, ph);
    planes.push({
      rect: p,
      decoder: rc(p.x + 1 * k, p.y + 1 * k, 7 * k, p.h - 2 * k),
      array: rc(p.x + 9 * k, p.y + 1 * k, p.w - 10 * k, p.h - 12 * k),
      buffer: rc(p.x + 9 * k, p.y + p.h - 10 * k, p.w - 10 * k, 9 * k),
    });
  }
  const sy = r.y + m + 2 * (ph + m * 0.9) + m * 0.2,
    sh = r.y + r.h - m - sy,
    share = [0.34, 0.3, 0.2, 0.16],
    names = ['CONTROL', 'I/O + PADS', 'CHARGE PUMP', 'ECC'],
    periphery: NandTile['periphery'] = [];
  let x = r.x + m;
  names.forEach((n, i) => {
    const w = (r.w - 2 * m) * share[i]! - 2 * k;
    periphery.push({ id: n, label: n, rect: rc(x, sy, w, sh) });
    x += w + 2 * k;
  });
  return { rect: r, planes, periphery };
}

/** The plan of a NAND package's face: one die, or four stacked dies shown side by side (two by two). */
export function nandDiePlan(dies: 1 | 4): NandPlan {
  const { w, h } = NAND_DIE;
  if (dies === 1) return { w, h, tiles: [nandTile(rc(0, 0, w, h))] };
  const tw = (w - 4) / 2,
    th = (h - 4) / 2;
  return {
    w,
    h,
    tiles: [0, 1, 2, 3].map((i) => nandTile(rc(1 + (i % 2) * (tw + 2), 1 + Math.floor(i / 2) * (th + 2), tw, th))),
  };
}

const tint = (T: Theme, c: string, a: number): string => mix(T.die, c, a);

/** A block of the controller die: tinted and rimmed in its colour, its cell grid, its name. */
function ctrlBlock(T: Theme, g: Graphics, t: Container, b: CtrlBlock, c: string): void {
  const r = b.rect;
  g.roundRect(r.x, r.y, r.w, r.h, 3)
    .fill({ color: tint(T, c, 0.12) })
    .stroke({ width: 1.2, color: c });
  if (b.grid) {
    const gx = r.x + 6,
      gy = r.y + 17,
      gw = r.w - 12,
      gh = r.y + r.h - 5 - gy,
      cw = gw / b.grid.cols,
      ch = gh / b.grid.rows;
    for (let i = 0; i < b.grid.cols * b.grid.rows; i++)
      g.roundRect(gx + (i % b.grid.cols) * cw + 1, gy + Math.floor(i / b.grid.cols) * ch + 1, cw - 2, ch - 2, 1.5);
    g.fill({ color: mix(T.die, c, 0.4) });
  }
  if (b.kind === 'iface') {
    const tx = label(b.label, r.x + r.w / 2 + 3, r.y + r.h / 2, 11, T.ink, { weight: '700', anchor: [0.5, 0.5] });
    tx.rotation = -Math.PI / 2;
    t.addChild(tx);
    return;
  }
  t.addChild(
    label(b.label, r.x + 5, r.y + 8, Math.min(9.5, (r.w - 8) / (b.label.length * 0.64)), T.ink, {
      weight: '700',
      a: 0.95,
    }),
  );
}

/** The controller die's art over `ctrlDiePlan`: the silicon with its rim and pads, the blocks, the traces between them ending in pads. */
export function ctrlDieArt(T: Theme, kind: Exclude<DriveKind, 'hdd'>): Container {
  const plan = ctrlDiePlan(kind),
    root = new Container(),
    g = new Graphics(),
    t = new Container(),
    accent = accentOf(T, kind),
    colors: Record<CtrlKind, string> = {
      iface: T.alu,
      cores: T.br,
      queue: T.st,
      ecc: T.mul,
      cache: T.ld,
      channel: T.mul,
    };
  root.addChild(g, t);
  g.roundRect(0, 0, plan.w, plan.h, 5)
    .fill({ color: mix(T.die, '#000000', 0.3) })
    .stroke({ width: 1.6, color: mix(T.line, accent, 0.6) });
  const pad = 2.4;
  for (let p = 8; p + pad < plan.w - 6; p += pad * 2.4) {
    g.rect(p, 2.4, pad, pad);
    g.rect(p, plan.h - 2.4 - pad, pad, pad);
  }
  g.fill({ color: T.pin, alpha: 0.6 });
  g.poly([2, 2, 14, 2, 2, 14]).fill({ color: accent, alpha: 0.9 });
  const lc = { host: T.alu, data: T.st, channel: T.mul, ctl: T.mute };
  for (const l of plan.links) {
    g.moveTo(l.pts[0]![0], l.pts[0]![1]);
    for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]);
    g.stroke({ width: l.kind === 'channel' ? 1.4 : 1.8, color: lc[l.kind], alpha: 0.85, join: 'round' });
    for (const p of [l.pts[0]!, l.pts[l.pts.length - 1]!])
      g.rect(p[0] - 1.8, p[1] - 1.8, 3.6, 3.6).fill({ color: lc[l.kind] });
  }
  for (const b of plan.blocks) ctrlBlock(T, g, t, b, colors[b.kind]);
  return root;
}

/** One NAND die's art: the silicon, the planes' cell arrays (a grid of block cells) with their decoders and page buffers, the periphery's blocks, a row of pads. */
function drawNandTile(T: Theme, g: Graphics, t: Container, tile: NandTile, accent: string): void {
  const r = tile.rect,
    k = r.w / NAND_DIE.w;
  g.roundRect(r.x, r.y, r.w, r.h, 4 * k)
    .fill({ color: mix(T.die, '#000000', 0.22) })
    .stroke({ width: Math.max(0.6, 1.2 * k), color: mix(T.line, accent, 0.6) });
  tile.planes.forEach((p, i) => {
    const a = p.array,
      cols = 14,
      rows = 5,
      cw = a.w / cols,
      ch = a.h / rows;
    g.roundRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h, 2 * k)
      .fill({ color: tint(T, T.mul, 0.1) })
      .stroke({ width: Math.max(0.5, 0.9 * k), color: T.mul, alpha: 0.85 });
    for (let j = 0; j < cols * rows; j++)
      g.rect(a.x + (j % cols) * cw + 0.4 * k, a.y + Math.floor(j / cols) * ch + 0.4 * k, cw - 0.8 * k, ch - 0.8 * k);
    g.fill({ color: mix(T.die, T.mul, 0.4) });
    g.rect(p.decoder.x, p.decoder.y, p.decoder.w, p.decoder.h).fill({ color: T.st, alpha: 0.45 });
    g.rect(p.buffer.x, p.buffer.y, p.buffer.w, p.buffer.h).fill({ color: T.ld, alpha: 0.55 });
    if (k > 0.7) t.addChild(label(`PLANE ${i}`, a.x + 3, a.y + 6, 5.5, T.ink, { weight: '700', a: 0.85 }));
  });
  const lc = [T.br, T.alu, T.ld, T.mul];
  tile.periphery.forEach((b, i) => {
    g.roundRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 1.5 * k)
      .fill({ color: tint(T, lc[i % 4]!, 0.16) })
      .stroke({ width: Math.max(0.5, 0.8 * k), color: lc[i % 4]!, alpha: 0.85 });
    if (k > 0.7)
      t.addChild(
        label(
          b.label,
          b.rect.x + 3,
          b.rect.y + b.rect.h / 2,
          Math.min(5.2, (b.rect.w - 5) / (b.label.length * 0.62)),
          T.ink,
          { weight: '700', a: 0.9 },
        ),
      );
  });
  const pad = 2 * k;
  for (let x = r.x + 6 * k; x + pad < r.x + r.w - 5 * k; x += pad * 2.3) g.rect(x, r.y + r.h - 4.2 * k, pad, pad);
  g.fill({ color: T.pin, alpha: 0.65 });
  g.poly([r.x + 1 * k, r.y + 1 * k, r.x + 9 * k, r.y + 1 * k, r.x + 1 * k, r.y + 9 * k]).fill({
    color: accent,
    alpha: 0.9,
  });
}

/** A NAND package's face: its dies (`nandDiePlan`) on the dark substrate. */
export function nandDieArt(T: Theme, dies: 1 | 4, kind: Exclude<DriveKind, 'hdd'> = 'ssd-nvme'): Container {
  const plan = nandDiePlan(dies),
    root = new Container(),
    g = new Graphics(),
    t = new Container();
  root.addChild(g, t);
  g.roundRect(0, 0, plan.w, plan.h, 4).fill({ color: mix(T.die, '#000000', 0.45) });
  for (const tile of plan.tiles) drawNandTile(T, g, t, tile, accentOf(T, kind));
  if (dies === 1) t.addChild(label('NAND', 14, 6, 6, T.mute, { a: 0.9 }));
  return root;
}

export interface PlatterPlan {
  R: number;
  hub: number;
  clamp: number;
  tracks: number;
  sectors: number;
  band: [number, number];
}

/** The platter's plan in its own units (`PLATTER`): the data band between two radii, the tracks in it, the servo wedges across it, the hub and its clamp ring. */
export function platterPlan(): PlatterPlan {
  const R = PLATTER.R;
  return { R, hub: R * 0.16, clamp: R * 0.3, tracks: 28, sectors: 24, band: [R * 0.36, R * 0.97] };
}

/** The platter: a dark disc with a lighter rim, its tracks as fine rings, its servo wedges, a sheen across it, the hub clamped at the middle. */
export function platterArt(T: Theme): Container {
  const p = platterPlan(),
    root = new Container(),
    g = new Graphics(),
    cx = PLATTER.w / 2,
    cy = PLATTER.h / 2,
    accent = accentOf(T, 'hdd');
  root.addChild(g);
  g.circle(cx, cy, p.R)
    .fill({ color: mix(T.die, '#000000', 0.4) })
    .stroke({ width: 1.4, color: mix(T.line, accent, 0.7) });
  g.circle(cx, cy, p.R * 0.985).stroke({ width: 0.6, color: '#ffffff', alpha: 0.18 });
  // the tracks, the outer ones a little brighter
  for (let i = 0; i < p.tracks; i++) {
    const r = p.band[1] - ((p.band[1] - p.band[0]) * i) / (p.tracks - 1);
    g.circle(cx, cy, r).stroke({ width: 0.45, color: accent, alpha: i % 4 === 0 ? 0.34 : 0.15 });
  }
  // the servo wedges: curved a little, as the arm swings
  for (let s = 0; s < p.sectors; s++) {
    const a = (s / p.sectors) * Math.PI * 2 - Math.PI / 2;
    g.moveTo(cx + Math.cos(a) * p.band[0], cy + Math.sin(a) * p.band[0]);
    for (let k = 1; k <= 6; k++) {
      const r = p.band[0] + ((p.band[1] - p.band[0]) * k) / 6,
        b = a + 0.05 * (k / 6);
      g.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r);
    }
    g.stroke({ width: 0.55, color: T.ink, alpha: 0.18 });
  }
  // the parking zone and the landing ring, inside the data band
  g.circle(cx, cy, p.band[0] - 3).stroke({ width: 0.8, color: accent, alpha: 0.5 });
  for (let k = 0; k < 2; k++) {
    const a0 = k * Math.PI + 0.5;
    g.moveTo(cx, cy)
      .arc(cx, cy, p.R * 0.97, a0 - 0.24, a0 + 0.24)
      .closePath()
      .fill({ color: '#ffffff', alpha: 0.06 });
  }
  g.circle(cx, cy, p.clamp)
    .fill({ color: mix(T.die, T.ink, 0.22) })
    .stroke({ width: 1, color: accent, alpha: 0.8 });
  for (let k = 0; k < 6; k++)
    g.circle(
      cx + Math.cos((k / 6) * Math.PI * 2) * p.clamp * 0.72,
      cy + Math.sin((k / 6) * Math.PI * 2) * p.clamp * 0.72,
      1.6,
    ).fill({ color: mix(T.die, '#000000', 0.5) });
  g.circle(cx, cy, p.hub)
    .fill({ color: mix(T.die, T.ink, 0.4) })
    .stroke({ width: 0.8, color: T.ink, alpha: 0.5 });
  return root;
}
