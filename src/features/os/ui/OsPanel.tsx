import { useEffect, useState } from 'preact/hooks';
import { setSpoolDrive, setSpoolSlots, snapshot } from '@/app/store';
import { Icon } from '@/core/ui/kit/Icons';
import { Meter } from '@/core/ui/kit/Meter';
import { closeOs, osOpen } from '@/core/ui/state';
import type { IconName } from '../../economy/ui/shop/picker';
import { bottleneck, resourceRows, spoolModel, type ResRow } from './osui';

type Tab = 'monitor' | 'procs' | 'spool' | 'apps';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'monitor', label: 'Performance', icon: 'cpu' },
  { id: 'procs', label: 'Processes', icon: 'slot' },
  { id: 'spool', label: 'Spool', icon: 'disk' },
  { id: 'apps', label: 'Apps', icon: 'bolt' },
];

const HISTORY = 60;
/** Rolling load history per resource, sampled while the window is open (the graphs of a task manager). */
const history = new Map<string, number[]>();
function sample(rows: ResRow[]) {
  for (const r of rows) {
    const h = history.get(r.id) ?? new Array<number>(HISTORY).fill(0);
    h.push(r.load ?? 0);
    if (h.length > HISTORY) h.shift();
    history.set(r.id, h);
  }
}

/** A filled line graph of the last samples; `big` draws grid lines. */
function Graph({ id, level, big }: { id: string; level: string; big?: boolean }) {
  const h = history.get(id) ?? [];
  const pts = h.map((v, i) => `${((i + (HISTORY - h.length)) / (HISTORY - 1)) * 100},${(1 - Math.min(1, Math.max(0, v))) * 100}`);
  const line = pts.join(' ');
  return (
    <svg class={`os-graph ${level}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {big && [25, 50, 75].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} class="grid" vector-effect="non-scaling-stroke" />)}
      {pts.length > 1 && <polygon points={`${pts[0]!.split(',')[0]},100 ${line} 100,100`} class="area" />}
      {pts.length > 1 && <polyline points={line} class="ln" vector-effect="non-scaling-stroke" />}
    </svg>
  );
}

function Tile({ r, on, onPick }: { r: ResRow; on: boolean; onPick: () => void }) {
  return (
    <button class={`os-tile ${r.level}${on ? ' sel' : ''}`} onClick={onPick} aria-current={on}>
      <Graph id={r.id} level={r.level} />
      <span class="os-tile-txt">
        <b><Icon name={r.icon} size={11} /> {r.label}</b>
        <span>{r.text}</span>
      </span>
    </button>
  );
}

function Detail({ r }: { r: ResRow }) {
  return (
    <div class={`os-detail ${r.level}`}>
      <div class="os-detail-head">
        <span class="os-detail-name"><Icon name={r.icon} size={18} /> {r.label}</span>
        <b class="os-big">{r.load !== null ? `${Math.round(r.load * 100)}%` : r.text}</b>
      </div>
      <div class="os-chart"><Graph id={r.id} level={r.level} big /></div>
      <div class="os-axis"><span>60 s ago</span><span>now</span></div>
      {r.load !== null && <Meter value={r.load} level={r.level} label={r.label} text={r.text} />}
      <div class="os-stats"><b>{r.text}</b><span>{r.detail}</span></div>
      {r.advice && <div class={`os-advice ${r.level}`}>{r.advice}</div>}
    </div>
  );
}

/** The performance tab: graph tiles on the left, the chosen part in full on the right. */
function Monitor() {
  const s = snapshot.value;
  const [pick, setPick] = useState<string>('cpu');
  if (!s) return null;
  const rows = resourceRows(s);
  const b = bottleneck(rows);
  const cur = rows.find((r) => r.id === pick) ?? rows[0];
  return (
    <div class="os-perf">
      <div class="os-tiles">
        {rows.map((r) => <Tile key={r.id} r={r} on={r === cur} onPick={() => setPick(r.id)} />)}
      </div>
      <div class="os-main">
        <div class={`os-banner ${b ? b.level : 'ok'}`}>
          <span class="os-pulse" />
          <b>{b ? `Bottleneck: ${b.label}` : 'Nothing holds the machine back'}</b>
          {b && <span>{b.text}</span>}
        </div>
        {cur && <Detail r={cur} />}
      </div>
    </div>
  );
}

const STATE_LABEL = { running: 'Running', queued: 'Waiting', result: 'Done' } as const;

/** The job queue as a process table. */
function Procs() {
  const os = snapshot.value?.os;
  if (!os) return null;
  return (
    <div class="os-table">
      <div class="os-tr os-th"><span>Job</span><span>State</span><span>Slot</span><span>Ahead</span></div>
      {os.queue.length === 0 && <div class="os-empty">No jobs. The queue is empty.</div>}
      {os.queue.map((q) => (
        <div key={`${q.slot}:${q.keyId}`} class={`os-tr ${q.state}`}>
          <span class="os-job">{q.label}</span>
          <span><i class={`os-dot ${q.state}`} /> {STATE_LABEL[q.state]}</span>
          <span class="mono">{q.slot}</span>
          <span class="mono">{q.ahead >= 0 ? q.ahead : '-'}</span>
        </div>
      ))}
      <div class="os-foot">{os.spool.used}/{os.spool.slots} queue slots | {os.programSlots} program slots</div>
    </div>
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

/** The OS window: a task-manager shell with a sidebar of sections. */
export function OsModal() {
  const open = osOpen.value;
  const [tab, setTab] = useState<Tab>('monitor');
  const s = snapshot.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeOs(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || !s) return null;
  const rows = resourceRows(s);
  sample(rows);
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
          {s.os && tab === 'procs' && <Procs />}
          {s.os && tab === 'spool' && <Spool />}
          {s.os && tab === 'apps' && <Apps />}
        </div>
      </div>
    </div>
  );
}
