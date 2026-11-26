// The world's hands (board3d.ts): the plug hand and the drag, the pad, the tutorial's cues, and the anchors and flights the tutorial and the
// cards use (the same contract as the 2D renderer: `anchorOf`, `flyTo` in board.ts).
import { setPartDragHandler } from '@/core/ui/worldDrag';
import { setWorldAnchors } from '../../board';
import { Cues3D } from '../cues3d';
import { anchorsOf } from './anchors';
import { flyToId } from './flyToId';
import { newHands } from './lift';
import { openPointers } from './pointers';
import type { Hands, Scope } from './world';

/** The hands, wired in the order the boot made them. */
export function openHands(s: Scope): Hands {
  const { hand, lift } = newHands(s);
  setPartDragHandler((invId, e) => {
    lift.beginPart(invId, e);
  });
  const pointers = openPointers(s, lift);
  const cues = new Cues3D((id) => anchorsOf(s, id));
  setWorldAnchors({ anchorsOf: (id) => anchorsOf(s, id), flyTo: (id, o) => flyToId(s, id, o) });
  return { hand, lift, cues, pointers };
}
