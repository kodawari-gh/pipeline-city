// For tests that build the machine in Node: Pixi's canvases draw nothing there, and the clock stands still.
import { afterAll, beforeAll, vi } from 'vitest';
import { DOMAdapter } from 'pixi.js';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { Machine3D } from './machine3d';

// The 2D art draws on Pixi canvases: in Node a canvas that draws nothing is enough (the art bakes on its queue later, and never here).
const nothing: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => nothing });
const context = () => new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 1, actualBoundingBoxAscent: 1, actualBoundingBoxDescent: 1 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : nothing),
  set: () => true,
});
const canvas = () => ({ width: 1, height: 1, style: {}, getContext: context, addEventListener() {}, toDataURL: () => '' });

/** Call at the top of a test file: Pixi gets canvases that draw nothing and `performance.now` stands still, for the file's tests. */
export function quietCanvas(): void {
  const adapter = DOMAdapter.get();
  beforeAll(() => { DOMAdapter.set({ ...adapter, createCanvas: canvas } as unknown as typeof adapter); vi.spyOn(performance, 'now').mockReturnValue(100); });
  afterAll(() => { DOMAdapter.set(adapter); vi.restoreAllMocks(); });
}

/** The sandbox's biggest machine. */
export const maxedSnapshot = (): Snapshot => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }).snapshot();

/** The machine of `s` as the room builds it, merged (`share`) or not, with the distance stand-ins (`lod`, PERF6) or not. */
export const buildMachine = (s: Snapshot | null, merge: boolean, lod = false): Machine3D => new Machine3D(s, roomGeo(), new BakeQueue(), null, true, merge, lod);
