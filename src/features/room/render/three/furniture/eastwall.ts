// The east wall past the bed's foot (`eastWall`): a floating shelf with two books, a speaker and a trailing plant, a framed poster over it.
import { Color, Group, Mesh, PlaneGeometry } from 'three';
import { SEG, paint, post, softBox } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { NEON, PAPER, VENEER, VENEER_GRAIN } from '../palette';
import { pothos } from '../plants3d';
import { EAST_X, SHELF } from '../roomplan';
import { board } from './shapes';
import { oak } from './textures';
import type { Texture } from './types';

/**
 * The east wall's shelf past the bed's foot: a thick black-brown floating board with two books, a small speaker with a cyan status light and a
 * trailing plant, and a framed poster above it (a thin cyan circle on a dark ground). The east wall faces -x: this group builds on a back wall
 * (z out of it) and turns to it.
 */
export function eastWall(): Group {
  const g = new Group(),
    wall = new Group(),
    wood = mat(0xff_ff_ff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.5 });
  // (a layout x here runs along the east wall from its back corner: x = the room's z)
  wall.add(board({ x: SHELF.z0, y: SHELF.y, w: SHELF.z1 - SHELF.z0, h: 900 }, [0, SHELF.d], wood));
  shelfBooks(wall);
  shelfSpeaker(wall);
  // a pothos at the east end: built facing +x, turned so its vines trail over the shelf's front edge
  const vine = pothos(0, 0, 0, SHELF.d - 1500, [
    { dz: 300, len: 7000 },
    { dz: -500, len: 4200 },
  ]);
  vine.rotation.y = -Math.PI / 2;
  vine.position.set(SHELF.z1 - 2400, -SHELF.y, 1500);
  wall.add(vine);
  wallPoster(wall);

  wall.rotation.y = -Math.PI / 2;
  wall.position.x = EAST_X;
  g.add(wall);
  return g;
}

/** Two books lying on the shelf, the smaller on the bigger. */
function shelfBooks(wall: Group): void {
  const sx = SHELF.z0;
  let { y } = SHELF;
  for (const [k, c] of ([PAPER, 0x26_30_3d] as const).entries()) {
    const t = 480 - k * 60;
    wall.add(
      softBox(
        { x: sx + 900 + k * 160, y: y - t, w: 4200 - k * 420, h: t },
        400 + k * 90,
        3300 - k * 140,
        mat(c, { roughness: 0.75 }),
        40,
      ),
    );
    y -= t;
  }
}

/** The speaker: a cylinder in dark fabric, a black top, its status light. */
function shelfSpeaker(wall: Group): void {
  const sy = SHELF.y,
    cx = SHELF.z0 + 7400,
    cz = SHELF.d / 2;

  wall.add(
    post(cx, sy, cz, 760, 2000, cloth(0x2a_2d_32, { roughness: 0.95 }), SEG.bigDisc),
    post(cx, sy - 2000, cz, 740, 50, mat(0x13_15_18, { roughness: 0.35 }), SEG.bigDisc),
  );
  const led = mat(0x13_15_18, { roughness: 0.4, emissive: new Color(NEON), emissiveIntensity: 0.8 });
  wall.add(post(cx, sy - 2050, cz, 150, 10, led, SEG.post));
}

/** A framed poster above the shelf: a thin cyan circle and a fine grid on a dark ground. */
function wallPoster(wall: Group): void {
  const r = { x: SHELF.z0 + 1500, y: -18_500, w: 11_000, h: 13_800 };
  wall.add(softBox(r, 0, 320, mat(0x13_15_18, { roughness: 0.45 }), 30));
  const art = posterArt();
  const face = new Mesh(new PlaneGeometry(r.w - 500, r.h - 500), mat(0xff_ff_ff, { map: art, roughness: 0.6 }));

  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), 330);
  wall.add(face);
}

/** The poster's print: a fine grid, a thin cyan circle with a red dot on it, four lines of small type under it. */
function posterArt(): Texture | null {
  return paint(384, 480, (c, w, h) => {
    c.fillStyle = '#16181d';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,130,150,0.12)';
    c.lineWidth = 1;
    for (let x = 24; x < w; x += 24) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 24; y < h; y += 24) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = '#3be3ff';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(w * 0.5, h * 0.42, w * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#c8432b';
    c.beginPath();
    c.arc(w * 0.5 + w * 0.3 * Math.cos(-0.7), h * 0.42 + w * 0.3 * Math.sin(-0.7), 7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(200,210,225,0.55)';
    for (let k = 0; k < 4; k++) {
      c.fillRect(w * 0.2, h * 0.8 + k * 9, w * (0.6 - k * 0.12), 3);
    }
  });
}
