// The job log: a modal like the almanac and the shop. It opens on the whole machine seen from far away, drawn rather than written: a ring of where
// the time goes, bars for what the cycles of the runs were spent on, and a card per kind of job with its sprite, its time bar and one coloured tag for
// what held it up (the sentence and the hint are in the tooltip). Each kind links to its almanac page (docs/JOBS.md "The log").
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '../game/store';
import { dexEntry } from '../sim/game/jobdex';
import { aggregate, byKind, phasesOf, stallShares, verdictOf, type Agg, type JobLogEntry, type Phases, type Verdict, type VerdictKind } from '../sim/game/joblog';
import { openAlmanacFor } from './AlmanacPanel';
import { Icon } from './Icons';
import type { IconName } from './picker';
import { fmtMoney, fmtNum, fmtTicks } from './logic';
import { JobSprite } from './Sprite';

export const logOpen = signal(false);
export const toggleLog = () => { logOpen.value = !logOpen.value; };
export const closeLog = () => { logOpen.value = false; };
const picked = signal<number | null>(null);
const order = signal<'new' | 'slow'>('new');

const nameOf = (type: string) => dexEntry(type)?.name ?? type;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const PHASES = [
  ['wait', 'Waiting', 'clock', 'The time from the job arriving until the machine took it: a busy machine, a power-off, a download'],
  ['run', 'Running', 'bolt', 'The time from the machine taking the job until its result was written'],
  ['collect', 'Collecting', 'box', 'The time from the result being written until the client had it'],
] as const satisfies ReadonlyArray<readonly [keyof Phases, string, IconName, string]>;

/** The icon of each thing that can hold a job up. */
const KIND_ICON: Record<VerdictKind, IconName> = { queue: 'clock', collect: 'box', memory: 'memory', branch: 'gauge', deps: 'wave', port: 'slot', paging: 'warn', compute: 'cpu', lost: 'lock', none: 'check' };
const STALL_KIND: Record<string, VerdictKind> = { cache: 'memory', flush: 'branch', data: 'deps', struct: 'port' };

/** One coloured tag for what held a job up; its tooltip is the sentence and what to try. */
function Tag({ v }: { v: Verdict }) {
  return <span class={`jl-tag k-${v.kind}`} title={`${v.text}${v.hint ? ` ${v.hint}` : ''}`}><Icon name={KIND_ICON[v.kind]} size={11} /> {v.tag}</span>;
}

/** A job's time in three parts as one bar, scaled against `max` so bars compare. */
function PhaseBar({ p, max }: { p: Phases; max: number }) {
  const w = (n: number) => `${(n / Math.max(1, max)) * 100}%`;
  return (
    <span class="jl-bar" role="img" aria-label={`waiting ${Math.round(p.wait)}s, running ${Math.round(p.run)}s, collecting ${Math.round(p.collect)}s`}>
      {PHASES.map(([k]) => p[k] > 0 && <i key={k} class={`jl-${k}`} style={{ width: w(p[k]) }} />)}
    </span>
  );
}

/** The time split as a ring with the total in the middle. */
function Donut({ p }: { p: Phases }) {
  const r = 15.9, c = 2 * Math.PI * r, tot = Math.max(1, p.total);
  let at = 0;
  return (
    <div class="jl-donut">
      <svg viewBox="0 0 36 36" role="img" aria-label="Where the time goes">
        <circle class="trk" cx="18" cy="18" r={r} />
        {PHASES.map(([k]) => {
          const len = (p[k] / tot) * c, off = at;
          at += len;
          return len > 0.2 && <circle key={k} class={`seg jl-${k}`} cx="18" cy="18" r={r} stroke-dasharray={`${Math.max(0.3, len - 0.4)} ${c}`} stroke-dashoffset={-off} transform="rotate(-90 18 18)" />;
        })}
      </svg>
      <b>{fmtTicks(p.total)}</b>
    </div>
  );
}

/** The three phases as big numbers with an icon and a colour. */
function PhaseStats({ p }: { p: Phases }) {
  const tot = Math.max(1, p.total);
  return (
    <div class="jl-stats">
      {PHASES.map(([k, name, icon, hint]) => (
        <div key={k} class={`jl-stat jl-${k}c`} title={hint}>
          <span class="ic"><Icon name={icon} size={13} /></span>
          <b>{Math.round((p[k] / tot) * 100)}<small>%</small></b>
          <span class="nm">{name}</span>
          <span class="tm">{fmtTicks(p[k])}</span>
        </div>
      ))}
    </div>
  );
}

/** Go to the almanac page of a kind of job. */
function AlmanacLink({ type }: { type: string }) {
  if (!dexEntry(type)) return null;
  return (
    <button class="jl-alm" title={`Open the almanac page for ${nameOf(type)}: what it leans on and how to do it better`} onClick={() => { closeLog(); openAlmanacFor(type); }}>
      <Icon name="layers" size={12} /> Almanac
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

function Macro({ list }: { list: JobLogEntry[] }) {
  const all = aggregate(list), kinds = byKind(list);
  const maxAvg = Math.max(1, ...kinds.map((k) => k.wait + k.run + k.collect));
  if (all.n === 0) return <p class="mute jl-empty"><Icon name="clock" size={14} /> Nothing finished yet.</p>;
  const avg: Phases = { wait: all.wait, run: all.run, collect: all.collect, total: all.wait + all.run + all.collect };
  return (
    <div class="jl-macro">
      <div class="jl-top">
        <Donut p={avg} />
        <div class="jl-topr">
          <div class="jl-cap">An average job <Tag v={all.verdict} /></div>
          <PhaseStats p={avg} />
        </div>
      </div>
      {all.win && all.win.cycles > 0 && (
        <>
          <h4>Inside the runs</h4>
          <Stalls a={all} />
        </>
      )}
      <h4>By kind of job</h4>
      <div class="jl-kinds">
        {kinds.map((k) => {
          const t: Phases = { wait: k.wait, run: k.run, collect: k.collect, total: k.wait + k.run + k.collect };
          return (
            <div key={k.type} class="jl-kind">
              <JobSprite id={k.type} silhouette={k.n === 0} />
              <div class="mid">
                <div class="nm">{nameOf(k.type)} <span class="cnt">x{k.n}</span>{k.lost > 0 && <span class="bad" title="Taken back or declined"><Icon name="lock" size={10} /> {k.lost}</span>}{k.late > 0 && <span class="late" title="Delivered late"><Icon name="warn" size={10} /> {k.late}</span>}</div>
                <PhaseBar p={t} max={maxAvg} />
              </div>
              <span class="v">{k.n ? fmtTicks(t.total) : ''}</span>
              <Tag v={k.verdict} />
              <AlmanacLink type={k.type} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One job: its three phases, what held it up, the cycle bars of its run, and the way to its almanac page. */
function Detail({ e }: { e: JobLogEntry }) {
  const p = phasesOf(e), v = verdictOf(e), w = e.win;
  const how = e.outcome === 'done' ? fmtMoney(e.payout) : '';
  return (
    <div class="jl-detail">
      <div class="jl-dhead">
        <JobSprite id={e.type} />
        <div>
          <h3>{nameOf(e.type)} <span class="mute">#{e.id}</span></h3>
          <div class="jl-cap"><Tag v={v} />{how && <span class="jl-pay"><Icon name="dollar" size={11} /> {how.slice(1)}</span>}{e.late && e.outcome === 'done' && <span class="jl-tag k-queue"><Icon name="warn" size={11} /> Late</span>}</div>
        </div>
        <AlmanacLink type={e.type} />
        <button class="link" onClick={() => { picked.value = null; }}>Overview</button>
      </div>
      {e.outcome === 'done' && <><Donut p={p} /><PhaseStats p={p} /></>}
      {w && w.cycles > 0 && <Stalls a={{ n: 1, late: 0, wait: p.wait, run: p.run, collect: p.collect, win: w, verdict: v }} />}
    </div>
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
  const all = snapshot.value?.jobLog ?? [];
  const rows = [...all].sort(order.value === 'slow' ? (a, b) => phasesOf(b).total - phasesOf(a).total : (a, b) => b.end - a.end || b.id - a.id);
  const maxTotal = Math.max(1, ...all.map((e) => phasesOf(e).total));
  const sel = all.find((e) => e.id === picked.value) ?? null;
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeLog(); }}>
      <div class="card almanac joblog" role="dialog" aria-modal="true" aria-label="Job log">
        <header class="alm-head">
          <span class="alm-title"><Icon name="clock" size={16} /> Job log</span>
          <span class="chip">{all.length} {all.length === 1 ? 'job' : 'jobs'}</span>
          <span class="jl-key">{PHASES.map(([k, name]) => <span key={k}><i class={`dot jl-${k}`} /> {name}</span>)}</span>
          <button class="close" aria-label="Close job log" title="Close (Esc)" onClick={closeLog}><Icon name="close" size={12} /></button>
        </header>
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
                      <span class={`dotk k-${v.kind}`} title={v.tag}><Icon name={KIND_ICON[v.kind]} size={11} /></span>
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
