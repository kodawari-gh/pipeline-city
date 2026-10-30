import '../ui.css';
import { useEffect, useState } from 'preact/hooks';
import { selected, viewInset } from '../../game/hover';
import { highlight } from '../../game/interaction';
import {
  autosaveOffer, exportSave, importSave, lastRunSpeed, setSpeed, snapshot, speed, startSim, togglePause, zoomSlowdown,
} from '../../game/store';
import { SPEEDS } from '../../sim/protocol';
import { fmtMoney, fmtNum, fmtTicks, isOsActivity, statusChip } from '../logic';
import { Icon } from '../kit/Icons';
import { hudNetChip } from './netui';
import { PowerBill } from './PowerBill';
import { InventoryBar, InventoryPanel } from '../shop/Inventory';
import { PickerCard } from '../shop/PickerCard';
import { Stats } from './Stats';
import { NetDock } from './NetPanel';
import { Tooltip } from '../kit/Hover';
import { Notice, Toasts } from './Toasts';
import { NewGameDialog, openNewGame } from './NewGame';
import { SandboxJobs } from '../shop/SandboxJobs';
import { SandboxTools } from '../shop/SandboxTools';
import { LevelBar, LevelUpModal, MilestoneScreen } from './Levels';
import { Shop } from '../shop/Shop';
import { TutorialCard } from '../tutorial/TutorialCard';
import { toggleTrace, TracePanel, traceOpen } from './TracePanel';
import { AlmanacPanel } from './AlmanacPanel';
import { LogPanel } from './LogPanel';
import { CrashPanel } from './CrashPanel';
import {
  netOpen, openMilestones, popupPause, replayTutorial, resetHints, setUiScale, skipTutorial, statsOpen, theme, toggleNet, toggleStats, toggleTheme, tutorial, uiScale, UI_SCALE_MAX, UI_SCALE_MIN,
} from '../state';
import { currentStep } from '../tutorial/tutorial';

/** The tutorial points at a number in the bar: `hud:<name>` in the highlight list pulses it. */
const lit = (name: string) => (highlight.value.includes(`hud:${name}`) ? 'pulse' : '');

/** What the player reads: the sim's ticks per second over 4 (4 ticks a second is the designed pace, "1x"). */
export const speedLabel = (s: number) => `${s / 4}x`;
const speedTitle = (s: number) => `Run at ${speedLabel(s)}`;

/**
 * Pause/play plus the speed. Collapsed it is two small buttons (the play state and the current speed); hovering or
 * focusing it, or tapping the speed, opens the other speeds in place.
 */
function SpeedControl() {
  const [open, setOpen] = useState(false);
  const v = speed.value, shown = v === 0 ? lastRunSpeed.value : v;
  return (
    <div class={`speedctl ${open ? 'open' : ''}`} onMouseLeave={() => setOpen(false)}>
      <button class="icon pp" aria-label={v === 0 ? 'Resume' : 'Pause'} title={v === 0 ? 'Resume (Space)' : 'Pause (Space)'} aria-pressed={v === 0} onClick={togglePause}>
        <Icon name={v === 0 ? 'play' : 'pause'} size={14} />
      </button>
      <div class="seg speeds" role="group" aria-label="Speed" onClick={() => setOpen(true)}>
        {SPEEDS.filter((x) => x !== 0).map((x) => (
          <button key={x} class={shown === x ? 'on' : ''} aria-pressed={shown === x && v !== 0} title={speedTitle(x)} onClick={() => { setSpeed(x); setOpen(false); }}>
            {speedLabel(x)}
          </button>
        ))}
      </div>
    </div>
  );
}

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

/** Space pauses and resumes. It leaves text fields and sliders alone, and an open dialog keeps Space for its own buttons. */
function PauseKey() {
  useEffect(() => {
    const mine = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
      return !document.querySelector('.modal-back, .ng-back');
    };
    const down = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      (document.activeElement as HTMLElement | null)?.blur?.(); // a focused button would also take the Space as a press
      togglePause();
    };
    const up = (e: KeyboardEvent) => { if (mine(e)) e.preventDefault(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  if (speed.value === 0) return !popupPause.value ? <div class="pausepill" role="status"><Icon name="clock" size={13} /> Paused <span class="mute">Space to resume</span></div> : null;
  const slow = zoomSlowdown.value;
  // zoomed in, the machine is shown in slow motion so a block can be followed: say so, and how to get the full pace back
  return slow < 0.97 ? <div class="pausepill" role="status"><Icon name="clock" size={13} /> Slow motion {Math.round(slow * 100)}% <span class="mute">zoomed in, zoom out for full pace</span></div> : null;
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
      // On a narrow screen the level pill drops below the bar: it counts as covered too, so cards and the camera start under it.
      const pill = document.querySelector('.hud-center');
      // the pill sits under the bar however tall it is (on a phone the stats card wraps to two rows)
      if (bar) (bar as HTMLElement).style.setProperty('--bar-h', `${bar.getBoundingClientRect().height}px`);
      if (bar) next.top = Math.ceil(Math.max(bar.getBoundingClientRect().bottom, pill?.getBoundingClientRect().bottom ?? 0) + gap);
      let invSeen = false;
      for (const el of document.querySelectorAll('.dock, .inv, .invbar, .tut')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const side = r.height > H * 0.5 && r.width < W * 0.5;
        if (el.classList.contains('invbar')) {
          next.bottom = Math.max(next.bottom, Math.ceil(H - r.top + gap));
        } else if (el.classList.contains('inv')) {
          invSeen = true;
          if (!el.classList.contains('away')) invKept = side ? { side: 'right', v: Math.ceil(W - r.left + gap) } : { side: 'bottom', v: Math.ceil(H - r.top + gap) };
          if (invKept) next[invKept.side] = Math.max(next[invKept.side], invKept.v);
        } else if (side) {
          if (r.left + r.width / 2 < W / 2) next.left = Math.max(next.left, Math.ceil(r.right + gap));
          else next.right = Math.max(next.right, Math.ceil(W - r.left + gap));
        } else next.bottom = Math.max(next.bottom, Math.ceil(H - r.top + gap));
      }
      if (!invSeen) invKept = null;
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


function Reputation({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const perMin = s.demandRate * 60;
  return (
    <div class={`stat ${lit('reputation')}`} data-hud="reputation" title={`Reputation ${fmtNum(s.reputation, 2)}: from how fast you answer. Demand ${fmtNum(perMin, 1)} keys a minute.`}>
      <Icon name="star" size={14} />
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
          <button role="menuitem" onClick={() => { toggleTrace(); close(); }} title="Watch what the CPU and the OS do, event by event, and step the paused machine"><Icon name="wave" size={13} /> {traceOpen.value ? 'Hide trace' : 'Trace'}</button>
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
      <PauseKey />
      <header class="hud">
        <div class="hud-side hud-left">
        <div class={`money ${lit('money')}`} data-hud="money" title="Money. Finish client keys to earn more.">{s.sandbox ? '∞' : fmtMoney(s.money)}</div>
        <span class="time" title="Game time">{fmtTicks(s.baseTick)}</span>
        <Reputation s={s} />
        <PowerBill s={s} />
        <PhaseChip s={s} />
        <NetChipButton s={s} />
        {s.sandbox && <SandboxTools s={s} />}
        {s.sandbox && <SandboxJobs s={s} />}
        </div>
        <div class={`hud-side hud-center ${lit('level')}`} data-hud="level"><LevelBar s={s} /></div>
        <div class="hud-side hud-right">
        <SpeedControl />
        <button class="icon" title={dark ? 'Switch to the light theme (experimental)' : 'Switch to the dark theme'} aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={14} />
        </button>
        <Menu s={s} />
        </div>
      </header>
      <PickerCard />
      <NewGameDialog />
      <MilestoneScreen s={s} />
      <Shop s={s} />
      {statsOpen.value && (
        <aside class="dock" aria-label="Stats">
          <button class="close" aria-label="Close stats" onClick={toggleStats}><Icon name="close" size={11} /></button>
          <Stats />
        </aside>
      )}
      <NetDock />
      <TracePanel />
      <AlmanacPanel />
      <LogPanel />
      <CrashPanel />
      <Tooltip />
      <LevelUpModal />
      <div class="stack">
        <Notice />
        <Toasts />
        <TutorialCard />
        <InventoryPanel s={s} />
        <InventoryBar s={s} />
      </div>
    </>
  );
}
