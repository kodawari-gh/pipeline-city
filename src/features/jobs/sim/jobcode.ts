// The almanac's code view (docs/JOBS.md "Reading the code"): a job's real program as the machine runs it, its high-level source and its picture.
// The old import path, kept because many files import it: the modules are in code/ (profile.ts, source.ts, highLevel.ts, sprite.ts, opClass.ts).

export { HIGH_LEVEL } from './code/highLevel';
export { OP_CLASSES, opClassOf } from './code/opClass';
export { mixShares, profileOf, reliance } from './code/profile';
export { CODE_SOURCE } from './code/source';
export { spriteOf } from './code/sprite';
export type { Sprite } from './code/sprite';
export type { CodeLine, CodeProfile, OpClass } from './code/types';
