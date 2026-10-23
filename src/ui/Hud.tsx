import './ui.css';
import { useEffect } from 'preact/hooks';
import { viewInset } from '../game/hover';
import {
  autosaveOffer, exportSave, importSave, lastError, setSpeed, snapshot, speed, startSim,
} from '../game/store';
import { SPEEDS } from '../sim/protocol';
import { fmtMoney, fmtNum, fmtTicks } from './logic';
import { panel, theme, toggleTheme, togglePanel } from './state';
import { Meter } from './Meter';
import { Shop } from './Shop';
import { Stats } from './Stats';
import { DevicePanel, Tooltip } from './Hover';
import { Toasts } from './Toasts';

const speedLabel = (s: number) => (s === 0 ? 'II' : `${s}x`);
const speedTitle = (s: number) => (s === 0 ? 'Pause' : `Run at ${s}x`);

function StartPrompt() {
  const offer = autosaveOffer.value;
  const err = lastError.value;
  if (offer) {
    return (
      <div class="card prompt">
        <div class="big">Welcome back</div>
        <div class="mute">Autosave: tick {offer.baseTick}, {fmtMoney(offer.money)}</div>
        <div class="row">
          <button class="primary" onClick={() => startSim(offer)}>Continue</button>
          <button onClick={() => startSim(null)}>New game</button>
        </div>
        {err && <div class="err">{err}</div>}
      </div>
    );
  }
  return <div class="card prompt mute">starting...{err && <div class="err">{err}</div>}</div>;
}

/**
 * Tells the board camera how much of the screen the HUD bar and the dock (a side panel, or a bottom drawer on
 * narrow screens) cover, so the overview frames the whole board in the free area.
 */
function InsetReporter() {
  const p = panel.value;
  const started = !!snapshot.value;
  useEffect(() => {
    const measure = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const next = { top: 0, right: 0, bottom: 0, left: 0 };
      const bar = document.querySelector('.hud');
      const dock = document.querySelector('.dock');
      if (bar) next.top = Math.ceil(bar.getBoundingClientRect().bottom) + 8;
      if (dock) {
        const r = dock.getBoundingClientRect();
        if (r.width < W * 0.8) next.right = Math.ceil(W - r.left) + 8;
        else next.bottom = Math.ceil(H - r.top) + 8;
      }
      const cur = viewInset.peek();
      if (cur.top !== next.top || cur.right !== next.right || cur.bottom !== next.bottom || cur.left !== next.left) viewInset.value = next;
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [document.querySelector('.hud'), document.querySelector('.dock')]) if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [p, started]);
  return null;
}

function Queue() {
  const s = snapshot.value!;
  const r = s.request;
  const frac = r ? Math.min(1, Math.max(0, (s.baseTick - r.arrivalTick) / Math.max(1, r.deadlineTick - r.arrivalTick))) : 0;
  const late = r && s.baseTick > r.deadlineTick;
  return (
    <div class="stat" title={`Waiting requests: ${s.queueLength} of ${s.queueCap}. The bar is time since the current request arrived, against its soft deadline.`}>
      <span class="label">queue</span>
      <span class="value">{s.queueLength}<span class="mute">/{s.queueCap}</span></span>
      <span class="sub">
        {r ? <>{r.template} {late ? 'late' : fmtTicks(s.baseTick - r.arrivalTick)}{r.attempts > 1 ? ` (try ${r.attempts})` : ''}</> : 'idle'}
      </span>
      <Meter value={frac} level={late ? 'bad' : frac > 0.7 ? 'warn' : 'ok'} label="Current request time against its deadline" />
    </div>
  );
}

function Reputation() {
  const s = snapshot.value!;
  const perMin = s.demandRate * 60;
  return (
    <div class="stat" title="Reputation comes from how fast you answer. Higher reputation brings more requests.">
      <span class="label">reputation</span>
      <span class="value">{fmtNum(s.reputation, 2)}</span>
      <span class="sub">demand {fmtNum(perMin, 1)}/min</span>
      <Meter value={Math.min(1, s.reputation / 2)} level="ok" label="Reputation" />
    </div>
  );
}

export function Hud() {
  const s = snapshot.value;
  if (!s) return <StartPrompt />;
  const err = lastError.value;
  const p = panel.value;
  return (
    <>
      <InsetReporter />
      <header class="hud">
        <div class="money" title="Money. Finish requests to earn more.">{fmtMoney(s.money)}</div>
        <div class="stat" title="Seconds of game time at 1x">
          <span class="label">tick</span>
          <span class="value">{s.baseTick}</span>
        </div>
        <Reputation />
        <Queue />
        <div class="grow" />
        <div class="seg" role="group" aria-label="Speed">
          {SPEEDS.map((v) => (
            <button key={v} class={speed.value === v ? 'on' : ''} aria-pressed={speed.value === v} title={speedTitle(v)} onClick={() => setSpeed(v)}>
              {speedLabel(v)}
            </button>
          ))}
        </div>
        <div class="seg" role="group" aria-label="Panels">
          <button class={p === 'shop' ? 'on' : ''} aria-pressed={p === 'shop'} title="Shop" onClick={() => togglePanel('shop')}>Shop</button>
          <button class={p === 'stats' ? 'on' : ''} aria-pressed={p === 'stats'} title="Nerd stats" onClick={() => togglePanel('stats')}>Stats</button>
        </div>
        <div class="seg" role="group" aria-label="Save">
          <button title="Download your game as a file" onClick={exportSave}>Export</button>
          <label class="btn" title="Load a game file">
            Import
            <input
              type="file" accept="application/json,.json" hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) importSave(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <button class="icon" title={theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme" onClick={toggleTheme}>
          {theme.value === 'dark' ? '☼' : '☾'}
        </button>
      </header>
      {err && <div class="card err-bar" role="alert">{err}</div>}
      {p && (
        <aside class="dock" aria-label={p === 'shop' ? 'Shop' : 'Stats'}>
          <button class="close" aria-label="Close panel" onClick={() => { panel.value = null; }}>x</button>
          {p === 'shop' ? <Shop /> : <Stats />}
        </aside>
      )}
      <DevicePanel />
      <Tooltip />
      <Toasts />
    </>
  );
}
