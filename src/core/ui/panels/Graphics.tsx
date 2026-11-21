// The graphics modal: a sheet in the middle of the screen with the presets and each option on its own, in the studio's look (ui.css, `.gfx-back`). A change
// applies at once, so the player sees the picture move round the sheet: the dim is light where the picture shows, and Peek fades the sheet while it is held.
// The numbers at the top say what it costs. The settings and the presets live in `app/graphics.ts`, the words and the keys in `graphicsui.ts`.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  autoStep, BRIGHT_MAX, BRIGHT_MIN, CHOICES, effective, frameStats, graphics, presetOf, PRESET_NAMES, resetGraphics, retryPicture, SCALE_MAX, SCALE_MIN, setAutoTier, setGraphic, setPreset,
  setTier, TIER_NAMES, tierRecord, type Choice, type Graphics, type Tier,
} from '@/app/graphics';
import { Icon } from '../kit/Icons';
import { graphicsOpen } from '../state';
import { fpsTone, nextIndex, PRESET_INFO, tierNote } from './graphicsui';

interface Row { key: Choice; label: string; help: string }

/** The options of each group of the sheet, each with what it does in a line. */
const FPS_ROW: Row = { key: 'fps', label: 'Frame limit', help: 'Saves power and heat. Off runs at the rate of the screen.' };
const LIGHT: Row[] = [
  { key: 'shadows', label: 'Shadows', help: 'The size of the shadow maps. Off draws the fastest room.' },
  { key: 'lights', label: 'Room lamps', help: 'The most real-time lights at once, the window\'s and the case\'s included. All has no cap.' },
  { key: 'lightShadows', label: 'Lamp shadows', help: 'Do the room\'s lamps cast shadows.' },
  { key: 'ao', label: 'Ambient occlusion', help: 'Soft contact shadows in corners and under parts.' },
  { key: 'bloom', label: 'Bloom', help: 'The glow round the RGB, the screen and the lamp.' },
];
const DETAIL: Row[] = [
  { key: 'msaa', label: 'Anti-aliasing', help: 'Smooths the edges of every part.' },
  { key: 'textures', label: 'Textures', help: 'How sharp the board, the dies and their names are up close.' },
  { key: 'filtering', label: 'Filtering', help: 'Keeps textures sharp at a slant.' },
  { key: 'live', label: 'Live chips', help: 'How often and how sharply the running dies and the lit traces draw.' },
  { key: 'particles', label: 'Particles', help: 'Smoke off a burnt part, and the airflow lens.' },
];

const TABS = [
  { id: 'display', name: 'Display', icon: 'screen' },
  { id: 'light', name: 'Light', icon: 'sun' },
  { id: 'detail', name: 'Detail', icon: 'layers' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** What auto-adjust can take away, by the option's name in the panel. */
const LOWERED: readonly (readonly [keyof Graphics, string])[] = [['ao', 'ambient occlusion'], ['scale', 'render scale'], ['bloom', 'bloom'], ['msaa', 'anti-aliasing'], ['live', 'live chips'], ['shadows', 'sun shadows'], ['lightShadows', 'lamp shadows'], ['fps', 'frame limit']];

interface Radio<T> { id: T; node: ComponentChildren; on: boolean }

/**
 * A row of exclusive buttons, as a native radio group works: the chosen one is the only one in the tab order, the arrows (and Home and End) move the choice, and a
 * choice applies at once. With none chosen (a Custom picture) the first takes the tab stop.
 */
function Radios<T extends string | number | boolean>({ label, items, pick, class: cls }: { label: string; items: readonly Radio<T>[]; pick: (id: T) => void; class: string }) {
  const stop = Math.max(0, items.findIndex((i) => i.on));
  const onKey = (e: KeyboardEvent) => {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')];
    const to = nextIndex(buttons.indexOf(e.target as HTMLElement), items.length, e.key);
    if (to === null) return;
    e.preventDefault();
    pick(items[to]!.id);
    buttons[to]?.focus();
  };
  return (
    <div class={cls} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {items.map((it, i) => (
        <button key={String(it.id)} type="button" role="radio" aria-checked={it.on} tabIndex={i === stop ? 0 : -1} data-id={String(it.id)} onClick={() => pick(it.id)}>{it.node}</button>
      ))}
    </div>
  );
}

/** One option: its name and what it does on the left, its control on the right. */
function Option({ label, help, children }: { label: string; help: string; children: ComponentChildren }) {
  return (
    <div class="gfx-opt">
      <span class="gfx-name"><b>{label}</b><span class="gfx-help">{help}</span></span>
      {children}
    </div>
  );
}

function Choices({ row, value }: { row: Row; value: number }) {
  return (
    <Option label={row.label} help={row.help}>
      <Radios class="gfx-seg" label={row.label} pick={(v) => setGraphic(row.key, v)} items={CHOICES[row.key].map(([v, name]) => ({ id: v, node: name, on: v === value }))} />
    </Option>
  );
}

function Slider({ label, help, min, max, value, set }: { label: string; help: string; min: number; max: number; value: number; set: (v: number) => void }) {
  const text = `${Math.round(value * 100)}%`;
  return (
    <label class="gfx-opt">
      <span class="gfx-name"><b>{label}</b><span class="gfx-help">{help}</span></span>
      <span class="gfx-slide">
        <input type="range" min={min} max={max} step={0.05} value={value} aria-label={label} aria-valuetext={text} style={{ '--p': `${((value - min) / (max - min)) * 100}%` }}
          onInput={(e) => set(Number(e.currentTarget.value))} />
        <b class="gfx-val">{text}</b>
      </span>
    </label>
  );
}

/** The frame rate, the frame time and the size of the picture, measured by the renderer behind the sheet. */
function Numbers({ limit }: { limit: number }) {
  const f = frameStats.value;
  return (
    <div class="gfx-stats" role="group" aria-label="Frame statistics">
      <span class={`gfx-fig gfx-fps ${fpsTone(f.fps, limit)}`}><b>{f.fps ? Math.round(f.fps) : '--'}</b><em>FPS</em></span>
      <span class="gfx-fig"><b>{f.ms ? f.ms.toFixed(1) : '--'}</b><em>ms a frame</em></span>
      <span class="gfx-fig"><b>{f.w ? `${f.w}×${f.h}` : '--'}</b><em>drawn</em></span>
    </div>
  );
}

/** The tier picker: Auto follows the detected tier (and its one step); a tier, a preset or any option makes it manual. */
function TierPicker() {
  const rec = tierRecord.value, auto = rec.mode === 'auto';
  return (
    <div class="gfx-tier" title="The device's performance tier. Auto picks it from the GPU and CPU, and may step once after the first seconds of frames.">
      <span class="gfx-tier-name">Device tier</span>
      <Radios<'auto' | Tier> class="gfx-seg" label="Tier" pick={(id) => (id === 'auto' ? setAutoTier() : setTier(id))}
        items={[{ id: 'auto', node: 'Auto', on: auto }, ...TIER_NAMES.map(([id, name]) => ({ id, node: name, on: !auto && rec.tier === id }))]} />
      <span class="gfx-tier-note">{tierNote(rec)}</span>
    </div>
  );
}

/** Says what auto-adjust took away, and offers it back. */
function AutoNote({ g }: { g: Graphics }) {
  const e = effective.value;
  if (!autoStep.value) return null;
  const names = LOWERED.filter(([k]) => e[k] !== g[k]).map(([, name]) => name);
  return (
    <div class="gfx-note" role="status">
      <Icon name="warn" size={12} />
      <span>Frames were slow, so auto-adjust lowered {names.join(', ')}.</span>
      <button onClick={retryPicture}>Try again</button>
    </div>
  );
}

/** The tabs of the groups of options: the arrows move between them. */
function Tabs({ tab, set }: { tab: TabId; set: (t: TabId) => void }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
    const to = nextIndex(TABS.findIndex((t) => t.id === tab), TABS.length, e.key);
    if (to === null) return;
    e.preventDefault();
    set(TABS[to]!.id);
    ([...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')][to])?.focus();
  };
  return (
    <div class="gfx-tabs" role="tablist" aria-label="Groups of options" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" id={`gfx-tab-${t.id}`} aria-controls="gfx-panel" aria-selected={t.id === tab} tabIndex={t.id === tab ? 0 : -1} onClick={() => set(t.id)}>
          <Icon name={t.icon} size={12} />{t.name}
        </button>
      ))}
    </div>
  );
}

/** The options of the open tab. */
function Options({ tab, g }: { tab: TabId; g: Graphics }) {
  if (tab === 'display') {
    return (
      <>
        <Slider label="Render scale" help="The pixels the picture draws, as a share of the screen's." min={SCALE_MIN} max={SCALE_MAX} value={g.scale} set={(v) => setGraphic('scale', v)} />
        <Choices row={FPS_ROW} value={g.fps} />
        <Slider label="Brightness" help="The picture's exposure. Presets leave it alone." min={BRIGHT_MIN} max={BRIGHT_MAX} value={g.brightness} set={(v) => setGraphic('brightness', v)} />
        <Option label="Auto-adjust" help="Lowers the picture while the frames stay under 30 FPS.">
          <Radios class="gfx-seg" label="Auto-adjust" pick={(on) => setGraphic('auto', on)} items={[{ id: false, node: 'Off', on: !g.auto }, { id: true, node: 'On', on: g.auto }]} />
        </Option>
      </>
    );
  }
  return <>{(tab === 'light' ? LIGHT : DETAIL).map((r) => <Choices key={r.key} row={r} value={g[r.key]} />)}</>;
}

/** Hold it and the sheet fades, so the whole picture shows (a change applies at once, and the sheet covers the middle of the picture). */
function Peek({ set }: { set: (on: boolean) => void }) {
  const hold = (e: PointerEvent) => {
    if (e.button !== 0) return;
    set(true);
    // (the sheet is gone from under the pointer while it is held: the release is heard on the window)
    const end = () => { set(false); for (const n of ['pointerup', 'pointercancel', 'blur']) window.removeEventListener(n, end); };
    for (const n of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(n, end);
  };
  const key = (on: boolean) => (e: KeyboardEvent) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) set(on); };
  return (
    <button class="gfx-peek" type="button" title="Hold to see the whole picture" onPointerDown={hold} onKeyDown={key(true)} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') set(false); }}
      onBlur={() => set(false)} onContextMenu={(e) => e.preventDefault()}>
      <Icon name="eye" size={12} />Peek
    </button>
  );
}

const close = () => { graphicsOpen.value = false; };

export function GraphicsModal() {
  const open = graphicsOpen.value;
  const dialog = useRef<HTMLElement>(null);
  const downOnDim = useRef(false);
  const [tab, setTab] = useState<TabId>('display');
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    if (!open) { setPeek(false); return; }
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    // (the sheet takes the keys that reach it; one with the focus outside it still gets Escape)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dialog.current?.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;
  const g = graphics.value, preset = presetOf(g);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab' && dialog.current) {
      // a focus trap: Tab and Shift+Tab wrap inside the sheet
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled)')];
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      if (first && last && e.shiftKey && (at === first || at === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (first && last && !e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }
    // the screen behind keeps its keys (the Gallery's arrows, Build's letters, the pause key) out of the sheet's
    e.stopPropagation();
  };

  return (
    <div
      class={`gfx-back ${peek ? 'peek' : ''}`}
      // a click on the dim closes the sheet, when it began there too (a slider dragged out of the sheet does not)
      onPointerDown={(e) => { downOnDim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnDim.current && e.target === e.currentTarget) close(); downOnDim.current = false; }}
    >
      <section ref={dialog} class="gfx" role="dialog" aria-modal="true" aria-labelledby="gfx-title" tabIndex={-1} onKeyDown={onKeyDown}>
        <header class="gfx-head">
          <div class="mode-head"><span class="mode-eyebrow">Picture · changes apply at once</span><b id="gfx-title">Graphics</b></div>
          <Numbers limit={g.fps} />
          <button class="gfx-close" type="button" aria-label="Close graphics" title="Close (Esc)" onClick={close}><Icon name="close" size={12} /></button>
        </header>

        <div class="gfx-body">
          <section class="gfx-quality" aria-label="Quality">
            <div class="gfx-label">
              <span class="mode-eyebrow">Quality</span>
              {!preset && <span class="gfx-custom">Custom: your own mix of the options below</span>}
            </div>
            <Radios class="gfx-presets" label="Preset" pick={setPreset}
              items={PRESET_NAMES.map(([id, name]) => ({
                id, on: preset === id,
                node: (
                  <>
                    <b>{name}</b>
                    <span class="bld-pips" aria-hidden="true">{[0, 1, 2, 3].map((n) => <i key={n} class={n < PRESET_INFO[id].pips ? 'on' : ''} />)}</span>
                    <em>{PRESET_INFO[id].line}</em>
                  </>
                ),
              }))} />
            <TierPicker />
            <AutoNote g={g} />
          </section>

          <Tabs tab={tab} set={setTab} />
          <div class="gfx-list" role="tabpanel" id="gfx-panel" aria-labelledby={`gfx-tab-${tab}`}>
            <Options tab={tab} g={g} />
          </div>
        </div>

        <footer class="gfx-foot">
          <Peek set={setPeek} />
          <span class="mode-hint gfx-kept">Kept on this device, not in the save.</span>
          <button type="button" class="gfx-reset" title="The detected tier's picture, with the frame limit, the brightness and auto-adjust at their defaults" onClick={resetGraphics}><Icon name="undo" size={12} />Reset to defaults</button>
          <button type="button" class="gfx-done" onClick={close}><Icon name="check" size={12} />Done</button>
        </footer>
      </section>
    </div>
  );
}
