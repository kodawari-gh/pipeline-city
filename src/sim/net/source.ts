// The network WorkSource (docs/NETWORK.md): offers waiting at the ISP side. Same contract as the USB tray; the Game
// downloads an offer (take), and a download that was lost goes back (giveBack, keeping its arrival order).

import type { Job, WorkSource } from "../game/work";

export class NetworkSource<J extends Job> implements WorkSource<J> {
  readonly name = "network";
  private list: J[] = [];
  constructor(readonly cap: number) {}

  offer(job: J): boolean {
    if (this.list.length >= this.cap) return false;
    this.list.push(job);
    return true;
  }
  waiting(): readonly J[] {
    return this.list;
  }
  take(id: number): J | undefined {
    const k = this.list.findIndex((j) => j.id === id);
    return k < 0 ? undefined : this.list.splice(k, 1)[0];
  }
  giveBack(job: J): void {
    const k = this.list.findIndex((j) => j.id > job.id);
    this.list.splice(k < 0 ? this.list.length : k, 0, job);
  }
  set(jobs: J[]): void {
    this.list = jobs;
  }
}

/**
 * The offer to start downloading next (docs/NETWORK.md "Web jobs"): among the offers that may start, the one in the oldest
 * age band (`bandTicks` of age per band); inside a band a web offer goes before the others; then the oldest. The list is
 * in arrival order, so "oldest" is the first of equals. Returns undefined when none may start.
 */
export function pickOffer<J extends Job & { cls: string }>(
  offers: readonly J[], now: number, bandTicks: number, mayStart: (j: J) => boolean,
): J | undefined {
  let best: J | undefined;
  let bestBand = -1;
  for (const j of offers) {
    if (!mayStart(j)) continue;
    const band = Math.floor(Math.max(0, now - j.arrival) / bandTicks);
    if (!best || band > bestBand || (band === bestBand && j.cls === "web" && best.cls !== "web")) {
      best = j;
      bestBand = band;
    }
  }
  return best;
}
