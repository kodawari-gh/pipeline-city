// The lights of the Ethernet jacks (docs/render/net.md "LED meanings"): the PC's uplink port, the router's LAN jack where the cable plugs in, and its WAN jack. Each jack has two:
//   - the link light (green) says the jack has a partner at the other end of the cable: the PC is on and the port works, a router stands, the cable is in; for the router's WAN
//     jack, a plan is on the wall line. It follows the state of the line, as a PHY does, so no OS and no job are needed;
//   - the activity light (amber) follows the frames the port carries. The sim counts them from the bytes that move (`NetSnap.frames`, `network/sim/network.ts`); the light reads how
//     fast that counter grows. A frame lights it for `STRETCH` seconds, as a PHY's pulse stretcher does so a lone frame is seen: frames that come further apart than that blink
//     one by one, frames that follow closer keep it lit. No traffic, no light. Nothing here is random or fixed: the same frames give the same blinks.
// Pure (no Three, no DOM): every jack that shows them (the board's, a card's, the router's in the room and on the studio's wall) takes the levels this gives and sets its lamps.
import type { NetSnap } from '@/worker/game/types';

/** How long one frame lights an activity light, in seconds of the visual clock. */
export const STRETCH = 0.03;
/** The emissive intensity of a lit jack light (a cyan or green light above this blooms to white). */
export const JACK_GLOW = { link: 1.4, act: 1.6 } as const;

/** What the lights need of a snapshot (a `Snapshot` has it all). */
export interface LinkSource {
  baseTick: number;
  powered: boolean;
  power: { tripped: boolean };
  net: Pick<NetSnap, 'port' | 'router' | 'isp' | 'frames'> | null | undefined;
}

/** One jack's two lights, each 0 (out) or 1 (lit). */
export interface JackLevels { link: number; act: number }

/** The three jacks the network lights. `moving`: a light changes by itself (frames blink one by one), so a renderer that draws on demand keeps drawing. */
export interface LinkLevels { pc: JackLevels; lan: JackLevels; wan: JackLevels; moving: boolean }

const OUT: JackLevels = { link: 0, act: 0 };
/** Every light out: no game. */
export const DARK: LinkLevels = { pc: OUT, lan: OUT, wan: OUT, moving: false };

/** Which jacks have a partner on their cable: the PC's uplink (and the router's LAN jack it plugs into) and the router's WAN jack. */
export function linkOf(s: LinkSource | null): { pc: boolean; wan: boolean } {
  const n = s?.net;
  if (!s || !n) return { pc: false, wan: false };
  // (a PHY links with no OS up and no plan: it needs the cable, the router's power and the PC's; a burnt port has no light)
  const pc = n.port.kind !== null && n.port.mbps > 0 && !!n.router && s.powered && !s.power.tripped;
  return { pc, wan: !!n.router && !!n.isp };
}

/** Sets a jack's two lamps from its levels (a lamp is anything with an emissive intensity: a material). */
export function lightJack(j: { link: { emissiveIntensity: number }; act: { emissiveIntensity: number } } | null | undefined, v: JackLevels): void {
  if (!j) return;
  j.link.emissiveIntensity = v.link * JACK_GLOW.link;
  j.act.emissiveIntensity = v.act * JACK_GLOW.act;
}

/**
 * The lights of one game's jacks. Call `step` every frame with the latest snapshot and the visual clock's seconds since the last frame (0 while the game is paused: the
 * lights hold). It reads the frame counter at each new base tick and turns the growth into a rate, frames a tick (a tick is a second of the link), which it holds until the
 * next tick; a snapshot that skips ticks gives the mean rate over them. A new game or a load (the tick or the counter goes back) starts again from what it finds.
 */
export class LinkLeds {
  private tick = Number.NaN;
  private total = 0;
  /** Frames a tick the port carried over the last ticks. */
  private rate = 0;
  /** Where the blinks are: frames since the start of the stretch, as a fraction. */
  private phase = 0;

  /** The rate of frames the port carries now, a tick. */
  get framesPerTick(): number { return this.rate; }

  step(s: LinkSource | null, dt: number): LinkLevels {
    const n = s?.net;
    if (!s || !n) { this.tick = Number.NaN; this.rate = 0; this.phase = 0; return DARK; }
    const total = n.frames.rx + n.frames.tx;
    if (Number.isNaN(this.tick) || s.baseTick < this.tick || total < this.total) { this.tick = s.baseTick; this.total = total; this.rate = 0; this.phase = 0; }
    else if (s.baseTick > this.tick) { this.rate = (total - this.total) / (s.baseTick - this.tick); this.tick = s.baseTick; this.total = total; }
    const link = linkOf(s), rate = link.pc ? this.rate : 0, duty = rate * STRETCH;
    let act = 0, moving = false;
    if (rate <= 0) this.phase = 0;
    else if (duty >= 1) act = 1; // (the frames follow each other closer than a stretch: it stays lit)
    else {
      this.phase = (this.phase + rate * Math.max(0, dt)) % 1;
      act = this.phase < duty ? 1 : 0;
      moving = true;
    }
    const pc: JackLevels = { link: link.pc ? 1 : 0, act };
    return { pc, lan: pc, wan: { link: link.wan ? 1 : 0, act: link.wan ? act : 0 }, moving };
  }
}
