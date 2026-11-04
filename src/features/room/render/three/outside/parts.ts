// Small shared pieces of the outside: a box with its uvs in metres, so a repeating texture runs on across boxes.
import { BoxGeometry, Mesh, type BufferGeometry, type Material } from 'three';

/** Each face's uvs from its own plane, in metres. */
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

/** A box from (x0, y0, z0) to (x1, y1, z1), its uvs in metres of the frame it is built in. */
export function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Material): Mesh {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return new Mesh(metreUV(g), m);
}
