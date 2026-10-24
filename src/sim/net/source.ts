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
