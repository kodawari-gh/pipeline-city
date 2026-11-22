// The NIC's copper, alive (docs/render/net.md "Inside the NIC and the router"): the lit lanes of `nicLanes` run by the board's own `BusFlow` (wiring/busflow.ts), so a frame on the card's traces is a
// packet with its trail, as on the motherboard's. It runs only what moves, and only on the frames the die's view launches (`NicView.onLaunch`: the same real counters, `nicshow.ts`, the same pace),
// so the copper and the die are one trip: a frame that comes in from the cable runs the jack's pairs, then goes through the die; one the host sends runs the slot's pairs, goes through the die,
// then runs the jack's pairs out. A card with no frames lights nothing. The picture is drawn on a plane over the card's component side by `Chips3D` (kind 'nictrace').
import { Container } from 'pixi.js';
import type { Theme } from '@/core/render/theme';
import type { NicDir } from '@/features/network/render/nic/nicroute';
import { BusFlow, tripMs } from '../wiring/busflow';
import type { NicLanes } from './nicflow';

/** How wide a lit run is drawn (layout units): a hair wider than the 4-unit copper, so the light shows round it. */
export const LIT_W = 5;
/** The least time between two packets of one bus of a card (ms of the view's clock). */
const PULSE_GAP = 140;

/** Where the camera is over a card's copper: the zoom (screen pixels per layout unit) and whether the face is seen at all. */
export interface TraceSight { zoom: number; shown: boolean }

interface Card { lanes: NicLanes; flow: BusFlow; sight: TraceSight; /** When each bus last had a packet (the view's clock). */ last: { host: number; mem: number } }

export class NicTraceView {
  readonly root = new Container();
  private T: Theme | null = null;
  private cards = new Map<string, Card>();
  /** The clock of the last frame (`frame`): a packet told of between frames leaves at it. */
  private clock = 0;

  /** A new scene: the old cards' copper goes (each card brings its lanes again, `add`). */
  setScene(T: Theme): void {
    this.T = T;
    this.clear();
  }

  clear(): void {
    this.cards.clear();
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
  }

  /** A card's lanes: its lit runs live in the shared drawing from now on. */
  add(slot: string, lanes: NicLanes): void {
    const flow = new BusFlow();
    this.root.addChild(flow.g);
    this.cards.set(slot, { lanes, flow, sight: { zoom: 1, shown: false }, last: { host: -1e9, mem: -1e9 } });
  }

  /** How long the copper before the die takes (ms) for frames going `dir`: the jack's pairs for one that comes in from the cable, the slot's for one the host sends. 0 for a card with none. */
  lead(slot: string, dir: NicDir): number {
    const c = this.cards.get(slot);
    return c ? tripMs(dir === 'rx' ? c.lanes.media : c.lanes.host) : 0;
  }

  /**
   * A frame leaves at game time `at` and takes `total` ms in the die (`NicView.fly`). It comes in from the cable (`rx`): the jack's pairs run toward the controller. The host sends it (`tx`): the slot's
   * pairs run toward the controller, and once the die has passed it the jack's pairs run out. Returns how long the copper before the die takes, which the die's packets wait.
   */
  launch(slot: string, dir: NicDir, at: number, total: number): number {
    const c = this.cards.get(slot), T = this.T;
    if (!c || !T) return 0;
    const lead = this.lead(slot, dir);
    if (dir === 'rx') c.flow.send(c.lanes.media, 1, T.alu, at, LIT_W);
    else {
      c.flow.send(c.lanes.host, 1, T.mul, at, LIT_W);
      c.flow.send(c.lanes.media, -1, T.mul, at, LIT_W, lead + total);
    }
    return lead;
  }

  /**
   * A graphics card's or an AI card's bus moves a word (the die's view told of it: `GpuView.onTraffic`, `NpuCardView.onTraffic`): a packet runs the slot's receive lines (`host`: `dir` 1 from the fingers to the die, -1 back)
   * or the memory bus (`mem`: 1 from the die to the memory, -1 back). A bus has a packet at most every `PULSE_GAP` ms, so a busy card shows a stream, not a wall.
   */
  pulse(slot: string, bus: 'host' | 'mem', dir: 1 | -1): void {
    const c = this.cards.get(slot), T = this.T;
    if (!c || !T || !c.sight.shown || this.clock - c.last[bus] < PULSE_GAP) return;
    c.last[bus] = this.clock;
    const lanes = bus === 'host' ? c.lanes.host : c.lanes.media;
    if (lanes.length) c.flow.send(lanes, dir, bus === 'host' ? (dir > 0 ? T.alu : T.st) : dir > 0 ? T.st : T.ld, this.clock, LIT_W);
  }

  /** The camera's zoom and view over the card's copper (`Chips3D.frame` reads it from the card's own frame: the card folds down). */
  setSight(slot: string, sight: TraceSight): void {
    const c = this.cards.get(slot);
    if (c) c.sight = sight;
  }

  /** Whether a card's copper has a packet on it (or one due): a quiet card has nothing to draw. */
  busy(slot: string): boolean {
    return this.cards.get(slot)?.flow.busy ?? false;
  }

  /** Per frame, at the view's clock `now` (game ms: it holds while the game is paused, so the packets do). A card that is not seen only lets its packets age. */
  frame(now: number): void {
    this.clock = now;
    for (const c of this.cards.values()) c.flow.frame(now, c.sight.zoom, c.sight.shown);
  }
}
