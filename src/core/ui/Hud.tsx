import './ui.css';
import { useEffect, useState } from 'preact/hooks';
import { selected, viewInset } from '../../app/hover';
import { booted } from '../../app/boot';
import { dragging, highlight } from '../../app/interaction';
import {
  lastRunSpeed,
  leaving,
  snapshot,
  speed,
  starting,
  toggleZoomSlow,
  togglePause,
  zoomSlowOn,
  zoomSlowdown,
} from '../../app/store';
import { SPEEDS } from '../../worker/protocol';
import { fmtMoney, fmtNum, fmtTicks, isOsActivity, statusChip } from './logic';
import { Icon } from './kit/Icons';
import { hudNetChip } from '../../features/network/ui/netui';
import { currentStep } from '../../features/tutorial/ui/tutorial';
import { PowerBill } from '../../features/economy/ui/progress/PowerBill';
import { InventoryBar, InventoryPanel } from '../../features/economy/ui/shop/Inventory';
import { PickerCard } from '../../features/economy/ui/shop/PickerCard';
import { Stats } from './panels/Stats';
import { NetDock } from '../../features/network/ui/NetPanel';
import { OsModal } from '../../features/os/ui/OsPanel';
import { Tooltip } from './kit/Hover';
import { Notice, Toasts } from './panels/Toasts';
import { watchPanelCues } from './panelCues';
import { NewGameScreen } from './panels/NewGame';
import { MainMenu } from './panels/MainMenu';
import { Paused, type PausedFeatures } from './panels/Paused';
import { LoadConfirm } from './panels/LoadConfirm';
import { Controls } from './panels/Controls';
import { SandboxJobs } from '../../features/sandbox/ui/SandboxJobs';
import { SandboxTools } from '../../features/sandbox/ui/SandboxTools';
import { LevelBar, LevelUpModal, MilestoneScreen } from '../../features/economy/ui/progress/Levels';
import { BuildMode, Gallery, Shop } from '../../features/economy/ui/shop/Shop';
import { TutorialCard } from '../../features/tutorial/ui/TutorialCard';
import { TracePanel } from '../../features/cpu/ui/TracePanel';
import { AlmanacPanel } from '../../features/jobs/ui/AlmanacPanel';
import { LogPanel } from './panels/LogPanel';
import { CrashPanel } from './panels/CrashPanel';
import { SettingsScreen } from './panels/Settings';
import {
  buildOpen,
  closeControls,
  controlsOpen,
  galleryOpen,
  gameMenuOpen,
  holdActive,
  netOpen,
  osOpen,
  runAt,
  toggleOs,
  statsOpen,
  toggleNet,
  toggleStats,
  tutorial,
} from './state';

/** What the Paused screen needs from two features (it imports none itself). */
const PAUSED_FEATURES: PausedFeatures = {
  netChip: hudNetChip,
  tutorialOn: (s) => currentStep(s, tutorial.value) !== null,
};

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
  const v = speed.value,
    shown = v === 0 ? lastRunSpeed.value : v,
    held = holdActive.value;
  // A hold (popup, menu) cannot be lifted here: the rail says "Held" and no resume hint.
  return (
    <div class={`speedctl ${open ? 'open' : ''}`} onMouseLeave={() => setOpen(false)}>
      <button
        class="icon pp"
        data-cue="silent"
        aria-label={v === 0 ? (held ? 'Held' : 'Resume') : 'Pause'}
        title={v === 0 ? (held ? 'Held: a popup or the menu holds the clock' : 'Resume (Space)') : 'Pause (Space)'}
        aria-pressed={v === 0}
        onClick={() => {
          if (!held) togglePause();
        }}
      >
        <Icon name={v === 0 && !held ? 'play' : 'pause'} size={14} />
        {v === 0 && <span class="pp-state">{held ? 'Held' : 'Paused'}</span>}
      </button>
      {!phoneLayout() && (
        <button
          class="icon zs"
          data-cue="ui_click"
          aria-label="Slow down when zoomed in"
          aria-pressed={zoomSlowOn.value}
          title={
            zoomSlowOn.value
              ? 'Slow motion when zoomed in: on (click to turn off)'
              : 'Slow motion when zoomed in: off (click to turn on)'
          }
          onClick={toggleZoomSlow}
        >
          <Icon name="gauge" size={14} />
        </button>
      )}
      <div
        class="seg speeds"
        role="group"
        aria-label="Speed"
        onClick={(e) => {
          // phone: a tap on a step button is handled by that button; a tap on the gap between steps steps here
          if (phoneLayout()) {
            if (!held && !(e.target as Element).closest('button')) runAt(nextSpeed(shown));
          }
          // a speed button runs its speed and closes the rail (above): the click that bubbles here must not reopen it
          else if (!(e.target as Element).closest('button')) setOpen(true);
        }}
      >
        {runSteps.map((x) => (
          <button
            key={x}
            data-cue="silent"
            class={shown === x ? 'on' : ''}
            aria-pressed={shown === x && v !== 0}
            title={speedTitle(x)}
            onClick={() => {
              if (phoneLayout()) {
                if (!held) runAt(nextSpeed(shown));
              } else {
                runAt(x);
                setOpen(false);
              }
            }}
          >
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
  return (
    <div class={`title ${on ? '' : 'gone'} ${quick ? 'quick' : ''}`} aria-hidden={!on}>
      Pipeline City
    </div>
  );
}

/** Space pauses and resumes. It leaves text fields and sliders alone, and an open dialog keeps Space for its own buttons. */
function PauseKey() {
  useEffect(() => {
    const mine = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
      return !document.querySelector('.modal-back, .ng-back, .pl-menu.paused, .pl-menu.settings');
    };
    const down = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      (document.activeElement as HTMLElement | null)?.blur?.(); // a focused button would also take the Space as a press
      if (!holdActive.peek()) togglePause();
    };
    const up = (e: KeyboardEvent) => {
      if (mine(e)) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  // (no pause pill: the speed rail shows the paused state)
  return null;
}

/** Zoomed in, the machine is shown in slow motion so a block can be followed: a line under the rail says so, and how to get the full pace back. */
function SlowNote() {
  const slow = zoomSlowdown.value;
  return slow < 0.97 ? (
    <div class="slow-note" role="status">
      Slow motion {Math.round(slow * 100)}% <span class="mute">zoomed in · zoom out for full pace</span>
    </div>
  ) : null;
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
      const W = window.innerWidth,
        H = window.innerHeight;
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
          if (!el.classList.contains('away'))
            invKept = side
              ? { side: 'right', v: Math.ceil(W - r.left + gap) }
              : { side: 'bottom', v: Math.ceil(H - r.top + gap) };
          if (invKept) next[invKept.side] = Math.max(next[invKept.side], invKept.v);
        } else if (side) {
          if (r.left + r.width / 2 < W / 2) next.left = Math.max(next.left, Math.ceil(r.right + gap));
          else next.right = Math.max(next.right, Math.ceil(W - r.left + gap));
        } else next.bottom = Math.max(next.bottom, Math.ceil(H - r.top + gap));
      }
      if (!invSeen) invKept = null;
      const cur = viewInset.peek();
      if (cur.top !== next.top || cur.right !== next.right || cur.bottom !== next.bottom || cur.left !== next.left)
        viewInset.value = next;
    };
    measure();
    const mo = hud ? new MutationObserver(measure) : null;
    // `style` too: the tutorial card's height is set in its style (its fit), and the picker moves by its style.
    if (hud)
      mo!.observe(hud, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', measure);
    return () => {
      mo?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return null;
}

function Reputation({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const perMin = s.demandRate * 60;
  return (
    <div
      class={`stat ${lit('reputation')}`}
      data-hud="reputation"
      title={`Reputation ${fmtNum(s.reputation, 2)}: from how fast you answer. Demand ${fmtNum(perMin, 1)} keys a minute.`}
    >
      <Icon name="star" size={14} />
      <span class="value">{fmtNum(s.reputation, 2)}</span>
    </div>
  );
}

/** Machine phase chip: Off, POST, Waiting for key, Loading, Running, Writing, Remove key, Error + reason. */
function PhaseChip({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const c = statusChip(s);
  // The chip pulses while the OS is doing work; `.paused` on the root stops it when the game is paused.
  return (
    <span class={`chip ${c.level} ${isOsActivity(s.phase) ? 'live' : ''}`} role="status" title={c.title}>
      {c.text}
    </span>
  );
}

/** Network chip: appears once a router exists, shows the link speed or why there is none. Opens the network panel. */
function NetChipButton({ s }: { s: NonNullable<typeof snapshot.value> }) {
  const c = hudNetChip(s);
  if (!c) return null;
  return (
    <button
      class={`chip ${c.level}`}
      data-cue="ui_click"
      title={c.title}
      aria-pressed={netOpen.value}
      onClick={toggleNet}
    >
      <Icon name={c.icon} size={12} /> {c.text}
    </button>
  );
}

/** OS chip: appears once an OS is installed. Opens the OS panel (resource monitor, spool settings). */
function OsChipButton({ s }: { s: NonNullable<typeof snapshot.value> }) {
  if (!s.os) return null;
  return (
    <button
      class="chip idle"
      data-cue="ui_click"
      data-cue-next="ui_transition_in"
      title="The operating system: resource monitor, job queue and apps"
      aria-pressed={osOpen.value}
      onClick={toggleOs}
    >
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
      const taken = !!document.querySelector('[role="dialog"], [role="alertdialog"], .pl-menu.paused');
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

/** What "Starting…" says to do next: wait a few seconds, and reload when nothing comes (a worker that fails shows its own notice, `store.ts`). */
const STARTING_HINT = 'This takes a few seconds. If nothing happens, reload the page.';

/** A game is starting (the worker boots): this stands where the menu was, so the click is seen at once. The ring turns on the compositor, so it turns while the page works. */
function Starting({ text = 'Starting…', hint }: { text?: string; hint?: string }) {
  return (
    <div class="starting" role="status" aria-live="polite">
      <i class="starting-ring" aria-hidden="true" />
      <span class="starting-text">
        {text}
        {hint && <small class="starting-hint">{hint}</small>}
      </span>
    </div>
  );
}

export function Hud() {
  const s = snapshot.value;
  useEffect(() => watchPanelCues(), []);
  // (the menu shows over the boot screen while the world loads, app/boot.ts: what needs the 3D world waits for `booted`, and a game chosen
  // meanwhile starts when the screen goes, `startSim`)
  // (a game that is starting stands in place of the menu; the notice shows a refused file here as in a game)
  if (!s) {
    const ready = booted.value;
    return (
      <>
        {starting.value ? (
          <Starting text={ready ? 'Starting…' : 'Getting the room ready…'} hint={STARTING_HINT} />
        ) : (
          <MainMenu ready={ready} />
        )}
        <NewGameScreen />
        {ready && (
          <>
            <Gallery />
            <BuildMode />
          </>
        )}
        <LoadConfirm />
        <div class="stack over-menu">
          <Notice />
        </div>
      </>
    );
  }
  const menuOpen = gameMenuOpen.value;
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
            <div class={`money ${lit('money')}`} data-hud="money" title="Money. Finish client keys to earn more.">
              {s.sandbox ? '∞' : fmtMoney(s.money)}
            </div>
            <span class="time" title="Game time">
              {fmtTicks(s.baseTick)}
            </span>
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
        {!s.sandbox && (
          <div class={`hud-side hud-center ${lit('level')}`} data-hud="level">
            <LevelBar s={s} />
          </div>
        )}
        <div class="hud-side hud-right">
          <SpeedControl />
          <div class="menu">
            <button
              class={`icon ${menuOpen ? 'on' : ''}`}
              data-cue="silent"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Menu"
              title="Menu (Esc)"
              onClick={() => {
                gameMenuOpen.value = !menuOpen;
              }}
            >
              <Icon name="menu" size={14} />
            </button>
          </div>
          <SlowNote />
        </div>
      </header>
      <Paused features={PAUSED_FEATURES} />
      <PickerCard />
      <NewGameScreen />
      <MilestoneScreen s={s} />
      <Shop s={s} />
      {statsOpen.value && (
        <aside class="dock" aria-label="Stats">
          <button class="close" data-cue="ui_panel_close" aria-label="Close stats" onClick={toggleStats}>
            <Icon name="close" size={11} />
          </button>
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
