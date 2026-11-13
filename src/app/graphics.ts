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
  /** The cap on real-time room lamps; 0: no cap. */
  lights: number;
  /** Do the room's lamps cast shadows (0 or 1). The sun, moon and key light use `shadows`. */
  lightShadows: number;
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

export type Choice = 'msaa' | 'ao' | 'bloom' | 'shadows' | 'lights' | 'lightShadows' | 'textures' | 'filtering' | 'live' | 'particles' | 'fps';

/** Every value an option can take, with its name in the panel. */
export const CHOICES: Record<Choice, readonly (readonly [number, string])[]> = {
  msaa: [[0, 'Off'], [2, '2x'], [4, '4x'], [8, '8x']],
  ao: [[0, 'Off'], [1, 'Low'], [2, 'High'], [3, 'Ultra']],
  bloom: [[0, 'Off'], [1, 'Soft'], [2, 'Full']],
  shadows: [[0, 'Off'], [1, 'Low'], [2, 'Med'], [3, 'High'], [4, 'Ultra']],
  lights: [[4, '4'], [8, '8'], [0, 'All']],
  lightShadows: [[0, 'Off'], [1, 'On']],
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
  low: { scale: 0.6, msaa: 0, ao: 0, bloom: 0, shadows: 1, lights: 4, lightShadows: 0, textures: 0, filtering: 2, live: 0, particles: 0 },
  medium: { scale: 0.75, msaa: 2, ao: 0, bloom: 1, shadows: 2, lights: 0, lightShadows: 0, textures: 1, filtering: 4, live: 1, particles: 1 },
  high: { scale: 1, msaa: 4, ao: 2, bloom: 2, shadows: 3, lights: 0, lightShadows: 1, textures: 2, filtering: 8, live: 2, particles: 2 },
  ultra: { scale: 1, msaa: 8, ao: 3, bloom: 2, shadows: 4, lights: 0, lightShadows: 1, textures: 3, filtering: 16, live: 3, particles: 2 },
};
export const PRESET_NAMES: readonly (readonly [Preset, string])[] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];

export const DEFAULTS: Graphics = { ...PRESETS.high, fps: 60, brightness: 1, auto: false };

// ---- performance tiers: what the device can run, never what its input is ----

export type Tier = 'low' | 'medium' | 'high';
const TIERS: readonly Tier[] = ['low', 'medium', 'high'];
export const TIER_NAMES: readonly (readonly [Tier, string])[] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const tierName = (t: Tier) => TIER_NAMES.find(([id]) => id === t)![1];

/** A tier is its preset, at 60 fps. Low also draws at 0.75 scale, with the sun's shadows Off. */
export function tierGraphics(tier: Tier, base: Graphics): Graphics {
  return { ...base, ...PRESETS[tier], fps: 60, ...(tier === 'low' ? { scale: 0.75, shadows: 0 } : {}) };
}

/** What `pickTier` reads. A field the browser hides is 0 or ''. */
export interface DeviceInfo {
  /** The WebGL renderer string (unmasked when the browser gives it). */
  renderer: string;
  cores: number;
  /** `navigator.deviceMemory` in GB (Chrome only, at most 8). */
  memoryGb: number;
  /** Screen size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio (kept for the report; the rules use the CSS size). */
  dpr: number;
}

/**
 * Rules, in order. 1) The GPU class from the renderer string: software GL (SwiftShader, llvmpipe, Basic Render) and mobile GPUs (Adreno, Mali, PowerVR...)
 * -> low; an Apple GPU on a small screen -> low; NVIDIA GeForce/RTX/GTX, AMD Radeon RX/Pro, Apple M* -> high; Intel and other integrated -> medium;
 * unknown -> medium. 2) Caps: <= 2 cores or <= 2 GB -> low; <= 4 cores or <= 4 GB -> at most medium; a short screen side under 500 CSS px -> at most medium.
 */
export function pickTier(d: DeviceInfo): { tier: Tier; reason: string } {
  const r = d.renderer.toLowerCase(), short = Math.min(d.width, d.height), small = short > 0 && short < 500;
  let rank: number, why: string;
  if (/swiftshader|llvmpipe|softpipe|basic render|software/.test(r)) { rank = 0; why = 'software rendering'; }
  else if (/adreno|mali|powervr|immortalis|videocore|xclipse/.test(r)) { rank = 0; why = 'mobile GPU'; }
  else if (/apple m\d/.test(r)) { rank = 2; why = 'Apple M GPU'; }
  else if (/apple/.test(r)) { rank = small ? 0 : 1; why = small ? 'phone GPU' : 'Apple GPU'; }
  else if (/nvidia|geforce|rtx|gtx|radeon (rx|pro)|radeon\(tm\) (rx|pro)/.test(r)) { rank = 2; why = 'discrete GPU'; }
  else if (/intel|uhd|iris|radeon|vega|integrated/.test(r)) { rank = 1; why = 'integrated GPU'; }
  else { rank = 1; why = 'unknown GPU'; }
  const caps: string[] = [];
  const cap = (max: number, note: string) => { if (rank > max) { rank = max; caps.push(note); } };
  if (d.cores > 0 && d.cores <= 2) cap(0, `${d.cores} cores`);
  else if (d.memoryGb > 0 && d.memoryGb <= 2) cap(0, `${d.memoryGb} GB`);
  else if (d.cores > 0 && d.cores <= 4) cap(1, `${d.cores} cores`);
  else if (d.memoryGb > 0 && d.memoryGb <= 4) cap(1, `${d.memoryGb} GB`);
  if (small) cap(1, 'small screen');
  return { tier: TIERS[rank]!, reason: [why, ...caps].join(', ') };
}

/** Gathers the inputs of `pickTier`. A throwaway WebGL context reads the renderer; it is freed at once. */
export function readDeviceInfo(): DeviceInfo {
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL: unknown */ }
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number };
  const scr = typeof screen === 'undefined' ? { width: 0, height: 0 } : screen;
  return {
    renderer, cores: nav.hardwareConcurrency || 0, memoryGb: nav.deviceMemory || 0, width: scr.width, height: scr.height,
    dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  };
}

export interface TierRecord {
  mode: 'auto' | 'manual';
  tier: Tier;
  reason: string;
  /** Set by a step down: auto never goes up past this tier again. */
  maxUp?: Tier;
  /** When `maxUp` was set (ms), and the device it was set on (`fingerprint`). It expires after `MAX_UP_MS` or on another device. */
  maxUpAt?: number;
  maxUpFp?: string;
}

const MAX_UP_MS = 3 * 24 * 3600 * 1000;

/** Renderer string and screen size: a change means another GPU or screen. */
export const fingerprint = (d: DeviceInfo): string => `${d.renderer}|${d.width}x${d.height}`;

/** A stored tier record made safe, or null. */
export function parseTierRecord(raw: unknown): TierRecord | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || (o.mode !== 'auto' && o.mode !== 'manual') || !TIERS.includes(o.tier as Tier)) return null;
  const rec: TierRecord = { mode: o.mode, tier: o.tier as Tier, reason: typeof o.reason === 'string' ? o.reason : '' };
  if (TIERS.includes(o.maxUp as Tier)) {
    rec.maxUp = o.maxUp as Tier;
    if (typeof o.maxUpAt === 'number' && Number.isFinite(o.maxUpAt)) rec.maxUpAt = o.maxUpAt;
    if (typeof o.maxUpFp === 'string') rec.maxUpFp = o.maxUpFp;
  }
  return rec;
}

/** The record without a `maxUp` that is too old or from another device. An old record with no date or device is taken as set now. */
function freshMaxUp(rec: TierRecord, env: StartEnv): TierRecord {
  if (!rec.maxUp) return rec;
  const { maxUp, maxUpAt, maxUpFp, ...rest } = rec;
  if (maxUpAt !== undefined && env.now - maxUpAt > MAX_UP_MS) return rest;
  const fp = env.fp();
  if (maxUpFp !== undefined && maxUpFp !== fp) return rest;
  return { ...rest, maxUp, maxUpAt: maxUpAt ?? env.now, maxUpFp: maxUpFp ?? fp };
}

/** What `resolveStart` needs from the clock and the device. */
export interface StartEnv { now: number; fp: () => string }

// the touch default from before tiers: Low's values with scale 0.75, shadows 0, 30 fps, and no lamp keys
function isOldTouchDefault(raw: unknown): boolean {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.lights !== undefined || o.lightShadows !== undefined) return false;
  const want: Record<string, number> = { ...PRESETS.low, scale: 0.75, shadows: 0, fps: 30, brightness: 1 };
  delete want.lights; delete want.lightShadows;
  return Object.keys(want).every((k) => o[k] === want[k]);
}

/**
 * The settings of a start. `saved`: the stored graphics, `rec`: the stored tier record, `search`: the page's query (`?tier=low|medium|high` is a bench
 * override for this session: manual, never saved). A graphics save with no tier record is an old save: the player's own, so manual.
 * With nothing stored, auto mode applies the detected tier.
 */
export function resolveStart(
  saved: unknown, rec: unknown, search: string, detect: () => { tier: Tier; reason: string },
  env: StartEnv = { now: Date.now(), fp: () => fingerprint(device()) },
): { g: Graphics; rec: TierRecord } {
  const hasSave = !!saved && typeof saved === 'object', stored = parseTierRecord(rec);
  const base = parseGraphics(saved);
  const savedV = hasSave ? (saved as { v?: unknown }).v : undefined;
  const before = (n: number) => typeof savedV !== 'number' || savedV < n;
  // saves from before auto-adjust became opt-in (v1 and older) carry its old default: the player never chose it
  if (hasSave && before(2)) base.auto = false;
  // Low drew at 30 fps before v3 and runs at 60 now: an old Low save with 30 moves to 60. A v3 save at 30 is the player's choice
  if (hasSave && before(3) && base.fps === 30 && (stored ? stored.tier === 'low' : presetOf(base) === 'low')) base.fps = 60;
  let out: { g: Graphics; rec: TierRecord };
  if (hasSave && !stored && isOldTouchDefault(saved)) {
    // never the player's choice: Low's cap, and auto
    out = { g: tierGraphics('low', base), rec: { mode: 'auto', tier: 'low', reason: 'phone default' } };
  } else if (hasSave && !stored) {
    const p = presetOf(base);
    out = { g: base, rec: { mode: 'manual', tier: p === 'low' || p === 'medium' ? p : 'high', reason: 'saved settings' } };
  } else if (stored) {
    // auto never starts above a tier it stepped down from, until that note expires
    const kept = freshMaxUp(stored, env);
    const rec = kept.mode === 'auto' && kept.maxUp && TIERS.indexOf(kept.tier) > TIERS.indexOf(kept.maxUp) ? { ...kept, tier: kept.maxUp } : kept;
    out = { g: rec.mode === 'auto' ? tierGraphics(rec.tier, base) : base, rec };
  }
  else { const d = detect(); out = { g: tierGraphics(d.tier, DEFAULTS), rec: { mode: 'auto', ...d } }; }
  const q = new URLSearchParams(search).get('tier') as Tier | null;
  if (q && TIERS.includes(q)) out = { g: tierGraphics(q, out.g), rec: { mode: 'manual', tier: q, reason: `?tier=${q}` } };
  return out;
}

const presetKeys = Object.keys(PRESETS.high) as (keyof PresetOptions)[];

/** The preset these settings are, or null: the player's own mix (the panel says Custom). */
export function presetOf(g: Graphics): Preset | null {
  for (const [id] of PRESET_NAMES) if (presetKeys.every((k) => g[k] === PRESETS[id][k])) return id;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 20) / 20));

/** Stored settings made safe: a value that is missing, or one no longer on offer, falls back to the default. */
export function parseGraphics(raw: unknown, base: Graphics = DEFAULTS): Graphics {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out = { ...base };
  for (const k of Object.keys(CHOICES) as Choice[]) if (CHOICES[k].some(([v]) => v === o[k])) out[k] = o[k] as number;
  if (typeof o.scale === 'number' && Number.isFinite(o.scale)) out.scale = clamp(o.scale, SCALE_MIN, SCALE_MAX);
  // an old save has no lamp keys: take them from the preset its other keys match, so low stays low and medium stays medium
  if (o.lights === undefined && o.lightShadows === undefined) {
    const p = isOldTouchDefault(raw) ? PRESET_NAMES[0] : PRESET_NAMES.find(([id]) => presetKeys.every((k) => k === 'lights' || k === 'lightShadows' || out[k] === PRESETS[id][k]));
    if (p) { out.lights = PRESETS[p[0]].lights; out.lightShadows = PRESETS[p[0]].lightShadows; }
  }
  if (typeof o.brightness === 'number' && Number.isFinite(o.brightness)) out.brightness = clamp(o.brightness, BRIGHT_MIN, BRIGHT_MAX);
  if (typeof o.auto === 'boolean') out.auto = o.auto;
  return out;
}

/**
 * Auto-adjust's steps, each cheaper than the last: 1 drops the ambient occlusion, 2 also drops the bloom and the multisampling and calms the live dies,
 * 3 also draws at 3/4 of the pixels (the resolution is the last to go). A step only lowers: an option already below it stays where the player put it.
 */
export function lowered(g: Graphics, step: number): Graphics {
  if (step <= 0) return g;
  const out = { ...g, ao: 0 };
  if (step >= 2) { out.bloom = 0; out.msaa = 0; out.live = 0; }
  if (step >= 3) out.scale = Math.min(out.scale, 0.75); // the resolution goes last: effects first
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
const SAVE_VERSION = 3;

const TIER_KEY = 'pipeline-city.graphics.tier';

let detected: { tier: Tier; reason: string } | null = null;
/** The tier this device gets from `pickTier`; read once. */
const detect = () => (detected ??= pickTier(device()));
let info: DeviceInfo | null = null;
const device = () => (info ??= readDeviceInfo());

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}

/**
 * `resolveStart` on the stored values. A `maxUp` that got its date or device now is saved at once: else an old record is dated "now" on every load
 * and never expires.
 */
export function loadStart(
  store: Pick<Storage, 'getItem' | 'setItem'>, search: string, detectTier: () => { tier: Tier; reason: string }, env?: StartEnv,
): { g: Graphics; rec: TierRecord } {
  const read = (k: string): unknown => { try { return JSON.parse(store.getItem(k) ?? 'null'); } catch { return null; } };
  const raw = read(TIER_KEY), before = parseTierRecord(raw);
  const s = resolveStart(read(KEY), raw, search, detectTier, env);
  // only the stored record plus the missing date and device, not what `resolveStart` changed in memory
  if (before?.maxUp && s.rec.maxUp && (before.maxUpAt === undefined || before.maxUpFp === undefined)) {
    const dated = { ...before, maxUpAt: s.rec.maxUpAt, maxUpFp: s.rec.maxUpFp };
    try { store.setItem(TIER_KEY, JSON.stringify(dated)); } catch { /* storage blocked or full: ignore */ }
  }
  return s;
}

const noStore = { getItem: () => null, setItem: () => {} };
const start = loadStart(typeof localStorage === 'undefined' ? noStore : localStorage, typeof location === 'undefined' ? '' : location.search, detect);

/** The player's settings. */
export const graphics = signal<Graphics>(start.g);
/** Auto or manual, the tier and why. Manual always wins: no auto step changes it. */
export const tierRecord = signal<TierRecord>(start.rec);
/** How far auto-adjust has lowered the picture this session. It is not saved: the next start tries the player's settings again. */
export const autoStep = signal(0);
/** What the renderers apply. */
export const effective = computed(() => (graphics.value.auto ? lowered(graphics.value, autoStep.value) : graphics.value));

function commit(next: Graphics, rec: TierRecord) {
  graphics.value = next;
  tierRecord.value = rec;
  autoStep.value = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, v: SAVE_VERSION }));
    localStorage.setItem(TIER_KEY, JSON.stringify(rec));
  } catch { /* storage blocked or full: ignore */ }
}

/** The player chose: the mode is manual from now on. */
const manual = (): TierRecord => ({ ...tierRecord.value, mode: 'manual' });

/** Set one option. Auto-adjust starts over: the player has just chosen this picture. */
export function setGraphic<K extends keyof Graphics>(key: K, value: Graphics[K]) { commit(parseGraphics({ ...graphics.value, [key]: value }), manual()); }
export function setPreset(id: Preset) { commit({ ...graphics.value, ...PRESETS[id] }, manual()); }
/** The player picks a tier: manual. */
export function setTier(tier: Tier) { commit(tierGraphics(tier, graphics.value), { mode: 'manual', tier, reason: 'chosen' }); }
/** Back to detection. */
export function setAutoTier(d: { tier: Tier; reason: string } = detect()) { commit(tierGraphics(d.tier, graphics.value), { mode: 'auto', ...d }); }
export function resetGraphics() { setAutoTier(); }

let stepped = false;
/** For tests: allow one more step. */
export function resetTierSteps() { stepped = false; }

/**
 * `TierWatch` says step down or up. Only auto mode obeys, once per page load; up never goes above the detected tier + 1. The new tier's preset
 * applies and is saved, so the next start begins there. True: the tier changed.
 */
export function stepTier(dir: 'down' | 'up', detectedTier: Tier = detect().tier): boolean {
  const rec = tierRecord.peek();
  if (rec.mode !== 'auto' || stepped) return false;
  const at = TIERS.indexOf(rec.tier), top = rec.maxUp ? TIERS.indexOf(rec.maxUp) : 2;
  const to = dir === 'down' ? at - 1 : Math.min(at + 1, TIERS.indexOf(detectedTier) + 1, top);
  if (to < 0 || to === at) return false;
  stepped = true;
  const tier = TIERS[to]!;
  // a step down is remembered: auto does not go up past it on a later load
  const next: TierRecord = { mode: 'auto', tier, reason: `${dir === 'down' ? 'slow frames' : 'fast frames'}, was ${tierName(rec.tier)}` };
  if (dir === 'down') Object.assign(next, { maxUp: tier, maxUpAt: Date.now(), maxUpFp: fingerprint(device()) });
  else if (rec.maxUp) Object.assign(next, { maxUp: rec.maxUp, maxUpAt: rec.maxUpAt, maxUpFp: rec.maxUpFp });
  commit(tierGraphics(tier, graphics.peek()), next);
  return true;
}

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

/** The frame limit while the page has lost the focus. */
const AWAY_FPS = 30;

/**
 * The frame loop's limit, from the player's own `fps`: lowered to 30 only while the page has lost the focus, so the GPU and its fans rest. Time
 * without input lowers nothing (owner decision): a player who watches the city run keeps the full rate. A frame with nothing new is skipped elsewhere.
 */
export function loopLimit(fps: number, focused: boolean): number {
  if (focused) return fps;
  return fps && fps < AWAY_FPS ? fps : AWAY_FPS;
}

/** Low's frame limit before it moved to 60 (save v3): the auto-adjust watches still judge Low by it. */
const LOW_WATCH_FPS = 30;

/**
 * Is `g` Low: the Low preset's picture (AO, bloom, MSAA, textures, filtering, live, particles), at any light count, scale or sun shadows?
 * (the light count, the lamps' shadows, the scale and the sun's shadows aside: the Low tier and Low saves old and new differ there).
 * Widening isLow on purpose also makes watchFps judge custom Low-like pictures (Low's picture at another light count, scale or sun shadows)
 * at Low's 30 fps thresholds.
 */
const LOW_FREE: readonly (keyof PresetOptions)[] = ['lights', 'lightShadows', 'scale', 'shadows'];
export const isLow = (g: Graphics): boolean => presetKeys.every((k) => LOW_FREE.includes(k) || g[k] === PRESETS.low[k]);

/** The fps the auto-adjust watches judge by. A Low at 60 is judged as at 30, the thresholds it had, so phones switch tiers as before. Other limits: as is. */
export function watchFps(g: Graphics, limit: number): number {
  return isLow(g) && (!limit || limit >= 60) ? LOW_WATCH_FPS : limit;
}

/** Does the away limit hold the loop below the player's own `fps` (0: none)? Those frames say nothing to `TierWatch`. */
export const awayHeld = (limit: number, fps: number): boolean => (fps ? limit < fps : limit > 0);

/** Under this share of the frame limit a frame counts as slow, so a loop held to 30 is not read as a weak GPU. */
const SLOW_SHARE = 0.8;
const SLOW_FPS = 30, SLOW_FOR_S = 2.5, SETTLE_MS = 5000, HITCH_S = 0.15;

const TIER_WINDOW_S = 4, TIER_WORK_SHARE = 0.35, TIER_HOLD = 0.9;

/**
 * Reads one window (4 s) of frames after the settle time and makes one decision, then stops. Down: the mean rate is under 30 fps or under 0.8 x the limit.
 * Up: the mean rate holds 0.9 x the limit and the mean frame work (CPU ms in the frame callback) is under 35% of the frame budget. A lone hitch counts at most 0.15 s.
 */
export class TierWatch {
  private since = -Infinity;
  private time = 0;
  private work = 0;
  private n = 0;
  private done = false;

  reset(now: number) { this.since = now; this.time = 0; this.work = 0; this.n = 0; }

  /** A frame of `real` seconds whose callback took `workMs`. Returns the one decision, once. */
  tick(real: number, workMs: number, now: number, fps: number): 'down' | 'up' | null {
    if (this.done || now - this.since < SETTLE_MS) return null;
    this.time += Math.min(real, HITCH_S);
    this.work += workMs;
    this.n++;
    if (this.time < TIER_WINDOW_S) return null;
    this.done = true;
    const limit = fps || 60, rate = this.n / this.time, budget = 1000 / limit;
    if (rate < Math.min(SLOW_FPS, limit * SLOW_SHARE)) return 'down';
    if (rate >= limit * TIER_HOLD && this.work / this.n < budget * TIER_WORK_SHARE) return 'up';
    return null;
  }
}

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
    // a lone hitch (a shader compile, a bake) counts as at most HITCH_S: only slow frames in a row lower the picture
    this.slow = Math.max(0, this.slow + (real > 1 / floor ? Math.min(real, HITCH_S) : -real * 2));
    if (this.slow <= SLOW_FOR_S) return false;
    this.slow = 0;
    return true;
  }
}
