// Types the cooler's modules take from a module they also take values from: the values come from the module, the types from here, one import each.
import type { BoxGeometry, Group } from 'three';
import type { Plane, Solid } from '@/core/render/three/rope';
import type { Frame, RadiatorFit } from '../../cooler';

export type { BufferGeometry, Group, Material, MeshStandardMaterial } from 'three';
export type { RectLike } from '@/core/render/three/geometry';
export type { RopeEnd, RopeSpec, V3 } from '@/core/render/three/rope';
export type { RadiatorFit } from '../../cooler';
export type { FanFit, Spin } from '../fans3d';

/** A radiator being built: its root, its frame and length along the side, its core's span and thickness, and its depths across the case. */
export interface Rad {
  root: Group;
  fr: Frame;
  L: number;
  v0: number;
  v1: number;
  t: number;
  side: RadiatorFit['mount']['side'];
  D: number;
  zc: number;
  z0: number;
  z1: number;
  /** How far a fan's screw holes are from its middle, and how far each side plate folds over a face. */
  hole: number;
  fold: number;
  /** The unit box every plain part scales. */
  unit: BoxGeometry;
}

/** The space a hose hangs in: the case's walls and the boxes in its way. */
export interface Env {
  planes: Plane[];
  solids: Solid[];
}
