// The board's small parts stood up in 3D (docs/GRAPHICS_3D_OVERHAUL.md "Art and LOD"). The 2D drawers report every part they draw (`Solid`,
// boardParts.ts) while the board art is built for the texture, so the 3D parts sit exactly on their drawings: capacitor cans, SMD passives with
// their metal ends, chip legs, header pins and the CPU socket's contacts. Each kind is one instanced mesh: a few thousand parts, a few draw calls.
import { BoxGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Shape, type BufferGeometry } from 'three';
import { instanced, paint } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import type { Solid } from '../boardParts';

type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; rz?: number };

/** A chip's moulded body is this high; its legs leave the body's sides below its top. */
export const CHIP_H = 46;

/** The turn round z that points a leg built toward +x out of its chip's side (north is up the screen: world +y). */
const LEG_TURN = { e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 } as const;

/** A gull-wing leg leaving a chip's edge (x = 0) toward +x: out of the body's side, bent down to a foot on its pad. `width` across, centred. */
function gullWing(width: number): BufferGeometry {
  const s = new Shape();
  s.moveTo(-10, 30).lineTo(2, 30).lineTo(7, 6).lineTo(14, 6).lineTo(14, 0).lineTo(3, 0).lineTo(-2, 24).lineTo(-10, 24).closePath();
  return new ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, width / 2, 0);
}

/** A can's height for its radius: the big filter caps are tall, the small polymer ones squat. */
export const canHeight = (r: number): number => r * (r >= 50 ? 2.5 : 2.1);

/** The vent cross scored in a can's aluminium top, and its polarity mark. */
function canTop() {
  return paint(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#e9edf2'); g.addColorStop(1, '#9aa3ad');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,46,56,0.75)'; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(w * 0.3, h / 2); c.lineTo(w * 0.7, h / 2); c.moveTo(w / 2, h * 0.3); c.lineTo(w / 2, h * 0.7); c.stroke();
    c.fillStyle = 'rgba(30,34,40,0.55)'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.47, 2.3, 3.9); c.arc(w / 2, h / 2, w * 0.38, 3.9, 2.3, true); c.fill();
  });
}

/** Build the parts the board drawing reported. `socketEmpty`: the CPU socket's contacts show (a CPU covers them). */
export function buildSolids(solids: readonly Solid[], socketEmpty: boolean): Group {
  const out = new Group();
  const caps: Item[] = [], capTops: Item[] = [], bands: Item[] = [], bodies: Item[] = [], ends: Item[] = [], legs: Item[] = [], pins: Item[] = [], lga: Item[] = [];
  const washers: Item[] = [], heads: Item[] = [];
  for (const s of solids) {
    const y = -s.y;
    switch (s.kind) {
      case 'cap': {
        const h = canHeight(s.r);
        caps.push({ x: s.x, y, z: BOARD_Z + h / 2, sx: s.r, sy: s.r, sz: h });
        capTops.push({ x: s.x, y, z: BOARD_Z + h + 2, sx: s.r * 0.93, sy: s.r * 0.93, sz: 5 });
        bands.push({ x: s.x, y, z: BOARD_Z + h / 2 + 4, sx: s.r * 1.012, sy: s.r * 1.012, sz: h - 10 });
        break;
      }
      case 'smd': {
        // a ceramic body between two tinned ends, as high as it is narrow
        const along = s.w >= s.h, L = along ? s.w : s.h, W = along ? s.h : s.w, t = Math.min(W * 0.75, 16), e = L * 0.24;
        bodies.push({ x: s.x, y, z: BOARD_Z + t / 2, sx: along ? L - 2 * e : W, sy: along ? W : L - 2 * e, sz: t });
        for (const k of [-1, 1]) ends.push({ x: s.x + (along ? k * (L - e) / 2 : 0), y: y + (along ? 0 : k * (L - e) / 2), z: BOARD_Z + t / 2, sx: along ? e : W, sy: along ? W : e, sz: t + 1 });
        break;
      }
      case 'leg': legs.push({ x: s.x, y, z: BOARD_Z, sx: 1, sy: 1, sz: 1, rz: LEG_TURN[s.side] }); break;
      case 'pin': pins.push({ x: s.x, y, z: BOARD_Z + 140, sx: s.s, sy: s.s, sz: 280 }); break;
      case 'lga': if (socketEmpty) lga.push({ x: s.x, y, z: BOARD_Z + 76, sx: s.s, sy: s.s, sz: 12 }); break;
      case 'screw': {
        // the mounting screw over its standoff: a washer and a pan head with its cross slot
        washers.push({ x: s.x, y, z: BOARD_Z + 5, sx: s.r * 0.78, sy: s.r * 0.78, sz: 10 });
        heads.push({ x: s.x, y, z: BOARD_Z + 22, sx: s.r * 0.58, sy: s.r * 0.58, sz: 24 });
        break;
      }
      default: break; // chokes and power stages are raised with their own art (machine3d.ts)
    }
  }
  const box = new BoxGeometry(1, 1, 1), can = new CylinderGeometry(1, 1, 1, 22).rotateX(Math.PI / 2);
  const tinned = mat(0xc9ced6, { metalness: 0.85, roughness: 0.3 }), gold = mat(0xd9b25e, { metalness: 1, roughness: 0.22 });
  const add = (items: Item[], g: BufferGeometry, m: ReturnType<typeof mat>) => { if (items.length) out.add(instanced(g, m, items)); };
  add(caps, can, mat(0x1d2433, { roughness: 0.35, metalness: 0.25 }));
  add(capTops, can, mat(0xffffff, { map: canTop(), metalness: 0.8, roughness: 0.32 }));
  // the polarity stripe printed down the sleeve: a sliver of a slightly larger can
  add(bands, new CylinderGeometry(1, 1, 1, 10, 1, true, 2.2, 0.8).rotateX(Math.PI / 2), mat(0xaab4c4, { roughness: 0.4, side: DoubleSide }));
  add(bodies, box, mat(0x8c6c4c, { roughness: 0.55 }));
  add(ends, box, tinned);
  add(legs, gullWing(8), tinned);
  add(pins, box, gold);
  add(lga, box, gold);
  add(washers, can, mat(0x6c7480, { metalness: 0.8, roughness: 0.4 }));
  const side = mat(0x9aa3ae, { metalness: 0.85, roughness: 0.32 });
  add(heads, new CylinderGeometry(1, 1, 1, 24).rotateX(Math.PI / 2), [side, mat(0xffffff, { map: screwTop(), metalness: 0.8, roughness: 0.35 }), side] as unknown as ReturnType<typeof mat>);
  return out;
}

/** A pan head's top: a lit dome with its cross slot. */
function screwTop() {
  return paint(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#d5dbe3'); g.addColorStop(1, '#6f7884');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(20,24,30,0.8)'; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(w * 0.24, h / 2); c.lineTo(w * 0.76, h / 2); c.moveTo(w / 2, h * 0.24); c.lineTo(w / 2, h * 0.76); c.stroke();
  });
}
