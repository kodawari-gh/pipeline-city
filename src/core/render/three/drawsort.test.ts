import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Material } from 'three';
import { byProgram, rankMaterials, type DrawItem } from './drawsort';

const item = (id: number, material: Material, z = 0, renderOrder = 0, groupOrder = 0): DrawItem => ({ id, material, z, renderOrder, groupOrder });

/** How many times the program changes along the list. */
const switches = (list: DrawItem[], programOf: (m: Material) => number): number =>
  list.reduce((n, x, i) => n + (i > 0 && programOf(x.material) !== programOf(list[i - 1]!.material) ? 1 : 0), 0);

describe('byProgram', () => {
  it('puts the draws of one program in a row, then by material, then front to back', () => {
    // materials made in turn for two programs, as a model's builders do
    const mats = Array.from({ length: 8 }, (_, i) => (i % 2 ? new MeshBasicMaterial() : new MeshStandardMaterial()));
    const programOf = (m: Material): number => (m.type === 'MeshBasicMaterial' ? 7 : 3);
    const root = new Group();
    for (const m of mats) root.add(new Mesh(undefined, m));
    rankMaterials(root, programOf);
    const list = mats.flatMap((m, i) => [item(2 * i, m, 5), item(2 * i + 1, m, 2)]);
    const byId = [...list].sort((a, b) => a.material.id - b.material.id || a.z - b.z);
    expect(switches(byId, programOf)).toBe(7);
    list.sort(byProgram);
    expect(switches(list, programOf)).toBe(1);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!, b = list[i]!;
      if (programOf(a.material) === programOf(b.material)) expect(a.material.id).toBeLessThanOrEqual(b.material.id);
      if (a.material === b.material) expect(a.z).toBeLessThanOrEqual(b.z);
    }
  });

  it('keeps the group order and the render order first', () => {
    const a = new MeshStandardMaterial(), b = new MeshStandardMaterial();
    rankMaterials(new Group().add(new Mesh(undefined, a), new Mesh(undefined, b)), (m) => (m === a ? 9 : 1));
    expect(byProgram(item(1, a, 0, 0, 0), item(2, b, 0, 0, 1))).toBeLessThan(0);
    expect(byProgram(item(1, a, 0, 0), item(2, b, 0, 1))).toBeLessThan(0);
    expect(byProgram(item(1, a), item(2, b))).toBeGreaterThan(0);
  });

  it('sorts a material with no rank as three does, by its id', () => {
    const a = new MeshStandardMaterial(), b = new MeshStandardMaterial();
    expect(byProgram(item(1, a), item(2, b))).toBeLessThan(0);
    expect(byProgram(item(1, a, 4), item(2, a, 1))).toBeGreaterThan(0);
    expect(byProgram(item(1, a, 1), item(2, a, 1))).toBeLessThan(0);
  });

  it('ranks each material of a mesh with several', () => {
    const a = new MeshStandardMaterial(), b = new MeshBasicMaterial();
    rankMaterials(new Group().add(new Mesh(undefined, [a, b])), (m) => (m === a ? 2 : 5));
    expect(byProgram(item(1, b), item(2, a))).toBeGreaterThan(0);
  });
});
