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
