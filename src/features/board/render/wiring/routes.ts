// The board's routed wiring, one import path for its many users: the lane math (`lane.ts`), the buses (`buses.ts` and the bus modules it
// calls), the PSU and video cables (`cables.ts`) and the unplugged cables (`loose.ts`).
export { roundedPath } from '@/core/render/cable';
export { buildBuses } from './buses';
export { DRAM_IN_X, DRAM_OUT_X, HOP_BUSES, NVME_LANES, VRM_OUT_X, vdimmEnd, vdimmStart } from './bus';
export type { Bus, BusKind } from './bus';
export { offsetLine } from './bundle';
export { buildCables, isPcieKind } from './cables';
export type { Cable, CableKind, PcieTarget, Plug } from './cables';
export { crossings, mkLane, pointAt, visibleParts } from './lane';
export type { Lane, Pt } from './lane';
export { looseCable, movablePlug } from './loose';
