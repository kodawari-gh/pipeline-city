import { airflowLens, powerLens } from '@/app/hover';
import { openSettings } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { fullDrawW } from '@/features/board/sim/compat';
import { OFF, RUN_SPEEDS } from '@/features/board/sim/buildrun';
import { specSheet } from '@/features/board/sim/buildspecs';
import { playCue } from '@/app/audio/engine';
import { overallOfRuns } from './benchhud';
import { pillOf, powerMeter } from './buildhud';

type Stage = import('../render/three/buildmode3d').BuildStage;
/** The phone's panes: the parts shelf, the machine tab, the run and tools bars. */
export type BuildPane = 'parts' | 'machine' | 'run';

const SPEEDS = [0.5, 1, 2, 4];
const VIEWS = ['front', 'angle', 'side', 'top', 'wall'] as const;
const PANES: readonly [BuildPane, string][] = [['parts', 'Parts'], ['machine', 'Machine'], ['run', 'Run']];
const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/**
 * The summary over the stage: can it start and will it run well (the pill: green, amber or red, with the problem in words; the list is in the right panel,
 * `BuildAlerts`), what it costs, what it draws against its supply (the bar is full load over the supply's rating, green to red), how many parts, and the
 * benchmark (its button opens the benchmark screen). From the part tables and the game's static checks; the machine is not run here. `rev` draws it again
 * on a change.
 */
export function Readout({ stage, rev }: { stage: Stage; rev: number | undefined }) {
  void rev;
  const s = stage.snapshot, shown = stage.shown.value, bare = shown !== 'machine';
  // (the draw is the machine's own, the one the supply alert quotes: it counts what the regulators waste, which the part list's watts do not)
  const sheet = specSheet({ boardTier: s.boardTier, caseTier: s.caseTier, specs: stage.board.devices.map((d) => d.spec), shown, drawW: bare ? undefined : fullDrawW(stage.board) });
  const status = pillOf(stage.alerts, shown), meter = powerMeter(sheet), over = meter.tone === 'bad';
  const short = sheet.psuW && sheet.loadW > sheet.psuW ? sheet.loadW - sheet.psuW : 0;
  return (
    <section class="bld-read mode-bar" aria-label="Build summary">
      <span class={`bld-ready ${status.tone}`} role={status.tone === 'bad' ? 'alert' : 'status'} title={status.title}>
        <Icon name={status.tone === 'ok' ? 'check' : 'warn'} size={13} />{status.label}
      </span>
      <i class="mode-sep" aria-hidden="true" />
      <span class="bld-fig" title="List price of the case, the board and every part"><b>{money(sheet.budget)}</b><em>Budget</em></span>
      <span class={`bld-fig bld-power ${meter.tone}`} title={sheet.psuW ? `Idle to full load, against the ${sheet.psuW} W supply: ${meter.pct}% at full load.${over ? ' The supply is too small: the machine slows down or trips.' : ''}` : shown === 'nothing' ? 'There is no case yet.' : bare ? 'There is no board to draw power yet.' : 'No power supply is fitted.'}>
        <b>{bare ? '— W' : `${sheet.idleW}–${sheet.loadW} W`}</b>
        <em>{sheet.psuW ? (over ? (short ? `${short} W short` : `over ${sheet.psuW} W`) : `of ${sheet.psuW} W`) : shown === 'nothing' ? 'no case' : bare ? 'no board' : 'no supply'}</em>
        <span class="bld-meter" role="img" aria-label={`Full load is ${meter.pct}% of the supply`}><i style={{ width: `${meter.pct}%` }} /></span>
      </span>
      <span class="bld-fig" title={shown === 'nothing' ? 'Nothing is on the stage yet' : bare ? 'The case counts as one' : 'The case and the board count as one each'}><b>{sheet.parts}</b><em>Parts</em></span>
    </section>
  );
}

/**
 * The lens tab: the overlays on the machine (the game's P and A), Graphics (its settings, SPEC 5.7), and the benchmark, which opens its screen. Its label shows the score once it is known.
 */
export function ViewOptions({ ready, stage, onBench }: { ready: boolean; stage: Stage | null; onBench: () => void }) {
  const score = overallOfRuns(stage?.bench.value ?? {}, {}), running = stage?.benching.value;
  return (
    <div class="mode-bar bld-lens" role="toolbar" aria-label="View options">
      <button class={powerLens.value ? 'on' : ''} aria-pressed={powerLens.value} disabled={!ready} title="Power view (P)" onClick={() => { powerLens.value = !powerLens.value; }}><Icon name="bolt" size={12} />Power</button>
      <button class={airflowLens.value ? 'on' : ''} aria-pressed={airflowLens.value} disabled={!ready} title="Airflow view (A)" onClick={() => { airflowLens.value = !airflowLens.value; }}><Icon name="wind" size={12} />Airflow</button>
      <button class="bld-gfx" aria-haspopup="dialog" title="Picture, light and detail settings" onClick={() => openSettings('studio')}><Icon name="sliders" size={12} />Graphics</button>
      <i class="mode-sep" aria-hidden="true" />
      <button class="bld-bench-btn" aria-haspopup="dialog" title="Run the almanac's jobs on this machine and score them: one, a set, or all. 1000 is par." onClick={onBench}>
        <Icon name="gauge" size={13} />{running ? (running.total ? `Running ${running.n}/${running.total}` : 'Running…') : score.n ? <>Score <b>{score.overall}</b></> : 'Benchmark'}
      </button>
    </div>
  );
}

/** "Resident OS 1.0" as the button says it: "Resident 1.0". */
const shortOs = (name: string): string => name.replace(' OS ', ' ');

/**
 * The machine's life: the power button, what it is doing (the chip), how fast it runs (the game's own speed, a tick a second at 1x) and the OS sheet. The
 * button works as the game's does: a hard switch, off to on needs a supply with its main cable. `bare`: there is no board to switch on.
 */
export function RunControls({ stage, busy, bare }: { stage: Stage | null; busy: boolean; bare: boolean }) {
  const run = stage?.state.value ?? OFF, speed = stage?.simSpeed.value;
  return (
    <>
      <button class={`bld-pow ${run.on ? 'on' : 'primary'}`} aria-pressed={run.on} disabled={!stage || bare || (busy && run.on)} data-cue="silent"
        title={bare ? 'There is no machine to switch on: fit a case, a board and its parts' : run.on ? 'Switch the machine off. A job that runs is lost, as in the game.' : busy ? 'A step is playing: this skips it (Space). Then switch the machine on.' : 'Switch the machine on (it needs a power supply with its main cable). It boots, then runs at the speed beside it.'}
        onClick={() => { if (busy && !run.on) stage?.skip(); else stage?.power(); }}>
        <Icon name="power" size={13} />{run.on ? 'Power off' : 'Power on'}
      </button>
      <span class={`bld-chip ${run.tone}`} role="status" aria-live="polite" title={run.why ?? run.text}><i aria-hidden="true" />{run.text}</span>
      <div class="seg" role="group" aria-label="Speed of the machine" title="How fast the machine runs: 1x is the game's own speed, a tick a second">
        {RUN_SPEEDS.map((x) => <button key={x} class={speed === x ? 'on' : ''} aria-pressed={speed === x} disabled={!run.on} data-cue="silent" onClick={() => { if (!stage) return; const cur = stage.simSpeed.peek(); if (x !== cur) playCue(x > cur ? 'speed_up' : 'speed_down'); stage.simSpeed.value = x; }}>{x}x</button>)}
      </div>
    </>
  );
}

function RunBar({ stage, busy, bare, onOs }: { stage: Stage | null; busy: boolean; bare: boolean; onOs: () => void }) {
  const os = stage && !bare ? stage.snapshot.os?.name ?? null : null;
  return (
    <div class="mode-bar bld-run" role="toolbar" aria-label="Run the machine">
      <RunControls stage={stage} busy={busy} bare={bare} />
      <i class="mode-sep" aria-hidden="true" />
      <button class="bld-os" aria-haspopup="dialog" disabled={!stage || bare} title="The operating system: install another one, watch what it does with the cores" onClick={onOs}>
        <Icon name="cpu" size={13} />OS<em>{os ? shortOs(os) : 'none'}</em>
      </button>
    </div>
  );
}

/**
 * The bottom: the one line that says what to do now (or the step that plays, with its Skip), then three bars: the machine's life (power, speed, the OS), the
 * machine (the side panel, undo and redo, the speed of the steps) and the camera (the views, and the picked part).
 */
export function Foot({ stage, hint, undo, warn, onOs, pane, onPane }: {
  stage: Stage | null;
  hint: string;
  /** Set while the hint says what a start just did: puts the old machine back. */
  undo?: () => void;
  /** Set while the hint is a refusal (it shows amber): lets it go. */
  warn?: () => void;
  /** Opens the OS sheet. */
  onOs: () => void;
  /** Phone only: the pane that shows. */
  pane: BuildPane;
  onPane: (p: BuildPane) => void;
}) {
  const st = stage?.status.value;
  const busy = !!st?.busy, open = stage?.open.value ?? false, picked = stage?.selected.value ?? null, speed = stage?.speed.value, noCase = stage?.shown.value === 'nothing';
  return (
    <div class="bld-foot">
      <div class={`bld-hint ${busy ? 'busy' : ''} ${undo ? 'did' : ''} ${warn ? 'warn' : ''}`} role={warn ? 'alert' : undefined} aria-live="polite">
        <i aria-hidden="true" /><span>{hint}</span>
        {busy && <button title="Fast-forward the steps that play (Space)" onClick={() => stage?.skip()}><Icon name="skip" size={11} />Skip</button>}
        {undo && <button title="Put the machine that was here back (Ctrl+Z)" onClick={undo}><Icon name="undo" size={11} />Undo</button>}
        {warn && <button class="bld-x" aria-label="Dismiss" title="Dismiss" onClick={warn}><Icon name="close" size={10} /></button>}
      </div>
      <div class="bld-dock">
        <div class="mode-bar bld-panes" role="tablist" aria-label="Pane">
          {PANES.map(([k, label]) => <button key={k} role="tab" aria-selected={pane === k} class={pane === k ? 'on' : ''} onClick={() => onPane(k)}>{label}</button>)}
        </div>
        <RunBar stage={stage} busy={busy} bare={!stage || stage.shown.value !== 'machine'} onOs={onOs} />
        <div class="mode-bar bld-tools" role="toolbar" aria-label="Machine">
          <button class={`bld-door ${open ? 'on' : ''}`} aria-pressed={open} disabled={busy || !stage || noCase} title={noCase ? 'There is no case yet: pick one from the shelf' : 'Open or shut the side panel (O): the parts inside are only in reach with it open'} onClick={() => stage?.openInside(!open)}>
            <Icon name="panel" size={13} />Side panel<em>{open ? 'open' : 'shut'}</em>
          </button>
          <i class="mode-sep" aria-hidden="true" />
          <button class="bld-ico" disabled={busy || !stage?.canUndo} title="Undo the last fit or removal (Ctrl+Z)" aria-label="Undo" onClick={() => stage?.undo()}><Icon name="undo" size={14} /></button>
          <button class="bld-ico" disabled={busy || !stage?.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo" onClick={() => stage?.redo()}><Icon name="redo" size={14} /></button>
          <i class="mode-sep" aria-hidden="true" />
          <div class="seg" role="group" aria-label="Speed of the steps">
            {SPEEDS.map((x) => <button key={x} class={speed === x ? 'on' : ''} aria-pressed={speed === x} onClick={() => { if (stage) stage.speed.value = x; }}>{x}x</button>)}
          </div>
        </div>
        <div class="mode-bar bld-views" role="toolbar" aria-label="Camera">
          <div class="seg" role="group" aria-label="View">
            {VIEWS.map((v) => <button key={v} disabled={!stage} onClick={() => stage?.preset(v)}>{v[0]!.toUpperCase() + v.slice(1)}</button>)}
          </div>
          <button disabled={!stage || !picked} title="Fly to the picked part (F)" onClick={() => { if (picked) stage?.focusDevice(picked); }}><Icon name="focus" size={13} />Focus</button>
        </div>
      </div>
    </div>
  );
}
