// A socket's look between empty and taken (machine3d.ts): the unseen drop box over a free socket, and the swap of a pick box for the part.
import { BufferGeometry } from 'three';
import type { MachineParts, Object3D } from './types';

/** A socket and whether a part is in it now. */
export interface Fill {
  slot: string;
  filled: boolean;
}

/** Take a drop box or a plate away, and free its geometry. */
export const freeBox = (o: Object3D): void => {
  o.removeFromParent();
  o.traverse((x) => {
    const g: unknown = 'geometry' in x ? x.geometry : undefined;
    if (g instanceof BufferGeometry) {
      g.dispose();
    }
  });
};

/** The drop box of `slot`: gone with a part in it (`filled`), back as `make` makes it when it is freed. */
export function swapPick(m: MachineParts, { slot, filled }: Fill, make: () => void): void {
  const pick = m.picks.get(slot);
  if (filled && pick) {
    freeBox(pick);
    m.picks.delete(slot);
  } else if (!filled && !pick) {
    make();
  }
}
