// Game feature: the shop. Buying, selling, what things cost and the level gate on them. Every export is a `Game` method (see game.ts).

import { getIspSpec, ISP_SPECS, ROUTER_SPECS } from "../../network/sim";
import { OS_SPECS } from "../../os/sim";
import { catalog, sellValue } from "./economy";
import type { Game } from "@/worker/game/game";
import { lockText } from "@/worker/game/internal";
import { levelDef, unlockLevelOf } from "./levels";
import type { PurchaseSnap, Result } from "@/worker/game/types";

/**
 * Buy an item (a device spec id, a board or case tier id, an OS, a router or an internet plan): money is spent now and the part
 * goes to the inventory, not into the machine. Everything is for sale, any tier and any number (spares, downgrades, a second
 * machine); only the player level gates it. Whether a part fits is the inventory's business (`reason`), not the shop's.
 */
export function purchase(this: Game, itemId: string): Result<{ invId: string }> {
  const extra = this.extraOffers().find((o) => o.id === itemId);
  if (extra) {
    const lock = this.levelLock(itemId);
    if (lock) return { ok: false, reason: lockText(lock) };
    if (extra.blocked) return { ok: false, reason: extra.blocked };
    if (this.money < extra.price) return { ok: false, reason: `needs $${extra.price}, have $${this.money}` };
    this.money -= extra.price;
    this.progress.firstPurchase = true;
    const isp = getIspSpec(itemId);
    if (isp) {
      // An ISP plan is an account purchase: it applies at once (no inventory item) and a higher plan replaces it.
      this.ispTier = isp.tier;
      this.progress.ispBought = true;
      this.note("purchase", `bought ${extra.name} ${this.priceText(extra.price)}`);
      return { ok: true, invId: "" };
    }
    const invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: itemId });
    this.note("purchase", `bought ${extra.name} ${this.priceText(extra.price)}`);
    return { ok: true, invId };
  }
  const cand = catalog().find((s) => s.id === itemId);
  if (!cand) return { ok: false, reason: `"${itemId}" is not for sale` };
  const lock = this.levelLock(itemId);
  if (lock) return { ok: false, reason: lockText(lock) };
  const price = this.cost(cand.price);
  if (this.money < price) return { ok: false, reason: `needs $${price}, have $${this.money}` };
  this.money -= price;
  const invId = `inv${this.nextInvId++}`;
  this.inventory.push({ id: invId, spec: itemId });
  this.progress.firstPurchase = true;
  this.note("purchase", `bought ${cand.name} ${this.priceText(price)}`);
  return { ok: true, invId };
}

/** Sell a spare from the inventory for `SELL_RATE` of its price. Not the part a queued swap is waiting to fit; nothing in the sandbox. */
export function sell(this: Game, invId: string): Result<{ money: number }> {
  if (this.sandbox) return { ok: false, reason: "the sandbox has no money: nothing to sell for" };
  const it = this.inventory.find((i) => i.id === invId);
  if (!it) return { ok: false, reason: `no inventory item "${invId}"` };
  if (this.pendingSwap?.invId === invId) return { ok: false, reason: "this part is waiting to be fitted: wait for the swap" };
  const value = sellValue(it.spec);
  const name = this.inventorySnap().find((i) => i.id === invId)?.name ?? it.spec;
  this.inventory = this.inventory.filter((i) => i.id !== invId);
  this.money += value;
  this.note("purchase", `sold ${name} for $${value}`);
  return { ok: true, money: value };
}

/** Level gate (docs/PROGRESSION.md "Unlock table"): null when the item is open now, always in the sandbox. */
export function levelLock(this: Game, id: string): { level: number; name: string } | null {
  if (this.sandbox || !this.cfg.levelGating) return null;
  const need = unlockLevelOf(id);
  return need > this.lvl ? { level: need, name: levelDef(need).name } : null;
}

/** What a list price costs the player: nothing in the sandbox. */
export function cost(this: Game, listPrice: number): number {
  return this.sandbox ? 0 : listPrice;
}

export function priceText(this: Game, price: number): string {
  return this.sandbox ? "(sandbox: free)" : `for $${price}`;
}

/** Operating systems, routers and internet plans for sale: every tier, as many as you like (a plan applies at once, so the one you are on is not offered again). */
export function extraOffers(this: Game): PurchaseSnap[] {
  const out: PurchaseSnap[] = [];
  for (const os of OS_SPECS) {
    const o: PurchaseSnap = {
      id: os.id, name: os.name, kind: "os", price: this.cost(os.price), affordable: this.money >= this.cost(os.price), description: os.description,
      ...(os.later ? { later: true } : {}),
    };
    if (os.later) o.blocked = "planned: not available yet";
    out.push(o);
  }
  // Routers (installed from the inventory into the router spot) and ISP plans (applied at purchase).
  for (const r of ROUTER_SPECS) {
    out.push({ id: r.id, name: r.name, kind: "router", price: this.cost(r.price), affordable: this.money >= this.cost(r.price),
      description: `External router: ${r.mbps} Mbit/s, ${r.clients} clients at once. Own power; goes next to the monitor.` });
  }
  for (const p of ISP_SPECS) {
    if (!this.sandbox && p.tier === this.ispTier) continue;
    out.push({ id: p.id, name: `${p.name} plan`, kind: "isp", price: this.cost(p.price), affordable: this.money >= this.cost(p.price),
      description: `ISP plan: ${p.downMbps} down / ${p.upMbps} up Mbit/s, ${p.clients} clients at once. One-off purchase.` });
  }
  return out;
}
