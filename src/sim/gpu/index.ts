import type { GpuConfig, GpuEngine } from "./engine";
import { SimdEngine } from "./simd";

export * from "./engine";
export { SimdEngine } from "./simd";

/** Build the engine a config describes (the GPU's `createEngine`). */
export function createGpu(cfg: GpuConfig): GpuEngine {
  return new SimdEngine(cfg);
}
