// The room's build in stages (`buildRoom`): the shell with its window and bench, and the desk with the column's things and the light.
import { buildBench } from './bench';
import { buildColumn } from './column';
import { deskBase } from './desk';
import { lightRig } from './lighting';
import { buildPlates } from './plates';
import { buildFloor, buildSkirting, buildWalls } from './shell';
import { setDesk } from './tabletop';
import { buildWindow } from './window';
import type { Build, Texture } from './types';

/** The walls, the skirting, the floor, the window and the bench. */
export function buildShell(b: Build): void {
  buildWalls(b);
  buildSkirting(b);
  buildFloor(b);
  buildWindow(b);
  buildBench(b);
}

/** The desk and what stands on it, the column's things and the plates, and the light (`env`: the reflections' first). */
export function buildDesk(b: Build, env: Texture | null): void {
  const base = deskBase(b);
  setDesk(b, base);
  buildColumn(b, base.steel);
  buildPlates(b);
  lightRig(b, env);
}
