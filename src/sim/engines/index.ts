export * from "./view";
export { DataCache, type EngineSettings, type PipelineEngine } from "./common";
export { UnpipelinedEngine } from "./unpipelined";
export { InOrderEngine, type InOrderSettings } from "./inorder";
export { OooEngine, type OooSettings } from "./ooo";

import { RefEngine, type Engine } from "../machine";
import type { EngineSettings } from "./common";
import { InOrderEngine, type InOrderSettings } from "./inorder";
import { OooEngine, type OooSettings } from "./ooo";
import { UnpipelinedEngine } from "./unpipelined";

/** Which engine a machine's CPU uses. Plain data, so it can live in a save / device spec. */
export type EngineConfig =
  | { kind: "ref" }
  | ({ kind: "unpipelined" } & EngineSettings)
  | ({ kind: "inorder" } & InOrderSettings)
  /** 2-wide in-order superscalar (the in-order engine with width 2). */
  | ({ kind: "inorder2" } & Omit<InOrderSettings, "width">)
  | ({ kind: "ooo" } & OooSettings);

/** Build an engine; attach it with `machine.attach(createEngine(cfg), program)`. */
export function createEngine(cfg: EngineConfig): Engine {
  switch (cfg.kind) {
    case "ref": return new RefEngine();
    case "unpipelined": return new UnpipelinedEngine(cfg);
    case "inorder": return new InOrderEngine(cfg);
    case "inorder2": return new InOrderEngine({ ...cfg, width: 2 });
    case "ooo": return new OooEngine(cfg);
  }
}
