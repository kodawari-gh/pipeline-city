import { useEffect, useMemo, useState } from 'preact/hooks';
import { CASE_TIERS, specsOfKind, type DeviceKind } from '@/features/board/sim/specs';
import { galleryOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { Showcase } from './Showcase';
import { kindIcon, kindLabel } from './shopdata';

// The GALLERY (main menu): every part with a 3D model, large, on the showcase's turntable. It is the shop's 3D view with the shop taken
// away: a category rail, the parts of the category and the model. Left and Right (or the list) change the part, Up and Down the category,
// Escape closes.

interface Item { id: string; name: string; note: string }
interface Group { key: string; kind: string; items: Item[] }

const KINDS: DeviceKind[] = ['cpu', 'cooler', 'fan', 'radiator', 'ram', 'psu', 'display', 'storage', 'vrm-sink', 'ram-sink', 'gpu', 'npu', 'nic', 'tpm'];

/** Every part the showcase can build, by category (cases first, as the shop lists them). */
function groups(): Group[] {
  const out: Group[] = [{ key: 'case', kind: 'case', items: CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, note: `${c.form} case` })) }];
  for (const k of KINDS) out.push({ key: k, kind: k, items: specsOfKind(k).map((s) => ({ id: s.id, name: s.name, note: `tier ${s.tier}` })) });
  return out.filter((g) => g.items.length > 0);
}

export function Gallery() {
  const open = galleryOpen.value;
  const all = useMemo(groups, []);
  const [gi, setGi] = useState(0);
  const [ii, setIi] = useState(0);
  const group = all[gi]!, item = group.items[Math.min(ii, group.items.length - 1)]!;

  useEffect(() => {
    if (!open) return;
    const step = (d: number) => setIi((i) => (i + d + group.items.length) % group.items.length);
    const cat = (d: number) => { setGi((g) => (g + d + all.length) % all.length); setIi(0); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') galleryOpen.value = false;
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowDown') cat(1);
      else if (e.key === 'ArrowUp') cat(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, gi, all, group.items.length]);

  if (!open) return null;
  return (
    <div class="gallery" role="dialog" aria-modal="true" aria-label="Gallery">
      <nav class="gal-rail" aria-label="Categories">
        <div class="gal-h">Gallery</div>
        {all.map((g, i) => (
          <button key={g.key} class={i === gi ? 'on' : ''} aria-pressed={i === gi} onClick={() => { setGi(i); setIi(0); }}>
            <Icon name={kindIcon(g.kind)} size={14} /> {kindLabel(g.kind)}
          </button>
        ))}
      </nav>
      <main class="gal-main">
        <Showcase specId={item.id} onClose={() => { galleryOpen.value = false; }} />
        <div class="gal-title"><b>{item.name}</b><span class="mute">{item.note}</span></div>
        <div class="gal-items" role="listbox" aria-label="Parts">
          {group.items.map((x, i) => (
            <button key={x.id} role="option" aria-selected={x === item} class={x === item ? 'on' : ''} onClick={() => setIi(i)}>{x.name}</button>
          ))}
        </div>
        <div class="mute gal-hint">Drag to turn · scroll to zoom · ← → part · ↑ ↓ category · Esc to leave</div>
      </main>
    </div>
  );
}
