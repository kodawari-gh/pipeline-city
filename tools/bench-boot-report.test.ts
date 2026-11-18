import { describe, expect, it } from 'vitest';
import { describeVisit, grid, lists, middle, problems, sec, stageTable, table } from './bench-boot-report.mjs';

/** A boot as the page records it: the stages of board3d.ts, two tasks over 100 ms, two programs (one after the first draw) and two slow driver calls. */
function capture(over: Record<string, unknown> = {}) {
  return {
    marks: { firstPaint: 90, bootMenu: 1200, menuMounted: 1180, bootDone: 7200 },
    stages: [[300, 'Loading the 3D world'], [900, 'Building the world'], [2500, 'Furnishing the room'], [4100, 'Assembling the machine'], [4500, 'Preparing the shaders'], [6800, 'Lighting the room'], [7200, 'Ready']],
    long: [[1000, 300], [2600, 280], [5000, 60]],
    links: [[4600, 'MeshStandardMaterial', 'TONE_MAPPING=4'], [6900, 'ShaderMaterial', 'USE_MAP USE_SHADOWMAP']],
    slow: [[4700, 38], [4800, 12]],
    ...over,
  };
}

describe('describeVisit', () => {
  const d = describeVisit(capture());

  it('reads the marks, and the later of the menu class and the menu mount as the menu', () => {
    expect(d.firstPaint).toBe(90);
    expect(d.menu).toBe(1200);
    expect(d.bootDone).toBe(7200);
    expect(d.failed).toBe(false);
  });

  it('gives each stage its start and the time to the next one', () => {
    expect(d.stages[0]).toEqual({ label: 'Loading the 3D world', at: 300, took: 600 });
    expect(d.stages.at(-1)).toEqual({ label: 'Ready', at: 7200, took: null });
    expect(d.span).toBe(3200);
  });

  it('keeps only the first time a stage showed', () => {
    const again = describeVisit(capture({ stages: [[300, 'A'], [500, 'B'], [900, 'A'], [1200, 'C']] }));
    expect(again.stages.map((s) => [s.label, s.at, s.took])).toEqual([['A', 300, 200], ['B', 500, 700], ['C', 1200, null]]);
  });

  it('lists the programs linked at or after the first draw, with their defines', () => {
    expect(d.programs).toBe(2);
    expect(d.late).toEqual([{ at: 6900, name: 'ShaderMaterial', defs: 'USE_MAP USE_SHADOWMAP' }]);
    expect(describeVisit(capture({ links: [[6800, 'X', '']] })).late).toHaveLength(1);
  });

  it('totals the slow driver calls and names the stage each one waited in', () => {
    expect(d.slowCalls).toBe(2);
    expect(d.slowMs).toBe(50);
    expect(d.slow[0]).toEqual({ at: 4700, ms: 38, stage: 'Preparing the shaders' });
  });

  it('finds the longest task and the stage that showed at its end, and lists the tasks over 100 ms', () => {
    expect(d.longest).toEqual({ ms: 300, at: 1000, stage: 'Building the world' });
    expect(d.long).toEqual([{ at: 1000, ms: 300, stage: 'Building the world' }, { at: 2600, ms: 280, stage: 'Furnishing the room' }]);
  });

  it('gives null for what the visit never reached', () => {
    const none = describeVisit({});
    expect(none).toMatchObject({ firstPaint: null, menu: null, bootDone: null, span: null, late: null, longest: null, programs: 0, slowMs: 0 });
  });
});

describe('problems', () => {
  it('finds nothing wrong with a whole boot', () => {
    expect(problems(describeVisit(capture()))).toEqual([]);
  });

  it('says what is missing when a stage was renamed or the boot did not end', () => {
    const lost = problems(describeVisit(capture({ stages: [[300, 'Loading'], [900, 'Building the world']], marks: { firstPaint: 90, bootMenu: 1200 } })));
    expect(lost).toHaveLength(3);
    expect(lost.join('|')).toMatch(/did not finish.*Lighting the room.*Assembling the machine/);
  });

  it('says so when the boot screen failed', () => {
    expect(problems(describeVisit(capture({ marks: { bootMenu: 1200, bootFail: 3000 } })))[0]).toMatch(/failed/);
  });
});

describe('middle and sec', () => {
  it('takes the middle element, the lower one when the count is even, leaving out nulls', () => {
    expect(middle([3, 1, 2])).toBe(2);
    expect(middle([4, 1, 3, 2])).toBe(2);
    expect(middle([null, 5, undefined])).toBe(5);
    expect(middle([null])).toBeNull();
    expect(middle([{ t: 9 }, { t: 1 }, { t: 5 }], (o) => o.t)).toEqual({ t: 5 });
  });

  it('writes a time in ms under 100, in s with two decimals under 1 s, and with one above', () => {
    expect([sec(42), sec(280), sec(1234), sec(7200), sec(null)]).toEqual(['42 ms', '0.28 s', '1.2 s', '7.2 s', '-']);
  });
});

describe('the tables', () => {
  const cold = [7000, 7400].map((t) => describeVisit(capture({ marks: { firstPaint: 90, bootMenu: 1200, bootDone: t } })));
  const warm = [describeVisit(capture({ marks: { firstPaint: 80, bootMenu: 200, bootDone: 3800 } }))];

  it('aligns the cells of a grid and draws its rule', () => {
    expect(grid([['', 'A'], ['long label', 'x']])).toBe('|            | A |\n|------------|---|\n| long label | x |');
  });

  it('shows the middle run with the range, and one run alone', () => {
    const t = table(cold, warm);
    expect(t).toMatch(/\| Boot done\s+\| 7\.0 s \[7\.0 s to 7\.4 s\]\s+\| 3\.8 s\s+\|/);
    expect(t).toMatch(/\| The menu shows over the screen\s+\| 1\.2 s\s+\| 0\.20 s\s+\|/);
    expect(t).toMatch(/\| Building the world to Assembling the machine\s+\| 3\.2 s\s+\| 3\.2 s\s+\|/);
    expect(t).toMatch(/Slow driver calls \(getProgramInfoLog over 4 ms\), total\s+\| 50 ms \(2 calls\)/);
    expect(t).toMatch(/\| Programs linked at or after the first draw\s+\| 1\s+\| 1\s+\|/);
    expect(t).toMatch(/\| Longest main-thread task\s+\| 0\.30 s \(Building the world\)/);
  });

  it('shows - for a number a visit never reached', () => {
    expect(table([describeVisit({})], warm)).toMatch(/\| Boot done\s+\| -\s+\| 3\.8 s\s+\|/);
  });

  it('lists each stage once, in the order it started, with - where a kind missed it', () => {
    const odd = [describeVisit(capture({ stages: [[300, 'Loading the 3D world'], [900, 'Building the world'], [1500, 'Only warm']] }))];
    const t = stageTable(cold, odd);
    const names = t.split('\n').slice(2).map((l) => l.split('|')[1]!.trim());
    expect(names).toEqual(['Loading the 3D world', 'Building the world', 'Only warm', 'Furnishing the room', 'Assembling the machine', 'Preparing the shaders', 'Lighting the room', 'Ready']);
    expect(t).toMatch(/\| Only warm\s+\| -\s+\| -\s+\| 1\.5 s/);
  });

  it('lists the late programs of the middle visit, or says there were none', () => {
    expect(lists('Cold', cold)).toMatch(/programs at or after the first draw \(1\):\n\s+6\.9 s\s+ShaderMaterial\s+USE_MAP USE_SHADOWMAP/);
    expect(lists('Cold', cold)).toMatch(/slow driver calls[^\n]*\n\s+4\.7 s\s+38 ms\s+Preparing the shaders/);
    expect(lists('Cold', cold)).toMatch(/tasks over 100 ms[^\n]*\n\s+1\.0 s\s+0\.30 s\s+Building the world/);
    const clean = [describeVisit(capture({ links: [[4600, 'MeshStandardMaterial', '']], slow: [], long: [[1000, 60]] }))];
    expect(lists('Warm', clean)).toBe('Warm: no program linked at or after the first draw.');
    expect(lists('Warm', [describeVisit({})])).toBe('Warm: no visit finished.');
  });
});
