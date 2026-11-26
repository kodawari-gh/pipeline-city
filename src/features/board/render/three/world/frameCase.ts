// The frame's machine (board3d.ts): the side panel open while a drag or the tutorial goes into the case, the machine and the plug hand
// stepped, and the outline round the hovered, the selected and the tutorial's parts.
import type { Object3D } from 'three';
import { hover, selected } from '@/app/hover';
import { highlight } from '@/app/interaction';
import { findById, ownerOf } from '@/core/render/three/pick';
import type { Snapshot } from '@/worker/protocol';
import type { LinkLeds } from '@/features/network/render/jackleds';
import { real, roots } from './anchors';
import { OUTSIDE } from './consts';
import type { World } from './world';

/**
 * A drag into the case, or a tutorial target inside it, opens its side panel from any distance (a key, a desk cable or the outside do not)
 * (a plug the hand still slides in or lets fall keeps it open too). Then the machine and the hand take their step.
 */
export const caseStep = (w: World, s: Snapshot | null, p: { dt: number; net: ReturnType<LinkLeds['step']> }): void => {
  const { hand, lift } = w.hands,
    { machine } = w.held;
  const { kind } = hand,
    handIn = kind !== null && kind !== '' && !OUTSIDE.has(`cable.${kind}`);
  if (machine) {
    const m = machine;
    m.setOpen(
      lift.intoCase ||
        handIn ||
        highlight.peek().some((id) => !OUTSIDE.has(id) && !id.startsWith('key:') && findById(m.root, id) !== null),
      lift.busy || handIn,
    );
  }
  machine?.frame(s, p.dt, p.dt, p.net);
  hand.frame(p.dt, w.stage.camera);
};

/** The outline: the hovered part, the selected one and the tutorial's targets. */
export const outlineStep = (w: World): void => {
  const ids = new Set(
    [hover.peek()?.id, selected.peek(), ...highlight.peek(), ...w.hands.lift.targets()].filter(
      (x): x is string => x !== null && x !== undefined && x !== '',
    ),
  );
  const picked: Object3D[] = [];
  for (const id of ids) {
    for (const r of roots(w)) {
      const o = findById(r, real(w, id));
      if (o) {
        const owner = ownerOf(o);
        if (owner) {
          picked.push(owner);
        }
        break;
      }
    }
  }
  w.stage.post.setOutlined(picked);
  const ok = [...ids].join('|');
  if (ok !== w.clock.outlineKey) {
    w.clock.outlineKey = ok;
    w.stage.demand.ask();
  }
};
