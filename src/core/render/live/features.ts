// The feature code the live layer drives (src/core/render/live/): board layout and wiring, the card, drive, RAM and screen views.
// The live modules import it from here, so core keeps one import per feature module (`architecture.test.ts` "core imports of feature code do not grow").
export {
  BD,
  BR,
  GEO,
  MONITOR,
  MONITOR_K,
  PKG,
  PSU_PANEL,
  RAM_SINK,
  type Rect,
  SCREEN,
  SCREEN_D,
  USB_PORT,
  VRM_LED,
  VRM_SINK,
  vrmPhase,
} from '../../../features/board/render/layout/layout';
export {
  type ChipLeg,
  chipLegOf,
  drawPch,
  HIT_MS,
  ledOf,
  type LegHit,
} from '../../../features/board/render/wiring/pchlive';
export {
  type Bus,
  type BusKind,
  type Cable,
  type CableKind,
  type Lane,
  mkLane,
  pointAt,
} from '../../../features/board/render/wiring/routes';
export { drawDriveLive, type DriveKind } from '../../../features/storage/render/drives';
export { EdgeFan } from '../../../features/room/render/desk/props/case';
export { memoryTable, sizeText } from '../../../features/memory/render/ramlayout';
export { type MonitorInput, monitorView, screenMode, standbyLook } from '../../../features/room/render/desk/monitor';
export {
  dashModel,
  type FrameHold,
  frameModel,
  type FrameModel,
  holdFrame,
  IPC_SAMPLES,
  ipcBetween,
} from '../../../features/room/render/desk/screenmodel';
export { assignLeads, getSpec } from '../../../features/board/sim';
export { BusFlow, slice } from '../../../features/board/render/wiring/busflow';
export {
  BIOS_CHAIN,
  boardNetChain,
  BUS_ROLE,
  chipsetChain,
  COOLER_CHAIN,
  deviceAt,
  type DeviceHit,
  driveChain,
  hasTpm,
  type Hop,
  keyChain,
  npuAccess,
  POST_CODE_CHAIN,
  POWER_ON_CHAIN,
  resolve,
  slotChain,
  tpmChain,
  VIDEO_CHAIN,
  VOLTAGE_CHAIN,
} from '../../../features/board/render/wiring/busmap';
export { RamView } from '../../../features/memory/render/ramview';
export { type GpuCardScene, GpuView } from '../../../features/gpu/render/gpuview';
export { DiskView } from '../../../features/storage/render/diskview';
export { type TpmScene, TpmView } from '../../../features/tpm/render/tpmview';
export { NpuCardView, type NpuScene } from '../../../features/npu/render/npuview';
export { FrameView, ScreenView } from '../../../features/room/render/desk/screenview';
export { blades } from '../../../features/board/render/devices';
