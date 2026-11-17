import { useEffect, useRef, useState } from 'preact/hooks';
import { graphicsOpen, toggleGraphics } from '@/core/ui/state';
import { clearance } from '@/core/ui/kit/clearance';
import { Icon } from '@/core/ui/kit/Icons';

type Viewer = import('@/core/render/three/viewer').Viewer;
type Build = (specId: string) => import('three').Object3D | null;

/**
 * The showcase: the part you picked as a 3D model on a turntable. Drag to turn it, scroll or pinch to zoom, double-click to reset. The viewer
 * and the part builders load on the first look, so the shop opens as fast as before; one WebGL context lives while this is open.
 * `studio`: the Gallery's look (the stage fills the screen, its bar is the studio's pill bar with Graphics, and the part sits clear of the panels
 * `avoid` names, which float over the stage).
 */
export function Showcase({ specId, onClose, studio }: { specId: string; onClose: () => void; studio?: { avoid: () => (HTMLElement | null)[] } }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const build = useRef<Build | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading');
  const [turning, setTurning] = useState(true);

  useEffect(() => {
    let dead = false, ro: ResizeObserver | null = null;
    Promise.all([import('@/core/render/three/viewer'), import('@/features/board/render/three/showcase')]).then(([v, sc]) => {
      if (dead || !host.current) return;
      try {
        const el = host.current, vw = v.mountViewer(el);
        viewer.current = vw;
        build.current = sc.buildShowcaseModel;
        // (the panels' own size changes too: the dock grows with a part's variants)
        const fit = () => {
          if (studio) vw.setInsets(clearance(el.getBoundingClientRect(), studio.avoid().map((p) => p?.getBoundingClientRect() ?? null), parseFloat(getComputedStyle(el).fontSize) || 15));
          vw.resize();
        };
        ro = new ResizeObserver(fit);
        ro.observe(el);
        for (const p of studio?.avoid() ?? []) if (p) ro.observe(p);
        fit();
        setState('ready');
      } catch { setState('failed'); }
    }).catch(() => { if (!dead) setState('failed'); });
    return () => { dead = true; ro?.disconnect(); viewer.current?.dispose(); viewer.current = null; };
  }, []);

  useEffect(() => {
    if (state !== 'ready' && state !== 'none') return;
    const model = build.current?.(specId) ?? null;
    viewer.current?.setObject(model);
    setState(model ? 'ready' : 'none');
  }, [specId, state === 'loading' || state === 'failed']);

  useEffect(() => { viewer.current?.setAutoTurn(turning); }, [turning, state]);

  const spin = <button class={turning ? 'on' : ''} aria-pressed={turning} title="Turn by itself" onClick={() => setTurning(!turning)}>Spin</button>;
  const reset = <button title="Reset the view (double-click)" onClick={() => viewer.current?.reset()}>Reset</button>;
  return (
    <div class={`showcase ${studio ? 'studio' : ''}`} role="group" aria-label="3D view">
      <div class="showcase-host" ref={host} />
      {state === 'loading' && <div class="showcase-note mute">Loading the 3D view…</div>}
      {state === 'none' && <div class="showcase-note mute">No 3D model for this item yet.</div>}
      {state === 'failed' && <div class="showcase-note mute">3D view is not available here.</div>}
      {studio ? (
        <div class="showcase-bar mode-bar mode-top" role="toolbar" aria-label="View">
          {spin}
          {reset}
          <i class="mode-sep" aria-hidden="true" />
          <button class={graphicsOpen.value ? 'on' : ''} aria-pressed={graphicsOpen.value} title="Graphics settings" onClick={toggleGraphics}>Graphics</button>
        </div>
      ) : (
        <div class="showcase-bar">
          <span class="mute showcase-hint">Drag · scroll</span>
          {spin}
          {reset}
          <button title="Back to the picture" aria-label="Close 3D view" onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
      )}
    </div>
  );
}
