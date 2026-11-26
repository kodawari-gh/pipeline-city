// The heatsinks' fan spots after a patch (machine3d.ts, `patch`): their drop boxes made again, as a host or its fan came or went.
import { hostFanPicks } from './fan-picks';
import { freeBox } from './swap';
import type { MachineParts, Snapshot } from './types';

/** The free fan spots of the heatsinks, made again: a host or a fan came or went. */
export function refreshFanPicks(m: MachineParts, s: Snapshot): void {
  for (const [id, o] of m.picks) {
    if (/\.fan\d+$/u.test(id)) {
      freeBox(o);
      m.picks.delete(id);
    }
  }
  hostFanPicks(m, s, new Set(s.devices.map((d) => d.slot)));
}
