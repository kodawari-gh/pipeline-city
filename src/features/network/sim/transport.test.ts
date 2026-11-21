import { describe, expect, it } from "vitest";
import { Flow, lossRoll, TRANSPORT, type FlowInit } from "./transport";

// The transport alone (docs/NETSTACK.md section 3.4): the loss roll, the timing with no loss, the window, the timeout, giving up.

const init = (o: Partial<FlowInit> = {}): FlowInit => ({ id: 7, seed: 123, segs: 4, segMB: 8, rtt: 1, cwnd: 64, loss: 0, ...o });

describe("lossRoll", () => {
  it("is a number in [0,1) that depends only on its four inputs", () => {
    expect(lossRoll(1, 2, 3, 4)).toBe(lossRoll(1, 2, 3, 4));
    for (let i = 0; i < 1000; i++) {
      const r = lossRoll(i, i * 7, i % 11, i % 9);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it("changes with each input: the game, the transfer, the segment and the send", () => {
    const base = lossRoll(5, 6, 7, 0);
    expect(lossRoll(6, 6, 7, 0)).not.toBe(base);
    expect(lossRoll(5, 7, 7, 0)).not.toBe(base);
    expect(lossRoll(5, 6, 8, 0)).not.toBe(base);
    expect(lossRoll(5, 6, 7, 1)).not.toBe(base);
  });

  it("is spread evenly: the mean is near a half and every tenth of the range is used", () => {
    const bins = new Array<number>(10).fill(0);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const r = lossRoll(99, i >> 6, i & 63, 0);
      sum += r;
      bins[Math.floor(r * 10)]!++;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const b of bins) expect(b).toBeGreaterThan(n / 10 * 0.9);
  });

  it("rolls the resend of a segment independently of the first send", () => {
    // 30% loss: a segment lost once is not lost for good (a resend has its own roll)
    let both = 0, first = 0;
    for (let seq = 0; seq < 4000; seq++) {
      const a = lossRoll(3, 11, seq, 0) < 0.3, b = lossRoll(3, 11, seq, 1) < 0.3;
      if (a) first++;
      if (a && b) both++;
    }
    expect(both / first).toBeGreaterThan(0.2);
    expect(both / first).toBeLessThan(0.4);
  });
});

/** The ticks the old rule released each segment at: due when the bytes that have crossed the line cover it. */
function oldRule(total: number, segs: number, share: number): number[] {
  const at: number[] = [];
  let done = 0;
  for (let t = 1; at.length < segs && t < 10000; t++) {
    done += share;
    const due = done >= total ? segs : Math.floor((segs * done) / total);
    while (at.length < due) at.push(t);
  }
  return at;
}

describe("the line time", () => {
  it("with no loss and a roomy window the segments leave when the bytes cover them, as before there was a transport", () => {
    for (const [total, segs, share] of [[24, 3, 6.25], [24, 1, 6.25], [300, 8, 6.25], [75, 5, 25], [3000, 11, 12.5], [4, 2, 6.25], [0.5, 1, 6.25]] as const) {
      const f = new Flow(init({ segs, segMB: total / segs }));
      const left: number[] = [];
      for (let t = 1; left.length < segs && t < 10000; t++) {
        for (const s of f.step(t, f.moving ? share : 0)) left.push(t + 0 * s.seq);
        f.ack(t, f.next); // a receiver that takes everything at once: no timeout, no window limit
      }
      expect(left, `${total} MB in ${segs} at ${share}`).toEqual(oldRule(total, segs, share));
    }
  });

  it("counts the line time it earns, and no more than the transfer needs", () => {
    const f = new Flow(init({ segs: 2, segMB: 10 }));
    let earned = 0;
    for (let t = 1; t < 10; t++) { f.step(t, 7); earned += f.earned; f.ack(t, f.next); }
    expect(earned).toBeCloseTo(20, 6);
  });

  it("segments with no line cost (a replay) leave as the window allows", () => {
    const f = new Flow(init({ segs: 5, segMB: 0, cwnd: 3 }));
    expect(f.step(1, 0).map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(f.step(2, 0)).toEqual([]);
    f.ack(2, 2);
    expect(f.step(3, 0).map((s) => s.seq)).toEqual([3, 4]);
  });

  it("a flow with no room in its window takes no share of the line", () => {
    const f = new Flow(init({ segs: 6, segMB: 1, cwnd: 2 }));
    expect(f.moving).toBe(true);
    f.step(1, 100);
    expect(f.inflight).toBe(2);
    expect(f.moving).toBe(false);
    f.step(2, 100);
    expect(f.earned).toBe(0);
  });
});

describe("the window and the acknowledgements", () => {
  it("holds the segments back at the window, and an acknowledgement lets more go", () => {
    const f = new Flow(init({ segs: 10, segMB: 1, cwnd: 2 }));
    expect(f.step(1, 100).map((s) => s.seq)).toEqual([0, 1]);
    expect(f.step(2, 100)).toEqual([]);
    f.ack(2, 1);
    const more = f.step(3, 100).map((s) => s.seq);
    expect(more[0]).toBe(2);
  });

  it("slow start: the window grows by one for each segment acknowledged, up to ssthresh, then by one a round trip", () => {
    const f = new Flow(init({ segs: 40, segMB: 0, cwnd: 2 }));
    f.ssthresh = 6;
    f.step(1, 0);
    expect(f.cwnd).toBe(2);
    f.ack(2, 2);
    expect(f.cwnd).toBe(4);
    f.step(2, 0);
    f.ack(3, 4);
    expect(f.cwnd).toBe(6);
    f.step(3, 0);
    f.ack(4, 10);
    expect(f.cwnd).toBeGreaterThan(6);
    expect(f.cwnd).toBeLessThan(7); // 6 segments acknowledged above ssthresh: about one more
  });

  it("an old acknowledgement changes nothing, and one past the end is cut to it", () => {
    const f = new Flow(init({ segs: 3, segMB: 0 }));
    f.step(1, 0);
    f.ack(2, 2);
    const w = f.cwnd;
    f.ack(3, 1);
    f.ack(3, 2);
    expect(f.acked).toBe(2);
    expect(f.cwnd).toBe(w);
    f.ack(4, 99);
    expect(f.acked).toBe(3);
    expect(f.done).toBe(true);
  });

  it("takes a round-trip sample from a segment sent once, and none from a segment that was sent again (Karn)", () => {
    const f = new Flow(init({ segs: 2, segMB: 0, rtt: 1 }));
    f.step(1, 0);
    f.ack(9, 1); // the first segment took 8 ticks
    expect(f.srtt).toBeCloseTo(1 + 0.125 * 7, 6);
    const before = f.srtt;
    f.step(10, 0); // segment 1, sent at 10
    f.step(10 + f.rto, 0); // times out and goes again
    f.ack(40, 2); // the acknowledgement may be for either send: no sample
    expect(f.srtt).toBe(before);
  });
});

describe("the timeout", () => {
  it("goes back to the first unacknowledged segment after `rto` ticks, halves ssthresh and restarts the window", () => {
    const f = new Flow(init({ segs: 4, segMB: 0, cwnd: 8 }));
    expect(f.step(1, 0).map((s) => s.seq)).toEqual([0, 1, 2, 3]);
    expect(f.rto).toBe(3);
    expect(f.step(3, 0)).toEqual([]); // not yet: 3 ticks after the first send is tick 4
    const again = f.step(4, 0);
    expect(again.map((s) => s.seq)).toEqual([0]); // the window is one segment now
    expect(again[0]!.attempt).toBe(1);
    expect(f.cwnd).toBe(1);
    expect(f.ssthresh).toBe(4);
    expect(f.stats).toMatchObject({ sent: 5, resent: 1, timeouts: 1 });
  });

  it("doubles the timeout for each timeout in a row, up to a cap, and an acknowledgement starts it again", () => {
    const f = new Flow(init({ segs: 1, segMB: 0 }));
    f.step(0, 0);
    const timeouts: number[] = [];
    let last = 0;
    for (let t = 1; t < 400 && timeouts.length < 6; t++) {
      if (f.step(t, 0).length > 0) { timeouts.push(t - last); last = t; }
    }
    expect(timeouts.slice(0, 5)).toEqual([3, 6, 12, 24, 48]);
    expect(timeouts[5]).toBe(96); // capped
    f.ack(500, 1);
    expect(f.backoff).toBe(1);
  });

  it("fails the transfer when a segment would have to be sent more than maxRetries times again", () => {
    const f = new Flow(init({ segs: 2, segMB: 0, cwnd: 2 }));
    let sent = 0;
    for (let t = 0; t < 5000 && !f.failed; t++) sent += f.step(t, 0).filter((s) => s.seq === 0).length;
    expect(f.failed).toBe(true);
    expect(sent).toBe(1 + TRANSPORT.maxRetries); // the first send and the eight resends
    expect(f.sending).toBe(false);
    expect(f.step(9999, 0)).toEqual([]);
  });

  it("makes progress even if every send is lost until the roll turns", () => {
    // with 99% loss the first ack takes many sends; the roll is stateless, so the same game always takes the same number
    const run = (): number => {
      const f = new Flow(init({ segs: 1, segMB: 0, loss: 0.99, id: 5, seed: 17 }));
      let n = 0;
      for (let t = 0; t < 100000 && !f.done && !f.failed; t++) {
        for (const s of f.step(t, 0)) { n++; if (!s.lost) f.ack(t + 1, 1); }
      }
      return n;
    };
    expect(run()).toBe(run());
  });
});

/** A closed loop: the flow, a receiver that takes segments in order and acknowledges each with the next one it wants, and a wire with a delay. */
function loop(o: { segs: number; segMB: number; share: number; loss: number; seed?: number; id?: number; cwnd?: number; maxTicks?: number; deaf?: (t: number) => boolean }): { ticks: number; flow: Flow } {
  const f = new Flow({ id: o.id ?? 3, seed: o.seed ?? 1, segs: o.segs, segMB: o.segMB, rtt: 1, cwnd: o.cwnd ?? 2, loss: o.loss });
  let want = 0;
  let arriving: { at: number; seq: number }[] = [];
  let t = 0;
  for (t = 1; t < (o.maxTicks ?? 5000); t++) {
    const due = arriving.filter((a) => a.at <= t);
    arriving = arriving.filter((a) => a.at > t);
    let ackTo = -1;
    for (const a of due) {
      if (o.deaf?.(t)) continue; // the machine does not answer (a long job holds the CPU)
      if (a.seq === want) want++;
      ackTo = want;
    }
    if (ackTo >= 0) f.ack(t, ackTo);
    for (const s of f.step(t, f.moving ? o.share : 0)) if (!s.lost) arriving.push({ at: t + 1, seq: s.seq });
    if (f.done || f.failed) break;
  }
  return { ticks: t, flow: f };
}

describe("a flow against a receiver", () => {
  it("with no loss it takes the line's time and one tick for the last acknowledgement", () => {
    const { ticks, flow } = loop({ segs: 3, segMB: 8, share: 6.25, loss: 0 });
    expect(flow.done).toBe(true);
    expect(flow.stats).toMatchObject({ sent: 3, resent: 0, lost: 0, timeouts: 0 });
    // the last segment leaves on the 4th tick (24 MB at 6.25 a tick), it arrives on the 5th
    expect(ticks).toBe(5);
  });

  it("with loss every transfer still ends, resending what was lost", () => {
    let lost = 0, resent = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { flow } = loop({ segs: 8, segMB: 4, share: 12.5, loss: 0.3, seed });
      expect(flow.done, `seed ${seed}`).toBe(true);
      lost += flow.stats.lost;
      resent += flow.stats.resent;
    }
    expect(lost).toBeGreaterThan(0);
    expect(resent).toBeGreaterThanOrEqual(lost); // everything the wire lost went again (and the segments behind it, which the receiver does not take out of order)
  });

  it("is the same every run for the same game and different for another", () => {
    const a = loop({ segs: 8, segMB: 4, share: 12.5, loss: 0.3, seed: 9 });
    const b = loop({ segs: 8, segMB: 4, share: 12.5, loss: 0.3, seed: 9 });
    expect(b.ticks).toBe(a.ticks);
    expect(b.flow.stats).toEqual(a.flow.stats);
    const times = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => loop({ segs: 8, segMB: 4, share: 12.5, loss: 0.3, seed }).ticks));
    expect(times.size).toBeGreaterThan(1);
  });

  it("more loss takes longer, on average over many games", () => {
    const mean = (loss: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) sum += loop({ segs: 8, segMB: 4, share: 12.5, loss, seed }).ticks;
      return sum / 40;
    };
    const none = mean(0), some = mean(0.1), lots = mean(0.4);
    expect(some).toBeGreaterThan(none);
    expect(lots).toBeGreaterThan(some);
  });

  it("a receiver that is silent for a while makes the flow time out and back off, and it recovers when the receiver answers", () => {
    const { flow } = loop({ segs: 3, segMB: 0, share: 0, loss: 0, deaf: (t) => t < 40 });
    expect(flow.done).toBe(true);
    expect(flow.stats.timeouts).toBeGreaterThanOrEqual(3);
    expect(flow.failed).toBe(false);
  });

  it("a receiver that never answers fails the transfer after the retries", () => {
    const { flow } = loop({ segs: 2, segMB: 0, share: 0, loss: 0, deaf: () => true, maxTicks: 20000 });
    expect(flow.failed).toBe(true);
  });
});
