import type { RefObject } from 'preact';
import { useMemo } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, kindLabel } from '@/features/economy/ui/shop/shopdata';
import { pips, priceOf } from './buildhud';

type Part = import('../render/three/buildmode3d').BinPart;

/** What a press on a tile starts: a part off the shelf (the stage's shelf is unlimited). */
export interface Pressed { item: string; spec: string; name: string }

const money = (n: number): string => (n <= 0 ? 'free' : `$${n.toLocaleString('en-US')}`);

/**
 * The left panel: the catalogue. A rail of category icons (as the Gallery's, with the name and count under the pointer), then the tiles of the
 * chosen category (or of all, under their headings). Drag a tile onto the PC; a click fits it in the first free socket. While a machine part is
 * dragged the panel is the bin: it says so and takes the drop.
 */
export function BuildShelf({ shelf, kinds, parts, kind, setKind, busy, press, fit, taking, over }: {
  shelf: RefObject<HTMLElement | null>;
  kinds: readonly string[];
  parts: readonly Part[];
  kind: string;
  setKind: (k: string) => void;
  busy: boolean;
  press: (t: Pressed, e: PointerEvent) => void;
  /** Fit a part in the first free socket (the key on a focused tile; a click is `press` without a move). */
  fit: (item: string) => void;
  /** A machine part is being dragged out: the shelf shows its drop zone. */
  taking: boolean;
  /** ...and the pointer is over the shelf. */
  over: boolean;
}) {
  const count = (k: string): number => parts.filter((p) => p.kind === k).length;
  // (the top tier of each kind: a tile's pips are its tier against it)
  const top = useMemo(() => { const m = new Map<string, number>(); for (const p of parts) m.set(p.kind, Math.max(m.get(p.kind) ?? 0, p.tier)); return m; }, [parts]);
  const shown = kind === 'all' ? kinds : [kind];

  const tile = (p: Part) => {
    const price = priceOf(p.id), lit = pips(p.tier, top.get(p.kind) ?? 0);
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        data-item={p.id}
        class={`bld-tile ${busy ? 'dim' : ''}`}
        aria-disabled={busy}
        title={`${p.name}. Drag it onto the PC to fit it, or click to fit it in the first free socket.`}
        onPointerDown={(e) => { if (e.button === 0 && !busy) press({ item: p.id, spec: p.id, name: p.name }, e); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fit(p.id); } }}
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
    <aside class={`bld-bin mode-panel ${taking ? 'taking' : ''} ${taking && over ? 'drop' : ''}`} ref={shelf}>
      <header class="mode-head"><span class="mode-eyebrow">Workshop</span><b>Build my PC</b></header>
      <div class="bld-shelf">
        <div class="bld-rail" role="tablist" aria-label="Part kinds">
          <button role="tab" aria-selected={kind === 'all'} class={kind === 'all' ? 'on' : ''} title={`All parts (${parts.length})`} aria-label="All parts" onClick={() => setKind('all')}>
            <Icon name="grid" size={14} />
          </button>
          {kinds.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} class={k === kind ? 'on' : ''} title={`${kindLabel(k)} (${count(k)})`} aria-label={kindLabel(k)} onClick={() => setKind(k)}>
              <Icon name={kindIcon(k)} size={14} />
            </button>
          ))}
        </div>
        <div class="bld-parts" aria-label="Parts">
          {shown.map((k) => (
            <section key={k}>
              <div class="bld-sub">{kindLabel(k)} <span class="mute">{count(k)}</span></div>
              <div class="bld-tiles">{parts.filter((p) => p.kind === k).map(tile)}</div>
            </section>
          ))}
        </div>
      </div>
      <div class="bld-bin-note" aria-hidden={!taking}>
        <Icon name="eject" size={22} />
        <b>Drop it here to take it out</b>
        <span>Everything in its way comes out first.</span>
      </div>
    </aside>
  );
}
