// UI-only signals: theme, the stats panel, hint toasts, the guided tutorial's per-viewer state.
// Everything persisted is per-viewer (localStorage) and wrapped in try/catch. The tutorial's progress itself comes
// from the snapshot's `progress` flags, so it survives a save/load; localStorage only remembers skip/finish/replay.

import { effect, signal } from '@preact/signals';
import { selected } from '../game/hover';
import { snapshot, speed, togglePause } from '../game/store';
import type { Snapshot } from '../sim/protocol';
import { celebrationFor, reconcileSeen, type Celebration } from './levelui';
import { fillToasts, fitFilterFor, fitsFilter, newHints, totalStalls, type Hint } from './logic';
import { currentStep, INITIAL_TUTORIAL, resumeState, type TutorialState } from './tutorial';

const THEME_KEY = 'pipeline-city.theme';
const HINTS_KEY = 'pipeline-city.hints';
const TUTORIAL_KEY = 'pipeline-city.tutorial';
const SCALE_KEY = 'pipeline-city.uiScale';

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked or full: ignore */ }
}

// ---- theme ----

export type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  const saved = readStore(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}

export const theme = signal<Theme>(initialTheme());
/** The renderer and the CSS read `data-theme` on the root element. */
effect(() => { document.documentElement.setAttribute('data-theme', theme.value); });
export function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  writeStore(THEME_KEY, theme.value);
}

// ---- UI size (multiplies the root font size, see docs/UI.md "Scaling") ----

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const clampScale = (v: number) => (Number.isFinite(v) ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(v * 20) / 20)) : 1);
export const uiScale = signal<number>(clampScale(Number(readStore(SCALE_KEY) ?? 1)));
effect(() => { document.documentElement.style.setProperty('--ui-scale', String(uiScale.value)); });
export function setUiScale(v: number) {
  uiScale.value = clampScale(v);
  writeStore(SCALE_KEY, String(uiScale.value));
}

// ---- stats drawer (part upgrades live in the contextual picker) ----

// Paused (speed 0): UI animations that show sim activity stop too. CSS keys on `.paused` at the root (see `.sim-anim`).
// Purely interactive feedback (hover, panels, toasts) is not frozen.
effect(() => { document.documentElement.classList.toggle('paused', speed.value === 0); });

export const statsOpen = signal(false);
export const netOpen = signal(false);
// The two drawers dock on the same side: opening one closes the other.
export const toggleStats = () => { statsOpen.value = !statsOpen.value; if (statsOpen.value) netOpen.value = false; };
/** The network panel (opened from the HUD chip once a router exists). */
export const toggleNet = () => { netOpen.value = !netOpen.value; if (netOpen.value) statsOpen.value = false; };

// ---- milestone screen (the ladder of levels; opened from the HUD level bar, the menu and a locked tile) ----

/** Open flag and the level to scroll to (null: the current level). */
export const milestones = signal<{ focus: number | null } | null>(null);
export const openMilestones = (focus: number | null = null) => { milestones.value = { focus }; };
export const closeMilestones = () => { milestones.value = null; };

// ---- inventory tray (spare parts; drag them from here onto the board) ----

export const inventoryOpen = signal(false);
export const toggleInventory = () => { inventoryOpen.value = !inventoryOpen.value; };
/** Shelf filter by kind (null = all). */
export const inventoryKind = signal<string | null>(null);
/**
 * The world id whose fitting parts the shelf is showing (set by selecting something on the PC, kept while a tile is picked,
 * cleared by "Show all" or by selecting something that has no fitting parts to offer).
 */
export const fitTarget = signal<string | null>(null);

effect(() => {
  const sel = selected.value;
  if (!sel || sel.startsWith('inv:')) { if (!sel) fitTarget.value = null; return; }
  const s = snapshot.peek();
  const f = fitFilterFor(sel, s);
  const any = !!f && !!s && s.inventory.some((it) => fitsFilter(f, it));
  fitTarget.value = any ? sel : null;
  if (any) { inventoryOpen.value = true; inventoryKind.value = null; }
});

// ---- guided tutorial (per viewer) ----

function loadTutorial(): TutorialState {
  try { return resumeState(JSON.parse(readStore(TUTORIAL_KEY) ?? 'null')); } catch { return INITIAL_TUTORIAL; }
}
export const tutorial = signal<TutorialState>(loadTutorial());

function setTutorial(next: TutorialState) {
  tutorial.value = next;
  writeStore(TUTORIAL_KEY, JSON.stringify(next));
}
/** The welcome card's Start button. */
/** A new campaign asks whether the player wants the tutorial: yes starts it from the welcome card, no hides it (the menu replays it). */
export const resetTutorial = (wanted: boolean) => setTutorial(wanted ? { ...INITIAL_TUTORIAL } : { ...INITIAL_TUTORIAL, skipped: true });
export const startTutorial = () => setTutorial({ ...tutorial.value, welcomed: true });
export const skipTutorial = () => setTutorial({ ...tutorial.value, skipped: true });
/** The last card's Got it: the OS lesson is part of this viewer's tutorial from now on. */
export const finishTutorial = () => setTutorial({ ...tutorial.value, finished: true, osLesson: true });
/** Start again from the welcome card. Flags are judged from live state against a baseline taken now. */
export function replayTutorial(s: Snapshot | null) {
  setTutorial({
    welcomed: false, skipped: false, finished: false, osLesson: true, offered: true,
    replay: s ? { completed: s.completed, owned: s.devices.length + s.inventory.length } : null,
  });
}
/** "Next lesson: the OS" card: take the lesson. The finished steps are already done, so it starts at the drive. */
export const takeOsLesson = () => setTutorial({ ...tutorial.value, welcomed: true, finished: false, osLesson: true, offered: true });
/** The same card, dismissed: it does not come back. */
export const declineOsLesson = () => setTutorial({ ...tutorial.value, finished: true, osLesson: false, offered: true });

// ---- hints / toasts ----

function loadSeen(): Set<string> {
  try {
    const v = JSON.parse(readStore(HINTS_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
const seen = loadSeen();
/** At most MAX_TOASTS are visible; the rest wait in `queued` and appear as the visible ones go away. */
export const toasts = signal<Hint[]>([]);
const queued = signal<Hint[]>([]);
const TOAST_MS = 8000;

function pump(visible: Hint[], queue: Hint[]) {
  const r = fillToasts(visible, queue);
  for (const t of r.visible) if (!visible.includes(t)) setTimeout(() => dismissToast(t.id), TOAST_MS);
  toasts.value = r.visible;
  queued.value = r.queue;
}

export function dismissToast(id: string) {
  pump(toasts.value.filter((t) => t.id !== id), queued.value);
}

function showHint(h: Hint) {
  seen.add(h.id);
  writeStore(HINTS_KEY, JSON.stringify([...seen]));
  pump(toasts.value, [...queued.value, h]);
}

/** Forget which hints were shown (the menu's "Show hints again"). */
export function resetHints() {
  seen.clear();
  writeStore(HINTS_KEY, '[]');
}

effect(() => {
  const s = snapshot.value;
  if (!s) return;
  // Hints wait while a tutorial step is active: the card is the one thing to read then.
  if (currentStep(s, tutorial.value)) return;
  for (const h of newHints(s, seen)) showHint(h);
});

// ---- level-up (per viewer; a modal over everything that waits for the player to press Next, see Levels.tsx) ----

const SEEN_KEY = 'pipeline-city.seenLevel';
function loadSeen_(): number | null {
  const v = Number(readStore(SEEN_KEY));
  return Number.isInteger(v) && v >= 1 ? v : null;
}
let seenLevel: number | null = loadSeen_();
export const levelUp = signal<Celebration | null>(null);
/** The level-up popup pauses the game while it is read (fair play); Next resumes at the speed it was running. */
let pausedByLevelUp = false;
export function dismissLevelUp() {
  levelUp.value = null;
  if (pausedByLevelUp && speed.peek() === 0) togglePause();
  pausedByLevelUp = false;
}

effect(() => {
  const s = snapshot.value;
  if (!s) { dismissLevelUp(); return; }
  const owed = celebrationFor(s, seenLevel);
  if (owed && !levelUp.peek()) {
    levelUp.value = owed;
    if (speed.peek() !== 0) { togglePause(); pausedByLevelUp = true; }
    seenLevel = owed.level;
    writeStore(SEEN_KEY, String(seenLevel));
    return;
  }
  // Otherwise follow the level (a load, a new game).
  if (!owed) {
    const next = reconcileSeen(s, seenLevel);
    if (next !== seenLevel) { seenLevel = next; writeStore(SEEN_KEY, String(next)); }
  }
});

// ---- recent activity (for the stats sparkline) ----

export interface Sample { tick: number; retired: number; stalls: number }
export const history = signal<Sample[]>([]);
let lastSample: { tick: number; retired: number; stalls: number } | null = null;
const HISTORY_LEN = 60;

effect(() => {
  const s = snapshot.value;
  if (!s) { lastSample = null; return; }
  const retired = s.counters.retired ?? 0;
  const stalls = totalStalls(s.counters);
  if (lastSample && s.baseTick === lastSample.tick) return;
  // Counters restart with each attempt: a drop means a new engine, so count from zero.
  const dr = lastSample && retired >= lastSample.retired ? retired - lastSample.retired : retired;
  const ds = lastSample && stalls >= lastSample.stalls ? stalls - lastSample.stalls : stalls;
  lastSample = { tick: s.baseTick, retired, stalls };
  history.value = [...history.value, { tick: s.baseTick, retired: dr, stalls: ds }].slice(-HISTORY_LEN);
});
