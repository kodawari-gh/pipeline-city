// The machine's case (machine3d.ts): the shell of its tier with its basement, the light strips and the side panel.
import { own } from '@/core/render/three/materials';
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { CASE_GLASS, LAYOUT_CASE } from '../../layout/layout';
import { caseModel, innerStrips } from '../case3d';
import { GROMMETS } from '../casedetail3d';
import { fanHub } from '../fanhub3d';
import type { CaseKind, CaseModel, MachineParts } from './types';
import { spin, reveal } from './reveal';
import { basement } from './basement';

/** The side panel: it opens (casedoor.ts) from the board view in, for a drag or a tutorial target inside, or on a click on it (`toggleDoor`). */
function sidePanel(m: MachineParts, kind: CaseKind, cm: CaseModel): void {
  const door = { kind, cm, t: 0, zoom: 0, board: 0.13, zoomOpen: false, manual: null, inside: false, busy: false };
  m.door = door;
  reveal(m, { r: CASE_GLASS, z: FRONT, anywhere: true }, (z) => {
    door.zoom = z;
  });
}

/** The case of this tier, one of four (case3d.ts): its body stays, its outer side panel and glass fade as the camera comes in. */
export function buildCase(m: MachineParts): void {
  const kind = CASE_KIND[LAYOUT_CASE] ?? 'gamer',
    cm = caseModel(kind, m.T),
    shell = cm.root;
  m.caseRgb = cm.rgb;
  m.accent.setHex(cm.accent);
  m.strip = cm.strip;
  for (const s of cm.spins) {
    spin(m, s);
  }
  basement(m, kind, cm);
  // light strips along the inside of the top and the front (`innerStrips`)
  const strips = innerStrips(kind, cm);
  for (const [i, s] of strips.roots.entries()) {
    s.name = `case strip ${i}`;
    m.root.add(s);
  }
  m.head.caseRoots.push(...strips.roots);
  for (const l of strips.spins) {
    spin(m, l);
  }
  shell.add(fanHub());
  cm.door.name = 'case door';
  m.root.add(shell, cm.door);
  m.head.caseRoots.push(shell, cm.door);
  m.grommets = GROMMETS[kind];
  sidePanel(m, kind, cm);
  m.leds = cm.leds;
  for (const l of Object.values(cm.leds)) {
    own(l);
  }
  own(cm.strip);
  m.head.keep.push(...cm.screws);
}
