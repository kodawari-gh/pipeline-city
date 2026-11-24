// Pause and Hold on the in-game menu (ticket #33; rules from #29 and docs/pipeline-city-menu-ui/SPEC.md §9).
// The menu (gameMenuOpen), the level-up popup and the tutorial popup each hold the clock. These tests drive the
// UI state module and the store's speed signal only: speed 0 means the clock is stopped.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

type State = typeof import('@/core/ui/state');
type Store = typeof import('@/app/store');
type Leave = typeof import('@/core/ui/leave');

let st: State;
let store: Store;
let leave: Leave;
let base: Snapshot;

beforeEach(async () => {
  // state.ts touches the DOM and localStorage at import; the tests run in node. Fresh modules per test: no state carries over.
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: () => {},
      style: { setProperty: () => {} },
      classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    },
  });
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
  leave = await import('@/core/ui/leave');
  base = new Game({ seed: 7 }).snapshot();
  // The first snapshot marks the current level as seen, so a later level-up is owed.
  store.snapshot.value = base;
});

const openMenu = () => {
  st.gameMenuOpen.value = true;
};
const closeMenu = () => {
  st.gameMenuOpen.value = false;
};
const speed = () => store.speed.value;
/** A snapshot one level above the seen one: the level-up popup is owed. */
const levelUpSnap = (): Snapshot => ({
  ...base,
  level: { ...base.level, level: base.level.level + 1, leveledUpAt: 1000, recentlyUnlocked: [] },
});

describe('menu hold on the clock', () => {
  it('opening the menu while running holds the clock; closing it restores the earlier speed', () => {
    store.setSpeed(2);
    openMenu();
    expect(speed()).toBe(0);
    closeMenu();
    expect(speed()).toBe(2);
  });

  it('a player pause made before the menu opened is still a pause after the menu closes', () => {
    store.setSpeed(2);
    store.togglePause();
    expect(speed()).toBe(0);
    openMenu();
    closeMenu();
    expect(speed()).toBe(0);
    // It is still the player's pause: Space resumes at the earlier speed.
    store.togglePause();
    expect(speed()).toBe(2);
  });

  it('a level-up popup that opens during the menu keeps the clock stopped after the menu closes', () => {
    store.setSpeed(2);
    openMenu();
    expect(speed()).toBe(0);
    store.snapshot.value = levelUpSnap();
    expect(st.levelUp.value).not.toBeNull();
    closeMenu();
    expect(speed()).toBe(0);
    expect(st.levelUp.value).not.toBeNull();
  });

  it('a tutorial popup that closes under the open menu does not resume the clock', () => {
    store.setSpeed(2);
    openMenu();
    st.pauseForTutorialPopup(true);
    st.pauseForTutorialPopup(false);
    expect(speed()).toBe(0);
    expect(st.gameMenuOpen.value).toBe(true);
    // The menu is now the only holder, so closing it resumes.
    closeMenu();
    expect(speed()).toBe(2);
  });

  it('with two holders, both must close before the clock resumes (tutorial popup opened first)', () => {
    store.setSpeed(2);
    st.pauseForTutorialPopup(true);
    expect(speed()).toBe(0);
    openMenu();
    closeMenu();
    expect(speed()).toBe(0);
    st.pauseForTutorialPopup(false);
    expect(speed()).toBe(2);
  });

  it('with two holders, both must close before the clock resumes (menu first, level-up popup second)', () => {
    store.setSpeed(2);
    openMenu();
    store.snapshot.value = levelUpSnap();
    closeMenu();
    expect(speed()).toBe(0);
    st.dismissLevelUp();
    expect(speed()).toBe(2);
  });

  it('a click on a HUD speed under the menu runs at that speed and closes the menu, with no second toggle', () => {
    store.setSpeed(2);
    openMenu();
    expect(speed()).toBe(0);
    // The HUD speed button calls runAt(x) and then closes its own dropdown.
    st.runAt(8);
    expect(speed()).toBe(8);
    expect(store.lastRunSpeed.value).toBe(8);
    expect(st.gameMenuOpen.value).toBe(false);
    expect(st.holdActive.value).toBe(false);
    // No second toggle: the speed stays at 8 and does not flip to a pause.
    expect(speed()).toBe(8);
  });

  it('leaving the game clears the menu hold without resuming the earlier speed', () => {
    store.setSpeed(2);
    openMenu();
    expect(speed()).toBe(0);
    leave.leaveGame();
    expect(st.gameMenuOpen.value).toBe(false);
    // No game runs after leaving: the clock is neither held at 0 nor resumed at 2.
    expect(speed()).toBe(store.DEFAULT_SPEED);
  });
});

// Controls opened from the menu (ticket #35): the hand-off keeps the menu's hold, and closing Controls shows the menu again.
describe('controls hand-off from the menu', () => {
  it('opening Controls from the menu keeps the clock stopped and takes the menu off the screen', () => {
    store.setSpeed(2);
    st.openControlsFromMenu();
    expect(st.controlsOpen.value).toBe(true);
    expect(st.gameMenuOpen.value).toBe(false);
    expect(speed()).toBe(0);
  });

  it('closing Controls shows the menu again and does not resume the clock', () => {
    store.setSpeed(2);
    st.openControlsFromMenu();
    st.closeControls();
    expect(st.gameMenuOpen.value).toBe(true);
    expect(speed()).toBe(0);
  });

  it('closing the menu after the hand-off resumes the clock at its earlier speed', () => {
    store.setSpeed(2);
    st.openControlsFromMenu();
    st.controlsOpen.value = false;
    closeMenu();
    expect(speed()).toBe(2);
  });

  it('closing Controls opened from the HUD does not open the menu', () => {
    store.setSpeed(2);
    st.controlsOpen.value = true;
    expect(speed()).toBe(2);
    st.controlsOpen.value = false;
    expect(st.gameMenuOpen.value).toBe(false);
    expect(speed()).toBe(2);
  });
});

// Settings opened from the paused menu (ticket #38): Back returns to that menu, and the clock stays held until the menu closes.
describe('Settings Back returns to its opener', () => {
  it('closing Settings opened from the paused menu shows the menu again', () => {
    store.setSpeed(2);
    openMenu();
    // The menu's Settings item closes the menu, then opens Settings from it.
    closeMenu();
    st.openSettings('paused');
    expect(st.settingsOpen.value).toBe(true);
    expect(st.gameMenuOpen.value).toBe(false);
    expect(speed()).toBe(0);
    st.closeSettings();
    expect(st.settingsOpen.value).toBe(false);
    expect(st.gameMenuOpen.value).toBe(true);
    expect(speed()).toBe(0);
    // The menu is the holder again: closing it resumes at the earlier speed.
    closeMenu();
    expect(speed()).toBe(2);
  });

  it('closing Settings opened from the main menu leaves the game menu closed', () => {
    store.setSpeed(2);
    st.openSettings('menu');
    st.closeSettings();
    expect(st.gameMenuOpen.value).toBe(false);
    expect(speed()).toBe(2);
  });
});
