import { useEffect, useMemo, useState } from 'preact/hooks';
import { galleryOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { Showcase } from './Showcase';
import { galleryGroups, kindIcon, kindLabel } from './shopdata';

// The GALLERY (main menu): every part with a 3D model, large, on the showcase's turntable. It is the shop's 3D view with the shop taken
// away: a category rail, the parts of the category and the model. Left and Right (or the list) change the part, Up and Down the category,
// Escape closes.

export function Gallery() {
  const open = galleryOpen.value;
  const all = useMemo(galleryGroups, []);
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
        <div class="gal-h">Categories</div>
        {all.map((g, i) => (
          <button key={g.key} class={i === gi ? 'on' : ''} aria-pressed={i === gi} onClick={() => { setGi(i); setIi(0); }}>
            <Icon name={kindIcon(g.kind)} size={14} /> {kindLabel(g.kind)}
          </button>
        ))}
      </nav>
      <main class="gal-main">
        <Showcase specId={item.id} onClose={() => { galleryOpen.value = false; }} />
        <div class="mode-title" aria-hidden="true">Gallery</div>
        <button class="mode-close" title="Close (Esc)" aria-label="Close" onClick={() => { galleryOpen.value = false; }}><Icon name="close" size={12} /></button>
        <div class="gal-title">
          <button class="gal-arrow" aria-label="Previous part" title="Previous part (←)" onClick={() => setIi((i) => (i - 1 + group.items.length) % group.items.length)}>‹</button>
          <div class="gal-name"><b>{item.name}</b><span class="mute">{item.note}</span></div>
          <span class="mute gal-count">{kindLabel(group.kind)} · {Math.min(ii, group.items.length - 1) + 1} of {group.items.length}</span>
          <button class="gal-arrow" aria-label="Next part" title="Next part (→)" onClick={() => setIi((i) => (i + 1) % group.items.length)}>›</button>
        </div>
        <div class="gal-items" role="listbox" aria-label="Parts">
          {group.items.map((x, i) => (
            <button key={x.id} role="option" aria-selected={x === item} class={x === item ? 'on' : ''} onClick={() => setIi(i)}>{x.name}</button>
          ))}
        </div>
        <div class="mute mode-hint">Drag to turn · right-drag to pan · scroll to zoom · ← → part · ↑ ↓ category · Esc to leave</div>
      </main>
    </div>
  );
}
