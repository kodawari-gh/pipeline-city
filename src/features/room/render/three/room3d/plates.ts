// The column's plates: the letterbox and its light, the two-gang socket plate, the ISP's wall plate with its tier's lights and its plan's name.
import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { SEG, drum, rectBox, softBox } from '@/core/render/three/geometry';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import { mat } from '@/core/render/three/materials';
import { mergeWithin } from '@/core/render/three/merge';
import { seeThrough, tag } from '@/core/render/three/pick';
import { OUTBOX, ispPlate } from '@/features/board/render/layout/layout';
import { ROOM_SOCKET, wallPlate } from '@/features/board/render/three/swisssocket3d';
import { NEON, PAPER, STEEL } from '../palette';
import type { Build, Rect } from './types';

/** The letterbox: powder-coated black steel, as the other things on the wall; its front door (a panel in a fine seam), a name plate, the lock. */
function letterbox({ room, chrome, dark }: Build): Group {
  const box = tag(new Group(), 'mail'),
    ob = OUTBOX;
  box.add(softBox(OUTBOX, 0, 700, mat(STEEL, { roughness: 0.45 }), 70));
  const slot = mat(0x05_06_08, { roughness: 0.8 });
  box.add(rectBox({ x: OUTBOX.x + 180, y: OUTBOX.y - 10, w: OUTBOX.w - 360, h: 30 }, 200, 500, slot));
  const front = mat(0x1d_1e_22, { roughness: 0.45 });
  const seam = mat(0x05_06_08, { roughness: 0.6 });
  box.add(rectBox({ x: ob.x + 70, y: ob.y + 150, w: ob.w - 140, h: ob.h - 220 }, 700, 704, seam));
  box.add(softBox({ x: ob.x + 85, y: ob.y + 165, w: ob.w - 170, h: ob.h - 250 }, 700, 730, front, 20));
  const name = mat(PAPER, { roughness: 0.6 });
  box.add(softBox({ x: ob.x + 260, y: ob.y + 260, w: ob.w - 520, h: 130 }, 730, 742, name, 10));
  box.add(
    drum(ob.x + ob.w - 200, ob.y + ob.h - 220, 730, 760, 55, chrome, SEG.part),
    rectBox({ x: ob.x + ob.w - 212, y: ob.y + ob.h - 250, w: 24, h: 60 }, 760, 764, dark),
  );
  mergeWithin(box, { twin: room.envTwin });
  return box;
}

/** A two-gang Swiss plate: a type 13 recess for each cord's type 12 plug (the plug is the machine's: `Machine3D.buildRoomCords`). */
function socketPlate({ room, g, graphite }: Build): Group {
  const { plate } = g.socket,
    socket = tag(new Group(), 'socket');
  wallPlate(socket, {
    rect: plate,
    outlets: [g.socket.mon, g.socket.pc],
    face: ROOM_SOCKET.face,
    k: ROOM_SOCKET.k,
    look: { plate: graphite, black: mat(0x05_06_08, { roughness: 0.6 }) },
  });
  mergeWithin(socket, { twin: room.envTwin }); // (the plate and its six holes in two draws, every tier)
  return socket;
}

/** The ISP line's tier: five small lights along the wall plate, lit up to the plan's tier. */
function ispDots({ room, R }: Build, plate: Rect): void {
  for (let k = 0; k < 5; k++) {
    const m = new MeshStandardMaterial({ color: 0x13_15_18, emissive: new Color(NEON), emissiveIntensity: 0 });
    const d = drum(
      plate.x + plate.w * (0.14 + k * 0.18),
      plate.y + plate.h * 0.8,
      80,
      96,
      plate.w * 0.04,
      m,
      SEG.smallDisc,
    );
    room.ispDots.push(m);
    d.name = `isp dot ${k}`;
    R.add(d);
  }
}

/** The plan's name under the lights, small print on the plate (drawn on a canvas when the plan changes). */
function ispText({ room, R }: Build, plate: Rect): void {
  if (typeof document === 'undefined') {
    return;
  }
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const tex = rawSrgb(cv);
  const look = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  const face = new Mesh(
    new PlaneGeometry(plate.w * 0.84, plate.h * 0.26),
    Object.assign(look, { defines: { ...DECODE_SRGB } }),
  );
  face.position.set(plate.x + plate.w / 2, -(plate.y + plate.h * 0.5), 82);
  room.ispText = { cv, tex, shown: '\u0000' };
  R.add(seeThrough(face));
}

/** The letterbox, the socket plate, the ISP's plate (on the column under the letterbox, right of the monitor, where the room's view sees it). */
export function buildPlates(b: Build): void {
  const { room, R, graphite } = b;
  const box = letterbox(b);
  R.add(box);
  const socket = socketPlate(b);
  // (the 2D plate is under the desk)
  const plate: Rect = ispPlate();
  const plateBox = tag(softBox(plate, 0, 80, graphite, 30), 'wall');
  ispDots(b, plate);
  ispText(b, plate);
  R.add(socket, plateBox);
  // the letterbox's light: on while an upload waits or goes out
  const mailM = new MeshStandardMaterial({ color: 0x13_15_18, emissive: new Color(0xff_b3_47), emissiveIntensity: 0 });
  box.add(drum(OUTBOX.x + 180, OUTBOX.y + 215, 730, 750, 28, mailM, SEG.midRound));
  room.mailLed = mailM;
}
