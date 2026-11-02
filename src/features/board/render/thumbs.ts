import { signal } from '@preact/signals';
import type { Renderer } from 'pixi.js';
import { getSpec } from '../sim/specs';
import { getIspSpec, getRouterSpec } from '../../network/sim/specs';
import { drawThumb, type ThumbJob, type ThumbReply } from './thumbart';
import { onThemeChange, readTheme } from '@/core/render/theme';

// Pictures of the parts for the shop, the inventory and the picker: the same art the board draws, rendered to a small image, so a
// tile shows what will end up in the machine. Built on demand, cached per theme, and rebuilt when the theme changes. A worker with its
// own Pixi renderer draws them (`thumbs.worker.ts`), so opening the shop or the case never stalls a frame; the image comes back as a
// PNG blob URL. Only when that worker cannot start (no OffscreenCanvas WebGL) are they drawn here, one per idle slice, with the
// renderer given to `initThumbs`. `thumbsVersion` bumps whenever one arrives, so a component that reads it re-renders. Without a
// renderer (tests) nothing is built and the UI falls back to its drawn icons.

let renderer: Renderer | null = null;
let worker: Worker | null = null;
/** Bumped on each theme change: a picture of an older theme that arrives late is dropped. */
let epoch = 0;
const cache = new Map<string, string>();
const failed = new Set<string>();
/** Jobs asked of the worker and not answered yet, by key (moved to `queue` if the worker dies). */
const sent = new Map<string, ThumbJob>();
/** Jobs for the main-thread fallback. */
const queue: ThumbJob[] = [];
let busy = false;
/** Bumped when a new picture is ready or the theme changed: read it in a component to re-render. */
export const thumbsVersion = signal(0);

export function initThumbs(r: Renderer): void {
  const first = !renderer;
  renderer = r;
  if (!first) return;
  onThemeChange(() => {
    for (const u of cache.values()) URL.revokeObjectURL(u);
    cache.clear(); failed.clear(); sent.clear(); queue.length = 0;
    epoch += 1;
    worker?.postMessage({ epoch });
    thumbsVersion.value += 1;
  });
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  try {
    worker = new Worker(new URL('./thumbs.worker.ts', import.meta.url), { type: 'module' });
  } catch { return; }
  worker.onmessage = (e: MessageEvent<ThumbReply>) => {
    const m = e.data;
    if ('dead' in m) { fallBack(); return; }
    if (m.epoch !== epoch || !sent.delete(m.key)) return;
    if (m.png) { cache.set(m.key, URL.createObjectURL(m.png)); thumbsVersion.value += 1; } else failed.add(m.key);
  };
  worker.onerror = () => fallBack();
}

/** The worker has no renderer (or did not load): what it was asked is drawn here instead, and so is all that follows. */
function fallBack() {
  worker?.terminate();
  worker = null;
  queue.push(...sent.values());
  sent.clear();
  pump();
}

/** Can a picture be made for this id at all? (a part, a board, a case, a router, a plan; not an OS) */
export function hasThumb(id: string): boolean {
  if (/^(board|case)\d+$/.test(id)) return true;
  if (getRouterSpec(id) || getIspSpec(id)) return true;
  const k = getSpec(id)?.kind;
  return !!k;
}

/** The picture of an id in the current theme, or null while it is being made (or cannot be made): read `thumbsVersion` to be told. */
export function thumbOf(id: string): string | null {
  if (!renderer || !hasThumb(id)) return null;
  const theme = readTheme(), key = `${theme.dark ? 'd' : 'l'}|${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed.has(key) || sent.has(key) || queue.some((j) => j.key === key)) return null;
  const job: ThumbJob = { key, id, theme, epoch };
  if (worker) { sent.set(key, job); worker.postMessage(job); } else { queue.push(job); pump(); }
  return null;
}

/** The main-thread fallback: one picture per idle slice. */
function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const next = () => {
    const j = queue.shift();
    if (j && j.epoch === epoch) {
      try {
        const c = renderer && drawThumb(renderer, j.id, j.theme);
        if (c) { cache.set(j.key, (c as HTMLCanvasElement).toDataURL('image/png')); thumbsVersion.value += 1; } else failed.add(j.key);
      } catch { failed.add(j.key); }
    }
    if (queue.length) setTimeout(next, 0);
    else busy = false;
  };
  setTimeout(next, 0);
}
