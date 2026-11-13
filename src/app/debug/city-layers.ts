/**
 * The `?debug` overlay's city layers: each one off or on, and the city's stats. Only the overlay (`overlay.ts`, loaded by `whenDebug`) and the
 * tests import this; the city's view (`outside/view.ts`) does not, so without `?debug` these never ship in the board's chunk.
 */
import type { InstancedMesh, Mesh, Object3D } from 'three';
import { drawn } from '@/features/room/render/three/outside/sweep';
import { EVERY, type OutsideView } from '@/features/room/render/three/outside/view';

/** The layer of what the `?debug` overlay hides (no camera draws it). */
const HIDDEN_LAYER = 30;

/**
 * Turns one layer of the city off or on (never saved; the overlay's Auto turns all on). `lights`: the lamps' light, the windows, the signs'
 * light, the glow and every emissive at 0. `buildings`: the streets, the buildings, the land and the trees. `freeze`: the clock, so the traffic,
 * the leaves, the clouds and the steam stand. `cars`: the cars and the signals. `sky`, `steam`, `glow` (the glow chain), `mirror` (the room in the
 * glass), `flat` (the picture at 1 pixel per screen pixel, not `SUPER`). With none off, the view is as it is without `?debug`.
 */
export function debugLayer(v: OutsideView, layer: string, off: boolean): void {
  if (off) v.off.add(layer); else v.off.delete(layer);
  // (the hour's light is set again at the next `frame`)
  if (layer === 'lights' || layer === 'glow' || layer === 'mirror') v.key = -1;
  const hide = (list: Object3D[] | undefined) => list?.forEach((o) => o.traverse((n) => {
    // (layers, not `visible`: a sweep sets that on each cut)
    if (off) n.layers.set(HIDDEN_LAYER); else n.layers.set(0);
  }));
  if (layer === 'lights') {
    for (const l of v.lamps) l.visible = !off;
    hide(v.parts.signs);
  } else if (layer === 'buildings') hide(v.parts.buildings);
  else if (layer === 'cars') hide(v.parts.cars);
  else if (layer === 'sky') hide(v.parts.sky);
  else if (layer === 'steam') hide(v.parts.steam);
  v.age = EVERY;
}

/** What the city's own picture draws, by its meshes now (the triangles from their draw ranges and instances; the calls a mesh each, and a group of a mesh more). Not the room's. */
export function debugStats(v: OutsideView): { tris: number; calls: number } {
  let tris = 0, calls = 0;
  v.scene.traverseVisible((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !o.layers.isEnabled(0)) return;
    const g = m.geometry, { start, count } = g.drawRange, n = Math.max(0, Math.min(count, drawn(g) - start)) / 3;
    tris += n * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
    calls += Array.isArray(m.material) ? Math.max(1, g.groups.length) : 1;
  });
  return { tris: Math.round(tris), calls };
}
