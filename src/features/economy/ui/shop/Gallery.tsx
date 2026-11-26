import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { galleryOpen, settingsOpen } from '@/core/ui/state';
import { playCue } from '@/app/audio/engine';
import { Icon } from '@/core/ui/kit/Icons';
import { GalleryFoot, GalleryPart, GalleryRead } from './GalleryHud';
import { GallerySpine } from './GallerySpine';
import * as partShelf from './PartShelf';
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
  const parts = useMemo<partShelf.ShelfPart[]>(
    () => all.flatMap((g) => g.items.map((i) => ({ id: i.id, name: i.name, kind: g.kind, tier: i.tier }))),
    [all],
  );
  const total = useMemo(() => all.reduce((n, g) => n + g.items.length, 0), [all]);
  const [gi, setGi] = useState(0);
  const [ii, setIi] = useState(0);
  const shelf = useRef<HTMLElement>(null);
  const read = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const group = all[gi]!,
    at = Math.min(ii, group.items.length - 1),
    item = group.items[at]!;
  const n = group.items.length;

  useGalleryKeys({ open, all, n, setGi, setIi });

  if (!open) {
    return null;
  }
  return (
    <GalleryView
      all={all}
      kinds={kinds}
      parts={parts}
      total={total}
      group={group}
      item={item}
      at={at}
      n={n}
      setGi={setGi}
      setIi={setIi}
      shelf={shelf}
      read={read}
      side={side}
      foot={foot}
      frame={frame}
    />
  );
}

function galleryStep(n: number, setIi: (fn: (i: number) => number) => void, d: number): void {
  playCue('ui_value_change');
  setIi((i) => (i + d + n) % n);
}

function galleryCat(opts: {
  all: ReturnType<typeof galleryGroups>;
  setGi: (fn: (g: number) => number) => void;
  setIi: (fn: (i: number) => number) => void;
  d: number;
}): void {
  playCue('ui_tab_switch');
  opts.setGi((g) => (g + opts.d + opts.all.length) % opts.all.length);
  opts.setIi(() => 0);
}

function onGalleryKey(opts: {
  e: KeyboardEvent;
  all: ReturnType<typeof galleryGroups>;
  n: number;
  setGi: (fn: (g: number) => number) => void;
  setIi: (fn: (i: number) => number) => void;
}): void {
  const { e, all, n, setGi, setIi } = opts;
  // (the graphics modal shuts itself on Escape: the Gallery stays)
  if (e.key === 'Escape') {
    if (!settingsOpen.peek()) {
      galleryOpen.value = false;
    }
    return;
  }
  if (e.key === 'ArrowRight') {
    galleryStep(n, setIi, 1);
  } else if (e.key === 'ArrowLeft') {
    galleryStep(n, setIi, -1);
  } else if (e.key === 'ArrowDown') {
    galleryCat({ all, setGi, setIi, d: 1 });
  } else if (e.key === 'ArrowUp') {
    galleryCat({ all, setGi, setIi, d: -1 });
  } else {
    return;
  }
  e.preventDefault();
}

function useGalleryKeys(opts: {
  open: boolean;
  all: ReturnType<typeof galleryGroups>;
  n: number;
  setGi: (fn: (g: number) => number) => void;
  setIi: (fn: (i: number) => number) => void;
}): void {
  const { open, all, n, setGi, setIi } = opts;
  useEffect(() => {
    if (!open) {
      return;
    }
    // (the cues of a part and a category change, ticket #66: the turntable's drag and zoom stay silent)
    const onKey = (e: KeyboardEvent) => {
      onGalleryKey({ e, all, n, setGi, setIi });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, all, n, setGi, setIi]);
}

interface GalleryBits {
  all: ReturnType<typeof galleryGroups>;
  kinds: string[];
  parts: partShelf.ShelfPart[];
  total: number;
  group: ReturnType<typeof galleryGroups>[number];
  item: ReturnType<typeof galleryGroups>[number]['items'][number];
  at: number;
  n: number;
  setGi: (n: number) => void;
  setIi: (n: number | ((i: number) => number)) => void;
  shelf: { current: HTMLElement | null };
  read: { current: HTMLElement | null };
  side: { current: HTMLDivElement | null };
  foot: { current: HTMLDivElement | null };
  frame: { current: HTMLDivElement | null };
}

function GalleryView(opts: GalleryBits) {
  const { all, kinds, parts, total, group, item, at, n, setGi, setIi, shelf, read, side, foot, frame } = opts;
  return (
    <div class="gallery mode" role="dialog" aria-modal="true" aria-label="Gallery">
      <div class="gal-main">
        <Showcase
          specId={item.id}
          onClose={() => {
            galleryOpen.value = false;
          }}
          studio={{ frame: () => frame.current }}
        />
        {/* the K1 brackets: the free box the part is framed in (the viewer's insets come from it) */}
        <div class="gal-brackets" ref={frame} aria-hidden="true" />
      </div>

      <GalleryChrome
        all={all}
        kinds={kinds}
        parts={parts}
        total={total}
        group={group}
        item={item}
        at={at}
        n={n}
        setGi={setGi}
        setIi={setIi}
        shelf={shelf}
        read={read}
        side={side}
        foot={foot}
        frame={frame}
      />
    </div>
  );
}

function GalleryChrome(opts: GalleryBits) {
  const { all, kinds, parts, total, group, item, at, n, setGi, setIi, shelf, read, side, foot } = opts;
  const pickKind = (k: string) => {
    setGi(Math.max(0, kinds.indexOf(k)));
    setIi(0);
  };
  return (
    <>
      {/* (one tab for what scrolls on a phone; on a desktop screen it is transparent to the layout) */}
      <div class="gal-scroll">
        <GallerySpine groups={all} kind={group.kind} setKind={pickKind} />
        <partShelf.PartShelf
          shelf={shelf}
          class="gal-shelf"
          rail={false}
          eyebrow={`Every part in 3D · ${total} parts`}
          title="Gallery"
          kinds={kinds}
          parts={parts}
          kind={group.kind}
          setKind={pickKind}
          current={item.id}
          tip={(p) => `Show ${p.name}`}
          onActivate={(p) => {
            playCue('ui_value_change');
            setIi(
              Math.max(
                0,
                group.items.findIndex((x) => x.id === p.id),
              ),
            );
          }}
        />
        <GalleryRead read={read} group={group} item={item} at={at} />
        <GalleryPart side={side} group={group} item={item} />
      </div>
      <GalleryCloseFoot foot={foot} at={at} n={n} setIi={setIi} />
    </>
  );
}

function GalleryCloseFoot(opts: {
  foot: { current: HTMLDivElement | null };
  at: number;
  n: number;
  setIi: (n: number | ((i: number) => number)) => void;
}) {
  const { foot, at, n, setIi } = opts;
  return (
    <>
      <button
        class="mode-close"
        data-cue="ui_panel_close"
        title="Close (Esc)"
        aria-label="Close"
        onClick={() => {
          galleryOpen.value = false;
        }}
      >
        <Icon name="close" size={12} />
      </button>
      <GalleryFoot
        foot={foot}
        at={at}
        n={n}
        step={(d) => {
          playCue('ui_value_change');
          setIi((i) => (i + d + n) % n);
        }}
      />
    </>
  );
}
