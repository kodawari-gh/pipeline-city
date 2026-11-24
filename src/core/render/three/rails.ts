// A part with a detailed view (the CPU's die, a card's die, the TPM, the memory map on the sticks, a drive) is a rail: the parts register them
// (`Machine3D.rails`), and a double click or tap on the part flies to its aligned view (`focusPart` in board3d.ts). Nothing holds the view on
// them: the camera stays where the player leaves it, at any angle and any depth (docs/render/interact.md "Camera").
import type { Box } from './camera';

/**
 * A part with a detailed view: its face (a layout rect, y down) at depth `z`, and the zoom its detail shows from (screen pixels per world unit).
 * `lie`: the part lies on a shelf, not on a wall (the router's board in its shell): its `rect` is its east-west span at the height of its top (`rect.y` is minus that height, `rect.h` 0),
 * `z` the depth of its middle, and the flight looks down on it from the front, tilted as far as the camera goes. `lie.y` is the world height of its top, `lie.d` the depth it covers.
 * A card on edge is such a part (its face looks up). `angle`: the part's face does not look at the glass (the memory sticks' faces look east): the flight turns the view to this yaw and
 * pitch, as the player would, and ends there; nothing turns the camera by itself on the way in.
 */
export interface Rail {
  id: string;
  rect: Box;
  z: number;
  zoom: number;
  lie?: { y: number; d: number };
  angle?: { yaw: number; pitch: number };
}
