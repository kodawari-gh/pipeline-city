// Words for the parts of the router the board draws when the camera is close to its front (docs/render/net.md "Inside the NIC and the router", render/router/routerlayout.ts): the SoC and
// the blocks of its plan. An id is `router.` and the part: `router.pkt`. Pure. It imports nothing from logic.ts (logic.ts imports netdesc.ts, which calls this).

import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { getRouterSpec } from '../sim/specs';
import { netAddrs } from '../render/plan/netaddr';
import { routerInput } from '../render/router/routerplan';
import { describeRouterKind } from './routerdescParts';

const ID = /^router\.(?<kind>[a-z]+)$/u;
/** The parts of the router's board (routerboard3d.ts: its bodies and the SoC's lid) and the blocks of the SoC's die (routerplan.ts). */
const KINDS = new Set([
  'soc',
  'cpu',
  'mem',
  'wanmac',
  'pkt',
  'sw',
  'stat',
  'dram',
  'flash',
  'wanphy',
  'lanphy',
  'radio',
  'power',
  'label',
]);

/** Is this one of the router's part ids? */
export const isRouterId = (id: string): boolean => {
  const m = ID.exec(id);
  return m !== null && KINDS.has(m[1]!);
};

function routerKindOf(id: string): string | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[1]!)) {
    return null;
  }
  return m[1]!;
}

function pcLinked(
  s: Snapshot | null | undefined,
  n: NonNullable<Snapshot['net']> | undefined,
  r: NonNullable<NonNullable<Snapshot['net']>['router']> | null,
): boolean {
  return (
    r !== null &&
    n !== undefined &&
    n.port.kind !== null &&
    n.port.mbps > 0 &&
    s !== null &&
    s !== undefined &&
    s.powered &&
    !s.power.tripped
  );
}

function routerDescCtx(s?: Snapshot | null) {
  const n = s?.net,
    r = n?.router ?? null,
    spec = r ? getRouterSpec(r.id) : undefined,
    i = routerInput(spec?.tier ?? 1);
  const name = r ? r.name : 'router',
    pc = pcLinked(s, n, r),
    wan = Boolean(r) && Boolean(n?.isp);
  const lan = pc && n && r ? Math.min(n.port.mbps, r.mbps) : 0,
    used = n?.transfers.length ?? 0,
    slots = r ? Math.min(r.clients, n?.isp?.clients ?? r.clients) : 0;
  const tier = spec ? `tier ${spec.tier}` : 'by tier';
  const a = netAddrs(s);
  return { n, r, spec, i, name, pc, wan, lan, used, slots, tier, a, s };
}

/** Describe a router part by its id; null when the id is not one. `s` adds what the router is doing right now. */
export function describeRouterId(id: string, s?: Snapshot | null): Description | null {
  const kind = routerKindOf(id);
  if (!kind) {
    return null;
  }
  return describeRouterKind(kind, routerDescCtx(s));
}
