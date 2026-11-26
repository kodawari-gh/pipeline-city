import type { Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import * as blockart from '../../../cpu/render/die/blockart';
import * as nicglyph from '../nic/nicglyph';
import { natLine } from '../plan/netaddr';
import { fmtFrames, fmtPct, fmtSpeed } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import type { RouterBlock, RouterPlanInput } from './routerplan';
import * as routershow from './routershow';

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
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);
/** The stages of the forwarding engine, in the order a frame meets them. */
const PKT_STAGES = ['PARSE', 'LOOKUP', 'REWRITE', 'QUEUE'] as const;

// ---------------------------------------------------------------- the geometry the drawing and the live layer share

/** The WAN MAC: the frame as its fields, the lane a received frame runs along and the lane a sent one runs along under it, then the address the plan gives and the MAC address of the jack. */
export function wanGeom(a: Rect) {
  const total = nicglyph.FRAME_FIELDS.reduce((s, f) => s + f[1], 0),
    fh = 20;
  let { x } = a;
  const fields = nicglyph.FRAME_FIELDS.map((f) => {
    const w = (a.w * f[1]) / total,
      r = R(x, a.y + 2, w - 1.5, fh);
    x += w;
    return r;
  });
  const lane = (y: number) => R(a.x + 22, y, a.w - 22, 10);
  const rx = lane(a.y + fh + 8),
    tx = lane(rx.y + rx.h + 6);
  return { fields, rx, tx, ip: R(a.x, tx.y + tx.h + 8, a.w, 24), mac: R(a.x, tx.y + tx.h + 34, a.w, 22) };
}

/** The CPU: its cores as tiles (up to four to a row) and the two lines under them. */
export function cpuGeom(a: Rect, cores: number) {
  const cols = Math.min(cores, 4),
    rows = Math.ceil(cores / cols),
    noteH = 46,
    gh = a.h - noteH - 6,
    th = Math.max(10, Math.min(34, (gh - (rows - 1) * 6) / rows)),
    tw = Math.min(56, (a.w - (cols - 1) * 8) / cols);
  const x0 = a.x + (a.w - (cols * tw + (cols - 1) * 8)) / 2;
  return {
    cores: Array.from({ length: cores }, (_, k) =>
      R(x0 + (k % cols) * (tw + 8), a.y + Math.floor(k / cols) * (th + 6), tw, th),
    ),
    lease: R(a.x, a.y + a.h - noteH + 2, a.w, 22),
    via: R(a.x, a.y + a.h - 22, a.w, 20),
  };
}

/** The memory controller: a channel for each DRAM chip, the ring of packet buffers under them and the line under that. */
export function memGeom(a: Rect, chips: number) {
  const gap = 8,
    cw = Math.min(70, (a.w - (chips - 1) * gap) / chips),
    ch = Math.min(30, a.h * 0.28),
    ring = 20,
    cell = (a.w - 8) / ring;
  const x0 = a.x + (a.w - (chips * cw + (chips - 1) * gap)) / 2;
  return {
    chips: Array.from({ length: chips }, (_, k) => R(x0 + k * (cw + gap), a.y + 2, cw, ch)),
    cells: Array.from({ length: ring }, (_, k) => R(a.x + k * cell + 1, a.y + ch + 12, cell - 2, 14)),
    ringBox: R(a.x, a.y + ch + 11, ring * cell, 16),
    note: R(a.x, a.y + ch + 34, a.w, Math.max(14, a.y + a.h - (a.y + ch + 34))),
  };
}

/** One row of the NAT table or of the transfers, for a row of height `h` at `y` over the width of `a`: the address chain, the progress bar and the percent. */
const natRow = (a: Rect, y: number, h: number) => ({
  row: R(a.x, y, a.w, h),
  label: R(a.x + 2, y, a.w * 0.79, h),
  bar: R(a.x + a.w * 0.81, y + h * 0.28, a.w * 0.11, h * 0.44),
  pct: R(a.x + a.w * 0.93, y, a.w * 0.07, h),
});

/** The forwarding engine: its four stages in a row, the table of clients under them (a cell for each slot, two rows when there are many), the caption and the rows of the NAT table, one for each client in service. */
export function pktGeom(a: Rect, slots: number) {
  const gap = 10,
    sw = (a.w - 3 * gap) / 4,
    sh = 26,
    per = slots > 8 ? Math.ceil(slots / 2) : slots,
    cw = (a.w - 8) / Math.max(1, per),
    ch = 13,
    ty = a.y + sh + 9,
    trows = slots > 8 ? 2 : 1;
  const cy = ty + trows * (ch + 3) + 3,
    fy = cy + 15,
    rows = Math.max(0, Math.min(4, Math.floor((a.y + a.h - 16 - fy) / 22)));
  return {
    stages: [0, 1, 2, 3].map((k) => R(a.x + k * (sw + gap), a.y, sw, sh)),
    cells: Array.from({ length: slots }, (_, k) =>
      R(a.x + (k % per) * cw + 1, ty + Math.floor(k / per) * (ch + 3), cw - 2, ch),
    ),
    table: R(a.x, ty - 1, per * cw, trows * (ch + 3) + 1),
    caption: R(a.x, cy, a.w, 13),
    flows: Array.from({ length: rows }, (_, k) => natRow(a, fy + k * 22, 20)),
    more: R(a.x, a.y + a.h - 14, a.w, 14),
  };
}

/** The LAN switch: the uplink to the engine on the left, the LAN ports on the right (a bar each, with the MAC address learned on it), the fabric between them and the line under it. */
export function swGeom(a: Rect, lan: number) {
  const noteH = 24,
    h = a.h - noteH - 4,
    pitch = h / lan,
    bh = Math.min(20, pitch - 3),
    up = R(a.x, a.y, 36, h),
    pw = Math.min(a.w * 0.62, 210);
  return {
    up,
    ports: Array.from({ length: lan }, (_, k) => R(a.x + a.w - pw, a.y + k * pitch + (pitch - bh) / 2, pw, bh)),
    fabric: R(up.x + up.w, a.y, a.w - up.w - pw, h),
    note: R(a.x, a.y + a.h - noteH, a.w, noteH),
  };
}

/** The traffic block: the two counters with their load bars, then the two lines of speeds and the limit. */
export function statGeom(a: Rect) {
  const nw = 30,
    row = (k: number) => a.y + k * 34,
    w = a.w - nw;
  return {
    rx: R(a.x + nw, row(0), w, 20),
    rxBar: R(a.x + nw, row(0) + 21, w, 8),
    tx: R(a.x + nw, row(1), w, 20),
    txBar: R(a.x + nw, row(1) + 21, w, 8),
    lines: [R(a.x, a.y + 70, a.w, 20), R(a.x, a.y + 92, a.w, 20)],
  };
}

// ---------------------------------------------------------------- the static symbols

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
export function routerGlyph(
  g: Graphics,
  T: Theme,
  b: RouterBlock,
  c: string,
  put: blockart.Put,
  input: RouterPlanInput,
): void {
  const a = routerGlyphArea(b);
  if (!a) {
    return;
  }
  const kit = blockart.glyphKit(g, T, c, put),
    { solid, soft, line, rect, stub } = kit;
  const outline = (r: Rect) => {
    g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
  };
  const arrow = (x0: number, y: number, x1: number) => {
    stub(x0, y, x1, y);
    g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line });
  };
  switch (b.kind) {
    case 'wanmac': {
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
        outline(r);
      }
      break;
    }
    case 'cpu': {
      const q = cpuGeom(a, input.cores);
      q.cores.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
        outline(r);
        put(`C${k}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
      });
      break;
    }
    case 'mem': {
      const q = memGeom(a, input.dram.chips);
      q.chips.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, solid);
        outline(r);
        put(`CH${k}`, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
      });
      for (const r of q.cells) {
        rect(r.x, r.y, r.w, r.h, soft);
      }
      outline(q.ringBox);
      break;
    }
    case 'pkt': {
      const q = pktGeom(a, routerSlots(input));
      q.stages.forEach((r, k) => {
        rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
        outline(r);
        put(PKT_STAGES[k]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.4, r.w * 0.17));
        if (k < 3) {
          arrow(r.x + r.w + 1, r.y + r.h / 2, q.stages[k + 1]!.x - 1);
        }
      });
      for (const r of q.cells) {
        rect(r.x, r.y, r.w, r.h, soft);
      }
      outline(q.table);
      put(
        'NAT: PRIVATE ADDRESS : PORT  >  PUBLIC ADDRESS : PORT  >  SERVER',
        q.caption.x + q.caption.w / 2,
        q.caption.y + q.caption.h / 2,
        9,
      );
      for (const f of q.flows) {
        rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft);
        outline(f.bar);
      }
      break;
    }
    case 'sw': {
      const q = swGeom(a, input.lan);
      rect(q.up.x, q.up.y, q.up.w, q.up.h, solid);
      outline(q.up);
      put('UP', q.up.x + q.up.w / 2, q.up.y + q.up.h / 2, LAB);
      q.ports.forEach((r) => {
        rect(r.x, r.y, r.w, r.h, soft);
        outline(r);
        // the fabric: a line from the uplink to each port, bent at the middle of the gap
        const y0 = q.up.y + q.up.h / 2,
          x0 = q.up.x + q.up.w,
          x1 = r.x,
          ym = r.y + r.h / 2,
          xm = x0 + (x1 - x0) * 0.5;
        g.moveTo(x0, y0).lineTo(xm, y0).lineTo(xm, ym).lineTo(x1, ym).stroke({ width: 1.1, color: line, alpha: 0.7 });
      });
      break;
    }
    case 'stat': {
      const q = statGeom(a);
      for (const r of [q.rxBar, q.txBar]) {
        rect(r.x, r.y, r.w, r.h, soft);
        outline(r);
      }
      for (const [r, t] of [
        [q.rx, 'rx'],
        [q.tx, 'tx'],
      ] as [Rect, string][]) {
        put(t, a.x + 12, r.y + r.h / 2, LAB + 2);
      }
      break;
    }
    default: {
      break;
    }
  }
}

// ---------------------------------------------------------------- the live symbols

export type RouterLive = nicglyph.NicLive;

/** The right part of a block's name strip, from `from` of its width (a small block puts its number beside its name, where the symbol has no room for it). */
const head = (r: Rect, from: number): Rect => R(r.x + r.w * from, r.y + 5, r.w * (1 - from) - 8, 22);

/** The forwarding engine's table: a cell for each slot (the plan's `routerSlots`). */
export const routerSlots = (input: Pick<RouterPlanInput, 'tier'>): number =>
  input.tier >= 4 ? 16 : input.tier >= 3 ? 8 : 4;

export { natLine };

/** What a block shows now: the rectangles to light and the texts to put in them. `s` is the router's `RouterShow`; a router with no link on one side lights nothing of that side's line. */
export function routerLive(
  b: Pick<RouterBlock, 'kind' | 'rect'>,
  a: Rect,
  s: routershow.RouterShow,
  input: RouterPlanInput,
): RouterLive {
  const out: RouterLive = { texts: [], lit: [] };
  const rx = s.rxAct,
    tx = s.txAct,
    any = Math.max(rx, tx),
    flow = s.pc && s.wan,
    { ms, addr: ad } = s;
  const txt = (r: Rect, t: string, fit?: number) =>
    out.texts.push({ rect: r, top: t, ink: true, ...(fit !== undefined ? { fit } : {}) });
  const lit = (rect: Rect, color: nicglyph.LiveKey, al: number) => out.lit.push({ rect, color, a: al });
  switch (b.kind) {
    case 'wanmac': {
      const q = wanGeom(a);
      if (flow && rx > 0) {
        const u = (ms / (1600 - 1300 * rx)) % 1;
        lit({ ...q.rx, w: q.rx.w * u }, 'alu', 0.12 + 0.18 * rx);
        q.fields.forEach((f, k) => {
          if (Math.floor(u * q.fields.length) === k) {
            lit(f, 'alu', 0.2);
          }
        });
      }
      if (flow && tx > 0) {
        const u = (ms / (1600 - 1300 * tx)) % 1;
        lit({ ...q.tx, x: q.tx.x + q.tx.w * (1 - u), w: q.tx.w * u }, 'mul', 0.12 + 0.18 * tx);
      }
      txt(q.ip, ad?.wan ? `${ad.wan.ip}/${ad.wan.prefix}` : s.wan ? 'no address' : 'no plan: no address', 18);
      txt(q.mac, ad?.router ? ad.router.wan : 'no router', 17);
      break;
    }
    case 'cpu': {
      const q = cpuGeom(a, input.cores);
      q.cores.forEach((r) => lit(r, 'mul', 0.08));
      txt(q.lease, ad?.host ? `lease ${ad.host.ip}` : 'no lease', 22);
      txt(q.via, ad?.host ? `gw ${ad.host.gateway} dns ${ad.host.dns}` : 'no clients', 30);
      break;
    }
    case 'mem': {
      const q = memGeom(a, input.dram.chips);
      q.cells.forEach((r, k) => {
        if (flow && any > 0 && Math.floor(wave(ms, k, 1 + any) * 2) === 1) {
          lit(r, 'ld', 0.35);
        }
      });
      if (flow && any > 0) {
        q.chips.forEach((r, k) => lit(r, 'ld', 0.1 * wave(ms, k * 2, 1 + any)));
      }
      txt(q.note, flow ? `${fmtFrames(s.rx + s.tx)} frames /s` : 'no frames', 17);
      break;
    }
    case 'pkt': {
      const q = pktGeom(a, routerSlots(input));
      if (flow && any > 0) {
        q.stages.forEach((r, k) => lit(r, 'st', 0.12 * any * wave(ms, k * 1.4, 1.2 + any)));
      }
      // a cell for each client in service: the table is the slots the router and the plan give, the transfers in flight are the clients
      q.cells.forEach((r, k) => {
        if (k < s.used) {
          lit(r, 'st', 0.5);
        }
      });
      txt(head(b.rect, 0.5), `${s.used} of ${s.slots} clients`, 18);
      const flows = [...s.downs, ...s.ups];
      q.flows.forEach((f, k) => {
        const t = flows[k];
        if (!t) {
          return;
        }
        const conn = ad?.conns.find((c) => c.jobId === t.jobId && c.dir === t.dir);
        lit({ ...f.bar, w: f.bar.w * Math.min(1, t.percent / 100) }, t.dir === 'down' ? 'alu' : 'mul', 0.5);
        const line = conn ? natLine(conn) : `${t.dir === 'down' ? 'v' : '^'} ${t.label}`;
        txt(f.label, line, Math.max(70, line.length));
        txt(f.pct, `${Math.round(t.percent)}%`, 5);
      });
      if (flows.length > q.flows.length) {
        txt(q.more, `+ ${flows.length - q.flows.length} more`, 20);
      } else if (flows.length === 0) {
        txt(q.flows[0]?.label ?? q.more, 'no connection: the table is empty', 36);
      }
      break;
    }
    case 'sw': {
      const q = swGeom(a, input.lan);
      if (flow && any > 0) {
        lit(q.up, 'st', 0.1 + 0.3 * any);
        lit(q.ports[0]!, 'st', 0.1 + 0.3 * any);
      } else if (s.pc) {
        lit(q.ports[0]!, 'st', 0.1);
      }
      if (flow && rx > 0) {
        lit({ ...q.fabric, w: q.fabric.w * ((ms / (1600 - 1300 * rx)) % 1) }, 'alu', 0.05 + 0.07 * rx);
      }
      // the MAC address table: the address learned on each port (the game's one cable is in port 1)
      q.ports.forEach((r, k) => txt(r, k === 0 && ad?.host ? `P1 ${ad.host.mac}` : `P${k + 1} -`, 24));
      txt(q.note, ad?.router && s.pc ? `${ad.router.lan} · ${fmtSpeed(s.lanMbps)}` : 'no port up', 34);
      break;
    }
    case 'stat': {
      const q = statGeom(a);
      txt(q.rx, `${fmtFrames(s.rxTotal)} frames · ${fmtFrames(s.rx)} /s`, 26);
      txt(q.tx, `${fmtFrames(s.txTotal)} frames · ${fmtFrames(s.tx)} /s`, 26);
      lit({ ...q.rxBar, w: q.rxBar.w * s.rxLoad }, 'alu', 0.5);
      lit({ ...q.txBar, w: q.txBar.w * s.txLoad }, 'mul', 0.5);
      txt(q.lines[0]!, s.wan ? `WAN ${fmtSpeed(s.downMbps)} down · ${fmtSpeed(s.upMbps)} up` : 'WAN no plan', 34);
      txt(
        q.lines[1]!,
        flow
          ? `LAN ${fmtSpeed(s.lanMbps)} · limit: ${routershow.limitWords(s)}`
          : s.pc
            ? `LAN ${fmtSpeed(s.lanMbps)} · rx ${fmtPct(s.rxLoad)}`
            : 'LAN no link',
        34,
      );
      break;
    }
    default: {
      break;
    }
  }
  return out;
}
