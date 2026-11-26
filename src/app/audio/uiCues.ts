// UI sound mapping (pure). An element names its cue in `data-cue`; `data-cue-next` names a cue that follows a click 70 ms later.
// `ui_toggle` (checkbox change: on or off) and `silent` (no click sound; hover and focus still play) are the two non-cue values.
// uiListener.ts owns the DOM and calls these functions; nothing here touches the DOM or the engine.
import * as tokens from './mixTokens';

export const CUE_ATTR = 'data-cue';
export const NEXT_ATTR = 'data-cue-next';
/** A transition follows its click by this much (the spec: 60 to 80 ms). */
export const NEXT_DELAY_S = 0.07;

const IDS: ReadonlySet<string> = new Set(tokens.MIX.cues.map((c) => c.id));
export const isCueId = (s: string | null | undefined): s is tokens.CueId => s != null && IDS.has(s);

export type UiEvent = 'hover' | 'focus' | 'click' | 'toggle' | 'value' | 'back';

/**
 * The cue for one UI event on an element whose `data-cue` is `attr` (null: no attribute).
 * `on`: the new state of a checkbox (toggle events). `back` ignores `attr`: Esc plays it wherever the focus is.
 */
export function uiCueFor(ev: UiEvent, attr: string | null, on = false): tokens.CueId | null {
  if (ev === 'back') {
    return 'ui_back';
  }
  // A panel root's open marker plays nothing here: the open cue comes from panelCues.ts or the director, so a click inside the panel stays silent.
  if (attr === null || attr === 'ui_panel_open') {
    return null;
  }
  switch (ev) {
    case 'hover': {
      return 'ui_hover';
    }
    case 'focus': {
      return 'ui_focus_move';
    }
    // A slider's tick comes from its input event (one per 5 % step), so a click on it plays nothing extra.
    case 'click': {
      return attr === 'ui_slider_tick' ? null : isCueId(attr) ? attr : null;
    }
    case 'toggle': {
      return attr === 'ui_toggle' ? (on ? 'ui_toggle_on' : 'ui_toggle_off') : null;
    }
    case 'value': {
      return attr === 'ui_value_change' ? 'ui_value_change' : null;
    }
  }
}

/** A range input's 5 % step: 0..20 across its min..max. A tick plays when this number changes. */
export function sliderStep(min: number, max: number, value: number): number {
  const span = max - min;
  if (!(span > 0)) {
    return 0;
  }
  return Math.round(((value - min) / span) * 20);
}

/** Tutorial typing: a tick on every third character typed (`typed` is the count so far). */
const TYPE_EVERY = 3;
export const typeTickDue = (typed: number): boolean => typed > 0 && typed % TYPE_EVERY === 0;

export interface CueStep {
  id: tokens.CueId;
  delayS: number;
}

/** The steps of one click: the element's cue now, then the `data-cue-next` transition 70 ms later. */
export function clickSteps(attr: string | null, next: string | null): CueStep[] {
  const id = uiCueFor('click', attr);
  const out: CueStep[] = [];
  if (id) {
    out.push({ id, delayS: 0 });
  }
  if (attr !== null && isCueId(next)) {
    out.push({ id: next, delayS: id ? NEXT_DELAY_S : 0 });
  }
  return out;
}

/** Tags whose Enter or Space the browser turns into a click itself; the click listener already plays those. */
const NATIVE_ACTIVATION: ReadonlySet<string> = new Set([
  'BUTTON',
  'A',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'SUMMARY',
  'LABEL',
]);

/** True when Enter or Space on this element makes no click, so the key listener must play its cue (a div with role="radio"). */
export function keyNeedsCue(key: string, tagName: string): boolean {
  return (key === 'Enter' || key === ' ') && !NATIVE_ACTIVATION.has(tagName.toUpperCase());
}
