// The 3D room (`room.ts`), split by what each part does; this is its public face, as `room3d.ts` was.
export { BEDSIDE_FAR, BEDSIDE_LAYER, PROBE_K, SUN_HOURS } from './consts';
export { cityLayers, cityMesh, prepareCity } from './city';
export { mergeAfterBake, preloadRoomBake } from './bake';
export { deskSlab, drawerUnit } from './desk';
export { oakFloor } from './planks';
export { Room3D } from './room';
