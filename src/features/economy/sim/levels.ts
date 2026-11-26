// Player levels (docs/PROGRESSION.md): the CLIENT BASE score, the 18 levels and what each changes, the unlock table, the
// job classes with their needs and the arrival mix. Pure data plus small helpers; no DOM. ALL NUMBERS ARE PLACEHOLDERS,
// kept in levelsClasses.ts (JOB_CLASSES) and levelsTable.ts (the LEVELS rows) so the balance pass touches two places.

export type { Need, JobClassId, JobClassDef } from './levelsClasses';
export { JOB_CLASSES, jobClass, classOfTemplate } from './levelsClasses';
export type { Caps } from './levelsNeed';
export { NO_CAPS, describeNeed, needsMet } from './levelsNeed';
export type { ItemInfo } from './levelsTable';
export { LEVELS, MAX_LEVEL, START_CRATE, isPlannedItem, unlockLevelOf, itemInfo } from './levelsTable';
export type { LevelRowSnap } from './levelsProgress';
export {
  pointsFor,
  levelFor,
  levelDef,
  patienceMul,
  levelPayMul,
  levelDemandMul,
  jobMix,
  pickClass,
  levelRows,
} from './levelsProgress';
