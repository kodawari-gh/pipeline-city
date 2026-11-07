// Parts for the shop's showcase viewer (core/render/three/viewer.ts): a part built alone, stood upright, centred on the origin and resting on y = 0.
// The builders are the board's own (the part looks as it does in the case). Where a part wears a 2D drawing in the case (a card's face, a drive's
// label), the showcase leaves it plain: the drawing is baked by the board's Pixi pass. A kind with no 3D model yet gives null.
import { Box3, Group, Vector3, type Material, type Object3D } from 'three';
import { readTheme, type Theme } from '@/core/render/theme';
import { rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { getSpec, type CardSpec, type NicSpec, type RamSpec, type StorageSpec } from '@/features/board/sim/specs';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { driveBody, driveKindOf, slotRect } from '@/features/storage/render/drives';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIE, GEO, LAYOUT_CASE, LAYOUT_TIER, PKG, setLayoutTier } from '../layout/layout';
import { card3d } from './card3d';
import { caseModel } from './case3d';
import { coolerModel } from './cooler3d';
import { nvmeStick, sataDrive, type Raise } from './parts3d';
import { ramStick } from './ram3d';

/** Build with the layout of this board tier (the builders read the layout's module state), then put the live board's layout back. */
function withLayout<T>(build: () => T, tier = 3, cas = tier): T {
  const was = [LAYOUT_TIER, LAYOUT_CASE] as const;
  setLayoutTier(tier, cas);
  try { return build(); } finally { setLayoutTier(...was); }
}

/** Centre a built part on the origin, resting on y = 0. */
function centred(root: Object3D): Group {
  const out = new Group();
  out.add(root);
  out.updateMatrixWorld(true);
  const b = new Box3().setFromObject(out), c = b.getCenter(new Vector3());
  root.position.set(-c.x, -b.min.y, -c.z);
  return out;
}

/** Stand a part built in board space (x east, y north, z up off the board) so z is up, then centre it. `turn`: also bring the board's y along x. */
function upright(root: Object3D, turn = false): Group {
  const tilt = new Group(), spin = new Group();
  tilt.rotation.x = -Math.PI / 2;
  tilt.add(root);
  spin.add(tilt);
  if (turn) spin.rotation.y = Math.PI / 2;
  return centred(spin);
}

/** A raised box of the drive's body, plain on top (the case's wears the 2D label). */
const plainRaise: Raise = (parent, r, z0, z1, side: Material, bevel = 0) => {
  const g = new Group();
  g.add(bevel ? softBox(r, z0, z1, side, bevel) : rectBox(r, z0, z1, side));
  parent.add(g);
  return g;
};

const grow = (r: { x: number; y: number; w: number; h: number }, e: number) => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** The processor: the package on its substrate under a satin nickel heat spreader. */
function cpuModel(): Group {
  const g = new Group();
  g.add(rectBox(PKG, BOARD_Z + 70, BOARD_Z + 150, mat(0x111a33, { roughness: 0.6 })));
  g.add(softBox(grow(DIE, 60), BOARD_Z + 150, BOARD_Z + 260, mat(0xb4b9bf, { metalness: 0.75, roughness: 0.38 }), 40));
  return g;
}

const CASE_ID = /^case(\d)$/;

/** The showcase model of a shop item, or null where there is none (a kind without a 3D builder). */
export function buildShowcaseModel(specId: string, T: Theme = readTheme()): Object3D | null {
  const c = CASE_ID.exec(specId);
  if (c) {
    const tier = Number(c[1]), kind = CASE_KIND[tier];
    if (!kind) return null;
    return centred(withLayout(() => { const m = caseModel(kind, T), g = new Group(); g.add(m.root, m.side); return g; }, tier));
  }
  const spec = getSpec(specId);
  if (!spec) return null;
  switch (spec.kind) {
    case 'ram': {
      const rs = spec as RamSpec;
      return upright(withLayout(() => ramStick(T, rs.visual, !!rs.ecc, GEO.dimm[0]!.rect).root), true);
    }
    case 'gpu': case 'npu': case 'nic': {
      const cs = spec as CardSpec | NicSpec;
      return upright(withLayout(() => {
        const card = card3d(spec.kind as 'gpu' | 'npu' | 'nic', cs.visual, 0, () => new Group());
        card.pose(0);
        return card.root;
      }));
    }
    case 'cpu': return upright(withLayout(() => cpuModel()));
    case 'cooler': return upright(withLayout(() => coolerModel((spec as { visual: string }).visual).root));
    case 'storage': {
      const kind = driveKindOf((spec as StorageSpec).visual);
      return upright(withLayout(() => {
        const g = new Group(), b = driveBody(kind, kind === 'ssd-nvme' ? 'm20' : 'sata0');
        if (kind === 'ssd-nvme') nvmeStick(g, slotRect('m20'), b, plainRaise);
        else sataDrive(g, kind === 'hdd', b, 0, plainRaise);
        return g;
      }));
    }
    default: return null;
  }
}
