// Messages between the main thread and the sim worker. Keep this file
// free of DOM and Pixi imports: it is shared by both sides.

export type ToSim =
  | { type: 'init'; save: SaveV1 | null }
  | { type: 'setSpeed'; cyclesPerSecond: number };

export type FromSim =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot };

/** Read-only view of the sim for the renderer and UI. Grows as the sim does. */
export interface Snapshot {
  cycle: number;
  money: number;
}

/** Game config only; micro-state (pipeline contents) is rebuilt by replay. */
export interface SaveV1 {
  version: 1;
  seed: number;
  money: number;
}
