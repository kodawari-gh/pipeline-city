import { assert, describe, expect, it } from 'vitest';
import { CODE_SOURCE, HIGH_LEVEL, mixShares, OP_CLASSES, profileOf, reliance, spriteOf } from './jobcode';
import { JOB_DEX } from './jobdex';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** An almanac entry the player can get as a key: built, and a program rather than a contract. */
const playable = (x: (typeof JOB_DEX)[number]): boolean => x.planned !== true && x.contract !== true;

/** What the job `id` leans on, at this scale. */
function relianceOf(id: string, scale = 1) {
  const codeSourceItem = CODE_SOURCE[id];
  assert.exists(codeSourceItem);
  return reliance(profileOf(codeSourceItem.template, scale));
}

/** The classes of the cells of the job's picture, in order: its look. */
function spriteSig(id: string): string {
  const codeSourceItem = CODE_SOURCE[id];
  assert.exists(codeSourceItem);
  assert.exists(codeSourceItem.scales[0]);
  const sp = spriteOf(profileOf(codeSourceItem.template, codeSourceItem.scales[0]));
  return sp.cells.map((c) => c.cls[0]).join('');
}

describe('the code view of a job', () => {
  it('every playable almanac entry has a program to read and a C++ and a Python version', () => {
    for (const e of JOB_DEX.filter((x) => playable(x))) {
      expect(CODE_SOURCE[e.id], `for ${e.id}`).toBeDefined();
      const highLevelItem = HIGH_LEVEL[e.id];
      assert.exists(highLevelItem);
      expect(highLevelItem.cpp.length, `for ${e.id}`).toBeGreaterThan(80);
      const highLevelItem2 = HIGH_LEVEL[e.id];
      assert.exists(highLevelItem2);
      expect(highLevelItem2.python.length, `for ${e.id}`).toBeGreaterThan(60);
    }
  });

  it('runs the real program: it halts, shows the expected text, and the counts add up', () => {
    for (const [id, src] of Object.entries(CODE_SOURCE)) {
      assert.exists(src.scales[0]);
      const p = profileOf(src.template, src.scales[0]);
      expect(p.steps, `for ${id}`).toBeGreaterThan(10);
      expect(
        OP_CLASSES.reduce((n, c) => n + p.mix[c], 0),
        `for ${id}`,
      ).toBe(p.steps);
      expect(
        p.lines.reduce((n, l) => n + l.count, 0),
        `for ${id}`,
      ).toBe(p.steps);
      expect(p.mix.sys, `for ${id}`).toBe(1); // the one ecall
      expect(p.display.length, `for ${id}`).toBeGreaterThan(3);
      expect(p.codeWords + p.dataWords, `for ${id}`).toBe(p.lines.length);
      expect(
        p.lines.some((l) => l.labels.includes('main')),
        `for ${id}`,
      ).toBe(true);
    }
  });

  it('tells the jobs apart by what they lean on', () => {
    const r = relianceOf;
    expect(profileOf('cli.calc', 2).mix.mul).toBeGreaterThan(profileOf('cli.log', 2).mix.mul);
    expect(r('calc', 4).memory).toBeLessThan(r('db').memory); // a multiply chain against a table of lookups
    expect(r('scan', 4).memory).toBeGreaterThan(r('calc', 4).memory);
    expect(mixShares(profileOf('db.index', 1)).ld).toBeGreaterThan(0.03);
    const db = profileOf('db.index', 1);
    expect(db.pages).toBeGreaterThanOrEqual(128); // the whole 32K table, one page per record
    expect(profileOf('db.index', 4).pages).toBeGreaterThan(db.pages * 3);
    expect(db.taken).toBeGreaterThan(0);
  });
});

describe('the picture of a job', () => {
  it('has a cell for every word that ran, in rows of the stated width, with the busiest words brightest', () => {
    for (const [id, src] of Object.entries(CODE_SOURCE)) {
      const p = profileOf(src.template, must(src.scales[0])),
        sp = spriteOf(p);
      expect(sp.cells.length, `for ${id}`).toBeGreaterThan(5);
      expect(sp.cells.length, `for ${id}`).toBeLessThanOrEqual(sp.cols * sp.rows);
      expect(sp.cols * (sp.rows - 1), `for ${id}`).toBeLessThan(sp.cells.length);
      for (const c of sp.cells) {
        expect(c.heat).toBeGreaterThanOrEqual(0);
        expect(c.heat).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...sp.cells.map((c) => c.heat)), `for ${id}`).toBe(1);
    }
  });

  it('looks different for different jobs', () => {
    const sigs = ['log', 'calc', 'scan', 'db', 'secure', 'mandel'].map((id) => spriteSig(id));
    expect(new Set(sigs).size).toBe(6);
  });
});
