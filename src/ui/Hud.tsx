import './ui.css';
import { useEffect, useState } from 'preact/hooks';
import { selected, viewInset } from '../game/hover';
import {
  autosaveOffer, exportSave, importSave, setSpeed, snapshot, speed, startSim,
} from '../game/store';
import { SPEEDS } from '../sim/protocol';
import { fmtMoney, fmtNum, fmtTicks, isOsActivity, queueReadout, statusChip } from './logic';
import { Icon } from './Icons';
import { hudNetChip } from './netui';
import { InventoryButton, InventoryPanel } from './Inventory';
import { PickerCard } from './PickerCard';
import { Stats } from './Stats';
import { Tooltip } from './Hover';
import { Notice, Toasts } from './Toasts';
import { NewGameDialog, openNewGame } from './NewGame';
import { SandboxTools } from './SandboxTools';
import { LevelBar, MilestoneScreen } from './Levels';
import { TutorialCard } from './TutorialCard';
import {
  netOpen, openMilestones, replayTutorial, resetHints, setUiScale, skipTutorial, statsOpen, theme, toggleNet, toggleStats, toggleTheme, tutorial, uiScale, UI_SCALE_MAX, UI_SCALE_MIN,
} from './state';
import { currentStep } from './tutorial';

const speedLabel = (s: number) => (s === 0 ? 'II' : `${s}x`);
const speedTitle = (s: number) => (s === 0 ? 'Pause' : `Run at ${s}x`);

function StartPrompt() {
  const offer = autosaveOffer.value;
  if (offer) {
    return (
      <div class="modal-back">
        <div class="card modal" role="dialog" aria-modal="true" aria-label="Welcome back">
          <div class="big">Welcome back</div>
          <div class="mute">Autosave: tick {offer.baseTick}, {fmtMoney(offer.money)}</div>
          <div class="pactions">
            <button onClick={openNewGame}>New game</button>
            <button class="primary" onClick={() => startSim(offer)}>Continue</button>
          </div>
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
    // The shelf's reserved space is remembered while it is slid away during a drag: the camera must not re-frame
    // under the pointer mid-drag. The part is hidden, the space is kept.
    let invKept: { side: 'bottom' | 'right'; v: number } | null = null;
    const measure = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
      const next = { top: 0, right: 0, bottom: 0, left: 0 };
      const bar = document.querySelector('.hud');
      if (bar) next.top = Math.ceil(bar.getBoundingClientRect().bottom + gap);
      let invSeen = false;
      for (const el of document.querySelectorAll('.dock, .inv')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const side = r.height > H * 0.5 && r.width < W * 0.5;
        if (el.classList.contains('inv')) {
          invSeen = true;
          if (!el.classList.contains('away')) invKept = side ? { side: 'right', v: Math.ceil(W - r.left + gap) } : { side: 'bottom', v: Math.ceil(H - r.top + gap) };
          if (invKept) next[invKept.side] = Math.max(next[invKept.side], invKept.v);
        } else if (side) {
          if (r.left + r.width / 2 < W / 2) next.left = Math.max(next.left, Math.ceil(r.right + gap));
          else next.right = Math.max(next.right, Math.ceil(W - r.left + gap));
        } else next.bottom = Math.max(next.bottom, Math.ceil(H - r.top + gap));
      }
      if (!invSeen) invKept = null;
      // The tutorial card reserves its place above the shelf while a step is active, so the overview frames the board
      // above it. Its layout box is used (offsetTop, not the drawn rect), so its lift never moves the camera.
      const tut = document.querySelector<HTMLElement>('.tut');
      const stack = tut?.offsetParent as HTMLElement | null | undefined;
      if (tut && stack && tut.offsetHeight > 0) {
        const cardTop = stack.getBoundingClientRect().top + tut.offsetTop;
        next.bottom = Math.max(next.bottom, Math.ceil(H - cardTop + gap));
      }
      const cur = viewInset.peek();
      if (cur.top !== next.top || cur.right !== next.right || cur.bottom !== next.bottom || cur.left !== next.left) viewInset.value = next;
    };
    measure();
    const mo = hud ? new MutationObserver(measure) : null;
    // `style` too: the tutorial card's height is set in its style (its fit), and the picker moves by its style.
    if (hud) mo!.observe(hud, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
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
      {q.held > 0 && <span class="value held" title="Held keys: the OS has their jobs, plug them back in to collect">+{q.held}<span class="mute"> held</span></span>}
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
  // The chip pulses while the OS is doing work; `.paused` on the root stops it when the game is paused.
  return <span class={`chip ${c.level} ${isOsActivity(s.phase) ? 'live' : ''}`} role="status" title={c.title}>{c.text}</span>;
}

/** Network chip: appears once a router exists, shows the link speed or why there is none. Opens the network panel. */
function NetChipButton({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const c = hudNetChip(s);
  if (!c) return null;
  return (
    <button class={`chip ${c.level}`} title={c.title} aria-pressed={netOpen.value} onClick={toggleNet}>
      <Icon name={c.icon} size={12} /> {c.text}
    </button>
  );
}

/** Secondary actions: stats, save files, tutorial, hints and a new game. Kept out of the bar. */
function Menu({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const [open, setOpen] = useState(false);
  const active = currentStep(s, tutorial.value) !== null;
  const close = () => setOpen(false);
  return (
    <div class="menu">
      <button class={`icon ${open ? 'on' : ''}`} aria-expanded={open} aria-label="Menu" title="Menu" onClick={() => setOpen(!open)}>
        <Icon name="menu" size={14} />
      </button>
      {open && (
        <div class="card menu-pop" role="menu">
          <button role="menuitem" onClick={() => { toggleStats(); close(); }}><Icon name="stats" size={13} /> {statsOpen.value ? 'Hide stats' : 'Stats'}</button>
          <button role="menuitem" onClick={() => { openMilestones(); close(); }} title="All the levels and what they unlock"><Icon name="gauge" size={13} /> Levels</button>
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
          <label class="scale-row" title="Make the whole interface smaller or larger">
            <span>UI size</span>
            <input type="range" min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05} value={uiScale.value} aria-label="UI size"
              onInput={(e) => setUiScale(Number(e.currentTarget.value))} />
            <b class="value">{Math.round(uiScale.value * 100)}%</b>
          </label>
          <hr />
          <button role="menuitem" onClick={() => { replayTutorial(s); close(); }}>Replay tutorial</button>
          {active && <button role="menuitem" onClick={() => { skipTutorial(); close(); }}>Skip tutorial</button>}
          <button role="menuitem" onClick={() => { resetHints(); close(); }}>Show hints again</button>
          <button role="menuitem" onClick={() => { close(); openNewGame(); }}>New game</button>
        </div>
      )}
    </div>
  );
}

export function Hud() {
  const s = snapshot.value;
  if (!s) return <><StartPrompt /><NewGameDialog /></>;
  const dark = theme.value === 'dark';
  return (
    <>
      <InsetReporter />
      <header class="hud">
        <div class="money" title="Money. Finish client keys to earn more.">{s.sandbox ? '∞' : fmtMoney(s.money)}</div>
        <span class="time" title="Game time at 1x">{fmtTicks(s.baseTick)}</span>
        <LevelBar s={s} />
        <Reputation s={s} />
        <Queue s={s} />
        <PhaseChip s={s} />
        <NetChipButton s={s} />
        {s.sandbox && <SandboxTools s={s} />}
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
      <PickerCard />
      <NewGameDialog />
      <MilestoneScreen s={s} />
      {statsOpen.value && (
        <aside class="dock" aria-label="Stats">
          <button class="close" aria-label="Close stats" onClick={toggleStats}><Icon name="close" size={11} /></button>
          <Stats />
        </aside>
      )}
      <Tooltip />
      <div class="stack">
        <Notice />
        <Toasts />
        <TutorialCard />
        <InventoryPanel s={s} />
      </div>
    </>
  );
}
