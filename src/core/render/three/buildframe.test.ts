// Build camera framing (ticket #43). Written before the coder's change: the seam is `./buildframe` (`freeArea`, `buildFrame`), which does not exist
// yet, so this file fails at import until it lands. The seam: `freeArea` takes the stage's box and the live boxes of the Edge tabs (CSS px),
// `buildFrame` frames the machine box in that free area and returns the view; while a drag is in progress it returns the previous view as it is.
// The rim light is read from the Build stage's source: it must stay the cool `0x8fb0ff` (ADR 0001).
// @ts-ignore (the node test run has no @types/node: the source is read through an untyped import, as in buildtabs.test.ts)
import { readFileSync } from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { applyView, type Box, type OrbitView } from './camera';
import { buildFrame, freeArea } from './buildframe';

const STAGE: Box = { x: 0, y: 0, w: 1920, h: 1080 };
/** Live tab boxes as the Edge tabs sit at 1920x1080 (the shelf on the left, the machine list and the rail on the right). */
const SHELF: Box = { x: 0, y: 300, w: 330, h: 520 };
const RAIL: Box = { x: 1844, y: 300, w: 76, h: 520 };
const FLYOUT: Box = { x: 1560, y: 300, w: 280, h: 520 };
/** The machine: a box round the origin, the size of a small case. */
const MACHINE = { size: new Vector3(420, 360, 300), centre: new Vector3(0, 0, 0) };
const PREV: OrbitView = { x: 0, y: 0, z: 0, yaw: 0.6, pitch: 0.4, height: 2000, fov: 28 };

/** The screen corners (CSS px, y down) of the machine box under a view on a stage of `w` x `h`. */
function corners(v: OrbitView, w: number, h: number): { x: number; y: number }[] {
  const cam = new PerspectiveCamera(28, w / h, 1, 1e6);
  applyView(cam, v, w / h);
  cam.updateMatrixWorld(true);
  const out: { x: number; y: number }[] = [];
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5]) {
        const p = new Vector3(
          MACHINE.centre.x + sx * MACHINE.size.x,
          MACHINE.centre.y + sy * MACHINE.size.y,
          MACHINE.centre.z + sz * MACHINE.size.z,
        ).project(cam);
        out.push({ x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h });
      }
  return out;
}

describe('the Build camera frames the machine in the free area', () => {
  it('measures the free area from the live tab boxes, not from constants', () => {
    const a = freeArea(STAGE, [SHELF, RAIL]);
    const moved = freeArea(STAGE, [{ ...SHELF, w: 410 }, RAIL]);
    expect(moved.x).toBeGreaterThan(a.x);
    expect(a.x).toBeGreaterThanOrEqual(SHELF.x + SHELF.w);
    expect(a.x + a.w).toBeLessThanOrEqual(RAIL.x);
  });

  it('keeps the machine 30 px clear of the free area at 1920x1080 with the flyout open', () => {
    const free = freeArea(STAGE, [SHELF, FLYOUT, RAIL]);
    const view = buildFrame(STAGE, [SHELF, FLYOUT, RAIL], MACHINE, PREV, false);
    for (const p of corners(view, STAGE.w, STAGE.h)) {
      expect(p.x).toBeGreaterThanOrEqual(free.x + 30);
      expect(p.x).toBeLessThanOrEqual(free.x + free.w - 30);
      expect(p.y).toBeGreaterThanOrEqual(free.y + 30);
      expect(p.y).toBeLessThanOrEqual(free.y + free.h - 30);
    }
  });

  it('frames the machine in the wider free area when the flyout is closed', () => {
    const open = freeArea(STAGE, [SHELF, FLYOUT, RAIL]);
    const shut = freeArea(STAGE, [SHELF, RAIL]);
    expect(shut.w).toBeGreaterThan(open.w);
    const vOpen = buildFrame(STAGE, [SHELF, FLYOUT, RAIL], MACHINE, PREV, false);
    const vShut = buildFrame(STAGE, [SHELF, RAIL], MACHINE, PREV, false);
    // a wider free area holds the machine at a smaller height of view, so it is drawn larger
    expect(vShut.height).toBeLessThan(vOpen.height);
  });

  it('does not re-frame while a drag is in progress', () => {
    const during = buildFrame(STAGE, [SHELF, FLYOUT, RAIL], MACHINE, PREV, true);
    expect(during).toEqual(PREV);
    // the tabs change mid-drag (the flyout opens under the pointer): the framing still does not move
    const moved = buildFrame(STAGE, [SHELF, RAIL], MACHINE, PREV, true);
    expect(moved).toEqual(PREV);
    // and once the drag ends the same change does re-frame
    expect(buildFrame(STAGE, [SHELF, RAIL], MACHINE, PREV, false)).not.toEqual(PREV);
  });
});

describe('the rim light stays cool', () => {
  it('keeps the Build rim light at the cool 0x8fb0ff, as ADR 0001 says', () => {
    const src = readFileSync(
      urlMod.fileURLToPath(new URL('../../../features/board/render/three/buildstage/studio.ts', import.meta.url)),
      'utf8',
    ) as string;
    expect(src).toMatch(/new DirectionalLight\(0x8f_?b0_?ff,\s*0\.45\)/);
    expect(src).not.toMatch(/0xc8_?d0_?e0/);
  });
});
