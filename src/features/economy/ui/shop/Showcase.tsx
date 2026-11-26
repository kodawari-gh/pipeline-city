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
export function Showcase({ specId, onClose, studio }: { specId: string; onClose: () => void; studio?: Studio }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const build = useRef<Build | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading');
  const [turning, setTurning] = useState(true);

  useEffect(() => {
    let dead = false,
      ro: ResizeObserver | null = null;
    Promise.all([import('@/core/render/three/viewer'), import('@/features/board/render/three/showcase')])
      .then(([v, sc]) => {
        if (dead || !host.current) {
          return;
        }
        try {
          const el = host.current,
            vw = v.mountViewer(el);
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
  }, []);

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

  // (in the studio the buttons carry an icon, as Build my PC's view options do)
  const spin = (
    <button
      class={turning ? 'on' : ''}
      aria-pressed={turning}
      title="Turn by itself"
      onClick={() => setTurning(!turning)}
    >
      {studio && <Icon name="spin" size={12} />}Spin
    </button>
  );
  const reset = (
    <button title="Reset the view (double-click)" onClick={() => viewer.current?.reset()}>
      {studio && <Icon name="reset" size={12} />}Reset
    </button>
  );
  return (
    <div class={`showcase ${studio ? 'studio' : ''}`} role="group" aria-label="3D view">
      <div class="showcase-host" ref={host} />
      {state === 'loading' && <div class="showcase-note mute">Loading the 3D view…</div>}
      {state === 'none' && <div class="showcase-note mute">No 3D model for this item yet.</div>}
      {state === 'failed' && <div class="showcase-note mute">3D view is not available here.</div>}
      {studio ? (
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
      ) : (
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
      )}
    </div>
  );
}
