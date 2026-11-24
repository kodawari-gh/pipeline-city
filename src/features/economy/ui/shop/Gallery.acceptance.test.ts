// Gallery acceptance (ticket #42; SPEC §5.8, ACCEPTANCE §3 "08 Gallery"). One test per acceptance criterion that the node test run can reach.
// The node run has no DOM: Gallery is called as a function, its tree is walked (function components are called inline, refs get a fake element
// with a `getBoundingClientRect`), and the hooks are a small stand-in (as in Settings.test.ts). Layout assumptions, pinned here on purpose:
//   - the K1 bracket box is the element with class `gal-brackets` (1920 x 1080 desktop: left 380, top 140, right 1500, bottom 900, SPEC §5.8);
//   - the stage the viewer fills is the element with class `gal-main` or `showcase-host`, at 0, 0, 1920 x 1080.
// Tests that need a real browser or a screenshot are in tools/gallery.acceptance.test.ts.
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSettings, galleryOpen, settingsOpen } from '@/core/ui/state';
import { Gallery } from './Gallery';
import { galleryGroups, hasModel, SHOP_ORDER } from './shopdata';

const fs = fsMod as any;
const srcFile = (rel: string): string => fs.readFileSync(urlMod.fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const rt = vi.hoisted(() => ({
  at: 0,
  slots: [] as unknown[],
  deps: [] as (unknown[] | undefined)[],
  pending: [] as (() => unknown)[],
}));
const rig = vi.hoisted(() => ({ viewer: null as any }));

vi.mock('preact/hooks', () => ({
  useRef: (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots)) rt.slots[k] = { current: init };
    return rt.slots[k];
  },
  useState: (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots)) rt.slots[k] = init;
    const set = (v: unknown) => {
      rt.slots[k] = typeof v === 'function' ? (v as (p: unknown) => unknown)(rt.slots[k]) : v;
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
  useEffect: (fn: () => unknown, deps?: unknown[]) => {
    const k = rt.at++;
    const prev = rt.deps[k];
    if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev[j]))) {
      rt.deps[k] = deps;
      rt.pending.push(fn);
    }
  },
  useLayoutEffect: (fn: () => unknown, deps?: unknown[]) => {
    const k = rt.at++;
    const prev = rt.deps[k];
    if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev[j]))) {
      rt.deps[k] = deps;
      rt.pending.push(fn);
    }
  },
}));

vi.mock('@/core/render/three/viewer', () => ({
  mountViewer: () =>
    (rig.viewer = {
      setInsets: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      setAutoTurn: vi.fn(),
      setObject: vi.fn(),
      dispose: vi.fn(),
    }),
}));
vi.mock('@/features/board/render/three/showcase', () => ({ buildShowcaseModel: () => ({}) }));

type Host = { tag: string; props: Record<string, any>; kids: Out[] };
type Out = Host | string;

/** The stage and the K1 bracket box at 1920 x 1080 (SPEC §5.8); every other element is empty. */
const rectOf = (cls: string) => {
  if (cls.includes('gal-brackets')) return { left: 380, top: 140, right: 1500, bottom: 900 };
  if (/gal-main|showcase-host/.test(cls)) return { left: 0, top: 0, right: 1920, bottom: 1080 };
  return { left: 0, top: 0, right: 0, bottom: 0 };
};
const fakeEl = (cls: string) => ({
  getBoundingClientRect: () => ({ ...rectOf(cls), width: 0, height: 0 }),
  querySelector: () => null,
  scrollIntoView: () => undefined,
});

/** Calls the function components and returns the host elements, with refs set. */
function tree(v: any): Out[] {
  if (v == null || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(tree);
  if (typeof v.type === 'function') return tree(v.type(v.props));
  const { ref: propRef, children, ...props } = v.props;
  // (preact's JSX runtime moves `ref` off the props onto the vnode)
  const ref = v.ref ?? propRef;
  if (ref) {
    const el = fakeEl(String(props.class ?? props.className ?? ''));
    if (typeof ref === 'function') ref(el);
    else ref.current = el;
  }
  return [{ tag: String(v.type), props, kids: tree(children) }];
}
const text = (outs: Out[]): string => outs.map((o) => (typeof o === 'string' ? o : text(o.kids))).join('');
const every = (outs: Out[]): Host[] => outs.flatMap((o) => (typeof o === 'string' ? [] : [o, ...every(o.kids)]));
const named = (outs: Out[], tag: string, label: string): Host => {
  const hit = every(outs).find((h) => h.tag === tag && (h.props['aria-label'] === label || h.props.title === label));
  if (!hit) throw new Error(`no ${tag} "${label}"`);
  return hit;
};
// (the Showcase mounts its viewer after two dynamic imports, so a few macrotasks pass before its effect has settled)
const tick = () => new Promise((r) => setTimeout(r, 30));

/** Draws the Gallery, runs the effects that changed, and lets the viewer's async mount settle. */
async function render(): Promise<Out[]> {
  rt.at = 0;
  const out = tree(Gallery());
  const fns = rt.pending.splice(0);
  for (const f of fns) f();
  await tick();
  return out;
}

beforeEach(() => {
  rt.at = 0;
  rt.slots = [];
  rt.deps = [];
  rt.pending = [];
  rig.viewer = null;
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
  galleryOpen.value = true;
  closeSettings();
});

describe('Gallery acceptance (#42)', () => {
  it('shows every category the game has, and the part count it shows is the real count', async () => {
    const groups = galleryGroups();
    for (const k of SHOP_ORDER.filter((x) => hasModel(x)))
      expect(
        groups.map((g) => g.kind),
        `${k} is listed`,
      ).toContain(k);
    expect(groups[groups.length - 1]!.kind, 'Router comes last').toBe('router');
    const real = groups.reduce((n, g) => n + g.items.length, 0);
    const out = await render();
    expect(text(out), 'the meta line shows the real count').toContain(`${real} parts`);
  });

  it('keeps the stepper, Spin, Reset and Graphics working', async () => {
    let out = await render();
    const n = galleryGroups()[0]!.items.length;
    expect(n).toBeGreaterThan(1);
    const pos = (o: Out[]) => text([every(o).find((h) => String(h.props.class ?? '').includes('gal-pos'))!]);
    expect(pos(out)).toBe(`1 of ${n}`);

    named(out, 'button', 'Next part').props.onClick();
    out = await render();
    expect(pos(out)).toBe(`2 of ${n}`);
    named(out, 'button', 'Previous part').props.onClick();
    out = await render();
    expect(pos(out)).toBe(`1 of ${n}`);

    expect(named(out, 'button', 'Turn by itself').props['aria-pressed']).toBe(true);
    named(out, 'button', 'Turn by itself').props.onClick();
    out = await render();
    expect(named(out, 'button', 'Turn by itself').props['aria-pressed']).toBe(false);
    expect(rig.viewer!.setAutoTurn).toHaveBeenLastCalledWith(false);

    named(out, 'button', 'Reset the view (double-click)').props.onClick();
    expect(rig.viewer!.reset).toHaveBeenCalled();

    named(out, 'button', 'Picture, light and detail settings').props.onClick();
    expect(settingsOpen.value).toBe(true);
  });

  it("takes the viewer's insets from the K1 bracket box", async () => {
    await render();
    await render();
    const calls = rig.viewer!.setInsets.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // bracket box 380, 140 to 1500, 900 inside a 1920 x 1080 stage
    expect(calls[calls.length - 1]![0]).toEqual({ left: 380, top: 140, right: 420, bottom: 180 });
  });

  it('draws no navy in the Gallery stage: the backdrop is flat studio grey and the 3D floor and background are not navy', () => {
    // navy, as IMPLEMENTATION.md step 9 defines it: blue minus red above 6 and luminance under 0.06
    const lum = (hex: string) => {
      const c = [0, 2, 4]
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const navy = (hex: string) =>
      Number.parseInt(hex.slice(4, 6), 16) - Number.parseInt(hex.slice(0, 2), 16) > 6 && lum(hex) < 0.06;

    const css = srcFile('../../../../core/ui/ui.css');
    const studioRules = [...css.matchAll(/(?:^|\n)\.mode \{([^}]*)\}/g)].map((m) => m[1]!);
    const backgrounds = studioRules.flatMap((b) =>
      [...b.matchAll(/(?:^|[;\s])background:\s*([^;]+);/g)].map((m) => m[1]!.trim()),
    );
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const bg of backgrounds) {
      expect(bg, 'the Gallery backdrop').not.toMatch(/gradient/);
      expect(bg, 'the Gallery backdrop is the studio colour').toMatch(/^var\(--c-studio\)$|^#111113$/);
    }

    const viewer = srcFile('../../../../core/render/three/viewer.ts');
    const body = viewer.slice(
      viewer.indexOf('function studio('),
      viewer.indexOf('\n}\n', viewer.indexOf('function studio(')),
    );
    const colours = [...body.matchAll(/0x([0-9a-f]{6})\b/gi)].map((m) => m[1]!.toLowerCase());
    expect(colours.length).toBeGreaterThan(0);
    const navies = colours.filter((hex) => navy(hex.slice(0, 6)));
    expect(navies, 'navy colours in the Gallery 3D studio').toEqual([]);
  });
});
