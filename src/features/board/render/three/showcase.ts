// Parts for the shop's showcase viewer (core/render/three/viewer.ts): a part built alone, stood upright with its long side along x, centred on the
// origin. The builders are the board's own (the part looks as it does in the case); a kind with no 3D model yet gives null.
import { Group, Box3, Vector3, type Object3D } from 'three';
import { readTheme, type Theme } from '@/core/render/theme';
import { getSpec, type RamSpec } from '@/features/board/sim/specs';
import { GEO, LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { ramStick } from './ram3d';

/** Build with the largest board's layout (the builders read the layout's module state), then put the live board's layout back. */
function withLayout<T>(build: () => T): T {
  const tier = LAYOUT_TIER, cas = LAYOUT_CASE;
  setLayoutTier(3, 3);
  try { return build(); } finally { setLayoutTier(tier, cas); }
}

/** Stand a part built in board space (x east, y north, z up off the board) so z is up, and centre it on the origin. */
function upright(root: Object3D, long: 'x' | 'y'): Group {
  const tilt = new Group(), turn = new Group();
  tilt.rotation.x = -Math.PI / 2; // board z (up off the board) becomes the viewer's up
  turn.add(tilt);
  tilt.add(root);
  if (long === 'y') turn.rotation.y = Math.PI / 2; // the board's long axis (y) comes along x
  turn.updateMatrixWorld(true);
  const b = new Box3().setFromObject(turn), c = b.getCenter(new Vector3());
  const out = new Group();
  turn.position.set(-c.x, -b.min.y, -c.z);
  out.add(turn);
  return out;
}

/** The showcase model of a shop item, or null where there is none (a kind without a 3D builder). */
export function buildShowcaseModel(specId: string, T?: Theme): Object3D | null {
  const spec = getSpec(specId);
  if (!spec) return null;
  if (spec.kind === 'ram') {
    const rs = spec as RamSpec;
    return upright(withLayout(() => ramStick(T ?? readTheme(),rs.visual, !!rs.ecc, GEO.dimm[0]!.rect).root), 'y');
  }
  return null;
}
