// The four-segment limiter ladder: port, router, plan, drive (docs/UI.md "Network").

import * as boardSpecs from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import * as netSpecs from '../sim/specs';
import { fmtMbit, nicsInOrder } from './netdesc';
import { linkUsable } from './nethud';

// ---------- the four-segment ladder: port | router | plan | drive ----------

export type LimiterId = 'port' | 'router' | 'isp' | 'disk';

interface LimiterSeg {
  id: LimiterId;
  label: string;
  /** Speed in Mbit/s, or null when the piece is missing. */
  mbps: number | null;
  text: string;
  detail: string;
  /** The piece that sets the effective speed. */
  binding: boolean;
  /** Bar length 0..1 on a log scale against the fastest of the four. */
  frac: number;
}

export interface LimiterLadder {
  segs: LimiterSeg[];
  binding: LimiterId | null;
  downMbps: number;
  upMbps: number;
  clients: number;
}

/** The OS drive's network sink rate (Mbit/s), or null with no OS. */
function diskMbps(s: Snapshot): number | null {
  const host = s.storage.find((d) => d.hasOs);
  return host ? (netSpecs.DISK_NET_MBPS[host.spec] ?? 80) : null;
}

/** The speed of the jack the cable is in; with no cable, the best jack the machine could use (shown dimmed). */
function portSpeed(s: Snapshot): { mbps: number | null; plugged: boolean; label: string } {
  const p = s.net.port;
  if (p.kind) {
    return {
      mbps: p.mbps,
      plugged: true,
      label: p.kind === 'board' ? 'Board jack' : (s.devices.find((d) => d.id === p.deviceId)?.name ?? 'Network card'),
    };
  }
  const board = s.board.features.ethernetMbps;
  const nic = Math.max(
    0,
    ...nicsInOrder(s)
      .filter((d) => !d.burnt)
      .map((d) => nicMbps(d.spec)),
  );
  const best = Math.max(board, nic);
  return { mbps: best > 0 ? best : null, plugged: false, label: best > 0 ? 'Not plugged in' : 'No jack' };
}

const logFrac = (v: number, top: number): number =>
  v > 0 && top > 0 ? Math.min(1, Math.max(0.04, Math.log10(1 + v) / Math.log10(1 + top))) : 0;

/**
 * The four limits side by side, in the order data flows: port, router, plan, drive. The binding one is the slowest of
 * the four (the sim's own `bandwidth.binding` when the link works, else found here with the same tie order).
 */

function nicMbps(specId: string): number {
  const spec = boardSpecs.getSpec(specId);
  if (!spec || !('mbps' in spec) || typeof spec.mbps !== 'number') {
    return 0;
  }
  return spec.mbps;
}

function portDetail(port: { mbps: number | null; plugged: boolean; label: string }): string {
  if (port.plugged || port.mbps === null || port.mbps === 0) {
    return port.label;
  }
  return `${port.label} (best jack)`;
}

interface LimiterRaw {
  id: LimiterId;
  label: string;
  mbps: number | null;
  detail: string;
}

function limiterRaw(s: Snapshot): LimiterRaw[] {
  const n = s.net;
  const port = portSpeed(s);
  const disk = diskMbps(s);
  return [
    { id: 'port', label: 'Port', mbps: port.mbps, detail: portDetail(port) },
    {
      id: 'router',
      label: 'Router',
      mbps: n.router?.mbps ?? null,
      detail: n.router ? `${n.router.name}, ${n.router.clients} clients` : 'No router',
    },
    {
      id: 'isp',
      label: 'Plan',
      mbps: n.isp?.downMbps ?? null,
      detail: n.isp ? `${n.isp.name}, ${fmtMbit(n.isp.upMbps)} up` : 'No plan',
    },
    {
      id: 'disk',
      label: 'Drive',
      mbps: disk,
      detail: disk === null ? 'No OS drive' : (s.storage.find((d) => d.hasOs)?.name ?? 'Drive'),
    },
  ];
}

function boundLimiter(raw: LimiterRaw[], n: Snapshot['net']): LimiterId | null {
  let found: LimiterId | null = null;
  let min = Infinity;
  for (const r of raw) {
    if (r.mbps !== null && r.mbps < min) {
      min = r.mbps;
      found = r.id;
    }
  }
  return n.bandwidth.binding ?? (raw.every((r) => r.mbps !== null) ? found : null);
}

export function limiterLadder(s: Snapshot): LimiterLadder {
  const n = s.net;
  const raw = limiterRaw(s);
  const binding = boundLimiter(raw, n);
  const top = Math.max(...raw.map((r) => r.mbps ?? 0));
  return {
    binding,
    downMbps: n.bandwidth.downMbps,
    upMbps: n.bandwidth.upMbps,
    clients: n.bandwidth.clients,
    segs: raw.map((r) => ({
      id: r.id,
      label: r.label,
      mbps: r.mbps,
      detail: r.detail,
      text: r.mbps === null ? '-' : fmtMbit(r.mbps),
      binding: r.id === binding,
      frac: r.mbps === null ? 0 : logFrac(r.mbps, top),
    })),
  };
}

/**
 * The piece that sets the upload speed (the leg a web job pays for): the slowest of the port, the router and the plan's
 * upload, in the sim's tie order. The drive only limits what is written, so it never binds the upload. Null with no usable link.
 */
export function uploadLimiter(s: Snapshot): { id: 'port' | 'router' | 'isp'; text: string } | null {
  const n = s.net;
  if (!linkUsable(s) || n.bandwidth.upMbps <= 0) {
    return null;
  }
  const legs: { id: 'port' | 'router' | 'isp'; mbps: number }[] = [
    { id: 'port', mbps: n.port.mbps },
    { id: 'router', mbps: n.router?.mbps ?? 0 },
    { id: 'isp', mbps: n.isp?.upMbps ?? 0 },
  ];
  const [first] = legs;
  if (first === undefined) {
    return null;
  }
  let best = first;
  for (const l of legs) {
    if (l.mbps < best.mbps) {
      best = l;
    }
  }
  return { id: best.id, text: `limited by: ${best.id} (upload)` };
}

/** What to upgrade to speed the line up, in plain words (the binding limiter), or null when nothing is binding. */
export function limiterAdvice(l: LimiterLadder): string | null {
  switch (l.binding) {
    case null: {
      return null;
    }
    case 'port': {
      return 'The port is the slowest link: a better board jack or a network card speeds it up.';
    }
    case 'router': {
      return 'The router is the slowest link: a faster router speeds it up.';
    }
    case 'isp': {
      return 'The plan is the slowest link: a faster plan speeds it up.';
    }
    case 'disk': {
      return 'The drive is the slowest link: a faster drive speeds it up.';
    }
    default: {
      return null;
    }
  }
}
