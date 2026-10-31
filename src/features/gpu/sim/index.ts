import type { GpuConfig, GpuEngine } from "./engine";
import { MultiEngine } from "./multi";
import { SimdEngine } from "./simd";
import { WarpEngine } from "./warp";

export * from "./engine";
export { MultiEngine } from "./multi";
export { SimdEngine } from "./simd";
export { WarpEngine } from "./warp";

/** Build the engine a config describes (the GPU's `createEngine`). */
export function createGpu(cfg: GpuConfig): GpuEngine {
  if (cfg.kind === "multi") return new MultiEngine(cfg);
  return cfg.kind === "warp" ? new WarpEngine(cfg) : new SimdEngine(cfg);
}
