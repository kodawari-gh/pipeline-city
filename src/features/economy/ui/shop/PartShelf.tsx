import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from './PartArt';
import { kindIcon, kindLabel, pips, priceOf, railLabel } from './shopdata';

/** A part the shelf lists: its catalogue id, name, kind (the rail's category) and tier. */
export interface ShelfPart { id: string; name: string; kind: string; tier: number }

const money = (n: number): string => (n <= 0 ? 'free' : `$${n.toLocaleString('en-US')}`);

/**
 * The studio's shelf, the left panel of both studio screens (the Gallery and Build my PC): a rail of categories (an icon and a short name each; the full
 * name and the count in its tooltip), then the tiles of the chosen category (or of all, under their headings): the part's picture, its name, its tier as pips and its price. What a tile does
 * is the screen's: the Gallery's click shows the part (`current` is the one shown), Build my PC's press starts a drag (`onPress`) and Enter fits it
 * (`onActivate`). Styles: ui.css (the shelf, `.bld-*`).
 */
export function PartShelf({ shelf, class: cls = '', eyebrow, title, kinds, parts, kind, setKind, all = false, current, dim = false, tip, onPress, onActivate, children }: {
  shelf?: RefObject<HTMLElement | null>;
  /** More classes for the panel (Build my PC's drop zone marks). */
  class?: string;
  eyebrow: string;
  title: string;
  kinds: readonly string[];
  parts: readonly ShelfPart[];
  /** The chosen category, or `all` when the rail offers that. */
  kind: string;
  setKind: (k: string) => void;
  /** The rail starts with an "all parts" button. */
  all?: boolean;
  /** The part the screen shows now (its tile is lit, and kept in view). */
  current?: string;
  /** The tiles are out of reach for the moment (a step of the machine plays). */
  dim?: boolean;
  /** A tile's tooltip. */
  tip: (p: ShelfPart) => string;
  /** The pointer goes down on a tile (button 0): the screen starts what a press does. */
  onPress?: (p: ShelfPart, e: PointerEvent) => void;
  /** Enter or Space on a focused tile, and a click when `onPress` is not given. */
  onActivate: (p: ShelfPart) => void;
  /** Over the panel (Build my PC's drop note). */
  children?: ComponentChildren;
}) {
  const list = useRef<HTMLDivElement>(null);
  const count = (k: string): number => parts.filter((p) => p.kind === k).length;
  // (the top tier of each kind: a tile's pips are its tier against it)
  const top = useMemo(() => { const m = new Map<string, number>(); for (const p of parts) m.set(p.kind, Math.max(m.get(p.kind) ?? 0, p.tier)); return m; }, [parts]);
  const shown = kind === 'all' ? kinds : [kind];
  // a part chosen by a key (the Gallery's arrows) brings its tile into view: the list scrolls to it, the page does not (a stacked screen keeps its stage on top)
  useEffect(() => {
    const box = list.current, tile = box?.querySelector<HTMLElement>('.bld-tile.on');
    if (!box || !tile) return;
    const b = box.getBoundingClientRect(), t = tile.getBoundingClientRect();
    if (t.top < b.top) box.scrollTop -= b.top - t.top;
    else if (t.bottom > b.bottom) box.scrollTop += t.bottom - b.bottom;
  }, [current, kind]);

  const tile = (p: ShelfPart) => {
    const price = priceOf(p.id), lit = pips(p.tier, top.get(p.kind) ?? 0), on = current === p.id;
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        data-item={p.id}
        class={`bld-tile ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
        aria-disabled={dim}
        aria-pressed={current === undefined ? undefined : on}
        title={tip(p)}
        onPointerDown={onPress ? (e) => { if (e.button === 0 && !dim) onPress(p, e); } : undefined}
        onClick={onPress ? undefined : () => { if (!dim) onActivate(p); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !dim) { e.preventDefault(); onActivate(p); } }}
      >
        <span class="bld-art"><PartArt id={p.id} fill label={p.name} /></span>
        <span class="bld-tname">{p.name}</span>
        <span class="bld-tmeta">
          <span class="bld-pips" role="img" aria-label={`Tier ${p.tier}`}>{Array.from({ length: 5 }, (_, i) => <i key={i} class={i < lit ? 'on' : ''} />)}</span>
          {price !== null && <span class="bld-price">{money(price)}</span>}
        </span>
      </div>
    );
  };

  return (
    <aside class={`bld-bin mode-panel ${cls}`} ref={shelf}>
      <header class="mode-head"><span class="mode-eyebrow">{eyebrow}</span><b>{title}</b></header>
      <div class="bld-shelf">
        <div class="bld-rail" role="tablist" aria-label="Part kinds">
          {all && (
            <button role="tab" aria-selected={kind === 'all'} class={kind === 'all' ? 'on' : ''} title={`All parts (${parts.length})`} aria-label="All parts" onClick={() => setKind('all')}>
              <Icon name="grid" size={14} /><span class="bld-rl" aria-hidden="true">All</span>
            </button>
          )}
          {kinds.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} class={k === kind ? 'on' : ''} title={`${kindLabel(k)} (${count(k)})`} aria-label={kindLabel(k)} onClick={() => setKind(k)}>
              <Icon name={kindIcon(k)} size={14} /><span class="bld-rl" aria-hidden="true">{railLabel(k)}</span>
            </button>
          ))}
        </div>
        <div class="bld-parts" aria-label="Parts" ref={list}>
          {shown.map((k) => (
            <section key={k}>
              <div class="bld-sub">{kindLabel(k)} <span class="mute">{count(k)}</span></div>
              <div class="bld-tiles">{parts.filter((p) => p.kind === k).map(tile)}</div>
            </section>
          ))}
        </div>
      </div>
      {children}
    </aside>
  );
}
