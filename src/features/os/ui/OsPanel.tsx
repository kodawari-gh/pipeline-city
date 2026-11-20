import { useEffect, useState } from 'preact/hooks';
import { formatDrive, setDataReserve, setSpoolAlloc, snapshot } from '@/app/store';
import { Icon } from '@/core/ui/kit/Icons';
import { closeOs, osOpen } from '@/core/ui/state';
import { resourceRows } from './osui';
import { OS_TABS, OsBody, sampleHistory, type OsActions, type OsHistory, type OsTab } from './OsViews';

// The game's OS window: a task-manager shell with a sidebar of sections. The pages themselves are `OsViews.tsx` (Build my PC's OS sheet draws the same ones); this file
// gives them the worker's snapshot and the store's actions.

/** The history of the graphs: kept while the window is closed, sampled only while it is open. */
const history: OsHistory = new Map();

const actions: OsActions = { formatDrive: (id) => formatDrive(id), setSpoolAlloc, setDataReserve };

/** The OS window: a task-manager shell with a sidebar of sections. */
export function OsModal() {
  const open = osOpen.value;
  const [tab, setTab] = useState<OsTab>('monitor');
  const s = snapshot.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeOs(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || !s) return null;
  sampleHistory(history, resourceRows(s));
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeOs(); }}>
      <div class="card almanac ospanel" role="dialog" aria-modal="true" aria-label="Operating system">
        <header class="alm-head">
          <span class="alm-title"><Icon name="cpu" size={16} /> {s.os ? s.os.name : 'Operating system'}</span>
          <div class="os-tabs seg" role="tablist">
            {OS_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <button class="close" aria-label="Close OS window" title="Close (Esc)" onClick={closeOs}><Icon name="close" size={12} /></button>
        </header>
        <div class="os-body">
          {!s.os && <section><div class="mute sub">No OS is installed. Buy one in the shop and install it on a drive.</div></section>}
          {s.os && <OsBody tab={tab} s={s} act={actions} history={history} />}
        </div>
      </div>
    </div>
  );
}
