import { useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { OS_SPECS, programSlotsOn, threadsOn, type OsSpec } from '@/features/os/sim/specs';
import { fmtBytes, resourceRows } from '@/features/os/ui/osui';
import { OS_TABS, OsBody, sampleHistory, type OsActions, type OsHistory, type OsTab } from '@/features/os/ui/OsViews';
import { RunControls } from './BuildBars';

type Stage = import('../render/three/buildmode3d').BuildStage;
type Tab = 'choose' | Exclude<OsTab, 'apps'>;

const TABS: { id: Tab; label: string }[] = [{ id: 'choose', label: 'Choose the OS' }, ...OS_TABS.filter((t) => t.id !== 'apps').map((t) => ({ id: t.id as Tab, label: t.label }))];

/** The cores an OS puts to work on this CPU: the resident OS one, the paged OS up to two hardware cores, the others every logical core. */
const coresUsed = (o: OsSpec, hardware: number, logical: number): number => (o.tier === 1 ? 1 : o.tier === 2 ? Math.min(2, hardware) : logical);

/**
 * The OS sheet: the game's OS window (Performance, Processes, Disk allocation) on the machine that runs on the stage, and the page to choose the OS. The OS is what decides
 * what the cores do: the page says it for each one on this processor, and the benchmark's High-performance tasks measure it. It redraws as the machine runs.
 */
export function BuildOs({ stage, onClose, onBench }: { stage: Stage; onClose: () => void; onBench: () => void }) {
  // (the sheet follows the machine: a tick, a change of phase, an edit)
  void stage.ticks.value; void stage.state.value;
  const st = stage.status.value, s = stage.snapshot, busy = st.busy, refusal = stage.refusal.value?.text ?? null;
  const [tab, setTab] = useState<Tab>(() => (s.os ? 'monitor' : 'choose'));
  const history = useRef<OsHistory>(new Map());
  // the graphs take a sample for each simulated second that went by (a tick is a second at 1x)
  const sampled = useRef(stage.simulated);
  const act = useMemo<OsActions>(() => ({
    formatDrive: (id) => stage.osDo('Cannot format the drive', (g) => g.formatDrive(id)),
    setSpoolAlloc: (id, n) => stage.osDo('Cannot set the spool', (g) => g.setSpoolAlloc(id, n)),
    setDataReserve: (id, b) => stage.osDo('Cannot set the reserve', (g) => g.setDataReserve(id, b)),
  }), [stage]);
  const ran = stage.simulated;
  if (ran !== sampled.current || history.current.size === 0) { sampleHistory(history.current, resourceRows(s), Math.max(1, ran - sampled.current)); sampled.current = ran; }
  const tabNow: Tab = !s.os && tab !== 'choose' ? 'choose' : tab;

  return (
    <>
      <div class="bench-scrim os-scrim" aria-hidden="true" onClick={onClose} />
      <section class="bench mode-panel ospanel bld-os-sheet" aria-label="Operating system">
        <header class="bench-head">
          <div class="mode-head"><span class="mode-eyebrow">The system the machine runs</span><b>{s.os ? s.os.name : 'Operating system'}</b></div>
          <div class="mode-bar bld-run bld-run-sheet" role="toolbar" aria-label="Run the machine"><RunControls stage={stage} busy={busy} bare={stage.shown.value !== 'machine'} /></div>
          <button class="bench-close" aria-label="Close the OS sheet" title="Close (Esc)" onClick={onClose}><Icon name="close" size={12} /></button>
        </header>

        <div class="bench-tabs os-sheet-tabs" role="tablist" aria-label="Pages of the OS">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tabNow === t.id} class={tabNow === t.id ? 'on' : ''} disabled={!s.os && t.id !== 'choose'} title={!s.os && t.id !== 'choose' ? 'Choose an OS first' : undefined} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div class="os-body os-sheet-body">
          {tabNow === 'choose' ? <Choose stage={stage} busy={busy} /> : s.os && <OsBody tab={tabNow} s={s} act={act} history={history.current} />}
        </div>

        <footer class="bench-foot">
          {refusal
            ? <span class="mode-hint bench-note os-refused" role="alert"><Icon name="warn" size={11} /> {refusal}</span>
            : <span class="mode-hint bench-note">Fitting another OS switches the machine off. The benchmark's High-performance tasks need the multicore OS and two or more logical cores.</span>}
          <button class="bench-all" onClick={onBench}><Icon name="gauge" size={12} />Benchmark</button>
        </footer>
      </section>
    </>
  );
}

/** The page to choose the OS: the processor, then each OS with what it does with its cores. */
function Choose({ stage, busy }: { stage: Stage; busy: boolean }) {
  const s = stage.snapshot, now = s.os?.spec ?? null, cpu = s.devices.find((d) => d.kind === 'cpu');
  const { hardware, logical } = stage.cpuCores;
  return (
    <section class="os-wide os-choose">
      <p class="os-lede">
        {cpu ? <><b>{cpu.name}</b>: {hardware} core{hardware === 1 ? '' : 's'}{logical !== hardware ? `, ${logical} logical cores` : ''}.</> : <b>There is no processor yet.</b>}{' '}
        One job runs on one core. The OS decides how many jobs run side by side, and only the multicore OS can spread one job over several cores, and only a threaded one (the high-performance jobs).
      </p>
      <ul class="os-ladder">
        {OS_SPECS.filter((o) => !o.later).map((o) => {
          const on = now === o.id, n = programSlotsOn(o, hardware, logical), used = coresUsed(o, hardware, logical), threads = threadsOn(o, logical);
          return (
            <li key={o.id} class={`os-card ${on ? 'on' : ''}`}>
              <div class="os-card-head"><b>{o.name}</b>{on && <em>installed</em>}</div>
              <p class="mute sub">{o.description}</p>
              <dl class="os-facts">
                <div title="Programs the OS runs at once: on one core they take turns"><dt>Programs at once</dt><dd>{n}</dd></div>
                <div title="Cores the OS puts to work on this processor"><dt>Cores at work</dt><dd>{used} of {logical}</dd></div>
                <div title="A threaded job (the high-performance ones) runs on several cores at once only on the multicore OS"><dt>One job, many cores</dt><dd class={threads ? 'yes' : 'no'}>{threads ? 'yes' : 'no'}</dd></div>
              </dl>
              <p class="os-needs">Needs {fmtBytes(o.minRamBytes)} of RAM, {fmtBytes(o.diskBytes)} of disk{o.needsMmu ? ' and a CPU with an MMU' : ''}.</p>
              {on
                ? <button class="os-act" disabled={busy} onClick={() => { void stage.removeNet('os'); }}>Take it out</button>
                : <button class="os-act primary" disabled={busy} onClick={() => { void stage.fit(o.id); }}>{now ? 'Replace with this' : 'Install'}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
