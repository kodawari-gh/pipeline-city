import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '@/worker/game/game';
import { fmtMoney } from '@/core/ui/logic';
import { Icon } from '@/core/ui/kit/Icons';
import { Rung } from './PickerCard';
import { Showcase } from './Showcase';
import { StatCard } from './StatCard';
import { kindOf } from './picker';
import { closeShop, shopOpen } from '@/core/ui/state';
import { hasModel, shopFor, type ShopKind } from './shopdata';

/**
 * The shop: every item the game sells. Three zones that never move: the category rail on the left, the items of the chosen category as
 * the same tiles as the upgrade ladder in the middle, and the part you picked on the right, as a 3D model you can turn and zoom with its stat
 * bars under it. The tiles show how the game treats each item: owned, buyable, too expensive, refused by the board, locked by level, or outgrown.
 * Arrow keys move the pick; Esc closes the 3D view first, then the shop.
 */
export function Shop({ s }: { s: Snapshot }) {
  const open = shopOpen.value;
  const [kind, setKind] = useState<ShopKind | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view3d, setView3d] = useState(true);
  const all = open ? shopFor(s) : [];
  const sections = kind ? all.filter((x) => x.kind === kind) : all;
  const flat = sections.flatMap((x) => x.items.map((i) => i.specId));
  const shown = picked && flat.includes(picked) ? picked : flat[0] ?? null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (view3d) setView3d(false); else closeShop(); return; }
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step || !flat.length) return;
      e.preventDefault();
      const i = Math.max(0, flat.indexOf(shown ?? ''));
      setPicked(flat[(i + step + flat.length) % flat.length]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view3d, shown, flat.join()]);
  if (!open) return null;
  const pickKind = (k: ShopKind | null) => { setKind(k); setPicked(null); };
  const shownKind = shown ? kindOf(shown, s) : null;
  return (
    <div class="modal-back shop-back" onClick={(e) => { if (e.target === e.currentTarget) closeShop(); }}>
      <div class="card shop" role="dialog" aria-modal="true" aria-label="Shop">
        <header class="shop-head">
          <span class="shop-title"><Icon name="shop" size={16} /> Shop</span>
          <span class="chip" title="Your money"><Icon name="dollar" size={12} /> {s.sandbox ? 'free' : fmtMoney(s.money)}</span>
          <button class="close" aria-label="Close shop" title="Close (Esc)" onClick={closeShop}><Icon name="close" size={12} /></button>
        </header>
        <div class="shop-body">
          <nav class="shop-rail" aria-label="Category">
            <button class={!kind ? 'on' : ''} aria-pressed={!kind} onClick={() => pickKind(null)}>
              <Icon name="grid" size={13} /> <span>All</span>
            </button>
            {all.map((x) => (
              <button key={x.kind} class={kind === x.kind ? 'on' : ''} aria-pressed={kind === x.kind} onClick={() => pickKind(kind === x.kind ? null : x.kind)}>
                <Icon name={x.icon} size={13} /> <span>{x.label}</span> <em>{x.items.length}</em>
              </button>
            ))}
          </nav>
          <div class="shop-list">
            {sections.map((sec) => (
              <section key={sec.kind} class="shop-sec" aria-label={sec.label}>
                <h3><Icon name={sec.icon} size={13} /> {sec.label}</h3>
                <div class="rungs">
                  {sec.items.map((r) => <Rung key={r.specId} step={r} picked={r.specId === shown} onPick={setPicked} />)}
                </div>
              </section>
            ))}
          </div>
          <aside class="shop-detail">
            {shown && view3d && hasModel(shownKind) && <Showcase specId={shown} onClose={() => setView3d(false)} />}
            {shown && <StatCard s={s} specId={shown} onPreview={view3d ? undefined : () => setView3d(true)} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
