import { useEffect, useMemo, useState } from 'preact/hooks';
import { galleryOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { Showcase } from './Showcase';
import { galleryGroups, kindIcon, kindLabel } from './shopdata';

// The GALLERY (main menu): every part with a 3D model, large, on the showcase's turntable. It is the "studio" look shared with Build my PC
// (ui.css, `.mode`): the model fills the screen, a glass category list floats on the left and a dock with the part's name, its variants and
// the keys floats at the bottom. Left and Right (or the dock) change the part, Up and Down the category, Escape closes.

export function Gallery() {
  const open = galleryOpen.value;
  const all = useMemo(galleryGroups, []);
  const [gi, setGi] = useState(0);
  const [ii, setIi] = useState(0);
  const group = all[gi]!, at = Math.min(ii, group.items.length - 1), item = group.items[at]!;
  const n = group.items.length;

  useEffect(() => {
    if (!open) return;
    const step = (d: number) => setIi((i) => (i + d + n) % n);
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
  }, [open, gi, all, n]);

  if (!open) return null;
  return (
    <div class="gallery mode" role="dialog" aria-modal="true" aria-label="Gallery">
      <div class="gal-main">
        <Showcase specId={item.id} onClose={() => { galleryOpen.value = false; }} />
      </div>
      <nav class="gal-rail mode-panel" aria-label="Categories">
        <header class="mode-head"><span class="mode-eyebrow">Every part in 3D</span><b>Gallery</b></header>
        <div class="gal-cats">
          {all.map((g, i) => (
            <button key={g.key} class={`gal-cat ${i === gi ? 'on' : ''}`} aria-pressed={i === gi} onClick={() => { setGi(i); setIi(0); }}>
              <Icon name={kindIcon(g.kind)} size={14} /><span>{kindLabel(g.kind)}</span><em>{g.items.length}</em>
            </button>
          ))}
        </div>
      </nav>
      <button class="mode-close" title="Close (Esc)" aria-label="Close" onClick={() => { galleryOpen.value = false; }}><Icon name="close" size={12} /></button>
      <section class="gal-dock mode-panel" aria-label="Part">
        <div class="gal-title">
          <button class="gal-arrow" aria-label="Previous part" title="Previous part (←)" onClick={() => setIi((i) => (i - 1 + n) % n)}>‹</button>
          <div class="gal-name">
            <span class="mode-eyebrow">{kindLabel(group.kind)} · {at + 1} of {n}</span>
            <span class="gal-line"><b>{item.name}</b><span class="mute">{item.note}</span></span>
          </div>
          <button class="gal-arrow" aria-label="Next part" title="Next part (→)" onClick={() => setIi((i) => (i + 1) % n)}>›</button>
        </div>
        {n > 1 && (
          <div class="gal-items" role="listbox" aria-label="Parts">
            {group.items.map((x, i) => (
              <button key={x.id} role="option" aria-selected={x === item} class={x === item ? 'on' : ''} onClick={() => setIi(i)}>{x.name}</button>
            ))}
          </div>
        )}
        <div class="mode-keys" aria-hidden="true">
          <span><kbd>Drag</kbd>turn</span><span><kbd>Right-drag</kbd>pan</span><span><kbd>Scroll</kbd>zoom</span>
          <span><kbd>←</kbd><kbd>→</kbd>part</span><span><kbd>↑</kbd><kbd>↓</kbd>category</span><span><kbd>Esc</kbd>leave</span>
        </div>
      </section>
    </div>
  );
}
