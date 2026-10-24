import type { InventorySnap, Snapshot } from '../sim/game/game';
import { selected } from '../game/hover';
import { dragging, highlight } from '../game/interaction';
import { getSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import { describeId, fitFilterFor, fitsFilter, inventoryGroups, KIND_LABEL, stackItems, type Stack } from './logic';
import { Icon } from './Icons';
import { PartArt } from './PartArt';
import { INVENTORY_ID } from './tutorial';
import { fitTarget, inventoryKind, inventoryOpen, toggleInventory } from './state';
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

/** The bottom bar: the inventory button sits where the shelf opens, so the button and its shelf are never far apart. */
export function InventoryBar({ s }: { s: Snapshot }) {
  return <div class="invbar"><InventoryButton s={s} /></div>;
}

/** Tier of a spec id ("Tier 2"), or null when it has none. */
function tierOf(specId: string): number | null {
  const bm = /^board(\d+)$/.exec(specId);
  if (bm) return Number(bm[1]);
  return getOsSpec(specId)?.tier ?? getSpec(specId)?.tier ?? null;
}

/** One spare part, or a stack of identical ones (count badge): big illustration, short name, tier. Pressing it starts a drag; clicking it selects it for the picker. */
function Tile({ st, pulse, active }: { st: Stack<InventorySnap>; pulse: boolean; active: boolean }) {
  const it = st.rep;
  const n = st.items.length;
  const why = it.installable ? undefined : it.reason ?? 'Nothing to fit it to right now';
  const plain = describeId(it.spec)?.plain ?? '';
  const tier = tierOf(it.spec);
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
      onClick={() => { selected.value = `inv:${it.id}`; }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selected.value = `inv:${it.id}`;
        }
      }}
    >
      <div class="tart"><PartArt id={it.spec} size={96} /></div>
      <span class="tname">{shortName(it.name)}</span>
      <span class="tmeta">{tier !== null && <span class="ttier">Tier {tier}</span>}</span>
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
export function InventoryPanel({ s }: { s: Snapshot }) {
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
  const label = (k: string) => (k === 'os' ? 'Software' : KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k);
  return (
    <section class={`inv ${away ? 'away' : ''}`} aria-label="Inventory">
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
              <button key={k} class={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => { inventoryKind.value = kind === k ? null : k; }}>{label(k)}</button>
            ))}
          </span>
        )}
        <button class="close" aria-label="Close inventory" title="Close" onClick={toggleInventory}><Icon name="close" size={12} /></button>
      </header>
      {n === 0 ? (
        <div class="inv-empty mute">No spare parts. Click a part on the board to buy an upgrade.</div>
      ) : (
        <div class="inv-groups">
          {groups.map((g) => (
            <div class="inv-group" key={g.k}>
              <div class="inv-gname">{label(g.k)}</div>
              <div class="inv-tiles">
                {stackItems(g.items).map((st) => (
                  <Tile key={st.spec} st={st} pulse={st.items.some((x) => hl.has(`inv:${x.id}`) || x.id === s.pendingSwap?.invId)} active={st.items.some((x) => sel === `inv:${x.id}`)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
