import { Container, Graphics } from 'pixi.js';
import type { TpmView as TpmSnap } from '../../sim/machine/tpm';
import { box } from '../ink';
import type { Theme } from '../theme';
import { CellTexts, drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../die/diepulse';
import type { Pt, Rect } from '../die/cpuplan';
import { tpmFar, tpmNear, TPM_KIND_COLOR } from '../tpm/tpmart';
import { ENGINE_OF, guardGeom, padlock, tpmGlyphArea, tpmLive, type TpmShow } from '../tpm/tpmglyph';
import { TpmPlayer, REPLAY_HOP_MS } from '../tpm/tpmplayer';
import { tpmRoute } from '../tpm/tpmroute';
import type { TpmBlock } from '../tpm/tpmplan';
import { tpmCover } from './accelart';
import { tpmGeo, type TpmGeo } from './tpmlayout';
import { DEVICE_LOD, seenZoom, smooth, type Candidate, type CardLod, type LodRect } from '../lod';
import { RectCache } from './lodrect';
import { cardCandidates, cardText } from './lodcard';

// The secure module of the board, alive (docs/ACCEL.md "TPM"). Seen from afar it is the lid of a small daughterboard, with a padlock closed on it while
// protected mode is on. Zoomed in, the lid fades away like a card's shroud and the die shows through, drawn in the CPU die's style (tpm/tpmart.ts): the
// registers with the words the CPU wrote, the sequencer on its state, the hash engine counting words, the quote engine's shift register, the sealed
// values in their slots, the bus master on the RAM bus, the range guard with its window on a ruler over RAM. A command runs as packets along the
// die's own routed wires (tpm/tpmroute.ts); one that finished before the player looked is replayed in slow motion (tpm/tpmplayer.ts).

// Zoom levels (board scale: the die is only a few hundred board units across, so they sit above the cards'): the lid fades 1.0 -> 1.8, the traces and
// symbols come with it, the names at 2.2, the second lines at 3.4.
const [FADE_FROM, FADE_TO] = DEVICE_LOD.tpm.fade, TEXT_Z = DEVICE_LOD.tpm.text, DETAIL_Z = DEVICE_LOD.tpm.detail;
/** How long a hop of a live command's packet takes (ms): the module's own phases are far shorter than a frame. */
const LIVE_HOP_MS = 420;

export interface TpmScene { slot: string; visual: string; hdr: Rect }

interface ModuleView {
  slot: string;
  geo: TpmGeo;
  root: Container;
  /** The die in its own units, scaled into the band. */
  die: Container;
  cover: Container;
  /** The padlock on the lid, always there. */
  badge: Graphics;
  glowG: Graphics;
  dyn: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  names: Container;
  subs: Container;
  cellTexts: Map<string, CellTexts>;
  packets: Packet[];
  trails: Map<string, Trail>;
  glow: Map<string, { v: number; color: string }>;
  /** The phase last sent along the wires (command and phase), so a packet leaves once. */
  sent: string;
  /** The glyph areas and symbols' options of the blocks, in die units. */
  areas: { b: TpmBlock; a: Rect }[];
  opt: { stages: number; rounds: number; keys: number };
  player: TpmPlayer;
  sig: string;
  locked: boolean | null;
}

export class TpmView {
  readonly root = new Container();
  private T: Theme | null = null;
  private modules: ModuleView[] = [];
  private zoom = 1;
  private readonly rects = new RectCache();
  /** The replay's own clock (ms): packets and lights run on it. */
  private now = 0;
  private lastWall = 0;

  constructor() {
    this.root.visible = false;
  }

  /** The modules of a new scene. */
  setScene(T: Theme, scene: TpmScene[]): void {
    this.T = T;
    for (const m of this.modules) for (const ct of m.cellTexts.values()) ct.clear();
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.modules = scene.map((s) => this.build(T, s));
    this.root.visible = this.modules.length > 0;
  }

  private build(T: Theme, s: TpmScene): ModuleView {
    const geo = tpmGeo(s.visual, s.hdr), plan = geo.plan, root = new Container(), die = new Container(), plate = new Graphics();
    die.position.set(geo.die.x, geo.die.y);
    die.scale.set(geo.scale);
    tpmFar(plate, T, plan);
    const near = tpmNear(T, plan);
    die.addChild(plate, near.wires, near.cells);
    const glowG = new Graphics(), dyn = new Graphics(), litG = new Graphics(), texts = new Container(), trailG = new Graphics(), packetG = new Graphics();
    die.addChild(glowG, dyn, litG, texts, trailG, packetG, near.names, near.subs);
    const cover = tpmCover(T, s.visual, geo.band), badge = new Graphics();
    root.addChild(die, cover, badge);
    this.root.addChild(root);
    const opt = { stages: plan.input.hashStages, rounds: plan.input.quoteRounds, keys: plan.input.keys };
    const areas = plan.blocks.flatMap((b) => { const a = tpmGlyphArea(b); return a ? [{ b, a }] : []; });
    return {
      slot: s.slot, geo, root, die, cover, badge, glowG, dyn, litG, texts, trailG, packetG, names: near.names, subs: near.subs, cellTexts: new Map(), packets: [], trails: new Map(),
      glow: new Map(), sent: '', areas, opt, player: new TpmPlayer(), sig: '', locked: null,
    };
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The newest snapshot of the module. */
  update(tpm: TpmSnap | undefined): void {
    for (const m of this.modules) m.player.feed(tpm);
  }

  /** The modules in view that want their counters, for the detail budget (live.ts). */
  candidates(view: LodRect): Candidate[] {
    return cardCandidates('tpm', this.modules, this.rects, view, this.zoom, DETAIL_Z);
  }

  /** Per frame. `inner` is false while the case's exterior covers the board (nothing to draw). `lod`: the view, and who may show counters; a module out of view is not drawn. */
  frame(dt: number, inner: boolean, paused = false, lod?: CardLod): void {
    this.root.visible = inner && this.modules.length > 0;
    if (!this.root.visible || !this.T) return;
    // a paused game has no game time, but a replay still plays: it runs on the wall clock then
    const wall = performance.now(), wdt = Math.min(0.1, Math.max(0, (wall - this.lastWall) / 1000));
    this.lastWall = wall;
    const step = (paused ? wdt : dt) * 1000;
    this.now += step;
    const T = this.T;
    for (const m of this.modules) {
      m.player.advance(step);
      const show = m.player.show(this.now);
      this.lockBadge(T, m, show);
      const pl = this.rects.place(m, m.root, lod?.view), on = pl.onScreen, z = seenZoom(this.zoom, pl.size, pl.focus), fade = smooth(FADE_FROM, FADE_TO, z);
      m.root.visible = on;
      m.badge.alpha = m.cover.alpha = 1 - fade;
      m.die.alpha = fade;
      m.die.visible = fade > 0.02;
      if (!m.die.visible || !on) continue;
      const { ta, da, showText, showDetail } = cardText(z, lod, `tpm:${m.slot}`, TEXT_Z, DETAIL_Z);
      m.names.visible = m.texts.visible = showText;
      m.names.alpha = m.texts.alpha = ta;
      m.subs.visible = showDetail;
      m.subs.alpha = da;
      this.animate(T, m, show);
      const sig = `${show ? `${show.phase}|${Math.round(show.progress * 40)}|${show.cmd}|${show.hashed}|${show.result}|${show.fault}|${show.range ? `${show.range.lo}-${show.range.hi}` : '-'}|${show.sealed.length}|${show.guardedAccesses}|${show.done ? 1 : 0}` : '-'}|${Math.floor(this.now / (show?.busy ? 70 : 160))}|${showText ? 1 : 0}${showDetail ? 1 : 0}`;
      if (sig === m.sig) continue;
      m.sig = sig;
      this.draw(T, m, show);
    }
  }

  /** The padlock on the lid: closed (and red) while protected mode is on, open and dim when it is not. */
  private lockBadge(T: Theme, m: ModuleView, show: TpmShow | null): void {
    const locked = !!show?.range;
    if (m.locked === locked) return;
    m.locked = locked;
    const b = m.geo.band, g = m.badge;
    g.clear();
    box(g, b.x + b.w - 62, b.y + b.h / 2 - 24, 44, 52, 5, { fill: T.dark ? '#0b101c' : '#1d2536' });
    padlock(g, b.x + b.w - 40, b.y + b.h / 2 + 4, 30, locked, locked ? T.bad : T.mute, T.dark ? '#0b101c' : '#1d2536');
  }

  /** Send the phase the command has reached along its route: a packet on each wire in turn, in the colour of the phase (once per phase). */
  private fly(m: ModuleView, show: TpmShow): void {
    const phase = show.phase;
    if (phase === 'idle') { m.sent = ''; return; }
    const key = `${m.player.token}:${phase}`;
    if (m.sent === key) return;
    m.sent = key;
    const route = tpmRoute(m.geo.plan, show.cmd, phase);
    if (route.length === 0) return;
    const T = this.T!, engine = ENGINE_OF[show.cmd], kind = engine ? m.geo.plan.blocks.find((b) => b.id === engine)?.kind : undefined;
    const color = phase === 'in' ? T.alu : phase === 'out' ? T.st : T[TPM_KIND_COLOR[kind ?? 'seq']];
    const total = show.replay ? REPLAY_HOP_MS : LIVE_HOP_MS, sp = (total * 0.9) / route.length, dur = Math.max(sp * 1.1, 200);
    route.forEach((h, i) => {
      const o = { id: h.link.id, lanes: h.link.lanes, pts: h.link.pts as Pt[] };
      const { packet, trail } = packetOn(o, h.reverse, this.now + i * sp, dur, color);
      m.packets.push(packet);
      m.trails.set(h.link.id, trail);
    });
  }

  /** The blocks the command is in right now. */
  private active(show: TpmShow | null): Map<string, number> {
    const out = new Map<string, number>();
    if (!show || show.phase === 'idle') return out;
    const engine = ENGINE_OF[show.cmd];
    if (show.phase === 'in' || show.phase === 'out') { out.set('lpc', 1); out.set('regs', 1); if (show.phase === 'out' && engine) out.set(engine, 0.5); }
    out.set('seq', 1);
    if (show.phase === 'work' && engine) { out.set(engine, 1); if (engine === 'hash') out.set('ramport', 1); }
    return out;
  }

  /** The moving parts: packets on the wires, the glow of the blocks the command is in, the lit parts and digits of the symbols. */
  private animate(T: Theme, m: ModuleView, show: TpmShow | null): void {
    const now = this.now;
    if (!show) { m.packets = []; m.trails.clear(); m.sent = ''; } else this.fly(m, show);
    const want = this.active(show);
    for (const [id, k] of want) m.glow.set(id, { v: Math.min(1, (m.glow.get(id)?.v ?? 0) + 0.25 * k), color: T[TPM_KIND_COLOR[m.geo.plan.blocks.find((b) => b.id === id)!.kind]] });
    for (const [id, g] of m.glow) if (!want.has(id)) { g.v *= 0.9; if (g.v < 0.02) m.glow.delete(id); }
    const lit: { rect: Rect; color: string; a: number }[] = [], used = new Set<string>();
    if (show) {
      for (const { b, a } of m.areas) {
        const live = tpmLive(b, a, show, m.opt);
        for (const l of live.lit) lit.push({ rect: l.rect, color: T[l.color], a: l.a });
        let ct = m.cellTexts.get(b.id);
        if (!ct) { ct = new CellTexts(m.texts); m.cellTexts.set(b.id, ct); }
        used.add(b.id);
        live.texts.forEach((x, n) => ct!.line(n, x.top, x.rect, x.ink ? T.ink : T.on, x.fit));
        ct.hideFrom(live.texts.length);
      }
    }
    for (const [id, ct] of m.cellTexts) if (!used.has(id)) ct.hideFrom(0);
    const byId = new Map(m.geo.plan.blocks.map((b) => [b.id, b]));
    const gg = m.glowG;
    gg.clear();
    for (const [id, g] of m.glow) {
      const b = byId.get(id);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: g.color, fa: 0.14 * g.v, stroke: g.color, lw: 2.5, sa: 0.55 * g.v });
    }
    m.litG.clear();
    for (const l of lit) box(m.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: l.color, fa: l.a });
    drawTrails(m.trailG, m.trails, now, 1);
    m.packets = drawPackets(m.packetG, m.packets, now, 1, T.ink);
  }

  /** The padlock of the range guard, in the die: closed over the window while protected mode is on. */
  private draw(T: Theme, m: ModuleView, show: TpmShow | null): void {
    const g = m.dyn;
    g.clear();
    const guard = m.geo.plan.blocks.find((b) => b.kind === 'guard'), a = guard && tpmGlyphArea(guard);
    if (!guard || !a) return;
    const q = guardGeom(a), locked = !!show?.range;
    g.circle(q.lock.cx, q.lock.cy, q.lock.s * 0.7).fill({ color: T.die, alpha: 0.9 });
    padlock(g, q.lock.cx, q.lock.cy, q.lock.s, locked, locked ? T.bad : T.mute, T.die);
  }
}
