// The bookcase on the west wall (`bookcase`): smoked oak boards, five shelves of books (upright, leaning, stacked), a plant, a box, a bookend.
import { Group } from 'three';
import { pothos } from '../plants3d';
import { BOOKCASE } from '../roomplan';
import { shelvedBooks } from './books';
import { caseCarcass, casePlinth } from './carcass';
import { smokedOak } from './oak';
import { reseed } from './seed';
import { floorShadow } from './shapes';
import { fillShelves, shelving } from './shelves';

/**
 * A plain flat-pack bookcase in smoked oak on the west wall, facing the room: square sides, a flat top flush between them, a plain back, a
 * set-back plinth; five shelves of books (upright, leaning, stacked), a plant, a box, a bookend, a pothos on top.
 */
export function bookcase(): Group {
  const g = new Group(),
    { x, w, z0, z1, top } = BOOKCASE,
    xf = x + w;
  const oakMat = smokedOak();
  caseCarcass(g, oakMat);
  const c = shelving(g, oakMat);
  // (the same books in every room built: the light bake finds the bookend by where it stands, `lightmapmix.ts`; the gaps draw from their own
  // numbers, so the runs and the bookend stand where they did)
  reseed(11);
  fillShelves(c);
  g.add(shelvedBooks(c.books));
  casePlinth(g, oakMat);
  // a pothos on the top, trailing over the front edge
  g.add(
    pothos(x + w / 2 + 300, top, z1 - 2200, xf + 80, [
      { dz: 600, len: 9000 },
      { dz: -900, len: 5200 },
      { dz: 1500, len: 13_000 },
    ]),
  );
  g.add(floorShadow([x + w / 2, (z0 + z1) / 2], [w * 1.6, (z1 - z0) * 1.1], { k: 0.7 }));
  return g;
}
