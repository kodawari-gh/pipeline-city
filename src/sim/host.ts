// Worker-side logic without globals or timers, so it can be unit tested: message handling and the
// time-to-ticks accumulator. src/sim/worker.ts wires it to postMessage and setInterval.

import { Game } from './game/game';
import type { FromSim, Speed, ToSim } from './protocol';

export interface HostState {
  game: Game | null;
  speed: Speed;
  /** Fractional base ticks owed (elapsed time x speed not yet simulated). */
  owed: number;
}

/** Catch-up cap per call. The worker calls every 100 ms, so this is far above what 64x needs (6.4 ticks per call). */
export const MAX_TICKS_PER_FRAME = 128;

export function newHost(): HostState {
  return { game: null, speed: 1, owed: 0 };
}

/** Apply one message; returns the replies to post. Never throws. */
export function handleMessage(state: HostState, msg: ToSim): FromSim[] {
  try {
    if (msg.type === 'init') {
      state.game = msg.save ? Game.fromSave(msg.save) : new Game({ seed: msg.seed ?? 1, sandbox: !!msg.sandbox, preassembled: !!msg.preassembled });
      state.owed = 0;
      state.speed = 1;
      return [{ type: 'ready' }, { type: 'snapshot', snapshot: state.game.snapshot() }];
    }
    const g = state.game;
    if (!g) return [{ type: 'error', message: `${msg.type}: sim not started` }];
    switch (msg.type) {
      case 'setSpeed':
        if (msg.speed === 64 && !g.sandbox) return [{ type: 'error', message: 'setSpeed: 64x is for the sandbox only' }];
        state.speed = msg.speed;
        return [];
      case 'spawnKey': return refusable(g, 'spawnKey', g.spawnKey(msg.template, msg.scale));
      case 'clearQueue': return refusable(g, 'clearQueue', g.clearQueue());
      case 'repairAll': return refusable(g, 'repairAll', g.repairAll());
      case 'setReputation': return refusable(g, 'setReputation', g.setReputation(msg.value));
      case 'setLevel': return refusable(g, 'setLevel', g.setLevel(msg.level));
      case 'purchase': return refusable(g, 'purchase ' + msg.id, g.purchase(msg.id));
      case 'setCpuClock': return refusable(g, 'setCpuClock', g.setCpuClock(msg.clock));
      case 'install': return refusable(g, 'install', g.swapInstall(msg.invId, msg.slotId));
      case 'uninstall': return refusable(g, 'uninstall', g.uninstall(msg.deviceId));
      case 'connectCable': return refusable(g, 'connectCable', g.connectCable(msg.cable, msg.port));
      case 'disconnectCable': return refusable(g, 'disconnectCable', g.disconnectCable(msg.cable));
      case 'powerButton': return refusable(g, 'powerButton', g.powerButton());
      case 'plugKey': return refusable(g, 'plugKey', g.plugKey(msg.keyId));
      case 'ejectKey': return refusable(g, 'ejectKey', g.ejectKey());
      case 'declineKey': return refusable(g, 'declineKey', g.declineKey(msg.keyId));
      case 'declineJob': return refusable(g, 'declineJob', g.declineJob(msg.id));
      case 'uninstallOs': return refusable(g, 'uninstallOs', g.uninstallOs());
      case 'powerCycle':
        g.powerCycle();
        return [{ type: 'snapshot', snapshot: g.snapshot() }];
      case 'requestSave':
        return [{ type: 'saved', save: g.toSave() }];
    }
  } catch (e) {
    return [{ type: 'error', message: (e as Error).message }];
  }
}

/** Reply to a game action: an error message if it was refused, then the new snapshot. */
function refusable(g: Game, what: string, r: { ok: boolean; reason?: string }): FromSim[] {
  const out: FromSim[] = [];
  if (!r.ok) out.push({ type: 'error', message: `${what}: ${r.reason}` });
  out.push({ type: 'snapshot', snapshot: g.snapshot() });
  return out;
}

/**
 * Advance by `elapsedMs` of wall time at the current speed (1 base tick per second at 1x). Catches up after a
 * throttled tab but at most `maxTicks` per call; time beyond that is dropped (offline catch-up is out of scope).
 * Returns the number of ticks simulated. Deterministic: the sim only sees whole base ticks.
 */
export function advance(state: HostState, elapsedMs: number, maxTicks = MAX_TICKS_PER_FRAME): number {
  const g = state.game;
  if (!g || state.speed === 0) return 0;
  state.owed += (Math.max(0, elapsedMs) / 1000) * state.speed;
  const n = Math.min(Math.floor(state.owed), maxTicks);
  state.owed -= n;
  if (state.owed >= 1) state.owed -= Math.floor(state.owed); // drop the backlog beyond the cap
  for (let i = 0; i < n; i++) g.advanceBaseTick();
  return n;
}
