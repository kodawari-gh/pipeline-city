// The SETTINGS screen (SPEC §5.6, screen 06; ticket #38): one screen for the picture and the interface, opened from the main menu, the game menu
// or the Build and Gallery screens. Five tabs on a rail (Quality, Display, Light, Detail, Interface). Tab reaches the rail; ← → move between tabs
// while the rail has the focus. Inside a tab: ↑ ↓ move between rows and ← → change the value of the row. Hold to peek fades the whole layer (mouse,
// keyboard or touch). Every change applies at once. Back and Esc return to the opener (`openSettings`, `closeSettings` in state.ts).
// The settings live in `app/graphics.ts`, the words in `graphicsui.ts`. Styles: ui.css (the Settings section).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  autoStep,
  BRIGHT_MAX,
  BRIGHT_MIN,
  CHOICES,
  effective,
  frameStats,
  graphics,
  presetOf,
  PRESET_NAMES,
  resetGraphics,
  retryPicture,
  SCALE_MAX,
  SCALE_MIN,
  setAutoTier,
  setGraphic,
  setPreset,
  setTier,
  TIER_NAMES,
  tierRecord,
  type Choice,
  type Graphics,
  type Preset,
  type Tier,
} from '@/app/graphics';
import { audioMix, setMuted, setSlider, SLIDER_IDS, SLIDER_LABEL } from '@/app/audio/mix';
import { MIX } from '@/app/audio/mixTokens';
import { playCue } from '@/app/audio/engine';
import { sliderStep } from '@/app/audio/uiCues';
import { closeSettings, setUiScale, settingsOpen, uiScale, UI_SCALE_MAX, UI_SCALE_MIN } from '../state';
import { cycleValue } from '../menuNav';
import { DisplayTitle } from '../kit/Pipeline';
import { PRESET_INFO, tierNote } from './graphicsui';
import { peekHeld, type PeekEvent, railMove, rowMove, SETTINGS_TABS, type SettingsTabId } from './settingsnav';

/** A row of values: ← → change it, a click picks one. */
interface PickRow {
  kind: 'pick';
  key: string;
  label: string;
  help: string;
  options: [string, string][];
  value: string | null;
  set: (id: string) => void;
}
/** A slider: ← → move it one step, a click or drag sets it. */
interface SlideRow {
  kind: 'slide';
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  set: (v: number) => void;
}
/** A button row. */
interface ActRow {
  kind: 'act';
  key: string;
  label: string;
  help: string;
  run: () => void;
}
type Row = PickRow | SlideRow | ActRow;

/** The options of the picture, each with what it does in a line. */
const FPS_ROW = {
  key: 'fps',
  label: 'Frame limit',
  help: 'Saves power and heat. Off runs at the rate of the screen.',
} as const;
const LIGHT: { key: Choice; label: string; help: string }[] = [
  { key: 'shadows', label: 'Shadows', help: 'The size of the shadow maps. Off draws the fastest room.' },
  {
    key: 'lights',
    label: 'Room lamps',
    help: "The most real-time lights at once, the window's and the case's included. All has no cap.",
  },
  { key: 'lightShadows', label: 'Lamp shadows', help: "Do the room's lamps cast shadows." },
  { key: 'ao', label: 'Ambient occlusion', help: 'Soft contact shadows in corners and under parts.' },
  { key: 'bloom', label: 'Bloom', help: 'The glow round the RGB, the screen and the lamp.' },
];
const DETAIL: { key: Choice; label: string; help: string }[] = [
  { key: 'msaa', label: 'Anti-aliasing', help: 'Smooths the edges of every part.' },
  { key: 'textures', label: 'Textures', help: 'How sharp the board, the dies and their names are up close.' },
  { key: 'filtering', label: 'Filtering', help: 'Keeps textures sharp at a slant.' },
  { key: 'live', label: 'Live chips', help: 'How often and how sharply the running dies and the lit traces draw.' },
  { key: 'particles', label: 'Particles', help: 'Smoke off a burnt part, and the airflow lens.' },
];

/** What auto-adjust can take away, by the option's name in the panel. */
const LOWERED: readonly (readonly [keyof Graphics, string])[] = [
  ['ao', 'ambient occlusion'],
  ['scale', 'render scale'],
  ['bloom', 'bloom'],
  ['msaa', 'anti-aliasing'],
  ['live', 'live chips'],
  ['shadows', 'sun shadows'],
  ['lightShadows', 'lamp shadows'],
  ['fps', 'frame limit'],
];

const opts = (list: readonly (readonly [string | number, string])[]): [string, string][] =>
  list.map(([v, n]) => [String(v), n]);

const pickChoice = (key: Choice, label: string, help: string, g: Graphics): PickRow => ({
  kind: 'pick',
  key,
  label,
  help,
  options: opts(CHOICES[key]),
  value: String(g[key]),
  set: (id) => setGraphic(key, Number(id)),
});

const slide = (
  key: string,
  label: string,
  help: string,
  min: number,
  max: number,
  value: number,
  set: (v: number) => void,
): SlideRow => ({ kind: 'slide', key, label, help, min, max, step: 0.05, value, set });

/** The rows of one tab, from the live settings. */
function rowsOf(tab: SettingsTabId, g: Graphics): Row[] {
  if (tab === 'quality') {
    const preset = presetOf(g),
      rec = tierRecord.value;
    const rows: Row[] = [
      {
        kind: 'pick',
        key: 'preset',
        label: 'Preset',
        help: preset ? PRESET_INFO[preset].line : 'Custom: your own mix of the options on the other tabs',
        options: opts(PRESET_NAMES),
        value: preset,
        set: (id) => setPreset(id as Preset),
      },
      {
        kind: 'pick',
        key: 'device',
        label: 'Device',
        help: tierNote(rec),
        options: [['auto', 'Auto'], ...opts(TIER_NAMES)],
        value: rec.mode === 'auto' ? 'auto' : rec.tier,
        set: (id) => (id === 'auto' ? setAutoTier() : setTier(id as Tier)),
      },
    ];
    if (autoStep.value) {
      const e = effective.value;
      const names = LOWERED.filter(([k]) => e[k] !== g[k]).map(([, name]) => name);
      rows.push({
        kind: 'act',
        key: 'retry',
        label: 'Try again',
        help: `Frames were slow, so auto-adjust lowered ${names.join(', ')}.`,
        run: retryPicture,
      });
    }
    return rows;
  }
  if (tab === 'display') {
    return [
      slide(
        'scale',
        'Render scale',
        "The pixels the picture draws, as a share of the screen's.",
        SCALE_MIN,
        SCALE_MAX,
        g.scale,
        (v) => setGraphic('scale', v),
      ),
      pickChoice(FPS_ROW.key, FPS_ROW.label, FPS_ROW.help, g),
      slide(
        'brightness',
        'Brightness',
        "The picture's exposure. Presets leave it alone.",
        BRIGHT_MIN,
        BRIGHT_MAX,
        g.brightness,
        (v) => setGraphic('brightness', v),
      ),
      {
        kind: 'pick',
        key: 'auto',
        label: 'Auto-adjust',
        help: 'Lowers the picture while the frames stay under 30 FPS.',
        options: [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        value: g.auto ? 'on' : 'off',
        set: (id) => setGraphic('auto', id === 'on'),
      },
    ];
  }
  if (tab === 'light') return LIGHT.map((r) => pickChoice(r.key, r.label, r.help, g));
  if (tab === 'detail') return DETAIL.map((r) => pickChoice(r.key, r.label, r.help, g));
  const mix = audioMix.value;
  const soundStep = MIX.sliders.stepPercent / 100;
  return [
    slide(
      'ui',
      'UI size',
      'The whole interface, smaller or larger.',
      UI_SCALE_MIN,
      UI_SCALE_MAX,
      uiScale.value,
      setUiScale,
    ),
    {
      kind: 'pick',
      key: 'mute',
      label: 'Mute',
      help: 'Silences the whole game. Sound settings stay on this device.',
      options: [
        ['off', 'Off'],
        ['on', 'On'],
      ],
      value: mix.muted ? 'on' : 'off',
      set: (id) => setMuted(id === 'on'),
    },
    ...SLIDER_IDS.map((id): SlideRow => ({
      kind: 'slide',
      key: `vol-${id}`,
      label: SLIDER_LABEL[id],
      help: `The ${SLIDER_LABEL[id].toLowerCase()} volume.`,
      min: 0,
      max: 1,
      step: soundStep,
      value: mix[id] / 100,
      set: (v) => setSlider(id, Math.round(v * 100)),
    })),
  ];
}

/** Sets a slider and ticks when it crosses a 5 % step, as a range input does (`uiCues.ts`). */
function slideTo(r: SlideRow, v: number): void {
  const moved = sliderStep(r.min, r.max, v) !== sliderStep(r.min, r.max, r.value);
  r.set(v);
  if (moved) playCue('ui_slider_tick');
}

/** The value a slider takes for a step, rounded to 0.01 and kept in its range. */
const stepped = (r: SlideRow, dir: 1 | -1): number =>
  Math.min(r.max, Math.max(r.min, Math.round((r.value + dir * r.step) * 100) / 100));

/** Moves the row's value for ← (-1) or → (1). Action rows take no value. */
function change(r: Row, dir: 1 | -1): void {
  if (r.kind === 'pick') {
    const at = r.options.findIndex(([id]) => id === r.value);
    r.set(r.options[cycleValue(r.options.length, at, dir > 0 ? 'ArrowRight' : 'ArrowLeft')]![0]);
    playCue('ui_value_change');
  } else if (r.kind === 'slide') {
    slideTo(r, stepped(r, dir));
  }
}

/** The screen while it is open: the screen mounts on each opening, so its tab and row start fresh. */
export function SettingsScreen() {
  return settingsOpen.value ? <Settings /> : null;
}

export function Settings() {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  const [row, setRow] = useState(0);
  const [peek, setPeek] = useState(false);
  const g = graphics.value;
  const rows = rowsOf(SETTINGS_TABS[tab]!.id, g);
  const peekOn = (ev: PeekEvent) => setPeek((held) => peekHeld(held, ev));

  const tabEls = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  const rowEls = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
  const focusTab = (i: number) => tabEls()[i]?.focus();
  const focusRow = (i: number) => rowEls()[i]?.focus();
  const selectTab = (i: number) => {
    setTab(i);
    setRow(0);
  };

  // Opens on Quality with the rail focused. Closing gives the focus back to what had it.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    focusTab(0);
    // (Escape with the focus outside the screen still closes it)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !root.current?.contains(e.target as Node)) closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
    // (runs once per opening)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Peek lasts while the pointer, or Space or Enter, is held: any release ends it, also one outside the screen.
  useEffect(() => {
    if (!peek) return;
    const onEnd = (e: Event) => setPeek((held) => peekHeld(held, { type: e.type, key: (e as KeyboardEvent).key }));
    const names = ['pointerup', 'pointercancel', 'blur', 'keyup'];
    for (const n of names) window.addEventListener(n, onEnd);
    return () => {
      for (const n of names) window.removeEventListener(n, onEnd);
    };
  }, [peek]);

  const seek = (r: SlideRow, track: HTMLElement, x: number) => {
    const rect = track.getBoundingClientRect();
    const f = rect.width > 0 ? Math.min(1, Math.max(0, (x - rect.left) / rect.width)) : 0;
    const raw = r.min + f * (r.max - r.min);
    slideTo(r, Math.min(r.max, Math.max(r.min, Math.round(raw / r.step) * r.step)));
  };

  // Keys: the rail takes ← → Home End (↓ goes to the row); a row takes ↑ ↓ Home End (↑ on the first row goes to the rail) and ← → (its value).
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      closeSettings();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.getAttribute('role') === 'tab') {
      if (k === 'ArrowDown') {
        e.preventDefault();
        focusRow(row);
        return;
      }
      const to = railMove(tab, SETTINGS_TABS.length, k, true);
      if (to === tab) return;
      e.preventDefault();
      selectTab(to);
      focusTab(to);
      return;
    }
    const host = t.closest<HTMLElement>('[data-row]');
    if (!host) return;
    const i = Number(host.dataset['row']);
    if (k === 'ArrowUp' && i === 0) {
      e.preventDefault();
      focusTab(tab);
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End') {
      e.preventDefault();
      const to = rowMove(rows.length, i, k);
      setRow(to);
      focusRow(to);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      setRow(i);
      change(rows[i]!, k === 'ArrowRight' ? 1 : -1);
    }
  };

  const rowEl = (r: Row, i: number) => {
    const on = i === row;
    const tabIndex = on ? 0 : -1;
    const name = (
      <span class="st-name">
        <b>{r.label}</b>
        <span class="st-help">{r.help}</span>
      </span>
    );
    if (r.kind === 'pick') {
      return (
        <div
          key={r.key}
          class={`st-row ${on ? 'on' : ''}`}
          role="group"
          aria-label={r.label}
          data-row={i}
          tabIndex={tabIndex}
          onFocus={() => setRow(i)}
        >
          {name}
          <span class="st-vals" role="radiogroup" aria-label={r.label}>
            {r.options.map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="radio"
                tabIndex={-1}
                aria-checked={id === r.value}
                class="st-val"
                data-cue="ui_value_change"
                onClick={() => {
                  setRow(i);
                  r.set(id);
                }}
              >
                {text}
              </button>
            ))}
          </span>
        </div>
      );
    }
    if (r.kind === 'slide') {
      const frac = (r.value - r.min) / (r.max - r.min);
      const text = `${Math.round(r.value * 100)} %`;
      return (
        <div
          key={r.key}
          class={`st-row ${on ? 'on' : ''}`}
          role="slider"
          aria-label={r.label}
          aria-valuemin={r.min}
          aria-valuemax={r.max}
          aria-valuenow={r.value}
          aria-valuetext={text}
          data-row={i}
          tabIndex={tabIndex}
          onFocus={() => setRow(i)}
        >
          {name}
          <span
            class="st-track"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setRow(i);
              e.currentTarget.setPointerCapture(e.pointerId);
              seek(r, e.currentTarget, e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(r, e.currentTarget, e.clientX);
            }}
          >
            <i class="st-fill" style={{ width: `${frac * 100}%` }} />
            <i class="st-thumb" style={{ left: `${frac * 100}%` }} />
          </span>
          <b class="st-num">{text}</b>
        </div>
      );
    }
    return (
      <button
        key={r.key}
        type="button"
        class={`st-row st-act ${on ? 'on' : ''}`}
        data-cue="ui_click"
        data-row={i}
        tabIndex={tabIndex}
        onFocus={() => setRow(i)}
        onClick={r.run}
      >
        {name}
      </button>
    );
  };

  const f = frameStats.value;
  return (
    <div
      class={`pl-menu settings ${peek ? 'peek' : ''}`}
      ref={root}
      onKeyDown={onKey}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <button class="pl-back" type="button" data-cue="ui_back" onClick={closeSettings}>
        ← Back<span class="pl-esc">Esc</span>
      </button>
      <div class="pl-stack st-stack">
        <DisplayTitle lines={['Settings']} lit={4} meta="WB · settings · kept on this device, not in the save" />
        <div class="st-rail" role="tablist" aria-label="Settings groups">
          {SETTINGS_TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`st-tab-${t.id}`}
              aria-selected={i === tab}
              aria-controls="st-list"
              tabIndex={i === tab ? 0 : -1}
              class="st-tab"
              data-cue="ui_tab_switch"
              onClick={() => selectTab(i)}
            >
              <span class="pl-tag st-tag" data-tag={t.tag} aria-hidden="true" />
              <span class="st-label">{t.name}</span>
            </button>
          ))}
        </div>
        <div class="st-list" id="st-list" role="tabpanel" aria-labelledby={`st-tab-${SETTINGS_TABS[tab]!.id}`}>
          {rows.map((r, i) => rowEl(r, i))}
          {SETTINGS_TABS[tab]!.id === 'quality' && (
            <p class="st-now">
              NOW {f.fps ? Math.round(f.fps) : '--'} fps · {f.ms ? f.ms.toFixed(1) : '--'} ms ·{' '}
              {f.w ? `${f.w} × ${f.h}` : '--'}
            </p>
          )}
        </div>
        <footer class="st-foot">
          <button
            type="button"
            class="st-foot-btn st-peek"
            data-cue="ui_click"
            onPointerDown={(e) => {
              if (e.button === 0) peekOn({ type: e.type, pointerType: e.pointerType });
            }}
            onPointerLeave={(e) => peekOn({ type: e.type, pointerType: e.pointerType })}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                peekOn({ type: e.type, key: e.key });
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            Hold to peek
          </button>
          <button type="button" class="st-foot-btn" data-cue="ui_click" onClick={resetGraphics}>
            Reset to defaults
          </button>
        </footer>
        <p class="pl-hints">← → category ↑ ↓ option Space peek Esc back</p>
      </div>
    </div>
  );
}
