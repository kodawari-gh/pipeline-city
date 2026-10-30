import type { GpuConfig, GpuEngine } from "./engine";
import { SimdEngine } from "./simd";
import { WarpEngine } from "./warp";

export * from "./engine";
export { SimdEngine } from "./simd";
export { WarpEngine } from "./warp";

/** Build the engine a config describes (the GPU's `createEngine`). */
export function createGpu(cfg: GpuConfig): GpuEngine {
  return cfg.kind === "warp" ? new WarpEngine(cfg) : new SimdEngine(cfg);
}
