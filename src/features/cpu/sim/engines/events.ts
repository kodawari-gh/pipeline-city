// The engine's event log: what the die view needs to show what is stored (Ev kinds, Which cache, a ring of recent events).

/* oxlint-disable typescript/no-non-null-assertion -- reads of typed arrays and tables at indexes that are valid by construction (hot cycle loop); a guard per read is left to the cpu area wave of #115 */
/* oxlint-disable eslint/max-params -- an event is six numbers in a flat Int32Array ring: one argument per field keeps the push allocation-free */
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
export class EventLog {
  private readonly a = new Int32Array(EV_SIZE * EV_CAP);
  private n = 0;
  reset(): void {
    this.n = 0;
  }
  push(cycle: number, kind: number, a: number, b: number, c: number, d: number): void {
    const i = (this.n++ % EV_CAP) * EV_SIZE;
    const x = this.a;
    x[i] = cycle;
    x[i + 1] = kind;
    x[i + 2] = a;
    x[i + 3] = b;
    x[i + 4] = c;
    x[i + 5] = d;
  }
  /** Events of cycle >= `from`, oldest first, flattened [cycle, kind, a, b, c, d, ...]. */
  since(from: number): number[] {
    const out: number[] = [];
    const first = Math.max(0, this.n - EV_CAP);
    for (let k = first; k < this.n; k++) {
      const i = (k % EV_CAP) * EV_SIZE;
      if (this.a[i]! >= from) {
        for (let j = 0; j < EV_SIZE; j++) {
          out.push(this.a[i + j]!);
        }
      }
    }
    return out;
  }
}
