import { useLayoutEffect, useRef } from 'preact/hooks';
import { hover } from '../game/hover';
import { snapshot } from '../game/store';
import { describeId } from './logic';

/** Tooltip near the pointer: plain line for everyone, nerd line below. Uses the snapshot to name slots and parts. */
export function Tooltip() {
  const h = hover.value;
  const ref = useRef<HTMLDivElement>(null);
  const d = h ? describeId(h.id, snapshot.value) : null;
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
