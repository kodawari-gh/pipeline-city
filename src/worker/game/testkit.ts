// Shared test rigs (not a test file).
import type { EconomyConfig } from '../../features/economy/sim/economy';
import { Game } from './game';
import type { Result } from './types';

export type Keys = { template: string; scale?: number }[];

/** No random arrivals; the tray starts with `keys` (default: the one starter key). */
export const econ = (keys: Keys = [{ template: 'cli.log' }]) => ({ baseDemandPerTick: 0, startQueue: keys });

/**
 * A machine ready for an OS: CPU `cpu`, 32K RAM, a PSU big enough, one storage drive and (unless `os: false`) the OS
 * installed, powered off. Built from preassembled by buying with free money and installing by hand.
 */
export function rig(
  storage: 'hdd0' | 'ssd1' | 'nvme2',
  opts: {
    cpu?: string | undefined;
    os?: boolean;
    keys?: Keys | undefined;
    seed?: number | undefined;
    economy?: Partial<EconomyConfig> | undefined;
    startLevel?: number | undefined;
    ram?: string;
  } = {},
): Game {
  const g = new Game({
    seed: opts.seed ?? 7,
    preassembled: true,
    startLevel: opts.startLevel,
    economy: { ...econ(opts.keys), levelGating: false, caseGating: false, ...opts.economy },
  });
  g.money = 1_000_000;
  g.powerButton();
  const put = (id: string): void => {
    const b = g.purchase(id);
    if (!b.ok) {
      throw new Error(`purchase ${id}: ${b.reason}`);
    }
    const r = g.install(b.invId);
    if (!r.ok) {
      throw new Error(`install ${id}: ${r.reason}`);
    }
  };
  // The Starter board has one DIMM and a 24 A VRM: the OS rigs run on the Mainstream board (M.2 slot, 60 A VRM) so cpu1/cpu2 are fine.
  put('board1');
  put('board2');
  put('psu1');
  put(opts.cpu ?? 'cpu1');
  g.uninstall(g.board.devices.find((d) => d.spec === 'ram0')!.id);
  put(opts.ram ?? 'ram1');
  put(storage);
  if (opts.os !== false) {
    put('os1');
  }
  for (const c of g.missingCables()) {
    g.connectCable(c); // the bigger cases brought fans of their own: plug them
  }
  return g;
}

/** The accepted result `r`, or a throw that names `what` and the game's reason for refusing it. */
function must<T>(r: Result<T>, what: string): { ok: true } & T {
  if (!r.ok) {
    throw new Error(`${what}: ${r.reason}`);
  }
  return r;
}

/**
 * A rig with the network ready (docs/NETWORK.md): the OS rig plus 96K of RAM, a router in its spot, an ISP plan and the ethernet
 * cable on the board jack (or `port`). Left powered ON and run until the link is up (unless `wait` is false). Level gating is off.
 */
export function netRig(
  storage: 'hdd0' | 'ssd1' | 'nvme2',
  opts: {
    isp?: string;
    router?: string;
    port?: string | undefined;
    wait?: boolean;
    keys?: Keys | undefined;
    seed?: number | undefined;
    economy?: Partial<EconomyConfig> | undefined;
    cpu?: string | undefined;
  } = {},
): Game {
  const g = rig(storage, { cpu: opts.cpu, keys: opts.keys ?? [], seed: opts.seed, economy: opts.economy });
  const ram = must(g.purchase('ram2'), 'purchase ram2');
  must(g.install(ram.invId), 'install ram2');
  const router = must(g.purchase(opts.router ?? 'router1'), 'router');
  must(g.install(router.invId), 'place router');
  must(g.purchase(opts.isp ?? 'isp1'), 'isp');
  if (opts.port !== undefined) {
    const nic = must(g.purchase(opts.port), 'nic');
    must(g.install(nic.invId), 'install nic');
    const dev = g.board.devices.find((d) => d.spec === opts.port)!;
    must(g.connectCable('lan', dev.id), 'lan');
  } else {
    must(g.connectCable('lan'), 'lan');
  }
  g.powerButton();
  if (opts.wait !== false) {
    for (let i = 0; i < 4000 && g.snapshot().net.state !== 'link-up' && g.snapshot().net.state !== 'saturated'; i++) {
      g.advanceBaseTick();
    }
  }
  return g;
}
