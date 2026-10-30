import { beforeAll, describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { Camera, currentTextResolution, labelFade, registerLabel, screenRect, stepTextResolution, textResolutionFor } from './camera';

// The camera only needs an element (style, listeners, a rect) and a container (scale, position); no DOM is required.
const fakeEl = () => ({
  style: {} as Record<string, string>,
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
}) as unknown as HTMLElement;
const fakeWorld = () => ({ scale: { set() {} }, position: { set() {} } }) as unknown as Container;
const makeCamera = () => { const c = new Camera(fakeWorld(), fakeEl()); c.resize(800, 600); return c; };

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = { addEventListener() {} };
});

describe('screenRect (world rect to client px)', () => {
  it('adds the canvas origin, the view centre and the zoom', () => {
    const r = screenRect({ x: 100, y: 50, w: 40, h: 20 }, { x: 0, y: 0, z: 2 }, { x: 400, y: 300 }, { left: 10, top: 20 });
    expect(r).toEqual({ x: 10 + 400 + 200, y: 20 + 300 + 100, w: 80, h: 40 });
  });

  it('a point at the view centre lands on the centre of the free area', () => {
    const r = screenRect({ x: 500, y: -200, w: 0, h: 0 }, { x: 500, y: -200, z: 0.5 }, { x: 400, y: 300 }, { left: 0, top: 0 });
    expect([r.x, r.y]).toEqual([400, 300]);
  });
});

describe('Camera flights', () => {
  it('lands at the target and reports arrival', () => {
    const cam = makeCamera();
    const got: boolean[] = [];
    cam.flyTo({ x: 500, y: 0, z: 1 }, 100, (a) => got.push(a));
    cam.update(performance.now() + 1000);
    expect(got).toEqual([true]);
    expect(cam.x).toBe(500);
    expect(cam.z).toBe(1);
  });

  it('cancelling reports false and leaves the view where it was', () => {
    const cam = makeCamera();
    const got: boolean[] = [];
    cam.flyTo({ x: 500, y: 0, z: 1 }, 1000, (a) => got.push(a));
    cam.cancelFlight();
    cam.update(performance.now() + 5000);
    expect(got).toEqual([false]);
    expect(cam.x).toBe(0);
  });

  it('a new flight cancels the one in progress', () => {
    const cam = makeCamera();
    const got: string[] = [];
    cam.flyTo({ x: 500, y: 0, z: 1 }, 1000, (a) => got.push('first ' + a));
    cam.flyTo({ x: -500, y: 0, z: 1 }, 100, (a) => got.push('second ' + a));
    cam.update(performance.now() + 2000);
    expect(got).toEqual(['first false', 'second true']);
    expect(cam.x).toBe(-500);
  });

  it('duration 0 jumps and reports arrival at once', () => {
    const cam = makeCamera();
    const got: boolean[] = [];
    cam.flyTo({ x: 300, y: 40, z: 0.4 }, 0, (a) => got.push(a));
    expect(got).toEqual([true]);
    expect([cam.x, cam.y, cam.z]).toEqual([300, 40, 0.4]);
  });

  it('hold is kept by a held flight and dropped by a plain one', () => {
    const cam = makeCamera();
    cam.flyTo({ x: 10, y: 20, z: 1 }, 0, undefined, true);
    expect(cam.holdAt).toEqual({ x: 10, y: 20 });
    cam.flyTo({ x: 10, y: 20, z: 1 }, 0);
    expect(cam.holdAt).toBeNull();
  });
});

describe('text resolution follows zoom', () => {
  it('steps from 2 to 4 with zoom and device pixel ratio', () => {
    expect(textResolutionFor(0.15)).toBe(2);
    expect(textResolutionFor(2)).toBe(2);
    expect(textResolutionFor(2.5)).toBe(3);
    expect(textResolutionFor(3)).toBe(3);
    expect(textResolutionFor(1.5, 2)).toBe(3);
    expect(textResolutionFor(3, 2)).toBe(4);
  });

  it('the camera retextures Text nodes when the step changes, and not otherwise', () => {
    const text = { text: 'x', resolution: 2, children: [] as unknown[] };
    const world = { scale: { set() {} }, position: { set() {} }, children: [{ children: [text] }] } as unknown as Container;
    const cam = new Camera(world, fakeEl());
    cam.resize(800, 600);
    cam.set({ x: 0, y: 0, z: 3 });
    expect(text.resolution).toBe(3);
    expect(currentTextResolution()).toBe(3);
    cam.set({ x: 0, y: 0, z: 0.5 });
    expect(text.resolution).toBe(2);
  });

  it('steps up at once but down only once clearly below the step', () => {
    expect(stepTextResolution(2, 2.5)).toBe(3);
    expect(stepTextResolution(3, 1.95)).toBe(3); // a wobble under 2x keeps the sharper step
    expect(stepTextResolution(3, 1.8)).toBe(2);
    expect(stepTextResolution(4, 2.9)).toBe(4);
    expect(stepTextResolution(4, 2.5)).toBe(3);
    expect(stepTextResolution(2, 0.3)).toBe(2);
  });

  it('a flight or a wheel applies a new step a few hundred texts a frame, not all at once', () => {
    const texts = Array.from({ length: 600 }, () => ({ text: 'x', resolution: 2, children: [] as unknown[] }));
    const world = { scale: { set() {} }, position: { set() {} }, children: [{ children: texts }] } as unknown as Container;
    const cam = new Camera(world, fakeEl());
    cam.resize(800, 600);
    cam.set({ x: 0, y: 0, z: 0.5 });
    cam.flyTo({ x: 0, y: 0, z: 3 }, 100);
    let t = performance.now() + 1000;
    cam.update(t);
    const done = () => texts.filter((x) => x.resolution === 3).length;
    expect(currentTextResolution()).toBe(3); // new labels start at the new step at once
    expect(done()).toBeGreaterThan(0);
    expect(done()).toBeLessThan(600);
    for (let i = 0; i < 4; i++) cam.update((t += 16));
    expect(done()).toBe(600);
    cam.set({ x: 0, y: 0, z: 0.5 }); // back to rest for the tests after this one
  });
});

describe('Camera inset easing', () => {
  it('the drawn inset eases to the target, so the view centre glides', () => {
    const cam = makeCamera();
    cam.inset = { top: 0, right: 0, bottom: 0, left: 200, };
    expect(cam.cx).toBe(400);
    let t = performance.now();
    for (let i = 0; i < 40; i++) { t += 50; cam.update(t); }
    expect(Math.abs(cam.cx - 500)).toBeLessThan(0.6);
  });
});

describe('Camera bounds (the room caps the view)', () => {
  const room = { x: -1000, y: -500, w: 2000, h: 1000 };

  it('pulls a view that would show beyond the box back inside it', () => {
    const cam = makeCamera();
    cam.bounds = room;
    cam.set({ x: 5000, y: -9000, z: 1 }); // the 800x600 canvas shows 800x600 world units at zoom 1
    expect(cam.x).toBe(room.x + room.w - 400);
    expect(cam.y).toBe(room.y + 300);
    cam.set({ x: -5000, y: 9000, z: 1 });
    expect(cam.x).toBe(room.x + 400);
    expect(cam.y).toBe(room.y + room.h - 300);
  });

  it('centres the box where the view is bigger than it', () => {
    const cam = makeCamera();
    cam.bounds = room;
    cam.set({ x: 0, y: 400, z: 0.2 }); // 4000x3000 world units visible: more than the room both ways
    expect([cam.x, cam.y]).toEqual([0, 0]);
  });

  it('keeps the view inside while panning and zooming out (apply clamps every time)', () => {
    const cam = makeCamera();
    cam.bounds = room;
    cam.set({ x: 0, y: 0, z: 1 });
    cam.x = 3000; cam.apply();
    expect(cam.x).toBe(600);
    cam.minZ = 0.4; // the cap: 2000 / 800 = 2.5 units per px, so z 0.4 shows exactly the room's width
    cam.set({ x: 0, y: 0, z: 0.01 });
    expect(cam.z).toBe(0.4);
  });

  it('the UI inset shrinks the free area, so the view may go closer to the edge', () => {
    const cam = makeCamera();
    cam.bounds = room;
    cam.snapInset({ top: 0, right: 400, bottom: 0, left: 0 }); // free width 400 -> half 200 at zoom 1
    cam.set({ x: 5000, y: 0, z: 1 });
    expect(cam.x).toBe(room.x + room.w - 200);
  });

  it('clampView gives the settled view for a target (the overview fit uses it)', () => {
    const cam = makeCamera();
    cam.bounds = room;
    expect(cam.clampView({ x: 9999, y: 0, z: 1 }).x).toBe(room.x + room.w - 400);
    cam.bounds = null;
    expect(cam.clampView({ x: 9999, y: 0, z: 1 }).x).toBe(9999);
  });
});

describe('the size rule for labels', () => {
  it('shows a label that is tall enough, fades one that is small, and drops one that is a smudge', () => {
    expect(labelFade(9, 6)).toBe(1);
    expect(labelFade(6, 6)).toBe(1);
    expect(labelFade(5.1, 6)).toBeCloseTo(0.5, 6);
    expect(labelFade(4.2, 6)).toBeCloseTo(0, 9);
    expect(labelFade(2, 6)).toBe(0);
  });
  it('follows the zoom: the same label is shown close in and gone far out, at the alpha it was made with', () => {
    const t = { alpha: 0.9 };
    const c = makeCamera();
    const w = c as unknown as { world: unknown };
    c.minZ = 0.001;
    c.set({ x: 0, y: 0, z: 1 });
    registerLabel(t, 0.9, 100, 6); // 100 units of letters
    c.set({ x: 0, y: 0, z: 1 }); c.update(0); void w;
    expect(t.alpha).toBeCloseTo(0.9, 9);
    c.set({ x: 0, y: 0, z: 0.05 }); // 5 px: fading
    expect(t.alpha).toBeGreaterThan(0);
    expect(t.alpha).toBeLessThan(0.9);
    c.set({ x: 0, y: 0, z: 0.03 }); // 3 px: gone
    expect(t.alpha).toBe(0);
    c.set({ x: 0, y: 0, z: 0.5 });
    expect(t.alpha).toBeCloseTo(0.9, 9);
  });
});

describe('the size rule counts the scale of the containers a label sits in', () => {
  it('a label inside a container drawn at half size is half as tall on screen', () => {
    const c = makeCamera();
    c.minZ = 0.001;
    const world = (c as unknown as { world: unknown }).world;
    const outer = { alpha: 1, scale: { x: 0.5 }, parent: world as never };
    const t = { alpha: 1, parent: outer };
    registerLabel(t, 1, 100, 6);
    c.set({ x: 0, y: 0, z: 0.1 }); // 100 units at 0.1 would be 10 px; at half size 5: fading
    expect(t.alpha).toBeGreaterThan(0);
    expect(t.alpha).toBeLessThan(1);
    c.set({ x: 0, y: 0, z: 0.2 }); // 10 px
    expect(t.alpha).toBe(1);
  });
});
