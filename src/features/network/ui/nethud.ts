// Network HUD and state-chip helpers (docs/NETWORK.md "Snapshot", docs/UI.md "Network").

import type { LinkState, Snapshot } from '@/worker/game/game';
import { fmtMbit } from './netdesc';
import type { ChipLevel } from '@/core/ui/logic';
import type { IconName } from '../../economy/ui/shop/picker';

export const hasNetwork = (s: Snapshot): boolean => Boolean(s.net.router ?? s.net.isp);

const LINK_OK = new Set<LinkState>(['link-up', 'saturated']);
export const linkUsable = (s: Snapshot): boolean => LINK_OK.has(s.net.state);

// ---------- the state chip ----------

export interface NetChip {
  text: string;
  level: ChipLevel;
  title: string;
}

/** The link state in one chip: no cable, link up, link down (with its reason), saturated. Null with no network at all. */
export function netStateChip(s: Snapshot): NetChip | null {
  if (!hasNetwork(s)) {
    return null;
  }
  const n = s.net;
  const why = n.reason !== null && n.reason !== '' ? ` ${n.reason.charAt(0).toUpperCase()}${n.reason.slice(1)}.` : '';
  switch (n.state) {
    case 'no-device': {
      return { text: 'No service', level: 'idle', title: `The network needs a router and an internet plan.${why}` };
    }
    case 'no-cable': {
      return {
        text: 'No cable',
        level: 'warn',
        title: `The router and plan are there, but no ethernet cable is plugged into a jack.${why}`,
      };
    }
    case 'no-os': {
      return {
        text: 'Setup needed',
        level: 'warn',
        title: `The cable is in, but the OS cannot run the link yet.${why}`,
      };
    }
    case 'down': {
      return {
        text: 'Link down',
        level: s.powered ? 'bad' : 'warn',
        title: `The link is down.${why} Jobs already on the drive are safe.`,
      };
    }
    case 'link-up': {
      return {
        text: 'Link up',
        level: 'ok',
        title: 'The link is up: jobs download in the background, run on the OS and upload when done.',
      };
    }
    case 'saturated': {
      return {
        text: 'Saturated',
        level: 'warn',
        title: `Every client slot or the spool is full.${why} More bandwidth does not help while the OS or the drive is the limit.`,
      };
    }
    default: {
      return null;
    }
  }
}

/** The HUD chip: appears once a router exists. Short text (the speed when up), an icon name and a tooltip. */

function hudChipText(state: Snapshot['net']['state'], bw: number): string {
  if (state === 'link-up') {
    return fmtMbit(bw);
  }
  if (state === 'saturated') {
    return `${fmtMbit(bw)} full`;
  }
  if (state === 'no-cable') {
    return 'no cable';
  }
  if (state === 'down') {
    return 'down';
  }
  if (state === 'no-os') {
    return 'setup';
  }
  return 'no plan';
}

export function hudNetChip(s: Snapshot): (NetChip & { icon: IconName }) | null {
  if (!s.net.router) {
    return null;
  }
  const c = netStateChip(s);
  if (!c) {
    return null;
  }
  const n = s.net;
  const bw = n.bandwidth.downMbps;
  const text = hudChipText(n.state, bw);
  return { ...c, text, icon: 'net', title: `${c.title} Click for the network panel.` };
}
