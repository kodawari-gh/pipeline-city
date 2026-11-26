// The machine's draggable cables (machine3d.ts): each rig kept with its group, built as it stands (seated, or loose at its rest pose), shown or
// kept back, and followed by the power lens (`runs`); and the key in the USB port.
import { Group } from 'three';
import { disposeTree, rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { USB_PORT } from '../../layout/layout';
import { rigBuild } from '../cablerig3d';
import { inFlowOrder } from '../power/runs';
import type { BuiltRig, CableRig, CableRun, MachineParts } from './types';

/** Put one draggable cable's rig in as it stands (`setCable`, less the stand-ins). False: no such cable. */
export function placeRig(m: MachineParts, kind: string, seated?: boolean): boolean {
  const rig = m.rigs.get(kind),
    b = m.built.get(kind);
  if (!rig || !b) {
    return false;
  }
  if (seated !== undefined) {
    b.seated = seated;
  }
  for (const c of b.g.children.filter((x) => x.userData['rig'] === true)) {
    b.g.remove(c);
    disposeTree(c);
  }
  const built = rigBuild(rig, b.seated, m.rest.get(kind));
  built.group.visible = !m.unrun.has(kind);
  b.g.add(built.group);
  // (the case's own lead is nothing to pick, and no run of the power lens: it carries no power)
  if (rig.inert === true) {
    built.group.traverse(seeThrough);
  } else {
    m.runs.set(kind, {
      id: kind,
      strands: inFlowOrder(built.strands, rig.power),
      r: rig.look.r,
      seated: built.seated,
      seat: rig.seat,
      held: false,
      fed: rig.power?.fed === true,
    });
    m.runsRev++;
  }
  m.unfade.get(kind)?.();
  m.unfade.delete(kind);
  if (b.seated && b.fade) {
    m.unfade.set(kind, b.fade());
  }
  return true;
}

/** Keep a draggable cable's rig and add its cable as it stands (seated, or loose at its rest pose). `fade`: its card fades it while it is in. */
export function addRig(m: MachineParts, rig: CableRig, { g, seated, fade }: BuiltRig): void {
  m.rigs.set(rig.id, rig);
  m.built.set(rig.id, { g, seated, fade });
  placeRig(m, rig.id);
}

/** Show a cable's rig, or keep it out of sight while the stage holds it back (`unrun`). */
export function showRig(m: MachineParts, id: string): void {
  const b = m.built.get(id);
  if (!b) {
    return;
  }
  for (const c of b.g.children) {
    if (c.userData['rig'] === true) {
      c.visible = !m.unrun.has(id);
    }
  }
}

/** The cables a hand holds now (the plug hides the built cable: the hand draws its own). The set is reused: read it at once. */
export function heldCables(m: MachineParts): ReadonlySet<string> {
  m.heldSet.clear();
  for (const [id, b] of m.built) {
    if (b.g.children.some((c) => c.userData['rig'] === true && !c.visible)) {
      m.heldSet.add(id);
    }
  }
  return m.heldSet;
}

/** The cables that carry power, as the power lens follows them, with whether a hand holds each (`Machine3D.cableRuns`). */
export function cableRuns(m: MachineParts): CableRun[] {
  const held = heldCables(m),
    out: CableRun[] = [];
  for (const r of m.runs.values()) {
    out.push({ ...r, held: held.has(r.id) });
  }
  return out;
}

/** The key in the USB port (`id`), or none: only the key is built again. */
export function setKey(m: MachineParts, id: number | null): void {
  if ((m.key?.id ?? null) === id) {
    return;
  }
  if (m.key) {
    m.wires.remove(m.key.g);
    disposeTree(m.key.g);
    m.key = null;
  }
  if (id === null) {
    return;
  }
  const g = tag(new Group(), `key:${id}`),
    y = USB_PORT.y + USB_PORT.h / 2,
    z = BOARD_Z + 600;
  g.add(
    rectBox({ x: USB_PORT.x - 760, y: y - 115, w: 560, h: 230 }, z - 60, z + 60, mat(0x2a_2d_32, { roughness: 0.45 })),
  );
  g.add(
    rectBox(
      { x: USB_PORT.x - 200, y: y - 60, w: 200, h: 120 },
      z - 40,
      z + 40,
      mat(0xb9_ba_bf, { metalness: 0.7, roughness: 0.3 }),
    ),
  );
  m.wires.add(g);
  m.key = { id, g };
}
