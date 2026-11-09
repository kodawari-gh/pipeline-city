// Saved builds of Build my PC (browser storage: a per-viewer convenience).
import type { BuildLayout, SavedBuild } from '@/features/board/sim/buildspecs';

const KEY = 'pipeline-city.builds';
/** The saved builds (browser storage; a per-viewer convenience, so every read and write may fail and then does nothing). */
export function savedBuilds(): SavedBuild[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((b): b is SavedBuild => !!b && typeof (b as SavedBuild).name === 'string' && Array.isArray((b as SavedBuild).layout?.parts)) : [];
  } catch { return []; }
}
/** Save a build under a name (the same name replaces); returns the new list. */
export function saveBuild(name: string, layout: BuildLayout): SavedBuild[] {
  const list = [...savedBuilds().filter((b) => b.name !== name), { name, layout }].slice(-12);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  return list;
}
export function deleteBuild(name: string): SavedBuild[] {
  const list = savedBuilds().filter((b) => b.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  return list;
}
