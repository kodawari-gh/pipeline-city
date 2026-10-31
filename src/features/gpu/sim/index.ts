import type { GpuConfig, GpuEngine } from "./engine/engine";
import { MultiEngine } from "./engine/multi";
import { SimdEngine } from "./engine/simd";
import { WarpEngine } from "./engine/warp";

export * from "./engine/engine";
export { MultiEngine } from "./engine/multi";
export { SimdEngine } from "./engine/simd";
export { WarpEngine } from "./engine/warp";

/** Build the engine a config describes (the GPU's `createEngine`). */
export function createGpu(cfg: GpuConfig): GpuEngine {
  if (cfg.kind === "multi") return new MultiEngine(cfg);
  return cfg.kind === "warp" ? new WarpEngine(cfg) : new SimdEngine(cfg);
}
