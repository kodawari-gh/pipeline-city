// UI-only signals: theme, open panel, toasts. Everything persisted is per-viewer and wrapped in try/catch.

import { effect, signal } from '@preact/signals';
import { snapshot } from '../game/store';
import { fillToasts, newHints, totalStalls, type Hint } from './logic';

const THEME_KEY = 'pipeline-city.theme';
const HINTS_KEY = 'pipeline-city.hints';

export type Theme = 'dark' | 'light';
export type Panel = 'shop' | 'stats' | null;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: ignore */ }
}

function initialTheme(): Theme {
  const saved = readStore(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}

export const theme = signal<Theme>(initialTheme());
/** The renderer reads `data-theme` on the root element. */
effect(() => { document.documentElement.setAttribute('data-theme', theme.value); });
export function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  writeStore(THEME_KEY, theme.value);
}

export const panel = signal<Panel>('shop');
export const togglePanel = (p: Exclude<Panel, null>) => { panel.value = panel.value === p ? null : p; };

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

effect(() => {
  const s = snapshot.value;
  if (!s) return;
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
