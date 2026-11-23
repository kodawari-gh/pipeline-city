import { useEffect, useRef, useState } from 'preact/hooks';
import { clearQueue, repairAll, setJobClasses, setReputation, setSpeed, spawnKey, speed } from '@/app/store';
import type { Snapshot } from '@/worker/game/game';
import { JOB_CLASSES, levelDef } from '../../economy/sim/levels';
import { TEMPLATE_NAMES } from '../../jobs/sim/gen';
import { taskOfTemplate } from '../../jobs/sim/jobdex';

// The sandbox chip in the HUD bar and its tools popover (docs/SANDBOX.md). Styles are in ui.css (the sandbox section).
// Keyboard: the chip toggles the popover, Escape closes it and gives focus back to the chip.

const TEMPLATE_LABEL: Record<string, string> = {
  cli: 'mixed (log / calc / checksum)', 'cli.log': 'log', 'cli.calc': 'calc', 'cli.checksum': 'checksum', 'cli.scan': 'scan (memory heavy)',
};

const CLASS_LABEL: Record<string, string> = {
  cli: 'Command line', scan: 'Memory scan', db: 'Database', web: 'Web page', secure: 'Secure signing',
  gpu: 'GPU batch', npu: 'AI inference', hpc: 'HPC',
};
/** What a class needs of the machine, for its tooltip. */
const CLASS_NEEDS: Record<string, string> = { web: 'Needs an ISP plan', secure: 'Needs a TPM and ECC memory', hpc: 'Needs OS 4 and 2 or more cores' };

export function SandboxTools({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState('cli.log');
  const [scale, setScale] = useState(1);
  const [rep, setRep] = useState<number | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const shownRep = rep ?? s.reputation;

  // Escape closes the popover (and returns focus to its chip). Registered while it is open only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      chip.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div class="sbx">
      <button
        data-cue="ui_click" ref={chip} class={`sbx-chip ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="sbx-tools"
        title="Sandbox game: infinite money, everything unlocked. Click for the sandbox tools."
        onClick={() => setOpen(!open)}
      >
        SANDBOX
      </button>
      {open && (
        <div ref={pop} id="sbx-tools" class="card sbx-pop" role="dialog" aria-label="Sandbox tools">
          <h4>Add a key</h4>
          <div class="sbx-row">
            <select aria-label="Job template" value={tpl} onChange={(e) => setTpl(e.currentTarget.value)}>
              {TEMPLATE_NAMES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t] ?? taskOfTemplate(t)?.name ?? t}</option>)}
            </select>
            <select aria-label="Work multiplier" value={scale} title="Work multiplier" onChange={(e) => setScale(Number(e.currentTarget.value))}>
              {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>x{n}</option>)}
            </select>
            <button data-cue="ui_confirm" onClick={() => spawnKey(tpl, scale)} aria-label="Spawn a key with this job">Spawn</button>
          </div>
          <div class="sbx-row">
            <button data-cue="ui_click" onClick={clearQueue} title="Throw away every key in the tray">Clear queue</button>
            <button data-cue="ui_click" onClick={repairAll} title="Un-burn all parts and the board, cool everything down, reset a tripped PSU">Repair all</button>
          </div>
          <h4>Reputation</h4>
          <div class="sbx-row">
            <input
              type="range" data-cue="ui_slider_tick" min="0.4" max="4" step="0.05" value={shownRep} aria-label="Reputation"
              aria-valuetext={shownRep.toFixed(2)}
              onInput={(e) => { const v = Number(e.currentTarget.value); setRep(v); setReputation(v); }}
              // Keep the local value while the slider has focus: a keyboard step fires `change` on every press, and
              // resetting there snapped the slider back to the last snapshot (the next press started from the old value).
              onBlur={() => setRep(null)}
            />
            <span class="sbx-val" aria-hidden="true">{shownRep.toFixed(2)}</span>
          </div>
          <h4>Arriving on their own</h4>
          <div class="sbj-kinds sbx-classes" role="group" aria-label="Job classes that arrive on their own">
            {JOB_CLASSES.map((c) => {
              const atLevel = !!levelDef(s.level.level).mix[c.id], off = s.level.classesOff.includes(c.id);
              return (
                <button key={c.id} class={`sbj-kind${off ? '' : ' on'}${atLevel ? '' : ' dim'}`} data-cue="ui_toggle" aria-pressed={!off}
                  title={`${CLASS_NEEDS[c.id] ? `${CLASS_NEEDS[c.id]}. ` : ''}${atLevel ? '' : `Not part of the arrival mix at level ${s.level.level}: spawn one by hand, or raise the rules level (the LEVEL button).`}`.trim() || undefined}
                  onClick={() => setJobClasses(JOB_CLASSES.map((x) => x.id).filter((id) => (id === c.id ? !off : s.level.classesOff.includes(id))))}>
                  {CLASS_LABEL[c.id] ?? c.id}
                </button>
              );
            })}
          </div>
          <div class="sbx-row">
            <button data-cue="ui_click" onClick={() => setJobClasses([])} title="Let every class arrive again">All on</button>
            <button data-cue="ui_click" onClick={() => setJobClasses(JOB_CLASSES.map((c) => c.id))} title="Stop every class: no key arrives until you spawn one or switch a class on">All off</button>
          </div>
          <h4>Speed</h4>
          <div class="sbx-row">
            <button class={speed.value === 64 ? 'on' : ''} data-cue="ui_toggle" aria-pressed={speed.value === 64} onClick={() => setSpeed(speed.value === 64 ? 1 : 64)}>
              {speed.value === 64 ? '16x on (back to 1x)' : 'Run at 16x'}
            </button>
          </div>
          <div class="sbx-msg">Physics still applies: slots, watts, heat, RAM for the OS, power off to swap parts.</div>
        </div>
      )}
    </div>
  );
}
