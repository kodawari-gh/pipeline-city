// One snapshot on the network lens shape: line rates, line state, and the air tags (docs/render/net.md "The network lens").

import type { Snapshot } from '@/worker/protocol';
import type { V3 } from '@/core/render/three/rope';
import type { AirTag } from '@/features/board/render/three/air/airtags';
import * as netui from '../../ui/netui';
import { netAddrs } from '../plan/netaddr';
import type { NetAnchors, NetShape } from './shape';

type LineState = 0 | 1 | 2;

/** The slowest and the fastest link the pulses tell apart (Mbit/s): a pulse's pace and spacing follow a link's speed on a log scale between them. */
const MBPS_FOOT = 10,
  MBPS_TOP = 20_000;
/** A link's speed as a place on the pulses' scale, 0.08 (the foot) to 1 (the top). */
export function speedLevel(mbps: number): number {
  if (!(mbps > 0)) {
    return 0.08;
  }
  const f = Math.log(mbps / MBPS_FOOT) / Math.log(MBPS_TOP / MBPS_FOOT);
  return Math.min(1, Math.max(0.08, f));
}

export interface NetDraw {
  /** Per line (the shape's order): how hard data comes in, 0 to 1. 0 with the link up and nothing moving: a slow trickle. */
  down: Float32Array;
  /** The same for results going out; 0: none go. */
  up: Float32Array;
  state: Uint8Array;
  tags: AirTag[];
  /** The piece the words call the limit (`limiterLadder`), or null. */
  limit: netui.LimiterId | null;
}

const LABEL: Record<netui.LimiterId, string> = { port: 'Port', router: 'Router', isp: 'Plan', disk: 'Drive' };

/** The line `id` is in this state in this snapshot. The plan's line lives while a plan and a router are there; the lead while the link is up or saturated. */
function lineState(id: NetShape['lines'][number]['id'], s: Snapshot): LineState {
  const n = s.net;
  if (id === 'isp') {
    return n.isp && n.router ? 1 : 0;
  }
  const lead = s.cables.find((c) => c.id === 'lan');
  if (lead?.connected !== true) {
    return n.router || n.isp ? 2 : 0;
  }
  switch (n.state) {
    case 'link-up':
    case 'saturated': {
      return 1;
    }
    case 'down': {
      return 2;
    }
    case 'no-cable':
    case 'no-device':
    case 'no-os': {
      return 0;
    }
    default: {
      return 0;
    }
  }
}

const above = (p: V3, dy: number): V3 => [p[0], p[1] + dy, p[2] + 60];

/** One snapshot on the shape: each line's pace and state, and the words. */
type Ladder = ReturnType<typeof netui.limiterLadder>;
type Chip = ReturnType<typeof netui.netStateChip>;

function fillLineRates(opts: {
  shape: NetShape;
  s: Snapshot;
  ladder: Ladder;
  downs: number;
  ups: number;
  down: Float32Array;
  up: Float32Array;
  state: Uint8Array;
}): void {
  const { shape, s, ladder, downs, ups, down, up, state } = opts;
  for (const [i, l] of shape.lines.entries()) {
    state[i] = lineState(l.id, s);
    if (state[i] !== 1) {
      continue;
    }
    down[i] = downs > 0 ? speedLevel(ladder.downMbps) : 0;
    up[i] = ups > 0 ? speedLevel(ladder.upMbps) : 0;
  }
}

function tagWord(opts: { ladder: Ladder; id: netui.LimiterId; extra?: string }): {
  text: string;
  tone: AirTag['tone'];
} {
  const { ladder, id, extra = '' } = opts;
  const g = ladder.segs.find((seg) => seg.id === id);
  if (!g || g.mbps === null) {
    return { text: `${LABEL[id]} · none`, tone: 'warn' };
  }
  const hit = ladder.binding === id && ladder.downMbps > 0;
  return { text: `${LABEL[id]} · ${g.text}${extra}${hit ? ' · limit' : ''}`, tone: hit ? 'limit' : 'net' };
}

function dimTag(opts: { id: string; under: string; at: V3; text: string }): AirTag {
  return { ...opts, tone: 'dim' };
}

function pushPlanTags(opts: {
  tags: AirTag[];
  n: Snapshot['net'];
  addr: ReturnType<typeof netAddrs>;
  planAt: V3;
  ladder: Ladder;
}): void {
  const { tags, n, addr, planAt, ladder } = opts;
  if (n.isp) {
    tags.push({ id: 'plan', at: planAt, ...tagWord({ ladder, id: 'isp' }) });
    if (addr?.wan) {
      tags.push(
        dimTag({
          id: 'plan-addr',
          under: 'plan',
          at: planAt,
          text: `gateway ${addr.wan.gateway.ip} · ${addr.wan.gateway.mac}`,
        }),
      );
    }
    return;
  }
  tags.push({ id: 'plan', at: planAt, text: 'No plan · click the plate', tone: 'warn' });
}

function pushRouterTags(opts: {
  tags: AirTag[];
  n: Snapshot['net'];
  addr: ReturnType<typeof netAddrs>;
  routerAt: V3;
  ladder: Ladder;
}): string {
  const { tags, n, addr, routerAt, ladder } = opts;
  let routerLast = 'router';
  if (n.router) {
    const busy = new Set(n.transfers.map((t) => t.jobId)).size;
    tags.push({
      id: 'router',
      at: routerAt,
      ...tagWord({ ladder, id: 'router', extra: ` · ${busy}/${n.bandwidth.clients || n.router.clients} clients` }),
    });
    if (addr?.lan) {
      tags.push(
        dimTag({ id: 'router-lan', under: routerLast, at: routerAt, text: `LAN ${addr.lan.ip} · ${addr.lan.mac}` }),
      );
      routerLast = 'router-lan';
    }
    if (addr?.wan) {
      tags.push(
        dimTag({ id: 'router-wan', under: routerLast, at: routerAt, text: `WAN ${addr.wan.ip} · ${addr.wan.mac}` }),
      );
      routerLast = 'router-wan';
    }
    return routerLast;
  }
  tags.push({ id: 'router', at: routerAt, text: 'No router · drop one here', tone: 'warn' });
  return routerLast;
}

function pushPortTags(opts: {
  tags: AirTag[];
  n: Snapshot['net'];
  a: NetAnchors;
  addr: ReturnType<typeof netAddrs>;
  ladder: Ladder;
  chip: Chip;
}): void {
  const { tags, n, a, addr, ladder, chip } = opts;
  if (!a.lan) {
    return;
  }
  const port = ladder.segs.find((g) => g.id === 'port'),
    portAt = above(a.lan.jack, 330);
  if (n.port.kind && port) {
    tags.push({ id: 'port', at: portAt, ...tagWord({ ladder, id: 'port' }) });
    if (addr?.pc) {
      tags.push(
        dimTag({
          id: 'port-addr',
          under: 'port',
          at: portAt,
          text: `${addr.pc.id} · ${addr.pc.ip ?? 'no IP address'} · ${addr.pc.mac}`,
        }),
      );
    }
    return;
  }
  if (chip) {
    tags.push({ id: 'port', at: portAt, text: 'Port · plug the cable in', tone: 'warn' });
  }
}

function netDrawTags(opts: { s: Snapshot; a: NetAnchors; ladder: Ladder; chip: Chip }): AirTag[] {
  const { s, a, ladder, chip } = opts;
  const n = s.net,
    tags: AirTag[] = [],
    addr = netAddrs(s);
  const plan = a.plate,
    planAt = above(plan.at, plan.hh + 150);
  pushPlanTags({ tags, n, addr, planAt, ladder });
  const routerAt = above(a.router.at, a.router.hh + 120);
  const routerLast = pushRouterTags({ tags, n, addr, routerAt, ladder });
  pushPortTags({ tags, n, a, addr, ladder, chip });
  if (a.drive && (ladder.segs.find((g) => g.id === 'disk')?.mbps ?? 0) > 0) {
    tags.push({ id: 'drive', at: above(a.drive, 160), ...tagWord({ ladder, id: 'disk' }) });
  }
  // the link, when it is not up: what is wrong in the chip's words, under the router's
  if (chip && (chip.level === 'warn' || chip.level === 'bad')) {
    tags.push({
      id: 'link',
      at: routerAt,
      text: chip.text,
      tone: chip.level === 'bad' ? 'warn' : 'limit',
      under: routerLast,
    });
  }
  tags.push({
    id: 'legend',
    at: routerAt,
    text: '',
    tone: 'dim',
    legend: 'net',
    under: chip && (chip.level === 'warn' || chip.level === 'bad') ? 'link' : routerLast,
  });
  return tags;
}

export function netDraw(shape: NetShape, s: Snapshot, a: NetAnchors): NetDraw {
  const n = s.net,
    ladder = netui.limiterLadder(s),
    chip = netui.netStateChip(s);
  const downs = n.transfers.filter((t) => t.dir === 'down').length,
    ups = n.transfers.filter((t) => t.dir === 'up').length;
  const down = new Float32Array(shape.lines.length),
    up = new Float32Array(shape.lines.length),
    state = new Uint8Array(shape.lines.length);
  fillLineRates({ shape, s, ladder, downs, ups, down, up, state });
  const tags = netDrawTags({ s, a, ladder, chip });
  return { down, up, state, tags, limit: netui.hasNetwork(s) ? ladder.binding : null };
}
