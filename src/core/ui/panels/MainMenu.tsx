import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { autosaveAt, autosaveOffer, startSim } from '@/app/store';
import { saveSummary } from '../logic';
import { Icon } from '../kit/Icons';
import { buildOpen, galleryOpen, graphicsOpen, setUiScale, toggleGraphics, uiScale, UI_SCALE_MAX, UI_SCALE_MIN } from '../state';
import { loadFromFile } from './loadgame';
import { newGameOpen, openNewGame } from './NewGame';

// The MAIN MENU, over the live room before a game: Continue (when an autosave exists), New game, Sandbox, Build my PC, Gallery, Load from file, Settings.
// Every entry has a caption, so the rows are one height. Styles: ui.css (the Main menu section). Arrow keys move between the entries, Enter picks.

const settingsOpen = signal(false);

/** `ready`: the 3D world is up. Build my PC, Gallery and the graphics settings need it; the rest of the menu works while it loads (a game chosen starts after, `startSim`). */
export function MainMenu({ ready = true }: { ready?: boolean }) {
  const offer = autosaveOffer.value;
  const list = useRef<HTMLDivElement>(null);
  const modal = newGameOpen.value || settingsOpen.value || galleryOpen.value || buildOpen.value;

  // The first entry takes focus (Continue when there is one); arrows move up and down the list.
  useEffect(() => {
    if (!modal) list.current?.querySelector<HTMLElement>('.mm-btn')?.focus();
  }, [modal]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>('.mm-btn:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length) return;
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
  };

  return (
    <>
      <nav class="mainmenu" aria-label="Main menu" ref={list} onKeyDown={onKey} inert={modal}>
        {offer && (
          <button class="mm-btn primary" onClick={() => startSim(offer)}>
            <Icon name="play" size={14} />
            <span class="mm-t">Continue<span class="mm-d">{saveSummary(offer, autosaveAt.value, Date.now())}</span></span>
          </button>
        )}
        <button class={`mm-btn ${offer ? '' : 'primary'}`} onClick={() => openNewGame()}><Icon name="star" size={14} /><span class="mm-t">New game<span class="mm-d">Guided campaign</span></span></button>
        <button class="mm-btn" onClick={() => openNewGame('sandbox')}><Icon name="box" size={14} /><span class="mm-t">Sandbox<span class="mm-d">Everything unlocked</span></span></button>
        <button class="mm-btn" disabled={!ready} onClick={() => { buildOpen.value = true; }}><Icon name="case" size={14} /><span class="mm-t">Build my PC<span class="mm-d">{ready ? 'Fit and swap parts' : 'Getting ready…'}</span></span></button>
        <button class="mm-btn" disabled={!ready} onClick={() => { galleryOpen.value = true; }}><Icon name="eye" size={14} /><span class="mm-t">Gallery<span class="mm-d">{ready ? 'Every part in 3D' : 'Getting ready…'}</span></span></button>
        <label class="mm-btn btn" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement).click(); } }}>
          <Icon name="import" size={14} /><span class="mm-t">Load from file<span class="mm-d">A game you exported</span></span>
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void loadFromFile(f); e.currentTarget.value = ''; }} />
        </label>
        <button class="mm-btn" onClick={() => { settingsOpen.value = true; }}><Icon name="sliders" size={14} /><span class="mm-t">Settings<span class="mm-d">Size and graphics</span></span></button>
      </nav>
      <SettingsCard ready={ready} />
    </>
  );
}

function SettingsCard({ ready }: { ready: boolean }) {
  const open = settingsOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !graphicsOpen.peek()) settingsOpen.value = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) settingsOpen.value = false; }}>
      <div class="card modal mm-card" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="big">Settings</div>
        <label class="mm-row scale-row"><span>UI size</span>
          <input type="range" min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05} value={uiScale.value} aria-label="UI size" onInput={(e) => setUiScale(Number(e.currentTarget.value))} />
          <b class="value">{Math.round(uiScale.value * 100)}%</b>
        </label>
        <div class="mm-row"><span>Picture</span><button disabled={!ready} title={ready ? undefined : 'Available when the room is ready'} onClick={toggleGraphics} aria-haspopup="dialog">Graphics…</button></div>
        <div class="pactions"><button class="primary" autofocus onClick={() => { settingsOpen.value = false; }}>Done</button></div>
      </div>
    </div>
  );
}
