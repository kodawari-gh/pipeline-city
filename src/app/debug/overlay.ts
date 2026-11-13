/**
 * The `?debug` overlay: frame rate, frame times, the tier, the pixel ratio, the canvas size, the draw calls, the viewport, and the controls for the
 * render scale, the post passes, the sun's shadow, the lamp cap, and the hides of the city and the machine (visibility only). Plain DOM, its own
 * rAF loop. Loaded only by `whenDebug` (`board3d.ts`): without `?debug` this module never runs.
 */
import type { WebGLRenderer } from 'three';
import type { OutsideView } from '@/features/room/render/three/outside/view';
import { CHOICES, effective, tierRecord } from '../graphics';
import { backToAuto, lightsNow, overridden, nextLights, postOn, SCALES, setLights, setPost, setRootHidden, setScale, setShadowsOn, shadowsOn } from './controls';
import { debugLayer, debugStats } from './city-layers';
import { DrawnFrames, statsText, viewportOf, type StatsSnapshot } from './stats';

/** A root the overlay can hide: its visibility only. */
export type HideRoot = { visible: boolean };

/** The city's layer toggles: the layer's key (`debugLayer`, `city-layers.ts`) and its button's label. Each is its own button; lit when the layer is off. */
export const CITY_LAYERS: readonly (readonly [string, string])[] = [
  ['lights', 'No city lights'], ['buildings', 'No buildings'], ['freeze', 'Freeze city'], ['cars', 'No cars'],
  ['sky', 'No city sky'], ['glow', 'No glow'], ['steam', 'No steam'], ['mirror', 'No mirror'], ['flat', 'City 1x'],
];

/** The readout is redrawn this often (ms). */
const SHOW_MS = 250;

/**
 * The panel's width cap. The main menu is centred (`.mainmenu`, ui.css) and its buttons are `clamp(13rem, 24vw, 17rem)` wide, so their left
 * edge is at least 50vw - 8.5rem. The panel is border-box, so this cap includes its padding. Its right edge is at the cap plus its 0.25rem
 * left offset: 50vw - 9.25rem, which leaves 0.75rem (12px at 16px) before the button. Any width of the window.
 */
export const PANEL_MAX_WIDTH = 'calc(50vw - 9.5rem)';

// tap targets: 3rem is 44px or more at the smallest root font (15px, ui.css)
const BTN = 'min-width:3rem;min-height:3rem;padding:0 0.5rem;margin:0.15rem;font:inherit;color:#fff;background:#223;border:1px solid #889;border-radius:0.25rem;';
const ON = 'background:#3a7d44;';

/**
 * `roots`: the city's and the machine's roots, now (the machine's changes when it is rebuilt). Without it the hides have nothing to hide.
 */
export function mountDebug({ renderer, canvas, roots }: {
  renderer: WebGLRenderer; canvas: HTMLCanvasElement; roots?: () => { city: HideRoot | null; machine: HideRoot | null; layers?: OutsideView | null };
}): void {
  // the city's layers that are off, and the city they were last applied to. Not saved.
  const layerOff = new Set<string>();
  let layersAt: OutsideView | null = null;
  const drawn = new DrawnFrames();
  // the hides: on or off, and the root each was last applied to (a hidden root that is replaced is hidden again). Not saved.
  const hide = { city: false, machine: false };
  const applied: Record<'city' | 'machine', HideRoot | null> = { city: null, machine: null };
  // the draw calls are read and reset each frame by this loop (the game's own frames add up until then)
  renderer.info.autoReset = false;
  // the draw calls of the last frame that drew (a still frame draws nothing and keeps the last count)
  let drawCalls = 0;

  const panel = document.createElement('div');
  panel.style.cssText = `position:fixed;top:4.5rem;left:0.25rem;z-index:10000;box-sizing:border-box;max-width:${PANEL_MAX_WIDTH};padding:0.4rem;border-radius:0.4rem;`
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

  const postBtn = button('Post', () => { setPost(!postOn(effective.peek())); show(); });
  const scaleBtns = SCALES.map((v) => button(String(v), () => { setScale(v); show(); }));
  const shadowBtn = button('Shadows', () => { setShadowsOn(!shadowsOn(effective.peek())); show(); });
  const lightsBtn = button('Lights', () => { setLights(nextLights(lightsNow())); show(); });
  const cityBtn = button('Hide city', () => { hideRoot('city'); show(); });
  const machineBtn = button('Hide machine', () => { hideRoot('machine'); show(); });
  const layerBtns = CITY_LAYERS.map(([k, label]) => button(label, () => { toggleLayer(k); show(); }));
  const autoBtn = button('Auto', () => { backToAuto(); showRoots(); layersOn(); show(); });
  const copyBtn = button('Copy', () => { void copy(); });
  const controls = document.createElement('div');
  controls.append(postBtn, ...scaleBtns, shadowBtn, lightsBtn, cityBtn, ...layerBtns, machineBtn, autoBtn, copyBtn);
  panel.append(controls);

  /** Flips one city layer and applies it to the city now (a city not built yet gets it when it is: `syncHides`). */
  const toggleLayer = (k: string) => {
    const off = !layerOff.has(k);
    if (off) layerOff.add(k); else layerOff.delete(k);
    const now = roots?.().layers ?? null;
    if (now) debugLayer(now, k, off);
    layersAt = now;
  };
  /** Auto: every city layer on again. */
  const layersOn = () => {
    const now = roots?.().layers ?? null;
    for (const k of layerOff) if (now) debugLayer(now, k, false);
    layerOff.clear();
    layersAt = now;
  };

  /** Flips one hide and applies it to that root now. */
  const hideRoot = (k: 'city' | 'machine') => {
    hide[k] = !hide[k];
    const root = roots?.()[k] ?? null;
    setRootHidden(root, hide[k]);
    applied[k] = root;
  };
  /** Auto: both hides off, and both roots shown now (Auto undoes every toggle). */
  const showRoots = () => {
    hide.city = false;
    hide.machine = false;
    const now = roots?.();
    for (const k of ['city', 'machine'] as const) {
      setRootHidden(now?.[k] ?? null, false);
      applied[k] = now?.[k] ?? null;
    }
  };
  /** Each frame: a hidden root that is new (the machine was rebuilt, the city was built after the hide) is hidden. A shown one is left to the game. */
  const syncHides = () => {
    if (roots && layerOff.size) {
      const l = roots().layers ?? null;
      if (l && l !== layersAt) for (const k of layerOff) debugLayer(l, k, true);
      layersAt = l;
    }
    if (!roots || !(hide.city || hide.machine)) return;
    const now = roots();
    for (const k of ['city', 'machine'] as const) {
      if (hide[k] && now[k] !== applied[k]) setRootHidden(now[k], true);
      applied[k] = now[k];
    }
  };

  // the panel's own pointer and wheel never reach the game
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  const snap = (): StatsSnapshot => {
    const g = effective.peek(), t = tierRecord.peek();
    const v = roots?.().layers;
    const city = v ? debugStats(v) : null;
    return {
      ...(city ? { cityTris: city.tris, cityCalls: city.calls } : {}),
      fps: drawn.fps(), avgMs: drawn.avg(), p95Ms: drawn.p95(), tier: t.tier, reason: t.reason, mode: t.mode,
      dpr: window.devicePixelRatio || 1, ratio: renderer.getPixelRatio(), w: canvas.width, h: canvas.height,
      calls: drawCalls, scale: g.scale, post: postOn(g),
      shadows: g.shadows, lights: lightsNow(), ...viewportOf(window, window.screen ?? {}),
    };
  };

  const show = () => {
    const s = snap(), g = effective.peek();
    readout.textContent = statsText(s);
    postBtn.textContent = `Post ${s.post ? 'on' : 'off'}`;
    postBtn.style.cssText = BTN + (s.post ? ON : '');
    SCALES.forEach((v, i) => {
      const on = Math.abs(g.scale - v) < 1e-3;
      scaleBtns[i]!.style.cssText = BTN + (on ? ON : '');
    });
    const shadowOn = shadowsOn(g);
    shadowBtn.textContent = `Shadows ${shadowOn ? 'on' : 'off'}`;
    shadowBtn.style.cssText = BTN + (shadowOn ? ON : '');
    // (the lamp cap's name as the panel shows it: 4, All for 0)
    lightsBtn.textContent = `Lights ${CHOICES.lights.find(([v]) => v === s.lights)?.[1] ?? s.lights}`;
    cityBtn.style.cssText = BTN + (hide.city ? ON : '');
    machineBtn.style.cssText = BTN + (hide.machine ? ON : '');
    CITY_LAYERS.forEach(([k], i) => { layerBtns[i]!.style.cssText = BTN + (layerOff.has(k) ? ON : ''); });
    autoBtn.style.cssText = BTN + (tierRecord.peek().mode === 'auto' && !overridden() ? ON : '');
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

  let lastShow = -Infinity;
  const frame = (now: number) => {
    // the draw calls since the last reset: a game frame that drew (a skipped or still rAF draws none)
    const n = renderer.info.render.calls;
    renderer.info.reset();
    drawn.tick(now, n);
    if (n > 0) drawCalls = n;
    syncHides();
    if (now - lastShow >= SHOW_MS) { lastShow = now; show(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
