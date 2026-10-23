import type { InventorySnap, Snapshot } from '../sim/game/game';
import { selected } from '../game/hover';
import { dragging, highlight } from '../game/interaction';
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

/** One spare part: illustration, short name, kind. Pressing it starts a drag; clicking it selects it for the picker. */
function Tile({ it, pulse, active }: { it: InventorySnap; pulse: boolean; active: boolean }) {
  const why = it.installable ? undefined : it.reason ?? 'Nothing to fit it to right now';
  const plain = describeId(it.spec)?.plain ?? '';
  return (
    <div
      role="button"
      tabIndex={0}
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
      <PartArt id={it.spec} size={64} />
      <span class="tname">{shortName(it.name)}</span>
      <span class="tkind">{it.kind === 'os' ? 'Software' : KIND_LABEL[it.kind]}</span>
      {why && <span class="tlock" aria-label={why}><Icon name="lock" size={11} /></span>}
    </div>
  );
}

/**
 * The inventory tray, anchored to the bottom edge. It steps aside while a part is being dragged (`dragging` is written
 * by the renderer), so the board is visible for the drop.
 */
export function InventoryPanel({ s }: { s: Snapshot }) {
  if (!inventoryOpen.value) return null;
  const away = dragging.value?.kind === 'part';
  const hl = new Set(highlight.value);
  const sel = selected.value;
  const n = s.inventory.length;
  return (
    <section class={`inv ${away ? 'away' : ''}`} aria-label="Inventory">
      <header class="inv-head">
        <span class="inv-title"><Icon name="box" size={13} /> Inventory <b>{n}</b></span>
        <span class="inv-hint mute hide-narrow">Drag a part onto its socket. Power off first.</span>
        <button class="close" aria-label="Close inventory" title="Close" onClick={toggleInventory}><Icon name="close" size={11} /></button>
      </header>
      {n === 0 ? (
        <div class="inv-empty mute">No spare parts. Click a part on the board to buy an upgrade.</div>
      ) : (
        <div class="inv-tiles">
          {s.inventory.map((it) => (
            <Tile key={it.id} it={it} pulse={hl.has(`inv:${it.id}`)} active={sel === `inv:${it.id}`} />
          ))}
        </div>
      )}
    </section>
  );
}
