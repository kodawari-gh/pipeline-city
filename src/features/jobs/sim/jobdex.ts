// The job almanac (docs/JOBS.md): what each kind of job is, what it stresses and how to be better at it, revealed in stages as the player meets it:
// unseen (a silhouette and the level it arrives at), seen (what it is and what it needs), done (once finished: the tips and the player's own record).
// The old import path, kept because many files import it: the data is in dex/ (catalog.ts and the entries.*.ts groups), the helpers in dex/tasks.ts and dex/query.ts.

export { DEX_GROUPS, JOB_DEX } from './dex/catalog';
export { dexEntry, dexGroup, dexNeeds, dexNumber, dexState, needChips } from './dex/query';
export { classBlocked, pickTask, taskLevel, taskNeeds, taskOfTemplate } from './dex/tasks';
export type { DexEntry, DexGroup, DexRecord, DexSnap, TipPart } from './dex/types';
