import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { openSettings, settingsOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';

type Viewer = import('@/core/render/three/viewer').Viewer;
type Build = (specId: string) => import('three').Object3D | null;
interface Studio {
  frame: () => HTMLElement | null;
}

/** Fit the viewer to the host, and to the studio frame when there is one (the dock grows with a part's variants). */
function fitShowcase(el: HTMLElement, vw: Viewer, studio?: Studio): void {
  const f = studio?.frame();
  if (studio && f) {
    const s = el.getBoundingClientRect(),
      b = f.getBoundingClientRect();
    vw.setInsets({
      left: Math.max(0, b.left - s.left),
      right: Math.max(0, s.right - b.right),
      top: Math.max(0, b.top - s.top),
      bottom: Math.max(0, s.bottom - b.bottom),
    });
  }
  vw.resize();
}

/**
 * The showcase: the part you picked as a 3D model on a turntable. Its pointers read as the game's (`core/render/three/pad.ts`): drag to pan, right-drag or
 * two fingers swiped together to turn it, scroll or pinch to zoom toward a point, double-click or double-tap to reset. The viewer
 * and the part builders load on the first look, so the shop opens as fast as before; one WebGL context lives while this is open.
 * `studio`: the Gallery's look (the stage fills the screen, its bar is the studio's pill bar with Graphics, and the part is framed in the box
 * `frame` names: the viewer's insets are that box's edges measured from the stage).
 */

function startShowcase(opts: {
  host: { current: HTMLDivElement | null };
  studio: Studio | undefined;
  viewer: { current: Viewer | null };
  build: { current: Build | null };
  setState: (s: 'loading' | 'ready' | 'none' | 'failed') => void;
}): () => void {
  let dead = false;
  let ro: ResizeObserver | null = null;
  const { host, studio, viewer, build, setState } = opts;
  Promise.all([import('@/core/render/three/viewer'), import('@/features/board/render/three/showcase')])
    .then(([v, sc]) => {
      if (dead || !host.current) {
        return;
      }
      try {
        const el = host.current;
        const vw = v.mountViewer(el);
        viewer.current = vw;
        build.current = sc.buildShowcaseModel;
        // (the panels' own size changes too: the dock grows with a part's variants)
        const fit = () => {
          fitShowcase(el, vw, studio);
        };
        ro = new ResizeObserver(fit);
        ro.observe(el);
        const f = studio?.frame();
        if (f) {
          ro.observe(f);
        }
        fit();
        setState('ready');
      } catch {
        setState('failed');
      }
    })
    .catch(() => {
      if (!dead) {
        setState('failed');
      }
    });
  return () => {
    dead = true;
    ro?.disconnect();
    viewer.current?.dispose();
    viewer.current = null;
  };
}

function useShowcaseViewer(opts: {
  host: { current: HTMLDivElement | null };
  studio: Studio | undefined;
  specId: string;
  turning: boolean;
}): { viewer: { current: Viewer | null }; state: 'loading' | 'ready' | 'none' | 'failed' } {
  const { host, studio, specId, turning } = opts;
  const viewer = useRef<Viewer | null>(null);
  const build = useRef<Build | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading');

  useEffect(
    () =>
      startShowcase({
        host,
        studio,
        viewer,
        build,
        setState,
      }),
    [],
  );

  useEffect(() => {
    if (state !== 'ready' && state !== 'none') {
      return;
    }
    const model = build.current?.(specId) ?? null;
    viewer.current?.setObject(model);
    setState(model ? 'ready' : 'none');
  }, [specId, state === 'loading' || state === 'failed']);

  useEffect(() => {
    viewer.current?.setAutoTurn(turning);
  }, [turning, state]);

  return { viewer, state };
}

export function Showcase({ specId, onClose, studio }: { specId: string; onClose: () => void; studio?: Studio }) {
  const host = useRef<HTMLDivElement>(null);
  const [turning, setTurning] = useState(true);
  const { viewer, state } = useShowcaseViewer({ host, studio, specId, turning });

  return (
    <div class={`showcase ${studio ? 'studio' : ''}`} role="group" aria-label="3D view">
      <div class="showcase-host" ref={host} />
      {state === 'loading' && <div class="showcase-note mute">Loading the 3D view…</div>}
      {state === 'none' && <div class="showcase-note mute">No 3D model for this item yet.</div>}
      {state === 'failed' && <div class="showcase-note mute">3D view is not available here.</div>}
      <ShowcaseBars studio={studio} turning={turning} setTurning={setTurning} viewer={viewer} onClose={onClose} />
    </div>
  );
}

function ShowcaseBars(opts: {
  studio: Studio | undefined;
  turning: boolean;
  setTurning: (v: boolean) => void;
  viewer: { current: Viewer | null };
  onClose: () => void;
}) {
  const { studio, turning, setTurning, viewer, onClose } = opts;
  const { spin, reset } = spinReset({ studio, turning, setTurning, viewer });
  if (studio) {
    return (
      <div class="showcase-bar mode-bar mode-top bld-util" role="toolbar" aria-label="View">
        {spin}
        {reset}
        <i class="mode-sep" aria-hidden="true" />
        <button
          class={settingsOpen.value ? 'on' : ''}
          aria-haspopup="dialog"
          title="Picture, light and detail settings"
          onClick={() => openSettings('studio')}
        >
          <Icon name="sliders" size={12} />
          Settings
        </button>
      </div>
    );
  }
  return (
    <div class="showcase-bar">
      <span
        class="mute showcase-hint"
        title="Drag: pan. Right-drag, or two fingers swiped together: turn. Scroll or pinch: zoom. Double-click or double-tap: reset."
      >
        Pan · turn · zoom
      </span>
      {spin}
      {reset}
      <button title="Back to the picture" aria-label="Close 3D view" onClick={onClose}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function spinReset(opts: {
  studio: Studio | undefined;
  turning: boolean;
  setTurning: (v: boolean) => void;
  viewer: { current: Viewer | null };
}): { spin: JSX.Element; reset: JSX.Element } {
  const { studio, turning, setTurning, viewer } = opts;
  // (in the studio the buttons carry an icon, as Build my PC's view options do)
  return {
    spin: (
      <button
        class={turning ? 'on' : ''}
        aria-pressed={turning}
        title="Turn by itself"
        onClick={() => setTurning(!turning)}
      >
        {studio && <Icon name="spin" size={12} />}Spin
      </button>
    ),
    reset: (
      <button title="Reset the view (double-click)" onClick={() => viewer.current?.reset()}>
        {studio && <Icon name="reset" size={12} />}Reset
      </button>
    ),
  };
}
