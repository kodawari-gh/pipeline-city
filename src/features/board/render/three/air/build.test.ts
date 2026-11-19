import { describe, expect, it } from 'vitest';
import { AirSim } from './build';
import type { V3 } from './grid';
import type { AirPlan, PlanFan, PlanVent } from './plan';

const MIN: V3 = [0, 0, 0], MAX: V3 = [8000, 6000, 4000];
const plan = (o: Partial<AirPlan> = {}): AirPlan => ({ key: 'k', min: MIN, max: MAX, boxes: [], vents: [], fans: [], bodies: [], ...o });
/** A fan in the east wall blowing in (a front fan), and one in the west wall drawing out (the rear). */
const intake: PlanFan = { id: 'f0', bank: 'case:front0', kind: 'wall', wall: 1, centre: [0, 3000, 2000], r: 1100, into: true, q: 1e11 };
const exhaust: PlanFan = { id: 'f1', bank: 'case:rear', kind: 'wall', wall: 0, centre: [0, 3000, 2000], r: 1100, into: false, q: 1e11 };
const grille: PlanVent = { id: 'rear', wall: 0, centre: [0, 3000, 2000], shape: { r: 1300 }, open: 0.5 };

const solved = (p: AirPlan): AirSim => {
  const s = new AirSim(p, 3000);
  for (let i = 0; i < 400 && !s.run(50); i++);
  expect(s.field.ready).toBe(true);
  return s;
};

describe('the air of a machine', () => {
  it('air comes in at the intake fan only, and leaves at the exhaust fan', () => {
    const s = solved(plan({ fans: [intake, exhaust] }));
    s.levels(() => 1);
    expect(s.inflow).toBeGreaterThan(0);
    const g = s.grid, o: V3 = [0, 0, 0];
    for (let i = 0; i < 40; i++) {
      const hit = s.inlet(i / 40)!;
      expect(hit.wall).toBe(1);
      g.centre(hit.c, o);
      // (the fan's disc, grown by a cell)
      expect(Math.hypot(o[1] - 3000, o[2] - 2000)).toBeLessThan(1100 + 2 * Math.max(g.h[1]!, g.h[2]!));
      expect(o[0]).toBeGreaterThan(MAX[0] - 2 * g.h[0]!);
    }
    let out = 0, wrong = 0;
    for (let c = 0; c < g.cells; c++) { if (s.exits[c] === 1) out++; else if (s.exits[c]) wrong++; }
    expect(out).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  });

  it('a fan that does not turn brings no air, and nothing is born', () => {
    const s = solved(plan({ fans: [intake, exhaust] }));
    s.levels(() => 0);
    expect(s.inflow).toBe(0);
    expect(s.inlet(0.5)).toBeNull();
  });

  it('with no exhaust but a grille the intake still fills the case, and the grille is where the air leaves', () => {
    const s = solved(plan({ fans: [intake], vents: [grille] }));
    s.levels(() => 1);
    expect(s.inflow).toBeGreaterThan(0);
    let out = 0;
    for (let c = 0; c < s.grid.cells; c++) if (s.exits[c] === 1) out++;
    expect(out).toBeGreaterThan(0);
    // the air comes in at the fan, not at a grille that is blown out of
    for (let i = 0; i < 20; i++) expect(s.inlet(i / 20)!.wall).toBe(1);
  });

  it('an exhaust fan alone draws air in through the grille: the grille is then an inlet', () => {
    const s = solved(plan({ fans: [{ ...exhaust, wall: 1, centre: [0, 3000, 2000] }], vents: [{ ...grille, wall: 0 }] }));
    s.levels(() => 1);
    expect(s.inflow).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) expect(s.inlet(i / 20)!.wall).toBe(0);
  });

  it('the fans\' speeds are set by bank, and the field is mixed again only when one changes', () => {
    const s = solved(plan({ fans: [intake, exhaust] }));
    expect(s.banks).toEqual(['case:front0', 'case:rear']);
    expect(s.levels(() => 1)).toBe(true);
    expect(s.levels(() => 1)).toBe(false);
    const a = s.inflow;
    expect(s.levels((b) => (b === 'case:front0' ? 0.5 : 1))).toBe(true);
    expect(s.inflow).toBeLessThan(a);
    expect(s.inflow).toBeGreaterThan(0);
  });

  it('a fan whose cells are all solid (a part fills the wall it stands on) is left out', () => {
    const wall = { id: 'w', min: [6800, 0, 0] as V3, max: [8000, 6000, 4000] as V3, k: [0, 0, 0] as V3 };
    const s = solved(plan({ boxes: [wall], fans: [intake, exhaust] }));
    expect(s.banks).toEqual(['case:rear']);
  });
});
