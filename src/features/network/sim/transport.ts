// The sender's side of a download: a simplified TCP (docs/NETSTACK.md section 3.4). Pure and seeded: no Game, no clock of its own, no PRNG state. The game layer (`network.ts`) owns one `Flow` per
// download, calls `step` once a tick, hands the segments it returns to the wire, and calls `ack` when the kernel's acknowledgement packet comes back.
//
//   segments   a download is `segs` segments, numbered from 0. The receiver takes them in order only and acknowledges with the next one it wants (a cumulative ACK).
//   the line   a segment costs `segMB` of the line's time. The flow earns line time from its share of the bandwidth (`step`'s `shareMB`) and spends it on segments. With no loss and a roomy window
//              segment i leaves exactly when the bytes up to it have crossed the line, which is the timing the game had before there was a transport.
//   the window `cwnd` segments may be unacknowledged at once. Slow start doubles it each round trip up to `ssthresh`, then it grows by one a round trip. A timeout halves `ssthresh` and
//              restarts from one segment.
//   timeout    the oldest unacknowledged segment is not acknowledged within `rto` ticks: that segment, and only that one, goes again (the others are most likely in the receiver's ring: it
//              acknowledges each in its turn). Each resend costs line time again. The timeout follows the round trip the acknowledgements show (the smoothed time and its deviation, RFC 6298: a
//              receiver that is slow to answer makes it long) and doubles after each timeout in a row; it comes back to the round trip's own value when an acknowledgement makes progress.
//              The receiver echoes the stamp the segment carried (a timestamp option, RFC 7323), so every acknowledgement times the copy it answers exactly, a resent segment's too. The estimate is
//              shared by the flows of one link (`RttEstimate`): a download of one segment has no time to learn the round trip alone.
//   give up    a segment sent more than `maxRetries` times beyond the first fails the transfer.
//   loss       `lossRoll(seed, transfer, seq, attempt)`: a hash to [0,1), compared with the segment's loss probability. No state: the same game, transfer and segment always roll the same.

/** Placeholder numbers for the balance pass. */
export const TRANSPORT = {
  /** A segment that has been sent this many times beyond the first and is still not acknowledged fails the transfer. */
  maxRetries: 8,
  /** Before the first round-trip sample the timeout is `max(rtoMin, rtoMul x rtt guess)` ticks; after it, `srtt + rttvarMul x rttvar` (at least `rtoMin`). Each timeout in a row doubles it, at most `rtoMax`. */
  rtoMin: 3,
  rtoMul: 3,
  rttvarMul: 4,
  rtoMax: 96,
  /** The most segments a flow has in flight, and the weight of a new round-trip sample in the average (`rttGain`) and in the deviation (`rttvarGain`). */
  cwndMax: 64,
  rttGain: 0.125,
  rttvarGain: 0.25,
} as const;

/** The line time left over by float sums that a segment may still be sent on. */
const EPS = 1e-9;

/** A 32-bit integer mixer (the finaliser of murmur3): a small change in the input changes every bit of the output. */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The roll of one send of one segment: a number in [0,1) that depends only on the game's seed, the transfer, the segment and which send it is. */
export function lossRoll(seed: number, transfer: number, seq: number, attempt: number): number {
  let h = mix32((seed ^ 0x9e3779b9) >>> 0);
  h = mix32((h + Math.imul(transfer | 0, 0x85ebca6b)) >>> 0);
  h = mix32((h + Math.imul(seq + 1, 0xc2b2ae35)) >>> 0);
  h = mix32((h + Math.imul(attempt + 1, 0x27d4eb2f)) >>> 0);
  return h / 4294967296;
}

/** A segment the flow puts on the wire this tick: which one, which send of it (0: the first) and whether the wire loses it. */
export interface Send {
  seq: number;
  attempt: number;
  lost: boolean;
}

/**
 * What a sender has learned of the round trip to a receiver: the smoothed time and its mean deviation (RFC 6298). Until the first sample it holds a guess. The flows of a link share one, so what
 * the first download learns (a receiver that is slow to answer) is there for the next.
 */
export class RttEstimate {
  srtt: number;
  rttvar: number;
  /** A round trip has been measured: `srtt` and `rttvar` follow the acknowledgements, not the first guess. */
  sampled = false;

  constructor(guess: number) {
    this.srtt = Math.max(1, guess);
    this.rttvar = this.srtt / 2;
  }

  /** The timeout this round trip gives, in ticks and before any backoff: a multiple of the guess until the first sample, then `srtt + 4 x rttvar`. */
  get rto(): number {
    const base = this.sampled
      ? Math.ceil(this.srtt + TRANSPORT.rttvarMul * this.rttvar)
      : Math.ceil(TRANSPORT.rtoMul * this.srtt);
    return Math.min(TRANSPORT.rtoMax, Math.max(TRANSPORT.rtoMin, base));
  }

  /** A round trip of `r` ticks: the first sample sets the average and the deviation, later ones move them. */
  sample(r: number): void {
    if (!this.sampled) {
      this.srtt = r;
      this.rttvar = r / 2;
      this.sampled = true;
    } else {
      this.rttvar += TRANSPORT.rttvarGain * (Math.abs(this.srtt - r) - this.rttvar);
      this.srtt += TRANSPORT.rttGain * (r - this.srtt);
    }
  }
}

export interface FlowInit {
  /** The transfer's id (the job's key) and the game's seed: the loss rolls follow from them. */
  id: number;
  seed: number;
  segs: number;
  /** The line time of one segment in MB. 0: the segments cost nothing (a replay from the spool: nothing crosses the wire). */
  segMB: number;
  /** The round trip to the receiver: a number is the first guess, in ticks (at least 1), of an estimate the flow keeps to itself; an `RttEstimate` is shared with the other flows of the link. */
  rtt: number | RttEstimate;
  /** The first window: the segments the line moves in a round trip, at least 2. */
  cwnd: number;
  /** The wire's loss probability for a segment, 0 to 1. */
  loss: number;
}

export class Flow {
  readonly id: number;
  readonly seed: number;
  readonly segs: number;
  readonly segMB: number;
  loss: number;
  /** Cumulative: the segments below this are in the receiver's hands. */
  acked = 0;
  /** The next segment never sent before. */
  next = 0;
  cwnd: number;
  ssthresh: number = TRANSPORT.cwndMax;
  /** The round trip the flow times its timeouts by (`srtt`, `rttvar` are its smoothed time and deviation in ticks). */
  readonly est: RttEstimate;
  /** The doubling of the timeout after timeouts in a row (1: none). */
  backoff = 1;
  /** Line time earned and not yet spent on a segment (MB). */
  credit = 0;
  /** What `step` earned of the line this tick (MB): the jack's counters follow it. */
  earned = 0;
  failed = false;
  /** Counters: segments put on the wire (the resends among them), segments the wire lost, timeouts. */
  readonly stats = { sent: 0, resent: 0, lost: 0, timeouts: 0 };
  /** Times each segment has been sent. */
  private readonly tries: number[];
  /** The tick the oldest unacknowledged segment times out (-1: nothing in flight). */
  private timer = -1;
  /** The first unacknowledged segment must go again (a timeout): it leaves as soon as the line has the time, whatever the window says. */
  private resend = false;

  constructor(init: FlowInit) {
    this.id = init.id;
    this.seed = init.seed;
    this.segs = Math.max(1, init.segs);
    this.segMB = Math.max(0, init.segMB);
    this.loss = Math.min(1, Math.max(0, init.loss));
    this.est = typeof init.rtt === 'number' ? new RttEstimate(init.rtt) : init.rtt;
    this.cwnd = Math.min(TRANSPORT.cwndMax, Math.max(2, init.cwnd));
    this.tries = new Array<number>(this.segs).fill(0);
  }

  get srtt(): number {
    return this.est.srtt;
  }
  get rttvar(): number {
    return this.est.rttvar;
  }
  /** Whole segments the window allows in flight. */
  get window(): number {
    return Math.max(1, Math.floor(this.cwnd));
  }
  get inflight(): number {
    return this.next - this.acked;
  }
  /** Every segment is in the receiver's hands. */
  get done(): boolean {
    return this.acked >= this.segs;
  }
  /** The flow still has segments to put on the wire (new ones, or one to send again): it holds a client slot. */
  get sending(): boolean {
    return !this.failed && !this.done && (this.next < this.segs || this.resend);
  }
  /** The flow has a segment to send and room for it (a resend ignores the window): it takes a share of the line. */
  get moving(): boolean {
    return this.sending && (this.resend || this.inflight < this.window);
  }
  /** The timeout now, in ticks. */
  get rto(): number {
    return Math.min(TRANSPORT.rtoMax, this.est.rto * this.backoff);
  }
  /** Line time the flow still needs to send what is left (MB). */
  get need(): number {
    return this.segMB > 0 ? Math.max(0, (this.segs - this.next + (this.resend ? 1 : 0)) * this.segMB - this.credit) : 0;
  }
  /** The line time the transfer has used so far, and all it will use if nothing more is lost (MB): the progress the player sees. */
  get carriedMB(): number {
    return this.stats.sent * this.segMB + (this.moving ? this.credit : 0);
  }
  get workMB(): number {
    return (this.stats.sent + (this.segs - this.next) + (this.resend ? 1 : 0)) * this.segMB;
  }

  /**
   * One tick: a timeout if one is due, the line time earned from `shareMB`, and the segments the line time and the window allow. Returns what goes on the wire.
   * A flow that is done or has failed does nothing.
   */
  step(now: number, shareMB: number): Send[] {
    const out: Send[] = [];
    this.earned = 0;
    if (this.failed || this.done) return out;
    if (this.timer >= 0 && now >= this.timer && this.inflight > 0) {
      this.stats.timeouts++;
      if (this.tries[this.acked]! > TRANSPORT.maxRetries) {
        this.failed = true;
        return out;
      }
      this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
      this.cwnd = 1;
      this.backoff = Math.min(this.backoff * 2, TRANSPORT.rtoMax);
      this.resend = true;
      this.timer = -1;
    }
    if (this.segMB > 0 && this.moving) {
      this.earned = Math.min(Math.max(0, shareMB), this.need);
      this.credit += this.earned;
    }
    // the first unacknowledged segment again, if a timeout asked for it, then new segments as the window allows
    while (
      (this.resend || (this.next < this.segs && this.inflight < this.window)) &&
      (this.segMB === 0 || this.credit >= this.segMB - EPS)
    ) {
      let seq = this.acked;
      if (this.resend) this.resend = false;
      else seq = this.next++;
      const attempt = this.tries[seq]!++;
      this.credit = Math.max(0, this.credit - this.segMB);
      const lost = this.loss > 0 && lossRoll(this.seed, this.id, seq, attempt) < this.loss;
      this.stats.sent++;
      if (attempt > 0) this.stats.resent++;
      if (lost) this.stats.lost++;
      if (this.timer < 0) this.timer = now + this.rto;
      out.push({ seq, attempt, lost });
    }
    return out;
  }

  /**
   * The receiver's acknowledgement arrives: it wants segment `next` and has all below it, and the segment that moved it on left `rtt` ticks ago (the stamp it echoes). A repeat of an old
   * acknowledgement changes nothing. One that makes progress is a round-trip sample, whichever send of the segment it answers, and ends the backoff.
   */
  ack(now: number, next: number, rtt: number): void {
    if (this.failed || next <= this.acked) return;
    const upto = Math.min(next, this.segs);
    this.est.sample(Math.max(1, rtt));
    this.backoff = 1;
    for (let i = this.acked; i < upto; i++)
      this.cwnd = Math.min(TRANSPORT.cwndMax, this.cwnd < this.ssthresh ? this.cwnd + 1 : this.cwnd + 1 / this.cwnd);
    this.acked = upto;
    if (this.next < this.acked) this.next = this.acked; // an old copy got through after a timeout: do not send what is acknowledged
    this.resend = false; // the segment that was to go again is in the receiver's hands; if the next one is lost, its own timeout comes
    this.timer = this.inflight > 0 ? now + this.rto : -1;
  }
}
