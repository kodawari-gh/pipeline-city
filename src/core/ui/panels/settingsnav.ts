// The Settings screen's tabs, keys, Peek and Back (ticket #38; SPEC §5.6 and §5.6a). Pure TS apart from the opener signal: no DOM, no Preact.
// The screen is `Settings.tsx`. `state.ts` wraps the opener for the menu and the game.
import { signal } from '@preact/signals';
import { moveFocus } from '../menuNav';

/** The screen that opened Settings. `paused`: the in-game menu, which Back shows again (SPEC §9). */
export type SettingsFrom = 'menu' | 'paused' | 'studio';

/** The five tabs on the rail, in order. `tag` is the small code shown on each tab. */
export const SETTINGS_TABS = [
  { id: 'quality', name: 'Quality', tag: 'IF' },
  { id: 'display', name: 'Display', tag: 'ID' },
  { id: 'light', name: 'Light', tag: 'EX' },
  { id: 'detail', name: 'Detail', tag: 'MEM' },
  { id: 'interface', name: 'Interface', tag: 'WB' },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/** The row names of each tab, as the screen shows them. */
export const SETTINGS_ROWS: Record<SettingsTabId, readonly string[]> = {
  quality: ['Preset', 'Device'],
  display: ['Render scale', 'Frame limit', 'Brightness', 'Auto-adjust'],
  light: ['Shadows', 'Room lamps', 'Lamp shadows', 'Ambient occlusion', 'Bloom'],
  detail: ['Anti-aliasing', 'Textures', 'Filtering', 'Live chips', 'Particles'],
  interface: ['UI size', 'Mute', 'Master', 'Music', 'Sounds', 'Ambience'],
};

/**
 * The tab selected for a key. ← → step through the tabs and wrap; Home and End jump to the ends. Only the tab list takes them:
 * with a row focused, the tab stays. ↑ ↓ never move the tab.
 */
export function railMove(at: number, count: number, key: string, railFocused: boolean): number {
  if (!railFocused || count < 1) {
    return at;
  }
  switch (key) {
    case 'ArrowRight': {
      return (at + 1) % count;
    }
    case 'ArrowLeft': {
      return (at - 1 + count) % count;
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return count - 1;
    }
    default: {
      return at;
    }
  }
}

/**
 * The row focused for a key inside a tab. ↑ ↓ step through the rows and wrap; Home and End jump. ← → change the row's value, so the row stays.
 */
export const rowMove = (count: number, at: number, key: string): number => moveFocus(count, at, key);

/** An event that can change Peek: a pointer, a key, or the window losing focus. */
export interface PeekEvent {
  type: string;
  pointerType?: string;
  key?: string;
}

const isPeekKey = (key?: string) => key === ' ' || key === 'Enter';

/**
 * Peek after an event. A pointer press (mouse or touch) holds it. The release, a cancel, a pointer that leaves and a lost focus let go.
 * Space or Enter holds it and its release lets go. Other keys keep the state.
 */
export function peekHeld(held: boolean, ev: PeekEvent): boolean {
  switch (ev.type) {
    case 'pointerdown': {
      return true;
    }
    case 'pointerup':
    case 'pointercancel':
    case 'pointerleave':
    case 'blur': {
      return false;
    }
    case 'keydown': {
      return isPeekKey(ev.key) ? true : held;
    }
    case 'keyup': {
      return isPeekKey(ev.key) ? false : held;
    }
    default: {
      return held;
    }
  }
}

/** The screen that opened Settings; null while Settings is closed. */
export const settingsOpener = signal<SettingsFrom | null>(null);

/** Opens Settings from `from`. */
export function openSettings(from: SettingsFrom = 'menu'): void {
  settingsOpener.value = from;
}

/** Closes Settings. Returns its opener (the screen to show again), or null when Settings was not open. */
export function closeSettings(): SettingsFrom | null {
  const from = settingsOpener.value;
  settingsOpener.value = null;
  return from;
}
