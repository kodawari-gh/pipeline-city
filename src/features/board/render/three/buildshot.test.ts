import { describe, expect, it } from 'vitest';
import { SHOT_FILL, centred, fitFactor, pictureWindow, spanOf } from './buildshot';

function assert_takes_the_biggest_window_of_the_picture_s_shape_(): void {
  // a wide canvas: the window is as tall as the canvas
  const wide = pictureWindow(1600, 900, 480 / 336);
  expect(wide.h).toBeCloseTo(900);
  expect(wide.w).toBeCloseTo(900 * (480 / 336));
  expect(wide.y).toBeCloseTo(0);
  // a tall canvas: the window is as wide as the canvas
  const tall = pictureWindow(400, 800, 2);
  expect(tall).toStrictEqual({ x: 0, y: 300, w: 400, h: 200 });
  // (always inside the canvas, always of the shape asked)
  for (const [cw, ch, a] of [
    [1600, 900, 1.43],
    [390, 844, 1.43],
    [900, 900, 1],
    [3200, 1800, 480 / 336],
  ] as const) {
    const w = pictureWindow(cw, ch, a);
    expect(w.w / w.h).toBeCloseTo(a);
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.y).toBeGreaterThanOrEqual(0);
    expect(w.x + w.w).toBeLessThanOrEqual(cw + 1e-9);
    expect(w.y + w.h).toBeLessThanOrEqual(ch + 1e-9);
  }
}

describe('the framing of a picture of the machine', () => {
  it("takes the biggest window of the picture's shape out of the middle of the canvas", () => {
    expect.hasAssertions();
    assert_takes_the_biggest_window_of_the_picture_s_shape_();
  });

  it('boxes the points', () => {
    expect(
      spanOf([
        { x: 10, y: 40 },
        { x: 70, y: 20 },
        { x: 30, y: 90 },
      ]),
    ).toStrictEqual({ x: 10, y: 20, w: 60, h: 70 });
  });

  it('says how far to zoom out or in so the machine fills its share of the window', () => {
    const win = { x: 0, y: 0, w: 200, h: 100 };
    // exactly the share: no change
    expect(
      fitFactor(
        [
          { x: 0, y: 0 },
          { x: 200 * SHOT_FILL, y: 50 },
        ],
        win,
      ),
    ).toBeCloseTo(1);
    // too big (the tall side decides): zoom out
    expect(
      fitFactor(
        [
          { x: 0, y: 0 },
          { x: 100, y: 172 },
        ],
        win,
        0.86,
      ),
    ).toBeCloseTo(2);
    // small: zoom in
    expect(
      fitFactor(
        [
          { x: 0, y: 0 },
          { x: 50, y: 20 },
        ],
        win,
      ),
    ).toBeLessThan(1);
  });

  it('puts the window on the middle of the machine, and keeps it inside the canvas', () => {
    const win = { x: 300, y: 0, w: 200, h: 100 };
    const mid = centred(
      [
        { x: 100, y: 20 },
        { x: 160, y: 60 },
      ],
      win,
      800,
      400,
    );
    // (the machine's middle is at 130, 40: the window would start at 30, -10; the canvas edge keeps y at 0)
    expect(mid).toStrictEqual({ x: 30, y: 0, w: 200, h: 100 });
    const far = centred(
      [
        { x: 790, y: 390 },
        { x: 800, y: 400 },
      ],
      win,
      800,
      400,
    );
    expect(far).toStrictEqual({ x: 600, y: 300, w: 200, h: 100 });
  });
});
