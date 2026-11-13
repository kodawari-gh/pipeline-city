/**
 * The `?debug` overlay: frame rate, frame times, the tier, the pixel ratio, the canvas size, the draw calls, and the controls for the render
 * scale and the post passes. Plain DOM, its own rAF loop. Loaded only by `whenDebug` (`board3d.ts`): without `?debug` this module never runs.
 */
import type { WebGLRenderer } from 'three';
import { graphics, tierRecord } from '../graphics';
import { postOn, SCALES, setPost, setScale } from './controls';
import { FrameWindow, statsText, type StatsSnapshot } from './stats';

/** The readout is redrawn this often (ms). */
const SHOW_MS = 250;

// tap targets: 3rem is 44px or more at the smallest root font (15px, ui.css)
const BTN = 'min-width:3rem;min-height:3rem;padding:0 0.5rem;margin:0.15rem;font:inherit;color:#fff;background:#223;border:1px solid #889;border-radius:0.25rem;';
const ON = 'background:#3a7d44;';

export function mountDebug({ renderer, canvas }: { renderer: WebGLRenderer; canvas: HTMLCanvasElement }): void {
  const win = new FrameWindow();
  // the draw calls are read and reset each frame by this loop (the game's own frames add up until then)
  renderer.info.autoReset = false;
  // the draw calls of the last frame that drew (a still frame draws nothing and keeps the last count)
  let drawCalls = 0;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:4.5rem;left:0.25rem;z-index:10000;max-width:60vw;padding:0.4rem;border-radius:0.4rem;'
    + 'background:rgba(0,0,0,0.6);color:#fff;font:0.8rem/1.35 ui-monospace,Menlo,Consolas,monospace;touch-action:manipulation;';
  const readout = document.createElement('pre');
  readout.style.cssText = 'margin:0 0 0.25rem;font:inherit;white-space:pre;';
  panel.append(readout);

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = BTN;
    b.addEventListener('click', onClick);
    return b;
  };

  const postBtn = button('Post', () => { setPost(!postOn(graphics.peek())); show(); });
  const scaleBtns = SCALES.map((v) => button(String(v), () => { setScale(v); show(); }));
  const copyBtn = button('Copy', () => { void copy(); });
  const controls = document.createElement('div');
  controls.append(postBtn, ...scaleBtns, copyBtn);
  panel.append(controls);

  // the panel's own pointer and wheel never reach the game
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  const snap = (): StatsSnapshot => {
    const g = graphics.peek(), t = tierRecord.peek();
    return {
      fps: win.fps(), avgMs: win.avg(), p95Ms: win.p95(), tier: t.tier, reason: t.reason, mode: t.mode,
      dpr: window.devicePixelRatio || 1, ratio: renderer.getPixelRatio(), w: canvas.width, h: canvas.height,
      calls: drawCalls, scale: g.scale, post: postOn(g),
    };
  };

  const show = () => {
    const s = snap(), g = graphics.peek();
    readout.textContent = statsText(s);
    postBtn.textContent = `Post ${s.post ? 'on' : 'off'}`;
    postBtn.style.cssText = BTN + (s.post ? ON : '');
    SCALES.forEach((v, i) => {
      const on = Math.abs(g.scale - v) < 1e-3;
      scaleBtns[i]!.style.cssText = BTN + (on ? ON : '');
    });
  };

  const copy = async () => {
    const text = statsText(snap());
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch { /* no clipboard API here: the fallback below */ }
    if (!done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.append(ta);
      ta.select();
      try { done = document.execCommand('copy'); } catch { /* not copied */ }
      ta.remove();
    }
    copyBtn.textContent = done ? 'Copied' : 'Copy';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1000);
  };

  document.body.append(panel);

  let last = -1, lastShow = -Infinity;
  const frame = (now: number) => {
    if (last >= 0) win.push(now - last);
    last = now;
    const n = renderer.info.render.calls;
    renderer.info.reset();
    if (n > 0) drawCalls = n;
    if (now - lastShow >= SHOW_MS) { lastShow = now; show(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
