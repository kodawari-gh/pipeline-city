// UI-only signals: theme, the stats panel, hint toasts, the guided tutorial's per-viewer state.
// Everything persisted is per-viewer (localStorage) and wrapped in try/catch. The tutorial's progress itself comes
// from the snapshot's `progress` flags, so it survives a save/load; localStorage only remembers skip/finish/replay.

import { effect, signal } from '@preact/signals';
import { snapshot, speed } from '../game/store';
import type { Snapshot } from '../sim/protocol';
import { fillToasts, newHints, totalStalls, type Hint } from './logic';
import { currentStep, INITIAL_TUTORIAL, resumeState, type TutorialState } from './tutorial';

const THEME_KEY = 'pipeline-city.theme';
const HINTS_KEY = 'pipeline-city.hints';
const TUTORIAL_KEY = 'pipeline-city.tutorial';

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

// ---- stats drawer (part upgrades live in the contextual picker) ----

// Paused (speed 0): UI animations that show sim activity stop too. CSS keys on `.paused` at the root (see `.sim-anim`).
// Purely interactive feedback (hover, panels, toasts) is not frozen.
effect(() => { document.documentElement.classList.toggle('paused', speed.value === 0); });

export const statsOpen = signal(false);
export const toggleStats = () => { statsOpen.value = !statsOpen.value; };

// ---- inventory tray (spare parts; drag them from here onto the board) ----

export const inventoryOpen = signal(false);
export const toggleInventory = () => { inventoryOpen.value = !inventoryOpen.value; };

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
