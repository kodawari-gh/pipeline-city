import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '@/worker/game/game';
import { fmtMoney } from '@/core/ui/logic';
import { Icon } from '@/core/ui/kit/Icons';
import { Rung } from './PickerCard';
import { Showcase } from './Showcase';

export { Gallery } from './Gallery';
export { BuildMode } from '@/features/board/ui/BuildMode';
import { StatCard } from './StatCard';
import { kindOf } from './picker';
import { closeShop, shopFocus, shopOpen } from '@/core/ui/state';
import * as shopData from './shopdata';

/**
 * The shop: every item the game sells. Three zones that never move: the category rail on the left, the items of the chosen category as
 * the same tiles as the upgrade ladder in the middle, and the part you picked on the right, as a 3D model you can turn and zoom with its stat
 * bars under it. The tiles show how the game treats each item: owned, buyable, too expensive, refused by the board, locked by level, or outgrown.
 * Arrow keys move the pick; Esc closes the 3D view first, then the shop.
 */

function useShopFocus(opts: {
  open: boolean;
  focus: string | null;
  s: Snapshot;
  all: ReturnType<typeof shopData.shopFor>;
  setKind: (k: shopData.ShopKind | null) => void;
  setPicked: (id: string | null) => void;
  setView3d: (v: boolean) => void;
}): void {
  const { open, focus, s, all, setKind, setPicked, setView3d } = opts;
  useEffect(() => {
    if (!open || !focus) {
      return;
    }
    const k = kindOf(focus, s);
    setKind(k && all.some((x) => x.kind === k) ? (k as shopData.ShopKind) : null);
    setPicked(focus);
    setView3d(true);
    shopFocus.value = null;
  }, [open, focus]);
}

function useShopKeys(opts: {
  open: boolean;
  view3d: boolean;
  shown: string | null;
  flat: string[];
  setView3d: (v: boolean) => void;
  setPicked: (id: string) => void;
}): void {
  const { open, view3d, shown, flat, setView3d, setPicked } = opts;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view3d) {
          setView3d(false);
        } else {
          closeShop();
        }
        return;
      }
      const step = arrowStep(e.key);
      if (!step || flat.length === 0) {
        return;
      }
      e.preventDefault();
      const i = Math.max(0, flat.indexOf(shown ?? ''));
      setPicked(flat[(i + step + flat.length) % flat.length]!);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [open, view3d, shown, flat.join(',')]);
}

function arrowStep(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1;
  }
  return 0;
}

export function Shop({ s }: { s: Snapshot }) {
  const open = shopOpen.value;
  const [kind, setKind] = useState<shopData.ShopKind | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view3d, setView3d] = useState(true);
  const all = open ? shopData.shopFor(s) : [];
  const focus = shopFocus.value;
  useShopFocus({ open, focus, s, all, setKind, setPicked, setView3d });
  const sections = kind ? all.filter((x) => x.kind === kind) : all;
  const flat = sections.flatMap((x) => x.items.map((i) => i.specId));
  const shown = picked && flat.includes(picked) ? picked : (flat[0] ?? null);
  useShopKeys({ open, view3d, shown, flat, setView3d, setPicked });
  if (!open) {
    return null;
  }
  const pickKind = (k: shopData.ShopKind | null) => {
    setKind(k);
    setPicked(null);
  };
  return (
    <ShopLayout
      s={s}
      kind={kind}
      all={all}
      sections={sections}
      shown={shown}
      view3d={view3d}
      setView3d={setView3d}
      setPicked={setPicked}
      pickKind={pickKind}
    />
  );
}

function ShopLayout({
  s,
  kind,
  all,
  sections,
  shown,
  view3d,
  setView3d,
  setPicked,
  pickKind,
}: {
  s: Snapshot;
  kind: shopData.ShopKind | null;
  all: ReturnType<typeof shopData.shopFor>;
  sections: ReturnType<typeof shopData.shopFor>;
  shown: string | null;
  view3d: boolean;
  setView3d: (v: boolean) => void;
  setPicked: (id: string) => void;
  pickKind: (k: shopData.ShopKind | null) => void;
}) {
  const shownKind = shown ? kindOf(shown, s) : null;
  return (
    <div
      class="modal-back shop-back"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeShop();
        }
      }}
    >
      <div class="card shop" data-cue="ui_panel_open" role="dialog" aria-modal="true" aria-label="Shop">
        <ShopHead sandbox={s.sandbox} money={s.money} />
        <div class="shop-body">
          <ShopRail kind={kind} all={all} pickKind={pickKind} />
          <ShopList sections={sections} shown={shown} setPicked={setPicked} />
          <ShopDetail s={s} shown={shown} shownKind={shownKind} view3d={view3d} setView3d={setView3d} />
        </div>
      </div>
    </div>
  );
}

function ShopHead({ sandbox, money }: { sandbox: boolean; money: number }) {
  return (
    <header class="shop-head">
      <span class="shop-title">
        <Icon name="shop" size={16} /> Shop
      </span>
      <span class="chip" title="Your money">
        <Icon name="dollar" size={12} /> {sandbox ? 'free' : fmtMoney(money)}
      </span>
      <button class="close" data-cue="ui_panel_close" aria-label="Close shop" title="Close (Esc)" onClick={closeShop}>
        <Icon name="close" size={12} />
      </button>
    </header>
  );
}

function ShopRail({
  kind,
  all,
  pickKind,
}: {
  kind: shopData.ShopKind | null;
  all: ReturnType<typeof shopData.shopFor>;
  pickKind: (k: shopData.ShopKind | null) => void;
}) {
  return (
    <nav class="shop-rail" aria-label="Category">
      <button class={!kind ? 'on' : ''} aria-pressed={!kind} onClick={() => pickKind(null)}>
        <Icon name="grid" size={13} /> <span>All</span>
      </button>
      {all.map((x) => (
        <button
          key={x.kind}
          class={kind === x.kind ? 'on' : ''}
          aria-pressed={kind === x.kind}
          onClick={() => pickKind(kind === x.kind ? null : x.kind)}
        >
          <Icon name={x.icon} size={13} /> <span>{x.label}</span> <em>{x.items.length}</em>
        </button>
      ))}
    </nav>
  );
}

function ShopList({
  sections,
  shown,
  setPicked,
}: {
  sections: ReturnType<typeof shopData.shopFor>;
  shown: string | null;
  setPicked: (id: string) => void;
}) {
  return (
    <div class="shop-list">
      {sections.map((sec) => (
        <section key={sec.kind} class="shop-sec" aria-label={sec.label}>
          <h3>
            <Icon name={sec.icon} size={13} /> {sec.label}
          </h3>
          <div class="rungs">
            {sec.items.map((r) => (
              <Rung key={r.specId} step={r} picked={r.specId === shown} onPick={setPicked} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ShopDetail({
  s,
  shown,
  shownKind,
  view3d,
  setView3d,
}: {
  s: Snapshot;
  shown: string | null;
  shownKind: ReturnType<typeof kindOf>;
  view3d: boolean;
  setView3d: (v: boolean) => void;
}) {
  return (
    <aside class="shop-detail">
      {shown && view3d && shopData.hasModel(shownKind) && <Showcase specId={shown} onClose={() => setView3d(false)} />}
      {shown && <StatCard s={s} specId={shown} onPreview={view3d ? undefined : () => setView3d(true)} />}
    </aside>
  );
}
