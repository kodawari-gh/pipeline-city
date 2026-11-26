// The router's shell, which the zoom fades away to show the board inside it (`setRouterShell`): its lights fade with it, its shadow goes.
import { Material, Mesh, MeshStandardMaterial } from 'three';
import { fadeTree } from '@/core/render/three/artlod';
import type { Group, Object3D, RoomParts } from './types';

/** The materials an object draws with: none, one, or a list. */
function materialsOf(o: Object3D): Material[] {
  const ms: unknown = 'material' in o ? o.material : undefined,
    list: unknown[] = Array.isArray(ms) ? ms : [ms];
  return list.filter((x): x is Material => x instanceof Material);
}

/** The shell's lit materials and how bright each is whole (after the merges: the materials the shell draws with). */
export function shellGlowsOf(shell: Object3D): { m: MeshStandardMaterial; i: number }[] {
  const out: { m: MeshStandardMaterial; i: number }[] = [],
    seen = new Set<Material>();
  shell.traverse((o) => {
    for (const s of materialsOf(o)) {
      if (
        !seen.has(s) &&
        s instanceof MeshStandardMaterial &&
        s.emissiveIntensity > 0 &&
        (s.emissive.r > 0 || s.emissive.g > 0 || s.emissive.b > 0)
      ) {
        seen.add(s);
        out.push({ m: s, i: s.emissiveIntensity });
      }
    }
  });
  return out;
}

/** A shell that is mostly gone casts no shadow on the board (a shadow map ignores opacity): its casters stop, and are kept. */
function hideShellShadows(room: RoomParts, sh: Group): void {
  room.shellCasters = [];
  sh.traverse((o) => {
    if (o instanceof Mesh && o.castShadow) {
      room.shellCasters.push(o);
      o.castShadow = false;
    }
  });
}

/** A shell that comes back casts again. */
function showShellShadows(room: RoomParts): void {
  for (const m of room.shellCasters) {
    m.castShadow = true;
  }
  room.shellCasters = [];
}

/**
 * The zoom takes the router's shell away to show the board inside it (`Machine3D.onRouterShell`): `a` is how much of the shell is left, 1 whole to 0 gone. Its jacks, its plinth and its feet stay.
 * A shell that is mostly gone casts no shadow on the board (a shadow map ignores opacity).
 */
export function setRouterShell(room: RoomParts, a: number): void {
  const sh = room.routerShell;
  if (!sh || a === room.routerAlpha) {
    return;
  }
  const was = room.routerAlpha;
  room.routerAlpha = a;
  fadeTree(sh, a);
  for (const g of room.shellGlows) {
    g.m.emissiveIntensity = g.i * a;
  }
  if (was > 0.5 && a <= 0.5) {
    hideShellShadows(room, sh);
  } else if (was <= 0.5 && a > 0.5) {
    showShellShadows(room);
  }
}
