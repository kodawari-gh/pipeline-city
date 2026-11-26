// Types the world's modules take from a module they also take values from: the values come from the module, the types from here, one import each.
export type { Object3D } from 'three';
export type { Graphics } from '@/app/graphics';
export type { Box, KeepOpts, OrbitView } from '@/core/render/three/camera';
export type { Pt } from '@/core/render/three/gesture';
export type { Drag3D } from '../drag3d';

/** A client point. */
export interface At {
  clientX: number;
  clientY: number;
}
