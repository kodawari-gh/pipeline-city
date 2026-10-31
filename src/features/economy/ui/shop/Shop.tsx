import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '@/worker/game/game';
import { fmtMoney } from '@/core/ui/logic';
import { Icon } from '@/core/ui/kit/Icons';
import { Rung } from './PickerCard';
import { StatCard } from './StatCard';
import { closeShop, shopOpen } from '@/core/ui/state';
import { shopFor, type ShopKind } from './shopdata';

/**
 * The shop: every item the game sells, by category (the icon row filters), each as the same tile as the upgrade ladder,
 * with a stat card for the one you pressed. Doubles as the place to see how the game treats each item: owned, buyable,
 * too expensive, refused by the board, locked by level, or outgrown.
 */
export function Shop({ s }: { s: Snapshot }) {
  const open = shopOpen.value;
  const [kind, setKind] = useState<ShopKind | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeShop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const all = shopFor(s);
  const sections = kind ? all.filter((x) => x.kind === kind) : all;
  const shown = picked ?? sections[0]?.items[0]?.specId ?? null;
  return (
    <div class="modal-back shop-back" onClick={(e) => { if (e.target === e.currentTarget) closeShop(); }}>
      <div class="card shop" role="dialog" aria-modal="true" aria-label="Shop">
        <header class="shop-head">
          <span class="shop-title"><Icon name="shop" size={16} /> Shop</span>
          <span class="chip" title="Your money"><Icon name="dollar" size={12} /> {s.sandbox ? 'free' : fmtMoney(s.money)}</span>
          <span class="inv-chips" role="group" aria-label="Category">
            <button class={!kind ? 'on' : ''} aria-pressed={!kind} title="Everything" onClick={() => { setKind(null); setPicked(null); }}>All</button>
            {all.map((x) => (
              <button key={x.kind} class={`ic ${kind === x.kind ? 'on' : ''}`} aria-pressed={kind === x.kind} aria-label={x.label} title={x.label}
                onClick={() => { setKind(kind === x.kind ? null : x.kind); setPicked(null); }}>
                <Icon name={x.icon} size={14} />
              </button>
            ))}
          </span>
          <button class="close" aria-label="Close shop" title="Close (Esc)" onClick={closeShop}><Icon name="close" size={12} /></button>
        </header>
        <div class="shop-body">
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
          <aside class="shop-detail">{shown && <StatCard s={s} specId={shown} />}</aside>
        </div>
      </div>
    </div>
  );
}
