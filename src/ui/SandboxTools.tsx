import { useEffect, useRef, useState } from 'preact/hooks';
import { clearQueue, repairAll, setLevel, setReputation, setSpeed, spawnKey, speed } from '../game/store';
import type { Snapshot } from '../sim/game/game';
import { LEVELS } from '../sim/game/levels';
import { TEMPLATE_NAMES } from '../sim/gen';

// The sandbox chip in the HUD bar and its tools popover (docs/SANDBOX.md). Styles are in ui.css (the sandbox section).
// Keyboard: the chip toggles the popover, Escape closes it and gives focus back to the chip.

const TEMPLATE_LABEL: Record<string, string> = {
  cli: 'mixed (log / calc / checksum)', 'cli.log': 'log', 'cli.calc': 'calc', 'cli.checksum': 'checksum', 'cli.scan': 'scan (memory heavy)',
};

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
        ref={chip} class={`sbx-chip ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="sbx-tools"
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
              {TEMPLATE_NAMES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t] ?? t}</option>)}
            </select>
            <select aria-label="Work multiplier" value={scale} title="Work multiplier" onChange={(e) => setScale(Number(e.currentTarget.value))}>
              {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>x{n}</option>)}
            </select>
            <button onClick={() => spawnKey(tpl, scale)} aria-label="Spawn a key with this job">Spawn</button>
          </div>
          <div class="sbx-row">
            <button onClick={clearQueue} title="Throw away every key in the tray">Clear queue</button>
            <button onClick={repairAll} title="Un-burn all parts and the board, cool everything down, reset a tripped PSU">Repair all</button>
          </div>
          <h4>Reputation</h4>
          <div class="sbx-row">
            <input
              type="range" min="0.4" max="4" step="0.05" value={shownRep} aria-label="Reputation"
              aria-valuetext={shownRep.toFixed(2)}
              onInput={(e) => { const v = Number(e.currentTarget.value); setRep(v); setReputation(v); }}
              // Keep the local value while the slider has focus: a keyboard step fires `change` on every press, and
              // resetting there snapped the slider back to the last snapshot (the next press started from the old value).
              onBlur={() => setRep(null)}
            />
            <span class="sbx-val" aria-hidden="true">{shownRep.toFixed(2)}</span>
          </div>
          <h4>Rules level</h4>
          <div class="sbx-row">
            <select aria-label="Rules level" value={s.level.level} title="Patience, payouts, demand and the job mix follow this level. Nothing is locked in the sandbox."
              onChange={(e) => setLevel(Number(e.currentTarget.value))}>
              {LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level}: {l.name}</option>)}
            </select>
          </div>
          <h4>Speed</h4>
          <div class="sbx-row">
            <button class={speed.value === 64 ? 'on' : ''} aria-pressed={speed.value === 64} onClick={() => setSpeed(speed.value === 64 ? 1 : 64)}>
              {speed.value === 64 ? '64x on (back to 1x)' : 'Run at 64x'}
            </button>
          </div>
          <div class="sbx-msg">Physics still applies: slots, watts, heat, RAM for the OS, power off to swap parts.</div>
        </div>
      )}
    </div>
  );
}
