// The engine's event log: what the die view needs to show what is stored (Ev kinds, Which cache, a ring of recent events).

/** What the die view needs to show what is stored: a ring of the writes the machine did in its last cycles (docs/DIE.md "What is stored"). */
export const Ev = {
  Reg: 1,
  Hit: 2,
  Fill: 3,
  Pred: 4,
  Mem: 5,
  Row: 6,
  Tlb: 7,
  Irq: 8,
  Iret: 9,
  Space: 10,
  Inval: 11,
} as const;
/** Which cache an event is about. */
export const Which = { D: 0, I: 1, L2: 2 } as const;
const EV_SIZE = 6,
  EV_CAP = 1024;
/** One event: its cycle, its kind (`Ev`) and four numbers whose meaning depends on the kind. Each is stored as an int32. */
export interface EngineEvent {
  cycle: number;
  kind: number;
  a: number;
  b: number;
  c: number;
  d: number;
}
export class EventLog {
  private readonly a = new Int32Array(EV_SIZE * EV_CAP);
  private n = 0;
  reset(): void {
    this.n = 0;
  }
  record(e: Readonly<EngineEvent>): void {
    const i = (this.n % EV_CAP) * EV_SIZE;
    this.n += 1;
    const x = this.a;
    x[i] = e.cycle;
    x[i + 1] = e.kind;
    x[i + 2] = e.a;
    x[i + 3] = e.b;
    x[i + 4] = e.c;
    x[i + 5] = e.d;
  }
  /** Events of cycle >= `from`, oldest first, flattened [cycle, kind, a, b, c, d, ...]. */
  since(from: number): number[] {
    const out: number[] = [];
    const first = Math.max(0, this.n - EV_CAP);
    for (let k = first; k < this.n; k++) {
      const i = (k % EV_CAP) * EV_SIZE;
      if ((this.a[i] ?? 0) >= from) {
        out.push(...this.a.subarray(i, i + EV_SIZE));
      }
    }
    return out;
  }
}
