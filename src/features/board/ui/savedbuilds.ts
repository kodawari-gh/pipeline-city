// Saved builds of Build my PC (browser storage: a per-viewer convenience).
import type { BuildLayout, SavedBuild } from '@/features/board/sim/buildspecs';

const KEY = 'pipeline-city.builds';
/** A saved picture is an image data URL or nothing (the storage is the viewer's own, but a row puts it in an `img`). */
const clean = (b: SavedBuild): SavedBuild => (typeof b.thumb === 'string' && b.thumb.startsWith('data:image/') ? b : { name: b.name, layout: b.layout });
/** The saved builds (browser storage; a per-viewer convenience, so every read and write may fail and then does nothing). */
export function savedBuilds(): SavedBuild[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((b): b is SavedBuild => !!b && typeof (b as SavedBuild).name === 'string' && Array.isArray((b as SavedBuild).layout?.parts)).map(clean) : [];
  } catch { return []; }
}
/** Save a build under a name (the same name replaces), with the picture taken of it when there is one (an image data URL); returns the new list. */
export function saveBuild(name: string, layout: BuildLayout, thumb?: string | null): SavedBuild[] {
  const list = [...savedBuilds().filter((b) => b.name !== name), { name, layout, ...(thumb?.startsWith('data:image/') ? { thumb } : {}) }].slice(-12);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  return list;
}
export function deleteBuild(name: string): SavedBuild[] {
  const list = savedBuilds().filter((b) => b.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  return list;
}
