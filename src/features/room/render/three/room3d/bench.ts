// The bench along the glass west of the desk, and the aloe on it.
import { softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { STONE } from '../palette';
import { aloe } from '../plants3d';
import { BENCH } from '../roomplan';
import type { Build } from './types';

/** The bench along the glass west of the desk: a slab of dark stone at seat height on a plinth set in, in the trim's tone; the aloe on it. */
export function buildBench({ R, fl, trim }: Build): void {
  const B = BENCH,
    stone = mat(STONE, { roughness: 0.3 });
  const slab = softBox({ x: B.x0, y: B.top, w: B.x1 - B.x0, h: 600 }, B.z0, B.z1, stone, 60);
  slab.name = 'bench slab';
  R.add(slab);
  const plinth = softBox(
    { x: B.x0 + 500, y: B.top + 600, w: B.x1 - B.x0 - 1000, h: fl - B.top - 600 },
    B.z0 + 300,
    B.z1 - 700,
    trim,
    40,
  );
  plinth.name = 'bench plinth';
  R.add(plinth);
  const aloeOnBench = aloe(B.x1 - 2600, B.top, (B.z0 + B.z1) / 2);
  aloeOnBench.name = 'aloe';
  R.add(aloeOnBench);
}
