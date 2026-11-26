// The keys on the stand: a white stick on its lanyard per hook (`setKeys`), and the new key's letter that brings it (`mailStep`).
import { Color, DoubleSide, Group, Mesh, PlaneGeometry, Shape, ShapeGeometry } from 'three';
import { SEG, disposeTree, paint, rectBox, softBox, tube } from '@/core/render/three/geometry';
import { NYLON, mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { ENV_H, ENV_W, MAIL_S, keyPose, letterPose, mailStage } from '../../desk/props/mail';
import { KEY_LEN, lanyardColour, trayHook, trayKeyCentre } from '../../desk/props/props';
import { MANILA, PAPER } from '../palette';
import { KEY_W } from './consts';
import type { Arrival, KeySnap, MeshStandardMaterial, RoomParts, Texture } from './types';

/** The envelope: paper, and its flap, which turns about the top edge. */
function envelope(): { env: Group; flap: Mesh; mats: MeshStandardMaterial[] } {
  const paper = mat(PAPER, { roughness: 0.8 }),
    darker = mat(MANILA, { roughness: 0.8 }),
    env = new Group();
  for (const m of [paper, darker]) {
    m.transparent = true;
    m.side = DoubleSide;
  }
  env.add(softBox({ x: -ENV_W / 2, y: -ENV_H / 2, w: ENV_W, h: ENV_H }, 0, 40, paper, 20));
  const tri = new Shape();
  tri
    .moveTo(-ENV_W / 2, 0)
    .lineTo(ENV_W / 2, 0)
    .lineTo(0, -ENV_H * 0.55)
    .closePath();
  const flap = new Mesh(new ShapeGeometry(tri), darker);
  flap.position.set(0, ENV_H / 2, 44);
  env.add(flap);
  return { env, flap, mats: [paper, darker] };
}

/** A key's label: its lanyard's colour at the top, its name down the stick. */
function keyLabel(k: KeySnap): Texture | null {
  return paint(64, 256, (cx, w, h) => {
    cx.fillStyle = '#eceef2';
    cx.fillRect(0, 0, w, h);
    cx.fillStyle = lanyardColour(k);
    cx.fillRect(0, 0, w, 34);
    cx.save();
    cx.translate(w / 2, h / 2 + 14);
    cx.rotate(Math.PI / 2);
    cx.fillStyle = '#2b3140';
    cx.font = 'bold 24px system-ui, sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(k.label, 0, 0);
    cx.restore();
  });
}

/** Key `k` on hook `i`: the stick and its label, its ring, its lanyard up to the hook. `c`: where the stick hangs. */
function keyOnHook(k: KeySnap, i: number): { g: Group; c: { x: number; y: number } } {
  const hook = trayHook(i),
    c = trayKeyCentre(i),
    g = tag(new Group(), `key:${k.id}`),
    col = new Color(lanyardColour(k)).getHex();
  const label = keyLabel(k);
  const shell = mat(NYLON, { roughness: 0.35 });
  const body = softBox({ x: c.x - KEY_W / 2, y: c.y - KEY_LEN / 2, w: KEY_W, h: KEY_LEN }, 260, 400, shell, 40);
  g.add(body);
  if (label) {
    const f = new Mesh(new PlaneGeometry(KEY_W - 40, KEY_LEN - 60), mat(0xff_ff_ff, { map: label, roughness: 0.4 }));
    f.position.set(c.x, -c.y, 402);
    g.add(f);
  }
  const ring = mat(0xb9_ba_bf, { metalness: 0.8, roughness: 0.3 });
  g.add(rectBox({ x: c.x - 70, y: c.y + KEY_LEN / 2, w: 140, h: 190 }, 280, 380, ring));
  const lanyard = mat(col, { roughness: 0.7 });
  g.add(
    tube(
      [
        [hook.x, -hook.y, 400],
        [hook.x - 20, -(hook.y + 200), 380],
        [c.x, -(c.y - KEY_LEN / 2), 340],
      ],
      26,
      lanyard,
      SEG.cord,
    ),
  );
  return { g, c };
}

/** The keys on the rack: a white stick on its lanyard per hook. A key that arrives drops in from the mailbox. */
export function setKeys(room: RoomParts, tray: readonly KeySnap[]): void {
  const key = tray.map((k) => `${k.id}:${k.type}:${k.label}`).join(',');
  if (key === room.keysKey) {
    return;
  }
  room.keysKey = key;
  room.arrivals = [];
  for (let c = room.keys.children.at(0); c; c = room.keys.children.at(0)) {
    room.keys.remove(c);
    disposeTree(c, true);
  }
  for (const [i, k] of tray.slice(0, 10).entries()) {
    const { g, c } = keyOnHook(k, i);
    if (room.known && !room.known.has(k.id)) {
      const e = envelope();
      g.visible = false;
      room.keys.add(e.env);
      room.arrivals.push({ g, env: e.env, flap: e.flap, mats: e.mats, rest: c, t0: -1 });
    }
    room.keys.add(g);
  }
  room.known = new Set(tray.map((k) => k.id));
}

/** A letter at game time `t`: it drifts in and opens, the key rises out and is carried to its hook; once there, the key hangs and the letter goes. */
function poseArrival(a: Arrival, t: number, stage: ReturnType<typeof mailStage>): void {
  if (a.t0 < 0) {
    a.t0 = t;
  }
  const u = (t - a.t0) / MAIL_S;
  if (u >= 1) {
    a.g.visible = true;
    a.g.position.set(0, 0, 0);
    a.g.rotation.z = 0;
    a.env.visible = false;
    return;
  }
  const lp = letterPose(Math.max(0, u), stage),
    kp = keyPose(Math.max(0, u), stage, a.rest);
  a.env.position.set(lp.x, -lp.y, 330);
  a.env.rotation.z = -lp.rot;
  a.flap.scale.y = lp.flap;
  for (const m of a.mats) {
    m.opacity = lp.alpha;
  }
  a.env.visible = lp.alpha > 0.01;
  a.g.visible = kp.phase !== 'wait';
  // the key hangs from the carried end of its lanyard: it swings as it goes
  a.g.position.set(kp.x - a.rest.x, -(kp.y - a.rest.y), kp.phase === 'settle' ? 0 : 160);
}

/** The mail, on the game's clock (it stops with the pause): each letter on its way a step, and the ones that have arrived leave the list. */
export function mailStep(room: RoomParts, t: number): void {
  const stage = mailStage();
  for (const a of room.arrivals) {
    poseArrival(a, t, stage);
  }
  room.arrivals = room.arrivals.filter((a) => (t - a.t0) / MAIL_S < 1 || a.t0 < 0);
}
