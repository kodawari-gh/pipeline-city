// The case's own front-panel leads (machine3d.ts, the cables in the case): out of their hole under the board's south edge to the board's headers.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { panelRigs } from '../casetray3d';
import { addRig } from './rigs';
import type { Inside, MachineParts } from './types';

/** The front-panel leads: rigs the stage's hand can run (not the game's cables), each out of its header while the stage says so (`panelOut`). */
export function panelLeads(m: MachineParts, c: Inside): void {
  for (const rig of panelRigs(c.env)) {
    const g = tag(new Group(), `cable.${rig.id}`);
    addRig(m, rig, { g, seated: !m.panelOut.has(rig.id) });
    m.wires.add(g);
  }
}
