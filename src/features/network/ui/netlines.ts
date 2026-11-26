// Link checklist, picker lines and stats for network parts (docs/UI.md "Network").

import * as boardSpecs from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import * as netSpecs from '../sim/specs';
import { fmtMbit, nicsInOrder } from './netdesc';
import type { PickerLine, Stat } from '../../economy/ui/shop/picker';
import { linkUsable, netStateChip } from './nethud';

// ---------- the link checklist ----------

interface CheckItem {
  id: 'plan' | 'router' | 'jack' | 'cable' | 'os' | 'ram';
  label: string;
  ok: boolean;
  why: string;
}

function ramSizeK(specId: string): number {
  const spec = boardSpecs.getSpec(specId);
  if (!spec || !('sizeBytes' in spec) || typeof spec.sizeBytes !== 'number') {
    return 0;
  }
  return spec.sizeBytes / 1024;
}

const ramK = (s: Snapshot): number =>
  s.devices.filter((d) => d.kind === 'ram' && !d.burnt).reduce((n, d) => n + ramSizeK(d.spec), 0);

/** The things a working link needs, each ok or missing with the reason in words (hover text). */
function linkChecklist(s: Snapshot): CheckItem[] {
  const jack = s.board.features.ethernetMbps > 0 || nicsInOrder(s).some((d) => !d.burnt);
  const lan = s.cables.find((c) => c.id === 'lan');
  const need = netSpecs.NET.minRamBytes / 1024;
  const items: CheckItem[] = [
    {
      id: 'plan',
      label: 'Plan',
      ok: Boolean(s.net.isp),
      why: s.net.isp ? s.net.isp.name : 'needs an internet plan: click the wall socket',
    },
    {
      id: 'router',
      label: 'Router',
      ok: Boolean(s.net.router),
      why: s.net.router ? s.net.router.name : 'needs a router next to the monitor',
    },
    {
      id: 'jack',
      label: 'Jack',
      ok: jack,
      why: jack
        ? 'a network jack is there'
        : 'needs a network jack: a Basic or better board, or a network card (needs a PCIe slot)',
    },
    {
      id: 'cable',
      label: 'Cable',
      ok: lan?.connected === true,
      why:
        lan?.connected === true
          ? 'the ethernet cable is plugged in'
          : (lan?.blocked ?? 'plug the ethernet cable into a jack'),
    },
    { id: 'os', label: 'OS', ok: Boolean(s.os), why: s.os ? s.os.name : 'needs an OS: it runs the link' },
    {
      id: 'ram',
      label: `${need}K RAM`,
      ok: ramK(s) >= need,
      why:
        ramK(s) >= need
          ? `${Math.round(ramK(s))}K installed`
          : `needs ${need}K of RAM (you have ${Math.round(ramK(s))}K)`,
    },
  ];
  // The network asks for no memory beyond the OS's own (NET.minRamBytes is 0): the row only exists if that is ever raised.
  return need > 0 ? items : items.filter((c) => c.id !== 'ram');
}

/** The unmet requirements, as one sentence ("To use it you still need an OS and a router."), or the all-clear. */
function stillNeeds(s: Snapshot, skip: CheckItem['id'][] = []): string {
  const miss = linkChecklist(s).filter((c) => !c.ok && !skip.includes(c.id));
  if (miss.length === 0) {
    return 'Everything it needs is in place.';
  }
  const words: Record<CheckItem['id'], string> = {
    plan: 'a plan',
    router: 'a router',
    jack: 'a network jack',
    cable: 'the cable',
    os: 'an OS',
    ram: `${netSpecs.NET.minRamBytes / 1024}K of RAM`,
  };
  const list = miss.map((c) => words[c.id]);
  return `To use it you still need ${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]}.`;
}

/**
 * What a part of the network still cannot do for lack of the rest of the machine (an OS, 64K of RAM, a jack), as one
 * sentence for the warning on a buy rung. The plan, router and cable are the player's next steps, so they are not warned
 * about; a network card brings its own jack. Null when nothing hardware is missing.
 */
export function hardwareWarn(s: Snapshot, kind: 'router' | 'isp' | 'nic'): string | null {
  const skip: CheckItem['id'][] = ['plan', 'router', 'cable', ...(kind === 'nic' ? ['jack' as const] : [])];
  return linkChecklist(s).some((c) => !c.ok && !skip.includes(c.id)) ? stillNeeds(s, skip) : null;
}

/** The link in one or two plain lines for a card: the state with its reason, and the speed when it works. */
export function netStateLines(s: Snapshot): PickerLine[] {
  const chip = netStateChip(s);
  if (!chip) {
    return [];
  }
  const n = s.net;
  const lines: PickerLine[] = [
    {
      level: chip.level === 'idle' ? 'info' : chip.level,
      text: `${chip.text}${n.reason !== null && n.reason !== '' ? `: ${n.reason}` : ''}`,
    },
  ];
  if (linkUsable(s)) {
    const lim: Record<netSpecs.Binding, string> = {
      port: 'the port',
      router: 'the router',
      isp: 'the plan',
      disk: 'the drive',
    };
    const b = n.bandwidth;
    lines.push({
      level: 'info',
      text: `Download ${fmtMbit(b.downMbps)}, upload ${fmtMbit(b.upMbps)}, ${b.clients} clients at once${b.binding ? `. Limited by ${lim[b.binding]}.` : '.'}`,
    });
  }
  return lines;
}

/** Lines for an installed network card: its jack, whether the cable is in it, and the half-speed warning. */
export function nicLines(s: Snapshot, dev: { id: string; throttle: number; burnt: boolean }): PickerLine[] {
  const n = nicsInOrder(s).findIndex((d) => d.id === dev.id);
  const plugged = s.net.port.kind === 'nic' && s.net.port.deviceId === dev.id;
  const out: PickerLine[] = [
    plugged
      ? { level: 'ok', text: `The ethernet cable is plugged into this card (${fmtMbit(s.net.port.mbps)}).` }
      : {
          level: 'info',
          text: `Its jack is eth${n + 1}. Drag the ethernet plug onto it to use this card instead of the board jack.`,
        },
  ];
  if (!dev.burnt && dev.throttle < 1) {
    out.push({ level: 'warn', text: 'Too hot: the card runs at half speed. Better airflow or a slower card helps.' });
  }
  return out;
}

// ---------- stats of routers and plans, and the effective speed with a candidate ----------

/** Numeric stats of a router or plan spec for the before/after bars (log scale for the speeds), or null for other ids. */
export function netStats(specId: string): Stat[] | null {
  const r = netSpecs.getRouterSpec(specId);
  if (r) {
    return [
      {
        key: 'bandwidth',
        label: 'Port speed',
        icon: 'net',
        value: r.mbps,
        unit: 'Mbit',
        higherIsBetter: true,
        log: true,
      },
      { key: 'clients', label: 'Clients at once', icon: 'slot', value: r.clients, unit: '', higherIsBetter: true },
    ];
  }
  const p = netSpecs.getIspSpec(specId);
  if (p) {
    return [
      {
        key: 'bandwidth',
        label: 'Download',
        icon: 'down',
        value: p.downMbps,
        unit: 'Mbit',
        higherIsBetter: true,
        log: true,
      },
      { key: 'upload', label: 'Upload', icon: 'up', value: p.upMbps, unit: 'Mbit', higherIsBetter: true, log: true },
      { key: 'clients', label: 'Clients at once', icon: 'slot', value: p.clients, unit: '', higherIsBetter: true },
    ];
  }
  return null;
}

/** NIC extra stats: the cards also have headroom before they throttle. */
export function nicStats(spec: boardSpecs.NicSpec): Stat[] {
  return [
    { key: 'bandwidth', label: 'Speed', icon: 'net', value: spec.mbps, unit: 'Mbit', higherIsBetter: true, log: true },
    { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    {
      key: 'throttle',
      label: 'Throttles at',
      icon: 'flame',
      value: spec.thermal.throttleC,
      unit: 'C',
      higherIsBetter: true,
    },
  ];
}
