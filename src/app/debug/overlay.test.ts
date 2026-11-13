import type { WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphics, setAutoTier, setPreset, tierRecord } from '../graphics';
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

  /** A renderer stub that draws nothing (the readout still runs). */
  const rig = () => {
    const render = { calls: 0 };
    return { info: { autoReset: true, render, reset() { render.calls = 0; } }, getPixelRatio: () => 1 } as unknown as WebGLRenderer;
  };
  const cvs = () => ({ width: 1, height: 1 }) as unknown as HTMLCanvasElement;

  it('the Shadows button turns the sun shadow off and back on, through setGraphic', () => {
    setPreset('high');
    mountDebug({ renderer: rig(), canvas: cvs() });
    frame!(0);
    expect(button('Shadows on')).toBeDefined();
    button('Shadows on').handlers.click!();
    expect(graphics.value.shadows).toBe(0);
    expect(tierRecord.value.mode).toBe('manual');
    frame!(1000);
    button('Shadows off').handlers.click!();
    expect(graphics.value.shadows).toBe(3);
  });

  it('the Lights button cycles All and 4 through setGraphic', () => {
    setPreset('high');
    mountDebug({ renderer: rig(), canvas: cvs() });
    frame!(0);
    button('Lights All').handlers.click!();
    expect(graphics.value.lights).toBe(4);
    frame!(1000);
    button('Lights 4').handlers.click!();
    expect(graphics.value.lights).toBe(0);
  });

  it('Hide city hides only the city root, and Hide machine only the machine root; neither touches the saved settings', () => {
    setPreset('high');
    const city = { visible: true }, machine = { visible: true };
    mountDebug({ renderer: rig(), canvas: cvs(), roots: () => ({ city, machine }) });
    frame!(0);
    const before = graphics.value;
    button('Hide city').handlers.click!();
    expect([city.visible, machine.visible]).toEqual([false, true]);
    button('Hide machine').handlers.click!();
    expect([city.visible, machine.visible]).toEqual([false, false]);
    expect(graphics.value).toBe(before);
    button('Hide city').handlers.click!();
    button('Hide machine').handlers.click!();
    expect([city.visible, machine.visible]).toEqual([true, true]);
  });

  it('a machine root that is replaced while hidden is hidden too', () => {
    let machine = { visible: true };
    mountDebug({ renderer: rig(), canvas: cvs(), roots: () => ({ city: null, machine }) });
    frame!(0);
    button('Hide machine').handlers.click!();
    const next = { visible: true };
    machine = next;
    frame!(1000);
    expect(next.visible).toBe(false);
  });

  it('the readout has the viewport line: the window, the screen and the orientation', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 485, innerHeight: 997, screen: { width: 485, height: 997 } });
    mountDebug({ renderer: rig(), canvas: cvs() });
    frame!(0);
    expect(made.find((e) => e.tag === 'pre')!.textContent).toContain('view 485x997, screen 485x997, portrait (by size)');
  });
});
