import { useState } from 'preact/hooks';
import { clearQueue, repairAll, setReputation, setSpeed, spawnKey, speed } from '../game/store';
import type { Snapshot } from '../sim/game/game';
import { TEMPLATE_NAMES } from '../sim/gen';

// The sandbox chip in the HUD bar and its tools popover (docs/SANDBOX.md). Sizes are rem and CSS variables only.

const CSS = `
.sbx { position: relative; display: inline-flex; }
.sbx-chip { font-weight: 700; letter-spacing: 0.08em; font-size: 0.733rem; padding: 0.2rem 0.6rem; border-radius: 99rem;
  border: 1px solid var(--accent); color: var(--accent); background: var(--glass-hi); cursor: pointer; }
.sbx-chip.on { background: var(--accent); color: var(--on); }
.sbx-pop { position: absolute; top: calc(100% + 0.4rem); left: 0; z-index: 40; display: flex; flex-direction: column; gap: 0.5rem;
  width: 17rem; max-width: calc(100vw - 1.6rem); padding: 0.667rem; }
.sbx-pop h4 { margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mute); }
.sbx-row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.sbx-row select, .sbx-row input[type=number] { font: inherit; color: var(--ink); background: var(--tile); border: 1px solid var(--glass-line); border-radius: 0.267rem; padding: 0.2rem 0.3rem; }
.sbx-row input[type=range] { flex: 1; min-width: 6rem; accent-color: var(--accent); }
.sbx-row button { flex: 0 0 auto; }
.sbx-val { font-family: var(--mono); min-width: 2.6rem; text-align: right; }
.sbx-msg { color: var(--mute); font-size: 0.733rem; }
`;

const TEMPLATE_LABEL: Record<string, string> = {
  cli: 'mixed (log / calc / checksum)', 'cli.log': 'log', 'cli.calc': 'calc', 'cli.checksum': 'checksum', 'cli.scan': 'scan (memory heavy)',
};

export function SandboxTools({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState('cli.log');
  const [scale, setScale] = useState(1);
  const [rep, setRep] = useState<number | null>(null);
  const shownRep = rep ?? s.reputation;
  return (
    <div class="sbx">
      <style>{CSS}</style>
      <button class={`sbx-chip ${open ? 'on' : ''}`} aria-expanded={open} title="Sandbox game: infinite money, everything unlocked. Click for the sandbox tools." onClick={() => setOpen(!open)}>
        SANDBOX
      </button>
      {open && (
        <div class="card sbx-pop" role="dialog" aria-label="Sandbox tools">
          <h4>Add a key</h4>
          <div class="sbx-row">
            <select aria-label="Job template" value={tpl} onChange={(e) => setTpl(e.currentTarget.value)}>
              {TEMPLATE_NAMES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t] ?? t}</option>)}
            </select>
            <select aria-label="Scale" value={scale} title="Work multiplier" onChange={(e) => setScale(Number(e.currentTarget.value))}>
              {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>x{n}</option>)}
            </select>
            <button onClick={() => spawnKey(tpl, scale)}>Spawn</button>
          </div>
          <div class="sbx-row">
            <button onClick={clearQueue} title="Throw away every key in the tray">Clear queue</button>
            <button onClick={repairAll} title="Un-burn all parts and the board, cool everything down, reset a tripped PSU">Repair all</button>
          </div>
          <h4>Reputation</h4>
          <div class="sbx-row">
            <input
              type="range" min="0.4" max="4" step="0.05" value={shownRep} aria-label="Reputation"
              onInput={(e) => { const v = Number(e.currentTarget.value); setRep(v); setReputation(v); }}
              onChange={() => setRep(null)}
            />
            <span class="sbx-val">{shownRep.toFixed(2)}</span>
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
