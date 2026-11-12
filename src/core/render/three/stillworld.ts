// The world matrices of a scene whose objects mostly stand still (Build my PC, docs/render/case.md "Build my PC's frame"). three composes
// every object's matrix and multiplies it with its parent's on every frame. `syncWorld` does the same work only for an object whose
// position, turn, scale or parent changed since its last call, and for what is under it. The result is the same as `updateMatrixWorld`.
// Use: `scene.matrixWorldAutoUpdate = false`, then `syncWorld(scene)` before each draw.
import { Object3D } from 'three';

/** What `syncWorld` keeps on an object: the position, turn and scale of its last compose with the matrix they gave (26 numbers), and its parent. */
interface Kept { _trs?: Float64Array; _in?: Object3D | null }

const OWN = Object3D.prototype.updateMatrixWorld;

/** Bring the world matrices under `o` up to date. `force`: the parent's world matrix changed. */
export function syncWorld(o: Object3D, force = false): void {
  // (a camera, a skinned mesh: its own update does more than the matrices)
  if (o.updateMatrixWorld !== OWN) { o.updateMatrixWorld(force); return; }
  const kept = o as Kept;
  if (o.matrixAutoUpdate) {
    const p = o.position, q = o.quaternion, s = o.scale;
    const e = o.matrix.elements;
    let k = kept._trs;
    if (!k) { k = kept._trs = new Float64Array(26); k[0] = NaN; }
    // the place it was composed from, and the matrix that came of it: three's own update may have composed another pose between two calls
    // (a part moved, measured and moved back)
    let same = k[0] === p.x && k[1] === p.y && k[2] === p.z && k[3] === q.x && k[4] === q.y && k[5] === q.z && k[6] === q.w && k[7] === s.x && k[8] === s.y && k[9] === s.z;
    for (let i = 0; same && i < 16; i++) same = k[10 + i] === e[i];
    if (!same) {
      o.updateMatrix(); // (it sets `matrixWorldNeedsUpdate`)
      k[0] = p.x; k[1] = p.y; k[2] = p.z; k[3] = q.x; k[4] = q.y; k[5] = q.z; k[6] = q.w; k[7] = s.x; k[8] = s.y; k[9] = s.z;
      for (let i = 0; i < 16; i++) k[10 + i] = e[i]!;
    }
  } else {
    // a matrix written by hand: no cheap way to see a change, so it counts as changed (as it does under three's own update)
    o.matrixWorldNeedsUpdate = true;
  }
  // (an object put under another parent stands elsewhere with the same position)
  if (kept._in !== o.parent) { kept._in = o.parent; o.matrixWorldNeedsUpdate = true; }
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const c = o.children;
  for (let i = 0; i < c.length; i++) syncWorld(c[i]!, force);
}
