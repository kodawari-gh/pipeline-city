import type { WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAutoTier, tierRecord } from '../graphics';
import { mountDebug } from './overlay';

// A stub DOM: enough of document and the elements the overlay makes (no DOM in node).
interface Fake {
  tag: string;
  style: { cssText: string };
  textContent: string;
  type?: string;
  children: Fake[];
  handlers: Record<string, (e?: unknown) => void>;
  append(...nodes: Fake[]): void;
  addEventListener(type: string, fn: (e?: unknown) => void): void;
  remove(): void;
}

const made: Fake[] = [];
const fakeEl = (tag: string): Fake => {
  const el: Fake = {
    tag, style: { cssText: '' }, textContent: '', children: [], handlers: {},
    append(...nodes) { el.children.push(...nodes); },
    addEventListener(type, fn) { el.handlers[type] = fn; },
    remove() {},
  };
  made.push(el);
  return el;
};

/** The button whose label is `label`. */
const button = (label: string): Fake => made.find((e) => e.tag === 'button' && e.textContent === label)!;

describe('mountDebug (stub DOM, 120 Hz rAFs)', () => {
  let frame: ((now: number) => void) | null = null;
  const ms = 1000 / 120;

  beforeEach(() => {
    made.length = 0;
    frame = null;
    vi.stubGlobal('document', { createElement: fakeEl, body: { append: () => {} } });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frame = cb; return 1; });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads about 30 fps when the game draws every 4th rAF at 120 Hz, not the rAF rate', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    const render = { calls: 0 };
    const renderer = {
      info: { autoReset: true, render, reset() { render.calls = 0; } },
      getPixelRatio: () => 1,
    } as unknown as WebGLRenderer;
    const canvas = { width: 100, height: 100 } as unknown as HTMLCanvasElement;
    mountDebug({ renderer, canvas });
    for (let i = 0; i < 600; i++) {
      // the game draws in its own rAF, before the overlay reads the calls
      if (i % 4 === 0) render.calls = 10;
      frame!(i * ms);
    }
    const readout = made.find((e) => e.tag === 'pre')!;
    const fps = Number(/fps ([\d.]+)/.exec(readout.textContent)![1]);
    expect(fps).toBeGreaterThan(29);
    expect(fps).toBeLessThan(31);
  });

  it('the Auto button goes to auto mode, and is lit only in auto mode', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    const render = { calls: 0 };
    const renderer = {
      info: { autoReset: true, render, reset() { render.calls = 0; } },
      getPixelRatio: () => 1,
    } as unknown as WebGLRenderer;
    mountDebug({ renderer, canvas: { width: 1, height: 1 } as unknown as HTMLCanvasElement });
    frame!(0);
    const lit = '#3a7d44';
    expect(button('Auto').style.cssText).toContain(lit);

    // a scale tap makes the tier manual: Auto is no longer lit
    button('0.5').handlers.click!();
    expect(tierRecord.value.mode).toBe('manual');
    frame!(1000);
    expect(button('Auto').style.cssText).not.toContain(lit);

    button('Auto').handlers.click!();
    expect(tierRecord.value.mode).toBe('auto');
    expect(button('Auto').style.cssText).toContain(lit);
  });
});
