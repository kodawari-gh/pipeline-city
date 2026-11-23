import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { galleryOpen, settingsOpen } from '@/core/ui/state';
import { playCue } from '@/app/audio/engine';
import { Icon } from '@/core/ui/kit/Icons';
import { GalleryFoot, GalleryPart, GalleryRead } from './GalleryHud';
import { GallerySpine } from './GallerySpine';
import { PartShelf, type ShelfPart } from './PartShelf';
import { Showcase } from './Showcase';
import { galleryGroups } from './shopdata';

// The GALLERY (main menu): every part with a 3D model, large, on the showcase's turntable. It is the "studio" look shared with Build my PC (ui.css, `.mode`) and
// has its HUD: the spine of categories on the left (`GallerySpine`), the summary over the stage, the part's card and the shelf of its category's parts on the
// right (`PartShelf`: a click shows the part), the view options at the top right, and the foot with the stepper and the keys. The model fills the screen and
// sits clear of them all. Left and Right (or the stepper) change the part, Up and Down the category, Escape closes.

export function Gallery() {
  const open = galleryOpen.value;
  const all = useMemo(galleryGroups, []);
  const kinds = useMemo(() => all.map((g) => g.kind), [all]);
  const parts = useMemo<ShelfPart[]>(() => all.flatMap((g) => g.items.map((i) => ({ id: i.id, name: i.name, kind: g.kind, tier: i.tier }))), [all]);
  const total = useMemo(() => all.reduce((n, g) => n + g.items.length, 0), [all]);
  const [gi, setGi] = useState(0);
  const [ii, setIi] = useState(0);
  const shelf = useRef<HTMLElement>(null);
  const read = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const group = all[gi]!, at = Math.min(ii, group.items.length - 1), item = group.items[at]!;
  const n = group.items.length;

  useEffect(() => {
    if (!open) return;
    // (the cues of a part and a category change, ticket #66: the turntable's drag and zoom stay silent)
    const step = (d: number) => { playCue('ui_value_change'); setIi((i) => (i + d + n) % n); };
    const cat = (d: number) => { playCue('ui_tab_switch'); setGi((g) => (g + d + all.length) % all.length); setIi(0); };
    const onKey = (e: KeyboardEvent) => {
      // (the graphics modal shuts itself on Escape: the Gallery stays)
      if (e.key === 'Escape') { if (!settingsOpen.peek()) galleryOpen.value = false; return; }
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
        <Showcase specId={item.id} onClose={() => { galleryOpen.value = false; }} studio={{ frame: () => frame.current }} />
        {/* the K1 brackets: the free box the part is framed in (the viewer's insets come from it) */}
        <div class="gal-brackets" ref={frame} aria-hidden="true" />
      </div>

      {/* (one tab for what scrolls on a phone; on a desktop screen it is transparent to the layout) */}
      <div class="gal-scroll">
      <GallerySpine groups={all} kind={group.kind} setKind={(k) => { setGi(Math.max(0, kinds.indexOf(k))); setIi(0); }} />
      <PartShelf
        shelf={shelf}
        class="gal-shelf"
        rail={false}
        eyebrow={`Every part in 3D · ${total} parts`}
        title="Gallery"
        kinds={kinds}
        parts={parts}
        kind={group.kind}
        setKind={(k) => { setGi(Math.max(0, kinds.indexOf(k))); setIi(0); }}
        current={item.id}
        tip={(p) => `Show ${p.name}`}
        onActivate={(p) => { playCue('ui_value_change'); setIi(Math.max(0, group.items.findIndex((x) => x.id === p.id))); }}
      />
      <GalleryRead read={read} group={group} item={item} at={at} />
      <GalleryPart side={side} group={group} item={item} />
      </div>
      <button class="mode-close" data-cue="ui_panel_close" title="Close (Esc)" aria-label="Close" onClick={() => { galleryOpen.value = false; }}><Icon name="close" size={12} /></button>
      <GalleryFoot foot={foot} at={at} n={n} step={(d) => { playCue('ui_value_change'); setIi((i) => (i + d + n) % n); }} />
    </div>
  );
}
