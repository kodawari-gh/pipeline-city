// Live (animated) symbols of the router SoC (docs/render/net.md "Inside the NIC and the router").

import type { LiveKey, NicLive } from '../nic/nicglyph';
import type { Rect } from '../plan/netplan';
import { natLine } from '../plan/netaddr';
import { fmtFrames, fmtPct, fmtSpeed } from '../plan/netmeter';
import type { RouterBlock, RouterPlanInput } from './routerplan';
import * as routershow from './routershow';
import { cpuGeom, memGeom, pktGeom, statGeom, swGeom, wanGeom } from './routergeom';

// ---------------------------------------------------------------- the live symbols
const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);

export type RouterLive = NicLive;

/** The right part of a block's name strip, from `from` of its width (a small block puts its number beside its name, where the symbol has no room for it). */
const head = (r: Rect, from: number): Rect => ({ x: r.x + r.w * from, y: r.y + 5, w: r.w * (1 - from) - 8, h: 22 });

/** The forwarding engine's table: a cell for each slot (the plan's `routerSlots`). */
export function routerSlots(input: Pick<RouterPlanInput, 'tier'>): number {
  if (input.tier >= 4) {
    return 16;
  }
  if (input.tier >= 3) {
    return 8;
  }
  return 4;
}

/** What a block shows now: the rectangles to light and the texts to put in them. `s` is the router's `RouterShow`; a router with no link on one side lights nothing of that side's line. */

function wanAddrText(wan: { ip: string; prefix: number } | null | undefined, hasPlan: boolean): string {
  if (wan) {
    return `${wan.ip}/${wan.prefix}`;
  }
  if (hasPlan) {
    return 'no address';
  }
  return 'no plan: no address';
}

function lanLineText(s: routershow.RouterShow, flow: boolean | undefined): string {
  if (flow === true) {
    return `LAN ${fmtSpeed(s.lanMbps)} · limit: ${routershow.limitWords(s)}`;
  }
  if (s.pc) {
    return `LAN ${fmtSpeed(s.lanMbps)} · rx ${fmtPct(s.rxLoad)}`;
  }
  return 'LAN no link';
}

function liveTxt(opts: { out: RouterLive; r: Rect; t: string; fit?: number }): void {
  const { out, r, t, fit } = opts;
  out.texts.push({ rect: r, top: t, ink: true, ...(fit === undefined ? {} : { fit }) });
}

function liveLit(opts: { out: RouterLive; rect: Rect; color: LiveKey; a: number }): void {
  const { out, rect, color, a } = opts;
  out.lit.push({ rect, color, a });
}

interface RouterLiveCtx {
  b: Pick<RouterBlock, 'kind' | 'rect'>;
  a: Rect;
  s: routershow.RouterShow;
  input: RouterPlanInput;
  out: RouterLive;
  rx: number;
  tx: number;
  any: number;
  flow: boolean;
  ms: number;
  ad: routershow.RouterShow['addr'];
}

function routerLiveWanmac(ctx: RouterLiveCtx): void {
  const { a, s, out, rx, tx, flow, ms, ad } = ctx;

  const q = wanGeom(a);
  if (flow && rx > 0) {
    const u = (ms / (1600 - 1300 * rx)) % 1;
    liveLit({ out, rect: { ...q.rx, w: q.rx.w * u }, color: 'alu', a: 0.12 + 0.18 * rx });
    for (const [k, f] of q.fields.entries()) {
      if (Math.floor(u * q.fields.length) === k) {
        liveLit({ out, rect: f, color: 'alu', a: 0.2 });
      }
    }
  }
  if (flow && tx > 0) {
    const u = (ms / (1600 - 1300 * tx)) % 1;
    liveLit({ out, rect: { ...q.tx, x: q.tx.x + q.tx.w * (1 - u), w: q.tx.w * u }, color: 'mul', a: 0.12 + 0.18 * tx });
  }
  liveTxt({ out, r: q.ip, t: wanAddrText(ad?.wan, s.wan), fit: 18 });
  liveTxt({ out, r: q.mac, t: ad?.router ? ad.router.wan : 'no router', fit: 17 });
}
function routerLiveCpu(ctx: RouterLiveCtx): void {
  const { a, input, out, ad } = ctx;

  const q = cpuGeom(a, input.cores);
  for (const r of q.cores) {
    liveLit({ out, rect: r, color: 'mul', a: 0.08 });
  }
  liveTxt({ out, r: q.lease, t: ad?.host ? `lease ${ad.host.ip}` : 'no lease', fit: 22 });
  liveTxt({ out, r: q.via, t: ad?.host ? `gw ${ad.host.gateway} dns ${ad.host.dns}` : 'no clients', fit: 30 });
}
function routerLiveMem(ctx: RouterLiveCtx): void {
  const { a, s, input, out, any, flow, ms } = ctx;

  const q = memGeom(a, input.dram.chips);
  for (const [k, r] of q.cells.entries()) {
    if (flow && any > 0 && Math.floor(wave(ms, k, 1 + any) * 2) === 1) {
      liveLit({ out, rect: r, color: 'ld', a: 0.35 });
    }
  }
  if (flow && any > 0) {
    for (const [k, r] of q.chips.entries()) {
      liveLit({ out, rect: r, color: 'ld', a: 0.1 * wave(ms, k * 2, 1 + any) });
    }
  }
  liveTxt({ out, r: q.note, t: flow ? `${fmtFrames(s.rx + s.tx)} frames /s` : 'no frames', fit: 17 });
}
function routerLivePkt(ctx: RouterLiveCtx): void {
  const { b, a, s, input, out, any, flow, ms, ad } = ctx;

  const q = pktGeom(a, routerSlots(input));
  if (flow && any > 0) {
    for (const [k, r] of q.stages.entries()) {
      liveLit({ out, rect: r, color: 'st', a: 0.12 * any * wave(ms, k * 1.4, 1.2 + any) });
    }
  }
  // a cell for each client in service: the table is the slots the router and the plan give, the transfers in flight are the clients
  for (const [k, r] of q.cells.entries()) {
    if (k < s.used) {
      liveLit({ out, rect: r, color: 'st', a: 0.5 });
    }
  }
  liveTxt({ out, r: head(b.rect, 0.5), t: `${s.used} of ${s.slots} clients`, fit: 18 });
  const flows = [...s.downs, ...s.ups];
  for (const [k, f] of q.flows.entries()) {
    const t = flows[k];
    if (!t) {
      continue;
    }
    const conn = ad?.conns.find((c) => c.jobId === t.jobId && c.dir === t.dir);
    liveLit({
      out,
      rect: { ...f.bar, w: f.bar.w * Math.min(1, t.percent / 100) },
      color: t.dir === 'down' ? 'alu' : 'mul',
      a: 0.5,
    });
    const line = conn ? natLine(conn) : `${t.dir === 'down' ? 'v' : '^'} ${t.label}`;
    liveTxt({ out, r: f.label, t: line, fit: Math.max(70, line.length) });
    liveTxt({ out, r: f.pct, t: `${Math.round(t.percent)}%`, fit: 5 });
  }
  if (flows.length > q.flows.length) {
    liveTxt({ out, r: q.more, t: `+ ${flows.length - q.flows.length} more`, fit: 20 });
  } else if (flows.length === 0) {
    liveTxt({ out, r: q.flows[0]?.label ?? q.more, t: 'no connection: the table is empty', fit: 36 });
  }
}
function routerLiveSw(ctx: RouterLiveCtx): void {
  const { a, s, input, out, rx, any, flow, ms, ad } = ctx;

  const q = swGeom(a, input.lan);
  const [port0] = q.ports;
  if (flow && any > 0) {
    liveLit({ out, rect: q.up, color: 'st', a: 0.1 + 0.3 * any });
    if (port0 !== undefined) {
      liveLit({ out, rect: port0, color: 'st', a: 0.1 + 0.3 * any });
    }
  } else if (s.pc && port0 !== undefined) {
    liveLit({ out, rect: port0, color: 'st', a: 0.1 });
  }
  if (flow && rx > 0) {
    liveLit({
      out,
      rect: { ...q.fabric, w: q.fabric.w * ((ms / (1600 - 1300 * rx)) % 1) },
      color: 'alu',
      a: 0.05 + 0.07 * rx,
    });
  }
  // the MAC address table: the address learned on each port (the game's one cable is in port 1)
  for (const [k, r] of q.ports.entries()) {
    liveTxt({ out, r, t: k === 0 && ad?.host ? `P1 ${ad.host.mac}` : `P${k + 1} -`, fit: 24 });
  }
  liveTxt({
    out,
    r: q.note,
    t: ad?.router && s.pc ? `${ad.router.lan} · ${fmtSpeed(s.lanMbps)}` : 'no port up',
    fit: 34,
  });
}
function routerLiveStat(ctx: RouterLiveCtx): void {
  const { a, s, out, flow } = ctx;

  const q = statGeom(a);
  liveTxt({ out, r: q.rx, t: `${fmtFrames(s.rxTotal)} frames · ${fmtFrames(s.rx)} /s`, fit: 26 });
  liveTxt({ out, r: q.tx, t: `${fmtFrames(s.txTotal)} frames · ${fmtFrames(s.tx)} /s`, fit: 26 });
  liveLit({ out, rect: { ...q.rxBar, w: q.rxBar.w * s.rxLoad }, color: 'alu', a: 0.5 });
  liveLit({ out, rect: { ...q.txBar, w: q.txBar.w * s.txLoad }, color: 'mul', a: 0.5 });
  const [wanLine, lanLine] = q.lines;
  if (wanLine !== undefined) {
    liveTxt({
      out,
      r: wanLine,
      t: s.wan ? `WAN ${fmtSpeed(s.downMbps)} down · ${fmtSpeed(s.upMbps)} up` : 'WAN no plan',
      fit: 34,
    });
  }
  if (lanLine !== undefined) {
    liveTxt({ out, r: lanLine, t: lanLineText(s, flow), fit: 34 });
  }
}

const ROUTER_LIVE: Partial<Record<RouterBlock['kind'], (ctx: RouterLiveCtx) => void>> = {
  wanmac: routerLiveWanmac,
  cpu: routerLiveCpu,
  mem: routerLiveMem,
  pkt: routerLivePkt,
  sw: routerLiveSw,
  stat: routerLiveStat,
};

function drawRouterLive(ctx: RouterLiveCtx & { kind: RouterBlock['kind'] }): void {
  ROUTER_LIVE[ctx.kind]?.(ctx);
}

export function routerLive(opts: {
  block: Pick<RouterBlock, 'kind' | 'rect'>;
  area: Rect;
  show: routershow.RouterShow;
  input: RouterPlanInput;
}): RouterLive {
  const { block: b, area: a, show: s, input } = opts;
  const out: RouterLive = { texts: [], lit: [] };
  const rx = s.rxAct,
    tx = s.txAct,
    any = Math.max(rx, tx),
    flow = s.pc && s.wan,
    { ms, addr: ad } = s;
  drawRouterLive({ kind: b.kind, b, a, s, input, out, rx, tx, any, flow, ms, ad });

  return out;
}
