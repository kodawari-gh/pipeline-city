/** The overlay's controls: the render scale and the main post passes, set through the graphics settings (`setGraphic` saves them as the panel does). */
import { graphics, PRESETS, presetOf, setGraphic, type Graphics } from '../graphics';

/** The render scales the overlay offers (within SCALE_MIN..SCALE_MAX). */
export const SCALES = [0.5, 0.6, 0.75, 0.85, 1];

export function setScale(v: number): void {
  setGraphic('scale', v);
}

/** Main's optional post passes are on (the scene target, the eye and the finish always run). */
export const postOn = (g: Graphics): boolean => g.ao > 0 || g.bloom > 0 || g.msaa > 0;

/** The post values that `setPost(false)` took away, or null when none are held. */
let held: { ao: number; bloom: number; msaa: number } | null = null;

/** Post off: remember ao, bloom and msaa, then set them to 0. Post on: restore them, else the current preset's (High if none). */
export function setPost(on: boolean): void {
  const g = graphics.peek();
  if (!on) {
    if (postOn(g)) held = { ao: g.ao, bloom: g.bloom, msaa: g.msaa };
    setGraphic('ao', 0);
    setGraphic('bloom', 0);
    setGraphic('msaa', 0);
    return;
  }
  // the current preset's post values, or Medium's when that preset has none on (Low): the switch always turns something on
  const p = PRESETS[presetOf(g) ?? 'high'];
  const v = held ?? (postOn({ ...g, ...p }) ? p : PRESETS.medium);
  held = null;
  setGraphic('ao', v.ao);
  setGraphic('bloom', v.bloom);
  setGraphic('msaa', v.msaa);
}
