// Glow, live symbols and motion reset for the router SoC die in RouterView.

import type { Container, Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import { box } from '@/core/render/ink';
import * as diepulse from '../../../cpu/render/die/diepulse';
import { ROUTER_KIND_COLOR } from './routerart';
import * as routerroute from './routerroute';
import { routerLive } from './routerlive';
import type { routerShow } from './routershow';
import type { RouterBlock, RouterPlanInput } from './routerplan';
import type { Rect } from '../plan/netplan';

/** The largest live text (plan units): same cap RouterView uses. */
const TEXT_CAP = 22;

type RouterShow = NonNullable<ReturnType<typeof routerShow>>;

interface RouterPaintDie {
  geo: { plan: { blocks: { id: string; kind: RouterBlock['kind']; rect: Rect }[]; input: RouterPlanInput } };
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  cellTexts: Map<string, diepulse.CellTexts>;
  packets: diepulse.Packet[];
  trails: Map<string, diepulse.Trail>;
  glow: Map<string, number>;
  areas: { b: RouterBlock; a: Rect }[];
}

export function wantedRouterActs(show: RouterShow): Map<string, number> {
  const want = new Map<string, number>();
  if (!(show.pc && show.wan)) {
    return want;
  }
  for (const dir of ['rx', 'tx'] as routerroute.RouterDir[]) {
    const act = dir === 'rx' ? show.rxAct : show.txAct;
    if (act <= 0) {
      continue;
    }
    for (const id of routerroute.BLOCKS[dir]) {
      want.set(id, Math.max(want.get(id) ?? 0, act));
    }
  }
  return want;
}

export function stepGlow(glow: Map<string, number>, want: Map<string, number>): void {
  for (const [id, v] of want) {
    glow.set(id, (glow.get(id) ?? 0) + (v - (glow.get(id) ?? 0)) * 0.25);
  }
  for (const [id, v] of glow) {
    if (!want.has(id)) {
      const n = v * 0.9;
      if (n < 0.02) {
        glow.delete(id);
      } else {
        glow.set(id, n);
      }
    }
  }
}

export function clearDieMotion(c: RouterPaintDie): void {
  c.packets = [];
  c.trails.clear();
  c.litG.clear();
  c.glowG.clear();
  c.trailG.clear();
  c.packetG.clear();
  for (const ct of c.cellTexts.values()) {
    ct.hideFrom(0);
  }
}

export function paintRouterGlow(opts: { die: RouterPaintDie; theme: Theme }): void {
  const { die: c, theme: T } = opts;
  const byId = new Map(c.geo.plan.blocks.map((b) => [b.id, b]));
  c.glowG.clear();
  for (const [id, v] of c.glow) {
    const b = byId.get(id);
    if (!b) {
      continue;
    }
    const col = T[ROUTER_KIND_COLOR[b.kind] === 'mute' ? 'alu' : ROUTER_KIND_COLOR[b.kind]];
    box(c.glowG, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, {
      fill: col,
      fa: 0.012 * v,
      stroke: col,
      lw: 2,
      sa: 0.4 * v,
    });
  }
}

export function paintRouterLive(opts: { die: RouterPaintDie; show: RouterShow; theme: Theme }): void {
  const { die: c, show, theme: T } = opts;
  c.litG.clear();
  const used = new Set<string>();
  for (const { b, a } of c.areas) {
    const live = routerLive({ block: b, area: a, show, input: c.geo.plan.input });
    for (const l of live.lit) {
      box(c.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: T[l.color], fa: l.a });
    }
    let ct = c.cellTexts.get(b.id);
    if (!ct) {
      ct = new diepulse.CellTexts(c.texts);
      c.cellTexts.set(b.id, ct);
    }
    used.add(b.id);
    for (const [n, x] of live.texts.entries()) {
      ct.line(n, x.top, x.rect, x.ink === true ? T.ink : T.on, x.fit, TEXT_CAP);
    }
    ct.hideFrom(live.texts.length);
  }
  for (const [id, ct] of c.cellTexts) {
    if (!used.has(id)) {
      ct.hideFrom(0);
    }
  }
}
