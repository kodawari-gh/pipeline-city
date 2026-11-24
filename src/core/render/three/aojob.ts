// The baked occlusion's one pure call (`vertexao.ts`): what a worker casts for a group (`aojob.worker.ts`, `aopool.ts`), and what the page casts
// itself when it has no worker. It imports no Three, so the worker's code stays small.
import { occlusion } from './cloth/occlusion';

/** The rays cast a side from each point. */
const AO_RAYS = 24;

/** One group's cast: the arrays `occlusion` takes, how far the rays reach (world units) and how many points are cast (the rest only block). */
export interface AoJob {
  pos: Float32Array;
  nrm: Float32Array;
  tris: Uint32Array;
  weld: Int32Array;
  one: Uint8Array;
  reach: number;
  cast: number;
}

/** A job sent to a worker, and what it sends back: the open shares (two a cast point) or why it could not. */
export interface AoAsk {
  id: number;
  job: AoJob;
}
export type AoAnswer = { id: number; ao: Float32Array } | { id: number; error: string };

/** No solid: only triangles block. */
const open = (): number => Infinity;

/** The open shares of a job's cast points. */
export const runAoJob = (j: AoJob): Float32Array =>
  occlusion(j.pos, j.nrm, j.tris, j.weld, open, AO_RAYS, j.reach, 0, j.cast, j.one);
