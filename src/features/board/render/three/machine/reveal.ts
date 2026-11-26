// What the live frame and the camera drive (machine3d.ts): a fan or a light of the machine's own pieces (`spin`), and a point whose zoom shows
// or hides something (`reveal`).
import { revealAt } from '../parts';
import { markSpin } from './keys';
import type { MachineParts, RectLike, Spin } from './types';

/** Let the live frame drive a fan or a light of the machine's own pieces (the case, the board). */
export function spin(m: MachineParts, s: Spin): void {
  markSpin(s);
  m.head.spins.push(s);
}

/** Where a reveal reads the zoom: the centre of `r` at depth `z`. `anywhere`: the camera zoom there, wherever the view centre is. */
export interface Spot {
  r: RectLike;
  z: number;
  anywhere?: boolean;
}

/** Run `apply` every frame with the zoom seen at the centre of the spot (`Spot`). */
export function reveal(m: MachineParts, { r, z, anywhere = false }: Spot, apply: (z: number) => void): void {
  m.head.reveals.push({ ...revealAt(r, z, apply), anywhere });
}
