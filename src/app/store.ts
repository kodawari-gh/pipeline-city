import { signal } from '@preact/signals';
import { parseSave } from '../worker/game/save';
import type { CrashReport, FromSim, SaveV1, Snapshot, Speed, ToSim } from '../worker/protocol';
import { booted } from './boot';
import { SAY } from './say';

/** Latest sim snapshot (null until the sim has started). */
export const snapshot = signal<Snapshot | null>(null);
/** A new game runs at 4 ticks a second, shown as 1x: the pace the game is designed around. */
export const DEFAULT_SPEED: Speed = 4;
export const speed = signal<Speed>(DEFAULT_SPEED);
/** The last running speed: what a resume goes back to, and what the speed control shows while paused. */
export const lastRunSpeed = signal<Speed>(DEFAULT_SPEED);
/** The share of its pace the world animation runs at while the camera is zoomed in (1: full pace; render/lod.ts `zoomSlow`). The HUD explains it when it is below 1. */
export const zoomSlowdown = signal(1);
const ZOOM_SLOW_KEY = 'pipeline-city.zoomSlow';
const readZoomSlow = (): boolean => { try { return localStorage.getItem(ZOOM_SLOW_KEY) !== 'off'; } catch { return true; } };
/** Whether zooming in slows the world (default on; kept per viewer). The HUD button next to the speed toggles it. */
export const zoomSlowOn = signal(readZoomSlow());
export function toggleZoomSlow(): void {
  zoomSlowOn.value = !zoomSlowOn.value;
  try { localStorage.setItem(ZOOM_SLOW_KEY, zoomSlowOn.value ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts for the session */ }
}
export const lastError = signal<string | null>(null);
/** Whether the browser says the player is online. Offline, the game still runs; pictures that come from the server may not show (`setOnline`). */
export const online = signal(typeof navigator === 'undefined' || navigator.onLine !== false);
/** The report of the sim's last crash (it paused itself); the HUD shows it until it is dismissed (docs/ARCHITECTURE.md "Crash report"). */
export const crash = signal<CrashReport | null>(null);
/** An autosave found on startup; the HUD offers it before the sim starts. */
export const autosaveOffer = signal<SaveV1 | null>(null);
/** When the autosave was written (ms since 1970), if it is known: the menu says how long ago ("Level 3 · 5 min ago"). */
export const autosaveAt = signal<number | null>(null);
/** The previous save: the autosave as New game found it, kept before New game replaced it. The menu offers it while it exists. */
export const previousOffer = signal<SaveV1 | null>(null);
/** When the previous save was written (ms since 1970), if it is known. */
export const previousAt = signal<number | null>(null);
/** A game is starting: the worker boots and its first snapshot has not come. The menu shows "Starting…" in place of its buttons, so the click is seen at once. */
export const starting = signal(false);
/** The player pressed Main menu: the game saves, then the room goes back to its title, which holds the page for about a second. The HUD says "Saving…" meanwhile. */
export const leaving = signal(false);

/** After the page's next paint: what was just set shows before the work that holds the page. */
const nextPaint = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));

const AUTOSAVE_KEY = 'pipeline-city.autosave';
const AUTOSAVE_AT_KEY = 'pipeline-city.autosave.at';
const PREVIOUS_KEY = 'pipeline-city.previous';
const PREVIOUS_AT_KEY = 'pipeline-city.previous.at';
const AUTOSAVE_EVERY_MS = 10_000;
/** A sim that does not answer a save request in this long (ms) does not keep the player in the game (`leaveSim`). */
const LEAVE_WAIT_MS = 1500;

/** UI hooks, set by `ui/state.ts`: add per-viewer state (the tutorial's) to every save, and take it back from a loaded one. */
export const saveHooks = {
  attach: (s: SaveV1): SaveV1 => s,
  restore: (_s: SaveV1): void => {},
};

let worker: Worker | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | undefined;
let saveWaiters: Array<(s: SaveV1) => void> = [];

const send = (m: ToSim) => worker?.postMessage(m);

/** Stops the worker and its autosave: no game runs (the snapshot is null, as before the first game). */
function stopWorker() {
  worker?.terminate();
  worker = null;
  clearInterval(autosaveTimer);
  saveWaiters = [];
  snapshot.value = null;
  crash.value = null;
  starting.value = false;
  speed.value = DEFAULT_SPEED;
}

/** Ends the wait of a game chosen before the world has loaded (`startSim`). */
let waitForBoot: (() => void) | null = null;

/** (Re)start the worker with a save, or a new random game. */
export function startSim(save: SaveV1 | null, opts: { sandbox?: boolean; preassembled?: boolean; maxed?: boolean } = {}) {
  // The menu shows over the boot screen while the world loads. A game chosen now waits for the screen to go: it starts at once after, and the
  // menu says so (`starting`). Started now, its first machine would be built twice, and the page is busy building the room.
  if (!booted.peek()) {
    starting.value = true;
    waitForBoot?.(); // (a later choice replaces an earlier one that still waits)
    waitForBoot = booted.subscribe((b) => { if (b) { waitForBoot?.(); waitForBoot = null; startSim(save, opts); } });
    return;
  }
  if (save) saveHooks.restore(save);
  stopWorker();
  lastError.value = null;
  autosaveOffer.value = null;
  starting.value = true;
  const w = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onerror = () => {
    if (w !== worker) return;
    lastError.value = SAY + 'The game could not start. Reload the page and try again.';
    starting.value = false;
  };
  w.onmessage = (e: MessageEvent<FromSim>) => {
    if (w !== worker) return;
    const m = e.data;
    if (m.type === 'snapshot') { snapshot.value = m.snapshot; starting.value = false; }
    else if (m.type === 'error') { lastError.value = m.message; if (!snapshot.peek()) starting.value = false; }
    else if (m.type === 'crash') {
      crash.value = m.report;
      speed.value = 0; // the sim paused itself
    } else if (m.type === 'saved') {
      const waiters = saveWaiters;
      saveWaiters = [];
      const save = saveHooks.attach(m.save);
      waiters.forEach((f) => f(save));
    }
  };
  send({ type: 'init', save, seed: (Math.random() * 0x100000000) >>> 0, sandbox: !!opts.sandbox, preassembled: !!opts.preassembled, maxed: !!opts.maxed });
  send({ type: 'setSpeed', speed: DEFAULT_SPEED });
  autosaveTimer = setInterval(() => requestSave(autosave), AUTOSAVE_EVERY_MS);
}

function requestSave(then: (s: SaveV1) => void) {
  saveWaiters.push(then);
  send({ type: 'requestSave' });
}

/** Per-viewer convenience only: the real save is the exported file. */
function autosave(save: SaveV1) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(save));
    const at = Date.now();
    localStorage.setItem(AUTOSAVE_AT_KEY, String(at));
    autosaveAt.value = at;
  } catch {
    /* storage unavailable or full: ignore */
  }
}

/** Save the game now, as the autosave does every 10 s (the menu's "Save now"); `done` runs once it is written. */
export const saving = signal(false);
export function saveNow(done?: () => void): void {
  saving.value = true;
  requestSave((save) => { autosave(save); saving.value = false; done?.(); });
}

/**
 * Ends the game that runs and brings the main menu back (no page reload: the 3D world stays built). The game as it stands is kept as the autosave
 * first, so Continue brings it back. A sim that does not answer within `LEAVE_WAIT_MS` is left with the autosave it had.
 */
export function leaveSim(): void {
  if (!worker || !snapshot.peek()) { stopWorker(); loadAutosaveOffer(); return; }
  let left = false;
  leaving.value = true;
  const leave = (save?: SaveV1) => {
    if (left) return;
    left = true;
    if (save) autosave(save);
    // (the room's rebuild for the title holds the page: let "Saving…" paint first)
    void nextPaint().then(() => {
      stopWorker();
      loadAutosaveOffer();
      leaving.value = false;
    });
  };
  requestSave(leave);
  setTimeout(() => leave(), LEAVE_WAIT_MS);
}

/** Read the autosave, if any and valid, and offer it in the HUD. Returns whether one was found. */
export function loadAutosaveOffer(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) { autosaveOffer.value = null; return false; }
    const at = Number(localStorage.getItem(AUTOSAVE_AT_KEY));
    autosaveAt.value = Number.isFinite(at) && at > 0 ? at : null;
    autosaveOffer.value = parseSave(JSON.parse(raw));
    return true;
  } catch {
    autosaveOffer.value = null;
    return false;
  }
}

/** Read the previous save, if any and valid, and offer it in the menu. Returns whether one was found. */
export function loadPreviousOffer(): boolean {
  try {
    const raw = localStorage.getItem(PREVIOUS_KEY);
    if (!raw) { previousOffer.value = null; previousAt.value = null; return false; }
    const at = Number(localStorage.getItem(PREVIOUS_AT_KEY));
    previousAt.value = Number.isFinite(at) && at > 0 ? at : null;
    previousOffer.value = parseSave(JSON.parse(raw));
    return true;
  } catch {
    previousOffer.value = null;
    previousAt.value = null;
    return false;
  }
}

/** Copy the autosave to the previous-save key, if an autosave exists. No autosave: no copy, the old previous save stays. */
function keepAutosaveAsPrevious(): void {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    localStorage.setItem(PREVIOUS_KEY, raw);
    const at = localStorage.getItem(AUTOSAVE_AT_KEY);
    if (at) localStorage.setItem(PREVIOUS_AT_KEY, at);
    else localStorage.removeItem(PREVIOUS_AT_KEY);
  } catch {
    /* storage unavailable: no previous save is kept */
  }
  loadPreviousOffer();
}

/** New game: the autosave is kept as the previous save first, then a new game starts (`startSim`). */
export function startNewGame(opts: { sandbox?: boolean; preassembled?: boolean; maxed?: boolean } = {}): void {
  keepAutosaveAsPrevious();
  startSim(null, opts);
}

export const purchase = (id: string) => send({ type: 'purchase', id });
/** Sell a spare part from the inventory back for most of its price. */
export const sell = (invId: string) => send({ type: 'sell', invId });
/** Drop a part from the queue of installs waiting for the running job (all of them without an id). */
export const cancelSwap = (invId?: string) => send({ type: 'cancelSwap', invId });
export const setCpuClock = (clock: number) => send({ type: 'setCpuClock', clock });
export const setRamClock = (deviceId: string, clock: number) => send({ type: 'setRamClock', deviceId, clock });
export const powerCycle = () => send({ type: 'powerCycle' });
// Assembly and keys (docs/ASSEMBLY.md): each refused action sets `lastError` and always refreshes the snapshot.
export const install = (invId: string, slotId?: string) => send({ type: 'install', invId, slotId });
export const uninstall = (deviceId: string) => send({ type: 'uninstall', deviceId });
export const connectCable = (cable: string, port?: string) => send({ type: 'connectCable', cable, port });
export const disconnectCable = (cable: string) => send({ type: 'disconnectCable', cable });
export const powerButton = () => send({ type: 'powerButton' });
export const plugKey = (keyId: number) => send({ type: 'plugKey', keyId });
export const ejectKey = () => send({ type: 'ejectKey' });
/** Decline a waiting job (small reputation cost, free in the sandbox); refusals set `lastError`. */
export const declineKey = (keyId: number) => send({ type: 'declineKey', keyId });
export const declineJob = (id: number) => send({ type: 'declineJob', id });
/** Take the OS off its drive (back to the inventory). Only while the machine is off. */
export const uninstallOs = () => send({ type: 'uninstallOs' });
/** Format a data drive (off only, OS tier 2+); `confirm` accepts losing its datasets. */
export const formatDrive = (deviceId: string, confirm = false) => send({ type: 'formatDrive', deviceId, confirm });
/** OS menu: the most queue slots wanted (null: as many as the OS allows). Applies at the next power-on. */
export const setSpoolSlots = (slots: number | null) => send({ type: 'setSpoolSlots', slots });
/** OS menu: let a drive hold spool slots or not. Applies at the next power-on. */
export const setDataReserve = (deviceId: string, blocks: number | null) => send({ type: 'setDataReserve', deviceId, blocks });
export const setSpoolAlloc = (deviceId: string, slots: number | null) => send({ type: 'setSpoolAlloc', deviceId, slots });
export const setSpoolDrive = (deviceId: string, on: boolean) => send({ type: 'setSpoolDrive', deviceId, on });
/** Accept a cloud-storage contract offer from the job log (optionally on a chosen drive), or turn it down (it just goes away). */
export const acceptContract = (offerId: number, deviceId?: string) => send({ type: 'acceptContract', offerId, deviceId });
export const ignoreContract = (offerId: number) => send({ type: 'ignoreContract', offerId });
// Sandbox tools (docs/SANDBOX.md): the sim refuses them outside a sandbox game.
export const spawnKey = (template: string, scale?: number) => send({ type: 'spawnKey', template, scale });
export const clearQueue = () => send({ type: 'clearQueue' });
export const repairAll = () => send({ type: 'repairAll' });
export const setReputation = (value: number) => send({ type: 'setReputation', value });
export const setLevel = (level: number) => send({ type: 'setLevel', level });
/** Follow a logical core of a multicore CPU in the die's detail and the Trace panel. */
export const viewCore = (core: number) => send({ type: 'viewCore', core });
export const setJobClasses = (off: string[]) => send({ type: 'setJobClasses', off });
export const setJobKinds = (off: string[]) => send({ type: 'setJobKinds', off });
/** While paused: run the machine a number of CPU cycles, or one whole base tick (the Trace panel's step buttons). */
export const stepCycles = (cycles: number) => send({ type: 'step', cycles });
export const stepTick = () => send({ type: 'stepTick' });
/** While paused: tick the card in a PCIe slot for a number of its cycles. */
export const stepGpu = (slot: string, cycles: number) => send({ type: 'stepGpu', slot, cycles });
export function setSpeed(s: Speed) {
  speed.value = s;
  if (s !== 0) lastRunSpeed.value = s;
  send({ type: 'setSpeed', speed: s });
}

/** Space: pause, and resume at the speed the game was running at (the default for a new game). */
export function togglePause() {
  if (speed.value === 0) setSpeed(lastRunSpeed.value);
  else setSpeed(0);
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the current game as pipeline-city-<tick>.json. */
export function exportSave() {
  if (!worker) {
    lastError.value = SAY + 'The game is not running, so it cannot be saved to a file. Your save is unchanged. Start a game, then try again.';
    return;
  }
  requestSave((save) => {
    try {
      download(`pipeline-city-${save.baseTick}.json`, JSON.stringify(save, null, 1));
    } catch {
      lastError.value = SAY + 'The file could not be saved. Your save is unchanged. Try again, or check your download settings in your browser.';
    }
  });
}

/** Download the crash report (with the game as it was, so it can be loaded and replayed) as pipeline-city-crash-<tick>.json. */
export function exportCrash(r: CrashReport) {
  download(`pipeline-city-crash-${r.tick}.json`, JSON.stringify(r, null, 1));
}

/** Download only the game from a crash report, as a normal save file. */
export function exportCrashSave(r: CrashReport) {
  if (r.save) download(`pipeline-city-${r.tick}.json`, JSON.stringify(r.save, null, 1));
}

/** Read a save file and check it. A file that is no save sets `lastError` (in the player's words) and gives null. Nothing starts: the caller may ask first (`panels/loadgame.ts`). */
export async function readSaveFile(file: File): Promise<SaveV1 | null> {
  try {
    return parseSave(JSON.parse(await file.text()));
  } catch (e) {
    // (a file that is not JSON is not a save; a save this version cannot read is from another version, or damaged)
    lastError.value = e instanceof SyntaxError
      ? SAY + 'That file is not a Pipeline City save. Pick another file, or go back to the menu.'
      : SAY + 'That save cannot be loaded. It may be from another version of the game, or damaged. Your save is unchanged. Pick another file, or go back to the menu.';
    return null;
  }
}

/** Read a save file, validate it, and restart the sim from it. Errors go to `lastError`. */
export async function importSave(file: File) {
  const save = await readSaveFile(file);
  if (save) startSim(save);
}

/** Offline: the game still runs, and the way forward is a reload once the connection is back (the pictures load on the page's start). */
const OFFLINE_NOTICE = SAY + 'You are offline. The game still runs, but pictures from the server may not show. Reconnect, then reload the page.';

/** Record the browser's connection state. Going offline shows the notice in `lastError`; coming back online clears it. */
export function setOnline(on: boolean): void {
  online.value = on;
  if (!on) lastError.value = OFFLINE_NOTICE;
  else if (lastError.peek() === OFFLINE_NOTICE) lastError.value = null;
}

/** Follow the browser's online and offline events. Called once, when the page starts: a page opened offline shows the notice at once. */
export function watchConnection(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => setOnline(true));
  if (!online.peek()) setOnline(false);
}
