// The types the machine's modules share (machine3d.ts), in one place: each module imports its types from here and its values from where they live.
export type { Theme } from '@/core/render/theme';
export type { ArtSurface, BakeQueue } from '@/core/render/three/artlod';
export type { CasePass } from '@/core/render/three/caseshade';
export type { Board3D } from '../boardmodel3d';
export type { RectLike } from '@/core/render/three/geometry';
export type { PartSkin, PartState } from '@/core/render/three/materials';
export type { LodScope, PartLod } from '@/core/render/three/partlod';
export type { Role } from '@/core/render/three/powerscale';
export type { Rail } from '@/core/render/three/rails';
export type { Plane as RopePlane, RopeEnd, Solid as RopeSolid, V3 } from '@/core/render/three/rope';
export type { Shown } from '@/features/board/sim/buildspecs';
export type { DeviceSpec } from '@/features/board/sim/specs';
export type { LinkLevels } from '@/features/network/render/jackleds';
export type { FanMount } from '@/features/room/render/desk/props/case';
export type { CaseKind } from '@/features/room/render/shell/casedecor';
export type { StripMode } from '@/features/room/render/shell/exterior';
export type { RoomGeo } from '@/features/room/render/shell/room';
export type { MonitorPlan } from '@/features/room/render/three/monitor3d';
export type { LightId } from '@/features/room/render/three/roomlights';
export type { DeviceSnap, Snapshot } from '@/worker/game/types';
export type {
  Box3,
  Group,
  Intersection,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
} from 'three';
export type { CableKind } from '../../wiring/routes';
export type { PcieKind } from '../../wiring/types';
export type { FanCordPlan } from '../../wiring/fancords';
export type { AirBody } from '../air/plan';
export type { ArtBaker } from '../bake';
export type { CableRig, Rest, Seat } from '../cablerig3d';
export type { Card3D } from '../card3d';
export type { CaseModel } from '../case3d';
export type { Chips3D } from '../chips3d';
export type { LoopHoses, RadiatorAt, RadiatorFlow } from '../cooler3d';
export type { CagePlan } from '../drivecage3d';
export type { FanFit, Spin } from '../fans3d';
export type { Lists, PartBuild, PartContext, Reveal, phyBits } from '../parts';
export type { PortKind } from '../plugs3d';
export type { CableRun, RigPower } from '../power/runs';
export type { RamMap3D } from '../rammap3d';
export type { JackLamps } from '../rj45jack3d';
export type { RouterStand } from '../router3d';
export type { RouterBoard } from '../routerboard3d';
export type { StageWall } from '../studiowall3d';
export type { Env, GrommetStyle, HangOpts, Look } from '../wires3d';
export type { Fan, PickBox } from './consts';
export type { Inside } from './inside';
export type { Outside } from './outside';
export type { BuiltRig, Door, MachineParts } from './state';
export type { Fill } from './swap';
export type { Diff } from './diff';
export type { Cord } from './cord-kit';
export type { Jack } from './lan-jacks';
export type { Machine3D } from './machine';
export type { MakeOpts } from './slices';
