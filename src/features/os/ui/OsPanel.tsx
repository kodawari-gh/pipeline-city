import { useEffect, useState } from 'preact/hooks';
import { setSpoolDrive, setSpoolSlots, snapshot } from '@/app/store';
import { Icon } from '@/core/ui/kit/Icons';
import { Meter } from '@/core/ui/kit/Meter';
import { closeOs, osOpen } from '@/core/ui/state';
import { bottleneck, resourceRows, spoolModel, type ResRow } from './osui';

type Tab = 'monitor' | 'spool' | 'apps';
const TABS: { id: Tab; label: string }[] = [{ id: 'monitor', label: 'Resources' }, { id: 'spool', label: 'Spool' }, { id: 'apps', label: 'Apps' }];

function Row({ r }: { r: ResRow }) {
  return (
    <div class={`os-res ${r.level}`} title={r.advice}>
      <div class="kv"><span><Icon name={r.icon} size={12} /> {r.label}</span><b>{r.text}</b></div>
      {r.load !== null && <Meter value={r.load} level={r.level} label={r.label} text={r.text} />}
      <div class="mute sub">{r.detail}</div>
      {r.advice && <div class={`os-advice ${r.level}`}>{r.advice}</div>}
    </div>
  );
}

/** The resource monitor: every part of the machine in one list, and the worst one named at the top. */
function Monitor() {
  const s = snapshot.value;
  if (!s) return null;
  const rows = resourceRows(s);
  const b = bottleneck(rows);
  return (
    <>
      <section class="os-wide">
        <h3>Bottleneck</h3>
        {b
          ? <div class={`chip ${b.level}`} title={b.text}>{b.label}</div>
          : <div class="chip ok">Nothing holds the machine back</div>}
        {b && <div class="mute sub">{b.text}</div>}
      </section>
      <section class="os-wide">
        <h3>Machine</h3>
        <div class="os-grid">{rows.map((r) => <Row key={r.id} r={r} />)}</div>
      </section>
    </>
  );
}

/** How many queue slots the OS keeps, and which drives hold them. */
function Spool() {
  const s = snapshot.value;
  const m = s ? spoolModel(s) : null;
  if (!m) return <section><div class="mute sub">Install an OS to set up its job queue.</div></section>;
  return (
    <>
      <section>
        <h3 title="Each slot holds one job waiting on a drive. A full spool stops new downloads.">Queue slots</h3>
        <div class="kv"><span>in use</span><b>{m.used}/{m.slots}</b></div>
        <label class="scale-row" title="The most jobs the OS keeps waiting. Most it allows: see the tier.">
          <span>wanted</span>
          <input type="range" min={1} max={m.max} step={1} value={m.wanted} aria-label="Queue slots wanted"
            onInput={(e) => setSpoolSlots(Number(e.currentTarget.value))} />
          <b class="value">{m.auto ? `all ${m.max}` : m.wanted}</b>
        </label>
        <div class="os-actions">
          <button class="chip idle" disabled={m.auto} onClick={() => setSpoolSlots(null)}>Use the most ({m.max})</button>
        </div>
        <div class="mute sub">A higher OS tier allows more slots. {m.pending ? 'The machine is on: changes apply at the next power-on.' : 'Changes apply now.'}</div>
      </section>
      <section>
        <h3 title="Slots fill the OS drive first, then the other drives, fastest first.">Drives</h3>
        {m.drives.map((d) => (
          <div class="os-drive" key={d.deviceId} title={d.why ?? undefined}>
            <label class="kv">
              <span>
                <input type="checkbox" checked={d.on} disabled={!d.canToggle} onChange={(e) => setSpoolDrive(d.deviceId, e.currentTarget.checked)} /> {d.label}{d.home ? ' (OS)' : ''}
              </span>
              <b>{d.slots} slot{d.slots === 1 ? '' : 's'}</b>
            </label>
            <div class="mute sub">{d.why ?? d.freeText}</div>
          </div>
        ))}
      </section>
    </>
  );
}

/** Work in progress: your own programs for the OS to run (monitors, schedulers, helpers). */
function Apps() {
  return (
    <section>
      <h3>Apps</h3>
      <div class="chip warn">Work in progress</div>
      <div class="mute sub">Soon you will write small programs of your own here and let the OS run them next to the jobs: a scheduler, a cache, a watchdog.</div>
    </section>
  );
}

/** The OS window: a modal like the almanac and the job log. */
export function OsModal() {
  const open = osOpen.value;
  const [tab, setTab] = useState<Tab>('monitor');
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeOs(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const s = snapshot.value;
  if (!open || !s) return null;
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeOs(); }}>
      <div class="card almanac ospanel" role="dialog" aria-modal="true" aria-label="Operating system">
        <header class="alm-head">
          <span class="alm-title"><Icon name="cpu" size={16} /> {s.os ? s.os.name : 'Operating system'}</span>
          <div class="os-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} class={`chip ${tab === t.id ? 'ok' : 'idle'}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <button class="close" aria-label="Close OS window" title="Close (Esc)" onClick={closeOs}><Icon name="close" size={12} /></button>
        </header>
        <div class="os-body">
          {!s.os && <section><div class="mute sub">No OS is installed. Buy one in the shop and install it on a drive.</div></section>}
          {s.os && tab === 'monitor' && <Monitor />}
          {s.os && tab === 'spool' && <Spool />}
          {s.os && tab === 'apps' && <Apps />}
        </div>
      </div>
    </div>
  );
}
