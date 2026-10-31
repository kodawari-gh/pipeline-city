// The Trace panel: the engine's event log as lines (interrupts, address-space switches, page faults, TLB walks, memory, DRAM rows, cache and register writes),
// with step buttons for the paused machine. Meant for watching what the OS and the CPU do, and for spotting what looks wrong (docs/render/live.md "Following the machine").
import { signal } from '@preact/signals';
import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { setSpeed, snapshot, speed, stepCycles, stepGpu, stepTick, viewCore } from '@/app/store';
import { scrubCursor, scrubRange, scrubShown, scrubTarget, selectScrub, traceOpen } from '@/app/scrub';
import { memoryTable, sizeText } from '../../memory/render/ramlayout';
import { CoreRateTracker } from '../render/core/corestats';
import { tileModels } from '../render/core/coretiles';
import { isDark } from '@/core/render/theme';
import { gpuListing } from '../../gpu/sim/gpucode';
import { Icon } from '@/core/ui/kit/Icons';
import { gpuLines, TraceBuffer, type GpuGroup, type TraceGroup } from './trace';

export { traceOpen };
export const toggleTrace = () => { traceOpen.value = !traceOpen.value; };

const GROUPS: { id: TraceGroup; label: string; title: string }[] = [
  { id: 'os', label: 'OS', title: 'Interrupts, returns and address-space switches' },
  { id: 'tlb', label: 'TLB', title: 'Translations: hits, walks and page faults' },
  { id: 'mem', label: 'Mem', title: 'Loads and stores' },
  { id: 'dram', label: 'DRAM', title: 'Row hits, opens, conflicts and refresh' },
  { id: 'cache', label: 'Cache', title: 'Cache hits and fills' },
  { id: 'reg', label: 'Reg', title: 'Register writes' },
  { id: 'pred', label: 'Pred', title: 'Branch predictor updates' },
];

const GPU_GROUPS: { id: GpuGroup; label: string; title: string }[] = [
  { id: 'launch', label: 'Launch', title: 'The launch and the end of the kernel' },
  { id: 'mask', label: 'Mask', title: 'Mask changes and branches' },
  { id: 'mem', label: 'Mem', title: 'Loads and stores, with their bank loads' },
  { id: 'reg', label: 'Reg', title: 'Arithmetic that writes a vector register' },
  { id: 'sched', label: 'Sched', title: 'Which warp the scheduler issues, and stalls' },
];

const buffer = new TraceBuffer(500);
/** Per-core rates between the snapshots (a render without a new snapshot leaves them as they are). */
const coreRates = new CoreRateTracker();
const gpuShown = signal<Set<GpuGroup>>(new Set<GpuGroup>(['launch', 'mask', 'mem', 'reg', 'sched']));
/** The card's side shows the kernel in its memory instead of the steps. */
const kernelShown = signal(false);
const shown = signal<Set<TraceGroup>>(new Set<TraceGroup>(['os', 'tlb', 'dram']));
const rev = signal(0);

/** Pause, then run the machine (the sim only steps a paused game). */
const stepBy = (cycles: number) => {
  if (speed.value !== 0) setSpeed(0);
  scrubCursor.value = null;
  const t = scrubTarget.peek();
  if (t === 'cpu') stepCycles(cycles); else stepGpu(t.slice(4), cycles);
};
const stepOneTick = () => { if (speed.value !== 0) setSpeed(0); scrubCursor.value = null; stepTick(); };
/** Move the paused die to a cycle of its history (clamped to what it holds). */
const goTo = (c: number) => { const r = scrubRange.peek(); if (!r) return; scrubCursor.value = Math.max(r.lo, Math.min(r.hi, Math.round(c))); };

export function TracePanel() {
  const s = snapshot.value;
  const box = useRef<HTMLDivElement>(null);
  const events = s?.pipe?.stored?.events;
  useEffect(() => {
    if (!traceOpen.value) return;
    if (!events) { buffer.clear(); rev.value++; return; }
    if (buffer.add(events)) rev.value++;
  }, [events, traceOpen.value]);
  useEffect(() => { const e = box.current; if (e) e.scrollTop = e.scrollHeight; }, [rev.value, traceOpen.value]);
  useEffect(() => { if (speed.value !== 0) scrubCursor.value = null; }, [speed.value]); // running again: follow the machine
  if (!traceOpen.value) return null;
  const on = shown.value;
  const range = scrubRange.value, at = scrubShown.value, paused = speed.value === 0;
  const mt = s?.ram ? memoryTable(s.ram.regions, s.ram.bytes) : null;
  const progs = (s?.os?.queue ?? []).filter((j) => j.state === 'running').map((j) => { const p = mt?.procs.find((x) => x.owner === j.keyId); return { label: j.label, image: p?.image ?? 0, claimed: p?.claimed ?? 0 }; });
  const tiles = s?.cores ? tileModels(s.cores, isDark(), coreRates.update(s.cores.stats)) : [];
  const cards = s?.gpus ?? [], target = scrubTarget.value, card = target === 'cpu' ? undefined : cards.find((c) => `gpu:${c.slot}` === target);
  if (target !== 'cpu' && !card && cards.length === 0) selectScrub('cpu'); // the card is gone
  const gOn = gpuShown.value;
  const gLines = card ? gpuLines(card.trace, card.launches).filter((l) => gOn.has(l.group)) : [];
  const lines = buffer.lines.filter((l) => on.has(l.group));
  const kernel = card && kernelShown.value ? gpuListing(card.code ?? []) : [];
  const gToggle = (g: GpuGroup) => { const n = new Set(gOn); if (n.has(g)) n.delete(g); else n.add(g); gpuShown.value = n; };
  const toggle = (g: TraceGroup) => { const n = new Set(on); if (n.has(g)) n.delete(g); else n.add(g); shown.value = n; };
  return (
    <aside class="dock tracedock" aria-label="Trace">
      <button class="close" aria-label="Close trace" onClick={toggleTrace}><Icon name="close" size={11} /></button>
      <div class="trace-head"><b>Trace</b><span class="mute"> cycle {s?.cycle ?? 0}</span></div>
      {(s?.health?.length ?? 0) > 0 && <div class="trace-health" aria-label="Health">{s!.health!.map((h, i) => <div key={i} class={`th th-${h.level}`}>{h.level === 'ok' ? 'ok' : h.level === 'warn' ? '!' : 'BAD'} {h.text}</div>)}</div>}
      {progs.length > 0 && <div class="trace-progs" aria-label="Programs">{progs.map((p) => <div key={p.label} class="tp"><span>{p.label}</span><span class="mute">image {sizeText(p.image)}, data {sizeText(p.claimed)}</span></div>)}</div>}
      {tiles.length > 0 && (
        <div class="trace-cores" role="group" aria-label="Core shown in the detail">
          {tiles.map((t) => (
            <button key={t.core} class={`tcore${t.parked && !t.tint ? ' idle' : ''}`} aria-pressed={t.selected}
              style={{ '--core': t.color, ...(t.tint ? { borderTopColor: t.tint, borderRightColor: t.tint, borderBottomColor: t.tint, background: `color-mix(in srgb, ${t.tint} 22%, transparent)` } : {}) }}
              title={`Show core ${t.core} in the die detail (hardware core ${t.hw}). ${t.ipc.toFixed(2)} instructions per cycle, ${Math.round(t.stall * 100)}% of the cycles lost to stalls.`} onClick={() => viewCore(t.core)}>
              <b>{t.label}</b> <span class="mute">{t.sub}</span>
              <span class="tcells" aria-hidden="true">{t.cells.map((c, i) => <i key={i} class={`tc-${c ?? 'none'}`} />)}</span>
              <span class="trate mute">{t.parked && !t.tint ? 'zz' : `${t.ipc.toFixed(2)} IPC · ${Math.round(t.stall * 100)}% stall`}</span>
            </button>
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <div class="trace-cores" role="group" aria-label="What the steps and the scrubber move">
          <button class="tcore" aria-pressed={!card} title="Step and scrub the CPU die" onClick={() => selectScrub('cpu')}><b>CPU</b></button>
          {cards.map((c) => <button key={c.slot} class="tcore" aria-pressed={card?.slot === c.slot} title={`Step and scrub the card in ${c.slot} (${c.lanes} lanes)`} onClick={() => selectScrub(`gpu:${c.slot}`)}><b>{c.slot}</b> <span class="mute">{c.phase}</span></button>)}
        </div>
      )}
      <div class="trace-steps" role="group" aria-label="Step the paused machine">
        <button title={card ? 'Run one cycle of the card (pauses the game first). A card with nothing running first runs the machine until the CPU launches a kernel on it.' : 'Run one CPU cycle (pauses the game first)'} onClick={() => stepBy(1)}>+1 cycle</button>
        <button title={card ? 'Run 10 cycles of the card' : 'Run 10 CPU cycles'} onClick={() => stepBy(10)}>+10</button>
        <button title={card ? 'Run 100 cycles of the card' : 'Run 100 CPU cycles'} onClick={() => stepBy(100)}>+100</button>
        <button title="Run one base tick" onClick={stepOneTick}>+1 tick</button>
        <button title="Clear the trace" onClick={() => { buffer.clear(); rev.value++; }}>clear</button>
      </div>
      {paused && range && (
        <div class="trace-scrub" role="group" aria-label="Move the die to a cycle">
          <button title="One cycle back" disabled={at <= range.lo} onClick={() => goTo(at - 1)}>&#9664;</button>
          <input type="range" aria-label="Cycle" min={range.lo} max={range.hi} value={at < 0 ? range.hi : at} onInput={(e) => goTo(Number((e.currentTarget as HTMLInputElement).value))} />
          <button title="One cycle forward" disabled={at >= range.hi} onClick={() => goTo(at + 1)}>&#9654;</button>
          <span class="mute">{card ? `${card.slot} at cycle ${at}` : `die at cycle ${at}`}</span>
        </div>
      )}
      {card ? (
        <>
          <div class="trace-filter" role="group" aria-label="Show">
            {GPU_GROUPS.map((g) => <button key={g.id} class={gOn.has(g.id) ? 'on' : ''} aria-pressed={gOn.has(g.id)} title={g.title} disabled={kernelShown.value} onClick={() => gToggle(g.id)}>{g.label}</button>)}
            <button class={kernelShown.value ? 'on' : ''} aria-pressed={kernelShown.value} title="The kernel in the card's memory, word by word, with the instruction the card is at marked" onClick={() => { kernelShown.value = !kernelShown.value; }}>Kernel</button>
          </div>
          {kernelShown.value && (
            <div class="trace-lines trace-kernel" aria-label="Kernel in card memory">
              {kernel.length === 0 && <div class="mute">No kernel in card memory yet. The CPU copies it in before a launch.</div>}
              {kernel.map((l) => (
                <Fragment key={l.addr}>
                  {l.labels.map((n) => <div key={n} class="tl tl-lbl">{n}:</div>)}
                  <div class={`tl tl-k-${l.cls}${l.addr === card!.pc && card!.phase !== 'idle' ? ' now' : ''}`}><span class="tc">{l.addr.toString(16).padStart(4, '0')}</span> {l.text}</div>
                </Fragment>
              ))}
            </div>
          )}
          {!kernelShown.value && <div class="trace-lines">
            {gLines.length === 0 && <div class="mute">Nothing yet. The card has not run a kernel since power-on.</div>}
            {gLines.map((l, i) => <div key={i} class={`tl tl-${l.group}${paused && l.cycle === at ? ' now' : ''}`} title={paused ? 'Show the card at this cycle' : undefined} onClick={paused ? () => goTo(l.cycle) : undefined}><span class="tc">{l.cycle}</span> {l.text}</div>)}
          </div>}
        </>
      ) : <>
      <div class="trace-filter" role="group" aria-label="Show">
        {GROUPS.map((g) => <button key={g.id} class={on.has(g.id) ? 'on' : ''} aria-pressed={on.has(g.id)} title={g.title} onClick={() => toggle(g.id)}>{g.label}</button>)}
      </div>
      <div class="trace-lines" ref={box}>
        {lines.length === 0 && <div class="mute">Nothing yet. Pause and step, or run: events appear as the CPU does them.</div>}
        {lines.map((l, i) => <div key={i} class={`tl tl-${l.group}${paused && l.cycle === at ? ' now' : ''}`} title={paused ? 'Show the die at this cycle' : undefined} onClick={paused ? () => goTo(l.cycle) : undefined}><span class="tc">{l.cycle}</span> {l.text}</div>)}
      </div>
      </>}
    </aside>
  );
}
