// A motherboard as a 3D model on its own (the gallery's): the PCB and everything that stands up off it, built from the tier's layout (`GEO`) and skin,
// with no 2D art baked on. The live board (machine3d.ts) builds the same parts over its baked drawing; the pieces they share (`dimmSlot`, `chipset`,
// the sockets, `slotHardware`, `ioCover`) come from the same builders. Built in board space (x east, y north, z up off the board).
import { CylinderGeometry, Group, type Material, type Mesh } from 'three';
import { headerRect } from '@/core/render/accelart';
import { instanced, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { lerpHex, mat } from '@/core/render/three/materials';
import type { Theme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { buildBoard } from '../boardArt';
import type { Solid } from '../boardParts';
import { BD, GEO, M2_SLOTS, PCIE_RAILS, PKG, SOCKET_E } from '../layout/layout';
import { hexNum, skinOf } from '../skins';
import { ioCover, slotHardware } from './boardhw3d';
import { chipset, coinCell, m2Standoff, type Raise } from './parts3d';
import { dimmSlot } from './ram3d';
import { buildSolids } from './solids3d';
import { atxSocket, epsSocket, sataPort } from './wires3d';

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** The socket's pins: a grid of gold pads in the land under the CPU's seat. */
function socketPins(r: RectLike, z: number): Mesh {
  const pitch = 34, pts: { x: number; y: number; z: number }[] = [];
  for (let x = r.x + 40; x <= r.x + r.w - 40; x += pitch) for (let y = r.y + 40; y <= r.y + r.h - 40; y += pitch) pts.push({ x, y: -y, z });
  return instanced(new CylinderGeometry(9, 9, 24, 6).rotateX(Math.PI / 2), mat(0xd9b25e, { metalness: 1, roughness: 0.3 }), pts);
}

/** The board of this tier, empty: no CPU, no memory, no cards. */
export function boardModel(T: Theme, tier = GEO.tier): Group {
  const g = new Group(), sk = skinOf(tier);
  const slot = mat(hexNum(sk.slot), { roughness: 0.5 }), socket = mat(0x1a1d24, { roughness: 0.5 }), chip = mat(0x14161b, { roughness: 0.5 });
  const plain: Raise = (parent, r, z0, z1, side: Material, bevel = 0) => {
    const o = new Group();
    o.add(bevel ? softBox(r, z0, z1, side, bevel) : rectBox(r, z0, z1, side));
    parent.add(o);
    return o;
  };
  // the PCB: the solder mask, a lighter edge line of exposed laminate under it
  g.add(rectBox(BD, BOARD_Z - 60, BOARD_Z, mat(lerpHex(hexNum(sk.mask[T.dark ? 0 : 1]), 0x000000, 0.35), { roughness: 0.6 })));
  g.add(rectBox(BD, BOARD_Z - 64, BOARD_Z - 60, mat(0xc8b98a, { roughness: 0.7 })));
  const solids: Solid[] = [];
  buildBoard(T, tier, (x) => solids.push(x)).root.destroy({ children: true });
  const io = ioCover();
  g.add(io.root);
  // the CPU socket: its land and pins, the load frame and the lever (`slotHardware`)
  g.add(rectBox(grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, socket), socketPins(grow(PKG, SOCKET_E - 20), BOARD_Z + 76));
  for (const d of GEO.dimm) { const s = dimmSlot(d.rect, true, hexNum(sk.slot), hexNum(sk.latch)); g.add(s.housing, s.latches); }
  // each PCIe slot: its housing with the dark contact slit down the middle
  for (const r of PCIE_RAILS) {
    g.add(rectBox(r, BOARD_Z, BOARD_Z + 140, slot), rectBox({ x: r.x + 30, y: r.y + r.h / 2 - 10, w: r.w - 60, h: 20 }, BOARD_Z + 140, BOARD_Z + 143, mat(0x050608, { roughness: 0.8 })));
  }
  for (const m of M2_SLOTS) {
    g.add(softBox({ x: m.x + 8, y: m.y + 70, w: 120, h: m.h - 140 }, BOARD_Z, BOARD_Z + 70, chip, 6), m2Standoff(m));
  }
  const pch = chipset(GEO.chip, tier, plain);
  g.add(pch.root, atxSocket(GEO.atx), epsSocket(GEO.cpw), coinCell(GEO.bat));
  for (const r of GEO.sata) g.add(sataPort(r));
  // the regulators: each phase's choke and power stage
  const choke = mat(0x2b2f38, { metalness: 0.35, roughness: 0.45 });
  for (const p of solids) if (p.kind === 'choke' || p.kind === 'stage') {
    const ch = p.kind === 'choke';
    plain(g, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }, BOARD_Z, BOARD_Z + (ch ? 150 : 40), ch ? choke : chip, ch ? 14 : 4);
  }
  // the small chips, the headers, the capacitors and the other solids
  for (const r of [GEO.pwm, GEO.dpwm, GEO.bios, GEO.sio, GEO.codec, GEO.hub, GEO.phy, GEO.xtalCpu, GEO.xtalPch]) if (r) plain(g, r, BOARD_Z, BOARD_Z + 90, chip, 6);
  for (const h of GEO.hdrs) plain(g, headerRect(h), BOARD_Z, BOARD_Z + 140, slot);
  g.add(buildSolids(solids, true, sk.capSleeve), slotHardware());
  return g;
}

