// Parts for the shop's showcase viewer (core/render/three/viewer.ts): a part built alone, stood upright, centred on the origin and resting on y = 0.
// The builders are the case's own (machine3d.ts): the gallery shows the very models the game and Build my PC show, in the PC's own palette. A part
// that wears 2D art bakes it with its own `ArtSet`, which the viewer runs and drops with the part; the CPU's lid fades over the die as in the case.
// A kind with no 3D model yet gives null.
import { Box3, Group, Object3D, Vector3 } from 'three';
import { builtinTheme, type Theme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import type { RectLike } from '@/core/render/three/geometry';
import {
  BOARD_TIERS,
  getSpec,
  type CardSpec,
  type CpuSpec,
  type FanSpec,
  type NicSpec,
  type PsuSpec,
  type RamSpec,
  type StorageSpec,
} from '@/features/board/sim/specs';
import { Monitor } from '@/features/room/render/three/props3d';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { driveBody, driveKindOf } from '@/features/storage/render/drives';
import { DESK_Y, GEO, LAYOUT_CASE, LAYOUT_TIER, MONITOR, SCREEN, fanLen, setLayoutTier } from '../layout/layout';
import { kitFit, radiatorGrade } from '../cooler';
import { ArtSet } from './artset3d';
import { boardModel } from './boardmodel3d';
import { cardModel } from './card3d';
import type { Lying } from './routerboard3d';
import { basementPlan, shroud } from './basement3d';
import { baseCagePlan, cagePlan, driveCage } from './drivecage3d';
import { sataDriveModel } from './drive3d';
import { psuUnit } from './psu3d';
import { caseModel, innerStrips } from './case3d';
import { fanHub } from './fanhub3d';
import { leadCoil } from './casetray3d';
import { coolerModel, radiatorModel } from './cooler3d';
import { cpuModel } from './cpu3d';
import { fanDepth, fanPart } from './fans3d';
import { nvmeLook, nvmeStick } from './nvme3d';
import { tpmDieFace, tpmDieFade, tpmModel } from './tpm3d';
import { sinkBody } from './sink3d';
import { dieShown, ramStick, stickFade } from './ram3d';
import { routerModel, routerTier } from './router3d';
import { routerInsides } from './routerinside3d';

/** Build with the layout of this board tier (the builders read the layout's module state), then put the live board's layout back. */
function withLayout<T>(build: () => T, tier = 3, cas = tier): T {
  const was = [LAYOUT_TIER, LAYOUT_CASE] as const;
  setLayoutTier(tier, cas);
  try {
    return build();
  } finally {
    setLayoutTier(...was);
  }
}

/** Centre a built part on the origin, resting on y = 0. */
function centred(root: Object3D): Group {
  const out = new Group();
  out.add(root);
  out.updateMatrixWorld(true);
  const b = new Box3().setFromObject(out),
    c = b.getCenter(new Vector3());
  root.position.set(-c.x, -b.min.y, -c.z);
  return out;
}

/** Stand a part built in board space (x east, y north, z up off the board) so z is up, then centre it. `turn`: also bring the board's y along x. */
function upright(root: Object3D, turn = false): Group {
  const tilt = new Group(),
    spin = new Group();
  tilt.rotation.x = -Math.PI / 2;
  tilt.add(root);
  spin.add(tilt);
  if (turn) spin.rotation.y = Math.PI / 2;
  return centred(spin);
}

/** Build with its own art set (the 2D art baked onto the faces): the viewer runs it and drops it with the part (`ArtSet.attach`). */
function withArt(build: (art: ArtSet) => Object3D): Object3D {
  const art = new ArtSet(),
    o = build(art);
  art.attach(o);
  return o;
}

/** A point over the centre of a face `r` at depth `z`, under `parent`: the camera's zoom there reveals the face (`ArtSet.reveal`), as the game's reveals do. */
function marker(parent: Object3D, r: RectLike, z: number): Object3D {
  const o = new Object3D();
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z);
  parent.add(o);
  return o;
}

/** The same at the middle of a face that stands or lies (a `Lying`: a card on edge). */
function markerOn(parent: Object3D, l: Lying): Object3D {
  const o = new Object3D();
  o.position.set(l.x + l.w / 2, l.y, l.z);
  parent.add(o);
  return o;
}

/**
 * The router of a tier with the board that lies in its shell, as the room's shelf shows it (`routerInsides`): the shell fades away as the camera comes in and the board shows through,
 * then the SoC's lid fades over the die and its floorplan shows.
 */
function routerShowcase(tier: number, T: Theme): Object3D {
  return centred(
    withArt((art) => {
      const g = new Group(),
        m = routerModel(tier, { drive: [] });
      g.add(m.root);
      routerInsides(art, T, tier, g, m);
      return g;
    }),
  );
}

const CASE_ID = /^case(\d)$/,
  BOARD_ID = /^board(\d)$/;

/** The showcase model of a shop item, or null where there is none (a kind without a 3D builder). `T`: the PC's own palette, as the case uses. */
export function buildShowcaseModel(specId: string, T: Theme = builtinTheme()): Object3D | null {
  const c = CASE_ID.exec(specId);
  if (c) {
    const tier = Number(c[1]),
      kind = CASE_KIND[tier];
    if (!kind) return null;
    return centred(
      withLayout(() => {
        const m = caseModel(kind, T),
          g = new Group(),
          plan = basementPlan();
        // (the side panel hangs in its door's pivot group: added alone it would stand off the body by the pivot's offset)
        g.add(
          m.root,
          m.door,
          shroud(plan, m.shroud, m.rivet, m.screw),
          driveCage(cagePlan(), kind),
          driveCage(baseCagePlan(), kind),
          fanHub(),
          leadCoil(),
        );
        for (const s of innerStrips(kind, m).roots) g.add(s);
        return g;
      }, tier),
    );
  }
  const b = BOARD_ID.exec(specId);
  if (b) {
    const tier = Number(b[1]);
    return tier < BOARD_TIERS.length
      ? upright(withLayout(() => withArt((art) => boardModel(art, T, tier).root), tier))
      : null;
  }
  // (the router of a tier: the model the studio's wall and the room's shelf show, its first LAN and its WAN lit)
  const rt = routerTier(specId);
  // (a still has no link: its jacks' lights stay out, and no lamp is built for them)
  if (rt !== null) return rt >= 1 && rt <= 4 ? routerShowcase(rt, T) : null;
  const spec = getSpec(specId);
  if (!spec) return null;
  switch (spec.kind) {
    case 'ram': {
      const rs = spec as RamSpec;
      // (the spreaders go and the chips' dies come in as the camera comes to a chip: each chip's face reads its own zoom, the cover goes with the nearest)
      return upright(
        withLayout(() =>
          withArt((art) => {
            const st = ramStick(rs.visual, !!rs.ecc, GEO.dimm[0]!.rect, rs.name, { art, T, spec: rs }),
              seen = st.dies.map(() => 0);
            st.dies.forEach((at, i) =>
              art.reveal(at, (zoom) => {
                seen[i] = dieShown(zoom);
                stickFade(st, Math.max(...seen));
              }),
            );
            return st.root;
          }),
        ),
        true,
      );
    }
    case 'gpu':
    case 'npu':
    case 'nic': {
      const cs = spec as CardSpec | NicSpec;
      // (standing, as in the case, and it stays so: its cooler fades and its face shows as the camera comes in)
      const card = upright(
        withLayout(() =>
          withArt((art) => {
            const card = cardModel(art, T, spec.kind as 'gpu' | 'npu' | 'nic', cs.visual, 0);
            card.pose(0);
            art.reveal(markerOn(card.root, card.face), card.pose);
            // (a NIC's controller: its lid fades over the die's own band, as in the case)
            if (card.die) art.reveal(markerOn(card.root, card.die.stand), card.lod);
            // (a graphics or an AI card's two dies: each lid fades over its own die's band)
            for (const d of card.dies) art.reveal(markerOn(card.root, d.stand), d.lod);
            return card.root;
          }),
        ),
      );
      // (a graphics or an AI card shows its backplate, over its parts; a NIC's parts stand on its north face, away from the viewer: half a turn shows them first)
      if (spec.kind === 'nic') card.rotation.y = Math.PI;
      return card;
    }
    case 'cpu':
      return upright(
        withLayout(() =>
          withArt((art) => {
            const c = cpuModel(art, T, spec as CpuSpec);
            art.reveal(c.centre, c.lod);
            return c.root;
          }),
        ),
      );
    case 'cooler':
      return upright(withLayout(() => coolerModel((spec as { visual: string }).visual).root));
    // (faces the viewer; 25 mm deep, the 40 mm fan 10 mm)
    case 'fan': {
      const fs = spec as FanSpec;
      return centred(fanPart(fs, fanLen(fs.size), fanDepth(fs.size)).root);
    }
    case 'storage': {
      // (an M.2 stick in board space, stood up; a SATA drive lies flat as it lies on its tray, its label up)
      const ss = spec as StorageSpec,
        kind = driveKindOf(ss.visual);
      if (kind !== 'ssd-nvme') {
        // (its cover fades as the camera comes in: the inside shows, `driveinner3d.ts`; a marker at each place of the drive's own frame carries the zoom)
        return centred(
          withArt((art) => {
            const root = new Group();
            root.add(
              sataDriveModel(
                kind === 'hdd',
                { name: ss.name, capacityBytes: ss.capacityBytes },
                {
                  art,
                  T,
                  reveal: (p, apply) => {
                    const o = new Object3D();
                    o.position.set(p[0], p[1], p[2]);
                    root.add(o);
                    art.reveal(o, apply);
                  },
                },
              ).root,
            );
            return root;
          }),
        );
      }
      return upright(
        withLayout(() =>
          withArt((art) => {
            const g = new Group();
            nvmeStick(g, driveBody(kind, 'm20'), nvmeLook(ss), {
              art,
              T,
              reveal: (r, z, apply) => {
                art.reveal(marker(g, r, z), apply);
              },
            });
            return g;
          }),
        ),
      );
    }
    case 'psu': {
      const ps = spec as PsuSpec;
      // (in a case whose bay is its own size: an SFX unit in an ATX bay wears an adapter plate). Laid on its far side as in a maker's photo: its
      // underside (the fan, or the vents) toward the viewer, the badge on top; the viewer never looks from below
      const lay = new Group();
      lay.rotation.x = -Math.PI / 2;
      lay.add(
        withLayout(
          () => psuUnit(basementPlan(), ps.visual, ps.fan !== false, ps.watts).root,
          ps.visual === 'psu-big' ? 3 : 0,
        ),
      );
      return centred(lay);
    }
    case 'radiator': {
      // the one the game fits on the Full tower's top: as long as its fan mounts there, no fans fitted
      const grade = radiatorGrade((spec as { visual: string }).visual);
      return centred(
        withLayout(() => {
          const kit = kitFit(grade)!;
          return radiatorModel(kit.fit, grade, kit.ids).root;
        }),
      );
    }
    // (the die's still fades in as the camera comes in, as the game's live die does)
    case 'tpm': {
      const visual = (spec as { visual: string }).visual;
      return upright(
        withLayout(() =>
          withArt((art) => {
            const g = new Group();
            tpmModel(g, visual, (top, r, z, part) => {
              if (part !== 'die') return;
              const face = tpmDieFace(art, T, visual, top, r, z + 2);
              art.reveal(marker(top, r, z + 2), (zoom) => tpmDieFade(face, zoom, r.w));
            });
            return g;
          }),
        ),
      );
    }
    // (bare: a fan on it is a part of its own)
    case 'vrm-sink':
    case 'ram-sink': {
      const visual = (spec as { visual: string }).visual;
      return upright(
        withLayout(() => {
          const g = new Group();
          sinkBody(g, T, spec.kind as 'vrm-sink' | 'ram-sink', visual);
          return g;
        }),
      );
    }
    case 'display': {
      const m = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
      m.set({ installed: true, powered: true, live: false, text: '' }, 12);
      return centred(m.root);
    }
    default:
      return null;
  }
}
