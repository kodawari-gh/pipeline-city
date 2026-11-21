import type { RefObject } from 'preact';
import { useMemo } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { type ModeKey, ModeKeys, VIEW_KEYS } from '@/core/ui/kit/ModeKit';
import { goodness, statsOf, type PickerKind } from './picker';
import { kindIcon, kindLabel, pips, priceOf, splitName, type GalleryGroup, type GalleryItem } from './shopdata';

// The Gallery's HUD, the pieces beside the shelf (`PartShelf`): in the words and the shapes of Build my PC's (ui.css: `.bld-read`, `.bld-foot`, the glass panels).
// The summary over the stage says which part this is, the card on the right gives its numbers, the foot says what to do and steps through the category.

const KEYS: readonly ModeKey[] = [...VIEW_KEYS, ['Double-click', 'reset', 'Double-tap'], [['←', '→'], 'part', null], [['↑', '↓'], 'category', null], ['Esc', 'leave', null]];

const money = (n: number): string => (n <= 0 ? 'free' : `$${n.toLocaleString('en-US')}`);
const fmt = (v: number, unit: string): string => `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`;

/** The top: the kind of part, its price, its tier against the kind's best, its place in the category. */
export function GalleryRead({ read, group, item, at }: { read: RefObject<HTMLElement | null>; group: GalleryGroup; item: GalleryItem; at: number }) {
  const price = priceOf(item.id), top = Math.max(...group.items.map((i) => i.tier)), lit = pips(item.tier, top);
  return (
    <section class="bld-read gal-read mode-bar" aria-label="Part summary" ref={read}>
      <span class="gal-kind"><Icon name={kindIcon(group.kind)} size={13} />{kindLabel(group.kind)}</span>
      <i class="mode-sep" aria-hidden="true" />
      <span class="bld-fig"><b>{price === null ? '–' : money(price)}</b><em>Price</em></span>
      <span class="bld-fig" title={`Tier ${item.tier} of ${top}`}>
        <span class="bld-pips" role="img" aria-label={`Tier ${item.tier} of ${top}`}>{Array.from({ length: 5 }, (_, i) => <i key={i} class={i < lit ? 'on' : ''} />)}</span>
        <em>Tier {item.tier}</em>
      </span>
      <span class="bld-fig"><b>{at + 1} / {group.items.length}</b><em>Part</em></span>
    </section>
  );
}

/**
 * The right side: a column as tall as the screen (the stage keeps the part clear of all of it) with the part's card at its top: its name, what the
 * catalogue says of it, and its numbers, each as a bar against the best of its kind.
 */
export function GalleryPart({ side, group, item }: { side: RefObject<HTMLDivElement | null>; group: GalleryGroup; item: GalleryItem }) {
  const stats = useMemo(() => statsOf(item.id), [item.id]);
  const { title, detail } = splitName(item.name);
  // (a case says its form; the other notes only repeat the eyebrow)
  const more = detail || (group.kind === 'case' ? item.note : '');
  return (
    <div class="bld-inst gal-side" ref={side}>
      <section class="gal-part mode-panel" aria-label={item.name}>
        <header class="mode-head">
          <span class="mode-eyebrow">{kindLabel(group.kind)} · tier {item.tier}</span>
          <b>{title}</b>
          {more && <span class="gal-detail">{more}</span>}
        </header>
        {stats.length > 0 ? (
          <ul class="gal-stats" aria-label="Numbers">
            {stats.map((s) => (
              <li key={s.key} class="gal-stat">
                <span><Icon name={s.icon} size={11} />{s.label}</span>
                <b>{fmt(s.value, s.unit)}</b>
                <span class="bld-bar" aria-hidden="true"><i style={{ width: `${Math.round(goodness(group.kind as PickerKind, s.key, s.value, s.higherIsBetter) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="mode-hint">No numbers for this part.</p>
        )}
      </section>
    </div>
  );
}

/** The bottom: what to do now, the stepper through the category, and the keys. */
export function GalleryFoot({ foot, at, n, step }: { foot: RefObject<HTMLDivElement | null>; at: number; n: number; step: (d: number) => void }) {
  return (
    <div class="bld-foot gal-foot" ref={foot}>
      <div class="bld-hint"><i aria-hidden="true" /><span>Pick a part on the shelf. Turn it and zoom in to look it over.</span></div>
      <div class="bld-dock">
        <div class="mode-bar gal-step" role="toolbar" aria-label="Parts of this kind">
          <button class="bld-ico" aria-label="Previous part" title="Previous part (←)" disabled={n < 2} onClick={() => step(-1)}><Icon name="prev" size={14} /></button>
          <span class="gal-pos"><b>{at + 1}</b> of {n}</span>
          <button class="bld-ico" aria-label="Next part" title="Next part (→)" disabled={n < 2} onClick={() => step(1)}><Icon name="next" size={14} /></button>
        </div>
      </div>
      <ModeKeys keys={KEYS} />
    </div>
  );
}
