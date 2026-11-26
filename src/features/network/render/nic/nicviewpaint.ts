// Glow, live symbols and motion reset for a NIC die in NicView.

import type { Container, Graphics } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import { box } from '@/core/render/ink';
import * as diepulse from '../../../cpu/render/die/diepulse';
import { NIC_KIND_COLOR } from './nicart';
import * as nicroute from './nicroute';
import { nicLive } from './niclive';
import type { nicShow } from './nicshow';
import type { NicBlock, NicPlanInput } from './nicplan';
import type { Rect } from '../plan/netplan';

/** The largest live text (plan units): same cap NicView uses. */
const TEXT_CAP = 22;

type NicShow = NonNullable<ReturnType<typeof nicShow>>;

interface NicPaintCard {
  geo: { plan: { blocks: { id: string; kind: NicBlock['kind']; rect: Rect }[]; input: NicPlanInput } };
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  cellTexts: Map<string, diepulse.CellTexts>;
  packets: diepulse.Packet[];
  trails: Map<string, diepulse.Trail>;
  glow: Map<string, number>;
  areas: { b: NicBlock; a: Rect }[];
}

export function wantedNicActs(show: NicShow): Map<string, number> {
  const want = new Map<string, number>();
  if (!show.link) {
    return want;
  }
  for (const dir of ['rx', 'tx'] as nicroute.NicDir[]) {
    const act = dir === 'rx' ? show.rxAct : show.txAct;
    if (act <= 0) {
      continue;
    }
    for (const id of nicroute.BLOCKS[dir]) {
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

export function clearCardMotion(c: NicPaintCard): void {
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

export function paintNicGlow(opts: { card: NicPaintCard; theme: Theme }): void {
  const { card: c, theme: T } = opts;
  const byId = new Map(c.geo.plan.blocks.map((b) => [b.id, b]));
  c.glowG.clear();
  for (const [id, v] of c.glow) {
    const b = byId.get(id);
    if (!b) {
      continue;
    }
    const col = T[NIC_KIND_COLOR[b.kind] === 'mute' ? 'alu' : NIC_KIND_COLOR[b.kind]];
    box(c.glowG, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, {
      fill: col,
      fa: 0.012 * v,
      stroke: col,
      lw: 2,
      sa: 0.4 * v,
    });
  }
}

export function paintNicLive(opts: { card: NicPaintCard; show: NicShow; theme: Theme }): void {
  const { card: c, show, theme: T } = opts;
  c.litG.clear();
  const used = new Set<string>();
  for (const { b, a } of c.areas) {
    const live = nicLive({ block: b, area: a, show, input: c.geo.plan.input });
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
