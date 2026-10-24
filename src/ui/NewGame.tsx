import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { autosaveOffer, snapshot, startSim } from '../game/store';

// The NEW GAME dialog: Campaign or Sandbox (docs/SANDBOX.md). Sizes are rem and CSS variables only.

export const newGameOpen = signal(false);
export const openNewGame = () => { newGameOpen.value = true; };

const CSS = `
.ng-back { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(4, 8, 24, 0.55); padding: 1rem; }
.ng { display: flex; flex-direction: column; gap: 0.8rem; width: 44rem; max-width: 100%; max-height: 100%; overflow: auto; padding: 1.2rem; }
.ng h2 { margin: 0; font-size: 1.3rem; }
.ng-choices { display: flex; gap: 0.8rem; flex-wrap: wrap; }
.ng-choice { flex: 1 1 16rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; text-align: left; padding: 0.9rem;
  border: 1px solid var(--glass-line); border-radius: 0.6rem; background: var(--glass-hi); color: var(--ink); cursor: pointer; }
.ng-choice.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.ng-choice .t { font-size: 1.15rem; font-weight: 700; }
.ng-choice .d { color: var(--mute); }
.ng-sub { display: flex; gap: 0.4rem; margin-top: 0.3rem; flex-wrap: wrap; }
.ng-sub button { padding: 0.2rem 0.6rem; }
.ng-sub button.on { background: var(--accent); color: var(--on); }
.ng-actions { display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.ng-warn { color: var(--bad); margin-right: auto; }
`;

export function NewGameDialog() {
  const [mode, setMode] = useState<'campaign' | 'sandbox'>('campaign');
  const [assembled, setAssembled] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const open = newGameOpen.value;
  // A game or a saved game to fall back on: only then may the dialog be dismissed.
  const running = snapshot.value !== null;
  const dismissable = running || autosaveOffer.value !== null;
  useEffect(() => {
    if (!open) { setConfirm(false); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) newGameOpen.value = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable]);
  if (!open) return null;
  const start = () => {
    if (running && !confirm) { setConfirm(true); return; }
    newGameOpen.value = false;
    setConfirm(false);
    startSim(null, mode === 'sandbox' ? { sandbox: true, preassembled: assembled } : {});
  };
  return (
    <div class="ng-back" onClick={(e) => { if (e.target === e.currentTarget && dismissable) newGameOpen.value = false; }}>
      <style>{CSS}</style>
      <div class="card ng" role="dialog" aria-modal="true" aria-label="New game">
        <h2>New game</h2>
        <div class="ng-choices">
          <div class={`ng-choice ${mode === 'campaign' ? 'on' : ''}`} role="button" tabindex={0} aria-pressed={mode === 'campaign'}
            onClick={() => { setMode('campaign'); setConfirm(false); }}>
            <span class="t">Campaign</span>
            <span class="d">Guided. Start with a bare board and the starter crate, learn to build the machine, earn money for every upgrade. Includes the tutorial.</span>
          </div>
          <div class={`ng-choice ${mode === 'sandbox' ? 'on' : ''}`} role="button" tabindex={0} aria-pressed={mode === 'sandbox'}
            onClick={() => { setMode('sandbox'); setConfirm(false); }}>
            <span class="t">Sandbox</span>
            <span class="d">Infinite money and everything unlocked, to try ideas fast. Slots, watts, heat and power-off rules still apply.</span>
            {mode === 'sandbox' && (
              <div class="ng-sub" role="group" aria-label="Sandbox start">
                <button class={assembled ? 'on' : ''} aria-pressed={assembled} onClick={(e) => { e.stopPropagation(); setAssembled(true); }}>Assembled machine</button>
                <button class={!assembled ? 'on' : ''} aria-pressed={!assembled} onClick={(e) => { e.stopPropagation(); setAssembled(false); }}>Bare board</button>
              </div>
            )}
          </div>
        </div>
        <div class="ng-actions">
          {confirm && <span class="ng-warn">This discards the game you are playing.</span>}
          {dismissable && <button onClick={() => { newGameOpen.value = false; }}>Cancel</button>}
          <button class="primary" onClick={start}>{confirm ? 'Discard and start' : 'Start'}</button>
        </div>
      </div>
    </div>
  );
}
