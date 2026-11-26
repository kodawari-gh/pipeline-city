import type { Container, Graphics, Text } from 'pixi.js';
import type { Snapshot } from '../../../worker/protocol';
import type { FanMotor } from '../fanmotor';
import type { Theme } from '../theme';
import type { Bus, Cable, DriveKind, GpuCardScene, Hop, Lane, NpuScene, Rect, TpmScene } from './features';

// The types the live modules share: a module takes its types from here and its values from where they live, so no module
// imports the same source twice (once for values, once for types).
export type { Container, Renderer, Sprite, Text, Texture } from 'pixi.js';
export type { LodRect } from '../lod/lod';
export type {
  Bus,
  BusKind,
  Cable,
  CableKind,
  ChipLeg,
  DeviceHit,
  FrameHold,
  FrameModel,
  Hop,
  Lane,
  LegHit,
  MonitorInput,
  Rect,
} from './features';

/** The CPU of a snapshot (any device of it, in fact: the same record type). */
export type Cpu = Snapshot['devices'][number];

/** One row of the OS screen: its text and ink. */
export interface OsRow {
  t: string;
  c: string;
}

/** Per-device rectangle the glow is drawn around, keyed by device id (set by the scene). */
interface GlowTarget {
  id: string;
  kind: string;
  spec: string;
  rect: Rect;
}

export interface Glow {
  t: GlowTarget;
  g: Graphics;
  dim: Graphics;
  base: number;
  level: number;
}
/**
 * A power bus glows (`g`, strength `level`, target `hold`) in proportion to current; a memory bundle (one per stick, `memLit`) sends a packet
 * per access, or every `STREAM_GAP` ms while `stream` is set (re-armed by each snapshot of a phase that moves data). Every other bus is a
 * `Chain` (below), found through `busmap.ts`.
 */
export interface Lit {
  bus: Bus;
  /** The lanes that light (the main run plus the branches of the installed DIMMs). */ lanes: Lane[];
  g: Graphics | null;
  level: number;
  hold: number;
  dir: number;
  color: string;
  power: boolean;
  stream: boolean;
  nextAt: number;
}
/**
 * A message between parts: the hops it takes in order (each on its own lanes, the next starting when the last arrives), and optionally the
 * drive's cable lane before (a read) or after (a write) them, or the video cable after them. `force`: it also runs while the screen is black.
 */
export interface Chain {
  hops: Hop[];
  force?: boolean;
  drive?: { lane: Lane; before: boolean; dir: 1 | -1 } | undefined;
  cable?: boolean;
  /** One stick's bundle after the hops (CPU to stick). */ mem?: number;
  /** The reply: the same legs again, back to front and the other way (a ping). */ pong?: boolean;
}
/**
 * An installed drive: where its moving parts are drawn, its SATA data cable lane (SATA only) and its activity state. `g` null: no art is drawn for it
 * (the 3D board's drives have their own look), but its reads and writes still light its lanes.
 */
interface DriveHook {
  slot: string;
  deviceId: string;
  kind: DriveKind;
  body: { x: number; y: number; w: number; h: number };
  g: Graphics | null;
  lane: Lane | null;
}
export interface DriveLive extends DriveHook {
  busyUntil: number;
  speed: number;
  spin: number;
  head: number;
  led: number;
  sig: string;
  burnt: boolean;
  /** Byte counters of the last snapshot, and the held direction of the last data moved (true: a write). */
  read: number;
  wrote: number;
  ioUntil: number;
  ioWrite: boolean;
}
export interface LitCable {
  cable: Cable;
  g: Graphics;
  level: number;
  target: number;
  color: string;
}
/** A fan of the scene: its art, its kind (`case:<mount>`, `cooler`, `psu`...), and its motor. */
export interface FanLive {
  c: Container;
  kind: string;
  speed: number;
  target: number;
  motor: FanMotor;
}
/** The PSU panel's readout texts. */
export type PsuTexts = Record<'load' | 'of' | 'pct' | 'temp' | 'state' | 'rpm', Text>;

/** What `Live.setScene` gets: the theme, the glow targets, the buses, cables and fans, the RAM chips and sticks, the drives and the cards. */
export interface SceneInput {
  T: Theme;
  targets: GlowTarget[];
  buses: Bus[];
  cables: Cable[];
  fans: { c: Container; kind: string }[];
  dramChips: Rect[];
  dimms: number[];
  flags: { psu: boolean; display: boolean; gfx?: boolean };
  drives: DriveHook[];
  gpuCards: GpuCardScene[];
  tpmModules: TpmScene[];
  npuCards: NpuScene[];
}

/** What `Live.setScene` takes: a `SceneInput` whose drives and cards may be left out (none). */
export type SceneArgs = Omit<SceneInput, 'drives' | 'gpuCards' | 'tpmModules' | 'npuCards'> &
  Partial<Pick<SceneInput, 'drives' | 'gpuCards' | 'tpmModules' | 'npuCards'>>;
