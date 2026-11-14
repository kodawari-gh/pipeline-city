// The machine at the room overview (LPC5): every still mesh draws in a stand-in, so the draw count falls far below the board view's.
import { describe, expect, it } from 'vitest';
import { LOD_OVERVIEW, drawnMeshes } from '@/core/render/three/partlod';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** The ceiling of the machine's draws at the overview. It may only fall. */
const CEILING = 241;

describe('the machine at the room overview', () => {
  it('draws as stand-ins', () => {
    buildMachine(maxedSnapshot(), true, false); // (warm the caches: the next two builds compare)
    const t1 = Date.now(); buildMachine(maxedSnapshot(), true, false); const plain = Date.now() - t1;
    const t0 = Date.now(), machine = buildMachine(maxedSnapshot(), true, true), ms = `${Date.now() - t0} ms, ${plain} ms with no stand-ins`;
    const lod = machine.partLod!;
    lod.update(1);
    const near = drawnMeshes(machine.root);
    lod.update(LOD_OVERVIEW / 2);
    const far = drawnMeshes(machine.root);
    console.log(`machine: ${near} draws near, ${far} at the overview (build ${ms})`);
    expect(far).toBeLessThan(near);
    expect(far).toBeLessThanOrEqual(CEILING);
  }, 30_000);
});
