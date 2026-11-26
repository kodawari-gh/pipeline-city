// The tutorial's key flight (ticket #44): the camera flight to a key (`flyToId`, id `key:<n>`) moves the eye no further than the HUD forces.
// The tutorial card is 360 px tall, so a key framed in the middle of the band it leaves sat so high that the hoodie on the chair hid it.
// `mountBoard3d` (world/mount.ts) needs WebGL, so no test mounts it (`devhook.test.ts` reads its source for the same reason). This test
// takes the statement that follows the key guard out of the source and runs it with the real camera functions, so a change to the guard or to
// what it passes is tested, not a copy of it. The statement may be a block that pans the view (`panBy`) or a call of `lowerInBand` (camera.ts).
// A change that leaves no `if (id.startsWith('key:'))` statement fails the first test: point the harness at the new place.
import { describe, expect, it, vi } from 'vitest';
import * as camera from '@/core/render/three/camera';

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
const text: string = fs.readFileSync(nodeUrl.fileURLToPath(new URL('world/flyToId.ts', import.meta.url)), 'utf8');

interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the key flight statement reads: the id, the view, the canvas height, the box height and the inset. */
interface ShiftInput {
  id: string;
  v: camera.OrbitView;
  H: number;
  bh: number;
  viewInset: { peek: () => Inset };
}
type Shift = (input: ShiftInput) => camera.OrbitView;

/** Whether a value is an orbit view (the statement returns the view it moved). */
function isOrbitView(v: unknown): v is camera.OrbitView {
  return typeof v === 'object' && v !== null && 'x' in v && 'y' in v && 'height' in v && 'pitch' in v;
}

/** The guard, with the space after it: the other `startsWith('key:')` tests in the file have more in the condition. */
const GUARD = "if (id.startsWith('key:')) ";

/** The text of the `{ ... }` that opens at `open` (its braces matched; the block holds no brace in a string). */
function braced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
    } else if (source[i] === '}' && --depth === 0) {
      return source.slice(open, i + 1);
    }
  }
  throw new Error('the key flight block has no end');
}

/**
 * The key flight's guard and the statement it guards, from world/flyToId.ts (board3d.ts before #124), as a function of what they read: the id, the view, the canvas height, the box
 * height and the inset. The statement is a block, or one line up to its `;`. The camera functions it calls are the real ones.
 */
function keyShift(): Shift {
  const at = text.split(GUARD).length - 1 === 1 ? text.indexOf(GUARD) : -1;
  if (at < 0) {
    throw new Error(`world/flyToId.ts must have one \`${GUARD.trim()}\` statement (the key flight's eye shift)`);
  }
  const after = at + GUARD.length;
  const statement = text[after] === '{' ? braced(text, after) : text.slice(after, text.indexOf(';', after) + 1);
  if (!statement.includes('viewInset.peek()') || !/(?:panBy|lowerInBand)\(/u.test(statement)) {
    throw new Error(`the key flight statement must read viewInset and pan the view: ${statement}`);
  }
  // (the statement's helpers are the real camera functions: the type check fails if camera.ts stops exporting one)
  const { lowerInBand, panBy } = camera;
  // oxlint-disable-next-line eslint/no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion -- the test runs the statement it read from the source, by design; its result is checked below
  const run = new Function(
    'id',
    'v',
    'H',
    'bh',
    'viewInset',
    'panBy',
    'lowerInBand',
    `${GUARD}${statement}\nreturn v;`,
  ) as (...args: unknown[]) => unknown;
  // (a name the statement reads that the harness does not give it is a ReferenceError: say so)
  return ({ id, v, H, bh, viewInset }) => {
    let out: unknown;
    try {
      out = run(id, v, H, bh, viewInset, panBy, lowerInBand);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`the key flight statement reads something this harness does not give it: ${message}`, {
        cause: error,
      });
    }
    if (!isOrbitView(out)) {
      throw new Error('the key flight statement must leave a view in `v`');
    }
    return out;
  };
}

const H = 1080;
/** A view from the room's angle, as `flyToId` hands it to the block (centred on the key's box, in the middle of the free band by `inFree`). */
const START: camera.OrbitView = { x: 3000, y: -1500, z: 5000, yaw: 0, pitch: 0.09, fov: 26, height: 4000 };
/** The key and its port: 800 units tall at 4000 units over 1080 px, so 216 px on screen. */
const BOX = 800;

/**
 * Runs the key flight block for a box that `inFree` centred in the band the insets leave free (`mid`, px from the top of the screen), and reads where
 * the block leaves the box: its `centre`, `top` and `bottom` (px, y down). The block moves the target up the screen's axis; the picture moves down.
 */
function flight(
  id: string,
  inset: Partial<Inset>,
  { from = START, h = H }: { from?: camera.OrbitView; h?: number } = {},
) {
  const box = BOX;
  const i: Inset = { top: 0, right: 0, bottom: 0, left: 0, ...inset };
  const to = keyShift()({ id, v: from, H: h, bh: box, viewInset: { peek: () => i } });
  const k = from.height / h,
    boxPx = box / k;
  const up = (to.y - from.y) / Math.cos(from.pitch);
  const mid = (i.top + h - i.bottom) / 2,
    centre = mid + up / k;
  return { to, boxPx, mid, centre, top: centre - boxPx / 2, bottom: centre + boxPx / 2, i };
}

/** The air a box keeps from an inset when the inset forces it off the middle: some, not a lot. */
const AIR = { min: 8, max: 48 };

function assert_is_for_keys_only_every_other_id_keeps_the_view_i(): void {
  for (const id of ['cpu', 'usb', 'tray', 'cable.lan', 'monitor', 'power', 'inv:key:3', 'key']) {
    expect(flight(id, { top: 63, bottom: 369 }).to).toBe(START);
  }
  expect(flight('key:3', { top: 63, bottom: 369 }).to).not.toBe(START);
}

function assert_for_any_insets_the_box_is_never_under_one_and_it(): void {
  const problems: string[] = [];
  for (const h of [720, 900, 1080]) {
    for (const top of [0, 63, 200, 400]) {
      for (const bottom of [0, 100, 369, 600]) {
        const f = flight('key:7', { top, bottom }, { h });
        const where = `${h} px, top ${top}, bottom ${bottom}: box ${Math.round(f.top)} to ${Math.round(f.bottom)}`;
        // the box with the most air an inset can ask for still fits the band: it must be clear of both insets
        if (f.boxPx + 2 * AIR.max > h - top - bottom) {
          continue;
        }
        if (f.top < top || f.bottom > h - bottom) {
          problems.push(`${where}: under an inset`);
        }
        const free = h / 2 - f.boxPx / 2 - AIR.max >= top && h / 2 + f.boxPx / 2 + AIR.max <= h - bottom;
        const forced = h / 2 - f.boxPx / 2 - AIR.min < top || h / 2 + f.boxPx / 2 + AIR.min > h - bottom;
        if (free && Math.abs(f.centre - h / 2) > 0.01) {
          problems.push(`${where}: nothing forces it off the middle, but it is not there`);
        }
        const rests = Math.abs(f.top - top) <= AIR.max || Math.abs(h - bottom - f.bottom) <= AIR.max;
        if (forced && !rests) {
          problems.push(`${where}: an inset forces it off the middle, but it rests on neither inset`);
        }
      }
    }
  }
  expect(problems).toStrictEqual([]);
}

describe('the key flight moves the eye no further than the HUD forces (world/flyToId.ts, ticket #44)', () => {
  it('finds the key flight statement in world/flyToId.ts', () => {
    expect(() => keyShift()).not.toThrow();
  });

  it('is for keys only: every other id keeps the view it was given', () => {
    expect.hasAssertions();
    assert_is_for_keys_only_every_other_id_keeps_the_view_i();
  });

  it('does nothing when the HUD takes no room, or the same at both ends', () => {
    expect(flight('key:7', {}).to).toStrictEqual(START);
    expect(flight('key:7', { top: 200, bottom: 200 }).to).toStrictEqual(START);
  });

  it('puts the key in the middle of the screen when the card leaves it there (it is not centred in the band under the card)', () => {
    // the first frame's insets at 1920 x 1080: the top bar 63 px, the 360 px card 369 px. The band's middle is y 387, the screen's is 540.
    const f = flight('key:7', { top: 63, bottom: 369 });
    expect(f.mid).toBe(387);
    expect(f.centre).toBeCloseTo(H / 2, 6);
    expect(f.bottom, 'the box is clear of the card').toBeLessThan(H - 369);
    expect(f.top, 'the box is clear of the top bar').toBeGreaterThan(63);
  });

  it('only moves the target up or down the screen: the zoom, the turn and the sideways position stay', () => {
    const { to } = flight('key:7', { top: 63, bottom: 369 });
    expect(to.x).toBe(START.x);
    expect(to.height).toBe(START.height);
    expect(to.fov).toBe(START.fov);
    expect(to.yaw).toBe(START.yaw);
    expect(to.pitch).toBe(START.pitch);
    expect(to.y).not.toBe(START.y);
  });

  it('a card that reaches into the middle pushes the key up only until it clears the card', () => {
    const f = flight('key:7', { top: 63, bottom: 600 });
    expect(f.centre).toBeLessThan(H / 2);
    expect(H - 600 - f.bottom, 'air between the box and the card').toBeGreaterThanOrEqual(AIR.min);
    expect(H - 600 - f.bottom, 'air between the box and the card').toBeLessThanOrEqual(AIR.max);
  });

  it('a top bar that reaches into the middle pushes the key down only until it clears the bar', () => {
    const f = flight('key:7', { top: 700, bottom: 0 });
    expect(f.centre).toBeGreaterThan(H / 2);
    expect(f.top - 700, 'air between the box and the bar').toBeGreaterThanOrEqual(AIR.min);
    expect(f.top - 700, 'air between the box and the bar').toBeLessThanOrEqual(AIR.max);
  });

  it('holds for any screen height and zoom: the move is in pixels, not in world units', () => {
    // another screen (900 px tall) and a view farther out: 8 units to the pixel, so the key is 100 px on the screen, and it still goes to the middle
    const f = flight('key:7', { top: 63, bottom: 369 }, { from: { ...START, height: 7200 }, h: 900 });
    expect(f.boxPx).toBe(100);
    expect(f.centre).toBeCloseTo(450, 6);
  });

  it('for any insets: the box is never under one, and it rests at the screen middle unless an inset forces it off', () => {
    expect.hasAssertions();
    assert_for_any_insets_the_box_is_never_under_one_and_it();
  });
});
