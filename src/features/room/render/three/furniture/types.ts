// The types this folder's modules take from other modules, in one place: a module that takes values from a module takes its types here.
export type {
  BufferGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3Tuple,
} from 'three';
export type { V3 } from '@/core/render/three/contact';
export type { BedForm } from '../bedding3d';
export type { Book } from './books';
export type { RectLike } from '@/core/render/three/geometry';
