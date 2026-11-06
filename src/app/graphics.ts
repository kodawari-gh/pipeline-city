// Graphics settings: the presets, the player's own choices and what the renderers apply (docs/UI.md "Graphics panel"). Per viewer, so they sit in localStorage
// (in try/catch) and not in the save. The panel writes `graphics`; a renderer reads `effective`, which is `graphics` less what auto-adjust took away on a weak
// GPU. Each option's list of `CHOICES` runs from cheap to dear; what a level means in numbers sits with the code that uses it (`post.ts`, `room3d.ts`, `chips3d.ts`).
import { computed, signal } from '@preact/signals';

export type RendererKind = '2d' | '3d';
/** The renderer that is running (`main.tsx`): the panel shows only the options it has. */
export const rendererKind = signal<RendererKind>('2d');

export interface Graphics {
  /** Share of the screen's pixels the picture draws at, 0.5 to 1.5. */
  scale: number;
  /** Multisampling, in samples. */
  msaa: number;
  /** Ambient occlusion level. */
  ao: number;
  bloom: number;
  shadows: number;
  /** How dense the baked art is, as a level. */
  textures: number;
  /** Anisotropic filtering, in samples. */
  filtering: number;
  /** How often and how sharply the live dies draw, as a level. */
  live: number;
  particles: number;
  /** Frames per second at most; 0: no limit but the screen's. */
  fps: number;
  /** Brightness of the 3D picture, 0.7 to 1.3. */
  brightness: number;
  /** Lower the picture by steps while the frames stay slow. */
  auto: boolean;
}

export type Choice = 'msaa' | 'ao' | 'bloom' | 'shadows' | 'textures' | 'filtering' | 'live' | 'particles' | 'fps';

/** Every value an option can take, with its name in the panel. */
export const CHOICES: Record<Choice, readonly (readonly [number, string])[]> = {
  msaa: [[0, 'Off'], [2, '2x'], [4, '4x'], [8, '8x']],
  ao: [[0, 'Off'], [1, 'Low'], [2, 'High'], [3, 'Ultra']],
  bloom: [[0, 'Off'], [1, 'Soft'], [2, 'Full']],
  shadows: [[0, 'Off'], [1, 'Low'], [2, 'Med'], [3, 'High'], [4, 'Ultra']],
  textures: [[0, 'Low'], [1, 'Med'], [2, 'High'], [3, 'Ultra']],
  filtering: [[2, '2x'], [4, '4x'], [8, '8x'], [16, '16x']],
  live: [[0, 'Low'], [1, 'Med'], [2, 'High'], [3, 'Ultra']],
  particles: [[0, 'Off'], [1, 'Low'], [2, 'High']],
  fps: [[30, '30'], [60, '60'], [120, '120'], [0, 'Off']],
};

export const SCALE_MIN = 0.5, SCALE_MAX = 1.5, BRIGHT_MIN = 0.7, BRIGHT_MAX = 1.3;

/** What a preset sets. The frame limit, the brightness and auto-adjust are the player's alone: a preset leaves them where they are. */
export type PresetOptions = Omit<Graphics, 'fps' | 'brightness' | 'auto'>;
export type Preset = 'low' | 'medium' | 'high' | 'ultra';

/** `high` is the look the game is tuned on: the default. */
export const PRESETS: Record<Preset, PresetOptions> = {
  low: { scale: 0.6, msaa: 0, ao: 0, bloom: 0, shadows: 1, textures: 0, filtering: 2, live: 0, particles: 0 },
  medium: { scale: 0.75, msaa: 2, ao: 0, bloom: 1, shadows: 2, textures: 1, filtering: 4, live: 1, particles: 1 },
  high: { scale: 1, msaa: 4, ao: 2, bloom: 2, shadows: 3, textures: 2, filtering: 8, live: 2, particles: 2 },
  ultra: { scale: 1, msaa: 8, ao: 3, bloom: 2, shadows: 4, textures: 3, filtering: 16, live: 3, particles: 2 },
};
export const PRESET_NAMES: readonly (readonly [Preset, string])[] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];

export const DEFAULTS: Graphics = { ...PRESETS.high, fps: 60, brightness: 1, auto: true };

const presetKeys = Object.keys(PRESETS.high) as (keyof PresetOptions)[];

/** The preset these settings are, or null: the player's own mix (the panel says Custom). */
export function presetOf(g: Graphics): Preset | null {
  for (const [id] of PRESET_NAMES) if (presetKeys.every((k) => g[k] === PRESETS[id][k])) return id;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 20) / 20));

/** Stored settings made safe: a value that is missing, or one no longer on offer, falls back to the default. */
export function parseGraphics(raw: unknown): Graphics {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out = { ...DEFAULTS };
  for (const k of Object.keys(CHOICES) as Choice[]) if (CHOICES[k].some(([v]) => v === o[k])) out[k] = o[k] as number;
  if (typeof o.scale === 'number' && Number.isFinite(o.scale)) out.scale = clamp(o.scale, SCALE_MIN, SCALE_MAX);
  if (typeof o.brightness === 'number' && Number.isFinite(o.brightness)) out.brightness = clamp(o.brightness, BRIGHT_MIN, BRIGHT_MAX);
  if (typeof o.auto === 'boolean') out.auto = o.auto;
  return out;
}

/**
 * Auto-adjust's steps, each cheaper than the last: 1 drops the ambient occlusion, 2 also draws at 3/4 of the pixels, 3 also drops the bloom and the multisampling,
 * draws at 0.6 and calms the live dies. A step only lowers: an option already below it stays where the player put it.
 */
export function lowered(g: Graphics, step: number): Graphics {
  if (step <= 0) return g;
  const out = { ...g, ao: 0 };
  if (step >= 2) out.scale = Math.min(out.scale, 0.75);
  if (step >= 3) { out.scale = Math.min(out.scale, 0.6); out.bloom = 0; out.msaa = 0; out.live = 0; }
  return out;
}

export const AUTO_STEPS = 3;

/** The next step that changes the picture (a step on options already low gains nothing), or null: nothing is left to take away. */
export function nextStep(g: Graphics, step: number): number | null {
  const now = lowered(g, step);
  for (let s = step + 1; s <= AUTO_STEPS; s++) {
    const next = lowered(g, s);
    if ((Object.keys(next) as (keyof Graphics)[]).some((k) => next[k] !== now[k])) return s;
  }
  return null;
}

const KEY = 'pipeline-city.graphics';

function load(): Graphics {
  try { return parseGraphics(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...DEFAULTS }; }
}

/** The player's settings. */
export const graphics = signal<Graphics>(load());
/** How far auto-adjust has lowered the picture this session. It is not saved: the next start tries the player's settings again. */
export const autoStep = signal(0);
/** What the renderers apply. */
export const effective = computed(() => (graphics.value.auto ? lowered(graphics.value, autoStep.value) : graphics.value));

function commit(next: Graphics) {
  graphics.value = next;
  autoStep.value = 0;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked or full: ignore */ }
}

/** Set one option. Auto-adjust starts over: the player has just chosen this picture. */
export function setGraphic<K extends keyof Graphics>(key: K, value: Graphics[K]) { commit(parseGraphics({ ...graphics.value, [key]: value })); }
export function setPreset(id: Preset) { commit({ ...graphics.value, ...PRESETS[id] }); }
export function resetGraphics() { commit({ ...DEFAULTS }); }

/** Forget auto-adjust's steps: the panel's Try again. They come back if the frames are still slow. */
export function retryPicture() { autoStep.value = 0; }

/** Canvas pixels per CSS pixel at the render scale `scale`. */
export const pixelRatio = (scale: number): number => Math.min(window.devicePixelRatio || 1, 2) * scale;

/** The frame rate and the size of the picture, measured by the running renderer about twice a second. */
export const frameStats = signal({ fps: 0, ms: 0, w: 0, h: 0 });

/** Counts the frames that are drawn into `frameStats`. */
export class FrameMeter {
  private n = 0;
  private t0 = -1;

  tick(now: number, w: number, h: number) {
    if (this.t0 < 0) { this.t0 = now; return; }
    this.n++;
    const span = now - this.t0;
    if (span < 500) return;
    frameStats.value = { fps: (this.n * 1000) / span, ms: span / this.n, w, h };
    this.n = 0;
    this.t0 = now;
  }
}

/** Holds a frame loop to `fps`. It skips frames of the screen's own rate and keeps the remainder, so a limit of 60 on a 144 Hz screen is 60 and not 48. */
export class FrameGate {
  private last = -Infinity;

  /** May this frame draw? The millisecond of slack keeps a limit equal to the screen's rate from dropping every other frame to timer jitter. */
  ready(now: number, fps: number): boolean {
    if (!fps) { this.last = now; return true; }
    const step = 1000 / fps, gone = now - this.last;
    if (gone < step - 1) return false;
    // (a frame inside the slack owes its share of a step to the next one)
    this.last = !Number.isFinite(gone) ? now : gone < step ? this.last + step : now - ((gone - step) % step);
    return true;
  }
}

/** The frame limit while the player is away, and how long without input (ms) means away. */
const AWAY_FPS = 30, AWAY_AFTER_MS = 30000;

/** Lowers the frame limit while the player is away: the page has lost the focus, or no input came for a while and nothing moves that they started. The GPU and its fans rest. */
export class AwayWatch {
  private at = 0;

  /** The player did something at `now`. */
  input(now: number) { this.at = now; }

  /** The frame limit at `now`, from the player's own `fps`. `busy`: the view or the player's hand is on its way, so frames still count. */
  limit(fps: number, now: number, focused: boolean, busy: boolean): number {
    if (focused && (busy || now - this.at < AWAY_AFTER_MS)) return fps;
    return fps && fps < AWAY_FPS ? fps : AWAY_FPS;
  }
}

/** Under this share of the frame limit a frame counts as slow, so a loop held to 30 is not read as a weak GPU. */
const SLOW_SHARE = 0.8;
const SLOW_FPS = 30, SLOW_FOR_S = 2.5, SETTLE_MS = 5000;

/** Watches the frame times for auto-adjust: frames slower than 30 FPS for 2.5 s, after a settling time (the first bakes are slow on any GPU). */
export class SlowWatch {
  private since = -Infinity;
  private slow = 0;

  /** Start over: the picture has changed, so the first frames say nothing. */
  reset(now: number) { this.since = now; this.slow = 0; }

  /** A frame that took `real` seconds. True: the frames have stayed slow, the picture should get cheaper. */
  tick(real: number, now: number, fps: number): boolean {
    if (now - this.since < SETTLE_MS) return false;
    const floor = fps ? Math.min(SLOW_FPS, fps * SLOW_SHARE) : SLOW_FPS;
    this.slow = Math.max(0, this.slow + (real > 1 / floor ? real : -real * 2));
    if (this.slow <= SLOW_FOR_S) return false;
    this.slow = 0;
    return true;
  }
}
