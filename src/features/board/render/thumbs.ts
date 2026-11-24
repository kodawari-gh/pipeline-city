import { signal } from '@preact/signals';
import type { Renderer } from 'pixi.js';
import { getSpec } from '../sim/specs';
import { getIspSpec, getRouterSpec } from '../../network/sim/specs';
import { drawThumb, type ThumbJob, type ThumbReply } from './thumbart';
import { readTheme } from '@/core/render/theme';

// Pictures of the parts for the shop, the inventory and the picker: the same art the board draws, rendered to a small image, so a
// tile shows what will end up in the machine. Built on demand and cached per id (the game has one theme). A worker with its
// own Pixi renderer draws them (`thumbs.worker.ts`), so opening the shop or the case never stalls a frame; the image comes back as a
// PNG blob URL. Only when that worker cannot start (no OffscreenCanvas WebGL) are they drawn here, one per idle slice, with the
// renderer given to `initThumbs`. `thumbsVersion` bumps whenever one arrives, so a component that reads it re-renders. Without a
// renderer (tests) nothing is built and the UI falls back to its drawn icons.
// The parts with a 3D model show a still of it instead (`tools/stills.mjs` bakes them to `public/stills/`): the tile shows the part as the
// gallery, the shop's 3D view and the machine show it. Their list comes with `initThumbs` (`manifest.json`); until it is in, no tile asks
// for a drawing, so a tile never shows the drawing first and the still after.

let renderer: Renderer | null = null;
let worker: Worker | null = null;
/** Sent with each job and echoed back: a picture that arrives for another epoch is dropped. */
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
const STILLS = `${import.meta.env.BASE_URL}stills/`;
/** The baked stills: each id's file hash (a new bake is a new URL); `{}` when there are none, null while the list loads. */
let stills: Record<string, string> | null = null;
let stillsAsked = false;

/** Warm the browser cache with every still (about 1 MB), a few per idle slice, so the shop and the inventory open with their pictures. */
function prefetchStills(): void {
  const todo = Object.entries(stills ?? {}).map(([id, h]) => `${STILLS}${id}.webp?${h}`);
  const step = () => {
    for (const url of todo.splice(0, 4)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    }
    if (todo.length) setTimeout(step, 50);
  };
  setTimeout(step, 0);
}

/** Load the list of the baked stills (once). */
export function loadStills(): void {
  if (stillsAsked || typeof document === 'undefined') return;
  stillsAsked = true;
  void fetch(`${STILLS}manifest.json`)
    .then(async (r) => (r.ok ? ((await r.json()) as { stills?: Record<string, string> }).stills : null))
    .catch((e: unknown) => {
      if (import.meta.env.DEV) console.warn('the shop stills did not load:', e);
      return null;
    })
    .then((m) => {
      stills = m ?? {};
      thumbsVersion.value += 1;
      prefetchStills();
    });
}

export function initThumbs(r: Renderer): void {
  const first = !renderer;
  renderer = r;
  if (first) loadStills();
}

/** The drawing worker starts with the first picture that needs a drawing, not with the game: its code (Pixi, 0.5 MB) is a first-start download, and the stills cover most tiles (PHONE-05). */
let workerTried = false;
function startWorker(): void {
  if (workerTried) return;
  workerTried = true;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  try {
    worker = new Worker(new URL('./thumbs.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return;
  }
  worker.onmessage = (e: MessageEvent<ThumbReply>) => {
    const m = e.data;
    if ('dead' in m) {
      fallBack();
      return;
    }
    if (m.epoch !== epoch || !sent.delete(m.key)) return;
    if (m.png) {
      cache.set(m.key, URL.createObjectURL(m.png));
      thumbsVersion.value += 1;
    } else failed.add(m.key);
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
  // The stills need no renderer: the list loads with the first tile, not when the 3D renderer is up.
  loadStills();
  if (!stills || !hasThumb(id)) return null;
  const still = stills[id];
  if (still) return `${STILLS}${id}.webp?${still}`;
  if (!renderer) return null;
  const theme = readTheme(),
    key = id;
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed.has(key) || sent.has(key) || queue.some((j) => j.key === key)) return null;
  const job: ThumbJob = { key, id, theme, epoch };
  startWorker();
  if (worker) {
    sent.set(key, job);
    worker.postMessage(job);
  } else {
    queue.push(job);
    pump();
  }
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
        if (c) {
          cache.set(j.key, (c as HTMLCanvasElement).toDataURL('image/png'));
          thumbsVersion.value += 1;
        } else failed.add(j.key);
      } catch {
        failed.add(j.key);
      }
    }
    if (queue.length) setTimeout(next, 0);
    else busy = false;
  };
  setTimeout(next, 0);
}
