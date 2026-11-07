// The board's hardware that stands up off the flat PCB, shared by the live board (machine3d.ts) and the showcase (showcase.ts): the rear I/O cover
// by the tier's skin, and the slot hardware (PCIe armour and latches, the CPU socket's load frame and lever).
import { BoxGeometry, CylinderGeometry, Group, Mesh, Path, Shape, type MeshStandardMaterial } from 'three';
import { extrude, instanced, place, rectBox, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { IO_PORTS } from '../layout/boardlayout';
import { GEO, PCIE_RAILS, PKG, SOCKET_E, WALL_T } from '../layout/layout';
import { hexNum, skinOf, slotArmour } from '../skins';
import { brushed, outlinePts, shapeOf, slab, tiled } from './casekit3d';
import { glowMat } from './fans3d';

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** What the board's rear connectors are fitted with (the board tier's features). */
export interface IoFeatures { ethernetMbps: number; usbPorts: number; displayPorts: number }

/** The rear I/O inside the case, by the skin; glow is the armoured cover's lit line (it follows the fans), null on the others. */
export function ioCover(feat: IoFeatures = { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 }): { root: Group; glow: MeshStandardMaterial | null } {
  const sk = skinOf(GEO.tier);
  let glow: MeshStandardMaterial | null = null;
    const io = tag(new Group(), 'io'), ir = GEO.io, x0 = ir.x + WALL_T;
    if (sk.ioCover === 'bare') {
      // the Starter's connectors stand bare: steel shells (USB, LAN, video) with their solder tabs, and the black audio block
      const steelM = mat(0x9aa1aa, { metalness: 0.65, roughness: 0.45 }), plastic = mat(0x111215, { roughness: 0.55 });
      const jacks = IO_PORTS.filter((p) => p.kind === 'jack'), y0 = Math.min(...jacks.map((p) => p.y - p.h / 2)), y1 = Math.max(...jacks.map((p) => p.y + p.h / 2)); // (a port's `y` is its centre)
      io.add(softBox({ x: x0, y: y0, w: 250 - WALL_T + 30, h: y1 - y0 }, BOARD_Z, BOARD_Z + 360, plastic, 10));
      for (const p of IO_PORTS) {
        const h = p.kind === 'rj45' ? 400 : p.kind === 'usb' ? 650 : p.kind === 'hdmi' || p.kind === 'dp' ? 580 : 0;
        const fitted = p.kind === 'rj45' ? feat.ethernetMbps > 0 : p.kind === 'usb' ? Number(p.id.slice(3)) < feat.usbPorts : p.kind === 'dp' ? feat.displayPorts >= 2 : p.kind === 'hdmi';
        if (!h || !fitted) continue;
        const r = { x: x0, y: p.y - p.h / 2, w: p.x + p.w - x0, h: p.h };
        io.add(softBox(r, BOARD_Z, BOARD_Z + h, steelM, 6));
        for (const ty of [r.y + 10, r.y + r.h - 22]) io.add(rectBox({ x: r.x + r.w - 30, y: ty, w: 24, h: 12 }, BOARD_Z, BOARD_Z + 30, steelM));
      }
    } else {
      // a moulded cover over them, as high as the tallest port stack: plain (Basic: black; Mainstream: a teal line down its inner edge), or
      // the Enthusiast's armour, a brushed silver plate with chamfered corners on top and a lit line that glows with the fans
      const armour = sk.ioCover === 'armour', H = BOARD_Z + 720, body = { ...ir, x: x0, w: ir.w - WALL_T };
      io.add(softBox(body, BOARD_Z, H, mat(hexNum(sk.sink), { metalness: 0.4, roughness: 0.48 }), 30));
      const vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
      for (let y = ir.y + 140; y < ir.y + ir.h * (armour ? 0.3 : 1) - 140; y += 64) vents.push({ x: x0 + body.w * 0.45, y: -y, z: H, sx: body.w * 0.5, sy: 24, sz: 10 });
      io.add(instanced(new BoxGeometry(1, 1, 1), mat(0x07080c, { roughness: 0.7 }), vents));
      if (armour) {
        const plate = { x: x0 + 24, y: ir.y + ir.h * 0.3, w: body.w - 48, h: ir.h * 0.7 - 60 };
        io.add(slab(shapeOf(outlinePts(plate, 0, [60, 60, 60, 60])), H - 4, H + 26, mat(hexNum(sk.insert ?? '#7d838d'), { metalness: 0.6, roughness: 0.38, map: tiled(brushed(), 1, 6) }), 6));
        const line = glowMat(hexNum(sk.accent), 0x2a2550);
        io.add(seeThrough(rectBox({ x: x0 + body.w - 22, y: ir.y + 80, w: 12, h: ir.h - 160 }, H - 70, H + 2, line)));
        glow = line;
      } else if (sk.accent && GEO.tier >= 2) io.add(rectBox({ x: x0 + body.w - 20, y: ir.y + 120, w: 8, h: ir.h - 240 }, H - 60, H + 1, mat(hexNum(sk.accent), { roughness: 0.4 })));
    }
  return { root: io, glow };
}

/** The hardware round the sockets that the flat drawing cannot show: a steel armour round the PCIe slots the skin armours, the retention latch at each slot's far end, and the CPU socket's load frame and lever. */
export function slotHardware(): Group {
  const g = new Group();
    const sk = skinOf(GEO.tier), latchM = mat(hexNum(sk.latch), { roughness: 0.5 }), steel = mat(0x8a929c, { metalness: 0.75, roughness: 0.38, map: tiled(brushed(), 10, 1) });
    PCIE_RAILS.forEach((r, i) => {
      // the armour: a thin steel wall round the slot's sides, a little proud of it, its top edge rolled; the latch stands at the east end
      const t = 10, z0 = BOARD_Z + 10, z1 = BOARD_Z + 152;
      if (slotArmour(GEO.tier, i)) for (const s of [{ x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y + r.h, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y, w: t, h: r.h }]) g.add(softBox(s, z0, z1, steel, 4));
      g.add(softBox({ x: r.x + r.w, y: r.y - 16, w: 70, h: r.h + 32 }, BOARD_Z, BOARD_Z + 190, latchM, 10));
      g.add(rectBox({ x: r.x + r.w + 44, y: r.y - 16, w: 26, h: r.h + 32 }, BOARD_Z + 190, BOARD_Z + 240, latchM));
    });
    // the load frame over the socket's border and its lever down the east side, the handle turned out at the south end under its hook
    const o = grow(PKG, SOCKET_E + 20), inner = grow(PKG, SOCKET_E - 26), frame = new Shape(), hole = new Path();
    frame.moveTo(o.x, -o.y).lineTo(o.x + o.w, -o.y).lineTo(o.x + o.w, -(o.y + o.h)).lineTo(o.x, -(o.y + o.h)).closePath();
    hole.moveTo(inner.x, -inner.y).lineTo(inner.x, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -inner.y).closePath();
    frame.holes.push(hole);
    const plate = place(new Mesh(extrude(frame, { depth: 16, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 1 }), steel));
    plate.position.z = BOARD_Z + 70;
    g.add(plate);
    const lx = o.x + o.w + 40, ys = o.y + o.h + 50, zl = BOARD_Z + 46;
    g.add(tube(rounded([[lx, -(o.y + 40), zl], [lx, -ys, zl], [lx + 170, -ys, zl]], 40, 5), 13, steel, 10));
    const cap = place(new Mesh(new CylinderGeometry(20, 20, 70, 14).rotateZ(Math.PI / 2), latchM));
    cap.position.set(lx + 200, -ys, zl);
    g.add(cap);
    g.add(rectBox({ x: lx - 30, y: ys - 70, w: 60, h: 40 }, BOARD_Z, BOARD_Z + 70, steel), rectBox({ x: lx - 26, y: o.y + 10, w: 52, h: 70 }, BOARD_Z, BOARD_Z + 64, steel));
  return g;
}
