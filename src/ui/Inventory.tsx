import { useEffect, useRef, useState } from 'preact/hooks';
import type { InventorySnap, Snapshot } from '../sim/game/game';
import { powerLens, selected } from '../game/hover';
import { dragging, highlight } from '../game/interaction';
import { sell } from '../game/store';
import { SELL_RATE } from '../sim/game/economy';
import { describeId, fitFilterFor, fitsFilter, inventoryGroups, stackItems, type Stack } from './logic';
import { Icon } from './Icons';
import { PartArt } from './PartArt';
import { INVENTORY_ID } from './tutorial';
import { StatCard } from './StatCard';
import { kindIcon, kindLabel, tierOfSpec } from './shopdata';
import { almanacOpen, toggleAlmanac } from './AlmanacPanel';
import { fitTarget, inventoryKind, inventoryOpen, shopOpen, toggleInventory, toggleShop } from './state';
import { beginPartDrag } from './worldDrag';

const shortName = (name: string) => name.split(' (')[0]!;

/** Button with the count badge, in the bottom bar next to the shelf it opens. Pulses while a tutorial step asks for the inventory or one of its parts. */
function InventoryButton({ s }: { s: Snapshot }) {
  const open = inventoryOpen.value;
  const pulse = highlight.value.some((t) => t === INVENTORY_ID || t.startsWith('inv:'));
  const n = s.inventory.length;
  return (
    <button
      class={`invbtn ${open ? 'on' : ''} ${pulse ? 'pulse' : ''}`}
      aria-pressed={open}
      aria-label={`Inventory, ${n} ${n === 1 ? 'part' : 'parts'}`}
      title="Inventory: spare parts you own. Drag them onto the board."
      onClick={toggleInventory}
    >
      <Icon name="box" size={14} />
      <span class="hide-narrow">Inventory</span>
      <b class="count">{n}</b>
    </button>
  );
}

/** The shop button: every item in the game, with prices. */
function ShopButton() {
  const open = shopOpen.value;
  return (
    <button class={`invbtn ${open ? 'on' : ''} ${!open && highlight.value.includes('hud:shop') ? 'pulse' : ''}`} data-hud="shop" aria-pressed={open} aria-label="Shop" title="Shop: everything you can buy" onClick={toggleShop}>
      <Icon name="shop" size={14} />
      <span class="hide-narrow">Shop</span>
    </button>
  );
}

/** The power lens switch: dims the room and lights where power must be linked and where it flows (the P key does the same). */
function LensButton() {
  const on = powerLens.value;
  return (
    <button class={`invbtn ${on ? 'on' : ''} ${!on && highlight.value.includes('hud:lens') ? 'pulse' : ''}`} data-hud="lens" aria-pressed={on} aria-label="Power lens" title="Power lens (P): see where power must be plugged in and where it flows" onClick={() => { powerLens.value = !powerLens.value; }}>
      <Icon name="bolt" size={14} />
      <span class="hide-narrow">Power</span>
    </button>
  );
}

/** The almanac button: every kind of job, what it needs, its code and how to do it better. */
function AlmanacButton() {
  const open = almanacOpen.value;
  return (
    <button class={`invbtn ${open ? 'on' : ''}`} data-hud="almanac" aria-pressed={open} aria-label="Almanac" title="Almanac: every kind of job, its code and how to do it better" onClick={toggleAlmanac}>
      <Icon name="layers" size={14} />
      <span class="hide-narrow">Almanac</span>
    </button>
  );
}

/** The bottom bar: the inventory button sits where the shelf opens, so the button and its shelf are never far apart. */
export function InventoryBar({ s }: { s: Snapshot }) {
  return <div class="invbar"><InventoryButton s={s} /><ShopButton /><LensButton /><AlmanacButton /></div>;
}

/** One spare part, or a stack of identical ones (count badge): big illustration, short name, tier. Pressing it starts a drag; clicking it selects it for the picker. */
function Tile({ st, pulse, active, onHover }: { st: Stack<InventorySnap>; pulse: boolean; active: boolean; onHover: (id: string | null) => void }) {
  const it = st.rep;
  const n = st.items.length;
  const why = it.installable ? undefined : it.reason ?? 'Nothing to fit it to right now';
  const plain = describeId(it.spec)?.plain ?? '';
  const tier = tierOfSpec(it.spec);
  return (
    <div
      role="button"
      tabIndex={0}
      data-inv={st.items.map((x) => x.id).join(' ')}
      class={`tile ${pulse ? 'pulse' : ''} ${active ? 'sel' : ''} ${why ? 'dim' : ''}`}
      title={`${it.name}${n > 1 ? ` x${n}` : ''}. ${plain}${why ? ` ${why}.` : ' Drag it onto a socket.'}`}
      onPointerDown={(e) => {
        if (e.button === 0) beginPartDrag(it.id, e);
      }}
      onPointerEnter={() => onHover(it.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(it.id)}
      onBlur={() => onHover(null)}
      onClick={() => { selected.value = selected.value === `inv:${it.id}` ? null : `inv:${it.id}`; }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selected.value = selected.value === `inv:${it.id}` ? null : `inv:${it.id}`;
        }
      }}
    >
      <div class="tart"><PartArt id={it.spec} size={112} /></div>
      <span class="tname">{shortName(it.name)}</span>
      <span class="tmeta">{tier !== null && <span class="ttier">Tier {tier}</span>}</span>
      {active && !!it.sellPrice && (
        <button class="tsell" aria-label={`Sell ${shortName(it.name)} for $${it.sellPrice}`}
          title={`Sell one back for $${it.sellPrice}: you lose ${Math.round((1 - SELL_RATE) * 100)}% of its price.`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); selected.value = null; sell(it.id); }}>Sell ${it.sellPrice}</button>
      )}
      {n > 1 && <b class="tcount" aria-label={`${n} of them`}>x{n}</b>}
      {why ? <span class="tlock" aria-label={why}><Icon name="lock" size={12} /></span> : <span class="tgrab" aria-hidden="true">drag</span>}
    </div>
  );
}

/**
 * The inventory shelf: a large glass panel docked at the bottom (or at the right on tall screens, see ui.css), parts
 * grouped by kind. It collapses while a part is being dragged (`dragging` is written by the renderer), so the board is
 * visible for the drop; it keeps its layout space so nothing re-flows under the pointer.
 */
/** How long the pointer rests on a tile before its stats open (a tiny delay: passing over tiles does not flash cards). */
const HOVER_MS = 380;

export function InventoryPanel({ s }: { s: Snapshot }) {
  // The part whose stats show in the side card: the one the pointer rested on, else the selected one.
  const [hover, setHover] = useState<string | null>(null);
  const timer = useRef(0);
  const onHover = (id: string | null) => {
    window.clearTimeout(timer.current);
    if (id === null) setHover(null);
    else timer.current = window.setTimeout(() => setHover(id), HOVER_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!inventoryOpen.value) return null;
  const away = dragging.value?.kind === 'part';
  const hl = new Set(highlight.value);
  const sel = selected.value;
  const n = s.inventory.length;
  // Selecting something on the PC narrows the shelf to what fits there; a kind chip narrows it by hand.
  const fit = fitTarget.value ? fitFilterFor(fitTarget.value, s) : null;
  const fitting = fit ? s.inventory.filter((it) => fitsFilter(fit, it)) : [];
  const kind = inventoryKind.value;
  const shown = fit && fitting.length ? fitting : kind ? s.inventory.filter((it) => it.kind === kind) : s.inventory;
  const kinds = inventoryGroups(s.inventory).map((g) => g.k);
  const groups = inventoryGroups(shown);
  const infoId = hover ?? (sel?.startsWith('inv:') ? sel.slice(4) : null);
  const info = infoId ? s.inventory.find((x) => x.id === infoId) : undefined;
  return (
    <section class={`inv ${away ? 'away' : ''}`} aria-label="Inventory">
      {info && !away && (
        <aside class="card inv-info" aria-label={`${info.name} stats`}>
          <StatCard s={s} specId={info.spec} fit={{ ok: info.installable, text: info.installable ? 'Fits: drag it onto a socket' : info.reason ?? 'Nothing to fit it to right now' }} />
        </aside>
      )}
      <header class="inv-head">
        <span class="inv-title"><Icon name="box" size={15} /> Inventory <b>{n}</b></span>
        {fit && fitting.length > 0 ? (
          <span class="inv-fit">
            <span class="chip ok" title={`Only the parts that fit ${fit.label}`}><Icon name="check" size={11} /> Fits {fit.label}</span>
            <button class="link" onClick={() => { fitTarget.value = null; }}>Show all</button>
          </span>
        ) : kinds.length > 1 && (
          <span class="inv-chips" role="group" aria-label="Filter by kind">
            <button class={!kind ? 'on' : ''} aria-pressed={!kind} onClick={() => { inventoryKind.value = null; }}>All</button>
            {kinds.map((k) => (
              <button key={k} class={`ic ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} aria-label={kindLabel(k)} title={kindLabel(k)}
                onClick={() => { inventoryKind.value = kind === k ? null : k; }}>
                <Icon name={kindIcon(k)} size={14} />
              </button>
            ))}
          </span>
        )}
        <button class="close" aria-label="Close inventory" title="Close" onClick={toggleInventory}><Icon name="close" size={12} /></button>
      </header>
      {n === 0 ? (
        <div class="inv-empty mute">
          <div class="inv-group ghost" aria-hidden="true">
            <div class="inv-gname">&nbsp;</div>
            <div class="tile"><div class="tart" /><span class="tname">&nbsp;</span><span class="tmeta" /></div>
          </div>
          <span class="inv-msg">No spare parts. Click a part on the board to buy an upgrade.</span>
        </div>
      ) : (
        <div class="inv-groups">
          {groups.map((g) => (
            <div class="inv-group" key={g.k}>
              <div class="inv-gname" title={kindLabel(g.k)}><Icon name={kindIcon(g.k)} size={12} /> {kindLabel(g.k)}</div>
              <div class="inv-tiles">
                {stackItems(g.items).map((st) => (
                  <Tile key={st.spec} st={st} pulse={st.items.some((x) => hl.has(`inv:${x.id}`) || x.id === s.pendingSwap?.invId)} active={st.items.some((x) => sel === `inv:${x.id}`)} onHover={onHover} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
