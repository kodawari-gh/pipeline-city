export * from './view';
export { type PipelineEngine } from './contract';
export { UnpipelinedEngine } from './unpipelined';
export { InOrderEngine, type InOrderSettings } from './inorder';
export { OooEngine } from './ooo';

import * as sim from '@/core/sim';
import type { EngineSettings } from './contract';
import * as inorder from './inorder';
import * as ooo from './ooo';
import { UnpipelinedEngine } from './unpipelined';

/** Which engine a machine's CPU uses. Plain data, so it can live in a save / device spec. */
export type EngineConfig =
  | { kind: 'ref' }
  | ({ kind: 'unpipelined' } & EngineSettings)
  | ({ kind: 'inorder' } & inorder.InOrderSettings)
  /** 2-wide in-order superscalar (the in-order engine with width 2). */
  | ({ kind: 'inorder2' } & Omit<inorder.InOrderSettings, 'width'>)
  | ({ kind: 'ooo' } & ooo.OooSettings);

/** Build an engine; attach it with `machine.attach(createEngine(cfg), program)`. */
export function createEngine(cfg: EngineConfig): sim.Engine {
  switch (cfg.kind) {
    case 'ref': {
      return new sim.RefEngine();
    }
    case 'unpipelined': {
      return new UnpipelinedEngine(cfg);
    }
    case 'inorder': {
      return new inorder.InOrderEngine(cfg);
    }
    case 'inorder2': {
      return new inorder.InOrderEngine({ ...cfg, width: 2 });
    }
    case 'ooo': {
      return new ooo.OooEngine(cfg);
    }
  }
}
