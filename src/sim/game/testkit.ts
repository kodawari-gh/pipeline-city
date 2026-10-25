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
  const g = new Game({ seed: opts.seed ?? 7, preassembled: true, startLevel: opts.startLevel, economy: { ...econ(opts.keys), levelGating: false, caseGating: false, ...opts.economy } });
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


/**
 * A rig with the network ready (docs/NETWORK.md): the OS rig plus 96K of RAM, a router in its spot, an ISP plan and the ethernet
 * cable on the board jack (or `port`). Left powered ON and run until the link is up (unless `wait` is false). Level gating is off.
 */
export function netRig(storage: "hdd0" | "ssd1" | "nvme2", opts: { isp?: string; router?: string; port?: string; wait?: boolean; keys?: Keys; seed?: number; economy?: Partial<EconomyConfig>; cpu?: string } = {}): Game {
  const g = rig(storage, { cpu: opts.cpu, keys: opts.keys ?? [], seed: opts.seed, economy: opts.economy });
  for (const id of ["ram2"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  const router = g.purchase(opts.router ?? "router1");
  if (!router.ok) throw new Error(`router: ${router.reason}`);
  const place = g.install(router.invId);
  if (!place.ok) throw new Error(`place router: ${place.reason}`);
  const plan = g.purchase(opts.isp ?? "isp1");
  if (!plan.ok) throw new Error(`isp: ${plan.reason}`);
  if (opts.port !== undefined) {
    const nic = g.purchase(opts.port);
    if (!nic.ok) throw new Error(`nic: ${nic.reason}`);
    const inst = g.install(nic.invId);
    if (!inst.ok) throw new Error(`install nic: ${inst.reason}`);
    const dev = g.board.devices.find((d) => d.spec === opts.port)!;
    const c = g.connectCable("lan", dev.id);
    if (!c.ok) throw new Error(`lan: ${c.reason}`);
  } else {
    const c = g.connectCable("lan");
    if (!c.ok) throw new Error(`lan: ${c.reason}`);
  }
  g.powerButton();
  if (opts.wait !== false) {
    for (let i = 0; i < 4000 && g.snapshot().net.state !== "link-up" && g.snapshot().net.state !== "saturated"; i++) g.advanceBaseTick();
  }
  return g;
}
