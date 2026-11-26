import { useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { Meter } from '@/core/ui/kit/Meter';
import type { Snapshot } from '@/worker/game/game';
import type { CoreLive } from '../../cpu/sim/pipesnap';
import type { IconName } from '../../economy/ui/shop/picker';
import * as osui from './osui';

// The OS window's pages, as views of one snapshot (docs/OS.md "OS menu"): the game's window (`OsPanel.tsx`, the worker's snapshot and the store's actions) and Build my PC's
// OS sheet (`BuildOs.tsx`, the stage's machine) draw the same four pages. Nothing here reads the store.

export type OsTab = 'monitor' | 'procs' | 'disks' | 'apps';
export const OS_TABS: { id: OsTab; label: string; icon: IconName }[] = [
  { id: 'monitor', label: 'Performance', icon: 'cpu' },
  { id: 'procs', label: 'Processes', icon: 'slot' },
  { id: 'disks', label: 'Disk allocation', icon: 'disk' },
  { id: 'apps', label: 'Apps', icon: 'bolt' },
];

/** What the disk page changes: the machine's own actions (the game sends them to the worker; Build my PC's stage runs them on its game). */
export interface OsActions {
  formatDrive: (deviceId: string) => void;
  setSpoolAlloc: (deviceId: string, slots: number | null) => void;
  setDataReserve: (deviceId: string, blocks: number | null) => void;
}

const HISTORY = 60;
/** Rolling load history per resource, sampled while the window is open (the graphs of a task manager). */
export type OsHistory = Map<string, number[]>;
export function sampleHistory(history: OsHistory, rows: osui.ResRow[], times = 1): void {
  for (const r of rows) {
    const h = history.get(r.id) ?? new Array<number>(HISTORY).fill(0);
    // (`times`: seconds that went by since the last sample, when the screen drew less often than the machine ticked)
    for (let i = 0; i < Math.min(times, HISTORY); i++) {
      h.push(r.load ?? 0);
    }
    while (h.length > HISTORY) {
      h.shift();
    }
    history.set(r.id, h);
  }
}

/** A filled line graph of the last samples; `big` draws grid lines. */
function Graph({ h, level, big }: { h: number[]; level: string; big?: boolean }) {
  const pts = h.map(
    (v, i) => `${((i + (HISTORY - h.length)) / (HISTORY - 1)) * 100},${(1 - Math.min(1, Math.max(0, v))) * 100}`,
  );
  const line = pts.join(' ');
  return (
    <svg class={`os-graph ${level}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {big &&
        [25, 50, 75].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} class="grid" vector-effect="non-scaling-stroke" />
        ))}
      {pts.length > 1 && <polygon points={`${pts[0]!.split(',')[0]},100 ${line} 100,100`} class="area" />}
      {pts.length > 1 && <polyline points={line} class="ln" vector-effect="non-scaling-stroke" />}
    </svg>
  );
}

function Tile({ r, h, on, onPick }: { r: osui.ResRow; h: number[]; on: boolean; onPick: () => void }) {
  return (
    <button class={`os-tile ${r.level}${on ? ' sel' : ''}`} onClick={onPick} aria-current={on}>
      <Graph h={h} level={r.level} />
      <span class="os-tile-txt">
        <b>
          <Icon name={r.icon} size={11} /> {r.label}
        </b>
        <span>{r.text}</span>
      </span>
    </button>
  );
}

/**
 * The processor's logical cores, the ones that share a hardware core side by side: lit while a job runs on one, dim while the OS has it parked, outlined while it waits for work. A
 * job on several lit cores at once is a threaded job; several jobs on several cores are a machine that runs programs side by side.
 */
function CoreStrip({ s }: { s: Snapshot }) {
  const live = s.cores?.live;
  if (!s.powered || !live || live.length < 2) {
    return null;
  }
  const hw = new Map<number, CoreLive[]>();
  for (const c of live) {
    hw.set(c.hw, [...(hw.get(c.hw) ?? []), c]);
  }
  const busy = live.filter((c) => !c.parked && c.job !== 0).length;
  return (
    <div class="os-cores">
      <span class="os-cores-head">
        Cores <b>{busy}</b> of {live.length} working
      </span>
      <div class="os-cores-row" role="img" aria-label={`${busy} of ${live.length} logical cores working`}>
        {[...hw.entries()].map(([k, cs]) => (
          <span key={k} class="os-core" title={cs.length > 1 ? `Core ${k}: ${cs.length} logical cores` : `Core ${k}`}>
            {cs.map((c) => (
              <i
                key={c.core}
                class={c.parked ? 'parked' : c.job !== 0 ? 'busy' : 'idle'}
                title={`Logical core ${c.core}: ${c.parked ? 'parked by the OS' : c.job !== 0 ? 'running a job' : 'waiting for work'}`}
              />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

function Detail({ r, h, s }: { r: osui.ResRow; h: number[]; s: Snapshot }) {
  return (
    <div class={`os-detail ${r.level}`}>
      <div class="os-detail-head">
        <span class="os-detail-name">
          <Icon name={r.icon} size={18} /> {r.label}
        </span>
        <b class="os-big">{r.load !== null ? `${Math.round(r.load * 100)}%` : r.text}</b>
      </div>
      <div class="os-chart">
        <Graph h={h} level={r.level} big />
      </div>
      <div class="os-axis">
        <span>60 s ago</span>
        <span>now</span>
      </div>
      {r.load !== null && <Meter value={r.load} level={r.level} label={r.label} text={r.text} />}
      <div class="os-stats">
        <b>{r.text}</b>
        <span>{r.detail}</span>
      </div>
      {r.id === 'cpu' && <CoreStrip s={s} />}
      {r.advice && <div class={`os-advice ${r.level}`}>{r.advice}</div>}
    </div>
  );
}

/** The performance tab: graph tiles on the left, the chosen part in full on the right. */
function Monitor({ s, history }: { s: Snapshot; history: OsHistory }) {
  const [pick, setPick] = useState<string>('cpu');
  const rows = osui.resourceRows(s);
  const b = osui.bottleneck(rows);
  const cur = rows.find((r) => r.id === pick) ?? rows[0];
  const of = (r: osui.ResRow): number[] => history.get(r.id) ?? [];
  return (
    <div class="os-perf">
      <div class="os-tiles">
        {rows.map((r) => (
          <Tile key={r.id} r={r} h={of(r)} on={r === cur} onPick={() => setPick(r.id)} />
        ))}
      </div>
      <div class="os-main">
        <div class={`os-banner ${!s.powered ? 'off' : b ? b.level : 'ok'}`}>
          <span class="os-pulse" />
          <b>{!s.powered ? 'The machine is off' : b ? `Bottleneck: ${b.label}` : 'Nothing holds the machine back'}</b>
          {s.powered && b ? (
            <span>{b.text}</span>
          ) : (
            !s.powered && <span>Switch it on to see live numbers. The graphs fill in as it works.</span>
          )}
        </div>
        {cur && <Detail r={cur} h={of(cur)} s={s} />}
      </div>
    </div>
  );
}

const STATE_LABEL = { running: 'Running', queued: 'Waiting', result: 'Done' } as const;

/** The job queue as a process table. */
function Procs({ s }: { s: Snapshot }) {
  const { os } = s;
  if (!os) {
    return null;
  }
  const { used, slots } = os.spool;
  return (
    <div class="os-procs">
      <CoreStrip s={s} />
      <div class="os-table">
        <div
          class="os-slots"
          title={`${used} of ${slots} queue slots hold a job. ${os.programSlots} program slots run them.`}
        >
          <span>Queue slots</span>
          <span class="os-slotbar" role="img" aria-label={`${used} of ${slots} queue slots in use`}>
            <i style={{ width: `${slots > 0 ? (used / slots) * 100 : 0}%` }} />
          </span>
          <b>
            {used}/{slots}
          </b>
        </div>
        <div class="os-tr os-th">
          <span>Job</span>
          <span>State</span>
          <span>Slot</span>
          <span>Ahead</span>
        </div>
        {os.queue.length === 0 && (
          <div class="os-empty">
            <Icon name="slot" size={16} /> Nothing queued. A job waits here until a program slot is free.
          </div>
        )}
        {os.queue.map((q) => (
          <div key={`${q.slot}:${q.keyId}`} class={`os-tr ${q.state}`}>
            <span class="os-job">{q.label}</span>
            <span>
              <i class={`os-dot ${q.state}`} /> {STATE_LABEL[q.state]}
            </span>
            <span class="mono">{q.slot}</span>
            <span class="mono">{q.ahead >= 0 ? q.ahead : '-'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The reserve slider's step in blocks: 16 blocks (4 KiB), the size of one spool slot. */
const RESERVE_STEP = 16;

function DriveCard({
  d,
  slotBytes,
  room,
  act,
}: {
  d: osui.AllocDrive;
  slotBytes: number;
  room: number;
  act: OsActions;
}) {
  const share = (v: number) => `${d.capacity > 0 ? (v / d.capacity) * 100 : 0}%`;
  // The slider tops out at what fits on the drive and what the kernel table still has room for.
  const top = Math.max(d.slots, Math.min(d.max, d.slots + room));
  // The reserve slider moves in steps of one spool slot's size, up to what the drive has free besides the reserve itself.
  const stepBytes = RESERVE_STEP * 256;
  const reserveSteps = Math.round((d.reserveBytes ?? 0) / stepBytes);
  const reserveTop = Math.max(reserveSteps, Math.floor((d.freeBytes + d.reserveFree + d.dataBytes) / stepBytes));
  return (
    <div class={`os-alloc${d.why ? ' off' : ''}`} title={d.why ?? undefined}>
      <div class="kv">
        <span>
          <Icon name="disk" size={12} /> {d.label}
        </span>
        <b>{osui.fmtBytes(d.capacity)}</b>
      </div>
      <div
        class="os-diskbar"
        role="img"
        aria-label={`${d.label}: system ${osui.fmtBytes(d.osBytes)}, files ${osui.fmtBytes(d.usedBytes)}, spool ${osui.fmtBytes(d.spoolBytes)}, datasets ${osui.fmtBytes(d.dataBytes)}, free ${osui.fmtBytes(d.freeBytes)}`}
      >
        <i class="sys" style={{ width: share(d.osBytes) }} />
        <i class="files" style={{ width: share(d.usedBytes) }} />
        <i class="spool" style={{ width: share(d.spoolBytes) }} />
        <i class="data" style={{ width: share(d.dataBytes) }} />
        <i class="rsv" style={{ width: share(d.reserveFree) }} />
      </div>
      <div class="os-legend">
        {d.osBytes > 0 && (
          <span>
            <i class="sys" />
            system {osui.fmtBytes(d.osBytes)}
          </span>
        )}
        <span>
          <i class="files" />
          files {osui.fmtBytes(d.usedBytes)}
        </span>
        <span>
          <i class="spool" />
          spool {osui.fmtBytes(d.spoolBytes)}
        </span>
        <span>
          <i class="data" />
          datasets {osui.fmtBytes(d.dataBytes)}
        </span>
        {d.reserveBytes !== null && (
          <span>
            <i class="rsv" />
            reserved {osui.fmtBytes(d.reserveFree)}
          </span>
        )}
        <span>
          <i class="free" />
          free {osui.fmtBytes(d.freeBytes)}
        </span>
      </div>
      {d.why ? (
        <>
          <div class="mute sub">
            {d.needsFormat
              ? 'This drive is not formatted yet, so the OS cannot put a spool or datasets on it. Formatting wipes it.'
              : d.why}
          </div>
          {d.needsFormat && (
            <div class="os-actions">
              <button
                class="chip ok"
                disabled={d.formatWhy !== null}
                title={d.formatWhy ?? 'Format this drive for the OS'}
                onClick={() => act.formatDrive(d.deviceId)}
              >
                Format drive
              </button>
              {d.formatWhy && <span class="mute sub">{d.formatWhy}</span>}
            </div>
          )}
        </>
      ) : (
        <label class="scale-row" title={`Each slot keeps one waiting job and takes ${osui.fmtBytes(slotBytes)}.`}>
          <span>spool slots</span>
          <input
            type="range"
            data-cue="ui_slider_tick"
            min={0}
            max={top}
            step={1}
            value={Math.min(d.alloc ?? d.slots, top)}
            disabled={top === 0}
            aria-label={`Spool slots on ${d.label}`}
            onInput={(e) => act.setSpoolAlloc(d.deviceId, Number(e.currentTarget.value))}
          />
          <b class="value">{d.alloc === null ? `auto (${d.slots})` : d.alloc}</b>
        </label>
      )}
      {!d.why && (
        <label
          class="scale-row"
          title="Room kept for the datasets of cloud contracts. The spool cannot use it. With no reserve, datasets and spool share the free room."
        >
          <span>dataset reserve</span>
          <input
            type="range"
            data-cue="ui_slider_tick"
            min={0}
            max={reserveTop}
            step={1}
            value={Math.min(reserveSteps, reserveTop)}
            aria-label={`Dataset reserve on ${d.label}`}
            onInput={(e) => act.setDataReserve(d.deviceId, Number(e.currentTarget.value) * RESERVE_STEP)}
          />
          <b class="value">{d.reserveBytes === null ? 'none' : osui.fmtBytes(d.reserveBytes)}</b>
        </label>
      )}
      {!d.why && d.reserveBytes !== null && (
        <div class="os-actions">
          <button class="chip idle" onClick={() => act.setDataReserve(d.deviceId, null)}>
            No reserve
          </button>
        </div>
      )}
      {!d.why && d.alloc !== null && (
        <div class="os-actions">
          <button class="chip idle" onClick={() => act.setSpoolAlloc(d.deviceId, null)}>
            Automatic
          </button>
        </div>
      )}
    </div>
  );
}

/** Disk allocation: how each drive's space splits between the system, your files and spool slots for waiting jobs. */
function Disks({ s, act }: { s: Snapshot; act: OsActions }) {
  const m = osui.allocModel(s);
  if (!m) {
    return (
      <section>
        <div class="mute sub">Install an OS to allocate disk space.</div>
      </section>
    );
  }
  const room = Math.max(0, m.cap - m.total);
  return (
    <>
      <section class="os-wide">
        <div class="kv">
          <span>Spool slots in use</span>
          <b>
            {m.total}/{m.cap}
          </b>
        </div>
        <div class="mute sub">
          A slot keeps one waiting job: {osui.fmtBytes(m.slotBytes)} of disk and 64 B of RAM. This OS holds {m.cap} at
          most. {m.pending ? 'The machine is on: changes apply at the next power-on.' : 'Changes apply now.'}
        </div>
      </section>
      {m.drives.map((d) => (
        <DriveCard key={d.deviceId} d={d} slotBytes={m.slotBytes} room={room} act={act} />
      ))}
    </>
  );
}

/** Work in progress: your own programs for the OS to run (monitors, schedulers, helpers). */
function Apps() {
  return (
    <section>
      <h3>Apps</h3>
      <div class="chip warn">Work in progress</div>
      <div class="mute sub">
        Soon you will write small programs of your own here and let the OS run them next to the jobs: a scheduler, a
        cache, a watchdog.
      </div>
    </section>
  );
}

/** The page of one tab, for a machine with an OS (the caller says what a machine without one shows). */
export function OsBody({ tab, s, act, history }: { tab: OsTab; s: Snapshot; act: OsActions; history: OsHistory }) {
  return (
    <>
      {tab === 'monitor' && <Monitor s={s} history={history} />}
      {tab === 'procs' && <Procs s={s} />}
      {tab === 'disks' && <Disks s={s} act={act} />}
      {tab === 'apps' && <Apps />}
    </>
  );
}
