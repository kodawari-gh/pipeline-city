export * from "./view";
export { DataCache, type EngineSettings, type PipelineEngine } from "./common";
export { UnpipelinedEngine } from "./unpipelined";
export { InOrderEngine, type InOrderSettings } from "./inorder";

import { RefEngine, type Engine } from "../machine";
import type { EngineSettings } from "./common";
import { InOrderEngine, type InOrderSettings } from "./inorder";
import { UnpipelinedEngine } from "./unpipelined";

/** Which engine a machine's CPU uses. Plain data, so it can live in a save / device spec. */
export type EngineConfig =
  | { kind: "ref" }
  | ({ kind: "unpipelined" } & EngineSettings)
  | ({ kind: "inorder" } & InOrderSettings);

/** Build an engine; attach it with `machine.attach(createEngine(cfg), program)`. */
export function createEngine(cfg: EngineConfig): Engine {
  switch (cfg.kind) {
    case "ref": return new RefEngine();
    case "unpipelined": return new UnpipelinedEngine(cfg);
    case "inorder": return new InOrderEngine(cfg);
  }
}
