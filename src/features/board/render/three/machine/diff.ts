// What a patch changes (machine3d.ts, `patch`): the parts that went and came between the machine and a snapshot, and the ones that went taken out.
import { fanHost } from '../../../sim/board';
import { renamePart } from '../parts';
import { keyOf, untag } from './keys';
import type { DeviceSnap, MachineParts, Snapshot } from './types';

/** What a patch changes: the parts that go and come, whether a host's fans moved, and the parts as they stand next. */
export interface Diff {
  gone: DeviceSnap[];
  came: DeviceSnap[];
  hosts: boolean;
  nxt: Map<string, DeviceSnap>;
}

/** The parts that go and come; a fan on a heatsink is part of its host's model: the host is built again, with the fan or without it. */
export function diffOf(m: MachineParts, s: Snapshot): Diff {
  const cur = new Map(m.devs.map((d) => [keyOf(d), d])),
    nxt = new Map(s.devices.map((d) => [keyOf(d), d]));
  const gone = [...cur].filter(([k]) => !nxt.has(k)).map(([, d]) => d),
    came = [...nxt].filter(([k]) => !cur.has(k)).map(([, d]) => d);
  let hosts = false;
  for (const d of [...gone, ...came]) {
    const h = d.kind === 'fan' ? fanHost(d.slot) : null;
    if (h === null) {
      continue;
    }
    hosts = true;
    const was = m.devs.find((x) => x.slot === h),
      is = s.devices.find((x) => x.slot === h);
    if (was && !gone.includes(was)) {
      gone.push(was);
    }
    if (is && !came.includes(is)) {
      came.push(is);
    }
  }
  return { gone, came, hosts, nxt };
}

/** What goes: its part build (the lists, skins, cards, bank and cooler are computed from what stays). A part that stands as it was under a new id, a refit one: its look follows the new id. */
export function dropGone(m: MachineParts, { gone, nxt }: Diff): void {
  for (const d of gone) {
    const b = m.parts.get(keyOf(d));
    // (a hidden part answers to no id: a host built again keeps its id, and a lookup must find the new one, never the copy left here)
    for (const r of b?.roots ?? []) {
      r.visible = false;
      untag(r);
      m.graveyard.push(r);
    }
    m.parts.delete(keyOf(d));
  }
  for (const [k, d] of nxt) {
    const b = m.parts.get(k);
    if (!b || b.id === d.id) {
      continue;
    }
    m.parts.set(k, renamePart(b, d.id));
    const ps = m.powerSkins.get(b.id);
    if (ps) {
      m.powerSkins.delete(b.id);
      m.powerSkins.set(d.id, ps);
    }
  }
}
