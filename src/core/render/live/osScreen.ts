import type { Snapshot } from '../../../worker/protocol';
import { SCREEN_D, screenMode, dashModel, frameModel, holdFrame, IPC_SAMPLES, ipcBetween } from './features';
import { OS_AMBER, OS_CYAN, OS_INK, OS_LINE } from './consts';
import { bootRows, headRows, runRows } from './osRows';
import type { OsRow } from './types';
import { osRowsFor } from './screen';
import type { LiveState } from './state';

/** With the cable on a card: its frame is worked out here and drawn as a panel of the dashboard (`updateDash`) while it draws and a few ticks after. */
export function updateGpuFrame(s: LiveState, snap: Snapshot): void {
  const port = snap.videoPort ?? 'board';
  const card =
    s.gfxDisplay && snap.monitorLive && snap.powered && port !== 'board'
      ? snap.gpus?.find((g) => g.slot === port)
      : undefined;
  const r = holdFrame(s.frameHold, card, snap.baseTick);
  s.frameHold = r.hold;
  s.frameM = r.show ? frameModel(card) : null;
  s.frameOn = false;
}

/** The graphics display's OS screen: the dashboard (gauges, IPC trace, process table) in place of the text rows. */
function updateDash(s: LiveState, snap: Snapshot): void {
  for (const t of s.osRows) {
    t.visible = false;
  }
  s.osSig = '';
  s.osG.visible = false;
  const q = snap.os?.queue ?? [];
  const ipc = ipcBetween(s.dashPrev, snap.counters);
  s.dashPrev = snap.counters;
  if (ipc !== null) {
    s.dashIpc.push(ipc);
    if (s.dashIpc.length > IPC_SAMPLES) {
      s.dashIpc.shift();
    }
  }
  for (const j of q) {
    if (j.state === 'running' && !s.dashStarted.has(j.keyId)) {
      s.dashStarted.set(j.keyId, snap.baseTick);
    }
  }
  for (const k of s.dashStarted.keys()) {
    if (!q.some((j) => j.keyId === k && j.state === 'running')) {
      s.dashStarted.delete(k);
    }
  }
  s.dash.show(
    dashModel(snap, { upTick: s.osUpTick, ipc: s.dashIpc, started: s.dashStarted, compact: s.frameM !== null }),
  );
  s.frameV.show(s.frameM);
  s.frameOn = s.frameM !== null;
}

/** The OS screen is up: an OS, power, a live monitor, a display, and a phase where the OS runs. */
function osShown(s: LiveState, snap: Snapshot): boolean {
  const ph = snap.phase;
  return (
    Boolean(snap.os) &&
    snap.powered &&
    snap.monitorLive &&
    s.hasDisplay &&
    (ph === 'booting-os' || ph === 'idle-os' || ph === 'running-os' || ph === 'ingesting' || ph === 'flashing')
  );
}

/** No OS screen: its rows, dashboard and frame are hidden and the dashboard forgets what it saw. */
function hideOs(s: LiveState): void {
  for (const t of s.osRows) {
    t.visible = false;
  }
  s.osSig = '';
  s.dash.show(null);
  s.frameV.show(null);
  s.dashIpc = [];
  s.dashPrev = null;
  s.dashStarted.clear();
}

/** Show `rows` on the pooled texts (only when they changed). */
function showRows(s: LiveState, rows: OsRow[]): void {
  const sig = rows.map((r) => r.c + r.t).join('\n');
  if (sig === s.osSig) {
    return;
  }
  s.osSig = sig;
  for (const [i, t] of osRowsFor(s).entries()) {
    const r = rows[i];
    t.visible = r !== undefined;
    if (!r) {
      continue;
    }
    if (t.text !== r.t) {
      t.text = r.t;
    }
    if (t.style.fill !== r.c) {
      t.style.fill = r.c;
    }
  }
}

/**
 * The OS status screen on the monitor: composed from `snapshot.os`, `storage`, `display` (every field optional-safe).
 * Rows are pooled Texts; the progress cue is drawn per frame by `drawOsBar`.
 */
export function updateOsScreen(s: LiveState, snap: Snapshot): void {
  const ph = snap.phase;
  const on = osShown(s, snap);
  if (snap.os?.up === true) {
    s.osUpTick ??= snap.baseTick;
  } else {
    s.osUpTick = null;
  }
  s.osOn = on;
  s.screenText.visible = s.hasDisplay && !on;
  s.osG.visible = on;
  s.osJob = 'none';
  const { os } = snap;
  if (!on || !os) {
    hideOs(s);
    return;
  }
  if (screenMode(on, s.gfxDisplay, ph) === 'dash') {
    updateDash(s, snap);
    return;
  }
  s.dash.show(null);
  s.frameV.show(null);
  const rows = headRows(snap, os, s.osUpTick);
  if (ph === 'booting-os') {
    rows.push(...bootRows(snap.display || ''));
  } else {
    const r = runRows(rows, snap, os);
    s.osJob = r.job;
    s.osBarRow = r.barRow;
  }
  showRows(s, rows);
}

/** Per-frame progress cue under the current job row: an indeterminate block sliding on a track (game time). */
export function drawOsBar(s: LiveState, now: number): void {
  const g = s.osG;
  g.clear();
  if (!s.osOn || s.osJob === 'none') {
    return;
  }
  const x0 = 90 + 27 * 71,
    w = SCREEN_D.w - 120 - x0,
    y = 56 + s.osBarRow * OS_LINE + 42,
    bw = 300;
  let col = OS_AMBER;
  if (s.osJob === 'run') {
    col = OS_INK;
  } else if (s.osJob === 'ingest') {
    col = OS_CYAN;
  }
  g.setFillStyle({ color: '#16241e' }).roundRect(x0, y, w, 34, 17).fill();
  const u = (now / 1500) % 1,
    left = x0 + (w + bw) * u - bw,
    a = Math.max(x0, left),
    b = Math.min(x0 + w, left + bw);
  if (b > a) {
    g.setFillStyle({ color: col, alpha: 0.9 })
      .roundRect(a, y, b - a, 34, 17)
      .fill();
  }
}
