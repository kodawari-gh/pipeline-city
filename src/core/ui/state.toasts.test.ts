// Game toasts are held while the menu family is open and show after it closes (ticket #47; SPEC §4.10 and §9 step 9).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import type * as stateApi from '@/core/ui/state';
import type * as storeApi from '@/app/store';
import type * as settingsnavApi from '@/core/ui/panels/settingsnav';

type State = typeof stateApi;
type Store = typeof storeApi;

let st: State;
let store: Store;
let base: Snapshot;
let nav: typeof settingsnavApi;

beforeEach(async () => {
  vi.resetModules();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: () => {
        /* no-op */
      },
      style: {
        setProperty: () => {
          /* no-op */
        },
      },
      classList: {
        toggle: () => {
          /* no-op */
        },
        add: () => {
          /* empty */
        },
        remove: () => {
          /* empty */
        },
      },
    },
  });
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
    expect(await shown()).toStrictEqual(['queue']);
  });

  it('holds a hint while Paused is open', async () => {
    st.gameMenuOpen.value = true;
    store.snapshot.value = hintSnap();
    expect(await shown()).toStrictEqual([]);
  });

  it('shows the held hint after Paused closes', async () => {
    st.gameMenuOpen.value = true;
    store.snapshot.value = hintSnap();
    st.gameMenuOpen.value = false;
    expect(await shown()).toStrictEqual(['queue']);
  });

  it('holds a hint while Settings opened from Paused is open, and while Controls is', async () => {
    st.gameMenuOpen.value = true;
    nav.settingsOpener.value = 'paused';
    store.snapshot.value = hintSnap();
    expect(await shown()).toStrictEqual([]);
    nav.settingsOpener.value = null;
    st.controlsFromMenu.value = true;
    st.controlsOpen.value = true;
    expect(await shown()).toStrictEqual([]);
  });
});
