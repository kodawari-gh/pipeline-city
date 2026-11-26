import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { box } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import * as lod from '@/core/render/lod/lod';
import { RectCache } from '@/core/render/lod/lodrect';
import { cardText } from '@/core/render/lod/lodcard';
import * as diepulse from '../../../cpu/render/die/diepulse';
import { FrameMeter } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import { nicGlyphArea, nicLive } from './nicglyph';
import * as niclayout from './niclayout';
import type { NicBlock } from './nicplan';
import * as nicroute from './nicroute';
import { NIC_KIND_COLOR } from './nicart';
import { nicShow } from './nicshow';

// The NIC controller's die, alive (docs/render/net.md "Inside the NIC and the router"). Like the other cards' views (gpu/gpuview.ts, npu/npuview.ts) it runs only what moves; the still die is
// the baked floorplan on the chip's top (nicart.ts). Over the plan it lights the blocks the frames go through, runs a packet along the die's own wires for the frames the port carries
// (nicroute.ts: in from the PHY to the host link, and out the other way), puts the numbers in the blocks (the counters, the rates, the transfers in flight, the heat), and lights the rows
// the symbols give (nicglyph.ts). Everything comes from the snapshot (nicshow.ts): a card with no cable in its jack shows a dark line and no packet; nothing runs by itself.

const TEXT_Z = lod.DEVICE_LOD.nic.text;
/** The largest live text (plan units): the die's numbers are larger than the CPU die's 15, which is drawn bigger. */
const TEXT_CAP = 22;

/** A new card in the scene: its header slot id (`pcie2`), its look and its PCIe slot's number. */
export interface NicScene {
  slot: string;
  visual: string;
  index: number;
}

/** Where the camera is over a die: the zoom (screen pixels per plan unit), the part of the die's frame in view (null: all of it), and whether the die is seen at all (its lid is gone, its card faces the camera). */
export interface NicSight {
  zoom: number;
  view: lod.LodRect | null;
  shown: boolean;
}

interface CardView {
  slot: string;
  geo: niclayout.NicGeo;
  /** The die's plan, at its band of the die frame. */
  root: Container;
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  cellTexts: Map<string, diepulse.CellTexts>;
  packets: diepulse.Packet[];
  trails: Map<string, diepulse.Trail>;
  glow: Map<string, number>;
  /** When the next packet of each way leaves (ms of the view's clock). */
  next: Record<nicroute.NicDir, number>;
  areas: { b: NicBlock; a: Rect }[];
}

export class NicView {
  readonly root = new Container();
  private T: Theme | null = null;
  private cards: CardView[] = [];
  /** What the camera sees of each die (`Chips3D.frame` reads it from each die's own frame: a die turns with its card). */
  private readonly sights = new Map<string, NicSight>();
  private readonly rects = new RectCache();
  private readonly meter = new FrameMeter();
  private snap: Snapshot | null | undefined = undefined;
  /** The view's own clock (ms of game time): packets and lights run on it, and it holds while the game is paused. */
  private now = 0;
  /**
   * A frame leaves a way of a card (its slot, the way, the time on the clock, the ms it takes through the die): the card's copper lights its own runs from the same launch, and answers with the
   * ms its frame takes before it reaches the die, which the die's packets wait (the board's `NicTraceView`). Called whether the die is seen or not: the frames go on at the card's own pace.
   */
  onLaunch?: (slot: string, dir: nicroute.NicDir, at: number, total: number) => number;

  constructor() {
    this.root.visible = false;
  }

  /** The cards of a new scene. */
  setScene(T: Theme, scene: NicScene[]): void {
    this.T = T;
    for (const c of this.cards) {
      for (const ct of c.cellTexts.values()) {
        ct.clear();
      }
    }
    for (const ch of this.root.removeChildren()) {
      ch.destroy({ children: true });
    }
    this.cards = scene.map((s) => this.build(s));
    this.root.visible = this.cards.length > 0;
  }

  private build(s: NicScene): CardView {
    const geo = niclayout.nicGeo(s.visual, s.index),
      root = new Container(),
      bounds = new Graphics();
    root.position.set(geo.origin.x, geo.origin.y);
    // (the view's place is read from its bounds: an invisible rectangle over the plan gives them before anything is lit)
    bounds.rect(0, 0, geo.plan.die.w, geo.plan.die.h).fill({ color: 0x00_00_00, alpha: 0 });
    const glowG = new Graphics(),
      litG = new Graphics(),
      texts = new Container(),
      trailG = new Graphics(),
      packetG = new Graphics();
    root.addChild(bounds, glowG, litG, texts, trailG, packetG);
    this.root.addChild(root);
    const areas = geo.plan.blocks.flatMap((b) => {
      const a = nicGlyphArea(b);
      return a ? [{ b, a }] : [];
    });
    return {
      slot: s.slot,
      geo,
      root,
      glowG,
      litG,
      texts,
      trailG,
      packetG,
      cellTexts: new Map(),
      packets: [],
      trails: new Map(),
      glow: new Map(),
      next: { rx: 0, tx: 0 },
      areas,
    };
  }

  /** The camera's zoom and view over the die of the card in `slot`. */
  setSight(slot: string, sight: NicSight): void {
    this.sights.set(slot, sight);
  }

  /** The view's clock (ms of game time): the clock the launches (`onLaunch`) and the packets run on. */
  get clock(): number {
    return this.now;
  }

  /** The newest snapshot: the frame meter reads its counters. */
  update(s: Snapshot | null | undefined): void {
    if (s === this.snap) {
      return;
    }
    this.snap = s;
    this.meter.feed(s);
  }

  /** Per frame. `dt`: game seconds since the last frame (0 while paused: nothing moves). A die the camera does not see (`setSight`) is not drawn. */
  frame(dt: number, inner: boolean, paused = false): void {
    this.root.visible = inner && this.cards.length > 0;
    if (!this.root.visible || !this.T) {
      return;
    }
    this.now += (paused ? 0 : dt) * 1000;
    const { T } = this;
    for (const c of this.cards) {
      const sight = this.sights.get(c.slot),
        pl = this.rects.place(c, c.root, sight?.view ?? undefined),
        on = pl.onScreen && Boolean(sight?.shown);
      c.root.visible = on;
      const show = nicShow(this.snap, c.slot, this.meter, this.now);
      // (the frames leave at the card's own pace whether the die is seen or not: its copper lights from the same launches)
      if (show) {
        this.fly(T, c, show.link ? { rx: show.rxAct, tx: show.txAct } : { rx: 0, tx: 0 }, on);
      }
      if (!on) {
        continue;
      }
      const z = lod.seenZoom(sight?.zoom ?? 1, pl.focus),
        { showText, ta } = cardText(z, undefined, `nic:${c.slot}`, TEXT_Z, lod.DEVICE_LOD.nic.detail);
      c.texts.visible = showText;
      c.texts.alpha = ta;
      if (!show) {
        c.packets = [];
        c.trails.clear();
        c.litG.clear();
        c.glowG.clear();
        c.trailG.clear();
        c.packetG.clear();
        for (const ct of c.cellTexts.values()) {
          ct.hideFrom(0);
        }
        continue;
      }
      // the blocks the frames go through glow while they do
      const want = new Map<string, number>();
      if (show.link) {
        for (const dir of ['rx', 'tx'] as nicroute.NicDir[]) {
          const act = dir === 'rx' ? show.rxAct : show.txAct;
          if (act > 0) {
            for (const id of nicroute.BLOCKS[dir]) {
              want.set(id, Math.max(want.get(id) ?? 0, act));
            }
          }
        }
      }
      for (const [id, v] of want) {
        c.glow.set(id, (c.glow.get(id) ?? 0) + (v - (c.glow.get(id) ?? 0)) * 0.25);
      }
      for (const [id, v] of c.glow) {
        if (!want.has(id)) {
          const n = v * 0.9;
          if (n < 0.02) {
            c.glow.delete(id);
          } else {
            c.glow.set(id, n);
          }
        }
      }
      const byId = new Map(c.geo.plan.blocks.map((b) => [b.id, b]));
      c.glowG.clear();
      for (const [id, v] of c.glow) {
        const b = byId.get(id);
        if (b) {
          const col = T[NIC_KIND_COLOR[b.kind] === 'mute' ? 'alu' : NIC_KIND_COLOR[b.kind]];
          box(c.glowG, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, {
            fill: col,
            fa: 0.012 * v,
            stroke: col,
            lw: 2,
            sa: 0.4 * v,
          });
        }
      }
      // the symbols' lit parts and numbers
      c.litG.clear();
      const used = new Set<string>();
      for (const { b, a } of c.areas) {
        const live = nicLive(b, a, show, c.geo.plan.input);
        for (const l of live.lit) {
          box(c.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: T[l.color], fa: l.a });
        }
        let ct = c.cellTexts.get(b.id);
        if (!ct) {
          ct = new diepulse.CellTexts(c.texts);
          c.cellTexts.set(b.id, ct);
        }
        used.add(b.id);
        live.texts.forEach((x, n) => ct!.line(n, x.top, x.rect, x.ink ? T.ink : T.on, x.fit, TEXT_CAP));
        ct.hideFrom(live.texts.length);
      }
      for (const [id, ct] of c.cellTexts) {
        if (!used.has(id)) {
          ct.hideFrom(0);
        }
      }
      diepulse.drawTrails(c.trailG, c.trails, this.now, 1);
      c.packets = diepulse.drawPackets(c.packetG, c.packets, this.now, 1, T.ink);
    }
  }

  /**
   * Send a packet along each way that carries frames: the busier the lane (`busy` of the frames a tick, a log scale), the closer the packets follow each other. A way with no frames
   * sends none, so a quiet link shows no motion; the ones sent keep a trail that fades. The card's copper is lit first (`onLaunch`): the packets in the die wait for the frame to reach it.
   * A die that is not seen (`on` false) gets no packets, only the launch.
   */
  private fly(T: Theme, c: CardView, act: Record<nicroute.NicDir, number>, on: boolean): void {
    for (const dir of ['rx', 'tx'] as nicroute.NicDir[]) {
      const a = act[dir];
      if (a <= 0) {
        c.next[dir] = this.now;
        continue;
      }
      if (this.now < c.next[dir] || (on && c.packets.length > 28)) {
        continue;
      }
      c.next[dir] = this.now + 1800 - 1500 * a;
      const total = 1500 - 700 * a,
        lead = this.onLaunch?.(c.slot, dir, this.now, total) ?? 0;
      if (!on) {
        continue;
      }
      const route = nicroute.nicRoute(c.geo.plan, dir),
        sp = (total * 0.9) / route.length,
        dur = Math.max(sp * 1.1, 220);
      route.forEach((h, i) => {
        const { packet, trail } = diepulse.packetOn(
          { id: h.link.id, lanes: h.link.lanes, pts: h.link.pts },
          h.reverse,
          this.now + lead + i * sp,
          dur,
          dir === 'rx' ? T.alu : T.mul,
        );
        c.packets.push(packet);
        c.trails.set(`${h.link.id}:${dir}`, trail);
      });
    }
  }
}
