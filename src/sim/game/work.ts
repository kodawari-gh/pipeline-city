// Where jobs come from and wait. The first (and only) implementation is the manual USB tray: clients leave keys
// next to the monitor and the player plugs them in one at a time. A router/ethernet later becomes a second
// WorkSource that downloads workloads straight to the machine and uploads results (no tray, offline catch-up
// possible). Not built yet; the Game only talks to this interface for arrivals and the waiting list.

/** A job as the work source sees it. The Game's Key extends this. */
export interface Job {
  id: number;
  arrival: number;
}

export interface WorkSource<J extends Job = Job> {
  readonly name: string;
  /** A client sends a job. false = refused (the tray is full): the client gives up. */
  offer(job: J): boolean;
  /** Jobs waiting to be started, oldest first. */
  waiting(): readonly J[];
  /** Remove a waiting job so the machine can run it. */
  take(id: number): J | undefined;
  /** Put an unfinished job back (it keeps its place by arrival order). */
  giveBack(job: J): void;
}

/** Keys lying in a tray next to the monitor. */
export class UsbTray<J extends Job> implements WorkSource<J> {
  readonly name = "usb-tray";
  private keys: J[] = [];
  constructor(readonly cap: number) {}

  offer(job: J): boolean {
    if (this.keys.length >= this.cap) return false;
    this.keys.push(job);
    return true;
  }
  waiting(): readonly J[] {
    return this.keys;
  }
  take(id: number): J | undefined {
    const k = this.keys.findIndex((j) => j.id === id);
    return k < 0 ? undefined : this.keys.splice(k, 1)[0];
  }
  giveBack(job: J): void {
    const k = this.keys.findIndex((j) => j.id > job.id);
    this.keys.splice(k < 0 ? this.keys.length : k, 0, job);
  }
  /** Replace the contents (loading a save). */
  set(keys: J[]): void {
    this.keys = keys;
  }
}
