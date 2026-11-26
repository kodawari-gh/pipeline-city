// What stands on the bookcase's shelves (`bookcase`): a run of upright books with its gaps, a bookend or a leaning book, a stack, a plant, a box.
import { mat } from '@/core/render/three/materials';
import { rectBox, softBox } from '@/core/render/three/geometry';
import { succulent } from '../plants3d';
import { BOOKCASE, FLOOR_Y } from '../roomplan';
import { SPINES, leanInto } from './books';
import { wood } from './carcass';
import { rnd, stream } from './seed';
import { board } from './shapes';
import { CASE_BOARDS } from './strips';
import type { Book, Group, Material } from './types';

/** The bindings: neutrals, slate blues, a sage, a sand, and the room's terracotta as the one warm colour. */
const TONES = [
  0x1f_20_23, 0xd9_d6_cf, 0x5b_64_70, 0x2f_4a_63, 0xb5_53_2f, 0x8a_8f_96, 0x3c_4a_3e, 0xc9_b2_8a, 0x26_30_3d,
  0x3a_3f_47,
];
/** The tone a random number picks. */
const toneAt = (r: number): number => TONES[Math.floor(r * TONES.length)] ?? 0;

/** What the shelves build into: the bookcase's group, its oak, the books so far, the bookend's steel, the gaps' numbers and a shelf's height. */
interface Shelving {
  g: Group;
  oakMat: Material;
  books: Book[];
  steel: Material;
  gapRnd: () => number;
  gap: number;
}

/** How much of shelf `s` its run of books leaves free at its end, for a thing or two. */
function shelfRoom(s: number): number {
  if (s % 2) {
    return 4200;
  }
  if (s === 0) {
    return 5900;
  }
  return s === 2 ? 2700 : 400;
}

/** Upright books along shelf `s` (spines to the room), from its front end; where the run ends (`z`) and its last book's height. */
function uprightRun(c: Shelving, s: number, base: number): { run: Book[]; z: number; last: number } {
  const { x, z0, z1 } = BOOKCASE,
    { side, n } = CASE_BOARDS;
  let z = z0 + side + 160;
  const end = z1 - side - shelfRoom(s);
  let last = 0;
  const run: Book[] = [];
  while (z < end) {
    const bw = 380 + rnd() * 560,
      bh = c.gap * (0.6 + rnd() * 0.3) * (s === n - 1 ? 1.08 : 1),
      bd = 2900 + rnd() * 1300;
    if (z + bw > end) {
      break;
    }
    run.push({
      x: x + 360 + bd / 2,
      y: -base + bh / 2,
      z: z + bw / 2,
      sx: bd,
      sy: bh,
      sz: bw,
      lean: 0,
      tone: toneAt(rnd()),
      kind: Math.floor(rnd() * SPINES),
    });
    z += bw + 15 + (rnd() < 0.12 ? 120 : 0);
    last = bh;
  }
  return { run, z, last };
}

/** A gap or two in the run, each with the book on one side of it leant over into it (the gaps' own numbers pick where and which). */
function takeGaps(c: Shelving, run: Book[]): void {
  for (let k = 0; k < (run.length > 14 ? 2 : 1); k++) {
    const i = 2 + k * 7 + Math.floor(c.gapRnd() * 4);
    if (i > run.length - 3) {
      break;
    }
    run.splice(i, 1);
    const toward = c.gapRnd() < 0.5,
      before = run[i - 1],
      after = run[i];
    if (before && after) {
      if (toward) {
        leanInto(before, after, 1);
      } else {
        leanInto(after, before, -1);
      }
    }
  }
}

/** What ends shelf `s`'s run: a flat stack (the top shelf), a book leant on it (the third), a steel bookend (the bottom one). */
function shelfEnd(c: Shelving, s: number, at: { base: number; z: number; last: number }): void {
  const { x } = BOOKCASE,
    { n } = CASE_BOARDS,
    { base, z } = at;
  if (s === 0) {
    flatStack(c, base);
  } else if (s === 2) {
    leaningBook(c, s, at);
  } else if (s === n - 1) {
    // a steel bookend holds the end of the bottom run, its foot under the last books
    const bh = Math.min(at.last, c.gap * 0.6);
    c.g.add(
      rectBox({ x: x + 1400, y: base - 50, w: 2200, h: 50 }, z - 1500, z + 60, c.steel),
      rectBox({ x: x + 1400, y: base - bh, w: 2200, h: bh }, z, z + 60, c.steel),
    );
  }
}

/** A stack lying flat at the end of the top shelf, the biggest at the bottom. */
function flatStack(c: Shelving, base: number): void {
  const { x, z1 } = BOOKCASE,
    { side } = CASE_BOARDS;
  let sy = base;
  for (let k = 0; k < 4; k++) {
    const t = 380 + rnd() * 220,
      bd = 3600 - k * 260,
      bl = 5200 - k * 400;
    c.books.push({
      x: x + 360 + bd / 2,
      y: -sy + t / 2,
      z: z1 - side - 2900 + (rnd() - 0.5) * 300,
      sx: bd,
      sy: bl,
      sz: t,
      lean: Math.PI / 2,
      tone: toneAt(rnd()),
      kind: k % 3,
    });
    sy -= t;
  }
}

/** The last book of shelf `s` leans on the run, its top on the last upright one. */
function leaningBook(c: Shelving, s: number, { base, z }: { base: number; z: number }): void {
  const { x } = BOOKCASE;
  const bh = c.gap * 0.78,
    t = 520,
    a = 0.32;
  c.books.push({
    x: x + 360 + 1700,
    y: -base + (bh / 2) * Math.cos(a) + (t / 2) * Math.sin(a),
    z: z + (t / 2) * Math.cos(a) + (bh / 2) * Math.sin(a),
    sx: 3400,
    sy: bh,
    sz: t,
    lean: -a,
    tone: TONES[(s * 3) % TONES.length] ?? 0,
    kind: 1,
  });
}

/** Beside the run on an odd shelf: a succulent (the second shelf), a black box with its lid (the fourth). */
function shelfThing(c: Shelving, s: number, base: number): void {
  const { x, w, z1 } = BOOKCASE,
    { side } = CASE_BOARDS,
    tz = z1 - side - 2200;
  if (s === 1) {
    c.g.add(succulent(x + w - 2600, base, tz, 1000));
  } else {
    c.g.add(
      softBox(
        { x: x + 900, y: base - 1800, w: 3800, h: 1800 },
        tz - 1600,
        tz + 1600,
        mat(0x1d_1e_22, { roughness: 0.6 }),
        120,
      ),
      softBox(
        { x: x + 880, y: base - 1880, w: 3840, h: 200 },
        tz - 1640,
        tz + 1640,
        mat(0x2a_2d_32, { roughness: 0.6 }),
        60,
      ),
    );
  }
}

/** What the shelves of the bookcase in `g` build into, its oak `oakMat`: the bookend's steel, the gaps' own numbers, a shelf's height. */
export function shelving(g: Group, oakMat: Material): Shelving {
  const { top } = BOOKCASE,
    { n } = CASE_BOARDS;
  return {
    g,
    oakMat,
    books: [],
    steel: mat(0x2a_2d_32, { metalness: 0.6, roughness: 0.4 }),
    gapRnd: stream(4241),
    gap: (FLOOR_Y - top - 1400) / n,
  };
}

/** Shelf `s`: its board and, under it (all but the last), a run of books with its gaps, what ends the run and what stands beside it. */
function shelfRow(c: Shelving, s: number): void {
  const { x, w, z0, z1, top } = BOOKCASE,
    { side, board: shelf, n } = CASE_BOARDS;
  const y = top + s * c.gap,
    base = y + c.gap;
  c.g.add(wood(board({ x, y, w, h: shelf }, [z0 + side - 10, z1 - side + 10], c.oakMat)));
  if (s === n) {
    return;
  }
  const { run, z, last } = uprightRun(c, s, base);
  // a gap or two in the run (a book taken out), and a book beside each gap leant over into it (the bottom run stays tight on its bookend)
  if (s < n - 1) {
    takeGaps(c, run);
  }
  c.books.push(...run);
  shelfEnd(c, s, { base, z, last });
  if (s % 2) {
    shelfThing(c, s, base);
  }
}

/** Every shelf, top to bottom, with what stands on it. */
export function fillShelves(c: Shelving): void {
  for (let s = 0; s <= CASE_BOARDS.n; s++) {
    shelfRow(c, s);
  }
}
