// The houses across the street and down the side street: brick or rendered walls built round their openings (each pane sits back in its
// reveal), frames with a mullion and a transom, stone sills, panelled doors under a fanlight, a plinth and a string course, gutters, tiled
// roofs with a ridge and bargeboards, chimneys with pots, dormers. A far house keeps its shape with flat panes. All on the kit's shared
// materials (`kit.ts`), so `mergeStatic` draws the whole street in a few calls.
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, Path, PlaneGeometry, Shape, Vector2, type BufferGeometry, type Material } from 'three';
import type { Kit } from './kit';
import { PLINTH, STOREY, cutWall, eavesOf, openings, rng, type Box2, type House } from './plan';

/** The front wall's thickness, how far a pane sits back in it, a frame bar's width (m). */
const T = 0.3, RECESS = 0.12, FRAME = 0.065;

/** Each face's uvs from its own plane, in metres: a repeating texture runs on across boxes. */
function metreUV(g: BufferGeometry): BufferGeometry {
  const p = g.attributes.position!, n = g.attributes.normal!, uv = g.attributes.uv!;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (az >= ax && az >= ay) uv.setXY(i, p.getX(i), p.getY(i));
    else if (ax >= ay) uv.setXY(i, p.getZ(i), p.getY(i));
    else uv.setXY(i, p.getX(i), p.getZ(i));
  }
  return g;
}

/** Swap a geometry's u and v, or turn v round: a roof's tile courses run along its ridge, down its slope. */
function swapUV(g: BufferGeometry): void { const uv = g.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i)); }
function flipV(g: BufferGeometry): void { const uv = g.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setY(i, -uv.getY(i)); }

/** A box from (x0, y0, z0) to (x1, y1, z1), its uvs in metres of the frame it is built in. */
export function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Material): Mesh {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return new Mesh(metreUV(g), m);
}

/** A box about its middle, its uvs in metres of its own frame: a part to turn (a roof's plane, a canopy). */
export function slab(sx: number, sy: number, sz: number, m: Material): Mesh { return new Mesh(metreUV(new BoxGeometry(sx, sy, sz)), m); }

/** A pane's quad, its uvs on one quarter of the rooms picture (`rooms`), so the rooms behind the panes differ. */
function quarterQuad(w: number, h: number, q: number): BufferGeometry {
  const g = new PlaneGeometry(w, h), uv = g.attributes.uv!, ox = (q % 2) * 0.5, oy = Math.floor(q / 2) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ox + uv.getX(i) * 0.5, oy + uv.getY(i) * 0.5);
  return g;
}

/**
 * A window in an opening: the pane (back in its reveal, or flat on a far wall), the frame with a mullion and a transom, a sill, a lintel over
 * brick. `dz`: the face it is set in, when that is not the facade's (a dormer's).
 */
function pane(g: Group, o: Box2, k: Kit, trim: Material, near: boolean, lit: boolean, brick: boolean, q: number, dz = 0): void {
  const cx = (o.x0 + o.x1) / 2, w = o.x1 - o.x0, h = o.y1 - o.y0, z = (near ? -RECESS : 0.012) + dz, f = FRAME, z0 = z - 0.02, z1 = z + 0.05;
  const glass = new Mesh(quarterQuad(w, h, q), lit ? k.lit : k.glass);
  glass.position.set(cx, (o.y0 + o.y1) / 2, z);
  g.add(glass);
  const ty = o.y0 + h * 0.7;
  g.add(
    block(o.x0, o.y0, z0, o.x1, o.y0 + f, z1, trim), block(o.x0, o.y1 - f, z0, o.x1, o.y1, z1, trim),
    block(o.x0, o.y0, z0, o.x0 + f, o.y1, z1, trim), block(o.x1 - f, o.y0, z0, o.x1, o.y1, z1, trim),
    block(o.x0, ty - f / 2, z0, o.x1, ty + f / 2, z1, trim), block(cx - f / 2, o.y0, z0, cx + f / 2, ty, z1, trim),
    block(o.x0 - 0.07, o.y0 - 0.07, z - 0.02, o.x1 + 0.07, o.y0, 0.07 + dz, k.stone),
  );
  if (brick) g.add(block(o.x0 - 0.05, o.y1, -0.01 + dz, o.x1 + 0.05, o.y1 + 0.2, 0.012 + dz, k.stone));
}

/** The front door: a leaf with four raised panels and a handle, a fanlight over it, its frame, two steps up, perhaps a canopy on brackets. */
function door(g: Group, o: Box2, h: House, k: Kit, trim: Material): void {
  const cx = (o.x0 + o.x1) / 2, w = o.x1 - o.x0, z = h.near ? -0.16 : 0.012, top = o.y1 - 0.42, leaf = k.doors[h.door]!, f = FRAME;
  g.add(block(o.x0 + f, o.y0, z - 0.05, o.x1 - f, top, z, leaf));
  for (const [y0, y1] of [[o.y0 + 0.15, o.y0 + 0.95], [o.y0 + 1.1, top - 0.15]] as const) for (const s of [-1, 1]) {
    const px = cx + s * w * 0.2;
    g.add(block(px - w * 0.15, y0, z, px + w * 0.15, y1, z + 0.02, leaf));
  }
  g.add(block(cx + w * 0.24, o.y0 + 1.0, z, cx + w * 0.3, o.y0 + 1.05, z + 0.06, k.brass));
  const fan = new Mesh(quarterQuad(w - 2 * f, o.y1 - top - f, 3), k.glass);
  fan.position.set(cx, (top + o.y1 - f) / 2, z - 0.02);
  g.add(fan);
  const z0 = z - 0.06, z1 = z + 0.05;
  g.add(block(o.x0, o.y0, z0, o.x0 + f, o.y1, z1, trim), block(o.x1 - f, o.y0, z0, o.x1, o.y1, z1, trim), block(o.x0, o.y1 - f, z0, o.x1, o.y1, z1, trim), block(o.x0, top - f / 2, z0, o.x1, top + f / 2, z1, trim));
  g.add(block(o.x0 - 0.2, 0, 0, o.x1 + 0.2, PLINTH - 0.15, 0.64, k.stone), block(o.x0 - 0.12, 0, 0, o.x1 + 0.12, PLINTH, 0.33, k.stone));
  if (!h.porch) return;
  const cy = o.y1 + 0.3, c = slab(w + 0.7, 0.07, 0.9, k.tiles[h.tiles]!);
  c.position.set(cx, cy + 0.12, 0.44);
  c.rotation.x = 0.28;
  g.add(c);
  for (const s of [-1, 1]) g.add(block(cx + s * (w / 2 + 0.22) - 0.04, cy - 0.4, 0, cx + s * (w / 2 + 0.22) + 0.04, cy + 0.02, 0.62, trim));
}

/** A chimney stack of brick with a stone cap and two pots, standing from inside the roof at (x, z) to `top`. */
function chimney(g: Group, x: number, z: number, from: number, top: number, k: Kit): void {
  g.add(block(x - 0.32, from, z - 0.26, x + 0.32, top, z + 0.26, k.chimney), block(x - 0.38, top, z - 0.32, x + 0.38, top + 0.08, z + 0.32, k.stone));
  for (const dx of [-0.14, 0.14]) {
    const pot = new Mesh(new CylinderGeometry(0.08, 0.1, 0.4, 10), k.pots);
    pot.position.set(x + dx, top + 0.28, z);
    g.add(pot);
  }
}

/** A plain wall triangle (a gable) on the xy plane, `rise` over a base from -b/2 to b/2, `T` thick toward +z; optionally with a hole. */
function gable(b: number, rise: number, m: Material, hole?: Box2): Mesh {
  const s = new Shape([new Vector2(-b / 2, 0), new Vector2(b / 2, 0), new Vector2(0, rise)]);
  if (hole) s.holes.push(new Path([new Vector2(hole.x0, hole.y0), new Vector2(hole.x1, hole.y0), new Vector2(hole.x1, hole.y1), new Vector2(hole.x0, hole.y1)]));
  return new Mesh(new ExtrudeGeometry(s, { depth: T, bevelEnabled: false }), m);
}

/** A roof with its ridge along the street: two tiled planes over the eaves, gable walls, a ridge, bargeboards, gutters, a chimney, a dormer. */
function sideRoof(g: Group, h: House, k: Kit, wall: Material, trim: Material, r: () => number): void {
  const e = eavesOf(h), p = h.pitch, hd = h.d / 2, o = 0.38, rise = hd * Math.tan(p), top = e + rise, tile = k.tiles[h.tiles]!;
  const L = (hd + o) / Math.cos(p), W = h.w + 0.5, th = 0.16, c = Math.cos(p), sn = Math.sin(p);
  for (const s of [1, -1]) {
    // the slope's middle on the tiles' face, then half the slab's thickness in under it
    const zc = s > 0 ? (o - hd) / 2 : -h.d - (o - hd) / 2, yc = e + ((hd - o) / 2) * Math.tan(p);
    const pl = slab(W, th, L, tile);
    if (s < 0) flipV(pl.geometry);
    pl.position.set(0, yc - (th / 2) * c, zc - s * (th / 2) * sn);
    pl.rotation.x = s * p;
    g.add(pl);
    for (const x of [-W / 2, W / 2]) {
      const b = slab(0.05, 0.24, L, trim);
      b.position.set(x, yc - 0.12 * c, zc - s * 0.12 * sn);
      b.rotation.x = s * p;
      g.add(b);
    }
    const gz = s > 0 ? o - 0.06 : -h.d - o + 0.06, gy = e - o * Math.tan(p) - 0.07;
    g.add(block(-W / 2, gy - 0.11, gz - 0.07, W / 2, gy, gz + 0.07, k.gutter));
  }
  for (const x of [-h.w / 2, h.w / 2 - T]) {
    const gb = gable(h.d, rise, wall);
    gb.rotation.y = Math.PI / 2;
    gb.position.set(x, e, -hd);
    g.add(gb);
  }
  g.add(block(-W / 2, top - 0.03, -hd - 0.14, W / 2, top + 0.11, -hd + 0.14, k.ridge));
  const pipe = new Mesh(new CylinderGeometry(0.045, 0.045, e, 8), k.gutter);
  pipe.position.set((h.doorBay ? -1 : 1) * (h.w / 2 - 0.15), e / 2, 0.1);
  g.add(pipe);
  if (h.chimney) chimney(g, (r() < 0.5 ? -1 : 1) * (h.w / 2 - 0.6), -hd + (r() - 0.5) * 0.5, e, top + 0.9, k);
  if (!h.dormer || !h.near) return;
  // a dormer on the front slope: its face stands on the roof, its cheeks run back into it, a lead top
  const zf = -0.8, yb = e + 0.8 * Math.tan(p), yt = yb + 1.4, zb = -(yt - e) / Math.tan(p) - 0.1, dw = 1.6;
  g.add(block(-dw / 2, yb - 0.35, zb, dw / 2, yt, zf, trim));
  g.add(block(-dw / 2 - 0.12, yt, zb, dw / 2 + 0.12, yt + 0.08, zf + 0.14, k.lead));
  pane(g, { x0: -dw / 2 + 0.18, x1: dw / 2 - 0.18, y0: yb + 0.15, y1: yt - 0.18 }, k, trim, false, r() < 0.3, false, Math.floor(r() * 4), zf);
}

/** A roof with a gable to the street: two planes falling to the sides, the front gable with its attic window, bargeboards, gutters, a chimney. */
function frontRoof(g: Group, h: House, k: Kit, wall: Material, trim: Material, r: () => number, brick: boolean): void {
  const e = eavesOf(h), p = h.pitch, hw = h.w / 2, o = 0.32, rise = hw * Math.tan(p), top = e + rise, tile = k.tiles[h.tiles]!;
  const L = (hw + o) / Math.cos(p), D = h.d + 0.6, th = 0.16, c = Math.cos(p), sn = Math.sin(p), xc = (hw + o) / 2, yc = e + ((hw - o) / 2) * Math.tan(p);
  for (const s of [1, -1]) {
    const pl = slab(L, th, D, tile);
    swapUV(pl.geometry);
    if (s < 0) flipV(pl.geometry);
    pl.position.set(s * (xc - (th / 2) * sn), yc - (th / 2) * c, -h.d / 2);
    pl.rotation.z = -s * p;
    g.add(pl);
    const b = slab(L, 0.24, 0.05, trim);
    b.position.set(s * (xc - 0.12 * sn), yc - 0.12 * c, 0.3);
    b.rotation.z = -s * p;
    g.add(b);
    const gy = e - o * Math.tan(p) - 0.07, gx = s * (hw + o - 0.06);
    g.add(block(gx - 0.07, gy - 0.11, -h.d - 0.3, gx + 0.07, gy, 0.3, k.gutter));
  }
  const attic = openings(h).find((q) => q.kind === 'attic')!;
  const front = gable(h.w, rise, wall, h.near ? { ...attic, y0: attic.y0 - e, y1: attic.y1 - e } : undefined);
  front.position.set(0, e, -T);
  g.add(front);
  const back = gable(h.w, rise, wall);
  back.position.set(0, e, -h.d);
  g.add(back);
  pane(g, attic, k, trim, h.near, r() < 0.3, brick, Math.floor(r() * 4));
  g.add(block(-0.14, top - 0.03, -h.d - 0.3, 0.14, top + 0.11, 0.3, k.ridge));
  if (h.chimney) chimney(g, 0, -h.d * 0.72, e, top + 0.8, k);
}

/** One house, in its own frame (the front facade on z = 0 facing +z, x across it from its middle, on y = 0), set at its place. */
export function house(h: House, k: Kit): Group {
  const g = new Group(), r = rng(h.seed), e = eavesOf(h), wall = k.walls[h.wall]!, trim = k.trims[h.trim]!, brick = h.wall < 2;
  const ops = openings(h).filter((o) => o.kind !== 'attic');
  g.add(block(-h.w / 2, 0, -h.d, h.w / 2, e, -T, wall));
  if (h.near) for (const p of cutWall(-h.w / 2, h.w / 2, 0, e, ops)) g.add(block(p.x0, p.y0, -T, p.x1, p.y1, 0, wall));
  else g.add(block(-h.w / 2, 0, -T, h.w / 2, e, 0, wall));
  g.add(block(-h.w / 2 - 0.03, 0, -h.d - 0.03, h.w / 2 + 0.03, PLINTH, 0.03, k.plinth));
  g.add(block(-h.w / 2 - 0.02, PLINTH + STOREY - 0.14, -0.02, h.w / 2 + 0.02, PLINTH + STOREY + 0.01, 0.03, k.stone));
  let q = Math.floor(r() * 4);
  for (const o of ops) {
    if (o.kind === 'door') door(g, o, h, k, trim);
    else pane(g, o, k, trim, h.near, r() < 0.35, brick, q++ % 4);
  }
  if (h.roof === 'side') sideRoof(g, h, k, wall, trim, r); else frontRoof(g, h, k, wall, trim, r, brick);
  g.position.set(h.x, 0, h.z);
  g.rotation.y = h.rot;
  g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return g;
}
