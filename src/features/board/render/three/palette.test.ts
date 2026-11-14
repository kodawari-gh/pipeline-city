// The count of distinct base colours in the machine and the room (docs/3D_STYLE.md "Asset standard" §1, ASR9). Colours that the eye
// cannot tell apart must be one colour: uniformity first. The ceiling is today's count; a new colour needs a reason.
import { describe, expect, it } from 'vitest';
import { type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** Plain base colours under `root` (no map, no glow, not see-through), each with its count of materials. */
export function baseColours(root: Object3D): Map<number, number> {
  const seen = new Set<Material>(), out = new Map<number, number>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of [mesh.material].flat()) {
      const s = m as MeshStandardMaterial;
      if (seen.has(m) || !s.color || s.map || m.transparent) continue;
      seen.add(m);
      if (s.emissive && s.emissive.getHex() !== 0 && s.emissiveIntensity > 0) continue;
      out.set(s.color.getHex(), (out.get(s.color.getHex()) ?? 0) + 1);
    }
  });
  return out;
}

/** Pairs of colours nearer than `near` (sum of the channel differences, 0-765). */
export function nearPairs(colours: number[], near: number): [number, number, number][] {
  const d = (a: number, b: number) => Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
  const out: [number, number, number][] = [];
  for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) {
    const k = d(colours[i]!, colours[j]!);
    if (k <= near) out.push([colours[i]!, colours[j]!, k]);
  }
  return out.sort((a, b) => a[2] - b[2]);
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The ceilings of distinct base colours: the machine, the room. */
const CEILING = { machine: 79, room: 38 };

describe('the base colours', () => {
  it('stay under the ceiling', () => {
    const machine = baseColours(buildMachine(maxedSnapshot(), false).root), room = baseColours(new Room3D().root);
    for (const [name, set] of [['machine', machine], ['room', room]] as const) {
      const list = [...set.keys()].sort((a, b) => a - b), pairs = nearPairs(list, 12);
      console.log(`${name}: ${list.length} base colours, ${pairs.length} pairs nearer than 12`);
      if (env.PALETTE_DUMP === '1') {
        console.log(list.map((c) => `${hex(c)} x${set.get(c)}`).join('\n'));
        console.log(pairs.map(([a, b, k]) => `${hex(a)} ${hex(b)} ${k}`).join('\n'));
      }
      expect(list.length, name).toBeLessThanOrEqual(CEILING[name]);
    }
  }, 30_000);
});
