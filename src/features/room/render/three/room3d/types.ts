// The types this folder's modules take from other modules, in one place: a module that takes values from a module takes its types here.
export type {
  CanvasTexture,
  Color,
  Group,
  Light,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
  Texture,
  WebGLRenderer,
} from 'three';
export type { Bake, LightmapMix } from '@/core/render/three/lightmapmix';
export type { RoomEnv } from '../roomenv';
export type { Arrival, RoomFrame, RoomParts, RoomStep } from './parts';
export type { Ao, Build } from './start';
export type { AoPool } from '@/core/render/three/aopool';
export type { Rect } from '@/features/board/render/layout/layout';
export type { RoomGeo } from '../../shell/room';
export type { CityDetail } from '../outside/detail';
export type { LightId } from '../roomlights';
export type { Bed } from '../furniture/bed';
export type { Bedside, Lantern } from '../furniture/lanterns';
export type { KeySnap } from '@/worker/game/types';
export type { BoxEnv } from '@/core/render/three/boxenv';
export type { JackLamps } from '@/features/board/render/three/rj45jack3d';
export type { LinkLevels } from '@/features/network/render/jackleds';
export type { OutsideView } from '../outside/view';
export type { Cup, DigitalClock, Lamp, Monitor, Screen } from '../props3d';
export type { OakMaps } from '../furniture/oak';
export type { Program } from '@/core/render/three/compile';
export type { DeskBase } from './desk';
export type { RouterKit } from './jack';
