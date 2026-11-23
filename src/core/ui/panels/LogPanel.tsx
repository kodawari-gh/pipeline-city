// The job log: a modal like the almanac and the shop. It opens on the whole machine seen from far away, drawn rather than written: a ring of where
// the time goes, bars for what the cycles of the runs were spent on, and a card per kind of job with its sprite, its time bar and one coloured tag for
// what held it up (the sentence and the hint are in the tooltip). Each kind links to its almanac page (docs/JOBS.md "The log").
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '@/app/store';
import { dexEntry } from '@/features/jobs/sim/jobdex';
import type { KeySnap, KeyStage, Snapshot } from '@/worker/game/game';
import { aggregate, byKind, livePhases, liveVerdict, phasesOf, stallShares, verdictOf, type Agg, type JobLogEntry, type Phases, type Verdict, type VerdictKind } from '@/features/jobs/sim/joblog';
import { openAlmanacFor } from '@/features/jobs/ui/AlmanacPanel';
import { Icon } from '../kit/Icons';
import type { IconName } from '@/features/economy/ui/shop/picker';
import { fmtMoney, fmtNum, fmtTicks } from '../logic';
import { JobSprite } from '../kit/Sprite';
import { ContractsSection } from '@/features/economy/ui/progress/ContractsSection';
import { splitLog } from '@/features/economy/ui/progress/contractui';

export const logOpen = signal(false);
export const toggleLog = () => { logOpen.value = !logOpen.value; };
export const closeLog = () => { logOpen.value = false; };
const picked = signal<number | null>(null);
const order = signal<'new' | 'slow'>('new');

const nameOf = (type: string) => dexEntry(type)?.name ?? type;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const PHASES = [
  ['wait', 'Waiting', 'clock', 'The time from the job arriving until the machine took it: a power-off, a busy port, a waiting offer'],
  ['queue', 'Queued', 'disk', 'The time from the machine taking the job (USB or download, the spool, the OS queue) until it first ran; absent without an OS'],
  ['run', 'Running', 'bolt', 'The time from the job first running until its result was written'],
  ['collect', 'Collecting', 'box', 'The time from the result being written until the client had it'],
] as const satisfies ReadonlyArray<readonly [keyof Phases, string, IconName, string]>;

/** The icon of each thing that can hold a job up. */
const KIND_ICON: Record<VerdictKind, IconName> = { queue: 'clock', collect: 'box', memory: 'memory', branch: 'gauge', deps: 'wave', port: 'slot', paging: 'warn', compute: 'cpu', card: 'card', lost: 'lock', none: 'check' };
const STALL_KIND: Record<string, VerdictKind> = { cache: 'memory', flush: 'branch', data: 'deps', struct: 'port' };

/** One coloured tag for what held a job up; its tooltip is the sentence and what to try. `quiet`: the colour and the icon only, no pill (the rows of a list). */
function Tag({ v, quiet }: { v: Verdict; quiet?: boolean }) {
  return <span class={`jl-tag k-${v.kind}${quiet ? ' quiet' : ''}`} title={`${v.text}${v.hint ? ` ${v.hint}` : ''}`}><Icon name={KIND_ICON[v.kind]} size={11} /> {v.tag}</span>;
}

/** A job's time in three parts as one bar, scaled against `max` so bars compare. */
function PhaseBar({ p, max }: { p: Phases; max: number }) {
  const w = (n: number) => `${(n / Math.max(1, max)) * 100}%`;
  return (
    <span class="jl-bar" role="img" aria-label={`waiting ${Math.round(p.wait)}s, queued ${Math.round(p.queue)}s, running ${Math.round(p.run)}s, collecting ${Math.round(p.collect)}s`}>
      {PHASES.map(([k]) => p[k] > 0 && <i key={k} class={`jl-${k}`} style={{ width: w(p[k]) }} />)}
    </span>
  );
}

/** A job's time as one bar with what each part is under it: a share and a time. One picture, in place of a ring and four boxes. */
function PhaseSummary({ p }: { p: Phases }) {
  const tot = Math.max(1, p.total);
  return (
    <div class="jl-sum">
      <span class="jl-bar jl-big" role="img" aria-label={`waiting ${Math.round(p.wait)}s, queued ${Math.round(p.queue)}s, running ${Math.round(p.run)}s, collecting ${Math.round(p.collect)}s`}>
        {PHASES.map(([k]) => p[k] > 0 && <i key={k} class={`jl-${k}`} style={{ width: `${(p[k] / tot) * 100}%` }} />)}
      </span>
      <div class="jl-legend">
        {PHASES.map(([k, name, , hint]) => (
          <span key={k} class="jl-lg" title={hint}><i class={`dot jl-${k}`} /> {name} <b>{Math.round((p[k] / tot) * 100)}%</b> <span class="tm">{fmtTicks(p[k])}</span></span>
        ))}
      </div>
    </div>
  );
}

/** Go to the almanac page of a kind of job: an icon in a row, a labelled button in a header. */
function AlmanacLink({ type, label }: { type: string; label?: boolean }) {
  if (!dexEntry(type)) return null;
  const tip = `Open the almanac page for ${nameOf(type)}: what it leans on and how to do it better`;
  return (
    <button class={`jl-alm${label ? '' : ' ghost'}`} title={tip} aria-label={tip} onClick={(ev) => { ev.stopPropagation(); closeLog(); openAlmanacFor(type); }}>
      <Icon name="layers" size={12} />{label && ' Almanac'}
    </button>
  );
}

/** What the cycles of the runs were spent on, as coloured bars; the last bar is how many instructions finished per cycle. */
function Stalls({ a }: { a: Agg }) {
  if (!a.win || a.win.cycles <= 0) return null;
  const sh = stallShares(a.win), ipc = a.win.retired / a.win.cycles;
  return (
    <div class="jl-stalls">
      {sh.map((c) => (
        <div key={c.key} class={`row k-${STALL_KIND[c.key]}`} title={c.label}>
          <span class="ic"><Icon name={KIND_ICON[STALL_KIND[c.key]!]} size={12} /></span>
          <span class="n">{c.label}</span>
          <span class="b"><i style={{ width: pct(c.share) }} /></span>
          <span class="v">{pct(c.share)}</span>
        </div>
      ))}
      <div class="row k-ipc" title="Instructions finished per cycle (1.0 is the most a simple pipeline can do)">
        <span class="ic"><Icon name="check" size={12} /></span>
        <span class="n">Instructions per cycle</span>
        <span class="b"><i style={{ width: pct(Math.min(1, ipc)) }} /></span>
        <span class="v">{fmtNum(ipc, 2)}</span>
      </div>
    </div>
  );
}

/** The bars of the runs behind a fold: shut, it says in one line what took the cycles the most. */
function Inside({ a, open }: { a: Agg; open?: boolean }) {
  if (!a.win || a.win.cycles <= 0) return null;
  // (the shares come largest first)
  const top = stallShares(a.win)[0]!, ipc = a.win.retired / a.win.cycles;
  return (
    <details class="jl-inside" open={open}>
      <summary><span>Inside the runs</span><span class="mute">{top.share >= 0.05 ? `${top.label} ${pct(top.share)}` : 'no stalls'} · {fmtNum(ipc, 2)} per cycle</span></summary>
      <Stalls a={a} />
    </details>
  );
}

function Macro({ list }: { list: JobLogEntry[] }) {
  const all = aggregate(list), kinds = byKind(list);
  const maxAvg = Math.max(1, ...kinds.map((k) => k.wait + k.queue + k.run + k.collect));
  if (all.n === 0) return <p class="mute jl-empty"><Icon name="clock" size={14} /> Nothing finished yet.</p>;
  const avg: Phases = { wait: all.wait, queue: all.queue, run: all.run, collect: all.collect, total: all.wait + all.queue + all.run + all.collect };
  const v = all.verdict;
  return (
    <div class="jl-macro">
      <section class="jl-card">
        <div class="jl-head"><h3>An average job takes <b>{fmtTicks(avg.total)}</b></h3><Tag v={v} /></div>
        <PhaseSummary p={avg} />
        {v.kind !== 'none' && <p class="jl-why">{v.text}{v.hint ? ` ${v.hint}` : ''}</p>}
        <Inside a={all} />
      </section>
      <h4>By kind of job</h4>
      <div class="jl-kinds">
        {kinds.map((k) => {
          const t: Phases = { wait: k.wait, queue: k.queue, run: k.run, collect: k.collect, total: k.wait + k.queue + k.run + k.collect };
          const go = () => { if (dexEntry(k.type)) { closeLog(); openAlmanacFor(k.type); } };
          return (
            <button key={k.type} class="jl-kind" title={`Open the almanac page for ${nameOf(k.type)}`} onClick={go}>
              <JobSprite id={k.type} silhouette={k.n === 0} />
              <span class="mid">
                <span class="nm">{nameOf(k.type)} <span class="cnt">x{k.n}</span>{k.lost > 0 && <span class="bad" title="Taken back or declined"><Icon name="lock" size={10} /> {k.lost}</span>}{k.late > 0 && <span class="late" title="Delivered late"><Icon name="warn" size={10} /> {k.late}</span>}</span>
                <PhaseBar p={t} max={maxAvg} />
              </span>
              <span class="v">{k.n ? fmtTicks(t.total) : ''}</span>
              {k.verdict.kind !== 'none' ? <Tag v={k.verdict} /> : <span />}
              <span class="go" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One job: what held it up, its time in parts, the cycle bars of its run, and the way to its almanac page. */
function Detail({ e }: { e: JobLogEntry }) {
  const p = phasesOf(e), v = verdictOf(e), w = e.win;
  const how = e.outcome === 'done' ? fmtMoney(e.payout) : '';
  return (
    <div class="jl-detail">
      <div class="jl-dhead">
        <JobSprite id={e.type} />
        <div>
          <h3>{nameOf(e.type)} <span class="mute">#{e.id}</span></h3>
          <div class="jl-cap">{v.kind !== 'none' && <Tag v={v} />}{how && <span class="jl-pay"><Icon name="dollar" size={11} /> {how.slice(1)}</span>}{e.late && e.outcome === 'done' && <span class="jl-tag k-queue"><Icon name="warn" size={11} /> Late</span>}{e.reloaded && <span class="jl-tag k-none" title={w ? 'The game was loaded while this job was on the machine: the counters below are since the reload.' : 'The game was loaded while this job was on the machine, so there are no counters for it.'}><Icon name="disk" size={11} /> {w ? 'Counters since reload' : 'Reloaded'}</span>}</div>
        </div>
        <AlmanacLink type={e.type} label />
        <button class="link" onClick={() => { picked.value = null; }}>Overview</button>
      </div>
      <section class="jl-card">
        {e.outcome === 'done' && <PhaseSummary p={p} />}
        {v.kind !== 'none' && <p class="jl-why">{v.text}{v.hint ? ` ${v.hint}` : ''}</p>}
        {w && w.cycles > 0 && !e.gpu && <Inside open a={{ n: 1, late: 0, wait: p.wait, queue: p.queue, run: p.run, collect: p.collect, win: w, verdict: v }} />}
      </section>
    </div>
  );
}

/** How each stage of a job still on the machine reads: an icon, a word, and the colour family it shares with the log's phases (amber waiting, green running, violet collecting). */
const STAGE: Record<KeyStage, readonly [IconName, string, VerdictKind]> = {
  tray: ['box', 'In the tray', 'queue'], offer: ['net', 'On offer', 'queue'], downloading: ['down', 'Downloading', 'queue'], ingesting: ['disk', 'Loading', 'queue'],
  spooled: ['disk', 'On the drive', 'queue'], queued: ['clock', 'Queued', 'queue'], running: ['bolt', 'Running', 'compute'],
  result: ['box', 'Result ready', 'collect'], flashing: ['up', 'Writing result', 'collect'], uploading: ['up', 'Uploading', 'collect'], done: ['check', 'Collect it', 'collect'],
};
/** Running first, then the ones with a result, then the ones queued on the machine, then the ones not taken yet; the oldest first inside each. */
const STAGE_RANK: Record<KeyStage, number> = { running: 0, flashing: 1, result: 1, done: 1, uploading: 2, queued: 2, ingesting: 2, downloading: 2, spooled: 3, offer: 4, tray: 5 };
const NOW_ROWS = 6;

/** Every job the machine has been given and has not finished with: the plugged key, the spool, the offers at the ISP and the tray. */
function inFlight(s: Snapshot): KeySnap[] {
  const seen = new Set<number>(), out: KeySnap[] = [];
  for (const k of [s.plugged, ...(s.net?.spooled ?? []), ...(s.net?.offers ?? []), ...s.tray]) if (k && !seen.has(k.id)) { seen.add(k.id); out.push(k); }
  return out.sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.arrivalTick - b.arrivalTick);
}

/** One job on the machine: its picture, where it is, a bar that fills as it waits and runs toward its deadline, and, while it runs, what is holding it up so far. */
function NowRow({ k, s }: { k: KeySnap; s: Snapshot }) {
  const now = s.baseTick, p = livePhases(k, now);
  const span = Math.max(1, k.deadlineTick - k.arrivalTick, p.total);
  const w = (n: number) => `${(n / span) * 100}%`;
  const [icon, word, fam] = STAGE[k.stage];
  const ahead = k.stage === 'queued' ? s.os?.queue.find((j) => j.keyId === k.id)?.ahead : undefined;
  const xfer = k.stage === 'downloading' || k.stage === 'uploading' ? s.net?.transfers.find((t) => t.jobId === k.id) : undefined;
  const more = xfer ? ` ${Math.round(xfer.percent)}%` : ahead !== undefined && ahead > 0 ? ` · ${ahead} ahead` : '';
  const v = liveVerdict(k, now);
  const late = p.total > k.deadlineTick - k.arrivalTick;
  return (
    <div class={`jl-now-row ${k.runnable ? '' : 'off'}`}>
      <JobSprite id={k.type} silhouette={!k.runnable} />
      <span class="who"><b>{nameOf(k.type)}</b> <span class="mute">#{k.jobNo}</span></span>
      <span class={`jl-state k-${k.runnable ? fam : 'lost'}`} title={k.runnable ? undefined : `It cannot run yet: it needs ${k.missing.join(', ')}. The client takes it back at its deadline.`}>
        <Icon name={k.runnable ? icon : 'lock'} size={11} /> {k.runnable ? word : 'Cannot run'}{k.runnable ? more : ''}
      </span>
      <span class={`jl-bar jl-live ${late ? 'late' : ''}`} role="img" aria-label={`waiting ${Math.round(p.wait)}s, queued ${Math.round(p.queue)}s, running ${Math.round(p.run)}s, collecting ${Math.round(p.collect)}s of ${Math.round(span)}s`}>
        {PHASES.map(([n]) => p[n] > 0 && <i key={n} class={`jl-${n}`} style={{ width: w(p[n]) }} />)}
        <u title="Deadline" style={{ left: w(k.deadlineTick - k.arrivalTick) }} />
      </span>
      <span class="tm">{fmtTicks(p.total)}</span>
      {v ? <Tag v={v} quiet /> : <span />}
      <AlmanacLink type={k.type} />
    </div>
  );
}

/** The jobs on the machine right now, live: the log's own phases, drawn as they happen. */
function Now({ list, s }: { list: KeySnap[]; s: Snapshot }) {
  return (
    <section class="jl-now" aria-label="On the machine now">
      <h4><Icon name="bolt" size={12} /> On the machine now <span class="count">{list.length}</span></h4>
      {list.slice(0, NOW_ROWS).map((k) => <NowRow key={k.id} k={k} s={s} />)}
      {list.length > NOW_ROWS && <p class="mute jl-more">+{list.length - NOW_ROWS} more waiting</p>}
    </section>
  );
}

export function LogPanel() {
  const open = logOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeLog(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const snap = snapshot.value;
  const { jobs: all, contracts: finishedContracts } = splitLog(snap?.jobLog ?? []);
  const live = snap ? inFlight(snap) : [];
  const rows = [...all].sort(order.value === 'slow' ? (a, b) => phasesOf(b).total - phasesOf(a).total : (a, b) => b.end - a.end || b.id - a.id);
  const maxTotal = Math.max(1, ...all.map((e) => phasesOf(e).total));
  const sel = all.find((e) => e.id === picked.value) ?? null;
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeLog(); }}>
      <div class={`card almanac joblog${all.length === 0 ? ' jl-none' : ''}`} data-cue="ui_panel_open" role="dialog" aria-modal="true" aria-label="Job log">
        <header class="alm-head">
          <span class="alm-title"><Icon name="clock" size={16} /> Job log</span>
          <span class="alm-sub">{all.length} finished</span>
          <button class="close" data-cue="ui_panel_close" aria-label="Close job log" title="Close (Esc)" onClick={closeLog}><Icon name="close" size={12} /></button>
        </header>
        {snap?.contracts && <ContractsSection contracts={snap.contracts} finished={finishedContracts} />}
        {snap && live.length > 0 && <Now list={live} s={snap} />}
        {all.length === 0 ? (
          <p class="mute jl-empty">No job has ended yet.</p>
        ) : (
          <div class="alm-body">
            <div class="jl-left">
              <div class="jl-filter" role="group" aria-label="Order">
                <button class={order.value === 'new' ? 'on' : ''} aria-pressed={order.value === 'new'} onClick={() => { order.value = 'new'; }}>Newest</button>
                <button class={order.value === 'slow' ? 'on' : ''} aria-pressed={order.value === 'slow'} onClick={() => { order.value = 'slow'; }}>Slowest</button>
              </div>
              <div class="jl-list" role="listbox" aria-label="Jobs">
                {rows.map((e) => {
                  const p = phasesOf(e), v = verdictOf(e);
                  return (
                    <button key={e.id} role="option" aria-selected={sel?.id === e.id} class={`jl-row ${sel?.id === e.id ? 'on' : ''} ${e.outcome !== 'done' ? 'off' : ''}`} title={`${nameOf(e.type)} #${e.id}`} onClick={() => { picked.value = e.id; }}>
                      <JobSprite id={e.type} silhouette={e.outcome !== 'done'} />
                      <span class="mid"><span class="nm">{nameOf(e.type)}</span><PhaseBar p={p} max={maxTotal} /></span>
                      <span class="tm">{e.outcome === 'done' ? fmtTicks(p.total) : ''}</span>
                      <span class={`dotk k-${v.kind}`} title={v.tag}>{v.kind !== 'none' && <Icon name={KIND_ICON[v.kind]} size={11} />}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div class="alm-main">{sel ? <Detail e={sel} /> : <Macro list={all} />}</div>
          </div>
        )}
      </div>
    </div>
  );
}
