// The symbols inside a GPU card's blocks (docs/DIE.md "Inside the blocks"): the public face of the modules in this folder.
export { GPU_GLYPH_KINDS, gpuGlyphArea, hasGpuSymbol } from './area';
export { decodeGeom, gpuControlIndices, gpuControlLines, gpuSlotValues } from './decode';
export { gpuGlyph } from './draw';
export { ALU_UNITS, aluUnitOf, fetchGeom, laneUnits, launchGeom, pcArea, pcieGeom } from './geom';
export { gpuGlyphLive, gpuHostLive } from './live';
