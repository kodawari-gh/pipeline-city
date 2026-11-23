import './ui.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { selected, viewInset } from '../../app/hover';
import { booted } from '../../app/boot';
import { dragging, highlight } from '../../app/interaction';
import {
  exportSave, lastRunSpeed, leaving, saveNow, snapshot, speed, starting, toggleZoomSlow, togglePause, zoomSlowOn, zoomSlowdown,
} from '../../app/store';
import { SPEEDS } from '../../worker/protocol';
import { billChip, fmtMoney, fmtNum, fmtTicks, isOsActivity, statusChip } from './logic';
import { Icon } from './kit/Icons';
import { hudNetChip } from '../../features/network/ui/netui';
import { billOpen, PowerBill } from '../../features/economy/ui/progress/PowerBill';
import { InventoryBar, InventoryPanel } from '../../features/economy/ui/shop/Inventory';
import { PickerCard } from '../../features/economy/ui/shop/PickerCard';
import { Stats } from './panels/Stats';
import { NetDock } from '../../features/network/ui/NetPanel';
import { OsModal } from '../../features/os/ui/OsPanel';
import { Tooltip } from './kit/Hover';
import { Notice, Toasts } from './panels/Toasts';
import { NewGameScreen, openNewGame } from './panels/NewGame';
import { MainMenu } from './panels/MainMenu';
import { LoadConfirm } from './panels/LoadConfirm';
import { Controls } from './panels/Controls';
import { loadFromFile } from './panels/loadgame';
import { leaveGame } from './leave';
import { SandboxJobs } from '../../features/sandbox/ui/SandboxJobs';
import { SandboxTools } from '../../features/sandbox/ui/SandboxTools';
import { LevelBar, LevelUpModal, MilestoneScreen } from '../../features/economy/ui/progress/Levels';
import { BuildMode, Gallery, Shop } from '../../features/economy/ui/shop/Shop';
import { TutorialCard } from '../../features/tutorial/ui/TutorialCard';
import { toggleTrace, TracePanel, traceOpen } from '../../features/cpu/ui/TracePanel';
import { AlmanacPanel } from '../../features/jobs/ui/AlmanacPanel';
import { LogPanel } from './panels/LogPanel';
import { CrashPanel } from './panels/CrashPanel';
import { SettingsScreen } from './panels/Settings';
import {
  buildOpen, closeControls, controlsOpen, galleryOpen, gameMenuOpen, holdActive, netOpen, openControlsFromMenu, openMilestones, openSettings, osOpen, runAt, toggleOs, replayTutorial, resetHints, skipTutorial, statsOpen, toggleNet, toggleStats, tutorial,
} from './state';
import { currentStep } from '../../features/tutorial/ui/tutorial';

/** The tutorial points at a number in the bar: `hud:<name>` in the highlight list pulses it. */
const lit = (name: string) => (highlight.value.includes(`hud:${name}`) ? 'pulse' : '');

/** What the player reads: the sim's ticks per second over 4 (4 ticks a second is the designed pace, "1x"). */
export const speedLabel = (s: number) => `${s / 4}x`;
const speedTitle = (s: number) => `Run at ${speedLabel(s)}`;
const runSteps = SPEEDS.filter((x) => x !== 0);
/** The speed after `v` in the rail's steps, wrapping to the first. */
const nextSpeed = (v: number) => runSteps[(runSteps.indexOf(v as (typeof runSteps)[number]) + 1) % runSteps.length]!;
/** The phone layout (ui.css, the same query): the rail shows the speed only, and a tap on it steps to the next one. */
// Same breakpoint as the CSS in ui.css, so JS and CSS agree at any root font size
const phoneLayout = () => window.matchMedia?.('(max-width: 48em)').matches ?? false;

/**
 * Pause/play plus the speed. Collapsed it is two small buttons (the play state and the current speed); hovering or
 * focusing it, or tapping the speed, opens the other speeds in place. On a phone a tap steps to the next speed.
 */
function SpeedControl() {
  const [open, setOpen] = useState(false);
  const v = speed.value, shown = v === 0 ? lastRunSpeed.value : v, held = holdActive.value;
  // A hold (popup, menu) cannot be lifted here: the rail says "Held" and no resume hint.
  return (
    <div class={`speedctl ${open ? 'open' : ''}`} onMouseLeave={() => setOpen(false)}>
      <button class="icon pp" aria-label={v === 0 ? (held ? 'Held' : 'Resume') : 'Pause'} title={v === 0 ? (held ? 'Held: a popup or the menu holds the clock' : 'Resume (Space)') : 'Pause (Space)'} aria-pressed={v === 0} onClick={() => { if (!held) togglePause(); }}>
        <Icon name={v === 0 && !held ? 'play' : 'pause'} size={14} />
        {v === 0 && <span class="pp-state">{held ? 'Held' : 'Paused'}</span>}
      </button>
      {!phoneLayout() && (
        <button class="icon zs" aria-label="Slow down when zoomed in" aria-pressed={zoomSlowOn.value}
          title={zoomSlowOn.value ? 'Slow motion when zoomed in: on (click to turn off)' : 'Slow motion when zoomed in: off (click to turn on)'} onClick={toggleZoomSlow}>
          <Icon name="gauge" size={14} />
        </button>
      )}
      <div class="seg speeds" role="group" aria-label="Speed" onClick={(e) => {
        // phone: a tap on a step button is handled by that button; a tap on the gap between steps steps here
        if (phoneLayout()) { if (!held && !(e.target as Element).closest('button')) runAt(nextSpeed(shown)); }
        // a speed button runs its speed and closes the rail (above): the click that bubbles here must not reopen it
        else if (!(e.target as Element).closest('button')) setOpen(true);
      }}>
        {runSteps.map((x) => (
          <button key={x} class={shown === x ? 'on' : ''} aria-pressed={shown === x && v !== 0} title={speedTitle(x)} onClick={() => { if (phoneLayout()) { if (!held) runAt(nextSpeed(shown)); } else { runAt(x); setOpen(false); } }}>
            {speedLabel(x)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The game's name over the live board before a game, where the boot screen had it (index.html): it stays as that screen fades. It fades out
 * as the game starts, and stays in the page for that (the HUD keeps the same element).
 */
function Title({ on, quick = false }: { on: boolean; quick?: boolean }) {
  // `quick`: a studio screen covers the room, and the name must not show through it as it fades
  return <div class={`title ${on ? '' : 'gone'} ${quick ? 'quick' : ''}`} aria-hidden={!on}>Pipeline City</div>;
}

/** Space pauses and resumes. It leaves text fields and sliders alone, and an open dialog keeps Space for its own buttons. */
function PauseKey() {
  useEffect(() => {
    const mine = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
      return !document.querySelector('.modal-back, .ng-back, .menu-pop, .pl-menu.settings');
    };
    const down = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      (document.activeElement as HTMLElement | null)?.blur?.(); // a focused button would also take the Space as a press
      if (!holdActive.peek()) togglePause();
    };
    const up = (e: KeyboardEvent) => { if (mine(e)) e.preventDefault(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  // (no pause pill: the speed rail shows the paused state)
  return null;
}

/** Zoomed in, the machine is shown in slow motion so a block can be followed: a line under the rail says so, and how to get the full pace back. */
function SlowNote() {
  const slow = zoomSlowdown.value;
  return slow < 0.97 ? <div class="slow-note" role="status">Slow motion {Math.round(slow * 100)}% <span class="mute">zoomed in · zoom out for full pace</span></div> : null;
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
      // The edge tabs (`.hud-side`) are the HUD's boxes: the bar itself spans the screen, so it is not measured.
      const tabs = [...document.querySelectorAll<HTMLElement>('.hud-side')];
      const sideTabs = tabs.filter((t) => !t.classList.contains('hud-center'));
      const bottomOf = (els: HTMLElement[]) => Math.max(0, ...els.map((t) => t.getBoundingClientRect().bottom));
      // the top-centre tab sits under the side tabs on a narrow screen (its top is the bar's bottom plus a gap)
      if (sideTabs.length) (hud as HTMLElement | null)?.style.setProperty('--bar-h', `${bottomOf(sideTabs)}px`);
      // `--tabs-h`: the bottom of the whole top bar (the phone's level row included), for a card that opens under it
      if (tabs.length) {
        (hud as HTMLElement | null)?.style.setProperty('--tabs-h', `${bottomOf(tabs)}px`);
        next.top = Math.ceil(bottomOf(tabs) + gap);
      }
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

/** OS chip: appears once an OS is installed. Opens the OS panel (resource monitor, spool settings). */
function OsChipButton({ s }: { s: NonNullable<typeof snapshot.value> }) {
  if (!s.os) return null;
  return (
    <button class="chip idle" title="The operating system: resource monitor, job queue and apps" aria-pressed={osOpen.value} onClick={toggleOs}>
      <Icon name="layers" size={12} /> OS {s.os.spool.used}/{s.os.spool.slots}
    </button>
  );
}

/**
 * Esc opens the menu when nothing else is open to take it: an open dialog, a picked part's card or a drag keeps Esc for itself. The menu is the game's
 * pause screen, with the way back to the main menu. ? shows the controls.
 */
function MenuKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const taken = !!document.querySelector('[role="dialog"], [role="alertdialog"], .menu-pop');
      if (e.key === '?') {
        if (taken && !controlsOpen.peek()) return;
        e.preventDefault();
        if (controlsOpen.peek()) closeControls();
        else controlsOpen.value = true;
      } else if (e.key === 'Escape' && !taken && !selected.peek() && !dragging.peek()) gameMenuOpen.value = true;
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  return null;
}

/**
 * The game's menu (the "…" button, or Esc): the game itself (save, the way back to the main menu, files, a new game), tools, the view and help. Kept out of the
 * bar. It closes on Esc and on a click outside, and the arrows move between its entries.
 */
function Menu({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const open = gameMenuOpen.value;
  const root = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const active = currentStep(s, tutorial.value) !== null;
  const close = () => { gameMenuOpen.value = false; };
  // (the phone bar keeps only the money, the speed and the level: these are its other segments, as rows here)
  const bill = billChip(s), net = hudNetChip(s), phone = phoneLayout();
  useEffect(() => {
    if (!open) return;
    const items = () => [...(root.current?.querySelectorAll<HTMLElement>('.menu-pop button[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    // A press on the HUD speed rail is left to its click: that click runs the speed and closes the menu in one step (runAt).
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !(e.target as Element).closest?.('.speeds')) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); root.current?.querySelector<HTMLElement>('button[aria-label="Menu"]')?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items(), at = list.indexOf(document.activeElement as HTMLElement);
      if (!list.length) return;
      e.preventDefault();
      list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]!.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div class="menu" ref={root}>
      <button class={`icon ${open ? 'on' : ''}`} aria-expanded={open} aria-haspopup="menu" aria-label="Menu" title="Menu (Esc)" onClick={() => { gameMenuOpen.value = !open; }}>
        <Icon name="menu" size={14} />
      </button>
      {open && (
        <div class="card menu-pop" role="menu">
          <div class="menu-h">Game</div>
          <button role="menuitem" onClick={() => { saveNow(() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }); }} title="Save the game now. It also saves by itself every 10 seconds."><Icon name={saved ? 'check' : 'save'} size={13} /> {saved ? 'Saved' : 'Save now'}</button>
          <button role="menuitem" onClick={() => { leaveGame(); }} title="Save the game and go back to the main menu"><Icon name="prev" size={13} /> Main menu</button>
          <button role="menuitem" onClick={() => { exportSave(); close(); }} title="Download your game as a file"><Icon name="export" size={13} /> Export game</button>
          <label class="menuitem" title="Load a game file">
            <Icon name="import" size={13} /> Import game
            <input
              type="file" accept="application/json,.json" hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void loadFromFile(f);
                e.currentTarget.value = '';
                close();
              }}
            />
          </label>
          <button class="danger" role="menuitem" onClick={() => { close(); openNewGame(); }} title="Start a fresh game (asks first)"><Icon name="warn" size={13} /> New game</button>
          <div class="menu-h">Tools</div>
          <button role="menuitem" onClick={() => { toggleStats(); close(); }}><Icon name="stats" size={13} /> {statsOpen.value ? 'Hide stats' : 'Stats'}</button>
          <button role="menuitem" onClick={() => { toggleTrace(); close(); }} title="Watch what the CPU and the OS do, event by event, and step the paused machine"><Icon name="wave" size={13} /> {traceOpen.value ? 'Hide trace' : 'Trace'}</button>
          <button role="menuitem" onClick={() => { openMilestones(); close(); }} title="All the levels and what they unlock"><Icon name="gauge" size={13} /> Levels</button>
          {phone && bill && <button role="menuitem" onClick={() => { close(); billOpen.value = true; }} title="Power bill: the rate and the figures behind it"><Icon name="bolt" size={13} /> {bill.text}</button>}
          {phone && <div class="menu-info" role="none" title={statusChip(s).title}>Machine {statusChip(s).text.toLowerCase()}</div>}
          {phone && net && <button role="menuitem" onClick={() => { close(); toggleNet(); }} title={net.title}><Icon name={net.icon} size={13} /> {net.text}</button>}
          {phone && s.os && <button role="menuitem" onClick={() => { close(); toggleOs(); }} title="The operating system: resource monitor, job queue and apps"><Icon name="layers" size={13} /> OS {s.os.spool.used}/{s.os.spool.slots}</button>}
          {phone && <button role="menuitem" onClick={toggleZoomSlow} title="Slow motion when zoomed in: the machine runs slower while you zoom in"><Icon name="gauge" size={13} /> Zoom slow {zoomSlowOn.value ? 'on' : 'off'}</button>}
          <div class="menu-h">View</div>
          <button role="menuitem" aria-haspopup="dialog" onClick={() => { close(); openSettings('paused'); }} title="Picture, light, detail and the interface size"><Icon name="screen" size={13} /> Settings</button>
          <div class="menu-h">Help</div>
          <button role="menuitem" onClick={() => { openControlsFromMenu(); }} title="Every key and mouse move (press ? any time)"><Icon name="sliders" size={13} /> Controls</button>
          <button role="menuitem" onClick={() => { replayTutorial(s); close(); }} title="Run the tutorial again from the start"><Icon name="play" size={13} /> Replay tutorial</button>
          {active && <button role="menuitem" onClick={() => { skipTutorial(); close(); }} title="Stop the tutorial"><Icon name="check" size={13} /> Skip tutorial</button>}
          <button role="menuitem" onClick={() => { resetHints(); close(); }} title="Show the hints you have dismissed"><Icon name="star" size={13} /> Show hints again</button>
        </div>
      )}
    </div>
  );
}

/** A game is starting (the worker boots): this stands where the menu was, so the click is seen at once. The ring turns on the compositor, so it turns while the page works. */
function Starting({ text = 'Starting…' }: { text?: string }) {
  return (
    <div class="starting" role="status" aria-live="polite">
      <i class="starting-ring" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function Hud() {
  const s = snapshot.value;
  // (the menu shows over the boot screen while the world loads, app/boot.ts: what needs the 3D world waits for `booted`, and a game chosen
  // meanwhile starts when the screen goes, `startSim`)
  // (a game that is starting stands in place of the menu; the notice shows a refused file here as in a game)
  if (!s) {
    const ready = booted.value;
    return (
      <>
        {starting.value ? <Starting text={ready ? 'Starting…' : 'Getting the room ready…'} /> : <MainMenu ready={ready} />}
        <NewGameScreen />
        {ready && <><Gallery /><BuildMode /></>}
        <LoadConfirm />
        <div class="stack"><Notice /></div>
      </>
    );
  }
  return (
    <>
      <Title on={false} />
      <InsetReporter />
      <PauseKey />
      <MenuKeys />
      <header class="hud">
        <div class="hud-side hud-left">
          {/* what the player earns and spends, then what the machine is doing, then (a sandbox) its tools: three groups with a hairline between */}
          <div class="hud-grp hud-econ">
            <div class={`money ${lit('money')}`} data-hud="money" title="Money. Finish client keys to earn more.">{s.sandbox ? '∞' : fmtMoney(s.money)}</div>
            <span class="time" title="Game time">{fmtTicks(s.baseTick)}</span>
            <Reputation s={s} />
            <PowerBill s={s} />
          </div>
          <i class="hud-sep" aria-hidden="true" />
          <div class="hud-grp hud-sys">
            <PhaseChip s={s} />
            <NetChipButton s={s} />
            <OsChipButton s={s} />
          </div>
          {s.sandbox && (
            <>
              <i class="hud-sep" aria-hidden="true" />
              <div class="hud-grp hud-sbx" role="group" aria-label="Sandbox">
                <SandboxTools s={s} />
                <SandboxJobs s={s} />
              </div>
            </>
          )}
        </div>
        {/* (a sandbox pins the rules level: its Jobs button says it, so the bar has no second pill for it) */}
        {!s.sandbox && <div class={`hud-side hud-center ${lit('level')}`} data-hud="level"><LevelBar s={s} /></div>}
        <div class="hud-side hud-right">
          <SpeedControl />
          <Menu s={s} />
          <SlowNote />
        </div>
      </header>
      <PickerCard />
      <NewGameScreen />
      <MilestoneScreen s={s} />
      <Shop s={s} />
      {statsOpen.value && (
        <aside class="dock" aria-label="Stats">
          <button class="close" aria-label="Close stats" onClick={toggleStats}><Icon name="close" size={11} /></button>
          <Stats />
        </aside>
      )}
      <NetDock />
      <SettingsScreen />
      <LoadConfirm />
      <Controls />
      {leaving.value && <Starting text="Saving…" />}
      <OsModal />
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
