import { useEffect, useState } from 'preact/hooks';
import { setSpoolAlloc, snapshot } from '@/app/store';
import { Icon } from '@/core/ui/kit/Icons';
import { Meter } from '@/core/ui/kit/Meter';
import { closeOs, osOpen } from '@/core/ui/state';
import type { IconName } from '../../economy/ui/shop/picker';
import { allocModel, bottleneck, fmtBytes, resourceRows, type AllocDrive, type ResRow } from './osui';

type Tab = 'monitor' | 'procs' | 'disks' | 'apps';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'monitor', label: 'Performance', icon: 'cpu' },
  { id: 'procs', label: 'Processes', icon: 'slot' },
  { id: 'disks', label: 'Disk allocation', icon: 'disk' },
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

function DriveCard({ d, slotBytes, room }: { d: AllocDrive; slotBytes: number; room: number }) {
  const share = (v: number) => `${d.capacity > 0 ? (v / d.capacity) * 100 : 0}%`;
  // The slider tops out at what fits on the drive and what the kernel table still has room for.
  const top = Math.max(d.slots, Math.min(d.max, d.slots + room));
  return (
    <div class={`os-alloc${d.why ? ' off' : ''}`} title={d.why ?? undefined}>
      <div class="kv"><span><Icon name="disk" size={12} /> {d.label}</span><b>{fmtBytes(d.capacity)}</b></div>
      <div class="os-diskbar" role="img" aria-label={`${d.label}: system ${fmtBytes(d.osBytes)}, files ${fmtBytes(d.usedBytes)}, spool ${fmtBytes(d.spoolBytes)}, free ${fmtBytes(d.freeBytes)}`}>
        <i class="sys" style={{ width: share(d.osBytes) }} />
        <i class="files" style={{ width: share(d.usedBytes) }} />
        <i class="spool" style={{ width: share(d.spoolBytes) }} />
      </div>
      <div class="os-legend">
        {d.osBytes > 0 && <span><i class="sys" />system {fmtBytes(d.osBytes)}</span>}
        <span><i class="files" />files {fmtBytes(d.usedBytes)}</span>
        <span><i class="spool" />spool {fmtBytes(d.spoolBytes)}</span>
        <span><i class="free" />free {fmtBytes(d.freeBytes)}</span>
      </div>
      {d.why
        ? <div class="mute sub">{d.why}</div>
        : (
          <label class="scale-row" title={`Each slot keeps one waiting job and takes ${fmtBytes(slotBytes)}.`}>
            <span>spool slots</span>
            <input type="range" min={0} max={top} step={1} value={Math.min(d.alloc ?? d.slots, top)} disabled={top === 0} aria-label={`Spool slots on ${d.label}`}
              onInput={(e) => setSpoolAlloc(d.deviceId, Number(e.currentTarget.value))} />
            <b class="value">{d.alloc === null ? `auto (${d.slots})` : d.alloc}</b>
          </label>
        )}
      {!d.why && d.alloc !== null && <div class="os-actions"><button class="chip idle" onClick={() => setSpoolAlloc(d.deviceId, null)}>Automatic</button></div>}
    </div>
  );
}

/** Disk allocation: how each drive's space splits between the system, your files and spool slots for waiting jobs. */
function Disks() {
  const s = snapshot.value;
  const m = s ? allocModel(s) : null;
  if (!m) return <section><div class="mute sub">Install an OS to allocate disk space.</div></section>;
  const room = Math.max(0, m.cap - m.total);
  return (
    <>
      <section class="os-wide">
        <div class="kv"><span>spool slots in use</span><b>{m.total}/{m.cap}</b></div>
        <div class="mute sub">Each slot holds one job waiting on a drive and takes {fmtBytes(m.slotBytes)}. A higher OS tier allows more slots. {m.pending ? 'The machine is on: changes apply at the next power-on.' : 'Changes apply now.'}</div>
      </section>
      {m.drives.map((d) => <DriveCard key={d.deviceId} d={d} slotBytes={m.slotBytes} room={room} />)}
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
          {s.os && tab === 'disks' && <Disks />}
          {s.os && tab === 'apps' && <Apps />}
        </div>
      </div>
    </div>
  );
}
