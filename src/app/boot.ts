// The boot screen (index.html `#boot`, docs/render/load.md): it covers the page from the first paint until the board can be seen, then fades
// out over the live picture, and the title and the menu show. The 3D board's mount says its stages and how far along it is; the 2D board is
// ready at once.
import { signal } from '@preact/signals';

/** The boot screen has gone, or is going: the title and the menu may show. */
export const booted = signal(false);

let share = 0;

/** The stage the boot is at (said under the bar) and how far along it is, 0 to 1: the bar only grows. */
export function bootStage(label: string, at: number): void {
  const el = typeof document === 'undefined' ? null : document.getElementById('boot');
  if (!el) return;
  share = Math.max(share, Math.min(1, at));
  el.style.setProperty('--boot', share.toFixed(3));
  const t = el.querySelector('.boot-stage');
  if (t && t.textContent !== label) t.textContent = label;
  logStage(el, label);
}

const LOG_LINES = 4;
const done: string[] = [];

/** The stages so far, as a short boot log under the bar: the older ones done, the newest lit. */
function logStage(el: HTMLElement, label: string): void {
  const log = el.querySelector('.boot-log');
  if (!log || done[done.length - 1] === label) return;
  done.push(label);
  log.replaceChildren(...done.slice(-LOG_LINES).map((l, i, all) => {
    const row = document.createElement(i === all.length - 1 ? 'em' : 'span');
    row.textContent = `${i === all.length - 1 ? '[ .. ]' : '[ ok ]'} ${l.toLowerCase()}`;
    row.style.display = 'block';
    return row;
  }));
}

const STILL_KEY = 'pc.bootStill';

/** Keeps a small still of the canvas for the next boot screen. Call right after a draw, in the same task: the buffer is not kept. */
export function saveStill(src: HTMLCanvasElement): void {
  try {
    if (!src.width || !src.height) return;
    const w = 480, c = document.createElement('canvas');
    c.width = w;
    c.height = Math.max(1, Math.round((w * src.height) / src.width));
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.62);
    if (url.length > 20 && url.startsWith('data:image/jpeg')) localStorage.setItem(STILL_KEY, url);
  } catch { /* no storage, or a tainted canvas: the next boot has no still */ }
}

/** The board can be seen: the boot screen fades out and goes. */
export function bootDone(): void {
  if (booted.peek()) return;
  booted.value = true;
  const el = typeof document === 'undefined' ? null : document.getElementById('boot');
  if (!el) return;
  bootStage('Ready', 1);
  el.classList.add('done');
  // (the bar's own transition ends inside it; with reduced motion there is no fade, and no transition ends)
  el.addEventListener('transitionend', (e) => { if (e.target === el && e.propertyName === 'opacity') el.remove(); });
  setTimeout(() => el.remove(), 2000);
}
