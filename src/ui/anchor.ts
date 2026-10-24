// The renderer's screen anchors for world ids (docs/RENDER.md "Anchors"), re-exported so the UI imports the renderer
// from one place. Recompute whenever `cameraRev` (src/game/interaction.ts) changes.
export { anchorOf, flyTo, hasTarget } from '../render/board';
export type { Anchor } from '../render/board';
