// The job log: a modal like the almanac and the shop. It opens on the whole machine seen from far away (where jobs spend their time, what slows the
// runs, which kinds of job cost the most) and each kind links to its almanac page, where the ways to do it better are. A list of recent jobs sits
// beside it for the single case (docs/JOBS.md "The log").
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '../game/store';
import { dexEntry } from '../sim/game/jobdex';
import { aggregate, byKind, phasesOf, stallShares, verdictOf, type Agg, type JobLogEntry, type Phases } from '../sim/game/joblog';
import { openAlmanacFor } from './AlmanacPanel';
import { Icon } from './Icons';
import { fmtMoney, fmtNum, fmtTicks } from './logic';

export const logOpen = signal(false);
export const toggleLog = () => { logOpen.value = !logOpen.value; };
export const closeLog = () => { logOpen.value = false; };
const picked = signal<number | null>(null);
const order = signal<'new' | 'slow'>('new');

const nameOf = (type: string) => dexEntry(type)?.name ?? type;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const PHASES = [
  ['wait', 'Waiting', 'the time from the job arriving until the machine took it: a busy machine, a power-off, a download'],
  ['run', 'Running', 'the time from the machine taking the job until its result was written'],
  ['collect', 'Collecting', 'the time from the result being written until the client had it'],
] as const;

/** A job's time in three parts as one bar, scaled against `max` so bars compare. */
function PhaseBar({ p, max }: { p: Phases; max: number }) {
  const w = (n: number) => `${(n / Math.max(1, max)) * 100}%`;
  return (
    <span class="jl-bar" role="img" aria-label={`waiting ${Math.round(p.wait)}s, running ${Math.round(p.run)}s, collecting ${Math.round(p.collect)}s`}>
      {PHASES.map(([k]) => p[k] > 0 && <i key={k} class={`jl-${k}`} style={{ width: w(p[k]) }} />)}
    </span>
  );
}

function Legend() {
  return <div class="alm-legend">{PHASES.map(([k, name, hint]) => <span key={k} title={hint}><i class={`dot jl-${k}`} /> {name}</span>)}</div>;
}

const totalOf = (a: Agg): Phases => ({ wait: a.wait, run: a.run, collect: a.collect, total: a.wait + a.run + a.collect });

/** Go to the almanac page of a kind of job. */
function AlmanacLink({ type }: { type: string }) {
  if (!dexEntry(type)) return null;
  return (
    <button class="jl-alm" title={`Open the almanac page for ${nameOf(type)}: what it leans on and how to do it better`} onClick={() => { closeLog(); openAlmanacFor(type); }}>
      <Icon name="layers" size={12} /> Almanac
    </button>
  );
}

/** The share of the run's cycles each stall took: where the machine's time went while it was running. */
function Stalls({ a }: { a: Agg }) {
  if (!a.win || a.win.cycles <= 0) return null;
  const sh = stallShares(a.win);
  const useful = a.win.retired > 0 ? a.win.retired / a.win.cycles : 0;
  return (
    <div class="alm-rely jl-stalls">
      {sh.map((c) => (
        <div key={c.key} class="row"><span class="n">{c.label}</span><span class="b"><i style={{ width: pct(c.share) }} /></span><span class="v">{pct(c.share)}</span></div>
      ))}
      <div class="row" title="Cycles that finished an instruction, out of all cycles (1.0 is the best a simple pipeline can do)"><span class="n">Instructions per cycle</span><span class="b"><i style={{ width: pct(Math.min(1, useful)) }} /></span><span class="v">{fmtNum(useful, 2)}</span></div>
    </div>
  );
}

function Macro({ list }: { list: JobLogEntry[] }) {
  const all = aggregate(list), kinds = byKind(list);
  const maxAvg = Math.max(1, ...kinds.map((k) => k.wait + k.run + k.collect));
  const lost = list.filter((e) => e.outcome !== 'done').length;
  if (all.n === 0) return <p class="mute">No job has been finished yet, so there is nothing to compare. {lost > 0 ? `${lost} were taken back or declined.` : ''}</p>;
  return (
    <div class="jl-macro">
      <h3>Where the time goes</h3>
      <PhaseBar p={totalOf(all)} max={all.wait + all.run + all.collect} />
      <Legend />
      <p><b>{all.verdict.text}</b></p>
      {all.verdict.hint && <p class="mute">{all.verdict.hint}</p>}
      {all.win && all.win.cycles > 0 && (
        <>
          <h4>While jobs run: what the cycles were spent on</h4>
          <Stalls a={all} />
        </>
      )}
      <h4>Kinds of job, the ones that cost the most time first</h4>
      <div class="jl-kinds">
        {kinds.map((k) => {
          const t = totalOf(k);
          return (
            <div key={k.type} class="jl-kind">
              <div class="top">
                <span class="n">{nameOf(k.type)} <span class="mute">x{k.n}{k.lost > 0 ? `, ${k.lost} lost` : ''}{k.late > 0 ? `, ${k.late} late` : ''}</span></span>
                <PhaseBar p={t} max={maxAvg} />
                <span class="v">{k.n ? fmtTicks(t.total) : '-'}</span>
                <AlmanacLink type={k.type} />
              </div>
              {k.n > 0 ? <div class="why">{k.verdict.text} <span class="mute">{k.verdict.hint}</span></div> : <div class="why mute">Never finished: it was taken back or declined.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One job: its three phases, the reading, a line about the run, and the way to its almanac page. */
function Detail({ e }: { e: JobLogEntry }) {
  const p = phasesOf(e), v = verdictOf(e), w = e.win;
  const max = Math.max(1, p.total);
  const how = e.outcome === 'done' ? `paid ${fmtMoney(e.payout)}${e.late ? ', late' : ''}` : e.outcome === 'expired' ? 'taken back by the client' : 'declined';
  return (
    <div class="jl-detail">
      <h3>#{e.id} {nameOf(e.type)} <span class="mute">{how}</span></h3>
      <p><button class="link" onClick={() => { picked.value = null; }}>back to the overview</button> <AlmanacLink type={e.type} /></p>
      {e.outcome === 'done' && (
        <div class="jl-phases">
          {PHASES.map(([k, name, hint]) => (
            <div key={k} class="row" title={hint}>
              <span class="n">{name}</span>
              <span class="b"><i class={`jl-${k}`} style={{ width: pct(p[k] / max) }} /></span>
              <span class="v">{fmtTicks(p[k])}</span>
            </div>
          ))}
        </div>
      )}
      <p><b>{v.text}</b></p>
      {v.hint && <p class="mute">{v.hint}</p>}
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
          <button class="close" aria-label="Close job log" title="Close (Esc)" onClick={closeLog}><Icon name="close" size={12} /></button>
        </header>
        {all.length === 0 ? (
          <p class="mute jl-empty">No job has ended yet. Finish, decline or miss one and it appears here with where its time went.</p>
        ) : (
          <div class="alm-body">
            <div class="jl-left">
              <div class="jl-ctl">
                <div class="jl-filter" role="group" aria-label="Order">
                  <button class={order.value === 'new' ? 'on' : ''} aria-pressed={order.value === 'new'} onClick={() => { order.value = 'new'; }}>Newest</button>
                  <button class={order.value === 'slow' ? 'on' : ''} aria-pressed={order.value === 'slow'} onClick={() => { order.value = 'slow'; }}>Slowest</button>
                </div>
              </div>
              <div class="jl-list" role="listbox" aria-label="Jobs">
                {rows.map((e) => {
                  const p = phasesOf(e);
                  return (
                    <button key={e.id} role="option" aria-selected={sel?.id === e.id} class={`jl-row ${sel?.id === e.id ? 'on' : ''} ${e.outcome !== 'done' ? 'off' : ''}`} onClick={() => { picked.value = e.id; }}>
                      <span class="nm">{nameOf(e.type)}</span>
                      <PhaseBar p={p} max={maxTotal} />
                      <span class="tm">{fmtTicks(p.total)}</span>
                      <span class={`tg ${e.late || e.outcome === 'expired' ? 'warn' : ''}`}>{e.outcome === 'expired' ? 'taken back' : e.outcome === 'declined' ? 'declined' : e.late ? 'late' : ''}</span>
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

