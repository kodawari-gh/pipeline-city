// The game's dev hooks as the tools under tools/ read them in the page (`page.evaluate`): the members they use, typed from the game's own
// classes. The hooks exist on the dev server only (`import.meta.env.DEV`); a tool waits for one before it reads it.
import type { Machine3D } from '@/features/board/render/three/machine3d';
import type { Room3D } from '@/features/room/render/three/room3d';

/** `window.__board` (`board3d.ts`): the 3D board's parts. */
interface BoardHook {
  parts: () => { room: Room3D | null; machine: Machine3D | null };
}

declare global {
  // (`var`: a global's own declaration form, so `globalThis.__board` has the type)
  var __board: BoardHook | undefined;
}
