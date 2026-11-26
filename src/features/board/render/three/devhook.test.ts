// The dev-only camera hook (`jumpRaw`, `frameSpec`, `unclamped`) must not reach the prod build. Reads source text only (node, no DOM).
// The world is split over `world/` (#124): the files that read or write `unclamped` are read as one text, the hook's own file last.
import { describe, expect, it, vi } from 'vitest';

/** The part of `node:fs` this test reads the source with. */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const nodeUrl = await vi.importActual<NodeUrl>('node:url');
const FILES = ['view.ts', 'flights.ts', 'frameView.ts', 'devhook.ts'];
const pathOf = (f: string): string => nodeUrl.fileURLToPath(new URL(`world/${f}`, import.meta.url));
const text: string = FILES.map((f) => fs.readFileSync(pathOf(f), 'utf8')).join('\n');

// The code as statements: comments dropped, whitespace collapsed, cut at `;`, `{` and `}`. The formatter may wrap a line anywhere; a statement stays whole.
const statements: string[] = text
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
  .replaceAll(/\/\/.*$/gmu, '')
  .replaceAll(/\s+/gu, ' ')
  .split(/[;{}]/u)
  .map((s) => s.trim());

const DEV_GATE = 'if (import.meta.env.DEV) {';
const BOARD_OBJECT = '.__board = {';

function assert_unclamped_is_read_only_where_the_DEV_gate_makes(): void {
  // every use of `unclamped` is either its declaration, a write, or one of three reads, each behind `import.meta.env.DEV &&`: the test in inRoom,
  // the one in the overview, and the frame loop's intro branch (which negates the whole DEV-and-unclamped test)
  const reads = statements.filter(
    (s) => /\bunclamped\b/u.test(s) && !/^(?:s\.)?(?:cam\.)?unclamped = (?:true|false)$/u.test(s),
  );
  expect(reads).toStrictEqual([
    'export const inRoom = (s: Scope, v: OrbitView, restore = true): OrbitView => import.meta.env.DEV && s.cam.unclamped ? v : keepInside(v, eyeRoom(), keeping(s, restore))',
    'return import.meta.env.DEV && s.cam.unclamped ? v : keepWhole(v, eyeRoom(), keeping(s, true))',
    'view = intro && atOverview && !(import.meta.env.DEV && cam.unclamped) ? keepWhole(eased, eyeRoom(), keeping(s, false), 0.6, goal.y) : inRoom(s, eased, false)',
  ]);
  // (whatever the lines say, each read has the DEV test in front of it: the bundler folds it to false in prod and the read goes)
  for (const l of reads) {
    expect(l, 'a read of unclamped without the DEV test').toMatch(
      /import\.meta\.env\.DEV && (?:s\.)?(?:cam\.)?unclamped/u,
    );
  }
}

function assert_the_frame_loop_eases_the_view_once_and_only_its(): void {
  // the eased view goes through `inRoom`, or, on the game's first flight to the overview (`intro`), through `keepWhole` (the desk's shadow)
  const eases = statements.filter((s) => s.includes('stepView(view, goal, dt)'));
  expect(eases).toStrictEqual(['const eased = stepView(view, goal, dt)']);
  const sets = statements.filter((s) => s.startsWith('view = ') && s.includes('eased'));
  expect(sets).toStrictEqual([
    'view = intro && atOverview && !(import.meta.env.DEV && cam.unclamped) ? keepWhole(eased, eyeRoom(), keeping(s, false), 0.6, goal.y) : inRoom(s, eased, false)',
  ]);
}

describe('the dev camera hook stays behind import.meta.env.DEV', () => {
  const devAt = text.indexOf(DEV_GATE);

  it('the world has one DEV gate, and the __board object sits inside it', () => {
    expect(text.split(DEV_GATE).length - 1).toBe(1);
    expect(text.indexOf(BOARD_OBJECT)).toBeGreaterThan(devAt);
  });

  it('jumpRaw and frameSpec are only defined or assigned inside the DEV block', () => {
    for (const name of ['jumpRaw', 'frameSpec']) {
      const hits = [...text.matchAll(new RegExp(`\\b${name}\\b`, 'gu'))].map((m) => m.index);
      expect(hits.length).toBeGreaterThan(0);
      for (const at of hits) {
        expect(at, `${name} at ${at}`).toBeGreaterThan(devAt);
      }
    }
    // no assignment of either name on any object, anywhere
    expect(text).not.toMatch(/\.(?:jumpRaw|frameSpec)\s*=[^=]/u);
    // the only keys of those names are on the __board object (its members, after its opening)
    const boardAt = text.indexOf(BOARD_OBJECT);
    expect(text.slice(boardAt)).toMatch(/\n\s*jumpRaw: \(v: OrbitView\) => \{?\s*jumpRaw\(v\);?\s*\}?,/u);
    expect(text.slice(boardAt)).toMatch(/\n\s*frameSpec: \(key: string/u);
  });

  it('the frame loop eases the view once, and only its intro branch reads unclamped, behind the DEV gate', () => {
    expect.hasAssertions();
    assert_the_frame_loop_eases_the_view_once_and_only_its();
  });

  it('unclamped is read only where the DEV gate makes it dead code in prod', () => {
    expect.hasAssertions();
    assert_unclamped_is_read_only_where_the_DEV_gate_makes();
  });
});
