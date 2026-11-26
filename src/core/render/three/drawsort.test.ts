import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type * as threeTypes from 'three';
import { byProgram, rankMaterials } from './drawsort';
import type * as drawsortTypes from './drawsort';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Where a draw stands among the others: its depth, its render order and its group's order (0 when not given). */
interface Order {
  z?: number;
  renderOrder?: number;
  groupOrder?: number;
}
const item = (
  id: number,
  material: threeTypes.Material,
  { z = 0, renderOrder = 0, groupOrder = 0 }: Order = {},
): drawsortTypes.DrawItem => ({
  id,
  material,
  z,
  renderOrder,
  groupOrder,
});

/** How many times the program changes along the list. */
const switches = (list: drawsortTypes.DrawItem[], programOf: (m: threeTypes.Material) => number): number =>
  list.reduce((n, x, i) => n + (i > 0 && programOf(x.material) !== programOf(must(list[i - 1]).material) ? 1 : 0), 0);

/** The two programs of the first test: one for the Basics, one for the rest. */
const programOf = (m: threeTypes.Material): number => (m.type === 'MeshBasicMaterial' ? 7 : 3);
/** Materials made in turn for the two programs. */
const madeInTurn = (i: number) => (i % 2 === 1 ? new MeshBasicMaterial() : new MeshStandardMaterial());
/** Three's own order without the ranks: by material id, then front to back. */
const byIdThenZ = (a: drawsortTypes.DrawItem, b: drawsortTypes.DrawItem) => a.material.id - b.material.id || a.z - b.z;
/** A program lookup that gives `yes` for the material `a` and `no` for any other. */
const programIf = (a: threeTypes.Material, yes: number, no: number) => (m: threeTypes.Material) => (m === a ? yes : no);
/** Each draw of the list with the one before it. */
const pairsOf = (list: drawsortTypes.DrawItem[]) => list.slice(1).map((b, i) => [must(list[i]), b] as const);

describe('byProgram', () => {
  it('puts the draws of one program in a row, then by material, then front to back', () => {
    // materials made in turn for two programs, as a model's builders do
    const mats = Array.from({ length: 8 }, (_, i) => madeInTurn(i));
    const root = new Group();
    for (const m of mats) {
      root.add(new Mesh(undefined, m));
    }
    rankMaterials(root, programOf);
    const list = mats.flatMap((m, i) => [item(2 * i, m, { z: 5 }), item(2 * i + 1, m, { z: 2 })]);
    const byId = list.toSorted(byIdThenZ);
    expect(switches(byId, programOf)).toBe(7);
    list.sort(byProgram);
    expect(switches(list, programOf)).toBe(1);
    const pairs = pairsOf(list);
    for (const [a, b] of pairs.filter(([x, y]) => programOf(x.material) === programOf(y.material))) {
      expect(a.material.id).toBeLessThanOrEqual(b.material.id);
    }
    for (const [a, b] of pairs.filter(([x, y]) => x.material === y.material)) {
      expect(a.z).toBeLessThanOrEqual(b.z);
    }
  });

  it('keeps the group order and the render order first', () => {
    const a = new MeshStandardMaterial(),
      b = new MeshStandardMaterial();
    rankMaterials(new Group().add(new Mesh(undefined, a), new Mesh(undefined, b)), programIf(a, 9, 1));
    expect(byProgram(item(1, a, { groupOrder: 0 }), item(2, b, { groupOrder: 1 }))).toBeLessThan(0);
    expect(byProgram(item(1, a, { renderOrder: 0 }), item(2, b, { renderOrder: 1 }))).toBeLessThan(0);
    expect(byProgram(item(1, a), item(2, b))).toBeGreaterThan(0);
  });

  it('sorts a material with no rank as three does, by its id', () => {
    const a = new MeshStandardMaterial(),
      b = new MeshStandardMaterial();
    expect(byProgram(item(1, a), item(2, b))).toBeLessThan(0);
    expect(byProgram(item(1, a, { z: 4 }), item(2, a, { z: 1 }))).toBeGreaterThan(0);
    expect(byProgram(item(1, a, { z: 1 }), item(2, a, { z: 1 }))).toBeLessThan(0);
  });

  it('ranks each material of a mesh with several', () => {
    const a = new MeshStandardMaterial(),
      b = new MeshBasicMaterial();
    rankMaterials(new Group().add(new Mesh(undefined, [a, b])), programIf(a, 2, 5));
    expect(byProgram(item(1, b), item(2, a))).toBeGreaterThan(0);
  });
});
