/**
 * The overlay's controls: the render scale, the main post passes, the sun's shadow and the lamp cap, and the city and machine hides (visibility only).
 * None of them is saved. The four settings go to `debugOverride`, which `effective` applies on top of the player's settings and which nothing writes
 * to storage. `backToAuto` clears them. (A load without `?debug` is not touched by anything here.)
 */
import { DEFAULTS, debugOverride, effective, PRESETS, setAutoTier, type Graphics, type Tier } from '../graphics';

/** The render scales the overlay offers (within SCALE_MIN..SCALE_MAX). */
export const SCALES = [0.5, 0.6, 0.75, 0.85, 1];

const put = (o: Partial<Graphics>): void => { debugOverride.value = { ...debugOverride.value, ...o }; };
const drop = (...keys: (keyof Graphics)[]): void => {
  const o = { ...debugOverride.value };
  for (const k of keys) delete o[k];
  debugOverride.value = o;
};

/** Any overlay toggle is applied now. */
export const overridden = (): boolean => Object.keys(debugOverride.value).length > 0;

export function setScale(v: number): void {
  put({ scale: v });
}

/** Main's optional post passes are on (the scene target, the eye and the finish always run). */
export const postOn = (g: Graphics): boolean => g.ao > 0 || g.bloom > 0 || g.msaa > 0;

/** Post off: ao, bloom and msaa at 0. Post on: the player's own values, else Medium's post values. Nothing else changes. */
export function setPost(on: boolean): void {
  if (!on) { put({ ao: 0, bloom: 0, msaa: 0 }); return; }
  drop('ao', 'bloom', 'msaa');
  if (!postOn(effective.peek())) put({ ao: PRESETS.medium.ao, bloom: PRESETS.medium.bloom, msaa: PRESETS.medium.msaa });
}

/** The sun's shadow is on (its level above 0). */
export const shadowsOn = (g: Graphics): boolean => g.shadows > 0;

/** Shadow off: level 0. Shadow on: the player's own level, else the default level. Nothing else changes. */
export function setShadowsOn(on: boolean): void {
  if (!on) { put({ shadows: 0 }); return; }
  drop('shadows');
  if (!shadowsOn(effective.peek())) put({ shadows: DEFAULTS.shadows });
}

/** The overlay's lamp caps, in order: 4, 1, All (0). */
export const LIGHTS = [4, 1, 0];

/** The lamp cap now applied. */
export const lightsNow = (): number => effective.peek().lights;

/** The next lamp cap: 4, then 1, then All (0), then 4. Any other value (8, from the panel) goes to 4. */
export const nextLights = (v: number): number => LIGHTS[LIGHTS.indexOf(v) + 1] ?? LIGHTS[0]!;

/** Sets the lamp cap (4, 1 or All) for this session only: the saved value stays what the player had. Auto drops it (`backToAuto`). */
export function setLights(v: number): void {
  put({ lights: v });
}

/** Shows or hides a root (the city's or the machine's). Visibility only: no setting is changed or saved. A missing root is skipped. */
export function setRootHidden(root: { visible: boolean } | null, hidden: boolean): void {
  if (root) root.visible = !hidden;
}

/** Back to auto: drops every toggle, re-detects the tier (or takes `d`, for tests) and leaves manual mode. The overlay also shows both roots again. */
export function backToAuto(d?: { tier: Tier; reason: string }): void {
  debugOverride.value = {};
  if (d) setAutoTier(d);
  else setAutoTier();
}
