// On and by the desk: the monitor, the keyboard on its felt mat, the mouse, a notebook, the grommet, the chair, the things about, a tea cup on
// its saucer, the architect lamp.
import { SEG, paint, post, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { MONITOR, SCREEN } from '@/features/board/render/layout/layout';
import { deskChair } from '../chair3d';
import { mess } from '../clutter3d';
import { KEY_LEAD, Monitor, keyboard, mouse, notebook, teaCup } from '../props3d';
import { DESK_D, MONITOR_Z } from '../roomplan';
import { deskLamp } from './lamp';
import { rnd } from './seed';
import type { Build, DeskBase, Texture } from './types';

/** The keyboard's place on the desk (`kx`, `kz`) and the felt mat's east end. */
interface Keys {
  kx: number;
  kz: number;
  matEnd: number;
}

/** The felt mat's cloth: a grey felt flecked from the room's stream, its stitched edge. */
function feltTex(): Texture | null {
  return paint(512, 192, (c, w, h) => {
    c.fillStyle = '#5b6168';
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 4000; k++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1);
    }
    // the stitched edge
    c.strokeStyle = 'rgba(30,32,36,0.8)';
    c.lineWidth = 4;
    c.strokeRect(2, 2, w - 4, h - 4);
    c.strokeStyle = 'rgba(205,200,190,0.55)';
    c.lineWidth = 1.5;
    c.setLineDash([6, 4]);
    c.strokeRect(9, 9, w - 18, h - 18);
  });
}

/** The monitor, and the felt mat in front of it, where the keyboard goes. */
function monitorAndMat({ room, R, ys }: Build): Keys {
  room.monitor = new Monitor(MONITOR, SCREEN, ys, MONITOR_Z);
  R.add(room.monitor.root, room.monitor.bias);
  const kx = MONITOR.x + MONITOR.w / 2,
    kz = MONITOR_Z + 3600;
  const felt = feltTex();
  const matEnd = kx + 4800;
  const matFelt = softBox(
    { x: kx - 5200, y: ys - 40, w: matEnd - (kx - 5200), h: 40 },
    kz - 2100,
    kz + 2100,
    mat(0xff_ff_ff, { map: felt, roughness: 0.97 }),
    20,
  );
  matFelt.name = 'desk mat';
  R.add(matFelt);
  return { kx, kz, matEnd };
}

/** The mouse, the keyboard, a notebook, and the grommet the keyboard's cable goes down through (a black cap on the top, its sleeve under it). */
function keyboardAndMouse({ room, R, ys, until }: Build, { kx, kz }: Keys, under: number): { x: number; z: number } {
  room.mouse = mouse(
    kx + 4100,
    ys,
    kz + 200,
    (o) => {
      room.envs.adopt(o);
    },
    until,
  );
  const kb = keyboard(kx, ys, kz),
    pad = notebook(-16_600, ys, 10_000, 0.22);
  kb.name = 'keyboard';
  room.mouse.name = 'mouse';
  pad.name = 'notebook';
  R.add(kb, room.mouse, pad);
  // (near the wall, over the tray)
  const grommet = { x: kx + KEY_LEAD[0], z: kz + KEY_LEAD[1] },
    cap = mat(0x13_15_18, { roughness: 0.6 });
  R.add(
    post(grommet.x, ys, grommet.z, 420, 20, cap, SEG.drum),
    post(grommet.x, under + 300, grommet.z, 300, 300, cap, SEG.disc),
  );
  return grommet;
}

/** On the desk and by it, after its base (`base`: the drawer unit's side and the top's underside, where the things about go). */
export function setDesk(b: Build, { pedX, under }: DeskBase): void {
  const { room, R, ys, until } = b;
  const keys = monitorAndMat(b);
  const grommet = keyboardAndMouse(b, keys, under);
  // the chair, half under the desk west of the keyboard, turned toward the window as left after use
  const chair = deskChair(
    keys.kx - 7500,
    DESK_D + 2600,
    -0.3,
    (o) => {
      room.envs.adopt(o);
    },
    until,
  );
  chair.name = 'desk chair';
  R.add(chair);
  // the things about: a backpack against the drawer unit, the power strip in the tray and its leads, books on the bench
  const litter = mess(pedX, under, grommet);
  litter.name = 'floor mess';
  R.add(litter);
  // (the tea by the mat's end: west of the PC's mains cord, which runs from the case's side to the desk's grommet and must stay in view)
  room.cup = teaCup(keys.matEnd + 560, ys, MONITOR_Z + 3200);
  room.cup.root.name = 'tea cup';
  R.add(room.cup.root);
  deskLamp(b);
}
