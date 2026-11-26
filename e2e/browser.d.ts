// Types for what the e2e scripts read in the page: the game modules they import from the dev server
// (`await import('/src/...')` inside `page.evaluate`) and the globals they set there. Each declaration lists only
// the exports a script uses, with the type the module has in src/.

declare module '*/src/worker/game/game.ts' {
  export class Game {
    constructor(opts: { seed: number });
    toSave(): unknown;
  }
}

declare module '*/src/app/hover.ts' {
  export const viewInset: { value: { top: number; right: number; bottom: number; left: number } };
}

/** The part of the game's Snapshot (src/worker/game/types.ts) that the e2e scripts read. */
interface GameSnapshot {
  money: number;
  baseTick: number;
  powered: boolean;
  tray: { id: number; runnable: boolean }[];
  plugged: { id: number } | null;
  inventory: { id: string; kind: string; freeSlots: string[]; swapSlots: string[] }[];
  cables: { id: string; connected: boolean }[];
}

/** A world id's rectangle on screen (src/features/board/render/board.ts). */
interface ScreenAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

declare module '*/src/app/store.ts' {
  export const speed: { value: number };
  export const snapshot: { value: GameSnapshot | null };
  export function setSpeed(s: number): void;
}

declare module '*/src/app/interaction.ts' {
  export const highlight: { value: string[] };
  export const dragging: { value: { kind: 'part' | 'cable' | 'key'; id: string; fromBoard?: boolean } | null };
}

declare module '*/src/features/tutorial/ui/anchor.ts' {
  export function anchorOf(id: string): ScreenAnchor | null;
}

declare module '*/src/features/tutorial/ui/tutorial.ts' {
  export const STEPS: {
    id: string;
    title: string;
    text: string;
    targets: (s: GameSnapshot, drag?: unknown) => string[];
  }[];
}

declare module '*/src/core/ui/state.ts' {
  export function pauseForTutorialPopup(open: boolean): void;
}

interface HTMLCanvasElement {
  /** The browser's own getContext, kept by errors.e2e.mjs's NO_WEBGL when it turns WebGL off. */
  getContextWithWebGl(type: string, options?: unknown): RenderingContext | null;
}

declare module '*/src/app/boot.ts' {
  export const booted: { value: boolean };
}

/** Set by errors.e2e.mjs before "Try again": a reload clears it. */
declare var __loadedBefore: boolean | undefined;
/** URL.createObjectURL as the browser has it, kept by errors.e2e.mjs while the download is refused. */
declare var __createObjectURL: PropertyDescriptor | undefined;
/** The 3D board's dev hook (src/features/board/render/three/board3d.ts, dev builds only). */
declare var __board: { idAt?: (x: number, y: number, raw?: boolean) => string | null } | undefined;

interface Performance {
  /** Chrome only: the page's JS heap. */
  memory?: { usedJSHeapSize: number };
}
