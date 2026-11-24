// The crash state (ticket #45): when the sim throws, the crash panel says what happened in one plain sentence and gives a way forward
// (copy, download, close). It is never a dead end. Written before the coder's changes: the way-forward rules fail until they land.
// The node run has no DOM, so CrashPanel is called as a plain function and its element tree is walked (the Hud.test.ts pattern).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crash } from '@/app/store';
import type { CrashReport } from '@/worker/crash';

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => unknown) => {
    hooks.effects.push(fn);
  },
  useRef: () => ({ current: null }),
  useState: (v: unknown) => [v, () => {}],
}));

type VEl = { type: unknown; props: Record<string, any> };
type Node = VEl | string | number | boolean | null | undefined | Node[];

/** Every element in the tree, depth first. */
function all(v: Node): VEl[] {
  if (Array.isArray(v)) return v.flatMap(all);
  if (v && typeof v === 'object' && 'props' in v) return [v, ...all(v.props.children as Node)];
  return [];
}
/** The text a node shows: its strings and numbers, in order. */
function text(v: Node): string {
  if (Array.isArray(v)) return v.map(text).join('');
  if (v && typeof v === 'object' && 'props' in v) return text(v.props.children as Node);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}
const buttons = (tree: Node) => all(tree).filter((el) => el.type === 'button');

const report = {
  version: 1,
  headline: 'The simulation stopped on a bad jump at tick 412.',
  text: 'CRASH\nthe simulation stopped on a bad jump at tick 412.',
  error: { name: 'Error', message: 'bad jump' },
  at: '2026-01-01T00:00:00.000Z',
  tick: 412,
  phase: 'run',
  cycles: 1000,
  fault: { pc: null, where: 'none' },
  faultCore: 0,
  tpm: null,
  os: null,
  machine: null,
  parts: [],
  cores: [],
  jobs: [],
  keys: { plugged: null, spool: [], tray: 0 },
  regions: [],
  windows: [],
  events: [],
  save: null,
} as unknown as CrashReport;

let CrashPanel: () => Node;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  hooks.effects = [];
  ({ CrashPanel } = (await import('@/core/ui/panels/CrashPanel')) as unknown as { CrashPanel: () => Node });
  const store = await import('@/app/store');
  store.crash.value = null;
});

describe('the crash state', () => {
  it('shows nothing when the sim has not crashed', () => {
    expect(CrashPanel()).toBeNull();
  });

  it('says what happened in one plain sentence', async () => {
    const store = await import('@/app/store');
    store.crash.value = report;
    expect(text(CrashPanel())).toContain(report.headline);
  });

  it('gives a way forward: copy, download and close are each a button', async () => {
    const store = await import('@/app/store');
    store.crash.value = report;
    const labels = buttons(CrashPanel()).map((b) => text(b.props.children as Node).trim());
    expect(labels).toEqual(expect.arrayContaining(['Copy report', 'Download report', 'Close']));
  });

  it('Close clears the crash and the panel goes away (no dead end)', async () => {
    const store = await import('@/app/store');
    store.crash.value = report;
    const close = buttons(CrashPanel()).find((b) => text(b.props.children as Node).trim() === 'Close');
    expect(close?.props.onClick).toBeTypeOf('function');
    close!.props.onClick();
    expect(store.crash.value).toBeNull();
    expect(CrashPanel()).toBeNull();
  });
});
