// Game feature: plugging and unplugging cables. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  BOARD_TIERS,
  cableName,
  cablesOf,
  cableNeeded,
  hotPluggable,
  isFanCable,
  cableBlocked,
  connectCable as boardConnect,
  deviceSpec,
  disconnectCable as boardDisconnect,
  findDevices,
} from '..';
import { requireDefined } from '../requireDefined';
import type * as boardSimTypes from '..';
import type { Game } from '@/worker/game/game';
import type { Progress } from '@/worker/game/save';
import type { Result } from '@/worker/game/types';

function videoPortRefusal(game: Game, to: string): string | null {
  if (to === 'board') {
    return null;
  }
  const card = game.board.devices.find((d) => d.slot === to && deviceSpec(d).kind === 'gpu');
  if (!card || card.burnt === true) {
    return `no working graphics card in "${to}"`;
  }
  const [disp] = findDevices(game.board, 'display');
  const dispKind = disp === undefined ? undefined : deviceSpec(disp);
  if (dispKind === undefined || dispKind.kind !== 'display' || dispKind.graphics !== true) {
    return 'a text monitor has no picture to show a graphics card: install the graphics display';
  }
  return null;
}

function afterCableConnected(opts: { game: Game; cable: boardSimTypes.CableId; wall: boolean; to: string }): void {
  const { game, cable, wall, to } = opts;
  if (cable === 'video') {
    game.video = to;
  }
  const CABLE_PROGRESS: Partial<Record<boardSimTypes.CableId, keyof Progress>> = {
    atx: 'atxConnected',
    cpu: 'cpuPowerConnected',
    video: 'videoConnected',
  };
  const flag = CABLE_PROGRESS[cable];
  if (flag !== undefined) {
    game.progress[flag] = true;
  }
  if (wall || cable === 'video') {
    game.machine.display.connected = game.monitorLive();
  }
  if (wall && game.cables['pcmains'] === true && game.cables['monmains'] === true) {
    game.progress.mainsConnected = true;
  }
  if (game.powered && isFanCable(cable)) {
    game.syncRates(true); // a fan plugged on a running machine spins up at once
  }
  game.note('cable', `${cableName(cable)} connected`);
}

/** Plug a cable in (needs its source part installed). Only while off. */
export function connectCable(this: Game, cable: string, port?: string): Result<{ cable: boardSimTypes.CableId }> {
  if (cable === 'lan') {
    return this.connectLan(port);
  }
  const wall = cable === 'pcmains' || cable === 'monmains';
  if (this.powered && !hotPluggable(cable)) {
    return { ok: false, reason: 'power the machine off first: the PSU cables carry live power' };
  }
  // The video cable goes to the board's HDMI port, or to a display port on a GPU's bracket (graphics display only).
  const to = cable === 'video' ? (port ?? 'board') : 'board';
  const refusal = videoPortRefusal(this, to);
  if (refusal !== null && refusal !== '') {
    return { ok: false, reason: refusal };
  }
  const r = boardConnect(this.board, this.cables, cable);
  if (!r.ok) {
    return r;
  }
  afterCableConnected({ game: this, cable: r.cable, wall, to });
  return r;
}

/** The ethernet cable runs from a port (the board jack, or a NIC card jack) to the router. Allowed while the machine is on. */
export function connectLan(this: Game, port?: string): Result<{ cable: boardSimTypes.CableId }> {
  if (this.cables['lan'] === true) {
    return { ok: false, reason: 'Ethernet cable is already connected' };
  }
  if (!this.routerTier) {
    return { ok: false, reason: 'needs a router: install one next to the monitor first' };
  }
  const nics = this.board.devices.filter((d) => deviceSpec(d).kind === 'nic' && d.burnt !== true);
  const boardTier = requireDefined(BOARD_TIERS[this.board.tier], `unknown board tier ${this.board.tier}`);
  const onboard = boardTier.features.ethernetMbps > 0;
  const pick = port ?? (onboard ? 'board' : nics[0]?.id);
  if (pick === undefined || pick === '') {
    return { ok: false, reason: 'no network port: this board has no ethernet jack and no network card is installed' };
  }
  if (pick === 'board') {
    if (!onboard) {
      return { ok: false, reason: `the ${boardTier.name} board has no ethernet jack` };
    }
  } else if (!nics.some((d) => d.id === pick)) {
    return { ok: false, reason: `no working network card "${pick}"` };
  }
  this.cables['lan'] = true;
  this.lan = pick;
  this.progress.lanConnected = true;
  this.note('cable', `Ethernet cable connected to ${pick === 'board' ? 'the board jack' : pick}`);
  return { ok: true, cable: 'lan' };
}

export function disconnectCable(this: Game, cable: string): Result<{ cable: boardSimTypes.CableId }> {
  if (cable === 'lan') {
    if (this.cables['lan'] !== true) {
      return { ok: false, reason: 'Ethernet cable is not connected' };
    }
    this.cables['lan'] = false;
    this.lan = null;
    this.note('cable', 'Ethernet cable disconnected');
    return { ok: true, cable: 'lan' };
  }
  const wall = cable === 'pcmains' || cable === 'monmains';
  if (this.powered && !hotPluggable(cable)) {
    return { ok: false, reason: 'power the machine off first: the PSU cables carry live power' };
  }
  const r = boardDisconnect(this.cables, cable, this.board);
  if (!r.ok) {
    return r;
  }
  if (r.cable === 'video') {
    this.video = 'board';
  }
  this.note('cable', `${cableName(r.cable)} disconnected`);
  if (wall || cable === 'video') {
    this.machine.display.connected = this.monitorLive();
  }
  if (this.powered && isFanCable(cable)) {
    this.syncRates(true); // a fan pulled on a running machine stops: the parts heat up
  }
  // pulling the PC's cord on a running machine cuts its power: the same hard power-off as the button
  if (r.cable === 'pcmains' && this.powered) {
    this.powerButton();
    this.note('fault', 'the power cord was pulled: the machine lost power');
  }
  return r;
}

/** Cables that could be plugged in (source part installed) but are not. */
export function missingCables(this: Game): boardSimTypes.CableId[] {
  // The ethernet cable is the player's choice (a port, a router): never part of the bot's assembly.
  return cablesOf(this.board)
    .filter((c) => {
      if (c.id === 'lan' || this.cables[c.id] === true || !cableNeeded(this.board, c.id)) {
        return false;
      }
      return cableBlocked(this.board, c.id) === null;
    })
    .map((c) => c.id);
}
