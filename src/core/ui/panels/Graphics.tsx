// The graphics drawer: the presets and each option on its own. A change applies at once, so the player sees the picture move behind the panel, and the numbers
// at the top say what it costs. Only the options of the running renderer show (`rendererKind`). The settings and the presets live in `app/graphics.ts`.
import { useEffect } from 'preact/hooks';
import {
  autoStep, BRIGHT_MAX, BRIGHT_MIN, CHOICES, effective, frameStats, graphics, presetOf, PRESET_NAMES, rendererKind, resetGraphics, retryPicture, SCALE_MAX, SCALE_MIN, setAutoTier, setGraphic, setPreset,
  setTier, TIER_NAMES, tierRecord, type Choice, type Graphics, type RendererKind,
} from '@/app/graphics';
import { Icon } from '../kit/Icons';
import { graphicsOpen, toggleGraphics } from '../state';

interface Row { key: Choice; label: string; help: string; only?: RendererKind }

/** The options by group, each with what it does in a line. The groups show only when a row of theirs does. */
const GROUPS: { title: string; rows: Row[] }[] = [
  { title: 'Light', rows: [
    { key: 'shadows', label: 'Shadows', help: 'The size of the shadow maps. Off draws the fastest room.', only: '3d' },
    { key: 'lights', label: 'Room lamps', help: 'The most real-time lamps the room lights at once. All has no cap.', only: '3d' },
    { key: 'lightShadows', label: 'Lamp shadows', help: 'Do the room\'s lamps cast shadows.', only: '3d' },
    { key: 'ao', label: 'Ambient occlusion', help: 'Soft contact shadows in corners and under parts.', only: '3d' },
    { key: 'bloom', label: 'Bloom', help: 'The glow round the RGB, the screen and the lamp.', only: '3d' },
  ] },
  { title: 'Detail', rows: [
    { key: 'msaa', label: 'Anti-aliasing', help: 'Smooths the edges of every part.', only: '3d' },
    { key: 'textures', label: 'Textures', help: 'How sharp the board, the dies and their names are up close.', only: '3d' },
    { key: 'filtering', label: 'Filtering', help: 'Keeps textures sharp at a slant.', only: '3d' },
    { key: 'live', label: 'Live chips', help: 'How often and how sharply the running dies draw.', only: '3d' },
    { key: 'particles', label: 'Particles', help: 'Haze off hot parts, smoke and sparks.', only: '3d' },
  ] },
];

/** What auto-adjust can take away, by the option's name in the panel. */
const LOWERED: readonly (readonly [keyof Graphics, string])[] = [['ao', 'ambient occlusion'], ['scale', 'render scale'], ['bloom', 'bloom'], ['msaa', 'anti-aliasing'], ['live', 'live chips']];

function Choices({ row, value }: { row: Row; value: number }) {
  return (
    <div class="gfx-row" title={row.help}>
      <span class="gfx-name">{row.label}</span>
      <div class="seg" role="group" aria-label={row.label}>
        {CHOICES[row.key].map(([v, name]) => (
          <button key={v} class={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => setGraphic(row.key, v)}>{name}</button>
        ))}
      </div>
      <span class="gfx-help">{row.help}</span>
    </div>
  );
}

function Slider({ label, help, min, max, value, set }: { label: string; help: string; min: number; max: number; value: number; set: (v: number) => void }) {
  return (
    <label class="gfx-row gfx-slider" title={help}>
      <span class="gfx-name">{label}</span>
      <input type="range" min={min} max={max} step={0.05} value={value} aria-label={label} aria-valuetext={`${Math.round(value * 100)}%`}
        onInput={(e) => set(Number(e.currentTarget.value))} />
      <b class="value">{Math.round(value * 100)}%</b>
      <span class="gfx-help">{help}</span>
    </label>
  );
}

function Numbers() {
  const f = frameStats.value;
  return (
    <div class="gfx-stats" role="status">
      <span><b>{f.fps ? Math.round(f.fps) : '--'}</b> FPS</span>
      <span><b>{f.ms ? f.ms.toFixed(1) : '--'}</b> ms</span>
      <span><b>{f.w ? `${f.w} x ${f.h}` : '--'}</b></span>
    </div>
  );
}

/** The tier picker: Auto follows the detected tier (and its one step); a tier, a preset or any option makes it manual. */
function TierPicker() {
  const rec = tierRecord.value, auto = rec.mode === 'auto', name = TIER_NAMES.find(([id]) => id === rec.tier)![1];
  return (
    <div class="gfx-row" title="The device's performance tier. Auto picks it from the GPU and CPU, and may step once after the first seconds of frames.">
      <span class="gfx-name">Tier</span>
      <div class="seg" role="group" aria-label="Tier">
        <button class={auto ? 'on' : ''} aria-pressed={auto} onClick={() => setAutoTier()}>{`Auto (${name}${rec.reason ? ` - ${rec.reason}` : ''})`}</button>
        {TIER_NAMES.map(([id, label]) => {
          const on = !auto && rec.tier === id;
          return <button key={id} class={on ? 'on' : ''} aria-pressed={on} onClick={() => setTier(id)}>{label}</button>;
        })}
      </div>
    </div>
  );
}

/** Says what auto-adjust took away, and offers it back. */
function AutoNote({ g }: { g: Graphics }) {
  const e = effective.value;
  if (!autoStep.value) return null;
  const names = LOWERED.filter(([k]) => e[k] !== g[k]).map(([, name]) => name);
  return (
    <div class="gfx-note">
      <span>Frames were slow, so auto-adjust lowered {names.join(', ')}.</span>
      <button onClick={retryPicture}>Try again</button>
    </div>
  );
}

export function GraphicsDock() {
  const open = graphicsOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleGraphics(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const g = graphics.value, kind = rendererKind.value, preset = presetOf(g);
  const fits = (r: Row) => !r.only || r.only === kind;
  return (
    <aside class="dock gfx" aria-label="Graphics">
      <button class="close" aria-label="Close graphics" onClick={toggleGraphics}><Icon name="close" size={11} /></button>
      <h2>Graphics</h2>
      <Numbers />
      <TierPicker />
      <div class="seg gfx-presets" role="group" aria-label="Preset">
        {PRESET_NAMES.map(([id, name]) => <button key={id} class={preset === id ? 'on' : ''} aria-pressed={preset === id} onClick={() => setPreset(id)}>{name}</button>)}
      </div>
      {!preset && <div class="gfx-custom">Custom: your own mix of the options below.</div>}
      <AutoNote g={g} />
      <h3>Display</h3>
      <Slider label="Render scale" help="The pixels the picture draws, as a share of the screen's." min={SCALE_MIN} max={SCALE_MAX} value={g.scale} set={(v) => setGraphic('scale', v)} />
      <Choices row={{ key: 'fps', label: 'Frame limit', help: 'Saves power and heat. Off runs at the rate of the screen.' }} value={g.fps} />
      {kind === '3d' && <Slider label="Brightness" help="The picture's exposure. Presets leave it alone." min={BRIGHT_MIN} max={BRIGHT_MAX} value={g.brightness} set={(v) => setGraphic('brightness', v)} />}
      {kind === '3d' && (
        <div class="gfx-row" title="Lowers the picture by steps while the frames stay under 30 FPS.">
          <span class="gfx-name">Auto-adjust</span>
          <div class="seg" role="group" aria-label="Auto-adjust">
            <button class={g.auto ? '' : 'on'} aria-pressed={!g.auto} onClick={() => setGraphic('auto', false)}>Off</button>
            <button class={g.auto ? 'on' : ''} aria-pressed={g.auto} onClick={() => setGraphic('auto', true)}>On</button>
          </div>
          <span class="gfx-help">Lowers the picture while the frames stay under 30 FPS.</span>
        </div>
      )}
      {GROUPS.filter((s) => s.rows.some(fits)).map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.rows.filter(fits).map((r) => <Choices key={r.key} row={r} value={g[r.key]} />)}
        </section>
      ))}
      <div class="pactions"><button onClick={resetGraphics}>Reset to defaults</button></div>
    </aside>
  );
}
