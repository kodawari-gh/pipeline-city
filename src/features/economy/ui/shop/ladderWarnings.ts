// Warnings on the rungs of a ladder: what the rest of the machine lacks for each tier on offer.

import { getSpec } from '@/features/board/sim/specs';
import { getOsSpec } from '@/features/os/sim';
import type { Snapshot } from '@/worker/game/game';
import { cpuVrmWarning, liquidVrmNote, ramVrmWarning } from '@/features/board/ui/vrm';
import { hardwareWarn } from '@/features/network/ui/netui';
import type { LadderStep, PickerKind } from './pickerTypes';

/** Total memory of the working sticks in the machine, bytes. */
function installedRamBytes(s: Snapshot): number {
  let n = 0;
  for (const d of s.devices) {
    if (d.kind !== 'ram' || d.burnt) {
      continue;
    }
    const spec = getSpec(d.spec);
    if (spec?.kind === 'ram') {
      n += spec.sizeBytes;
    }
  }
  return n;
}

/** Warnings on the rungs (not on a part already fitted): a CPU the board's VRM cannot feed, a liquid cooler with no VRM heatsink. */
function warnVrm(s: Snapshot, kind: 'cpu' | 'ram' | 'cooler', out: LadderStep[]): void {
  for (const r of out) {
    if (r.state === 'installed') {
      continue;
    }
    if (kind === 'cpu') {
      r.warn = cpuVrmWarning(s, r.specId) ?? undefined;
    } else if (kind === 'ram') {
      r.warn = ramVrmWarning(s, r.specId) ?? undefined;
    } else {
      r.warn = liquidVrmNote(s, r.specId) ?? undefined;
    }
  }
}

/** An operating system the installed memory cannot hold: say so on the tile (the OS will not boot). */
function warnOsRam(s: Snapshot, out: LadderStep[]): void {
  const have = installedRamBytes(s);
  for (const r of out) {
    const spec = getOsSpec(r.specId);
    if (r.state === 'installed' || !spec || have >= spec.minRamBytes) {
      continue;
    }
    r.warn = `needs ${spec.minRamBytes / 1024}K of memory, you have ${have / 1024}K. Buy more memory first.`;
  }
}

/** The network parts: what the rest of the chain still lacks (an OS, 64K of RAM, a jack), and the words for owned and applied rungs. */
function warnNet(s: Snapshot, kind: 'router' | 'isp' | 'nic', out: LadderStep[]): void {
  const note = hardwareWarn(s, kind) ?? undefined;
  for (const r of out) {
    if (kind === 'isp') {
      r.applied = true;
    }
    if (r.state === 'installed') {
      if (kind !== 'nic') {
        r.fittedLabel = kind === 'isp' ? 'Active' : 'Placed';
      }
      continue;
    }
    r.warn = note;
  }
}

/** Adds the warnings and fitted words of a kind to its ladder's rungs, in place. */
export function warnRungs(s: Snapshot, kind: PickerKind, out: LadderStep[]): void {
  if (kind === 'cpu' || kind === 'ram' || kind === 'cooler') {
    warnVrm(s, kind, out);
  }
  if (kind === 'os') {
    warnOsRam(s, out);
  }
  if (kind === 'router' || kind === 'isp' || kind === 'nic') {
    warnNet(s, kind, out);
  }
}
