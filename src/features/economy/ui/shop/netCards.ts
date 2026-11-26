// The picker cards of the network: the router spot and the wall socket (their ladders), the ethernet cable, the jacks and
// the other cables.

import type { Snapshot } from '@/worker/game/game';
import { describeId, KIND_LABEL } from '@/core/ui/logic';
import { fmtMbit, isJackId } from '@/features/network/ui/netdesc';
import { jackPort, netStateLines } from '@/features/network/ui/netui';
import { described, emptyCard } from './pickerBase';
import { ladderFor, nextUpgrade } from './pickerLadder';
import type { PickerAction, PickerLine, PickerModel } from './pickerTypes';

type InvItem = Snapshot['inventory'][number];

/** What a router in the inventory says about where it goes. */
const placeLine = (inv: InvItem): PickerLine =>
  inv.installable
    ? { level: 'info', text: 'Drag it onto the router spot next to the monitor. The machine can stay on.' }
    : {
        level: 'warn',
        text: `${(inv.reason ?? 'Nothing to place it on right now').replace(/^./u, (c) => c.toUpperCase())}.`,
      };

function netLines(s: Snapshot, kind: 'router' | 'isp', inv: InvItem | undefined): PickerLine[] {
  const cur = kind === 'router' ? s.net.router : s.net.isp;
  const lines: PickerLine[] = inv ? [placeLine(inv)] : [];
  if (kind === 'isp' && !cur) {
    lines.push({
      level: 'warn',
      text: 'No internet plan yet. Buy one below: it sets how fast jobs and results travel.',
    });
  }
  if (kind === 'router' && !cur && !inv) {
    lines.push({ level: 'warn', text: 'No router yet. Buy one below, then drag it from the inventory to this spot.' });
  }
  lines.push(...netStateLines(s));
  return lines;
}

/**
 * The card of the router spot, the wall socket or a router in the inventory: the ladder of routers or plans, the link in
 * plain lines, and (for a spare router) where it goes. Both are applied with the machine on.
 */
export function netCard(id: string, kind: 'router' | 'isp', s: Snapshot): PickerModel {
  const inv = id.startsWith('inv:') ? s.inventory.find((x) => x.id === id.slice(4)) : undefined;
  const specId = inv?.spec ?? (id === 'router' || id === 'wall' ? null : id);
  const cur = kind === 'router' ? s.net.router : s.net.isp;
  const d = describeId(id, s) ?? { title: KIND_LABEL[kind], plain: '', nerd: '' };
  const ladder = ladderFor(s, kind);
  // The router is external (own power): it comes out of its spot with the machine on or off.
  const actions: PickerAction[] =
    kind === 'router' && id === 'router' && cur
      ? [{ id: 'uninstall', label: 'Remove router', deviceId: 'router' }]
      : [];
  return {
    ...emptyCard(id, kind, d),
    ladder,
    current: cur?.id ?? null,
    focus: specId,
    lines: netLines(s, kind, inv),
    actions,
    emptyText: nextUpgrade(ladder) ? undefined : 'Nothing better to buy right now.',
  };
}

/** The ethernet cable: the one cable that moves with the machine on. */
function lanCard(id: string, s: Snapshot): PickerModel {
  const c = s.cables.find((x) => x.id === 'lan');
  const d = described(id, s);
  const { port } = s.net;
  let where: string | null = null;
  if (port.kind === 'board') {
    where = 'the board jack';
  } else if (port.kind === 'nic') {
    where = s.devices.find((x) => x.id === port.deviceId)?.name ?? 'a network card';
  }
  return {
    ...emptyCard(id, 'info', d),
    lines: [
      c?.connected === true
        ? {
            level: 'ok',
            text: `Plugged into ${where ?? 'a jack'}. Drag the plug to another jack to move it; the machine can stay on.`,
          }
        : { level: 'warn', text: c?.blocked ?? 'Not plugged in. Drag the plug onto a network jack.' },
      ...netStateLines(s),
    ],
  };
}

/** The line of a jack: dead, in use, or free. */
function jackLine(s: Snapshot, j: { port: string; mbps: number; burnt: boolean }): PickerLine {
  if (j.burnt) {
    return { level: 'bad', text: 'This jack is dead: the part is burnt out.' };
  }
  const { port } = s.net;
  const plugged = port.kind !== null && (port.kind === 'board' ? j.port === 'board' : j.port === port.deviceId);
  return {
    level: plugged ? 'ok' : 'info',
    text: plugged
      ? `The ethernet cable is plugged in here (${fmtMbit(j.mbps)}).`
      : `${fmtMbit(j.mbps)}. Drag the ethernet plug onto it to use it.`,
  };
}

/** A network jack on the board (eth0) or a card (eth1..): its speed and whether the cable is in it. */
function jackCard(id: string, s: Snapshot): PickerModel {
  const d = described(id, s);
  const j = jackPort(s, id);
  const lines: PickerLine[] = j ? [jackLine(s, j)] : [{ level: 'warn', text: 'There is no jack here.' }];
  return { ...emptyCard(id, 'info', d), lines };
}

/** Any other cable: connected, or why not. */
function cableCard(id: string, s: Snapshot): PickerModel {
  const cid = id.slice(6);
  const c = s.cables.find((x) => x.id === cid);
  const d = described(id, s);
  return {
    ...emptyCard(id, 'info', d),
    lines: c
      ? [
          {
            level: c.connected ? 'ok' : 'warn',
            text: c.connected
              ? 'Connected. Power off to unplug it.'
              : (c.blocked ?? 'Not plugged in. Drag its end to the socket.'),
          },
        ]
      : [],
  };
}

/** The card of a cable or a jack, or undefined. */
export function wireCard(id: string, s: Snapshot): PickerModel | undefined {
  if (id === 'cable.lan') {
    return lanCard(id, s);
  }
  if (isJackId(id)) {
    return jackCard(id, s);
  }
  return id.startsWith('cable.') && id !== 'cable.pcie' ? cableCard(id, s) : undefined;
}
