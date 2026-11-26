// The bookcase's books: their spines (`spineTex`), a book leant into a gap (`leanInto`) and the books in a few instanced draws (`shelvedBooks`).
import { BoxGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import { paint, place } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { mat } from '@/core/render/three/materials';
import { rnd } from './seed';
import { stripLit } from './strips';
import type { Matrix4, Texture } from './types';

/**
 * A book's spine: a pale cloth ground (each book's own colour tints it) and two or three quiet bands across it, a shade lighter or darker than
 * the cloth: no letters (at a reading distance a title is a soft band, and drawn letter by letter it reads as a barcode). Four modern designs:
 * a dark label and a rule at the foot; darker head and foot with a light label; plain with a rule at each end; a paperback (a long light title
 * band, a small mark at its foot).
 */
export const SPINES = 4;
function spineTex(kind: number): Texture | null {
  return paint(64, 512, (c, w, h) => {
    c.fillStyle = '#d2d2d2';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
      c.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 6);
    }
    const band = (y: number, t: number, col: string) => {
      c.fillStyle = col;
      c.fillRect(0, y, w, t);
    };
    const light = 'rgba(255,255,255,0.3)',
      dark = 'rgba(0,0,0,0.22)';
    if (kind === 0) {
      band(100, 210, dark);
      band(h - 52, 6, light);
    } else if (kind === 1) {
      band(0, 70, dark);
      band(h - 70, 70, dark);
      band(130, 170, light);
    } else if (kind === 2) {
      band(46, 5, light);
      band(h - 51, 5, light);
    } else {
      band(50, 300, light);
      c.fillStyle = light;
      c.fillRect(w / 2 - 10, h - 78, 20, 24);
    }
  });
}

/** How far a spine's round stands out of its book, a share of the book's depth (about 1 cm). */
export const SPINE_ROUND = 0.045;

/** A book on a shelf: its centre, its depth into the shelf (sx), height (sy) and thickness (sz), its lean round x, its colour and spine design. */
export interface Book {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  lean: number;
  tone: number;
  kind: number;
}

/**
 * `b` leant over into the gap on its `dir` side (+1: toward +z) about its foot's edge there, until it rests on `n`, the upright book across the
 * gap: its top corner on `n`'s face, or its face on `n`'s top corner when `n` is the shorter. It stays on the shelf and out of `n`.
 */
export function leanInto(b: Book, n: Book, dir: 1 | -1): void {
  const gap = (dir > 0 ? n.z - n.sz / 2 - (b.z + b.sz / 2) : b.z - b.sz / 2 - (n.z + n.sz / 2)) - 10;
  const a = Math.max(Math.asin(Math.min(1, gap / b.sy)), Math.atan(gap / n.sy)),
    foot = b.y - b.sy / 2,
    pz = b.z + (dir * b.sz) / 2;
  b.lean = dir * a;
  b.y = foot + (b.sy / 2) * Math.cos(a) + (b.sz / 2) * Math.sin(a);
  b.z = pz + dir * ((b.sy / 2) * Math.sin(a) - (b.sz / 2) * Math.cos(a));
}

/** A box's three index groups that show for a book's cover: the spine (+x), then the boards (-x, +z, -z); its top and foot have none. */
function coverIndex(cover: BoxGeometry): { spine: number[]; rest: number[] } {
  const ix = cover.index,
    take = (gr: { start: number; count: number } | undefined) =>
      ix && gr ? [...ix.array].slice(gr.start, gr.start + gr.count) : [];
  const gs = cover.groups;
  return { spine: take(gs[0]), rest: [...take(gs[1]), ...take(gs[4]), ...take(gs[5])] };
}

/**
 * A book's cover: a unit box, its spine (+x) rounded across the book's thickness, as a bound book's back is, steepest where it meets the boards.
 * Low (CITY-06): the spine, then the boards' three faces in one group, with no group for the hidden top and foot: two draws a design, not four.
 */
function bookCover(low: boolean): BoxGeometry {
  const cover = new BoxGeometry(1, 1, 1, 1, 1, 12),
    cp = cover.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    if (cp.getX(i) > 0.49) {
      const across = Math.max(0, 1 - 4 * cp.getZ(i) ** 2);
      cp.setX(i, 0.5 + SPINE_ROUND * Math.sqrt(across));
    }
  }
  cover.computeVertexNormals();
  if (low) {
    const { spine, rest } = coverIndex(cover);
    cover.setIndex([...spine, ...rest]);
    cover.clearGroups();
    cover.addGroup(0, spine.length, 0);
    cover.addGroup(spine.length, rest.length, 1);
  }
  return cover;
}

/** The page blocks' texture: cream paper, its pages' edges in fine lines. */
function pagesTex(): Texture | null {
  return paint(128, 128, (c, w, h) => {
    c.fillStyle = '#efe7d4';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < h; i += 2) {
      c.fillStyle = `rgba(120,100,70,${0.05 + rnd() * 0.08})`;
      c.fillRect(0, i, w, 1);
    }
  });
}

/** `d` set to a book's place and lean, scaled to `s` (its three sizes) and moved `s[3]` along x: its matrix. */
function bookMatrix(d: Object3D, b: Book, s: readonly [number, number, number, number]): Matrix4 {
  d.position.set(b.x + s[3], b.y, b.z);
  d.rotation.set(b.lean, 0, 0);
  d.scale.set(s[0], s[1], s[2]);
  d.updateMatrix();
  return d.matrix;
}

/**
 * The books of a bookcase in four draws: per spine design one instanced box (spine and boards in the book's colour, no top: the page block shows
 * there), and the cream page blocks inside them, set back from the spine and in from the boards.
 */
export function shelvedBooks(books: readonly Book[]): Group {
  const g = new Group(),
    box = new BoxGeometry(1, 1, 1),
    d = new Object3D(),
    col = new Color();
  const low = lowDetail(),
    cover = bookCover(low);
  const board = stripLit(mat(0xb9_ba_bf, { roughness: 0.75 })),
    hidden = new MeshBasicMaterial({ visible: false });
  const pages = pagesTex();
  for (let kind = 0; kind < SPINES; kind++) {
    const set = books.filter((b) => b.kind === kind);
    if (set.length === 0) {
      continue;
    }
    // BoxGeometry's groups: +x (the spine, to the room), -x, +y, -y, +z, -z
    const spine = stripLit(mat(0xff_ff_ff, { map: spineTex(kind), roughness: 0.7 }));
    const m = new InstancedMesh(cover, low ? [spine, board] : [spine, board, hidden, hidden, board, board], set.length);
    for (const [i, b] of set.entries()) {
      m.setMatrixAt(i, bookMatrix(d, b, [b.sx, b.sy, b.sz, 0]));
      m.setColorAt(i, col.setHex(b.tone));
    }
    g.add(place(m));
  }
  const p = new InstancedMesh(box, stripLit(mat(0xff_ff_ff, { map: pages, roughness: 0.9 })), books.length);
  for (const [i, b] of books.entries()) {
    p.setMatrixAt(i, bookMatrix(d, b, [b.sx - 90, b.sy - 70, b.sz - 70, -45]));
  }
  g.add(place(p));
  return g;
}
