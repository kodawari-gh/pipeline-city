import type { InventorySnap, Snapshot } from '../sim/game/game';
import { selected } from '../game/hover';
import { dragging, highlight } from '../game/interaction';
import { getSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import { describeId, KIND_LABEL } from './logic';
import { Icon } from './Icons';
import { PartArt } from './PartArt';
import { INVENTORY_ID } from './tutorial';
import { inventoryOpen, toggleInventory } from './state';
import { beginPartDrag } from './worldDrag';

const shortName = (name: string) => name.split(' (')[0]!;

/** HUD button with the count badge. Pulses while a tutorial step asks for the inventory or one of its parts. */
export function InventoryButton({ s }: { s: Snapshot }) {
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

const GROUP_ORDER = ['cpu', 'cooler', 'ram', 'psu', 'display', 'board', 'storage', 'vrm-sink', 'os'];

/** Tier of a spec id ("Tier 2"), or null when it has none. */
function tierOf(specId: string): number | null {
  const bm = /^board(\d+)$/.exec(specId);
  if (bm) return Number(bm[1]);
  return getOsSpec(specId)?.tier ?? getSpec(specId)?.tier ?? null;
}

/** One spare part: big illustration, short name, tier. Pressing it starts a drag; clicking it selects it for the picker. */
function Tile({ it, pulse, active }: { it: InventorySnap; pulse: boolean; active: boolean }) {
  const why = it.installable ? undefined : it.reason ?? 'Nothing to fit it to right now';
  const plain = describeId(it.spec)?.plain ?? '';
  const tier = tierOf(it.spec);
  return (
    <div
      role="button"
      tabIndex={0}
      data-inv={it.id}
      class={`tile ${pulse ? 'pulse' : ''} ${active ? 'sel' : ''} ${why ? 'dim' : ''}`}
      title={`${it.name}. ${plain}${why ? ` ${why}.` : ' Drag it onto a socket.'}`}
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
  const groups = GROUP_ORDER.map((k) => ({ k, items: s.inventory.filter((it) => it.kind === k) })).filter((g) => g.items.length);
  return (
    <section class={`inv ${away ? 'away' : ''}`} aria-label="Inventory">
      <header class="inv-head">
        <span class="inv-title"><Icon name="box" size={15} /> Inventory <b>{n}</b></span>
        <span class="inv-hint mute">Drag a part onto the board. Power off first.</span>
        <button class="close" aria-label="Close inventory" title="Close" onClick={toggleInventory}><Icon name="close" size={12} /></button>
      </header>
      {n === 0 ? (
        <div class="inv-empty mute">No spare parts. Click a part on the board to buy an upgrade.</div>
      ) : (
        <div class="inv-groups">
          {groups.map((g) => (
            <div class="inv-group" key={g.k}>
              <div class="inv-gname">{g.k === 'os' ? 'Software' : KIND_LABEL[g.k as keyof typeof KIND_LABEL]}</div>
              <div class="inv-tiles">
                {g.items.map((it) => <Tile key={it.id} it={it} pulse={hl.has(`inv:${it.id}`)} active={sel === `inv:${it.id}`} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
