// The machine in 3D (docs/render/three.md): the glass-side case, the motherboard with its sockets, every installed part, the
// fans the player fitted, the power cables and the wall cords. Its modules are in machine/: the parts it keeps (state.ts), its build
// (build.ts, then case, board, list, cables and cords), its answers (queries.ts), its frame (frame.ts), its level of detail (lod.ts) and
// its face, `Machine3D` (machine.ts). This file keeps the names its callers import.
export { LAN_LEAD } from './machine/consts';
export { machineKey } from './machine/keys';
export { Machine3D } from './machine/machine';
