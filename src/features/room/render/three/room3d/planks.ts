// The floor: smoked oak planks running east-west, painted from the room's stream (`planksTex`) or from the baked set, wall to wall.
import { Mesh, PlaneGeometry } from 'three';
import { paint } from '@/core/render/three/geometry';
import { bakedOak, oakMaps, smokedOak } from '../furniture/oak';
import { OAK, OAK_GRAIN, rgbOf, shadeOf } from '../palette';
import { EAST_X, FLOOR_Y, FRONT_Z, WEST_X } from '../roomplan';
import { reseed, rnd, seedNow } from './seed';
import type { OakMaps, Texture } from './types';

/** The floor's tiles across the room and along it. */
const PLANKS_REPEAT: [number, number] = [2.4, 3.2];
/** A tile's rows of boards. */
const ROWS = 8;

/** A row of boards being painted: the canvas, the row's top and height, the tile's width and the grain's colour (an `rgba(` prefix). */
interface Row {
  c: CanvasRenderingContext2D;
  y0: number;
  ph: number;
  w: number;
  grain: string;
}
/** A board's tone: its shade of the oak, and how much cooler than the oak it is. */
interface Tone {
  f: number;
  warm: number;
}
type Span = [number, number];

/** The grain along the board, waved a little; a few lighter streaks. */
function plankGrain({ c, y0, ph, w, grain }: Row): void {
  for (let i = 0; i < 16; i++) {
    const gy = y0 + rnd() * ph,
      amp = 2 + rnd() * 5;
    c.strokeStyle = rnd() < 0.8 ? `${grain}${0.14 + rnd() * 0.18})` : `rgba(255,255,255,${0.04 + rnd() * 0.05})`;
    c.lineWidth = 0.8 + rnd() * 1.8;
    c.beginPath();
    c.moveTo(0, gy);
    for (let x = 0; x <= w; x += 64) {
      c.lineTo(x, gy + Math.sin(x / 90 + i) * amp);
    }
    c.stroke();
  }
}

/** A knot, now and then: dark heart, rings stretched along the board. */
function plankKnot({ c, y0, ph, grain }: Row, [x0, x1]: Span): void {
  if (rnd() < 0.4) {
    const kx = x0 + (0.2 + rnd() * 0.6) * (x1 - x0),
      ky = y0 + ph * (0.3 + rnd() * 0.4);
    for (let k = 4; k >= 0; k--) {
      c.fillStyle = `${grain}${0.1 + (4 - k) * 0.08})`;
      c.beginPath();
      c.ellipse(kx, ky, 5 + k * 7, 3 + k * 2.2, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
}

/** One part of a board (a board through the tile's edge is drawn in two): its tone, its grain and maybe a knot, clipped to the part. */
function boardPart(row: Row, part: Span, { f, warm }: Tone): void {
  const { c, y0, ph, w } = row,
    [x0, x1] = part;
  c.save();
  c.beginPath();
  c.rect(x0, y0, x1 - x0, ph);
  c.clip();
  c.fillStyle = `rgb(${255 * f},${255 * f - warm},${255 * f - 2 * warm})`;
  c.fillRect(0, y0, w, ph);
  plankGrain(row);
  plankKnot(row, part);
  c.restore();
}

/** The butt joints of row `r` (one, or two on odd rows), staggered so no joint lines up with the next row's. */
function rowCuts(r: number, w: number): number[] {
  const cuts = [((r * 0.37 + 0.13) % 1) * w];
  if (r % 2) {
    cuts.push(((r * 0.37 + 0.63) % 1) * w);
  }
  return cuts.toSorted((a, b) => a - b);
}

/** The boards of a row: between the cuts, and the one through the tile's edge (drawn in two parts, the same board). */
const rowBoards = (cuts: number[], w: number): Span[][] =>
  cuts.map((x, k) => {
    const next = cuts[k + 1];
    return next === undefined
      ? [
          [x, w],
          [0, cuts[0] ?? 0],
        ]
      : [[x, next]];
  });

/** The long joint above the row (dark, then its lit bevel), the butt joints. */
function rowJoints({ c, y0, ph, w }: Row, cuts: number[]): void {
  c.fillStyle = 'rgba(4,6,15,0.75)';
  c.fillRect(0, y0, w, 3);
  c.fillStyle = 'rgba(226,234,255,0.1)';
  c.fillRect(0, y0 + 3, w, 2);
  for (const x of cuts) {
    c.fillStyle = 'rgba(4,6,15,0.7)';
    c.fillRect(x - 1, y0, 2.5, ph);
  }
}

/** A row of boards; each part of a board draws from the same point of the room's stream, so its two parts match. */
function plankRow(row: Row, r: number): void {
  const cuts = rowCuts(r, row.w);
  for (const parts of rowBoards(cuts, row.w)) {
    // (a board a few shades from the next, a hair cooler at most: one surface, not a patchwork; no warm cast, art-style v3)
    const tone = { f: 0.86 + rnd() * 0.14, warm: -rnd() * 2 },
      seed = seedNow();
    for (const part of parts) {
      reseed(seed);
      boardPart(row, part, tone);
    }
  }
  rowJoints(row, cuts);
}

/**
 * Smoked oak floor planks running east-west, as a shade of the oak (`smokedOak` gives them its colour and their relief): each board its own
 * tone and grain, a knot here and there, staggered butt joints, the joints dark with a lit edge (an eased bevel). A tile is eight boards; the
 * board that crosses the tile's edge carries on in the next tile, so no joint lines up.
 */
function planksTex(): Texture | null {
  const grain = `rgba(${rgbOf(shadeOf(OAK_GRAIN, OAK)).join(',')},`;
  return paint(
    1024,
    1024,
    (c, w, h) => {
      const ph = h / ROWS;
      for (let r = 0; r < ROWS; r++) {
        plankRow({ c, y0: r * ph, ph, w, grain }, r);
      }
    },
    PLANKS_REPEAT,
  );
}

/**
 * The floor's maps, painted: always the same boards (their own seed). The texture bake runs it (`room-planks`, `tools/bake/textures.mjs`).
 * @public
 */
export function planksMaps(): OakMaps {
  const keep = seedNow();
  reseed(4871);
  const maps = oakMaps(planksTex());
  reseed(keep);
  return maps;
}

/** The floor: long planks east-west (`planksTex`, or its baked maps), wall to wall. */
export function oakFloor(): Mesh {
  const floor = new Mesh(
    new PlaneGeometry(EAST_X - WEST_X, FRONT_Z),
    smokedOak(bakedOak('room-planks', PLANKS_REPEAT) ?? planksMaps()),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((WEST_X + EAST_X) / 2, -FLOOR_Y, FRONT_Z / 2);
  floor.receiveShadow = true;
  return floor;
}
