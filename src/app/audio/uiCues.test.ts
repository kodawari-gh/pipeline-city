// Ticket #56: UI sounds on menus and the HUD.
// Part 1: the pure mapping (uiCues.ts). Part 2: the one document-level listener (uiListener.ts) that reads `data-cue`.
// The vitest environment is node, so small fakes stand in for the DOM: Element, Node, HTMLInputElement, the document
// and the window. The engine is the real one, with a fake AudioContext, fetch and window: the tests read which
// files it played, and when.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIX } from './mixTokens';
import { clickSteps, isCueId, keyNeedsCue, uiCueFor } from './uiCues';

// ---------------------------------------------------------------------------
// Part 1: pure mapping. No DOM, no engine.
// ---------------------------------------------------------------------------

describe('keyNeedsCue: Enter and Space on elements that make no click', () => {
  it('is true for Enter and Space on a div, false on native controls and other keys', () => {
    expect(keyNeedsCue('Enter', 'DIV')).toBe(true);
    expect(keyNeedsCue(' ', 'div')).toBe(true);
    expect(keyNeedsCue('Enter', 'BUTTON')).toBe(false);
    expect(keyNeedsCue(' ', 'INPUT')).toBe(false);
    expect(keyNeedsCue('a', 'DIV')).toBe(false);
  });
});

describe('uiCueFor: the cue for one UI event on an element', () => {
  it('hover plays ui_hover on an element with data-cue, and nothing on one without', () => {
    expect(uiCueFor('hover', 'ui_click')).toBe('ui_hover');
    expect(uiCueFor('hover', null)).toBeNull();
  });

  it('focus plays ui_focus_move on an element with data-cue', () => {
    expect(uiCueFor('focus', 'ui_click')).toBe('ui_focus_move');
    expect(uiCueFor('focus', null)).toBeNull();
  });

  it('click plays the cue the element names, and nothing for a name that is not a cue', () => {
    expect(uiCueFor('click', 'ui_click')).toBe('ui_click');
    expect(uiCueFor('click', 'ui_tab_switch')).toBe('ui_tab_switch');
    expect(uiCueFor('click', 'not_a_cue')).toBeNull();
    expect(uiCueFor('click', null)).toBeNull();
  });

  it('toggle plays on or off by the new state of a ui_toggle checkbox, and nothing for another element', () => {
    expect(uiCueFor('toggle', 'ui_toggle', true)).toBe('ui_toggle_on');
    expect(uiCueFor('toggle', 'ui_toggle', false)).toBe('ui_toggle_off');
    expect(uiCueFor('toggle', 'ui_click', true)).toBeNull();
  });

  it('value plays ui_value_change only on a value element', () => {
    expect(uiCueFor('value', 'ui_value_change')).toBe('ui_value_change');
    expect(uiCueFor('value', 'ui_click')).toBeNull();
    expect(uiCueFor('value', null)).toBeNull();
  });

  it('back plays ui_back wherever it is, with or without an attribute', () => {
    expect(uiCueFor('back', null)).toBe('ui_back');
    expect(uiCueFor('back', 'ui_click')).toBe('ui_back');
  });
});

describe('isCueId: only names in the mix are cues', () => {
  it('accepts a mix cue, and rejects anything else', () => {
    expect(isCueId('ui_click')).toBe(true);
    expect(isCueId('not_a_cue')).toBe(false);
    expect(isCueId(null)).toBe(false);
    expect(isCueId(undefined)).toBe(false);
  });
});

describe('clickSteps: a click plays its cue, then a sub-screen transition 60 to 80 ms later', () => {
  it('a click with no next cue plays its own cue at once', () => {
    expect(clickSteps('ui_click', null)).toEqual([{ id: 'ui_click', delayS: 0 }]);
  });

  it('a sub-screen click plays ui_click at once, then the transition inside the 60-80 ms window', () => {
    const steps = clickSteps('ui_click', 'ui_transition_in');
    expect(steps.map((s) => s.id)).toEqual(['ui_click', 'ui_transition_in']);
    expect(steps[0]!.delayS).toBe(0);
    expect(steps[1]!.delayS).toBeGreaterThanOrEqual(0.06);
    expect(steps[1]!.delayS).toBeLessThanOrEqual(0.08);
  });

  it('an element with no data-cue plays nothing, even with a next cue', () => {
    expect(clickSteps(null, 'ui_transition_in')).toEqual([]);
  });

  it('an unknown next cue is dropped and the click still plays', () => {
    expect(clickSteps('ui_click', 'not_a_cue')).toEqual([{ id: 'ui_click', delayS: 0 }]);
  });
});

describe('the mix names every cue this ticket uses', () => {
  it.each([
    'ui_hover', 'ui_focus_move', 'ui_click', 'ui_back', 'ui_value_change',
    'ui_toggle_on', 'ui_toggle_off', 'ui_tab_switch', 'ui_transition_in', 'ui_transition_out',
  ])('%s is a cue id', (id) => {
    expect(MIX.cues.map((c) => c.id)).toContain(id);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the listener, with the real engine behind it.
// ---------------------------------------------------------------------------

const UI_IDS = [
  'ui_hover', 'ui_focus_move', 'ui_click', 'ui_back', 'ui_value_change',
  'ui_toggle_on', 'ui_toggle_off', 'ui_tab_switch', 'ui_transition_in', 'ui_transition_out',
];
const rel = (p: string): string => p.replace(/^\/?audio\//, '');
const filesOf = (id: string): string[] => (MIX.cues.find((c) => c.id === id)?.files ?? []).map(rel);
const UI_FILES = UI_IDS.flatMap(filesOf);
const cueOfFile = (file: string | undefined): string | undefined =>
  MIX.cues.find((c) => c.files.some((f) => rel(f) === file))?.id;

/** Fake DOM: a selector is a list of `[name]` or `[name="value"]` parts. Anything else throws, so a new selector fails loudly. */
function matches(el: FakeElement, sel: string): boolean {
  return sel.split(',').some((part) => {
    const m = /^\s*\[([\w-]+)(?:="([^"]*)")?\]\s*$/.exec(part);
    if (!m) throw new Error(`fake DOM: selector not supported: ${part}`);
    const have = el.getAttribute(m[1]!);
    return m[2] === undefined ? have !== null : have === m[2];
  });
}

/** Stands in for the DOM Node class. `contains` walks up from the other node, as the DOM does. */
class FakeNode {
  parentNode: FakeNode | null = null;
  contains(other: unknown): boolean {
    for (let n: FakeNode | null = other instanceof FakeNode ? other : null; n; n = n.parentNode) {
      if (n === this) return true;
    }
    return false;
  }
}

/** Stands in for Element: attributes, a parent, and `closest`. */
class FakeElement extends FakeNode {
  readonly attrs: Record<string, string>;
  tagName = 'BUTTON';
  constructor(attrs: Record<string, string> = {}, parent?: FakeElement) {
    super();
    this.attrs = attrs;
    this.parentNode = parent ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  closest(sel: string): FakeElement | null {
    for (let n: FakeNode | null = this; n; n = n.parentNode) {
      if (n instanceof FakeElement && matches(n, sel)) return n;
    }
    return null;
  }
}

/** Stands in for HTMLInputElement: a checkbox has a `checked` state. */
class FakeInput extends FakeElement {
  checked = false;
}

const elem = (attrs: Record<string, string> = {}, parent?: FakeElement): FakeElement =>
  new FakeElement(attrs, parent);

interface Ev {
  target?: FakeNode | null;
  relatedTarget?: FakeNode | null;
  key?: string;
  repeat?: boolean;
}

/** Records the listeners on one target and fires an event at them. */
class FakeTarget {
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, h: (e: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]);
  }
  removeEventListener(type: string, h: (e: unknown) => void): void {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((x) => x !== h));
  }
  listenerCount(type: string): number {
    return (this.handlers.get(type) ?? []).length;
  }
  dispatch(type: string, ev: Ev = {}): void {
    const e = { type, target: null, relatedTarget: null, ...ev, preventDefault() {} };
    for (const h of [...(this.handlers.get(type) ?? [])]) h(e);
  }
}

/** A fake document. `elements` are the ones `querySelector` can find (an open dialog, for Esc). */
class FakeDoc extends FakeTarget {
  readonly elements: FakeElement[] = [];
  querySelector(sel: string): FakeElement | null {
    return this.elements.find((e) => matches(e, sel)) ?? null;
  }
}

/** A fake window. `hover` is what `(hover: hover)` answers: false is a touch device. */
class FakeWin extends FakeTarget {
  readonly hover: boolean;
  constructor(hover: boolean) {
    super();
    this.hover = hover;
  }
  matchMedia(): { matches: boolean } {
    return { matches: this.hover };
  }
}

// The real engine: a fake AudioContext records each source and the time it started.
class Param {
  value = 1;
  setTargetAtTime(): this { return this; }
  setValueAtTime(): this { return this; }
  linearRampToValueAtTime(): this { return this; }
  cancelScheduledValues(): this { return this; }
}
class Node_ {
  connect<T>(n: T): T { return n; }
  disconnect(): void {}
}
class Gain extends Node_ { gain = new Param(); }
class Source extends Node_ {
  buffer: { path: string } | null = null;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  startAt = -1;
  start(when = 0): void { this.started = true; this.startAt = when; }
  stop(): void {}
}
class FakeCtx {
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new Node_();
  sources: Source[] = [];
  constructor() { FakeCtx.last = this; }
  createGain(): Gain { return new Gain(); }
  createDelay() { return Object.assign(new Gain(), { delayTime: new Param() }); }
  createBufferSource(): Source { const s = new Source(); this.sources.push(s); return s; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}
class FakeOffline {
  decodeAudioData(data: { path: string }): Promise<{ path: string }> { return Promise.resolve(data); }
}
async function fakeFetch(url: string) {
  const path = url.slice(url.indexOf('audio/') + 'audio/'.length);
  return { ok: true, status: 200, arrayBuffer: async () => ({ path }) };
}

let win: EventTarget;
/** The sources the engine started, in order: the cue id of each, and its start time (seconds). */
const plays = () =>
  (FakeCtx.last?.sources ?? []).filter((s) => s.started).map((s) => ({ id: cueOfFile(s.buffer?.path), at: s.startAt }));
const cues = () => plays().map((p) => p.id);
const playedFiles = () => (FakeCtx.last?.sources ?? []).filter((s) => s.started).map((s) => s.buffer?.path);

beforeEach(() => {
  win = new EventTarget();
  FakeCtx.last = null;
  vi.stubGlobal('window', win);
  vi.stubGlobal('addEventListener', (t: string, f: any, o?: any) => win.addEventListener(t, f, o));
  vi.stubGlobal('removeEventListener', (t: string, f: any, o?: any) => win.removeEventListener(t, f, o));
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('HTMLInputElement', FakeInput);
  // A clock that moves 1 s per read: the engine's voice pool never refuses a cue for timing.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000));
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The listener on a fake document and window, with the engine it plays through. */
async function setup(hover = true) {
  const { installUiCues } = await import('./uiListener');
  const doc = new FakeDoc();
  const w = new FakeWin(hover);
  const off = installUiCues(doc as unknown as Document, w as unknown as Window);
  return { doc, w, off };
}

/** The real engine, unlocked by a gesture on the window, with every UI file loaded. */
async function unlocked() {
  const engine = await import('./engine');
  engine.unlockOnGesture();
  await engine.preload(UI_FILES);
  win.dispatchEvent(new Event('keydown'));
  return engine;
}

describe('before the unlock gesture', () => {
  it('nothing plays for any UI event, even with the engine wired in', async () => {
    const { unlockOnGesture } = await import('./engine');
    unlockOnGesture();
    const { doc, w } = await setup(true);
    const btn = elem({ 'data-cue': 'ui_click' });
    doc.elements.push(elem({ role: 'dialog' }));
    doc.dispatch('pointerover', { target: btn });
    doc.dispatch('click', { target: btn });
    doc.dispatch('change', { target: new FakeInput({ 'data-cue': 'ui_toggle' }) });
    w.dispatch('keydown', { key: 'Escape', target: btn });
    w.dispatch('keydown', { key: 'ArrowLeft', target: elem({ 'data-cue': 'ui_value_change' }) });
    expect(FakeCtx.last).toBeNull();
    expect(plays()).toEqual([]);
  });

  it('after the gesture, the same listener plays', async () => {
    await unlocked();
    const { doc } = await setup();
    doc.dispatch('click', { target: elem({ 'data-cue': 'ui_click' }) });
    expect(cues()).toEqual(['ui_click']);
  });
});

describe('clicks', () => {
  it('a click on an element with data-cue plays that cue', async () => {
    await unlocked();
    const { doc } = await setup();
    doc.dispatch('click', { target: elem({ 'data-cue': 'ui_toggle_on' }) });
    expect(cues()).toEqual(['ui_toggle_on']);
  });

  it('a click inside an element with data-cue plays the cue of that element', async () => {
    await unlocked();
    const { doc } = await setup();
    const row = elem({ 'data-cue': 'ui_tab_switch' });
    doc.dispatch('click', { target: elem({}, row) });
    expect(cues()).toEqual(['ui_tab_switch']);
  });

  it('a click on an element with no data-cue plays nothing', async () => {
    await unlocked();
    const { doc } = await setup();
    doc.dispatch('click', { target: elem({}) });
    expect(cues()).toEqual([]);
  });

  it('a keyboard activation plays click: Enter and Space move no sound, the click they cause does', async () => {
    await unlocked();
    const { doc, w } = await setup();
    const btn = elem({ 'data-cue': 'ui_click' });
    w.dispatch('keydown', { key: 'Enter', target: btn });
    w.dispatch('keydown', { key: ' ', target: btn });
    expect(cues()).toEqual([]);
    doc.dispatch('click', { target: btn });
    expect(cues()).toEqual(['ui_click']);
  });

  it('Enter and Space on a focused non-native cue element (a role=radio div) play its cue once, not on repeat', async () => {
    await unlocked();
    const { w } = await setup();
    const radio = elem({ 'data-cue': 'ui_value_change', role: 'radio' });
    radio.tagName = 'DIV';
    w.dispatch('keydown', { key: 'Enter', target: radio });
    expect(cues()).toEqual(['ui_value_change']);
    w.dispatch('keydown', { key: ' ', target: radio, repeat: true });
    expect(cues()).toEqual(['ui_value_change']);
    w.dispatch('keydown', { key: ' ', target: radio });
    expect(cues()).toEqual(['ui_value_change', 'ui_value_change']);
  });

  it('a sub-screen click plays ui_click at once, then the transition 60 to 80 ms later', async () => {
    await unlocked();
    const { doc } = await setup();
    doc.dispatch('click', { target: elem({ 'data-cue': 'ui_click', 'data-cue-next': 'ui_transition_in' }) });
    expect(cues()).toEqual(['ui_click', 'ui_transition_in']);
    const [click, transition] = plays();
    expect(click!.at).toBe(0);
    expect(transition!.at).toBeGreaterThanOrEqual(0.06);
    expect(transition!.at).toBeLessThanOrEqual(0.08);
  });
});

describe('keys', () => {
  it('Escape plays ui_back while a dialog, an alert dialog or a menu is open', async () => {
    await unlocked();
    const { doc, w } = await setup();
    const btn = elem({ 'data-cue': 'ui_click' });
    doc.elements.push(elem({ role: 'dialog' }));
    w.dispatch('keydown', { key: 'Escape', target: btn });
    expect(cues()).toEqual(['ui_back']);
  });

  it('Escape plays nothing when no dialog or menu is open', async () => {
    await unlocked();
    const { w } = await setup();
    w.dispatch('keydown', { key: 'Escape', target: elem({ 'data-cue': 'ui_click' }) });
    expect(cues()).toEqual([]);
  });

  it.each(['alertdialog', 'menu'])('Escape plays ui_back with an open role=%s', async (role) => {
    await unlocked();
    const { doc, w } = await setup();
    doc.elements.push(elem({ role }));
    w.dispatch('keydown', { key: 'Escape', target: elem({}) });
    expect(cues()).toEqual(['ui_back']);
  });

  it('ArrowLeft and ArrowRight on a value element play ui_value_change', async () => {
    await unlocked();
    const { w } = await setup();
    const value = elem({ 'data-cue': 'ui_value_change' });
    w.dispatch('keydown', { key: 'ArrowLeft', target: value });
    w.dispatch('keydown', { key: 'ArrowRight', target: value });
    expect(cues()).toEqual(['ui_value_change', 'ui_value_change']);
  });

  it('an arrow on an element that is not a value plays nothing, and ArrowUp plays nothing even on a value', async () => {
    await unlocked();
    const { w } = await setup();
    w.dispatch('keydown', { key: 'ArrowLeft', target: elem({ 'data-cue': 'ui_click' }) });
    w.dispatch('keydown', { key: 'ArrowUp', target: elem({ 'data-cue': 'ui_value_change' }) });
    expect(cues()).toEqual([]);
  });
});

describe('keyboard focus moves', () => {
  it('a focus move after a key plays ui_focus_move', async () => {
    await unlocked();
    const { doc, w } = await setup();
    w.dispatch('keydown', { key: 'Tab' });
    doc.dispatch('focusin', { target: elem({ 'data-cue': 'ui_click' }) });
    expect(cues()).toEqual(['ui_focus_move']);
  });

  it('a focus that comes from a pointer press plays nothing', async () => {
    await unlocked();
    const { doc, w } = await setup();
    w.dispatch('keydown', { key: 'Tab' });
    doc.dispatch('pointerdown', { target: elem({}) });
    doc.dispatch('focusin', { target: elem({ 'data-cue': 'ui_click' }) });
    expect(cues()).toEqual([]);
  });

  it('a focus move onto an element with no data-cue plays nothing', async () => {
    await unlocked();
    const { doc, w } = await setup();
    w.dispatch('keydown', { key: 'Tab' });
    doc.dispatch('focusin', { target: elem({}) });
    expect(cues()).toEqual([]);
  });
});

describe('hover cues', () => {
  it('a pointer entering an element with data-cue plays ui_hover on a device with hover', async () => {
    await unlocked();
    const { doc } = await setup(true);
    doc.dispatch('pointerover', { target: elem({ 'data-cue': 'ui_click' }), relatedTarget: null });
    expect(cues()).toEqual(['ui_hover']);
  });

  it('plays nothing on a device without hover (touch)', async () => {
    await unlocked();
    const { doc } = await setup(false);
    doc.dispatch('pointerover', { target: elem({ 'data-cue': 'ui_click' }), relatedTarget: null });
    expect(cues()).toEqual([]);
  });

  it('plays nothing for an element with no data-cue', async () => {
    await unlocked();
    const { doc } = await setup(true);
    doc.dispatch('pointerover', { target: elem({}), relatedTarget: null });
    expect(cues()).toEqual([]);
  });

  it('moving between the parts of one row does not play again while the pointer stays', async () => {
    await unlocked();
    const { doc } = await setup(true);
    const outside = elem({});
    const row = elem({ 'data-cue': 'ui_click' });
    const part = elem({}, row);
    doc.dispatch('pointerover', { target: row, relatedTarget: outside });
    doc.dispatch('pointerover', { target: part, relatedTarget: row });
    expect(cues()).toEqual(['ui_hover']);
  });

  it('plays again after the pointer leaves the row and comes back', async () => {
    await unlocked();
    const { doc } = await setup(true);
    const outside = elem({});
    const row = elem({ 'data-cue': 'ui_click' });
    doc.dispatch('pointerover', { target: row, relatedTarget: outside });
    doc.dispatch('pointerover', { target: outside, relatedTarget: row });
    doc.dispatch('pointerover', { target: row, relatedTarget: outside });
    expect(cues()).toEqual(['ui_hover', 'ui_hover']);
  });

  it('hover variants rotate round-robin through the ui_hover files', async () => {
    await unlocked();
    const { doc } = await setup(true);
    const files = filesOf('ui_hover');
    const outside = elem({});
    const row = elem({ 'data-cue': 'ui_click' });
    for (let i = 0; i < files.length + 1; i++) {
      doc.dispatch('pointerover', { target: row, relatedTarget: outside });
      doc.dispatch('pointerover', { target: outside, relatedTarget: row });
    }
    expect(playedFiles()).toEqual([...files, files[0]]);
  });
});

describe('checkboxes', () => {
  it('a checkbox with ui_toggle plays on when checked and off when cleared', async () => {
    await unlocked();
    const { doc } = await setup();
    const on = new FakeInput({ 'data-cue': 'ui_toggle' });
    on.checked = true;
    const off = new FakeInput({ 'data-cue': 'ui_toggle' });
    off.checked = false;
    doc.dispatch('change', { target: on });
    doc.dispatch('change', { target: off });
    expect(cues()).toEqual(['ui_toggle_on', 'ui_toggle_off']);
  });

  it('a checkbox with no data-cue plays nothing, and a change on a non-input plays nothing', async () => {
    await unlocked();
    const { doc } = await setup();
    const plain = new FakeInput({});
    plain.checked = true;
    doc.dispatch('change', { target: plain });
    doc.dispatch('change', { target: elem({ 'data-cue': 'ui_toggle' }) });
    expect(cues()).toEqual([]);
  });
});

describe('removing the listener', () => {
  it('the function returned by installUiCues removes every listener', async () => {
    await unlocked();
    const { doc, w, off } = await setup();
    off();
    expect(doc.listenerCount('click')).toBe(0);
    expect(doc.listenerCount('pointerover')).toBe(0);
    expect(doc.listenerCount('focusin')).toBe(0);
    expect(doc.listenerCount('change')).toBe(0);
    expect(doc.listenerCount('pointerdown')).toBe(0);
    expect(w.listenerCount('keydown')).toBe(0);
    doc.dispatch('click', { target: elem({ 'data-cue': 'ui_click' }) });
    expect(cues()).toEqual([]);
  });
});
