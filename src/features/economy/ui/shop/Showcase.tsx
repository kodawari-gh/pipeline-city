import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';

type Viewer = import('@/core/render/three/viewer').Viewer;
type Build = (specId: string) => import('three').Object3D | null;

/**
 * The showcase: the part you picked as a 3D model on a turntable. Drag to turn it, scroll or pinch to zoom, double-click to reset. The viewer
 * and the part builders load on the first look, so the shop opens as fast as before; one WebGL context lives while this is open.
 */
export function Showcase({ specId, onClose }: { specId: string; onClose: () => void }) {
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
        viewer.current = v.mountViewer(host.current);
        build.current = sc.buildShowcaseModel;
        ro = new ResizeObserver(() => viewer.current?.resize());
        ro.observe(host.current);
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

  return (
    <div class="showcase" role="group" aria-label="3D view">
      <div class="showcase-host" ref={host} />
      {state === 'loading' && <div class="showcase-note mute">Loading the 3D view…</div>}
      {state === 'none' && <div class="showcase-note mute">No 3D model for this item yet.</div>}
      {state === 'failed' && <div class="showcase-note mute">3D view is not available here.</div>}
      <div class="showcase-bar">
        <span class="mute showcase-hint">Drag · scroll</span>
        <button class={turning ? 'on' : ''} aria-pressed={turning} title="Turn by itself" onClick={() => setTurning(!turning)}>Spin</button>
        <button title="Reset the view (double-click)" onClick={() => viewer.current?.reset()}>Reset</button>
        <button title="Back to the picture" aria-label="Close 3D view" onClick={onClose}><Icon name="close" size={12} /></button>
      </div>
    </div>
  );
}
