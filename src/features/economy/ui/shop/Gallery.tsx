import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { galleryOpen, graphicsOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { GalleryFoot, GalleryPart, GalleryRead } from './GalleryHud';
import { PartShelf, type ShelfPart } from './PartShelf';
import { Showcase } from './Showcase';
import { galleryGroups } from './shopdata';

// The GALLERY (main menu): every part with a 3D model, large, on the showcase's turntable. It is the "studio" look shared with Build my PC (ui.css, `.mode`) and
// has its HUD: the shelf of parts on the left (`PartShelf`: a click shows the part), the summary over the stage, the part's card on the right, the view options at
// the top right, and the foot with the stepper and the keys. The model fills the screen and sits clear of them all. Left and Right (or the stepper) change the
// part, Up and Down the category, Escape closes.

export function Gallery() {
  const open = galleryOpen.value;
  const all = useMemo(galleryGroups, []);
  const kinds = useMemo(() => all.map((g) => g.kind), [all]);
  const parts = useMemo<ShelfPart[]>(() => all.flatMap((g) => g.items.map((i) => ({ id: i.id, name: i.name, kind: g.kind, tier: i.tier }))), [all]);
  const [gi, setGi] = useState(0);
  const [ii, setIi] = useState(0);
  const shelf = useRef<HTMLElement>(null);
  const read = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const group = all[gi]!, at = Math.min(ii, group.items.length - 1), item = group.items[at]!;
  const n = group.items.length;

  useEffect(() => {
    if (!open) return;
    const step = (d: number) => setIi((i) => (i + d + n) % n);
    const cat = (d: number) => { setGi((g) => (g + d + all.length) % all.length); setIi(0); };
    const onKey = (e: KeyboardEvent) => {
      // (the graphics drawer shuts itself on Escape: the Gallery stays)
      if (e.key === 'Escape') { if (!graphicsOpen.peek()) galleryOpen.value = false; return; }
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
        <Showcase specId={item.id} onClose={() => { galleryOpen.value = false; }} studio={{ avoid: () => [shelf.current, read.current, side.current, foot.current] }} />
      </div>
      <PartShelf
        shelf={shelf}
        eyebrow="Every part in 3D"
        title="Gallery"
        kinds={kinds}
        parts={parts}
        kind={group.kind}
        setKind={(k) => { setGi(Math.max(0, kinds.indexOf(k))); setIi(0); }}
        current={item.id}
        tip={(p) => `Show ${p.name}`}
        onActivate={(p) => setIi(Math.max(0, group.items.findIndex((x) => x.id === p.id)))}
      />
      <GalleryRead read={read} group={group} item={item} at={at} />
      <button class="mode-close" title="Close (Esc)" aria-label="Close" onClick={() => { galleryOpen.value = false; }}><Icon name="close" size={12} /></button>
      <GalleryPart side={side} group={group} item={item} />
      <GalleryFoot foot={foot} at={at} n={n} step={(d) => setIi((i) => (i + d + n) % n)} />
    </div>
  );
}
