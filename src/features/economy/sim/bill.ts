// Game feature: the power bill. A flat rate on the energy the wall gives the machine, issued every period, taken from the
// money by itself, and an unpaid bill cuts the wall after a grace period (docs/GAME.md "The power bill"). Every export is a
// `Game` method (see game.ts).

import type { Game } from "@/worker/game/game";
import type { BillSnap } from "@/worker/game/types";

/** Whether this game has a bill: not the sandbox (no money), and only with a rate. */
export function billActive(this: Game): boolean {
  return !this.sandbox && this.cfg.powerRatePerWh > 0;
}

/** Energy the wall has given the machine since the last bill (Wh). */
export function unbilledWh(this: Game): number {
  return Math.max(0, this.wattTicks / 3600 - this.billedWh);
}

/** Whole dollars for some energy, rounded up so any use costs at least a dollar. */
function cost(g: Game, wh: number): number {
  return wh > 1e-9 ? Math.ceil(wh * g.cfg.powerRatePerWh - 1e-9) : 0;
}

/** One base tick of the bill: issue it when the period is up, pay what the money covers, cut the wall when the grace is over. */
export function billTick(this: Game): void {
  if (!this.billActive()) return;
  if (this.nextBillTick === null) {
    if (this.firstBootTick === null) return; // the clock starts with the first power-on
    this.nextBillTick = this.baseTick + this.cfg.billPeriodTicks;
  }
  if (this.baseTick >= this.nextBillTick) {
    const wh = this.unbilledWh();
    const amount = cost(this, wh);
    this.billedWh += wh;
    this.nextBillTick = this.baseTick + this.cfg.billPeriodTicks;
    if (amount > 0) {
      this.lastBill = { tick: this.baseTick, wh, amount };
      this.unpaid += amount;
      this.unpaidSince ??= this.baseTick;
      this.note("bill", `power bill: $${amount} for ${wh.toFixed(1)} Wh`);
    }
  }
  if (this.unpaid > 0 && this.money >= this.unpaid) {
    this.money -= this.unpaid;
    this.billPaid += this.unpaid;
    this.note("bill", `paid the power bill: $${this.unpaid}`);
    this.unpaid = 0;
    this.unpaidSince = null;
    if (this.powerCut) {
      this.powerCut = false;
      this.note("power", "the power company reconnected the wall (press power to start)");
    }
  }
  if (this.unpaid > 0 && !this.powerCut && this.baseTick >= (this.cutTick() ?? Infinity)) {
    this.powerCut = true;
    this.note("fault", `the power company cut the wall: the $${this.unpaid} bill is unpaid`);
    if (this.powered) this.powerButton(); // a hard power-off, like pulling the cord
  }
}

/** The tick the wall is cut for the unpaid bill, or null with nothing unpaid. */
export function cutTick(this: Game): number | null {
  return this.unpaid > 0 && this.unpaidSince !== null ? this.unpaidSince + this.cfg.billGraceTicks : null;
}

/** Why the wall is cut (the power button's refusal), or null. */
export function cutReason(this: Game): string | null {
  return this.powerCut ? `the power company cut the wall: the $${this.unpaid} bill is unpaid (it is paid once you have the money)` : null;
}

export function billSnap(this: Game): BillSnap | null {
  if (!this.billActive()) return null;
  const wh = this.unbilledWh();
  return {
    ratePerWh: this.cfg.powerRatePerWh, periodTicks: this.cfg.billPeriodTicks, nextTick: this.nextBillTick,
    accruedWh: wh, accruedCost: cost(this, wh),
    unpaid: this.unpaid, cutTick: this.cutTick(), cut: this.powerCut,
    last: this.lastBill && { ...this.lastBill }, paidTotal: this.billPaid,
  };
}
