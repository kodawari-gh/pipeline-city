import { describe, expect, it } from 'vitest';
import { AirSim } from './build';
import type { V3 } from './grid';
import type { AirPlan, PlanFan, PlanVent } from './plan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MIN: V3 = [0, 0, 0],
  MAX: V3 = [8000, 6000, 4000];
const plan = (o: Partial<AirPlan> = {}): AirPlan => ({
  key: 'k',
  min: MIN,
  max: MAX,
  boxes: [],
  vents: [],
  fans: [],
  bodies: [],
  ...o,
});
/** A fan in the east wall blowing in (a front fan), and one in the west wall drawing out (the rear). */
const intake: Extract<PlanFan, { kind: 'wall' }> = {
  id: 'f0',
  bank: 'case:front0',
  kind: 'wall',
  wall: 1,
  centre: [0, 3000, 2000],
  r: 1100,
  into: true,
  q: 1e11,
};
const exhaust: Extract<PlanFan, { kind: 'wall' }> = {
  id: 'f1',
  bank: 'case:rear',
  kind: 'wall',
  wall: 0,
  centre: [0, 3000, 2000],
  r: 1100,
  into: false,
  q: 1e11,
};
const grille: PlanVent = { id: 'rear', wall: 0, centre: [0, 3000, 2000], shape: { r: 1300 }, open: 0.5 };

const solved = (p: AirPlan): AirSim => {
  const s = new AirSim(p, 3000);
  for (let i = 0; i < 400 && !s.run(50); i++) {
    /* settle */
  }
  expect(s.field.ready).toBe(true);
  return s;
};

function assert_air_comes_in_at_the_intake_fan_only_and_leaves_a(): void {
  const s = solved(plan({ fans: [intake, exhaust] }));
  s.levels(() => 1);
  expect(s.inflow).toBeGreaterThan(0);
  const g = s.grid,
    o: V3 = [0, 0, 0];
  for (let i = 0; i < 40; i++) {
    const hit = must(s.inlet(i / 40));
    expect(hit.wall).toBe(1);
    g.centre(hit.c, o);
    // (the fan's disc, grown by a cell)
    expect(Math.hypot(o[1] - 3000, o[2] - 2000)).toBeLessThan(1100 + 2 * Math.max(g.h[1], g.h[2]));
    expect(o[0]).toBeGreaterThan(MAX[0] - 2 * g.h[0]);
  }
  let out = 0,
    wrong = 0;
  for (let c = 0; c < g.cells; c++) {
    if (s.exits[c] === 1) {
      out++;
    } else if ((s.exits[c] ?? 0) !== 0) {
      wrong++;
    }
  }
  expect(out).toBeGreaterThan(0);
  expect(wrong).toBe(0);
}

function assert_with_no_exhaust_but_a_grille_the_intake_still_fi(): void {
  const s = solved(plan({ fans: [intake], vents: [grille] }));
  s.levels(() => 1);
  expect(s.inflow).toBeGreaterThan(0);
  let out = 0;
  for (let c = 0; c < s.grid.cells; c++) {
    if (s.exits[c] === 1) {
      out++;
    }
  }
  expect(out).toBeGreaterThan(0);
  // the air comes in at the fan, not at a grille that is blown out of
  for (let i = 0; i < 20; i++) {
    expect(must(s.inlet(i / 20)).wall).toBe(1);
  }
}

function assert_an_exhaust_fan_alone_draws_air_in_through_the_gr(): void {
  const s = solved(plan({ fans: [{ ...exhaust, wall: 1, centre: [0, 3000, 2000] }], vents: [{ ...grille, wall: 0 }] }));
  s.levels(() => 1);
  expect(s.inflow).toBeGreaterThan(0);
  for (let i = 0; i < 20; i++) {
    expect(must(s.inlet(i / 20)).wall).toBe(0);
  }
}

function assert_the_fans_speeds_are_set_by_bank_and_the_field_is(): void {
  const s = solved(plan({ fans: [intake, exhaust] }));
  expect(s.banks).toStrictEqual(['case:front0', 'case:rear']);
  expect(s.levels(() => 1)).toBe(true);
  expect(s.levels(() => 1)).toBe(false);
  const a = s.inflow;
  expect(s.levels((b) => (b === 'case:front0' ? 0.5 : 1))).toBe(true);
  expect(s.inflow).toBeLessThan(a);
  expect(s.inflow).toBeGreaterThan(0);
}

describe('the air of a machine', () => {
  it('air comes in at the intake fan only, and leaves at the exhaust fan', () => {
    expect.hasAssertions();
    assert_air_comes_in_at_the_intake_fan_only_and_leaves_a();
  });

  it('a fan that does not turn brings no air, and nothing is born', () => {
    const s = solved(plan({ fans: [intake, exhaust] }));
    s.levels(() => 0);
    expect(s.inflow).toBe(0);
    expect(s.inlet(0.5)).toBeNull();
  });

  it('with no exhaust but a grille the intake still fills the case, and the grille is where the air leaves', () => {
    expect.hasAssertions();
    assert_with_no_exhaust_but_a_grille_the_intake_still_fi();
  });

  it('an exhaust fan alone draws air in through the grille: the grille is then an inlet', () => {
    expect.hasAssertions();
    assert_an_exhaust_fan_alone_draws_air_in_through_the_gr();
  });

  it("the fans' speeds are set by bank, and the field is mixed again only when one changes", () => {
    expect.hasAssertions();
    assert_the_fans_speeds_are_set_by_bank_and_the_field_is();
  });

  it('a fan whose cells are all solid (a part fills the wall it stands on) is left out', () => {
    const wall = { id: 'w', min: [6800, 0, 0] as V3, max: [8000, 6000, 4000] as V3, k: [0, 0, 0] as V3 };
    const s = solved(plan({ boxes: [wall], fans: [intake, exhaust] }));
    expect(s.banks).toStrictEqual(['case:rear']);
  });
});
