// The job log: a modal like the almanac and the shop that lists the jobs that ended with where each one's time went (waiting for the machine,
// running on it, the result waiting to be collected), and for a run what the machine spent its cycles on (docs/JOBS.md "The log").
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '../game/store';
import { dexEntry } from '../sim/game/jobdex';
import { phasesOf, summarise, verdictOf, type JobLogEntry, type Phases } from '../sim/game/joblog';
import { Icon } from './Icons';
import { cacheHitRate, fmtNum, fmtMoney, fmtTicks, STALL_CAUSES } from './logic';

export const logOpen = signal(false);
export const toggleLog = () => { logOpen.value = !logOpen.value; };
export const closeLog = () => { logOpen.value = false; };
const picked = signal<number | null>(null);
const filter = signal<string>('all');
const order = signal<'new' | 'slow'>('new');

const nameOf = (type: string) => dexEntry(type)?.name ?? type;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const PHASES = [
  ['wait', 'Waiting', 'the time from the job arriving until the machine took it: a busy machine, a power-off, a download'],
  ['run', 'Running', 'the time from the machine taking the job until its result was written'],
  ['collect', 'Collecting', 'the time from the result being written until the client had it'],
] as const;

/** One bar of a job's time in three parts, scaled against `max` (the longest in view) so rows compare. */
function PhaseBar({ p, max }: { p: Phases; max: number }) {
  const w = (n: number) => `${(n / Math.max(1, max)) * 100}%`;
  return (
    <span class="jl-bar" role="img" aria-label={`waited ${p.wait}s, ran ${p.run}s, collected after ${p.collect}s`}>
      {PHASES.map(([k]) => p[k] > 0 && <i key={k} class={`jl-${k}`} style={{ width: w(p[k]) }} />)}
    </span>
  );
}

function Legend() {
  return <div class="alm-legend">{PHASES.map(([k, name, hint]) => <span key={k} title={hint}><i class={`dot jl-${k}`} /> {name}</span>)}</div>;
}

function outcomeText(e: JobLogEntry): string {
  return e.outcome === 'expired' ? 'taken back' : e.outcome === 'declined' ? 'declined' : e.late ? 'late' : '';
}

function Summary({ list }: { list: JobLogEntry[] }) {
  const s = summarise(list);
  const n = Math.max(1, s.done);
  const avg: Phases = { wait: s.wait / n, run: s.run / n, collect: s.collect / n, total: (s.wait + s.run + s.collect) / n };
  const kinds = [...new Set(list.filter((e) => e.outcome === 'done').map((e) => e.type))].map((t) => {
    const of = list.filter((e) => e.type === t && e.outcome === 'done');
    const sum = summarise(of), m = Math.max(1, of.length);
    return { t, n: of.length, wait: sum.wait / m, run: sum.run / m, collect: sum.collect / m };
  }).sort((a, b) => (b.wait + b.run + b.collect) - (a.wait + a.run + a.collect));
  const worst = s.done ? PHASES.reduce((a, b) => (avg[b[0]] > avg[a[0]] ? b : a)) : null;
  const maxKind = Math.max(1, ...kinds.map((k) => k.wait + k.run + k.collect));
  return (
    <div class="jl-sum">
      <h3>Summary</h3>
      <div class="alm-chips">
        <span>{s.done} done</span>
        {s.late > 0 && <span>{s.late} late</span>}
        {s.expired > 0 && <span>{s.expired} taken back</span>}
        {s.declined > 0 && <span>{s.declined} declined</span>}
      </div>
      {worst && (
        <>
          <h4>Average job</h4>
          <PhaseBar p={avg} max={avg.total} />
          <Legend />
          <p>
            A job spends most of its time <b>{worst[1].toLowerCase()}</b> ({pct(avg[worst[0]] / Math.max(1, avg.total))} of {fmtNum(avg.total, 0)}s). {worst[1]} is {worst[2]}.
          </p>
        </>
      )}
      {kinds.length > 0 && (
        <>
          <h4>By kind of job</h4>
          <div class="jl-kinds">
            {kinds.map((k) => (
              <div key={k.t} class="jl-kind">
                <span class="n">{nameOf(k.t)} <span class="mute">x{k.n}</span></span>
                <PhaseBar p={{ wait: k.wait, run: k.run, collect: k.collect, total: k.wait + k.run + k.collect }} max={maxKind} />
                <span class="v">{fmtNum(k.wait + k.run + k.collect, 0)}s</span>
              </div>
            ))}
          </div>
        </>
      )}
      {s.slowest && <p class="mute">Slowest: <button class="link" onClick={() => { picked.value = s.slowest!.id; }}>#{s.slowest.id} {nameOf(s.slowest.type)}</button> at {fmtTicks(phasesOf(s.slowest).total)}.</p>}
      <p class="mute">Pick a job in the list for the detail. The log keeps the last 60 jobs.</p>
    </div>
  );
}

function Detail({ e, best }: { e: JobLogEntry; best: number }) {
  const p = phasesOf(e), v = verdictOf(e), w = e.win;
  const max = Math.max(1, p.total);
  const margin = e.deadline - e.end;
  return (
    <div class="jl-detail">
      <h3>#{e.id} {nameOf(e.type)} <span class="mute">scale {e.scale}</span> <button class="link" onClick={() => { picked.value = null; }}>back to summary</button></h3>
      <div class="alm-chips">
        <span>{e.outcome === 'done' ? 'delivered' : e.outcome === 'expired' ? 'taken back by the client' : 'declined'}</span>
        {e.outcome === 'done' && <span>paid {fmtMoney(e.payout)}</span>}
        {e.late && e.outcome === 'done' && <span>late</span>}
        {e.attempts > 1 && <span>{e.attempts} attempts</span>}
        <span>{e.os ? `OS ${e.os}` : 'no OS'}</span>
      </div>
      {e.outcome === 'done' && (
        <>
          <h4>Where the time went</h4>
          <div class="jl-phases">
            {PHASES.map(([k, name, hint]) => (
              <div key={k} class="row" title={hint}>
                <span class="n">{name}</span>
                <span class="b"><i class={`jl-${k}`} style={{ width: pct(p[k] / max) }} /></span>
                <span class="v">{fmtTicks(p[k])}</span>
              </div>
            ))}
          </div>
          <p class="mute">
            Arrived at tick {e.arrival}, taken at {e.start}, result at {e.finish}, collected at {e.end}.{' '}
            {margin >= 0 ? `${fmtTicks(margin)} before the deadline.` : `${fmtTicks(-margin)} after the deadline.`}
            {best > 0 && ` Your fastest ${nameOf(e.type)} run is ${fmtTicks(best)}; this one ran ${fmtTicks(p.run)}.`}
          </p>
        </>
      )}
      <h4>Reading</h4>
      <p>{v.text}</p>
      {v.hint && <p class="mute">{v.hint}</p>}
      {w && w.cycles > 0 && (
        <>
          <h4>The machine during the run</h4>
          <div class="alm-chips">
            <span>{w.cycles} cycles</span>
            <span>{w.retired} instructions</span>
            <span>CPI {w.retired > 0 ? fmtNum(w.cycles / w.retired, 2) : '-'}</span>
            {(() => { const h = cacheHitRate({ cacheHits: w.cacheHits, cacheMisses: w.cacheMisses }); return h === null ? null : <span>{pct(h)} cache hits</span>; })()}
            {w.tlbMisses > 0 && <span>{w.tlbMisses} TLB misses</span>}
            {w.pageFaults > 0 && <span>{w.pageFaults} page faults</span>}
          </div>
          <div class="alm-rely jl-stalls">
            {STALL_CAUSES.map((c) => {
              const val = c.key === 'stallLoad' ? w.stallLoad : c.key === 'stallData' ? w.stallData : c.key === 'stallFlush' ? w.stallFlush : c.key === 'stallStruct' ? w.stallStruct : w.stallCache;
              return (
                <div key={c.key} class="row" title={c.hint}>
                  <span class="n">{c.label}</span>
                  <span class="b"><i style={{ width: pct(val / w.cycles) }} /></span>
                  <span class="v">{pct(val / w.cycles)}</span>
                </div>
              );
            })}
          </div>
          <p class="mute">Counted for the whole machine between the job being taken and its result, so with several programs at once the numbers are shared.</p>
        </>
      )}
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
  const s = snapshot.value;
  const all = s?.jobLog ?? [];
  const types = [...new Set(all.map((e) => e.type))];
  const f = types.includes(filter.value) ? filter.value : 'all';
  const list = all.filter((e) => f === 'all' || e.type === f);
  const rows = [...list].sort(order.value === 'slow' ? (a, b) => phasesOf(b).total - phasesOf(a).total : (a, b) => b.end - a.end || b.id - a.id);
  const maxTotal = Math.max(1, ...list.map((e) => phasesOf(e).total));
  const sel = list.find((e) => e.id === picked.value) ?? null;
  const best = sel ? (s?.dex?.find((d) => d.id === sel.type)?.best ?? 0) : 0;
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeLog(); }}>
      <div class="card almanac joblog" role="dialog" aria-modal="true" aria-label="Job log">
        <header class="alm-head">
          <span class="alm-title"><Icon name="clock" size={16} /> Job log</span>
          <span class="chip">{all.length} jobs</span>
          <button class="close" aria-label="Close job log" title="Close (Esc)" onClick={closeLog}><Icon name="close" size={12} /></button>
        </header>
        {all.length === 0 ? (
          <p class="mute jl-empty">No job has ended yet. Finish, decline or miss one and it appears here with where its time went.</p>
        ) : (
          <div class="alm-body">
            <div class="jl-left">
              <div class="jl-ctl">
                <div class="jl-filter" role="group" aria-label="Kind of job">
                  {['all', ...types].map((t) => <button key={t} class={f === t ? 'on' : ''} aria-pressed={f === t} onClick={() => { filter.value = t; }}>{t === 'all' ? 'All' : nameOf(t)}</button>)}
                </div>
                <div class="jl-filter" role="group" aria-label="Order">
                  <button class={order.value === 'new' ? 'on' : ''} aria-pressed={order.value === 'new'} onClick={() => { order.value = 'new'; }}>Newest</button>
                  <button class={order.value === 'slow' ? 'on' : ''} aria-pressed={order.value === 'slow'} onClick={() => { order.value = 'slow'; }}>Slowest</button>
                </div>
              </div>
              <Legend />
              <div class="jl-list" role="listbox" aria-label="Jobs">
                {rows.map((e) => {
                  const p = phasesOf(e), tag = outcomeText(e);
                  return (
                    <button key={e.id} role="option" aria-selected={sel?.id === e.id} class={`jl-row ${sel?.id === e.id ? 'on' : ''} ${e.outcome !== 'done' ? 'off' : ''}`} onClick={() => { picked.value = e.id; }}>
                      <span class="id">#{e.id}</span>
                      <span class="nm">{nameOf(e.type)}</span>
                      <PhaseBar p={p} max={maxTotal} />
                      <span class="tm">{fmtTicks(p.total)}</span>
                      <span class={`tg ${e.late || e.outcome === 'expired' ? 'warn' : ''}`}>{tag || (e.outcome === 'done' ? fmtMoney(e.payout) : '')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div class="alm-main">{sel ? <Detail e={sel} best={best} /> : <Summary list={list} />}</div>
          </div>
        )}
      </div>
    </div>
  );
}
