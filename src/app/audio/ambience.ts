// The ambience controller: which loops play, and how the hum follows the fans and the clock. Pure TS (no Web Audio):
// the director owns one and the engine is its sink (`engine.ts`), so a test drives it with a fake. Numbers come from MIX.
import { MIX } from './mixTokens';

export type LoopId = 'amb_room_city_loop' | 'amb_machine_hum_loop';
export const LOOP_IDS: readonly LoopId[] = ['amb_room_city_loop', 'amb_machine_hum_loop'];

const ROOM: LoopId = 'amb_room_city_loop';
const HUM: LoopId = 'amb_machine_hum_loop';

export interface AmbienceSink {
  /** Fade a loop in over `fadeInMs`. A loop not yet decoded starts when it loads. */
  startLoop(id: LoopId, fadeInMs: number): void;
  /** Fade a loop out over `fadeOutMs`, then stop it. */
  stopLoop(id: LoopId, fadeOutMs: number): void;
  /** The hum's level (dB) and playback rate, each ramped over `smoothMs`. */
  setHum(gainDb: number, rate: number, smoothMs: number): void;
  /** Dip the hum by `gainDb` (0 or less) over `fadeMs`. 0 lifts the dip. */
  duckHum(gainDb: number, fadeMs: number): void;
}

/** The part of a device snapshot the hum needs. */
export interface FanDevice {
  kind?: string;
  /** 0..1: how fast the device's fan turns (`DeviceSnap.fan`). */
  fan?: number;
  /** 0..1: the device's throttle (`DeviceSnap.throttle`, 1 is full speed); the stress reads the worst one. */
  throttle?: number;
}

/** Device kinds that have a fan of their own (types.ts `DeviceSnap.fan`: graphics and neural cards). */
const FAN_KINDS: readonly string[] = ['gpu', 'npu'];

/** A device has a fan when it is a fan kind (gpu, npu; a card at rest still counts) or its fan is turning. */
const hasFan = (d: FanDevice): boolean => FAN_KINDS.includes(d.kind ?? '') || (d.fan ?? 0) > 0;

/** Mean fan speed (0..1) of the devices that have a fan. 0.5 when none does. Rounded to 1e-6: equal fans give equal levels. */
export function fanSpeed(devices: readonly FanDevice[]): number {
  let sum = 0;
  let n = 0;
  for (const d of devices) {
    if (!hasFan(d)) continue;
    sum += Math.min(1, Math.max(0, d.fan ?? 0));
    n++;
  }
  return n === 0 ? 0.5 : Math.round((sum / n) * 1e6) / 1e6;
}

const hum = () => MIX.ambience.amb_machine_hum_loop.fanFollow;

/** The hum's level in dB at fan speed `x` (0..1): gainDbAt0 at 0, gainDbAt1 at 1. */
export function humGainDb(x: number): number {
  const f = hum();
  return f.gainDbAt0 + (f.gainDbAt1 - f.gainDbAt0) * x;
}

/** The hum's playback rate at fan speed `x` (0..1). */
export function humRate(x: number): number {
  const f = hum();
  return f.rateAt0 + (f.rateAt1 - f.rateAt0) * x;
}

export interface Ambience {
  /** The machine's power and devices, each snapshot. Null (no game): the hum stops. */
  onSnapshot(s: { powered: boolean; devices: readonly FanDevice[] } | null): void;
  /** The room scene shows (main menu or game; not the studios). */
  onRoom(visible: boolean): void;
  /** The first gesture: the room loop may play from now on. */
  onUnlock(): void;
  /** The clock's speed (0 = stopped: Pause or Hold). A change dips the hum once. */
  onSpeed(speed: number): void;
  /** A studio's machine (ticket #66): while it is set the hum follows it, not the game. Null: the game's machine again. */
  onStudio(s: { powered: boolean; devices: readonly FanDevice[] } | null): void;
}

export function createAmbience(sink: AmbienceSink): Ambience {
  let room = false;
  let unlocked = false;
  let roomOn = false;
  let powered = false;
  let fan = 0.5;
  let stopped = false;
  let lastHum: { gainDb: number; rate: number } | null = null;
  /** The game's machine (each snapshot) and the studio's machine (null: no studio shows). */
  let game: { powered: boolean; devices: readonly FanDevice[] } | null = null;
  let studio: { powered: boolean; devices: readonly FanDevice[] } | null = null;

  /** The room loop plays while the room scene shows and after the gesture. */
  const syncRoom = () => {
    const want = room && unlocked;
    if (want === roomOn) return;
    roomOn = want;
    if (want) sink.startLoop(ROOM, MIX.ambience[ROOM].fadeInMs);
    else sink.stopLoop(ROOM, MIX.ambience[ROOM].fadeOutMs);
  };

  /** The hum follows the mean fan speed. Sent only when its level or rate changes. */
  const syncHum = () => {
    const gainDb = humGainDb(fan);
    const rate = humRate(fan);
    if (lastHum?.gainDb === gainDb && lastHum.rate === rate) return;
    lastHum = { gainDb, rate };
    sink.setHum(gainDb, rate, hum().smoothMs);
  };

  /** The hum follows the studio's machine while one shows, else the game's. */
  const syncMachine = () => {
    const s = studio ?? game;
    const on = s !== null && s.powered;
    fan = fanSpeed(s?.devices ?? []);
    if (on !== powered) {
      powered = on;
      if (on) sink.startLoop(HUM, MIX.ambience[HUM].fadeInMs);
      else sink.stopLoop(HUM, MIX.ambience[HUM].fadeOutMs);
    }
    syncHum();
  };

  return {
    onSnapshot(s) {
      game = s;
      syncMachine();
    },
    onStudio(s) {
      studio = s;
      syncMachine();
    },
    onRoom(visible) {
      room = visible;
      syncRoom();
    },
    onUnlock() {
      unlocked = true;
      syncRoom();
    },
    onSpeed(speed) {
      const now = speed === 0;
      if (now === stopped) return;
      stopped = now;
      sink.duckHum(now ? MIX.pause.ambienceGainDb.amb_machine_hum_loop : 0, MIX.pause.fadeMs);
    },
  };
}
