// Live (animated) symbols of the NIC die (docs/render/net.md "Inside the NIC and the router").

import type { Rect } from '../../../cpu/render/core/cpuplan';
import { NIC_RX_SLOTS, NIC_TX_SLOTS } from '@/core/sim/memmap';
import { STRETCH } from '../jackleds';
import { fmtFrames, fmtPct, fmtSpeed } from '../plan/netmeter';
import type { NicBlock, NicPlanInput } from './nicplan';
import type { NicShow } from './nicshow';
import { dmaGeom, macGeom, phyGeom, phyNames, pcieGeom, queueGeom, statsGeom, tempAt, tempGeom } from './nicgeom';

// ---------------------------------------------------------------- the live symbols
const wave = (ms: number, k: number, speed = 1): number => 0.5 + 0.5 * Math.sin(ms / (90 / speed) - k * 0.9);

export type LiveKey = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad';
interface NicLiveItem {
  rect: Rect;
  color: LiveKey;
  a: number;
}
interface NicLiveText {
  rect: Rect;
  top: string;
  ink?: boolean;
  fit?: number;
}
export interface NicLive {
  texts: NicLiveText[];
  lit: NicLiveItem[];
}

/** The activity light's level at the visual clock: it lights for `STRETCH` seconds after each frame (the jacks' law, jackleds.ts), so a few frames blink one by one and many keep it lit. */
export function actLevel(rate: number, ms: number): number {
  if (!(rate > 0)) {
    return 0;
  }
  const duty = rate * STRETCH;
  return duty >= 1 || ((ms / 1000) * rate) % 1 < duty ? 1 : 0;
}

/** The right part of a block's name strip, from `from` of its width (a small block puts its number beside its name, where the symbol has no room for it). */
const head = (r: Rect, from: number): Rect => ({ x: r.x + r.w * from, y: r.y + 5, w: r.w * (1 - from) - 8, h: 22 });

/** What a block shows now: the rectangles to light and the texts to put in them. `s` is the card's `NicShow`; a card with no cable lights nothing of the line. */

function dmaNote(driver: boolean, on: boolean, dmaWords: number): string {
  if (driver) {
    return `${fmtFrames(dmaWords)} words moved`;
  }
  if (on) {
    return 'no driver yet';
  }
  return 'idle';
}

function liveTxt(opts: { out: NicLive; r: Rect; t: string; fit?: number }): void {
  const { out, r, t, fit } = opts;
  out.texts.push({ rect: r, top: t, ink: true, ...(fit === undefined ? {} : { fit }) });
}

interface NicLiveCtx {
  b: Pick<NicBlock, 'kind' | 'rect'>;
  a: Rect;
  s: NicShow;
  input: NicPlanInput;
  out: NicLive;
  rx: number;
  tx: number;
  any: number;
  on: boolean;
  ms: number;
}

function nicLivePhy(ctx: NicLiveCtx): void {
  const { a, s, input, out, any, on, ms } = ctx;

  const q = phyGeom(a, input.pairs, phyNames(input));
  if (on && any > 0) {
    for (const [k, pair] of q.pairs.entries()) {
      for (const [j, r] of pair.stages.entries()) {
        out.lit.push({ rect: r, color: j === 1 ? 'mul' : 'alu', a: 0.12 * any * wave(ms, k + j * 1.5, 1.4) });
      }
    }
  }
  const full = s.rated > 0 ? Math.min(1, s.mbps / s.rated) : 0;
  if (on) {
    out.lit.push({ rect: { ...q.gauge, w: q.gauge.w * full }, color: s.hot ? 'ld' : 'alu', a: 0.45 });
  }
  let t = 'no link';
  if (s.burnt) {
    t = 'burnt out';
  } else if (on) {
    t = `LINK ${fmtSpeed(s.mbps)}${s.hot ? ' · hot, half speed' : ''}`;
  }
  liveTxt({ out, r: q.note, t, fit: 32 });
}
function nicLiveMac(ctx: NicLiveCtx): void {
  const { a, out, rx, tx, on, ms } = ctx;

  const q = macGeom(a);
  if (on && rx > 0) {
    const u = (ms / (1600 - 1300 * rx)) % 1;
    out.lit.push({ rect: { ...q.rx, x: q.rx.x, w: q.rx.w * u }, color: 'alu', a: 0.12 + 0.18 * rx });
    for (const [k, f] of q.fields.entries()) {
      if (Math.floor(u * q.fields.length) === k) {
        out.lit.push({ rect: f, color: 'alu', a: 0.2 });
      }
    }
  }
  if (on && tx > 0) {
    const u = (ms / (1600 - 1300 * tx)) % 1;
    out.lit.push({
      rect: { ...q.tx, x: q.tx.x + q.tx.w * (1 - u), w: q.tx.w * u },
      color: 'mul',
      a: 0.12 + 0.18 * tx,
    });
  }
  liveTxt({ out, r: q.note, t: on ? 'up to 1500 bytes a frame · CRC checked' : 'waiting for a link', fit: 40 });
}
function nicLiveStats(ctx: NicLiveCtx): void {
  const { a, s, out, rx, tx } = ctx;

  const q = statsGeom(a);
  liveTxt({ out, r: q.rxVal, t: `${fmtFrames(s.rxTotal)} frames · ${fmtFrames(s.rx)} /s`, fit: 26 });
  liveTxt({ out, r: q.txVal, t: `${fmtFrames(s.txTotal)} frames · ${fmtFrames(s.tx)} /s`, fit: 26 });
  out.lit.push(
    { rect: { ...q.rxBar, w: q.rxBar.w * rx }, color: 'alu', a: 0.5 },
    { rect: { ...q.txBar, w: q.txBar.w * tx }, color: 'mul', a: 0.5 },
  );
  liveTxt({ out, r: q.rxBar, t: `rx ${fmtPct(s.rxLoad)}`, fit: 14 });
  liveTxt({ out, r: q.txBar, t: `tx ${fmtPct(s.txLoad)}`, fit: 14 });
}
function nicLiveQueue(ctx: NicLiveCtx): void {
  const { b, a, s, input, out } = ctx;

  const down = b.kind === 'rxq',
    q = queueGeom(a, down ? input.fifo : 0),
    flows = down ? s.downs : s.ups,
    key: LiveKey = down ? 'alu' : 'mul';
  // the chip's buffer as the sim has it: a cell for each segment waiting, all red once it is full (the next segment is lost)
  const full = s.fifo >= q.cells.length && q.cells.length > 0;
  for (const [k, r] of q.cells.entries()) {
    if (k < s.fifo) {
      out.lit.push({ rect: r, color: full ? 'bad' : key, a: 0.55 });
    }
  }
  liveTxt({
    out,
    r: head(b.rect, 0.5),
    t: down
      ? `FIFO ${s.fifo}/${q.cells.length}${s.drops ? ` · ${s.drops} lost` : ''}`
      : `${flows.length} out${s.waiting ? ` · ${s.waiting} wait` : ''}`,
    fit: 20,
  });
  for (const [k, f] of q.flows.entries()) {
    const flow = flows[k];
    if (!flow) {
      continue;
    }
    out.lit.push({ rect: { ...f.bar, w: f.bar.w * Math.min(1, flow.percent / 100) }, color: key, a: 0.5 });
    liveTxt({ out, r: f.label, t: flow.label, fit: 24 });
    liveTxt({ out, r: f.pct, t: `${Math.round(flow.percent)}%`, fit: 5 });
  }
  if (flows.length > q.flows.length) {
    liveTxt({
      out,
      r: { x: a.x, y: a.y + a.h - 14, w: a.w, h: 14 },
      t: `+ ${flows.length - q.flows.length} more`,
      fit: 20,
    });
  }
}
function nicLiveDma(ctx: NicLiveCtx): void {
  const { a, s, out, rx, tx, on, ms } = ctx;

  const q = dmaGeom(a, NIC_RX_SLOTS, NIC_TX_SLOTS);
  // the two rings as the kernel and the card share them: a cell for each slot that holds a segment the other side has not taken yet
  for (const [k, r] of q.rx.cells.entries()) {
    if (k < s.rxUsed) {
      out.lit.push({ rect: r, color: 'alu', a: 0.55 });
    }
  }
  for (const [k, r] of q.tx.cells.entries()) {
    if (k < s.txUsed) {
      out.lit.push({ rect: r, color: 'mul', a: 0.55 });
    }
  }
  if (on && rx > 0) {
    out.lit.push({ rect: q.down, color: 'alu', a: 0.04 + 0.1 * rx * (0.6 + 0.4 * wave(ms, 0)) });
  }
  if (on && tx > 0) {
    out.lit.push({ rect: q.up, color: 'mul', a: 0.04 + 0.1 * tx * (0.6 + 0.4 * wave(ms, 1)) });
  }
  liveTxt({ out, r: q.note, t: dmaNote(s.driver, on, s.dmaWords), fit: 26 });
}
function nicLivePcie(ctx: NicLiveCtx): void {
  const { a, input, out, rx, tx, on, ms } = ctx;

  const q = pcieGeom(a, input.lanes);
  for (const l of q.lanes) {
    if (on && rx > 0) {
      out.lit.push({ rect: l.rx, color: 'alu', a: 0.1 + 0.35 * rx * wave(ms, l.idx, 1.3) });
    }
    if (on && tx > 0) {
      out.lit.push({ rect: l.tx, color: 'mul', a: 0.1 + 0.35 * tx * wave(ms, l.idx + 3, 1.3) });
    }
  }
  liveTxt({ out, r: q.note, t: `x${input.lanes} · ${input.lanes * 2} pairs`, fit: 24 });
}
function nicLiveTemp(ctx: NicLiveCtx): void {
  const { b, a, s, out } = ctx;

  const q = tempGeom(a),
    f = tempAt(s.tempC, s.damageC);
  out.lit.push({ rect: { ...q.bar, w: q.bar.w * f }, color: s.tempC >= s.throttleC ? 'bad' : 'st', a: 0.55 });
  // the throttle and unstable marks on the scale
  for (const [c, col] of [
    [s.throttleC, 'ld'],
    [s.unstableC, 'bad'],
  ] as [number, LiveKey][]) {
    out.lit.push({
      rect: { x: q.bar.x + q.bar.w * tempAt(c, s.damageC) - 1, y: q.bar.y - 3, w: 2, h: q.bar.h + 6 },
      color: col,
      a: 0.95,
    });
  }
  liveTxt({ out, r: head(b.rect, 0.5), t: `${s.tempC.toFixed(0)} °C`, fit: 8 });
}

const NIC_LIVE: Partial<Record<NicBlock['kind'], (ctx: NicLiveCtx) => void>> = {
  phy: nicLivePhy,
  mac: nicLiveMac,
  stats: nicLiveStats,
  rxq: nicLiveQueue,
  txq: nicLiveQueue,
  dma: nicLiveDma,
  pcie: nicLivePcie,
  temp: nicLiveTemp,
};

function drawNicLive(ctx: NicLiveCtx & { kind: NicBlock['kind'] }): void {
  NIC_LIVE[ctx.kind]?.(ctx);
}

export function nicLive(opts: {
  block: Pick<NicBlock, 'kind' | 'rect'>;
  area: Rect;
  show: NicShow;
  input: NicPlanInput;
}): NicLive {
  const { block: b, area: a, show: s, input } = opts;
  const out: NicLive = { texts: [], lit: [] };
  const rx = s.rxAct,
    tx = s.txAct,
    any = Math.max(rx, tx),
    { link: on, ms } = s;
  drawNicLive({ kind: b.kind, b, a, s, input, out, rx, tx, any, on, ms });

  return out;
}
