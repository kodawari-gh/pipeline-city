import { useLayoutEffect, useRef } from 'preact/hooks';
import { hover, selected } from '../game/hover';
import { snapshot } from '../game/store';
import { describeId, liveDevice } from './logic';

/** Tooltip near the pointer: plain line for everyone, nerd line below. */
export function Tooltip() {
  const h = hover.value;
  const ref = useRef<HTMLDivElement>(null);
  const d = h ? describeId(h.id) : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !h) return;
    const pad = 14;
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const x = h.x + pad + w > window.innerWidth ? h.x - pad - w : h.x + pad;
    const y = h.y + pad + ht > window.innerHeight ? h.y - pad - ht : h.y + pad;
    el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  });
  if (!h || !d) return null;
  return (
    <div class="tooltip" ref={ref} role="tooltip">
      <b>{d.title}</b>
      <div>{d.plain}</div>
      <div class="nerd">{d.nerd}</div>
    </div>
  );
}

/** Pinned detail panel for the clicked device or region. */
export function DevicePanel() {
  const id = selected.value;
  if (!id) return null;
  const d = describeId(id);
  if (!d) return null;
  const live = liveDevice(snapshot.value, id);
  return (
    <div class="card devpanel">
      <button class="close" aria-label="Close" onClick={() => { selected.value = null; }}>x</button>
      <b>{d.title}</b>
      <div>{d.plain}</div>
      <div class="nerd">{d.nerd}</div>
      {live && (
        <div class="live">
          {live.burnt ? <span class="note bad">burnt out</span> : (
            <>
              <span>{live.tempC.toFixed(0)} C</span>
              <span>{live.powerW.toFixed(1)} W</span>
              <span>{live.effectiveClock.toFixed(2)}x</span>
              {live.throttle < 1 && <span class="note warn">throttled</span>}
              {live.unstable && <span class="note bad">unstable</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
