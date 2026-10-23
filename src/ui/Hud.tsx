import './ui.css';
import { useEffect, useState } from 'preact/hooks';
import { selected, viewInset } from '../game/hover';
import {
  autosaveOffer, exportSave, importSave, setSpeed, snapshot, speed, startSim,
} from '../game/store';
import { SPEEDS } from '../sim/protocol';
import { fmtMoney, fmtNum, fmtTicks, queueReadout, statusChip } from './logic';
import { Icon } from './Icons';
import { InventoryButton, InventoryPanel } from './Inventory';
import { PickerCard } from './PickerCard';
import { Stats } from './Stats';
import { Tooltip } from './Hover';
import { Notice, Toasts } from './Toasts';
import { TutorialCard } from './TutorialCard';
import {
  replayTutorial, resetHints, skipTutorial, statsOpen, theme, toggleStats, toggleTheme, tutorial,
} from './state';
import { currentStep } from './tutorial';

const speedLabel = (s: number) => (s === 0 ? 'II' : `${s}x`);
const speedTitle = (s: number) => (s === 0 ? 'Pause' : `Run at ${s}x`);

function StartPrompt() {
  const offer = autosaveOffer.value;
  if (offer) {
    return (
      <div class="card prompt">
        <div class="big">Welcome back</div>
        <div class="mute">Autosave: tick {offer.baseTick}, {fmtMoney(offer.money)}</div>
        <div class="row">
          <button class="primary" onClick={() => startSim(offer)}>Continue</button>
          <button onClick={() => startSim(null)}>New game</button>
        </div>
      </div>
    );
  }
  return <div class="card prompt mute">starting...</div>;
}

/**
 * Tells the board camera how much of the screen the bar and the side cards cover, so the overview frames the board in
 * the free area. Re-measured whenever the HUD's contents change (a card opens, the tutorial moves on, a toast appears).
 */
function InsetReporter() {
  useEffect(() => {
    const hud = document.getElementById('hud');
    const measure = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const next = { top: 0, right: 0, bottom: 0, left: 0 };
      const bar = document.querySelector('.hud');
      if (bar) next.top = Math.ceil(bar.getBoundingClientRect().bottom) + 8;
      for (const el of document.querySelectorAll('.dock, .picker, .tut, .inv')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        // The inventory tray runs along the bottom edge; it is hidden while a part is dragged, so it frees the board.
        if (el.classList.contains('inv')) {
          if (!el.classList.contains('away')) next.bottom = Math.max(next.bottom, Math.ceil(H - r.top) + 8);
        } else if (r.width >= W * 0.8) next.bottom = Math.max(next.bottom, Math.ceil(H - r.top) + 8);
        else if (r.left + r.width / 2 < W / 2) next.left = Math.max(next.left, Math.ceil(r.right) + 8);
        else next.right = Math.max(next.right, Math.ceil(W - r.left) + 8);
      }
      const cur = viewInset.peek();
      if (cur.top !== next.top || cur.right !== next.right || cur.bottom !== next.bottom || cur.left !== next.left) viewInset.value = next;
    };
    measure();
    const mo = hud ? new MutationObserver(measure) : null;
    if (hud) mo!.observe(hud, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', measure);
    return () => { mo?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return null;
}

/** Keys waiting in the tray. The age of the oldest and the demand sit in the tooltip, not on the bar. */
function Queue({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const q = queueReadout(s);
  return (
    <div class={`stat ${q.late ? 'bad' : ''}`} title={`${q.text}. The tray holds ${q.cap}; a full tray turns clients away.`}>
      <span class="label">keys</span>
      <span class="value">{q.count}<span class="mute">/{q.cap}</span></span>
    </div>
  );
}

function Reputation({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const perMin = s.demandRate * 60;
  return (
    <div class="stat" title={`Reputation ${fmtNum(s.reputation, 2)}: from how fast you answer. Demand ${fmtNum(perMin, 1)} keys a minute.`}>
      <span class="label">rep</span>
      <span class="value">{fmtNum(s.reputation, 2)}</span>
    </div>
  );
}

/** Machine phase chip: Off, POST, Waiting for key, Loading, Running, Writing, Remove key, Error + reason. */
function PhaseChip({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const c = statusChip(s);
  return <span class={`chip ${c.level}`} role="status" title={c.title}>{c.text}</span>;
}

/** Secondary actions: stats, save files, tutorial, hints and a new game. Kept out of the bar. */
function Menu({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const [open, setOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const active = currentStep(s, tutorial.value) !== null;
  const close = () => { setOpen(false); setConfirmNew(false); };
  return (
    <div class="menu">
      <button class={`icon ${open ? 'on' : ''}`} aria-expanded={open} aria-label="Menu" title="Menu" onClick={() => { setOpen(!open); setConfirmNew(false); }}>
        <Icon name="menu" size={14} />
      </button>
      {open && (
        <div class="card menu-pop" role="menu">
          <button role="menuitem" onClick={() => { toggleStats(); close(); }}><Icon name="stats" size={13} /> {statsOpen.value ? 'Hide stats' : 'Stats'}</button>
          <button role="menuitem" onClick={() => { exportSave(); close(); }} title="Download your game as a file"><Icon name="export" size={13} /> Export game</button>
          <label class="menuitem" title="Load a game file">
            <Icon name="import" size={13} /> Import game
            <input
              type="file" accept="application/json,.json" hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) importSave(f);
                e.currentTarget.value = '';
                close();
              }}
            />
          </label>
          <hr />
          <button role="menuitem" onClick={() => { replayTutorial(s); close(); }}>Replay tutorial</button>
          {active && <button role="menuitem" onClick={() => { skipTutorial(); close(); }}>Skip tutorial</button>}
          <button role="menuitem" onClick={() => { resetHints(); close(); }}>Show hints again</button>
          <button role="menuitem" class={confirmNew ? 'bad' : ''} onClick={() => {
            if (!confirmNew) { setConfirmNew(true); return; }
            close();
            startSim(null);
          }}>
            {confirmNew ? 'Really start a new game?' : 'New game'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Hud() {
  const s = snapshot.value;
  if (!s) return <StartPrompt />;
  const dark = theme.value === 'dark';
  return (
    <>
      <InsetReporter />
      <header class="hud">
        <div class="money" title="Money. Finish client keys to earn more.">{fmtMoney(s.money)}</div>
        <span class="time" title="Game time at 1x">{fmtTicks(s.baseTick)}</span>
        <Reputation s={s} />
        <Queue s={s} />
        <PhaseChip s={s} />
        <div class="grow" />
        <InventoryButton s={s} />
        <div class="seg" role="group" aria-label="Speed">
          {SPEEDS.map((v) => (
            <button key={v} class={speed.value === v ? 'on' : ''} aria-pressed={speed.value === v} title={speedTitle(v)} onClick={() => setSpeed(v)}>
              {speedLabel(v)}
            </button>
          ))}
        </div>
        <button class="icon" title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={14} />
        </button>
        <Menu s={s} />
      </header>
      <Notice />
      <PickerCard />
      <TutorialCard />
      <InventoryPanel s={s} />
      {statsOpen.value && (
        <aside class="dock" aria-label="Stats">
          <button class="close" aria-label="Close stats" onClick={toggleStats}><Icon name="close" size={11} /></button>
          <Stats />
        </aside>
      )}
      <Tooltip />
      <Toasts />
    </>
  );
}
