import type { Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import * as blockart from '../../../cpu/render/die/blockart';
import * as nicglyph from '../nic/nicglyph';
import type { Rect } from '../plan/netplan';
import type { RouterBlock, RouterPlanInput } from './routerplan';
import { cpuGeom, memGeom, pktGeom, statGeom, swGeom, wanGeom } from './routergeom';
import { routerSlots } from './routerlive';

// What is inside a block of the router SoC's die (docs/render/net.md "Inside the NIC and the router"): the schematic an engineer would draw for the block, drawn with the CPU die's
// own tools (`glyphKit`) so the router, the card and the CPU's die read as one family. The WAN MAC is an Ethernet frame as its fields, with the address the plan gives; the CPU its
// cores, with the lease the DHCP server gave the PC; the memory controller its channels and the ring of packet buffers; the forwarding engine its stages, the table of clients and the
// rows of the NAT table (the private address and port, the public address and port, the server's); the LAN switch its uplink and its ports, with the MAC address learned on each; the
// traffic block the counters, the speeds and the limit. (The DRAM, the flash, the PHYs, the radio and the power input are 3D bodies on the board: routerboard3d.ts.) Pure drawing into a
// Graphics (and a callback for the few labels); the rectangles the live layer lights are the `*Geom` functions below, shared by the drawing and by `routerLive`.

export const ROUTER_GLYPH_KINDS = new Set<RouterBlock['kind']>(['cpu', 'mem', 'wanmac', 'pkt', 'sw', 'stat']);

/** The area a symbol may use: the block under its name, or null for the SoC's frame (it holds blocks) and for a block too small. */
export function routerGlyphArea(b: Pick<RouterBlock, 'kind' | 'rect'>): Rect | null {
  if (!ROUTER_GLYPH_KINDS.has(b.kind)) {
    return null;
  }
  const r = b.rect,
    head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

const LAB = 11;
/** The stages of the forwarding engine, in the order a frame meets them. */
const PKT_STAGES = ['PARSE', 'LOOKUP', 'REWRITE', 'QUEUE'] as const;

// ---------------------------------------------------------------- the static symbols

type RouterGlyphKit = ReturnType<typeof blockart.glyphKit>;

function glyphOutline(opts: { g: Graphics; line: string; r: Rect }): void {
  const { g, line, r } = opts;
  g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
}

function glyphArrow(opts: {
  g: Graphics;
  stub: RouterGlyphKit['stub'];
  line: string;
  x0: number;
  y: number;
  x1: number;
}): void {
  const { g, stub, line, x0, y, x1 } = opts;
  stub(x0, y, x1, y);
  g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line });
}

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
interface RouterGlyphCtx {
  g: Graphics;
  T: Theme;
  b: RouterBlock;
  put: blockart.Put;
  input: RouterPlanInput;
  a: Rect;
  solid: string;
  soft: string;
  line: string;
  rect: RouterGlyphKit['rect'];
  stub: RouterGlyphKit['stub'];
}

function routerGlyphWanmac(ctx: RouterGlyphCtx): void {
  const { g, put, a, solid, soft, line, rect } = ctx;

  const q = wanGeom(a);
  q.fields.forEach((r, k) => {
    rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
    put(nicglyph.FRAME_FIELDS[k]![0], r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB - 2, r.w * 0.3, r.h * 0.45));
  });
  for (const [r, t] of [
    [q.rx, 'rx'],
    [q.tx, 'tx'],
  ] as [Rect, string][]) {
    put(t, a.x + 9, r.y + r.h / 2, LAB - 1);
    rect(r.x, r.y, r.w, r.h, soft);
    glyphOutline({ g, line, r });
  }
}
function routerGlyphCpu(ctx: RouterGlyphCtx): void {
  const { g, put, input, a, solid, soft, line, rect } = ctx;

  const q = cpuGeom(a, input.cores);
  q.cores.forEach((r, k) => {
    rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
    glyphOutline({ g, line, r });
    put(`C${k}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
  });
}
function routerGlyphMem(ctx: RouterGlyphCtx): void {
  const { g, put, input, a, solid, soft, line, rect } = ctx;

  const q = memGeom(a, input.dram.chips);
  q.chips.forEach((r, k) => {
    rect(r.x, r.y, r.w, r.h, solid);
    glyphOutline({ g, line, r });
    put(`CH${k}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
  });
  for (const r of q.cells) {
    rect(r.x, r.y, r.w, r.h, soft);
  }
  glyphOutline({ g, line, r: q.ringBox });
}
function routerGlyphPkt(ctx: RouterGlyphCtx): void {
  const { g, put, input, a, solid, soft, line, rect, stub } = ctx;

  const q = pktGeom(a, routerSlots(input));
  q.stages.forEach((r, k) => {
    rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
    glyphOutline({ g, line, r });
    put(PKT_STAGES[k]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.4, r.w * 0.17));
    if (k < 3) {
      glyphArrow({ g, stub, line, x0: r.x + r.w + 1, y: r.y + r.h / 2, x1: q.stages[k + 1]!.x - 1 });
    }
  });
  for (const r of q.cells) {
    rect(r.x, r.y, r.w, r.h, soft);
  }
  glyphOutline({ g, line, r: q.table });
  put(
    'NAT: PRIVATE ADDRESS : PORT  >  PUBLIC ADDRESS : PORT  >  SERVER',
    q.caption.x + q.caption.w / 2,
    q.caption.y + q.caption.h / 2,
    9,
  );
  for (const f of q.flows) {
    rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft);
    glyphOutline({ g, line, r: f.bar });
  }
}
function routerGlyphSw(ctx: RouterGlyphCtx): void {
  const { g, put, input, a, solid, soft, line, rect } = ctx;

  const q = swGeom(a, input.lan);
  rect(q.up.x, q.up.y, q.up.w, q.up.h, solid);
  glyphOutline({ g, line, r: q.up });
  put('UP', q.up.x + q.up.w / 2, q.up.y + q.up.h / 2, LAB);
  q.ports.forEach((r) => {
    rect(r.x, r.y, r.w, r.h, soft);
    glyphOutline({ g, line, r });
    // the fabric: a line from the uplink to each port, bent at the middle of the gap
    const y0 = q.up.y + q.up.h / 2,
      x0 = q.up.x + q.up.w,
      x1 = r.x,
      ym = r.y + r.h / 2,
      xm = x0 + (x1 - x0) * 0.5;
    g.moveTo(x0, y0).lineTo(xm, y0).lineTo(xm, ym).lineTo(x1, ym).stroke({ width: 1.1, color: line, alpha: 0.7 });
  });
}
function routerGlyphStat(ctx: RouterGlyphCtx): void {
  const { g, put, a, soft, line, rect } = ctx;

  const q = statGeom(a);
  for (const r of [q.rxBar, q.txBar]) {
    rect(r.x, r.y, r.w, r.h, soft);
    glyphOutline({ g, line, r });
  }
  for (const [r, t] of [
    [q.rx, 'rx'],
    [q.tx, 'tx'],
  ] as [Rect, string][]) {
    put(t, a.x + 12, r.y + r.h / 2, LAB + 2);
  }
}

const ROUTER_GLYPH: Partial<Record<RouterBlock['kind'], (ctx: RouterGlyphCtx) => void>> = {
  wanmac: routerGlyphWanmac,
  cpu: routerGlyphCpu,
  mem: routerGlyphMem,
  pkt: routerGlyphPkt,
  sw: routerGlyphSw,
  stat: routerGlyphStat,
};

function drawRouterGlyph(ctx: RouterGlyphCtx & { kind: RouterBlock['kind'] }): void {
  ROUTER_GLYPH[ctx.kind]?.(ctx);
}

export function routerGlyph(opts: {
  g: Graphics;
  T: Theme;
  block: RouterBlock;
  color: string;
  put: blockart.Put;
  input: RouterPlanInput;
}): void {
  const { g, T, block: b, color: c, put, input } = opts;
  const a = routerGlyphArea(b);
  if (!a) {
    return;
  }
  const kit = blockart.glyphKit(g, T, c, put),
    { solid, soft, line, rect, stub } = kit;
  drawRouterGlyph({ kind: b.kind, g, T, b, put, input, a, solid, soft, line, rect, stub });
}

export { wanGeom, cpuGeom, memGeom, pktGeom, swGeom, statGeom } from './routergeom';
export { routerSlots, routerLive } from './routerlive';
export { natLine } from '../plan/netaddr';
