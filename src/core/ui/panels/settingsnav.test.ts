// The Settings screen's keys, Peek and Back (ticket #38; SPEC §5.6 and §5.6a).
// Signatures used here (the coder's module is `src/core/ui/panels/settingsnav.ts`, pure TS, plus the opener signal):
//   SETTINGS_TABS: the five tabs in order, ids quality, display, light, detail, interface; names Quality, Display, Light, Detail, Interface.
//   SETTINGS_ROWS: the row labels of each tab.
//   railMove(at, count, key, railFocused): the tab index after a key. ← → move the tab only while the tab list has the focus.
//   rowMove(count, at, key): the row index after a key. ↑ ↓ move the row; ← → keep it.
//   peekHeld(held, ev): whether Peek is held after an event. Pointer down (mouse or touch) holds it, and its release lets go.
//     Space or Enter down holds it, and their up lets go.
//   settingsOpener (signal), openSettings(from), closeSettings(): Back returns to the screen that opened Settings.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeSettings,
  openSettings,
  peekHeld,
  railMove,
  rowMove,
  SETTINGS_ROWS,
  SETTINGS_TABS,
  settingsOpener,
} from './settingsnav';

describe('the tab model', () => {
  it('has the five tabs in order, Quality first', () => {
    expect(SETTINGS_TABS.map((t) => t.name)).toStrictEqual(['Quality', 'Display', 'Light', 'Detail', 'Interface']);
  });

  it('every setting the two old screens had is on a tab', () => {
    // The Graphics modal's Display, Light and Detail rows, and the UI size slider of the main menu's card.
    const labels = Object.values(SETTINGS_ROWS).flat();
    for (const name of [
      'Render scale',
      'Frame limit',
      'Brightness',
      'Auto-adjust',
      'Shadows',
      'Room lamps',
      'Lamp shadows',
      'Ambient occlusion',
      'Bloom',
      'Anti-aliasing',
      'Textures',
      'Filtering',
      'Live chips',
      'Particles',
      'UI size',
      'Mute',
      'Master',
      'Music',
      'Sounds',
      'Ambience',
    ]) {
      expect(labels, name).toContain(name);
    }
  });
});

describe('← → move the tab only while the tab list has the focus', () => {
  it('with the tab list focused, ArrowRight selects the next tab and ArrowLeft the one before', () => {
    expect(railMove(1, 5, 'ArrowRight', true)).toBe(2);
    expect(railMove(2, 5, 'ArrowLeft', true)).toBe(1);
  });

  it('with a row focused, ← → do not move the tab', () => {
    expect(railMove(1, 5, 'ArrowRight', false)).toBe(1);
    expect(railMove(2, 5, 'ArrowLeft', false)).toBe(2);
  });
});

describe('↑ ↓ move the rows inside a tab', () => {
  it('ArrowDown moves to the next row and ArrowUp to the row before', () => {
    expect(rowMove(4, 0, 'ArrowDown')).toBe(1);
    expect(rowMove(4, 2, 'ArrowUp')).toBe(1);
  });

  it('← → change a value, not the row, so the row stays', () => {
    expect(rowMove(4, 2, 'ArrowRight')).toBe(2);
    expect(rowMove(4, 2, 'ArrowLeft')).toBe(2);
  });
});

describe('Peek is held while the pointer, a finger or a key is down', () => {
  it('a mouse press holds it, and the release lets go', () => {
    expect(peekHeld(false, { type: 'pointerdown', pointerType: 'mouse' })).toBe(true);
    expect(peekHeld(true, { type: 'pointerup', pointerType: 'mouse' })).toBe(false);
  });

  it('a mouse press, release and press again holds it, and each release lets go', () => {
    let held = false;
    held = peekHeld(held, { type: 'pointerdown', pointerType: 'mouse' });
    expect(held).toBe(true);
    held = peekHeld(held, { type: 'pointerup', pointerType: 'mouse' });
    expect(held).toBe(false);
    held = peekHeld(held, { type: 'pointerdown', pointerType: 'mouse' });
    expect(held).toBe(true);
    held = peekHeld(held, { type: 'pointercancel', pointerType: 'mouse' });
    expect(held).toBe(false);
  });

  it('a mouse move while the button is held keeps Peek on, and leaving the button or losing focus lets go', () => {
    expect(peekHeld(true, { type: 'pointermove', pointerType: 'mouse' })).toBe(true);
    expect(peekHeld(true, { type: 'pointerleave', pointerType: 'mouse' })).toBe(false);
    expect(peekHeld(true, { type: 'blur' })).toBe(false);
  });

  it('a touch press holds it, and lifting the finger lets go', () => {
    expect(peekHeld(false, { type: 'pointerdown', pointerType: 'touch' })).toBe(true);
    expect(peekHeld(true, { type: 'pointerup', pointerType: 'touch' })).toBe(false);
  });

  it('Space or Enter held on the button holds it, and their release lets go', () => {
    expect(peekHeld(false, { type: 'keydown', key: ' ' })).toBe(true);
    expect(peekHeld(false, { type: 'keydown', key: 'Enter' })).toBe(true);
    expect(peekHeld(true, { type: 'keyup', key: ' ' })).toBe(false);
    expect(peekHeld(true, { type: 'keyup', key: 'Enter' })).toBe(false);
  });
});

describe('Back returns to the screen that opened Settings', () => {
  beforeEach(() => {
    settingsOpener.value = null;
  });

  it('opened from the main menu, Back goes to the main menu', () => {
    openSettings('menu');
    expect(settingsOpener.value).toBe('menu');
    expect(closeSettings()).toBe('menu');
    expect(settingsOpener.value).toBeNull();
  });

  it('opened from Paused in the game, Back goes to Paused', () => {
    openSettings('paused');
    expect(closeSettings()).toBe('paused');
    expect(settingsOpener.value).toBeNull();
  });
});
