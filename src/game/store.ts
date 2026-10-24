import { signal } from '@preact/signals';
import { parseSave } from '../sim/game/save';
import type { FromSim, SaveV1, Snapshot, Speed, ToSim } from '../sim/protocol';

/** Latest sim snapshot (null until the sim has started). */
export const snapshot = signal<Snapshot | null>(null);
export const speed = signal<Speed>(1);
export const lastError = signal<string | null>(null);
/** An autosave found on startup; the HUD offers it before the sim starts. */
export const autosaveOffer = signal<SaveV1 | null>(null);

const AUTOSAVE_KEY = 'pipeline-city.autosave';
const AUTOSAVE_EVERY_MS = 10_000;

let worker: Worker | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | undefined;
let saveWaiters: Array<(s: SaveV1) => void> = [];

const send = (m: ToSim) => worker?.postMessage(m);

/** (Re)start the worker with a save, or a new random game. */
export function startSim(save: SaveV1 | null, opts: { sandbox?: boolean; preassembled?: boolean } = {}) {
  worker?.terminate();
  clearInterval(autosaveTimer);
  saveWaiters = [];
  snapshot.value = null;
  lastError.value = null;
  autosaveOffer.value = null;
  speed.value = 1;
  const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (e: MessageEvent<FromSim>) => {
    if (w !== worker) return;
    const m = e.data;
    if (m.type === 'snapshot') snapshot.value = m.snapshot;
    else if (m.type === 'error') lastError.value = m.message;
    else if (m.type === 'saved') {
      const waiters = saveWaiters;
      saveWaiters = [];
      waiters.forEach((f) => f(m.save));
    }
  };
  send({ type: 'init', save, seed: (Math.random() * 0x100000000) >>> 0, sandbox: !!opts.sandbox, preassembled: !!opts.preassembled });
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
  } catch {
    /* storage unavailable or full: ignore */
  }
}

/** Read the autosave, if any and valid, and offer it in the HUD. Returns whether one was found. */
export function loadAutosaveOffer(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    autosaveOffer.value = parseSave(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}

export const purchase = (id: string) => send({ type: 'purchase', id });
export const setCpuClock = (clock: number) => send({ type: 'setCpuClock', clock });
export const powerCycle = () => send({ type: 'powerCycle' });
// Assembly and keys (docs/ASSEMBLY.md): each refused action sets `lastError` and always refreshes the snapshot.
export const install = (invId: string, slotId?: string) => send({ type: 'install', invId, slotId });
export const uninstall = (deviceId: string) => send({ type: 'uninstall', deviceId });
export const connectCable = (cable: string) => send({ type: 'connectCable', cable });
export const disconnectCable = (cable: string) => send({ type: 'disconnectCable', cable });
export const powerButton = () => send({ type: 'powerButton' });
export const plugKey = (keyId: number) => send({ type: 'plugKey', keyId });
export const ejectKey = () => send({ type: 'ejectKey' });
/** Decline a waiting job (small reputation cost, free in the sandbox); refusals set `lastError`. */
export const declineKey = (keyId: number) => send({ type: 'declineKey', keyId });
export const declineJob = (id: number) => send({ type: 'declineJob', id });
/** Take the OS off its drive (back to the inventory). Only while the machine is off. */
export const uninstallOs = () => send({ type: 'uninstallOs' });
// Sandbox tools (docs/SANDBOX.md): the sim refuses them outside a sandbox game.
export const spawnKey = (template: string, scale?: number) => send({ type: 'spawnKey', template, scale });
export const clearQueue = () => send({ type: 'clearQueue' });
export const repairAll = () => send({ type: 'repairAll' });
export const setReputation = (value: number) => send({ type: 'setReputation', value });
export const setLevel = (level: number) => send({ type: 'setLevel', level });
export function setSpeed(s: Speed) {
  speed.value = s;
  send({ type: 'setSpeed', speed: s });
}

/** Download the current game as pipeline-city-<tick>.json. */
export function exportSave() {
  requestSave((save) => {
    const blob = new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-city-${save.baseTick}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/** Read a save file, validate it, and restart the sim from it. Errors go to `lastError`. */
export async function importSave(file: File) {
  try {
    const save = parseSave(JSON.parse(await file.text()));
    startSim(save);
  } catch (e) {
    lastError.value = e instanceof SyntaxError ? 'save: not valid JSON' : (e as Error).message;
  }
}
