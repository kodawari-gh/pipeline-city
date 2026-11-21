// A part with a detailed view (the CPU's die, a card's die, the TPM, the memory map on the sticks, a drive) is a rail: the parts register them
// (`Machine3D.rails`), and a double click or tap on the part flies to its aligned view (`focusPart` in board3d.ts). Nothing holds the view on
// them: the camera stays where the player leaves it, at any angle and any depth (docs/render/interact.md "Camera").
import type { Box } from './camera';

/** A part with a detailed view: its face (a layout rect, y down) at depth `z`, and the zoom its detail shows from (screen pixels per world unit). */
export interface Rail { id: string; rect: Box; z: number; zoom: number }
