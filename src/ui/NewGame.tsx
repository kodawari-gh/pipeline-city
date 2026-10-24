import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { autosaveOffer, snapshot, startSim } from '../game/store';

// The NEW GAME dialog: Campaign or Sandbox (docs/SANDBOX.md). Sizes are rem and CSS variables only; the styles are
// in ui.css (the New game section). Keyboard: Tab stays inside the dialog, Enter or Space picks a choice, Escape closes
// it when a game can be fallen back on.

export const newGameOpen = signal(false);
export const openNewGame = () => { newGameOpen.value = true; };

type Mode = 'campaign' | 'sandbox';

export function NewGameDialog() {
  const [mode, setMode] = useState<Mode>('campaign');
  const [assembled, setAssembled] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const open = newGameOpen.value;
  // A game or a saved game to fall back on: only then may the dialog be dismissed.
  const running = snapshot.value !== null;
  const dismissable = running || autosaveOffer.value !== null;

  // Focus the chosen card when the dialog opens, and give focus back to the page's last control when it closes.
  useEffect(() => {
    if (!open) { setConfirm(false); return; }
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) { newGameOpen.value = false; return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      // A simple focus trap: Tab and Shift+Tab wrap inside the dialog.
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [role="radio"]')];
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialog.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !dialog.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [open, dismissable]);

  if (!open) return null;
  const start = () => {
    if (running && !confirm) { setConfirm(true); return; }
    newGameOpen.value = false;
    setConfirm(false);
    startSim(null, mode === 'sandbox' ? { sandbox: true, preassembled: assembled } : {});
  };
  const pick = (m: Mode) => { setMode(m); setConfirm(false); };
  // Arrow keys move between the two choices, as in any radio group.
  const onRadioKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); pick(mode === 'campaign' ? 'sandbox' : 'campaign'); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); pick(mode === 'campaign' ? 'sandbox' : 'campaign'); }
  };
  const choice = (m: Mode, title: string, text: string) => (
    <div
      role="radio" tabIndex={mode === m ? 0 : -1} aria-checked={mode === m} class={`ng-choice ${mode === m ? 'on' : ''}`}
      onClick={() => pick(m)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(m); }
        else onRadioKey(e);
      }}
    >
      <span class="t">{title}</span>
      <span class="d">{text}</span>
    </div>
  );
  return (
    <div class="ng-back" onClick={(e) => { if (e.target === e.currentTarget && dismissable) newGameOpen.value = false; }}>
      <div ref={dialog} class="card ng" role="dialog" aria-modal="true" aria-labelledby="ng-title">
        <h2 id="ng-title">New game</h2>
        <div class="ng-choices" role="radiogroup" aria-label="Game type">
          {choice('campaign', 'Campaign', 'Guided. Start with a bare board and the starter crate, learn to build the machine, earn money for every upgrade. Includes the tutorial.')}
          {choice('sandbox', 'Sandbox', 'Infinite money and everything unlocked, to try ideas fast. Slots, watts, heat and power-off rules still apply.')}
        </div>
        {mode === 'sandbox' && (
          <div class="ng-sub" role="group" aria-label="Sandbox start">
            <button class={assembled ? 'on' : ''} aria-pressed={assembled} onClick={() => setAssembled(true)}>Assembled machine</button>
            <button class={!assembled ? 'on' : ''} aria-pressed={!assembled} onClick={() => setAssembled(false)}>Bare board</button>
          </div>
        )}
        <div class="ng-actions">
          {confirm && <span class="ng-warn" role="alert">This discards the game you are playing.</span>}
          {dismissable && <button onClick={() => { newGameOpen.value = false; }}>Cancel</button>}
          <button class="primary" onClick={start}>{confirm ? 'Discard and start' : 'Start'}</button>
        </div>
      </div>
    </div>
  );
}
