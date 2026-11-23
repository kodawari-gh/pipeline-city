// Game toasts are held while the menu family is open and show after it closes (ticket #47; SPEC §4.10 and §9 step 9).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';

type State = typeof import('@/core/ui/state');
type Store = typeof import('@/app/store');

let st: State;
let store: Store;
let base: Snapshot;
let nav: typeof import('@/core/ui/panels/settingsnav');

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', { documentElement: { setAttribute: () => {}, style: { setProperty: () => {} }, classList: { toggle: () => {}, add: () => {}, remove: () => {} } } });
  st = await import('@/core/ui/state');
  store = await import('@/app/store');
  nav = await import('@/core/ui/panels/settingsnav');
  base = new Game({ seed: 7 }).snapshot();
  store.snapshot.value = base;
  st.resetTutorial(false); // no tutorial card: it would hold hints on its own
});

/** A snapshot that raises the "queue" hint. */
const hintSnap = (): Snapshot => ({ ...base, queueLength: 5 });

/** The ids the Toasts panel would show now (it renders nothing while a menu screen holds the toasts). */
const shown = async (): Promise<string[]> => {
  const { Toasts } = await import('@/core/ui/panels/Toasts');
  const v = Toasts() as { props?: { children?: { key?: string }[] } } | null;
  return v?.props?.children?.map((c) => String(c.key)) ?? [];
};

describe('game toasts and the menu family', () => {
  it('shows a hint at once when no menu is open (control case)', async () => {
    store.snapshot.value = hintSnap();
    expect(await shown()).toEqual(['queue']);
  });

  it('holds a hint while Paused is open', async () => {
    st.gameMenuOpen.value = true;
    store.snapshot.value = hintSnap();
    expect(await shown()).toEqual([]);
  });

  it('shows the held hint after Paused closes', async () => {
    st.gameMenuOpen.value = true;
    store.snapshot.value = hintSnap();
    st.gameMenuOpen.value = false;
    expect(await shown()).toEqual(['queue']);
  });

  it('holds a hint while Settings opened from Paused is open, and while Controls is', async () => {
    st.gameMenuOpen.value = true;
    nav.settingsOpener.value = 'paused';
    store.snapshot.value = hintSnap();
    expect(await shown()).toEqual([]);
    nav.settingsOpener.value = null;
    st.controlsFromMenu.value = true;
    st.controlsOpen.value = true;
    expect(await shown()).toEqual([]);
  });
});
