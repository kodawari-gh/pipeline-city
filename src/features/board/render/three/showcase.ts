// Parts for the shop's showcase viewer (core/render/three/viewer.ts): a part built alone, stood upright, centred on the origin and resting on y = 0.
// The builders are the case's own (machine3d.ts): the gallery shows the very models the game and Build my PC show, in the PC's own palette. A part
// that wears 2D art bakes it with its own `ArtSet`, which the viewer runs and drops with the part; the CPU's lid fades over the die as in the case.
// A kind with no 3D model yet gives null.
import { Box3, Group, Vector3, type Object3D } from 'three';
import { builtinTheme, type Theme } from '@/core/render/theme';
import { BOARD_TIERS, getSpec, type CardSpec, type CpuSpec, type FanSpec, type NicSpec, type PsuSpec, type RamSpec, type StorageSpec } from '@/features/board/sim/specs';
import { Monitor } from '@/features/room/render/three/props3d';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { driveBody, driveKindOf, slotRect } from '@/features/storage/render/drives';
import { DESK_Y, GEO, LAYOUT_CASE, LAYOUT_TIER, MONITOR, SCREEN, fanLen, setLayoutTier } from '../layout/layout';
import { kitFit, radiatorGrade } from '../cooler';
import { ArtSet } from './artset3d';
import { boardModel } from './boardmodel3d';
import { cardModel } from './card3d';
import { basementPlan, cage, psuUnit, shroud } from './basement3d';
import { caseModel, innerStrips } from './case3d';
import { fanHub } from './fanhub3d';
import { leadCoil } from './casetray3d';
import { coolerModel, radiatorModel } from './cooler3d';
import { cpuModel } from './cpu3d';
import { fanDepth, fanPart } from './fans3d';
import { nvmeLook, nvmeStick } from './nvme3d';
import { driveRaise, sataDrive } from './parts3d';
import { tpmModel } from './tpm3d';
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

/** Build with its own art set (the 2D art baked onto the faces): the viewer runs it and drops it with the part (`ArtSet.attach`). */
function withArt(build: (art: ArtSet) => Object3D): Object3D {
  const art = new ArtSet(), o = build(art);
  art.attach(o);
  return o;
}

const CASE_ID = /^case(\d)$/, BOARD_ID = /^board(\d)$/;

/** The showcase model of a shop item, or null where there is none (a kind without a 3D builder). `T`: the PC's own palette, as the case uses. */
export function buildShowcaseModel(specId: string, T: Theme = builtinTheme(true)): Object3D | null {
  const c = CASE_ID.exec(specId);
  if (c) {
    const tier = Number(c[1]), kind = CASE_KIND[tier];
    if (!kind) return null;
    return centred(withLayout(() => {
      const m = caseModel(kind, T), g = new Group(), plan = basementPlan();
      // (the side panel hangs in its door's pivot group: added alone it would stand off the body by the pivot's offset)
      g.add(m.root, m.door, shroud(plan, m.shroud, m.rivet, m.screw), cage(plan, kind), fanHub(), leadCoil());
      for (const s of innerStrips(kind, m).roots) g.add(s);
      return g;
    }, tier));
  }
  const b = BOARD_ID.exec(specId);
  if (b) {
    const tier = Number(b[1]);
    return tier < BOARD_TIERS.length ? upright(withLayout(() => withArt((art) => boardModel(art, T, tier).root), tier)) : null;
  }
  const spec = getSpec(specId);
  if (!spec) return null;
  switch (spec.kind) {
    case 'ram': {
      const rs = spec as RamSpec;
      return upright(withLayout(() => ramStick(T, rs.visual, !!rs.ecc, GEO.dimm[0]!.rect, rs.name).root), true);
    }
    case 'gpu': case 'npu': case 'nic': {
      const cs = spec as CardSpec | NicSpec;
      // (standing, as in the case before the camera comes in: its face shows once it swings down flat)
      return upright(withLayout(() => withArt((art) => {
        const card = cardModel(art, T, spec.kind as 'gpu' | 'npu' | 'nic', cs.visual, 0);
        card.pose(0);
        return card.root;
      })));
    }
    case 'cpu': return upright(withLayout(() => withArt((art) => {
      const c = cpuModel(art, T, spec as CpuSpec);
      art.reveal(c.centre, c.lod);
      return c.root;
    })));
    case 'cooler': return upright(withLayout(() => coolerModel((spec as { visual: string }).visual).root));
    // (faces the viewer; 25 mm deep, the 40 mm fan 10 mm)
    case 'fan': {
      const fs = spec as FanSpec;
      return centred(fanPart(fs, fanLen(fs.size), fanDepth(fs.size)).root);
    }
    case 'storage': {
      const ss = spec as StorageSpec, kind = driveKindOf(ss.visual), slot = kind === 'ssd-nvme' ? 'm20' : 'sata0';
      return upright(withLayout(() => withArt((art) => {
        const g = new Group(), b = driveBody(kind, slot);
        if (kind === 'ssd-nvme') nvmeStick(g, b, nvmeLook(ss));
        else sataDrive(g, kind === 'hdd', b, 0, driveRaise(art, T, kind, slot, ss.name, ss.capacityBytes));
        return g;
      })));
    }
    case 'psu': {
      const ps = spec as PsuSpec;
      return centred(withLayout(() => psuUnit(basementPlan(), ps.visual, ps.fan !== false).root));
    }
    case 'radiator': {
      // the one the game fits on the Full tower's top: as long as its fan mounts there, no fans fitted
      const grade = radiatorGrade((spec as { visual: string }).visual);
      return centred(withLayout(() => { const kit = kitFit(grade)!; return radiatorModel(kit.fit, grade, kit.ids).root; }));
    }
    case 'tpm': {
      const visual = (spec as { visual: string }).visual;
      return upright(withLayout(() => {
        const g = new Group();
        tpmModel(g, visual);
        return g;
      }));
    }
    // (bare: a fan on it is a part of its own)
    case 'vrm-sink': case 'ram-sink': {
      const visual = (spec as { visual: string }).visual;
      return upright(withLayout(() => {
        const g = new Group();
        sinkBody(g, T, spec.kind as 'vrm-sink' | 'ram-sink', visual);
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
