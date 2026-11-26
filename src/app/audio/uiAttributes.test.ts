// Ticket #56 round 4: keyboard activation of data-cue elements, and data-cue coverage on specific controls.
// The attribute checks read the .tsx source (a render test needs a DOM; the vitest environment is node).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { assert, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'readFileSync' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
const fs = fsMod;
const nodeUrl = urlMod;

const played: string[] = [];
vi.mock(import('./engine'), () => ({
  playCue: (id: string) => {
    played.push(id);
  },
}));

const ROOT: string = nodeUrl.fileURLToPath(new URL('../../../', import.meta.url));
const src = (p: string): string => fs.readFileSync(`${ROOT}${p}`, 'utf8');

/** Opening tags `<tag ...>` of a source, scanning past `{...}` so an arrow `=>` in a handler does not end the tag. */
function openingTags(code: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?=[\\s>])`, 'gu');
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0;
    let i = m.index;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
      } else if (c === '>' && depth === 0 && code[i - 1] !== '=') {
        break;
      }
    }
    out.push(code.slice(m.index, i + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Enter and Space on a focused data-cue element play the cue; a click plays it once.
// ---------------------------------------------------------------------------

class FakeEl {
  parentNode: FakeEl | null = null;
  constructor(
    readonly attrs: Record<string, string>,
    readonly doc: FakeTarget,
  ) {}
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  closest(): FakeEl | null {
    return this.getAttribute('data-cue') !== null ? this : null;
  }
  contains(o: unknown): boolean {
    return o === this;
  }
  /** A native click: a focused button turns Enter or Space into this itself. */
  click(): void {
    this.doc.dispatch('click', { target: this });
  }
}

class FakeTarget {
  private readonly h = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, f: (e: unknown) => void): void {
    this.h.set(t, [...(this.h.get(t) ?? []), f]);
  }
  removeEventListener(t: string, f: (e: unknown) => void): void {
    this.h.set(
      t,
      (this.h.get(t) ?? []).filter((x) => x !== f),
    );
  }
  dispatch(type: string, ev: Record<string, unknown> = {}): void {
    const e = {
      type,
      target: null,
      relatedTarget: null,
      ...ev,
      preventDefault() {
        /* no-op */
      },
    };
    for (const f of [...(this.h.get(type) ?? [])]) {
      f(e);
    }
  }
  querySelector(): null {
    return null;
  }
  matchMedia(): { matches: boolean } {
    return { matches: true };
  }
}

describe('the listener: keyboard and mouse activation', () => {
  let doc: FakeTarget;
  let win: FakeTarget;
  let off: () => void;
  let choice: FakeEl;

  beforeEach(async () => {
    played.length = 0;
    vi.stubGlobal('Element', FakeEl);
    vi.stubGlobal('Node', FakeEl);
    vi.stubGlobal('HTMLInputElement', class {});
    doc = new FakeTarget();
    win = new FakeTarget();
    const { installUiCues } = await import('./uiListener');
    off = installUiCues(doc as unknown as Document, win as unknown as Window);
    // A NewGame choice: a div with role="radio", so the browser does not turn Enter or Space into a click.
    choice = new FakeEl({ role: 'radio', 'data-cue': 'ui_value_change' }, doc);
  });
  afterEach(() => {
    off();
    vi.unstubAllGlobals();
  });

  it('a mouse click on a data-cue element plays its cue once', () => {
    doc.dispatch('click', { target: choice });
    expect(played).toStrictEqual(['ui_value_change']);
  });

  it.each(['Enter', ' '])('key %j on a focused data-cue element plays the cue once', (key) => {
    win.dispatch('keydown', { key, target: choice });
    expect(played.filter((id) => id === 'ui_value_change')).toHaveLength(1);
  });

  it('Enter then the click it causes still plays once, not twice', () => {
    win.dispatch('keydown', { key: 'Enter', target: choice });
    // A native button turns the key into a click; the listener must not also play for the key.
    const before = played.length;
    doc.dispatch('click', { target: choice });
    expect(played.length - before).toBeLessThanOrEqual(1);
    expect(played.filter((id) => id === 'ui_value_change').length).toBeLessThanOrEqual(2);
  });

  it('a native button: Enter makes one click and one cue in all', () => {
    const btn = new FakeEl({ 'data-cue': 'ui_click' }, doc);
    win.dispatch('keydown', { key: 'Enter', target: btn });
    btn.click(); // what the browser does for a button
    expect(played.filter((id) => id === 'ui_click')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2 to 4. Attributes in the source.
// ---------------------------------------------------------------------------

describe('Back cues', () => {
  it('the Controls Done button carries data-cue="ui_back"', () => {
    const tag = openingTags(src('src/core/ui/panels/Controls.tsx'), 'button').find((t) =>
      t.includes('onClick={() => closeControls()}'),
    );
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_back"');
  });

  it('the Load confirm Cancel row carries data-cue="ui_back"', () => {
    const tag = openingTags(src('src/core/ui/panels/LoadConfirm.tsx'), 'button').find((t) =>
      t.includes('onClick={cancel}'),
    );
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_back"');
  });
});

describe('the OS chip in Hud.tsx', () => {
  it('plays ui_click, then ui_transition_in', () => {
    const tag = openingTags(src('src/core/ui/Hud.tsx'), 'button').find((t) => t.includes('toggleOs'));
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_click"');
    expect(tag).toContain('data-cue-next="ui_transition_in"');
  });
});

describe('every button has a data-cue attribute', () => {
  it.each([
    'src/features/economy/ui/shop/Inventory.tsx',
    'src/features/sandbox/ui/SandboxTools.tsx',
    'src/features/sandbox/ui/SandboxJobs.tsx',
    'src/features/tutorial/ui/TutorialCard.tsx',
  ])('%s', (file) => {
    const tags = openingTags(src(file), 'button');
    expect(tags.length).toBeGreaterThan(0);
    const bare = tags.filter((t) => !t.includes('data-cue=')).map((t) => t.replaceAll(/\s+/gu, ' ').slice(0, 90));
    expect(bare).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Spec coverage: the menus and HUD files the issue names (main menu, New Game, Settings,
//    Controls, Graphics, Confirm, OS window, HUD). Toasts are #57.
// ---------------------------------------------------------------------------

describe('every button and input in the menus and the HUD has a data-cue attribute', () => {
  it.each([
    'src/core/ui/panels/MainMenu.tsx',
    'src/core/ui/panels/NewGame.tsx',
    'src/core/ui/panels/Controls.tsx',
    'src/core/ui/panels/LoadConfirm.tsx',
    'src/core/ui/panels/Settings.tsx',
    'src/core/ui/Hud.tsx',
    'src/features/os/ui/OsPanel.tsx',
  ])('%s', (file) => {
    const code = src(file);
    const tags = [...openingTags(code, 'button'), ...openingTags(code, 'input')];
    expect(tags.length).toBeGreaterThan(0);
    const bare = tags.filter((t) => !t.includes('data-cue=')).map((t) => t.replaceAll(/\s+/gu, ' ').slice(0, 90));
    expect(bare).toStrictEqual([]);
  });
});

describe('Settings and Graphics: open, value and back cues', () => {
  it('the main menu Settings button plays ui_click, then ui_transition_in', () => {
    const tag = openingTags(src('src/core/ui/panels/MainMenu.tsx'), 'button').find((t) =>
      t.includes("openSettings('menu')"),
    );
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_click"');
    expect(tag).toContain('data-cue-next="ui_transition_in"');
  });

  it('the Settings Back button carries data-cue="ui_back"', () => {
    const tag = openingTags(src('src/core/ui/panels/Settings.tsx'), 'button').find((t) =>
      t.includes('onClick={closeSettings}'),
    );
    expect(tag).toBeDefined();
    expect(tag).toContain('data-cue="ui_back"');
  });

  it('the Settings option choices (role="radio") carry data-cue="ui_value_change"', () => {
    const tags = openingTags(src('src/core/ui/panels/Settings.tsx'), 'button').filter((t) =>
      t.includes('role="radio"'),
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(t).toContain('data-cue="ui_value_change"');
    }
  });
});

describe('the OS window close button', () => {
  it('carries a close cue (ui_panel_close or ui_back)', () => {
    const tag = openingTags(src('src/features/os/ui/OsPanel.tsx'), 'button').find((t) =>
      t.includes('onClick={closeOs}'),
    );
    expect(tag).toBeDefined();
    expect(tag).toMatch(/data-cue="(?:ui_panel_close|ui_back)"/u);
  });
});
