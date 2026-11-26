// The board part specs, split by responsibility (one module each); this file keeps the old import path for its many importers.
// Types: `specTypes.ts`; thermal constants: `specThermal.ts`. The part lists: `cpuSpecs.ts`, `cpuBranchSpecs.ts`, `memPowerSpecs.ts`, `coolingSpecs.ts`, `fanSpecs.ts`,
// `storageNicSpecs.ts`, `cardSpecs.ts`. The list and its lookups: `catalog.ts`. Boards and cases: `caseBoardSpecs.ts`.

export type { BoardFeatures, VrmSpec } from './caseBoardSpecs';
export { BOARD_TIERS, CASE_TIERS, caseFor, caseMounts, pcieLabel } from './caseBoardSpecs';
export { DEVICE_SPECS, basicFan, fanShare, getSpec, specList, specsOfKind } from './catalog';
export type {
  CardSpec,
  CoolerSpec,
  CpuSpec,
  DeviceKind,
  DeviceSpec,
  DisplaySpec,
  FanSize,
  FanSpec,
  FanSpots,
  NicSpec,
  PsuSpec,
  RadiatorSpec,
  RamSpec,
  SlotType,
  StorageSpec,
  TpmSpec,
  VrmSinkSpec,
} from './specTypes';
export { PCIE_POWER_MIN_TIER, PCIE_SLOT_W, cardLeads } from './specTypes';
export { AMBIENT_C, DAMAGE_TICKS } from './specThermal';
