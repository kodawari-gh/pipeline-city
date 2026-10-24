// Shared test rigs (not a test file).
import type { EconomyConfig } from "./economy";
import { Game } from "./game";

export type Keys = { template: string; scale?: number }[];

/** No random arrivals; the tray starts with `keys` (default: the one starter key). */
export const econ = (keys: Keys = [{ template: "cli.log" }]) => ({ baseDemandPerTick: 0, startQueue: keys });

/**
 * A machine ready for an OS: CPU `cpu`, 32K RAM, a PSU big enough, one storage drive and (unless `os: false`) the OS
 * installed, powered off. Built from preassembled by buying with free money and installing by hand.
 */
export function rig(storage: "hdd0" | "ssd1" | "nvme2", opts: { cpu?: string; os?: boolean; keys?: Keys; seed?: number; economy?: Partial<EconomyConfig>; startLevel?: number } = {}): Game {
  const g = new Game({ seed: opts.seed ?? 7, preassembled: true, startLevel: opts.startLevel, economy: { ...econ(opts.keys), levelGating: false, ...opts.economy } });
  g.money = 1_000_000;
  g.powerButton();
  const put = (id: string): void => {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  };
  // The Starter board has one DIMM and a 24 A VRM: the OS rigs run on the Mainstream board (M.2 slot, 60 A VRM) so cpu1/cpu2 are fine.
  put("board1");
  put("board2");
  put("psu1");
  put(opts.cpu ?? "cpu1");
  g.uninstall(g.board.devices.find((d) => d.spec === "ram0")!.id);
  put("ram1");
  put(storage);
  if (opts.os !== false) put("os1");
  return g;
}

