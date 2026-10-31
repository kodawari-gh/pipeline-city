// gpu3: several SMs on one card (docs/GPU.md section 4). Each SM is the gpu2 core (warps, scoreboard, round-robin scheduler, its own banks
// and memory unit, `bar` among its own warps); the launch's lanes are dealt to SMs in order, each SM has an L1 tag array and all of them
// share one L2 whose port takes one request per cycle. The SM loop and timing rules are in warp.ts.

import type { MultiConfig } from "./engine";
import { SmEngine } from "./warp";

export class MultiEngine extends SmEngine {
  constructor(cfg: MultiConfig) {
    super({
      sms: cfg.sms, warps: cfg.warps, lanes: cfg.lanes, memBytes: cfg.memBytes, banks: cfg.banks,
      mem: { lineWords: cfg.lineWords, globalLatency: cfg.globalLatency, l1Lines: cfg.l1Lines, l1Hit: cfg.l1Hit, l2Lines: cfg.l2Lines, l2Hit: cfg.l2Hit },
    });
  }
}
