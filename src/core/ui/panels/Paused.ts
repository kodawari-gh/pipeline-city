import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { batch } from '@preact/signals';
import {
  autosaveAt,
  exportSave,
  lastRunSpeed,
  saveNow,
  saving,
  snapshot,
  toggleZoomSlow,
  zoomSlowOn,
} from '@/app/store';
import { traceOpen } from '@/app/scrub';
import type { Snapshot } from '@/worker/game/game';
import { billChip, fmtTicks, statusChip } from '../logic';
import { cycleValue, mouseMayMoveFocus, moveFocus } from '../menuNav';
import { DisplayTitle, PHONE_QUERY, STAGES, TestPoint, TraceLayer } from '../kit/Pipeline';
import {
  billOpen,
  gameMenuOpen,
  menuReturnFocus,
  openControlsFromMenu,
  openMilestones,
  openSettings,
  replayTutorial,
  resetHints,
  skipTutorial,
  statsOpen,
  toggleNet,
  toggleOs,
  toggleStats,
  tutorial,
} from '../state';
import { leaveGame } from '../leave';
import { loadFromFile } from './loadgame';
import { openNewGame } from './NewGame';

// The PAUSED screen (ticket #40; SPEC §5.10, §9, §10): the in-game menu, opened by Esc or the Menu button. A Pipeline spine over the frozen room:
// Resume (the hero), Save now, Settings, Controls, Main menu, then the utility line Files, Tools and Help, each with its own list. It holds the
// clock while it is open (state.ts). Keys: ↑ ↓ move, ← → move along the utility line, Enter opens, Esc closes the inner list, then the menu.
// Styles: ui.css (the Pipeline section, `.pl-menu.paused`).

/** The spine labels, top to bottom: Resume first, then the rows, then the utilities. */
export const PAUSE_SPINE = [
  'Resume',
  'Save now',
  'Settings',
  'Controls',
  'Main menu',
  'Files',
  'Tools',
  'Help',
] as const;

/** What a screen reader hears when the screen opens. */
export const PAUSED_ANNOUNCE = 'Paused. Clock stopped.';

type Branch = 'files' | 'tools' | 'help';
const BRANCHES: Branch[] = ['files', 'tools', 'help'];
const BRANCH_LABEL: Record<Branch, string> = { files: 'Files', tools: 'Tools', help: 'Help' };

// The sound of each entry (`data-cue`, src/app/audio/uiCues.ts). Resume closes the screen like Back; the rest click. Screens that open play a transition after the click.
const ROW_CUE: Record<string, string> = { Resume: 'ui_back', 'Save now': 'ui_confirm', 'Main menu': 'ui_confirm' };
const ROW_NEXT: Record<string, string> = {
  Settings: 'ui_transition_in',
  Controls: 'ui_transition_in',
  'Main menu': 'ui_transition_out',
};
const SUB_NEXT: Record<string, string> = {
  'New game': 'ui_transition_in',
  Levels: 'ui_transition_in',
  OS: 'ui_transition_in',
};
/** The focus group of the utility line (the stage after the five rows). */
const UTIL = 5;

/**
 * The labels of the three utility lists. `phone`: the HUD segments that the phone bar does not show are rows of Tools (power bill, machine
 * state, net, OS) with the slow motion switch. `tutorial`: Skip tutorial is listed while the tutorial runs.
 */
export function utilityLists(phone: boolean, tutorial = false): { files: string[]; tools: string[]; help: string[] } {
  return {
    files: ['Export game', 'Import game', 'New game'],
    tools: phone
      ? ['Stats', 'Trace', 'Levels', 'Power bill', 'Machine', 'Network', 'OS', 'Zoom slow']
      : ['Stats', 'Trace', 'Levels'],
    help: tutorial ? ['Replay tutorial', 'Skip tutorial', 'Show hints again'] : ['Replay tutorial', 'Show hints again'],
  };
}

/** What one Esc closes: the open utility list first, then the screen. `null`: nothing is open. */
export function escTarget(layers: { list: boolean; menu: boolean }): 'list' | 'menu' | null {
  if (layers.list) return 'list';
  return layers.menu ? 'menu' : null;
}

/** The meta of Save now: how long ago the game was saved (SPEC §5.10, the sample "saved 10 s ago"). */
function savedAgo(at: number): string {
  const secs = Math.round((Date.now() - at) / 1000);
  if (secs < 60) return `saved ${Math.max(0, secs)} s ago`;
  const min = Math.floor(secs / 60);
  return min < 60 ? `saved ${min} min ago` : `saved ${Math.floor(min / 60)} h ago`;
}

/** A row of a utility list: its text (today's wording, with the toggled state), its title and its action. */
type Item = { label: string; text: string; title?: string; danger?: boolean; info?: boolean; run: () => void };
type Row = { label: string; meta?: string; hero?: boolean; title?: string; run: () => void };

/** What the HUD tells the screen about two features, so core code imports none: the network chip and whether a tutorial step is on. */
export interface PausedFeatures {
  netChip: (s: Snapshot) => { text: string; title: string } | null;
  tutorialOn: (s: Snapshot) => boolean;
}
const NO_FEATURES: PausedFeatures = { netChip: () => null, tutorialOn: () => false };

const toggleTrace = () => {
  traceOpen.value = !traceOpen.value;
};

/** The Paused screen. Shows only while the menu is open (`gameMenuOpen`); its live region is always mounted, so the status is announced. */
export function Paused({ features = NO_FEATURES }: { features?: PausedFeatures } = {}) {
  const s = snapshot.value;
  const open = gameMenuOpen.value;
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  // The focused group: 0 to 4 are the rows, UTIL the utility line.
  const [at, setAt] = useState(0);
  // The open utility list. Its ref is read by the Esc handler, which closes the list before the screen.
  const [branch, setBranchState] = useState<Branch | null>(null);
  const branchRef = useRef<Branch | null>(null);
  const setBranch = (b: Branch | null) => {
    branchRef.current = b;
    setBranchState(b);
  };
  const lastKey = useRef<number | null>(null);
  // The layout (SPEC §6.1) and the HUD's own phone breakpoint (ui.css, Hud.tsx): the bar hides its segments at the second one.
  const phone = window.matchMedia?.(PHONE_QUERY).matches ?? false;
  const hudPhone = window.matchMedia?.('(max-width: 48em)').matches ?? false;
  void tutorial.value; // (the tutorial state is read here, so the screen draws again when a step changes)
  const tutorialOn = s !== null && features.tutorialOn(s);
  const bill = s ? billChip(s) : null;
  const net = s ? features.netChip(s) : null;

  const close = () => {
    setBranch(null);
    gameMenuOpen.value = false;
  };
  const trigger = () => document.querySelector<HTMLElement>('.menu > button[aria-label="Menu"]');
  const hold = (g: number) => {
    if (mouseMayMoveFocus(lastKey.current, Date.now())) setAt(g);
  };
  const groupEl = (g: number) => root.current?.querySelector<HTMLElement>(`[data-group="${g}"]`);
  const groups = () => [
    ...new Set(
      [...(root.current?.querySelectorAll<HTMLElement>('[data-group]:not(:disabled)') ?? [])].map((el) =>
        Number(el.dataset.group),
      ),
    ),
  ];
  const utils = () => [...(root.current?.querySelectorAll<HTMLElement>('.pl-util:not(:disabled)') ?? [])];
  const subs = () => [...(root.current?.querySelectorAll<HTMLElement>('.pl-sub-item') ?? [])];

  const onFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void loadFromFile(f);
    input.value = '';
    close();
  };

  const rows: Row[] = [
    {
      label: 'Resume',
      meta: `at ${lastRunSpeed.value / 4}x`,
      hero: true,
      title: 'Resume the game at the speed it ran at',
      run: () => {
        close();
        trigger()?.focus();
      },
    },
    {
      label: 'Save now',
      meta: saving.value
        ? 'saving…'
        : saved
          ? 'saved just now'
          : autosaveAt.value === null
            ? 'not saved yet'
            : savedAgo(autosaveAt.value),
      title: 'Save the game now. It also saves by itself every 10 seconds.',
      run: () => {
        saveNow(() => {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        });
      },
    },
    // Settings and Controls leave the menu for their own screen: the clock stays held (batch: no resume between the two writes).
    {
      label: 'Settings',
      title: 'Picture, light, detail and the interface size',
      run: () =>
        batch(() => {
          close();
          menuReturnFocus.value = 'Settings';
          openSettings('paused');
        }),
    },
    {
      label: 'Controls',
      title: 'Every key and mouse move (press ? any time)',
      run: () => {
        openControlsFromMenu();
      },
    },
    {
      label: 'Main menu',
      meta: 'saves first',
      title: 'Save the game and go back to the main menu',
      run: () => {
        leaveGame();
      },
    },
  ];

  /** The row of a utility list for its label, or null when the HUD does not show it now (no power bill, no net, no OS). */
  const itemFor = (label: string): Item | null => {
    switch (label) {
      case 'Export game':
        return {
          label,
          text: label,
          title: 'Download your game as a file',
          run: () => {
            exportSave();
            close();
          },
        };
      case 'Import game':
        return { label, text: label, title: 'Load a game file', run: () => fileInput.current?.click() };
      case 'New game':
        return {
          label,
          text: label,
          title: 'Start a fresh game (asks first)',
          danger: true,
          run: () => {
            close();
            openNewGame();
          },
        };
      case 'Stats':
        return {
          label,
          text: statsOpen.value ? 'Hide stats' : 'Stats',
          run: () => {
            toggleStats();
            close();
          },
        };
      case 'Trace':
        return {
          label,
          text: traceOpen.value ? 'Hide trace' : 'Trace',
          title: 'Watch what the CPU and the OS do, event by event, and step the paused machine',
          run: () => {
            toggleTrace();
            close();
          },
        };
      case 'Levels':
        return {
          label,
          text: label,
          title: 'All the levels and what they unlock',
          run: () => {
            openMilestones();
            close();
          },
        };
      case 'Power bill':
        return bill
          ? {
              label,
              text: bill.text,
              title: 'Power bill: the rate and the figures behind it',
              run: () => {
                close();
                billOpen.value = true;
              },
            }
          : null;
      case 'Machine':
        return s
          ? {
              label,
              text: `Machine ${statusChip(s).text.toLowerCase()}`,
              title: statusChip(s).title,
              info: true,
              run: () => {},
            }
          : null;
      case 'Network':
        return net
          ? {
              label,
              text: net.text,
              title: net.title,
              run: () => {
                close();
                toggleNet();
              },
            }
          : null;
      case 'OS':
        return s?.os
          ? {
              label,
              text: `OS ${s.os.spool.used}/${s.os.spool.slots}`,
              title: 'The operating system: resource monitor, job queue and apps',
              run: () => {
                close();
                toggleOs();
              },
            }
          : null;
      case 'Zoom slow':
        return {
          label,
          text: `Zoom slow ${zoomSlowOn.value ? 'on' : 'off'}`,
          title: 'Slow motion when zoomed in: the machine runs slower while you zoom in',
          run: () => {
            toggleZoomSlow();
          },
        };
      case 'Replay tutorial':
        return {
          label,
          text: label,
          title: 'Run the tutorial again from the start',
          run: () => {
            if (s) replayTutorial(s);
            close();
          },
        };
      case 'Skip tutorial':
        return {
          label,
          text: label,
          title: 'Stop the tutorial',
          run: () => {
            skipTutorial();
            close();
          },
        };
      case 'Show hints again':
        return {
          label,
          text: label,
          title: 'Show the hints you have dismissed',
          run: () => {
            resetHints();
            close();
          },
        };
      default:
        return null;
    }
  };
  const itemsOf = (b: Branch): Item[] =>
    utilityLists(hudPhone, tutorialOn)[b].flatMap((l) => {
      const it = itemFor(l);
      return it ? [it] : [];
    });

  // The first row (or the row Settings returned to) takes focus when the screen opens; the Esc and outside-click handlers are live while it is open.
  useEffect(() => {
    if (!open) {
      setBranch(null);
      return;
    }
    const want = menuReturnFocus.peek();
    menuReturnFocus.value = null;
    const list = [...(root.current?.querySelectorAll<HTMLElement>('.pl-row') ?? [])];
    const first = list.find((el) => want !== null && el.textContent?.includes(want)) ?? list[0];
    first?.focus();
    if (first?.dataset.group !== undefined) setAt(Number(first.dataset.group));
    // A press outside the screen closes it; a press on the HUD speed rail is left to its click (runAt closes the menu in one step).
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !(e.target as Element).closest?.('.speeds'))
        close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const inner = branchRef.current;
      if (escTarget({ list: inner !== null, menu: true }) === 'list') {
        setBranch(null);
        root.current?.querySelector<HTMLElement>(`.pl-util[aria-controls="pl-${inner}"]`)?.focus();
        return;
      }
      close();
      trigger()?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
    };
    // (re-run only when the screen opens or closes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A list opened from its utility line takes focus on its first entry.
  useEffect(() => {
    if (branch) root.current?.querySelector<HTMLElement>(`#pl-${branch} [role="menuitem"]`)?.focus();
  }, [branch]);

  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    lastKey.current = Date.now();
    const active = document.activeElement as HTMLElement | null;
    // Inside an open list, ↑ ↓ move along it.
    if (active?.classList.contains('pl-sub-item')) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = subs();
      const next = moveFocus(list.length, list.indexOf(active), e.key);
      e.preventDefault();
      list[next]?.focus();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // ← → move between the utility buttons, and the chip moves to the utility line.
      const list = utils();
      const i = list.indexOf(active as HTMLElement);
      if (i === -1) return;
      e.preventDefault();
      setAt(UTIL);
      list[cycleValue(list.length, i, e.key)]!.focus();
      return;
    }
    const gs = groups();
    const next = moveFocus(gs.length, gs.indexOf(Number(active?.dataset.group)), e.key);
    if (next < 0) return;
    e.preventDefault();
    const g = gs[next]!;
    setAt(g);
    groupEl(g)?.focus();
  };

  const rowEl = (r: Row, g: number) =>
    h(
      'button',
      {
        key: r.label,
        class: `mm-btn pl-row ${r.hero ? 'hero' : ''} ${at === g ? 'pl-chip' : ''}`,
        role: 'menuitem',
        'data-group': g,
        title: r.title,
        'data-cue': ROW_CUE[r.label] ?? 'ui_click',
        'data-cue-next': ROW_NEXT[r.label],
        onPointerEnter: () => hold(g),
        onFocus: () => hold(g),
        onClick: r.run,
      },
      h('span', { class: 'pl-tag', 'data-tag': STAGES[g], 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'pl-text' },
        h('span', { class: 'pl-label' }, r.label),
        r.meta && h('span', { class: 'pl-meta-row' }, r.meta),
      ),
    );

  const utilEl = (b: Branch) => {
    const label = BRANCH_LABEL[b];
    const isOpen = branch === b;
    return h(
      'span',
      { key: b, class: 'pl-util-item', role: 'none' },
      h(
        'button',
        {
          class: 'mm-btn pl-util',
          role: 'menuitem',
          'data-cue': 'ui_click',
          'aria-haspopup': 'menu',
          'aria-expanded': isOpen,
          'aria-controls': `pl-${b}`,
          'data-group': UTIL,
          onFocus: () => hold(UTIL),
          onPointerEnter: () => hold(UTIL),
          onClick: () => setBranch(isOpen ? null : b),
        },
        label,
      ),
      isOpen &&
        h(
          'div',
          { class: 'pl-sub', id: `pl-${b}`, role: 'group', 'aria-label': label },
          itemsOf(b).map((it) =>
            it.info
              ? h('div', { key: it.label, class: 'menu-info', role: 'none', title: it.title }, it.text)
              : h(
                  'button',
                  {
                    key: it.label,
                    class: `mm-btn pl-sub-item ${it.danger ? 'danger' : ''}`,
                    role: 'menuitem',
                    title: it.title,
                    'data-cue': 'ui_click',
                    'data-cue-next': SUB_NEXT[it.label],
                    onClick: it.run,
                  },
                  it.text,
                ),
          ),
        ),
    );
  };

  const layer = (state: NonNullable<typeof s>) =>
    h(
      'div',
      { class: 'pl-menu paused', 'data-cue': 'ui_panel_open', ref: root, onKeyDown: onKey },
      h('input', {
        ref: fileInput,
        type: 'file',
        accept: 'application/json,.json',
        hidden: true,
        'data-cue': 'silent',
        onChange: onFile,
      }),
      saved &&
        h('div', { class: 'card toast menu-toast', role: 'status' }, h('b', null, '[ ok ]'), h('span', null, 'Saved')),
      h(
        'div',
        { class: 'pl-stack' },
        h(DisplayTitle, {
          lines: ['Paused'],
          meta: phone
            ? `Clock stopped at ${fmtTicks(state.baseTick)}`
            : `Clock stopped at ${fmtTicks(state.baseTick)} · resumes at ${lastRunSpeed.value / 4}x`,
        }),
        h(
          'div',
          { class: 'pl-spine', role: 'menu', 'aria-label': 'Paused' },
          rows.map((r, g) => rowEl(r, g)),
          h(
            'div',
            { class: 'pl-util-row', role: 'none' },
            h('span', { class: `pl-tag pl-util-tag ${at === UTIL ? 'pl-chip' : ''}`, 'aria-hidden': 'true' }),
            BRANCHES.map(utilEl),
          ),
          !phone && h(TestPoint, null),
        ),
        !phone && h('p', { class: 'pl-hints' }, '↑ ↓ move   Enter open   Esc resume'),
        h(TraceLayer, { root, at, tp: !phone }),
      ),
    );

  return h(
    Fragment,
    null,
    // the live region is always mounted, so the status is announced when the screen opens
    h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' }, open ? PAUSED_ANNOUNCE : ''),
    open && s ? layer(s) : null,
  );
}
