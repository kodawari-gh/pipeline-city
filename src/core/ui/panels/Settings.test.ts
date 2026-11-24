// The Settings screen's tree (ticket #38; SPEC §5.6). The node test run has no DOM, so Settings is called as a plain function and its
// returned tree is walked. The hooks are a small stand-in: state persists between renders, and an effect runs after the render that
// changed its inputs. So Peek's hold and its release on the window are real here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({
  at: 0,
  slots: [] as unknown[],
  effects: [] as ({ deps: unknown[] | undefined; cleanup?: (() => unknown) | undefined } | undefined)[],
  pending: [] as { k: number; fn: () => unknown; deps: unknown[] | undefined }[],
}));

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
      rt.slots[k] = typeof v === 'function' ? (v as (prev: unknown) => unknown)(rt.slots[k]) : v;
    };
    return [rt.slots[k], set];
  },
  useEffect: (fn: () => unknown, deps?: unknown[]) => {
    const k = rt.at++;
    const prev = rt.effects[k];
    const changed = !prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps?.[j]));
    if (changed) rt.pending.push({ k, fn, deps });
  },
  useLayoutEffect: (fn: () => unknown, deps?: unknown[]) => {
    const k = rt.at++;
    const prev = rt.effects[k];
    if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps?.[j]))) rt.pending.push({ k, fn, deps });
  },
}));

type VEl = { type: unknown; props: Record<string, any> };
type Node = VEl | string | number | boolean | null | undefined | Node[];

const elements = (v: Node): VEl[] => {
  if (Array.isArray(v)) return v.flatMap(elements);
  if (v && typeof v === 'object' && 'props' in v) return [v];
  return [];
};
const childrenOf = (el: VEl): Node => el.props['children'] as Node;
function all(v: Node): VEl[] {
  return elements(v).flatMap((el) => [el, ...all(childrenOf(el))]);
}
function text(v: Node): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).join('');
  if (v && typeof v === 'object' && 'props' in v) return text(childrenOf(v));
  return '';
}

let Settings: () => unknown;
let graphics: typeof import('@/app/graphics');
let winListeners: Record<string, ((e: unknown) => void)[]>;

beforeEach(async () => {
  vi.resetModules();
  rt.at = 0;
  rt.slots = [];
  rt.effects = [];
  rt.pending = [];
  // (state.ts reads `document` when it loads; no page is needed: the screen's refs stay empty)
  vi.stubGlobal('document', {});
  winListeners = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (winListeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      winListeners[type] = (winListeners[type] ?? []).filter((f) => f !== fn);
    },
  });
  ({ Settings } = (await import('@/core/ui/panels/Settings')) as unknown as { Settings: () => unknown });
  graphics = await import('@/app/graphics');
});

/** One render, as Preact does it here: the state slots are kept, and the effects whose inputs changed run after the render. */
function render(): Node {
  rt.at = 0;
  rt.pending = [];
  const out = Settings() as unknown as Node;
  for (const p of rt.pending) {
    rt.effects[p.k]?.cleanup?.();
    const cleanup = p.fn();
    rt.effects[p.k] = { deps: p.deps, cleanup: typeof cleanup === 'function' ? (cleanup as () => unknown) : undefined };
  }
  return out;
}

const tree = () => render();
const tabsOf = () => all(tree()).filter((el) => el.props['role'] === 'tab');

describe('the five tabs', () => {
  it('are a tab list, Quality first and selected', () => {
    const tabs = tabsOf();
    expect(tabs.map((t) => text(childrenOf(t)).trim())).toEqual(['Quality', 'Display', 'Light', 'Detail', 'Interface']);
    expect(tabs[0]!.props['aria-selected']).toBe(true);
    expect(tabs.slice(1).every((t) => t.props['aria-selected'] === false)).toBe(true);
  });

  it('are one tab stop: the selected tab has tabIndex 0, the others -1', () => {
    const tabs = tabsOf();
    expect(tabs[0]!.props['tabIndex']).toBe(0);
    for (const t of tabs.slice(1)) expect(t.props['tabIndex']).toBe(-1);
  });

  it('sit in a tab list', () => {
    const list = all(tree()).find((el) => el.props['role'] === 'tablist');
    expect(list).toBeDefined();
  });
});

describe('the Quality tab', () => {
  it('shows the four presets and the device tier', () => {
    const radios = all(tree())
      .filter((el) => el.props['role'] === 'radio')
      .map((el) => text(childrenOf(el)));
    // the preset row, then the device row: Auto and the three tiers
    expect(radios).toEqual(['Low', 'Medium', 'High', 'Ultra', 'Auto', 'Low', 'Medium', 'High']);
  });
});

describe('the foot', () => {
  it('has Peek', () => {
    const buttons = all(tree())
      .filter((el) => el.type === 'button')
      .map((el) => text(childrenOf(el)).trim());
    expect(buttons.some((t) => /peek/i.test(t))).toBe(true);
  });

  it('has a Back control', () => {
    const buttons = all(tree())
      .filter((el) => el.type === 'button')
      .map((el) => text(childrenOf(el)).trim());
    expect(buttons.some((t) => /back/i.test(t))).toBe(true);
  });
});

describe('no alarm colour for low fps', () => {
  it('a 12 FPS reading shows its number with no red or warning class or colour', () => {
    graphics.frameStats.value = { fps: 12, ms: 83.3, w: 1440, h: 810 };
    graphics.graphics.value = { ...graphics.graphics.value, fps: 60 };
    const els = all(tree());
    const shown = els.map((el) => text(childrenOf(el)).trim()).join('|');
    expect(shown).toContain('12');
    for (const el of els) {
      const cls = String(el.props['class'] ?? el.props['className'] ?? '');
      expect(cls, cls).not.toMatch(/\b(bad|warn|warning|alarm|danger|error)\b/i);
      const style = JSON.stringify(el.props['style'] ?? '');
      expect(style, style).not.toMatch(/red|--c-bad|--c-warn|--c-alarm|#f[0-9a-f]{2}[0-9a-f]{2}|rgb\(\s*2[0-9]{2}/i);
    }
  });
});

describe('Peek with the mouse: held while the button is down, and the release ends it, also off the button', () => {
  const peekButton = () => all(tree()).find((el) => el.type === 'button' && /peek/i.test(text(childrenOf(el))))!;
  const peeking = () =>
    String(all(tree()).find((el) => el.props['role'] === 'dialog')!.props['class'])
      .split(/\s+/)
      .includes('peek');
  /** A window event, such as a release the pointer made off the Peek button. */
  const onWindow = (type: string) => {
    for (const fn of [...(winListeners[type] ?? [])]) fn({ type, key: undefined });
  };

  it('a mouse press holds Peek on, and the release lets go (the window hears it, so it need not be over the button)', () => {
    peekButton().props['onPointerDown']({ type: 'pointerdown', button: 0, pointerType: 'mouse' });
    expect(peeking()).toBe(true);
    onWindow('pointerup');
    expect(peeking()).toBe(false);
  });

  it('a second press holds Peek on again, and its release lets go', () => {
    peekButton().props['onPointerDown']({ type: 'pointerdown', button: 0, pointerType: 'mouse' });
    onWindow('pointerup');
    peekButton().props['onPointerDown']({ type: 'pointerdown', button: 0, pointerType: 'mouse' });
    expect(peeking()).toBe(true);
    onWindow('pointerup');
    expect(peeking()).toBe(false);
  });

  it('a right-button press does not hold Peek on', () => {
    peekButton().props['onPointerDown']({ type: 'pointerdown', button: 2, pointerType: 'mouse' });
    expect(peeking()).toBe(false);
  });
});
