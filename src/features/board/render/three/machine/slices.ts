// The machine's build a slice at a time (machine3d.ts, `Machine3D.make`): the steps run until `budget` ms have passed, then the page has its turn.
import { SLICE_MS } from './consts';
import type { Shown, StageWall } from './types';

/** How `make` builds: as the constructor's flags, and the slices it gives the page. */
export interface MakeOpts {
  merge?: boolean;
  lod?: boolean;
  slice?: () => Promise<void>;
  budget?: number;
  stop?: () => boolean;
  shown?: Shown;
  wall?: StageWall | null;
}

/** The page's turn: a task of its own. */
async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Run the build's steps until `budget` ms have passed since `from`: true when the build is done. */
function stepFor(run: Generator<void>, from: number, budget: number): boolean {
  for (let step = run.next(); step.done !== true; step = run.next()) {
    if (performance.now() - from >= budget) {
      return false;
    }
  }
  return true;
}

/** The slices of a build in turn: `slice` is awaited between them. False: `stop` ended the build. */
async function slices(run: Generator<void>, o: MakeOpts, from: number): Promise<boolean> {
  if (stepFor(run, from, o.budget ?? SLICE_MS)) {
    return true;
  }
  await (o.slice ?? nextTask)();
  if (o.stop?.() === true) {
    return false;
  }
  return slices(run, o, performance.now());
}

/** Run a build a slice at a time from now: false when `stop` ended it. */
export const sliced = async (run: Generator<void>, o: MakeOpts): Promise<boolean> => slices(run, o, performance.now());
