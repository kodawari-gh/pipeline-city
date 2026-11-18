import { expect, it, vi } from 'vitest';
import type { Mesh } from 'three';
import { Room3D } from './room3d';

/** What the room asked `loadModel` for: the file, and the promise its model waits for. */
const asked = vi.hoisted(() => [] as { url: string; until?: Promise<unknown> }[]);
vi.mock('@/core/render/three/gltf', async (orig) => ({
  ...(await orig<typeof import('@/core/render/three/gltf')>()),
  loadModel: (url: string, until?: Promise<unknown>) => { asked.push({ url, until }); return new Promise(() => {}); },
}));

/** A room's picture in numbers: its meshes and their vertices. */
const census = (room: Room3D): { meshes: number; vertices: number } => {
  let meshes = 0, vertices = 0;
  room.root.traverse((o) => { const m = o as Mesh; if (!m.isMesh) return; meshes++; vertices += m.geometry.attributes.position?.count ?? 0; });
  return { meshes, vertices };
};
const macroTurn = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

// BOOT-01: the room holds the page for 1.2 s when built at once; `make` gives the page a turn between its slices
it('Room3D.make builds the same room a step at a time, and the late models join once it is built', async () => {
  const whole = new Room3D();
  await whole.ready; // (the bake's step and the palette merge, which `make`'s room takes too)
  asked.length = 0;
  const steps: [string, number][] = [];
  let slices = 0, open = false;
  const made = await Room3D.make(null, async (label, share) => {
    steps.push([label, share]);
    // (the mouse and the hoodie are asked for in the desk's step: they wait for the end of the build)
    await macroTurn();
    if (label === 'Shading the corners') {
      expect(asked.map((a) => a.url.split('/').pop()).sort()).toEqual(['hoodie.glb', 'mouse.glb']);
      expect(new Set(asked.map((a) => a.until)).size).toBe(1);
      void asked[0]!.until!.then(() => { open = true; });
    }
    await macroTurn();
    expect(open).toBe(false);
  }, async () => { slices++; });
  expect(steps.map(([label]) => label)).toEqual(['Setting the desk', 'Shading the corners', 'Tidying the room']);
  const shares = steps.map(([, share]) => share);
  expect(shares).toEqual([...shares].sort((a, b) => a - b));
  expect(shares.every((s) => s >= 0 && s <= 1)).toBe(true);
  // (a turn after the bench and after the bed, then one for each group of the occlusion)
  expect(slices).toBeGreaterThanOrEqual(4);
  await macroTurn();
  expect(open).toBe(true);
  await made.ready;
  // (the plants draw their leaves from a seed that runs on from one build to the next: a quad more or less. A section left out, or a merge not
  // made, is far more: 230 meshes in place of 147)
  const a = census(made), b = census(whole);
  expect(Math.abs(a.meshes - b.meshes)).toBeLessThanOrEqual(3);
  expect(Math.abs(a.vertices - b.vertices) / b.vertices).toBeLessThan(0.01);
}, 180000);
