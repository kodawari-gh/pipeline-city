// A bot player: does what a patient human would, after `reaction` ticks of delay for each manual step. Used by the
// tests and by dev tools to drive the economy without a UI. Call `step()` once after every `advanceBaseTick()`.
//
// Without an OS it runs the manual loop: hand back a finished key (payout), power off a halted machine, plug the
// oldest key while the machine is off, power on, wait. Parts and cables are installed (machine off) whenever the port
// holds no key. With an OS it keeps the machine on: plug a tray key to ingest it, unplug it once queued (the OS holds it),
// plug a held key whose result is ready, remove it when the flash landed. The sim itself never needs it.

import { CABLE_IDS, deviceSpec, getSpec } from "../board";
import { getRouterSpec } from "../net";
import type { Game } from "./game";

export class Operator {
  private wait = 0;
  constructor(private readonly g: Game, private readonly reaction = 0) {}

  step(): void {
    const g = this.g;
    const plugged = g.pluggedKey();
    if (plugged?.done && g.currentPhase() !== "writing" && g.currentPhase() !== "flashing") return this.act(() => { g.ejectKey(); });
    if ((!plugged || g.currentPhase() === "error") && this.hasMaintenance()) return this.act(() => this.assemble(false));
    if (g.hasOs()) return this.stepOs(plugged);
    const phase = g.currentPhase();
    // A halted machine (job done, or no key at boot) stays halted until it is power-cycled by hand.
    if (g.powered && !plugged && phase === "halted") return this.act(() => { g.powerButton(); });
    if (!g.powered && !plugged && g.trayKeyIds().length > 0) return this.act(() => { g.plugKey(g.trayKeyIds()[0]!); });
    if (!g.powered && plugged) return this.act(() => { g.powerButton(); });
    this.wait = 0;
  }

  private stepOs(plugged: { id: number; done: boolean } | null): void {
    const g = this.g;
    if (!g.powered) return this.act(() => { g.powerButton(); });
    // The OS keeps the key until the result is written, then it pops out by itself: the bot only plugs the next one.
    if (plugged) return void (this.wait = 0);
    if (g.trayKeyIds().length > 0 && g.currentPhase() !== "booting-os" && g.currentPhase() !== "posting") {
      return this.act(() => { g.plugKey(g.trayKeyIds()[0]!); });
    }
    this.wait = 0;
  }

  private act(fn: () => void): void {
    if (this.wait < this.reaction) {
      this.wait++;
      return;
    }
    this.wait = 0;
    fn();
  }

  private hasMaintenance(): boolean {
    const g = this.g;
    return this.wanted().length > 0 || g.missingCables().length > 0;
  }

  /** Inventory items worth installing: they fit, and they fill an empty kind or beat the installed part (no downgrades). */
  private wanted(): string[] {
    const g = this.g;
    const tier = (id: string): number => getSpec(g.inventoryItems().find((i) => i.id === id)!.spec)?.tier ?? 99;
    return g.inventoryItems().filter((it) => {
      if (!g.canInstall(it.id)) return false;
      const spec = getSpec(it.spec);
      if (!spec) return !getRouterSpec(it.spec); // a board (a router is placed by hand)
      const have = g.board.devices.filter((d) => deviceSpec(d).kind === spec.kind && !d.burnt);
      return have.length === 0 || spec.tier > Math.max(...have.map((d) => deviceSpec(d).tier));
    }).map((it) => it.id).sort((a, b) => tier(b) - tier(a));
  }

  /** Swap over the weakest installed part of the same kind (a second RAM stick would not speed the first one up). */
  private slotFor(invId: string): string | undefined {
    const g = this.g;
    const spec = getSpec(g.inventoryItems().find((i) => i.id === invId)!.spec);
    if (!spec) return undefined;
    const have = g.board.devices.filter((d) => deviceSpec(d).kind === spec.kind).sort((a, b) => deviceSpec(a).tier - deviceSpec(b).tier);
    return have[0]?.slot;
  }

  /** Power off, install everything worth installing, plug in every cable that can be, and (with `powerOn`) boot. */
  assemble(powerOn = true): void {
    const g = this.g;
    if (g.powered) g.powerButton();
    for (let again = true; again; ) {
      again = false;
      for (const id of this.wanted()) {
        if (g.install(id, this.slotFor(id)).ok) {
          again = true;
          break;
        }
      }
    }
    for (const c of CABLE_IDS) if (c !== "lan") g.connectCable(c);
    if (powerOn) g.powerButton();
  }
}

/** Drive `g` for `ticks` base ticks with a bot player (`reaction` ticks of delay per manual step). */
export function play(g: Game, ticks: number, reaction = 0, each?: (g: Game, t: number) => void): Operator {
  const op = new Operator(g, reaction);
  for (let t = 1; t <= ticks; t++) {
    g.advanceBaseTick();
    op.step();
    each?.(g, t);
  }
  return op;
}
