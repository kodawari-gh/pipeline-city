// The machine's cables (machine3d.ts), as real cables hanging under their weight (wires3d.ts): built all again when a cable comes or goes, one
// alone when its plug goes in or out (`syncCables`).
import { disposeTree } from '@/core/render/three/geometry';
import { mergeSiblings } from '@/core/render/three/merge';
import { buildRouter } from './router';
import { drain, standing, videoKey } from './keys';
import { placeRig, setKey } from './rigs';
import type { MachineParts, RoomGeo, Snapshot } from './types';
import { buildCables } from './wiring';

/** Is there no board in it: the case alone, or no case either (`shown`)? A board's patch, its cables and its parts do not apply to it. */
export const noBoard = (m: MachineParts): boolean => m.shown !== 'machine';

/** The cables' ids as they stand. */
const cableIdsOf = (s: Snapshot): string =>
  standing(s)
    .map((c) => c.id)
    .join(',');

/** `setCables`, with a `yield` after each cable's build (`assemble`: the page has its turn between them). */
export function* cablesSteps(m: MachineParts, s: Snapshot, geo: RoomGeo): Generator<void> {
  for (const u of m.unfade.values()) {
    u();
  }
  m.unfade.clear();
  m.built.clear();
  m.runs.clear();
  m.runsRev++;
  m.partLod?.drop(m.wires);
  disposeTree(m.wires);
  m.wires.clear();
  m.key = null;
  m.cableIds = cableIdsOf(s);
  m.videoKey = videoKey(s);
  yield* buildCables(m, s, geo);
  // the still parts of each cable group (the lead's plugs, the cords' ends, the grommets) in a few draws; a draggable end is merged in `rigStatic`
  mergeSiblings(m.wires);
  m.partLod?.build(m.wires); // (the still parts of the new cables, their rigs too; the key stays out)
  setKey(m, s.plugged?.id ?? null);
}

/** Build all the cables and the key again: the parts stay as they are. */
export function setCables(m: MachineParts, s: Snapshot, geo: RoomGeo): void {
  if (noBoard(m)) {
    return;
  }
  drain(cablesSteps(m, s, geo));
}

/** Build one draggable cable again as it stands (`seated`, default as it was; a dropped plug at its rest pose): the others stay as they are. */
export function setCable(m: MachineParts, kind: string, seated?: boolean): void {
  // (the rig draws in the cables' stand-ins: they are made again with the new rig)
  if (placeRig(m, kind, seated)) {
    m.partLod?.build(m.wires);
  }
}

/** Bring the cables in line with the sim: a plug in or out builds only its own cable, a key in or out only the key, a cable come or gone all. */
export function syncCables(m: MachineParts, s: Snapshot, geo: RoomGeo): void {
  buildRouter(m, s); // (the router bought or replaced: its detailed view stands over it)
  if (noBoard(m)) {
    return; // (no board, no cable: the case's leads lie coiled on its tray)
  }
  if (cableIdsOf(s) !== m.cableIds || videoKey(s) !== m.videoKey) {
    setCables(m, s, geo);
    return;
  }
  for (const c of standing(s)) {
    const b = m.built.get(c.id);
    if (b && b.seated !== c.connected) {
      setCable(m, c.id, c.connected);
    }
  }
  setKey(m, s.plugged?.id ?? null);
}
