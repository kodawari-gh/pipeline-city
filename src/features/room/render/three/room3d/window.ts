// The glass wall: slim black aluminium frames set back in the reveal, a pane a bay (the column parts two bays, a mullion parts the west one),
// one picture of the city behind them all; a roller blind in each bay, its cassette at the top of the reveal.
import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { place, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { MULLION_X, PIER, WINDOW } from '../roomplan';
import { theCity } from './city';
import { screenTex } from './cloth';
import { FRAME_Z, GLASS_Z } from './consts';
import type { Build, Material } from './types';

/** A bay of the glass wall: its west and east edges. */
interface Bay {
  x0: number;
  x1: number;
}
/** The frames' bars: their width. */
const BAR = 300;

/** The frames: four bars round each bay, the mullion in the west one (matt enough that the sky light's one spot leaves no glint for the bloom). */
function frames(winG: Group, bays: Bay[]): void {
  const W = WINDOW,
    fz0 = FRAME_Z - 700,
    alu = mat(0x1d_1e_22, { metalness: 0.5, roughness: 0.6 });
  for (const b of bays) {
    const w = b.x1 - b.x0;
    for (const r of [
      { x: b.x0, y: W.y, w, h: BAR },
      { x: b.x0, y: W.y + W.h - BAR, w, h: BAR },
      { x: b.x0, y: W.y, w: BAR, h: W.h },
      { x: b.x1 - BAR, y: W.y, w: BAR, h: W.h },
    ]) {
      winG.add(softBox(r, fz0, FRAME_Z, alu, 30));
    }
  }
  winG.add(softBox({ x: MULLION_X - BAR / 2, y: W.y + BAR, w: BAR, h: W.h - 2 * BAR }, fz0, FRAME_Z, alu, 30));
}

/** The glass: a faint tinted pane, over the city's picture. */
function glass(): Mesh {
  const W = WINDOW;
  const pane = seeThrough(
    new Mesh(
      new PlaneGeometry(W.w, W.h),
      new MeshStandardMaterial({
        color: 0xdb_ea_ff,
        transparent: true,
        opacity: 0.07,
        roughness: 0.05,
        metalness: 0.2,
        depthWrite: false,
      }),
    ),
  );
  pane.position.set(W.x + W.w / 2, -(W.y + W.h / 2), GLASS_Z + 100);
  return pane;
}

/** A roller blind in each bay, its cassette at the top of the reveal. */
function blinds({ room }: Build, winG: Group, bays: Bay[]): void {
  const W = WINDOW;
  const cassette = mat(0x2a_2d_32, { roughness: 0.5 }),
    screen: Material = mat(0xff_ff_ff, { map: screenTex('#4b5059', [2, 4]), roughness: 0.9, side: DoubleSide });
  for (const b of bays) {
    winG.add(softBox({ x: b.x0 + 150, y: W.y, w: b.x1 - b.x0 - 300, h: 900 }, -900, -150, cassette, 120));
    const blind = place(new Mesh(new BoxGeometry(b.x1 - b.x0 - 500, 1, 40), screen));
    blind.position.set((b.x0 + b.x1) / 2, -(W.y + 900), -500);
    room.blinds.push(blind);
    winG.add(blind);
  }
}

/** The glass wall, its blinds, and the city behind it. */
export function buildWindow(b: Build): void {
  const { room, R } = b,
    W = WINDOW;
  const winG = tag(new Group(), 'blind');
  const bays: Bay[] = [
    { x0: W.x, x1: PIER.x0 },
    { x0: PIER.x1, x1: W.x + W.w },
  ];
  frames(winG, bays);
  const pane = glass();
  room.outside = theCity();
  room.cityDetail = room.outside.detail;
  room.window = winG;
  winG.add(room.outside.mesh, pane);
  blinds(b, winG, bays);
  R.add(winG);
}
