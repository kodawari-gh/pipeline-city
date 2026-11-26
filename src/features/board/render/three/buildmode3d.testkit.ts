// Test-only seam for the buildmode3d tests: it builds a BuildStage on a stub host and exposes the private stage state the tests read and replace.
// It holds the one cast these tests need. The 3D context, the post chain and the lenses come from each test's own mocks.
import { BuildStage } from './buildmode3d';

/** A stub host: the stage reads only its size. */
export interface Host {
  clientWidth: number;
  clientHeight: number;
}

/** The host size the tests use when they do not name one. */
const HOST: Host = { clientWidth: 400, clientHeight: 800 };

/** The private members of `o` (a stage, or the BuildStage class) that `T` names, read and written in place. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, typescript/no-unsafe-type-assertion -- tests reach private stage state
export const inside = <T extends object>(o: object): T => o as T;

/** A BuildStage made through its private constructor, on a stub host. */
export function newStage(host: Host = HOST): BuildStage {
  return new (inside<new (h: Host) => BuildStage>(BuildStage))(host);
}

/** `BuildStage.open` on a stub host (it reads only the host's size, and the stage never reaches the page). */
export async function openStage(host: Host, signal?: AbortSignal): Promise<BuildStage> {
  const seam = inside<{ open: (h: Host, signal?: AbortSignal) => Promise<BuildStage> }>(BuildStage);
  const s = await seam.open(host, signal);
  return s;
}
