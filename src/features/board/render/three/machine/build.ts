// The machine's build (machine3d.ts): the case, the board, the parts, the loop's hoses, the cables and the router's board in turn, a `yield` at
// each point where the page may have its turn (`Machine3D.make`), then the merge and the distance stand-ins.
import { PartLod } from '@/core/render/three/partlod';
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import { BD } from '../../layout/layout';
import { buildEmpty } from './board';
import { buildCase } from './case';
import { buildRouter } from './router';
import { relist } from './list';
import type { MachineParts, RoomGeo, Snapshot } from './types';
import { share, lodScope } from './share';
import { buildParts } from './fitted';

/** How the machine is built: in which room, merged (PERF22) or as it was before, with the distance stand-ins or without them. */
export interface BuildOpts {
  geo: RoomGeo;
  merge: boolean;
  lod: boolean;
}

/** The build: a `yield` at each point where the page may have its turn (`make`); the constructor runs it to the end. */
export function* assemble(m: MachineParts, s: Snapshot | null, o: BuildOpts): Generator<void> {
  if (m.shown !== 'nothing') {
    buildCase(m);
  }
  yield;
  if (m.shown === 'case') {
    buildEmpty(m);
  } else if (m.shown === 'machine') {
    m.buildBoard(s);
  }
  relist(m);
  yield;
  if (s && m.shown === 'machine') {
    yield* buildParts(m, s, o.geo);
  }
  buildRouter(m, s);
  m.rgb.position.set(BD.x + BD.w / 2, -(BD.y + BD.h / 2), FRONT - 900);
  m.spill.position.set(BD.x + BD.w / 2, -(BD.y + BD.h * 0.7), FRONT + 2500);
  m.root.add(m.rgb, m.spill);
  if (o.merge) {
    yield* share(m);
  }
  m.shared = true;
  yield;
  if (o.lod) {
    m.partLod = new PartLod(m.root, () => lodScope(m));
  }
}
