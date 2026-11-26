// Contextual part picker, pure logic: what the side card shows for the selected id. No DOM, no signals.
// The card opens only when the renderer selects something (`selected`). Parts are placed by dragging from the
// inventory tray (or the world); the card offers purchases (into the inventory), the clock, power and job actions.
// This file is the picker's public face; the code lives in the modules it re-exports (docs/UI.md, "Picker").

export type {
  CompareRow,
  IconName,
  LadderStep,
  OsSection,
  PickerAction,
  PickerKind,
  PickerLine,
  PickerModel,
  Stat,
} from './pickerTypes';
export { pickerFor } from './pickerFor';
export { osSection } from './osSection';
export { boardId, caseId, kindOf } from './pickerKinds';
export { ladderFor, nextUpgrade } from './pickerLadder';
export { compareRows, goodness, statsOf } from './pickerStats';
export { specBrief } from './specBrief';
export { clockZones, estTempC, installedCooler, zoneOf } from './clockZones';
export type { ZoneName } from './clockZones';
