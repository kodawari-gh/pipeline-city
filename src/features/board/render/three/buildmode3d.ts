// BUILD MY PC (docs/PC_PARTS.md): the machine alone on a plain stage, away from the room, to build it, swap its parts and watch every part come out and go in.
// It runs a sandbox `Game` on the main thread (the real rules: `install`, `uninstall`, `connectCable`) and draws its snapshot with the game's own `Machine3D`.
// What has to come out before what is the removal graph (`sim/removal.ts`); how each step looks is `buildmotion.ts`. A swap or a removal takes out
// every part that stands in the way (in the graph's order), does the job, then puts those parts back in reverse order.
// The case's shell and the board are one piece here: swapping either plays the whole machine lifting away (the parts in it come out first).
// The stage itself lives in `buildstage/` (one layer of the class per file, `buildstage/buildstage.ts` on top); this file keeps the public import path.
export { BuildStage } from './buildstage/buildstage';
export type { BinPart } from './buildstage/types';
export { LOD_CEIL } from './buildstage/tuning';
export { SnapCache, binParts, shellRefusal } from './buildstage/parts';
/** @public `tools/clipcheck.mjs` loads it from this file by its URL. */
export { motionOf } from './buildstage/parts';
