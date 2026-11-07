import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { autosaveOffer, importSave, startSim } from '@/app/store';
import { fmtMoney, fmtTicks } from '../logic';
import { Icon } from '../kit/Icons';
import { galleryOpen, graphicsOpen, setUiScale, theme, toggleGraphics, toggleTheme, uiScale, UI_SCALE_MAX, UI_SCALE_MIN } from '../state';
import { newGameOpen, openNewGame } from './NewGame';

// The MAIN MENU, over the live room before a game: Continue (when an autosave exists), New game, Load game, Settings.
// Styles: ui.css (the Main menu section). Arrow keys move between the entries, Enter picks.

const settingsOpen = signal(false);

export function MainMenu() {
  const offer = autosaveOffer.value;
  const list = useRef<HTMLDivElement>(null);
  const modal = newGameOpen.value || settingsOpen.value || galleryOpen.value;

  // The first entry takes focus (Continue when there is one); arrows move up and down the list.
  useEffect(() => {
    if (!modal) list.current?.querySelector<HTMLElement>('.mm-btn')?.focus();
  }, [modal]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>('.mm-btn') ?? [])];
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
            <span class="mm-t">Continue<span class="mm-d">{offer.sandbox ? 'Sandbox' : fmtMoney(offer.money)} · {fmtTicks(offer.baseTick)}</span></span>
          </button>
        )}
        <button class={`mm-btn ${offer ? '' : 'primary'}`} onClick={() => openNewGame()}><Icon name="star" size={14} /><span class="mm-t">New game</span></button>
        <button class="mm-btn" onClick={() => openNewGame('sandbox')}><Icon name="box" size={14} /><span class="mm-t">Sandbox<span class="mm-d">Everything unlocked</span></span></button>
        <button class="mm-btn" onClick={() => { galleryOpen.value = true; }}><Icon name="cpu" size={14} /><span class="mm-t">Gallery<span class="mm-d">Every part in 3D</span></span></button>
        <label class="mm-btn btn" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement).click(); } }}>
          <Icon name="import" size={14} /><span class="mm-t">Load game</span>
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importSave(f); e.currentTarget.value = ''; }} />
        </label>
        <button class="mm-btn" onClick={() => { settingsOpen.value = true; }}><Icon name="screen" size={14} /><span class="mm-t">Settings</span></button>
      </nav>
      <SettingsCard />
    </>
  );
}

function SettingsCard() {
  const open = settingsOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !graphicsOpen.peek()) settingsOpen.value = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const dark = theme.value === 'dark';
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) settingsOpen.value = false; }}>
      <div class="card modal mm-card" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="big">Settings</div>
        <div class="mm-row"><span>Theme</span>
          <div class="seg" role="group" aria-label="Theme">
            <button class={dark ? 'on' : ''} aria-pressed={dark} onClick={() => { if (!dark) toggleTheme(); }}>Dark</button>
            <button class={!dark ? 'on' : ''} aria-pressed={!dark} onClick={() => { if (dark) toggleTheme(); }}>Light</button>
          </div>
        </div>
        <label class="mm-row scale-row"><span>UI size</span>
          <input type="range" min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05} value={uiScale.value} aria-label="UI size" onInput={(e) => setUiScale(Number(e.currentTarget.value))} />
          <b class="value">{Math.round(uiScale.value * 100)}%</b>
        </label>
        <div class="mm-row"><span>Picture</span><button onClick={toggleGraphics} aria-pressed={graphicsOpen.value}>{graphicsOpen.value ? 'Hide graphics' : 'Graphics…'}</button></div>
        <div class="pactions"><button class="primary" autofocus onClick={() => { settingsOpen.value = false; }}>Done</button></div>
      </div>
    </div>
  );
}
