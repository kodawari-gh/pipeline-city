// The one document-level UI sound listener. It reads `data-cue` (uiCues.ts) for hover, keyboard focus, click, Enter and Space on non-native cue elements, checkbox change and arrow keys,
// and plays Esc as Back while a dialog or menu is open. Installed once from initAudio. playCue is silent before the unlock gesture.
import { playCue } from './engine';
import { CUE_ATTR, NEXT_ATTR, clickSteps, keyNeedsCue, sliderStep, uiCueFor, type CueStep } from './uiCues';

const CUE_SELECTOR = `[${CUE_ATTR}]`;
/** Esc plays Back while one of these is open (checked in the capture phase, before the handler closes it). */
const OPEN_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"]';

const cueOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>(CUE_SELECTOR) : null;

/** The tag name of a key target. Without one, a role other than "button" means an element that makes no click of its own. */
function tagOf(t: Element | null): string {
  if (t?.tagName) return t.tagName;
  const role = t?.getAttribute?.('role');
  return role && role !== 'button' ? 'DIV' : 'BUTTON';
}

/** Installs the listeners on `doc`. Returns a function that removes them (tests). */
export function installUiCues(doc: Document = document, win: Window = window): () => void {
  const hover = typeof win.matchMedia === 'function' ? win.matchMedia('(hover: hover)') : null;
  // Keyboard focus moves play the focus cue; a pointer press turns that off until the next key.
  let keyboard = false;
  const play = (steps: CueStep[]) => {
    for (const s of steps) playCue(s.id, { delayS: s.delayS });
  };

  // The last 5 % step each range input showed. A pointer press or focus records it, so the first move compares with it.
  const steps = new WeakMap<Element, number>();
  const remember = (t: EventTarget | null) => {
    if (t instanceof HTMLInputElement && t.type === 'range')
      steps.set(t, sliderStep(Number(t.min), Number(t.max), Number(t.value)));
  };
  const onPointerDown = (e: Event) => {
    keyboard = false;
    remember(e.target);
  };
  const onInput = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'range') return;
    const step = sliderStep(Number(t.min), Number(t.max), Number(t.value));
    const prev = steps.get(t);
    steps.set(t, step);
    if (prev !== step) playCue('ui_slider_tick');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    keyboard = true;
    if (e.key === 'Escape') {
      if (doc.querySelector(OPEN_SELECTOR)) playCue('ui_back');
      return;
    }
    if (!e.repeat && keyNeedsCue(e.key, tagOf(e.target as Element | null))) {
      // Enter or Space on a focused cue element that makes no click of its own (a role="radio" div): play its click steps here.
      const el = cueOf(e.target);
      if (el && e.target === el) play(clickSteps(el.getAttribute(CUE_ATTR), el.getAttribute(NEXT_ATTR)));
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const el = cueOf(e.target);
      const id = el && uiCueFor('value', el.getAttribute(CUE_ATTR));
      if (id) playCue(id);
    }
  };
  const onPointerOver = (e: PointerEvent) => {
    if (!hover?.matches) return;
    const el = cueOf(e.target);
    // Moving between the parts of one element is not a new hover: only entering it from outside plays.
    if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
    const id = uiCueFor('hover', el.getAttribute(CUE_ATTR));
    if (id) playCue(id);
  };
  const onFocusIn = (e: FocusEvent) => {
    remember(e.target);
    if (!keyboard) return;
    const el = cueOf(e.target);
    const id = el && uiCueFor('focus', el.getAttribute(CUE_ATTR));
    if (id) playCue(id);
  };
  const onClick = (e: MouseEvent) => {
    const el = cueOf(e.target);
    if (el) play(clickSteps(el.getAttribute(CUE_ATTR), el.getAttribute(NEXT_ATTR)));
  };
  const onChange = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const el = cueOf(t);
    const id = el && uiCueFor('toggle', el.getAttribute(CUE_ATTR), t.checked);
    if (id) playCue(id);
  };

  doc.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointerover', onPointerOver as EventListener);
  doc.addEventListener('focusin', onFocusIn as EventListener);
  doc.addEventListener('click', onClick as EventListener);
  doc.addEventListener('change', onChange);
  doc.addEventListener('input', onInput as EventListener);
  return () => {
    doc.removeEventListener('input', onInput as EventListener);
    doc.removeEventListener('pointerdown', onPointerDown as EventListener, true);
    win.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('pointerover', onPointerOver as EventListener);
    doc.removeEventListener('focusin', onFocusIn as EventListener);
    doc.removeEventListener('click', onClick as EventListener);
    doc.removeEventListener('change', onChange);
  };
}
