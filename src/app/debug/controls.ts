/** The overlay's controls: the render scale, the main post passes, the sun's shadow and the lamp cap, set through the graphics settings (`setGraphic` saves them as the panel does), and the city and machine hides (visibility only, saved nowhere). */
import { CHOICES, DEFAULTS, debugLights, graphics, PRESETS, setAutoTier, setGraphic, type Graphics, type Tier } from '../graphics';

/** The render scales the overlay offers (within SCALE_MIN..SCALE_MAX). */
export const SCALES = [0.5, 0.6, 0.75, 0.85, 1];

export function setScale(v: number): void {
  setGraphic('scale', v);
}

/** Main's optional post passes are on (the scene target, the eye and the finish always run). */
export const postOn = (g: Graphics): boolean => g.ao > 0 || g.bloom > 0 || g.msaa > 0;

/** The post values that `setPost(false)` took away, or null when none are held. */
let held: { ao: number; bloom: number; msaa: number } | null = null;

/** Post off: remember ao, bloom and msaa, then set them to 0. Post on: restore them, else Medium's post values. Nothing else changes. */
export function setPost(on: boolean): void {
  const g = graphics.peek();
  if (!on) {
    if (postOn(g)) held = { ao: g.ao, bloom: g.bloom, msaa: g.msaa };
    setGraphic('ao', 0);
    setGraphic('bloom', 0);
    setGraphic('msaa', 0);
    return;
  }
  const v = held ?? PRESETS.medium;
  held = null;
  setGraphic('ao', v.ao);
  setGraphic('bloom', v.bloom);
  setGraphic('msaa', v.msaa);
}

/** The sun's shadow level that `setShadowsOn(false)` took away, or null when none is held. */
let heldShadows: number | null = null;

/** The sun's shadow is on (its level above 0). */
export const shadowsOn = (g: Graphics): boolean => g.shadows > 0;

/** Shadow off: remember the level, then set it to 0. Shadow on: restore it, else the default level. Nothing else changes. */
export function setShadowsOn(on: boolean): void {
  const g = graphics.peek();
  if (!on) {
    if (shadowsOn(g)) heldShadows = g.shadows;
    setGraphic('shadows', 0);
    return;
  }
  const v = heldShadows ?? DEFAULTS.shadows;
  heldShadows = null;
  setGraphic('shadows', v);
}

/** The overlay's lamp caps, in order: 4, 1, All (0). */
export const LIGHTS = [4, 1, 0];

/** The lamp cap now applied (the overlay's, else the setting's). */
export const lightsNow = (): number => debugLights.peek() ?? graphics.peek().lights;

/** The next lamp cap: 4, then 1, then All (0), then 4. Any other value (8, from the panel) goes to 4. */
export const nextLights = (v: number): number => LIGHTS[LIGHTS.indexOf(v) + 1] ?? LIGHTS[0]!;

/**
 * Sets the lamp cap. 4 and 0 go through `setGraphic` (saved, as the panel does). 1 is not a `lights` choice, so it is held in `debugLights`
 * (applied, never saved) and the saved value stays what the player had. Auto drops it (`backToAuto`).
 */
export function setLights(v: number): void {
  if (CHOICES.lights.some(([c]) => c === v)) {
    debugLights.value = null;
    setGraphic('lights', v);
  } else {
    debugLights.value = v;
  }
}

/** Shows or hides a root (the city's or the machine's). Visibility only: no setting is changed or saved. A missing root is skipped. */
export function setRootHidden(root: { visible: boolean } | null, hidden: boolean): void {
  if (root) root.visible = !hidden;
}

/** Back to auto: re-detects the tier (or takes `d`, for tests) and leaves manual mode. */
export function backToAuto(d?: { tier: Tier; reason: string }): void {
  debugLights.value = null;
  if (d) setAutoTier(d);
  else setAutoTier();
}
