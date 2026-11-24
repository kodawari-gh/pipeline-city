// Ticket #57: UI cues on toasts, panels, drag, tutorial typing and sliders.
// The checks read the source files (a render test needs a DOM; the vitest environment is node).
// The notify rule is checked on the pure mapping (events.ts).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { cueForNote } from './events';

const ROOT: string = urlMod.fileURLToPath(new URL('../../../', import.meta.url));
const src = (p: string): string => (fsMod as any).readFileSync(`${ROOT}${p}`, 'utf8');

/** Opening tags `<tag ...>` of a source, scanning past `{...}` so an arrow `=>` in a handler does not end the tag. */
function openingTags(code: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?=[\\s>])`, 'g');
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0;
    let i = m.index;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && code[i - 1] !== '=') break;
    }
    out.push(code.slice(m.index, i + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Toasts: the hint toast plays ui_warn, the refused-action notice plays ui_error.
// ---------------------------------------------------------------------------

describe('toasts', () => {
  it('the hint toast card carries data-cue="ui_warn"', () => {
    const tag = openingTags(src('src/core/ui/panels/Toasts.tsx'), 'div').find((t) => t.includes('class="card toast"'));
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_warn"');
  });

  it('the refused-action notice card carries data-cue="ui_error"', () => {
    const tag = openingTags(src('src/core/ui/panels/Toasts.tsx'), 'div').find((t) => t.includes('class="card notice"'));
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_error"');
  });

  it('the notify cue (ui_notify) plays for a network log note', () => {
    expect(cueForNote({ kind: 'net', text: 'download #07 failed: the machine did not answer' })).toBe('ui_notify');
  });

  it('the notify cue (ui_notify) plays for a sandbox log note', () => {
    expect(cueForNote({ kind: 'sandbox', text: 'rules level set to 3 (Level 3)' })).toBe('ui_notify');
  });

  it.each(['install', 'payout', 'fault'])('the notify cue does not play for a %s log note', (kind) => {
    expect(cueForNote({ kind, text: 'some other log text' })).not.toBe('ui_notify');
  });
});

// ---------------------------------------------------------------------------
// 2. Panels: each panel plays ui_panel_open when it opens and ui_panel_close when it closes.
// ---------------------------------------------------------------------------

const PANELS: [string, string][] = [
  ['Build flyout', 'src/features/board/ui/BuildMode.tsx'],
  ['machine list', 'src/features/board/ui/BuildMachine.tsx'],
  ['inventory', 'src/features/economy/ui/shop/Inventory.tsx'],
  ['Shop', 'src/features/economy/ui/shop/Shop.tsx'],
  ['Almanac', 'src/features/jobs/ui/AlmanacPanel.tsx'],
  ['Log', 'src/core/ui/panels/LogPanel.tsx'],
  ['OS', 'src/features/os/ui/OsPanel.tsx'],
  ['Paused menu', 'src/core/ui/panels/Paused.ts'],
];

describe('panels', () => {
  // (Paused.ts builds its tree with h(): the marker reads 'data-cue': 'ui_panel_open')
  it.each(PANELS)('the %s panel plays ui_panel_open', (_name, file) => {
    expect(src(file)).toMatch(/data-cue(="|': ')ui_panel_open/);
  });

  it('the panel watcher plays ui_panel_open for the Build flyout flag (buildOpen)', () => {
    const code = src('src/core/ui/panelCues.ts');
    expect(code).toMatch(/PANELS: .* = \[[^\]]*\bbuildOpen\b[^\]]*\];/);
    expect(code).toContain("playCue('ui_panel_open')");
  });

  it('the Build my PC row does not play a transition cue over the open cue', () => {
    // (the menu rows share one button: only New game and Gallery name a transition)
    expect(src('src/core/ui/panels/MainMenu.tsx')).toContain(
      "data-cue-next={r.key === 'new' || r.key === 'gallery' ? 'ui_transition_in' : undefined}",
    );
  });

  // The machine list has no close X of its own: the Build flyout's X closes it. The Paused menu closes with Resume (ui_back).
  it.each(PANELS.filter(([name]) => name !== 'machine list' && name !== 'Paused menu'))(
    'the %s panel plays ui_panel_close',
    (_name, file) => {
      expect(src(file)).toMatch(/data-cue="ui_panel_close"/);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Drag: starting to drag a part plays ui_pickup.
// ---------------------------------------------------------------------------

describe('drag', () => {
  it('the part drag start plays ui_pickup', () => {
    const code = src('src/features/board/render/three/drag3d.ts');
    expect(code).toContain('ui_pickup');
    // Each place a part drag starts (dragging.value = { kind: 'part', ... }) must have the pickup cue close by.
    const starts = [...code.matchAll(/dragging\.value = \{ kind: 'part'/g)].map((m) => m.index ?? 0);
    expect(starts.length).toBeGreaterThan(0);
    for (const at of starts) {
      const window = code.slice(Math.max(0, at - 300), at + 300);
      expect(window).toContain('ui_pickup');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Tutorial typing: a tick on every third character, none with reduced motion.
// ---------------------------------------------------------------------------

describe('tutorial typing', () => {
  it('the tutorial typing plays ui_type_tick', () => {
    expect(src('src/features/tutorial/ui/TutorialCard.tsx')).toContain('ui_type_tick');
  });

  it('the typing tick sits after the reduced-motion return, so reduced motion plays none', () => {
    const code = src('src/features/tutorial/ui/TutorialCard.tsx');
    const guard = code.indexOf('if (reducedMotion())');
    const tick = code.indexOf('ui_type_tick');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(tick).toBeGreaterThan(guard);
  });
});

// ---------------------------------------------------------------------------
// 5. Sliders: every range slider plays ui_slider_tick on each 5 % step.
// ---------------------------------------------------------------------------

const SLIDER_FILES: [string, string][] = [
  ['sandbox jobs', 'src/features/sandbox/ui/SandboxJobs.tsx'],
  ['trace panel', 'src/features/cpu/ui/TracePanel.tsx'],
  ['CPU clock and Memory clock pickers', 'src/features/economy/ui/shop/PickerCard.tsx'],
  ['OS spool and reserve sliders', 'src/features/os/ui/OsViews.tsx'],
];

describe('sliders', () => {
  // The Settings screen draws its sliders itself (UI size, render scale, brightness, the four volumes): `slideTo` ticks on each 5 % step.
  it('the Settings sliders tick on each 5 % step', () => {
    const code = src('src/core/ui/panels/Settings.tsx');
    expect(code).toContain("playCue('ui_slider_tick')");
    expect(code).toContain('sliderStep(');
  });

  it.each(SLIDER_FILES)('every range slider in the %s carries data-cue="ui_slider_tick"', (_name, file) => {
    const tags = openingTags(src(file), 'input').filter((t) => t.includes('type="range"'));
    expect(tags.length).toBeGreaterThan(0);
    const bare = tags
      .filter((t) => !t.includes('data-cue="ui_slider_tick"'))
      .map((t) => t.replaceAll(/\s+/g, ' ').slice(0, 90));
    expect(bare).toEqual([]);
  });
});
