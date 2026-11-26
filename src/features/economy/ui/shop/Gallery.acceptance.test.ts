// Gallery acceptance (ticket #42; SPEC §5.8, ACCEPTANCE §3 "08 Gallery"). One test per acceptance criterion that the node test run can reach.
// The node run has no DOM: Gallery is called as a function, its tree is walked (function components are called inline, refs get a fake element
// with a `getBoundingClientRect`), and the hooks are a small stand-in (as in Settings.test.ts). Layout assumptions, pinned here on purpose:
//   - the K1 bracket box is the element with class `gal-brackets` (1920 x 1080 desktop: left 380, top 140, right 1500, bottom 900, SPEC §5.8);
//   - the stage the viewer fills is the element with class `gal-main` or `showcase-host`, at 0, 0, 1920 x 1080.
// Tests that need a real browser or a screenshot are in tools/gallery.acceptance.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/core/render/three/viewer';
import { closeSettings, galleryOpen, settingsOpen } from '@/core/ui/state';
import { Gallery } from './Gallery';
import { galleryGroups, hasModel, SHOP_ORDER } from './shopdata';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The part of `node:fs` this test reads with (no @types/node in this project; tests only). */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');
const srcFile = (rel: string): string => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The viewer the Gallery mounts, every method a mock. */
type FakeViewer = { [K in keyof Viewer]: ReturnType<typeof vi.fn<Viewer[K]>> };

/** A state updater: a function of the previous value. */
const isUpdater = (v: unknown): v is (prev: unknown) => unknown => typeof v === 'function';

const rt = vi.hoisted(() => ({
  at: 0,
  slots: [] as unknown[],
  deps: [] as (readonly unknown[] | undefined)[],
  pending: [] as (() => unknown)[],
}));
const rig: { viewer: FakeViewer | null } = vi.hoisted(() => ({ viewer: null }));

vi.mock('preact/hooks', () => ({
  useRef: (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots)) {
      rt.slots[k] = { current: init };
    }
    return rt.slots[k];
  },
  useState: (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots)) {
      rt.slots[k] = init;
    }
    const set = (v: unknown) => {
      rt.slots[k] = isUpdater(v) ? v(rt.slots[k]) : v;
    };
    return [rt.slots[k], set];
  },
  useMemo: (fn: () => unknown) => {
    rt.at++;
    return fn();
  },
  useCallback: (fn: unknown) => {
    rt.at++;
    return fn;
  },
  useEffect: (fn: () => unknown, deps?: readonly unknown[]) => {
    const k = rt.at++;
    if (effectChanged(rt.deps[k], deps)) {
      rt.deps[k] = deps;
      rt.pending.push(fn);
    }
  },
  useLayoutEffect: (fn: () => unknown, deps?: readonly unknown[]) => {
    const k = rt.at++;
    if (effectChanged(rt.deps[k], deps)) {
      rt.deps[k] = deps;
      rt.pending.push(fn);
    }
  },
}));

vi.mock(import('@/core/render/three/viewer'), () => ({
  mountViewer: () => {
    const viewer: FakeViewer = {
      setInsets: vi.fn<Viewer['setInsets']>(),
      resize: vi.fn<Viewer['resize']>(),
      reset: vi.fn<Viewer['reset']>(),
      setAutoTurn: vi.fn<Viewer['setAutoTurn']>(),
      setObject: vi.fn<Viewer['setObject']>(),
      dispose: vi.fn<Viewer['dispose']>(),
    };
    rig.viewer = viewer;
    return viewer;
  },
}));
vi.mock(import('@/features/board/render/three/showcase'), async () => {
  const { Object3D } = await import('three');
  return { buildShowcaseModel: () => new Object3D() };
});

/** An effect runs on its first render, without deps every render, and when one of its deps changed. */
function effectChanged(prev: readonly unknown[] | undefined, deps: readonly unknown[] | undefined): boolean {
  if (prev === undefined || deps === undefined) {
    return true;
  }
  return deps.some((d, j) => !Object.is(d, prev[j]));
}

interface Host {
  tag: string;
  props: Record<string, unknown>;
  kids: Out[];
}
type Out = Host | string;

/** A preact vnode as the JSX runtime builds it. */
interface VNodeLike {
  type: unknown;
  props: Record<string, unknown>;
  ref?: unknown;
}
const isVNode = (v: unknown): v is VNodeLike =>
  typeof v === 'object' && v !== null && 'type' in v && 'props' in v && typeof v.props === 'object';
/** A function component (the Gallery's components are all plain functions). */
const isComponent = (t: unknown): t is (props: Record<string, unknown>) => unknown => typeof t === 'function';
/** A callback ref, or an event handler with no arguments the test needs. */
const isCallback = (f: unknown): f is (arg?: unknown) => unknown => typeof f === 'function';
const isRefObject = (r: unknown): r is { current: unknown } => typeof r === 'object' && r !== null && 'current' in r;

/** The stage and the K1 bracket box at 1920 x 1080 (SPEC §5.8); every other element is empty. */
const rectOf = (cls: string) => {
  if (cls.includes('gal-brackets')) {
    return { left: 380, top: 140, right: 1500, bottom: 900 };
  }
  if (/gal-main|showcase-host/u.test(cls)) {
    return { left: 0, top: 0, right: 1920, bottom: 1080 };
  }
  return { left: 0, top: 0, right: 0, bottom: 0 };
};
const fakeEl = (cls: string) => ({
  getBoundingClientRect: () => ({ ...rectOf(cls), width: 0, height: 0 }),
  querySelector: () => null,
  scrollIntoView: vi.fn<() => void>(),
});

/** The class list of an element's props (`class` or `className`), '' without one. */
function classOf(props: Record<string, unknown>): string {
  const cls = props['class'] ?? props['className'] ?? '';
  return typeof cls === 'string' ? cls : '';
}

/** Sets a ref (a callback or a ref object) to `el`. */
function setRef(ref: unknown, el: unknown): void {
  if (isCallback(ref)) {
    ref(el);
  } else if (isRefObject(ref)) {
    ref.current = el;
  }
}

/** Calls the function components and returns the host elements, with refs set. */
function tree(v: unknown): Out[] {
  if (v === null || v === undefined || typeof v === 'boolean') {
    return [];
  }
  if (typeof v === 'string' || typeof v === 'number') {
    return [String(v)];
  }
  if (Array.isArray(v)) {
    return v.flatMap((child: unknown) => tree(child));
  }
  if (!isVNode(v)) {
    throw new Error('not a vnode');
  }
  if (isComponent(v.type)) {
    return tree(v.type(v.props));
  }
  const { ref: propRef, children, ...props } = v.props;
  // (preact's JSX runtime moves `ref` off the props onto the vnode)
  const ref = v.ref ?? propRef;
  if (ref !== undefined && ref !== null) {
    setRef(ref, fakeEl(classOf(props)));
  }
  return [{ tag: String(v.type), props, kids: tree(children) }];
}
const text = (outs: Out[]): string => outs.map((o) => (typeof o === 'string' ? o : text(o.kids))).join('');
const every = (outs: Out[]): Host[] => outs.flatMap((o) => (typeof o === 'string' ? [] : [o, ...every(o.kids)]));
const named = (outs: Out[], tag: string, label: string): Host => {
  const hit = every(outs).find((h) => h.tag === tag && (h.props['aria-label'] === label || h.props['title'] === label));
  if (!hit) {
    throw new Error(`no ${tag} "${label}"`);
  }
  return hit;
};
/** Clicks the button named `label`. */
function click(outs: Out[], label: string): void {
  const {
    props: { onClick },
  } = named(outs, 'button', label);
  if (!isCallback(onClick)) {
    throw new Error(`the button "${label}" has no click handler`);
  }
  onClick();
}
/** The stepper's "n of m" text. */
const pos = (o: Out[]) => text([must(every(o).find((h) => classOf(h.props).includes('gal-pos')))]);
/** The viewer the Gallery mounted, or fails the test when it has none. */
const viewerOf = (): FakeViewer => must(rig.viewer);

// navy, as IMPLEMENTATION.md step 9 defines it: blue minus red above 6 and luminance under 0.06
const lum = (hex: string) => {
  const c = [0, 2, 4]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * must(c[0]) + 0.7152 * must(c[1]) + 0.0722 * must(c[2]);
};
const navy = (hex: string) =>
  Number.parseInt(hex.slice(4, 6), 16) - Number.parseInt(hex.slice(0, 2), 16) > 6 && lum(hex) < 0.06;

// (the Showcase mounts its viewer after two dynamic imports, so a few macrotasks pass before its effect has settled)
const tick = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });

/** Draws the Gallery, runs the effects that changed, and lets the viewer's async mount settle. */
async function render(): Promise<Out[]> {
  rt.at = 0;
  const out = tree(Gallery());
  const fns = rt.pending.splice(0);
  for (const f of fns) {
    f();
  }
  await tick();
  return out;
}

beforeEach(() => {
  rt.at = 0;
  rt.slots = [];
  rt.deps = [];
  rt.pending = [];
  rig.viewer = null;
  vi.stubGlobal('window', { addEventListener: vi.fn<() => void>(), removeEventListener: vi.fn<() => void>() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn<() => void>();
      unobserve = vi.fn<() => void>();
      disconnect = vi.fn<() => void>();
    },
  );
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
  galleryOpen.value = true;
  closeSettings();
});

describe('Gallery acceptance (#42)', () => {
  it('shows every category the game has, and the part count it shows is the real count', async () => {
    const groups = galleryGroups();
    for (const k of SHOP_ORDER.filter((x) => hasModel(x))) {
      expect(
        groups.map((g) => g.kind),
        `${k} is listed`,
      ).toContain(k);
    }
    expect(must(groups.at(-1)).kind, 'Router comes last').toBe('router');
    const real = groups.reduce((n, g) => n + g.items.length, 0);
    const out = await render();
    expect(text(out), 'the meta line shows the real count').toContain(`${real} parts`);
  });

  it('keeps the stepper, Spin, Reset and Graphics working', async () => {
    let out = await render();
    const n = must(galleryGroups()[0]).items.length;
    expect(n).toBeGreaterThan(1);
    expect(pos(out)).toBe(`1 of ${n}`);

    click(out, 'Next part');
    out = await render();
    expect(pos(out)).toBe(`2 of ${n}`);
    click(out, 'Previous part');
    out = await render();
    expect(pos(out)).toBe(`1 of ${n}`);

    expect(named(out, 'button', 'Turn by itself').props['aria-pressed']).toBe(true);
    click(out, 'Turn by itself');
    out = await render();
    expect(named(out, 'button', 'Turn by itself').props['aria-pressed']).toBe(false);
    expect(viewerOf().setAutoTurn).toHaveBeenLastCalledWith(false);

    click(out, 'Reset the view (double-click)');
    expect(viewerOf().reset).toHaveBeenCalledWith();

    click(out, 'Picture, light and detail settings');
    expect(settingsOpen.value).toBe(true);
  });

  it("takes the viewer's insets from the K1 bracket box", async () => {
    await render();
    await render();
    const { calls } = viewerOf().setInsets.mock;
    expect(calls.length).toBeGreaterThan(0);
    // bracket box 380, 140 to 1500, 900 inside a 1920 x 1080 stage
    expect(must(calls.at(-1))[0]).toStrictEqual({ left: 380, top: 140, right: 420, bottom: 180 });
  });

  it('draws no navy in the Gallery stage: the backdrop is flat studio grey and the 3D floor and background are not navy', () => {
    const css = srcFile('../../../../core/ui/ui.css');
    const studioRules = [...css.matchAll(/(?:^|\n)\.mode \{(?<body>[^}]*)\}/gu)].map(([, body = '']) => body);
    const backgrounds = studioRules.flatMap((b) =>
      [...b.matchAll(/(?:^|[;\s])background:\s*(?<value>[^;]+);/gu)].map(([, value = '']) => value.trim()),
    );
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const bg of backgrounds) {
      expect(bg, 'the Gallery backdrop').not.toMatch(/gradient/u);
      expect(bg, 'the Gallery backdrop is the studio colour').toMatch(/^var\(--c-studio\)$|^#111113$/u);
    }

    const viewer = srcFile('../../../../core/render/three/viewer.ts');
    const body = viewer.slice(
      viewer.indexOf('function studio('),
      viewer.indexOf('\n}\n', viewer.indexOf('function studio(')),
    );
    const colours = [...body.matchAll(/0x(?<hex>[0-9a-f]{6})\b/giu)].map(([, hex = '']) => hex.toLowerCase());
    expect(colours.length).toBeGreaterThan(0);
    const navies = colours.filter((hex) => navy(hex.slice(0, 6)));
    expect(navies, 'navy colours in the Gallery 3D studio').toStrictEqual([]);
  });
});
