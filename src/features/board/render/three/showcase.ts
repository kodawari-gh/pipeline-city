// Parts for the shop's showcase viewer (core/render/three/viewer.ts): a part built alone, stood upright, centred on the origin and resting on y = 0.
// The builders are the board's own (the part looks as it does in the case). Where a part wears a 2D drawing in the case (a card's face, a drive's
// label), the showcase leaves it plain: the drawing is baked by the board's Pixi pass. A kind with no 3D model yet gives null.
import { Box3, Group, Mesh, Path, Shape, Vector3, type Material, type Object3D } from 'three';
import { readTheme, type Theme } from '@/core/render/theme';
import { extrude, place, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_TIERS, getSpec, specsOfKind, type CardSpec, type FanSpec, type NicSpec, type PsuSpec, type RamSpec, type StorageSpec } from '@/features/board/sim/specs';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import { Monitor } from '@/features/room/render/three/props3d';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { driveBody, driveKindOf, slotRect } from '@/features/storage/render/drives';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DESK_Y, DIE, FAN_W, GEO, LAYOUT_CASE, LAYOUT_TIER, MONITOR, PKG, SCREEN, fanLen, setLayoutTier } from '../layout/layout';
import { kitFit, radiatorGrade } from '../cooler';
import { boardModel } from './boardmodel3d';
import { card3d } from './card3d';
import { basementPlan, cage, psuUnit, shroud } from './basement3d';
import { caseModel } from './case3d';
import { fanHub } from './fanhub3d';
import { leadCoil } from './casetray3d';
import { coolerModel, radiatorModel } from './cooler3d';
import { fanPart } from './fans3d';
import { nvmeStick, sataDrive, tpmModule, type Raise } from './parts3d';
import { sinkBody } from './sink3d';
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

/**
 * The processor: the package with its capacitors, the die with its core tiles and cache, and the heat spreader as an open frame round the die
 * (a cutaway: the board's lid fades away over the die view, and the die view's floorplan is baked 2D art, so the tiles here stand in for it).
 */
function cpuModel(): Group {
  const g = new Group(), z0 = BOARD_Z + 150;
  g.add(rectBox(PKG, BOARD_Z + 70, z0, mat(0x111a33, { roughness: 0.6 })));
  // capacitors in rows along the four edges, between the package's rim and the lid
  const cap = mat(0xc9b27a, { metalness: 0.5, roughness: 0.4 }), cw = 30, cl = 50, step = 70, rim = 20;
  for (let x = PKG.x + 100; x + cw <= PKG.x + PKG.w - 100; x += step) for (const y of [PKG.y + rim, PKG.y + PKG.h - rim - cl]) g.add(rectBox({ x, y, w: cl, h: cw }, z0, z0 + 28, cap));
  for (let y = PKG.y + 140; y + cw <= PKG.y + PKG.h - 140; y += step) for (const x of [PKG.x + rim, PKG.x + PKG.w - rim - cl]) g.add(rectBox({ x, y, w: cw, h: cl }, z0, z0 + 28, cap));
  // the die: dark silicon, a 2 x 2 block of core tiles over a strip of cache and a strip of memory controller and I/O
  g.add(rectBox(DIE, z0, z0 + 50, mat(0x1b2236, { metalness: 0.3, roughness: 0.35 })));
  const gap = 14, inner = grow(DIE, -26), coreH = inner.h * 0.5, tileW = (inner.w - gap) / 2, tileH = (coreH - gap) / 2;
  const core = mat(0x3b5a8f, { metalness: 0.2, roughness: 0.5 }), cache = mat(0x2c8f8f, { roughness: 0.5 }), io = mat(0x8f5a3b, { roughness: 0.5 });
  for (let i = 0; i < 4; i++) g.add(rectBox({ x: inner.x + (i % 2) * (tileW + gap), y: inner.y + Math.floor(i / 2) * (tileH + gap), w: tileW, h: tileH }, z0 + 50, z0 + 62, core));
  g.add(rectBox({ x: inner.x, y: inner.y + coreH, w: inner.w, h: inner.h * 0.28 }, z0 + 50, z0 + 60, cache));
  g.add(rectBox({ x: inner.x, y: inner.y + coreH + inner.h * 0.28 + gap, w: inner.w, h: inner.h - coreH - inner.h * 0.28 - gap }, z0 + 50, z0 + 58, io));
  // the heat spreader: a satin nickel frame round the die
  const o = grow(DIE, 40), hole = grow(DIE, 10), shape = new Shape(), cut = new Path();
  shape.moveTo(o.x, -o.y).lineTo(o.x + o.w, -o.y).lineTo(o.x + o.w, -(o.y + o.h)).lineTo(o.x, -(o.y + o.h)).closePath();
  cut.moveTo(hole.x, -hole.y).lineTo(hole.x, -(hole.y + hole.h)).lineTo(hole.x + hole.w, -(hole.y + hole.h)).lineTo(hole.x + hole.w, -hole.y).closePath();
  shape.holes.push(cut);
  const lid = place(new Mesh(extrude(shape, { depth: 70, bevelEnabled: true, bevelSize: 10, bevelThickness: 10, bevelSegments: 2 }), mat(0xb4b9bf, { metalness: 0.75, roughness: 0.38 })));
  lid.position.z = z0;
  g.add(lid);
  return g;
}

const CASE_ID = /^case(\d)$/, BOARD_ID = /^board(\d)$/;


/** The showcase model of a shop item, or null where there is none (a kind without a 3D builder). */
export function buildShowcaseModel(specId: string, T: Theme = readTheme()): Object3D | null {
  const c = CASE_ID.exec(specId);
  if (c) {
    const tier = Number(c[1]), kind = CASE_KIND[tier];
    if (!kind) return null;
    return centred(withLayout(() => {
      const m = caseModel(kind, T), g = new Group(), plan = basementPlan();
      // (the side panel hangs in its door's pivot group: added alone it would stand off the body by the pivot's offset)
      g.add(m.root, m.door, shroud(plan, m.shroud, m.rivet, m.screw), cage(plan, kind), fanHub(), leadCoil());
      return g;
    }, tier));
  }
  const b = BOARD_ID.exec(specId);
  if (b) return Number(b[1]) < BOARD_TIERS.length ? upright(withLayout(() => boardModel(T, Number(b[1])), Number(b[1]))) : null;
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
    // (faces the viewer; a 40 mm fan is half as thick as the others)
    case 'fan': {
      const fs = spec as FanSpec;
      return centred(fanPart(fs, fanLen(fs.size), fs.size > 40 ? FAN_W : FAN_W / 2).root);
    }
    case 'storage': {
      const kind = driveKindOf((spec as StorageSpec).visual);
      return upright(withLayout(() => {
        const g = new Group(), b = driveBody(kind, kind === 'ssd-nvme' ? 'm20' : 'sata0');
        if (kind === 'ssd-nvme') nvmeStick(g, slotRect('m20'), b, plainRaise);
        else sataDrive(g, kind === 'hdd', b, 0, plainRaise);
        return g;
      }));
    }
    case 'psu': {
      const ps = spec as PsuSpec;
      return centred(withLayout(() => psuUnit(basementPlan(), ps.visual, ps.fan !== false).root));
    }
    case 'radiator': {
      // two fan mounts long, no fans fitted
      const vis = (spec as { visual: string }).visual;
      return centred(withLayout(() => radiatorModel(kitFit(), radiatorGrade(vis), ['a', 'b']).root));
    }
    case 'tpm': {
      return upright(withLayout(() => {
        const g = new Group(), r = tpmRect(GEO.tier), h = tpmHeader(GEO.tier);
        if (r && h) tpmModule(g, r, headerRect(h), plainRaise);
        return g;
      }));
    }
    case 'vrm-sink': case 'ram-sink': {
      const visual = (spec as { visual: string }).visual;
      return upright(withLayout(() => {
        const g = new Group(), { spot, foot, top } = sinkBody(g, T, spec.kind as 'vrm-sink' | 'ram-sink', visual), fs = specsOfKind('fan').find((f) => f.size === 40);
        if (spot && fs) {
          const d = Math.min(spot.h, top - foot) * 0.95, fan = fanPart(fs, d, spot.w);
          fan.root.position.set(spot.x + spot.w / 2, -(spot.y + spot.h / 2), foot + d / 2);
          fan.root.rotation.y = Math.PI / 2;
          g.add(fan.root);
        }
        return g;
      }));
    }
    case 'display': {
      const m = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
      m.set({ installed: true, powered: true, live: false, text: '' }, 12);
      return centred(m.root);
    }
    default: return null;
  }
}
