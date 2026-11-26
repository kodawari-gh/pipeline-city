// The tower cooler (cooler3d.ts): a stack of aluminium fins offset north of the socket (clear of the first card), four copper heat pipes rising
// from its base through every fin, held by a sprung crossbar on two bars; a 120 mm fan on each end clips on by its wire clips, both blowing west.
import type { Group, Material, MeshStandardMaterial } from 'three';
import { SEG, drum, rounded, softBox, tube } from '@/core/render/three/geometry';
import { byDetail } from '@/core/render/three/detail';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import type { FanFit, Spin } from '../fans3d';
import { mount, pipe, screws } from './kit';
import { L, alu, copper, steel } from './look';
import { FIN1 } from './plan';
import { towerFans, towerFins } from './towerParts';

/** A spring screw's coil round the post at `px`, from the bar up to the crossbar. */
function spring(g: Group, px: number, m: Material) {
  const z0 = BOARD_Z + 264,
    z1 = L + 296,
    k = byDetail(7 * 16, 48);
  g.add(drum(px, 0, BOARD_Z + 260, L + 340, 24, m, SEG.part));
  const coil = Array.from({ length: k + 1 }, (_, i): [number, number, number] => {
    const a = (i / k) * 7 * Math.PI * 2;
    return [px + Math.cos(a) * 54, Math.sin(a) * 54, z0 + ((z1 - z0) * i) / k];
  });
  g.add(tube(coil, 10, m, SEG.cord, byDetail(339, 48)));
}

/**
 * The mount: a bar each side of the socket on the standoffs, a thumb nut on each end; a crossbar over the base, sprung down onto the bars by a
 * screw at each end.
 */
function towerMount(g: Group, m: MeshStandardMaterial) {
  mount(g, { standoff: BOARD_Z + 200, nut: BOARD_Z + 260 });
  for (const sx of [-1, 1]) {
    g.add(softBox({ x: sx * 920 - 100, y: -960, w: 200, h: 1920 }, BOARD_Z + 200, BOARD_Z + 260, m, 14));
  }
  g.add(softBox({ x: -1000, y: -110, w: 2000, h: 220 }, L + 300, L + 340, m, 12));
  for (const px of [-920, 920]) {
    spring(g, px, m);
  }
  screws(
    g,
    [
      [-920, 0],
      [920, 0],
    ],
    { z: L + 340, r: 60 },
  );
}

/**
 * Four heat pipes, each a U along the base and up through every fin at both ends, staggered so the air meets each in turn; their tips stand
 * through the cover.
 */
function heatPipes(g: Group, cu: Material) {
  const tip = FIN1 + 100;
  for (const [px, s] of [
    [-270, 960],
    [-90, 640],
    [90, 800],
    [270, 480],
  ] as const) {
    const path = rounded(
      [
        [px, s, tip],
        [px, s, L + 170],
        [px, -s, L + 170],
        [px, -s, tip],
      ],
      220,
      SEG.cornerSoft,
    );
    g.add(pipe(path, 69, cu));
    for (const py of [s, -s]) {
      g.add(drum(px, py, FIN1 + 40, tip, 72, cu, SEG.disc));
    }
  }
}

/** The tower cooler on `g`, with its fans fitted; the fins' material is its skin. */
export function tower(g: Group, spins: Spin[], fans: readonly FanFit[]): MeshStandardMaterial {
  const fin = alu(0x4e_53_60, 0.4),
    cu = copper(),
    m = steel(); // (dark anodised fins, art-style §4)
  towerMount(g, m);
  // the base: a copper contact plate on the lid, the aluminium block the pipes run through
  g.add(softBox({ x: -470, y: -470, w: 940, h: 940 }, L, L + 50, cu, 10));
  g.add(softBox({ x: -500, y: -450, w: 1000, h: 900 }, L + 50, L + 300, alu(0x2a_2d_32, 0.4), 30));
  heatPipes(g, cu);
  towerFins(g, fin);
  towerFans(g, { spins, fans }, m);
  return fin;
}
