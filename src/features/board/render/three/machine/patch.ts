// The machine's patch (machine3d.ts): bring it in line with a snapshot that differs from it by whole sticks, drives or cards, with no new build.
import { noBoard, setCables } from './cables';
import { GRAVE_MAX } from './consts';
import { keyOf, patchable } from './keys';
import type { MachineParts, RoomGeo, Snapshot } from './types';
import { diffOf, dropGone } from './diff';
import { mergeAdded, addCame } from './came';
import { refreshFanPicks } from './patch-fans';

/** A host of fans came or went: a cooler, a VRM sink or a memory sink. */
const HOSTS: ReadonlySet<string> = new Set(['cooler', 'vrm-sink', 'ram-sink']);

/**
 * Bring the machine in line with a snapshot that differs from it by whole sticks, drives or cards (Build my PC: a fit or a removal builds no
 * new machine). A part that goes is hidden (the stand-ins of `partLod` know a part by its hiding) and its entries leave the shared lists; a part
 * that comes is built alone and merged alone, as the build does it; the sockets they take or free change their look; the cables hang again.
 * False, with nothing changed, when the change is more than that (another kind of part, a host's fans, a new board or case, a grave grown
 * too big): the caller builds the machine again.
 */
export function patch(m: MachineParts, s: Snapshot, geo: RoomGeo): boolean {
  if (noBoard(m) || m.tiers !== `${s.boardTier}|${s.caseTier}` || m.graveyard.length >= GRAVE_MAX) {
    return false;
  }
  const diff = diffOf(m, s),
    both = [...diff.gone, ...diff.came];
  if (both.some((d) => !patchable(d)) || diff.gone.some((d) => !m.parts.has(keyOf(d)))) {
    return false;
  }
  dropGone(m, diff);
  const added = addCame(m, s, diff);
  if (diff.hosts || both.some((d) => HOSTS.has(d.kind))) {
    refreshFanPicks(m, s);
  }
  mergeAdded(m, added);
  setCables(m, s, geo);
  return true;
}
