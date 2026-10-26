import { Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import { getSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/protocol';
import type { KeyActivity } from '../sim/game/game';
import { blades } from './devices';
import { HEAD, box, label, mix, MONO } from './ink';
import { drawDriveLive, type DriveKind } from './drives';
import { BD, BR, dramPhase, MONITOR, MONITOR_K, PKG, PSU_PANEL, RAM_SINK, SCREEN, SCREEN_D, USB_PORT, VRM_LED, VRM_SINK, vrmPhase, type Rect } from './layout';
import { monitorView, standbyLook, type MonitorInput } from './monitor';
import { EdgeFan } from './case';
import { DECOR_BUSES, pointAt, type Lane, type Bus, type BusKind, type Cable, type CableKind } from './routes';
import type { Theme } from './theme';

/** Per-device rectangle the glow is drawn around, keyed by device id (set by the scene). */
export interface GlowTarget { id: string; kind: string; spec: string; rect: Rect }

interface Glow { t: GlowTarget; g: Graphics; dim: Graphics; base: number; level: number }
interface Lit { bus: Bus; /** The lanes that light (the main run plus the branches of the installed DIMMs). */ lanes: Lane[]; g: Graphics; level: number; hold: number; dir: number; color: string; alwaysOn: boolean; pulses: number }
/** An installed drive: where its moving parts are drawn, its SATA data cable lane (SATA only) and its activity state. */
export interface DriveHook { slot: string; kind: DriveKind; g: Graphics; lane: Lane | null }
interface DriveLive extends DriveHook {
  glow: Graphics; busyUntil: number; flowUntil: number; speed: number; spin: number; head: number; led: number; level: number; dir: number; sig: string; burnt: boolean;
}
interface LitCable { cable: Cable; g: Graphics; level: number; target: number; color: string }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** The PSU panel is a dark LCD in both themes, so its text uses fixed light inks. */
const LCD_INK = '#dbe5ff', LCD_MUTE = '#8d9bc4';
/** OS status screen: row count, font size and line height in world units (readable at overview zoom). */
const OS_INK = '#7dffb0', OS_DIM = '#52a981', OS_RULE = '#2f5a46', OS_AMBER = '#ffc247', OS_CYAN = '#4fe3ff';
const OS_ROWS = 10, OS_FONT = 118, OS_LINE = 150, OS_COLS = 42;
const LOADS = new Set(['lw', 'lb', 'lbu']);
const STORES = new Set(['sw', 'sb']);

/** Time a bus stays lit after an event (ms). */
const HOLD: Partial<Record<BusKind, number>> = { mem: 900, nvme: 1600, dmi: 1300, video: 1100, usb: 1000, sata: 1000, pcie: 1000 };

/**
 * Everything that changes with the sim. The board is dim by default; a bus only lights when the snapshot shows real
 * traffic on it (see `docs/RENDER.md`, "Activity"). Power conductors glow in proportion to current. Per-snapshot work
 * redraws a few small Graphics and Texts, per-frame work moves pooled sprites and rotates fans.
 */
export class Live {
  /** Interior art on top of the board (buses, cable glow, PSU readout, drives, OS badge). Hidden with the interior at far zoom. */
  readonly root = new Container();
  /** External things that stay at any zoom: the monitor screen content, the USB port LED, the monitor LED, the video cable glow. */
  readonly ext = new Container();
  private extG = new Graphics();
  private extDots: Sprite[] = [];
  private interior = true;
  private pchDrawn = false;
  /** The VRM: per-phase glow, power-good light, crash flash (vrmG); the dead-board dimming and scorch (deadG). */
  private vrmG = new Graphics();
  private deadG = new Graphics();
  private vrm: Snapshot['board']['vrm'] | null = null;
  /** The memory VRM, and whether the last fault flash was its crash. */
  private ramVrm: Snapshot['board']['ramVrm'] | null = null;
  private flashRam = false;
  private dead = false;
  private deadDrawn = false;
  /** Wall time (ms) the crash flash started. Flashes fade by wall time so a paused frame never shows one stuck on screen. */
  private vrmFlashAt = -1e9;
  private lastFault: string | null = null;
  private glows = new Map<string, Glow>();
  private fans: { c: Container; kind: string; speed: number; target: number }[] = [];
  private dots: Sprite[] = [];
  private dotTex: Texture;
  private lit = new Map<BusKind, Lit>();
  private cables: LitCable[] = [];
  private badge: Text;
  private screenText: Text;
  private gauge = new Graphics();
  private psuTexts: Record<'load' | 'of' | 'pct' | 'temp' | 'state' | 'rpm', Text>;
  private panelFan = new Container();
  private dramFlash = new Graphics();
  private dramChips: Rect[] = [];
  /** Wall time (ms) of the last memory-bus event: the DRAM flash fades by wall time (see `memAt` for the game-time trigger). */
  private memWall = -1e9;
  private phase = 0;
  private lastMisses = 0;
  private lastCycles = 0;
  private lastStall = 0;
  private lastText = '';
  private lastReq = -1;
  private cpuHeat = 0;
  private clockRatio = 1;
  private shownText = '\u0000';
  private zoom = 0.1;
  private hasPsu = false;
  private psuTemp = 25;
  private psuRatio = 0;
  private psuOff = true;
  private psuTripped = false;
  private psuW = 0;
  private psuBudget = 0;
  private memAt = -1e9;
  private connected = new Set<CableKind>();
  private plugged = false;
  private bootPhase: Snapshot['phase'] = 'off';
  private bootProgress = 0;
  private monitorLive = false;
  private powered = false;
  /** Machine switched on AND the power path is healthy (PSU not tripped, board not dead): fans spin, lights glow, buses move data. */
  private liveOn = false;
  private hasDisplay = false;
  /** PCH, USB LED, monitor LED and boot bar: redrawn every frame while something is active. */
  private bootG = new Graphics();
  private noSignal: Text;
  /** The blank screen's look (`standbyLook`): dim glass with the brand's mark, and `STANDBY` while the machine is off. */
  private standby = new Container();
  private standbyCap: Text | null = null;
  private blank: MonitorInput | null = null;
  private pchLevel = 0;
  private lastBootDraw = '';
  private T!: Theme;
  /** Drives (activity, platter, LEDs) and their SATA cable pulses, keyed by slot id. */
  private drives = new Map<string, DriveLive>();
  /** 0..1: how lit the case's disk activity LED is (read by board.ts every frame). */
  diskLevel = 0;
  private keyActivity: KeyActivity = 'none';
  private osRows: Text[] = [];
  /** The monitor screen's contents (text, OS screen), in design units; scaled and placed in `setScene`. */
  private scr = new Container();
  private badgeG = new Graphics();
  private badgeText: Text | null = null;
  private badgeRect: Rect | null = null;
  private badgePhase: Snapshot['phase'] | 'off' = 'off';
  private osG = new Graphics();
  private osSig = '';
  private osOn = false;
  private osJob: 'none' | 'run' | 'ingest' | 'flash' = 'none';
  private osUpTick: number | null = null;
  private bootLike = false;
  /** Cold-boot wait: posting with no POST line yet (the CPU idles, the monitor is black). */
  private coldWait = false;

  constructor(renderer: Renderer, private additive: boolean) {
    const dg = new Graphics().circle(0, 0, 16).fill({ color: '#ffffff' });
    this.dotTex = renderer.generateTexture(dg);
    dg.destroy();
    this.badge = new Text({ text: '', style: { fontFamily: MONO, fontSize: 70, fontWeight: '700', fill: '#ffffff' }, resolution: 2 });
    this.badge.anchor.set(0.5, 0.5);
    this.screenText = new Text({
      text: '', style: { fontFamily: MONO, fontSize: 150, lineHeight: 190, fill: '#ffffff', fontWeight: '500' }, resolution: 2,
    });
    this.screenText.position.set(90, 70);
    this.noSignal = new Text({ text: 'NO SIGNAL', style: { fontFamily: HEAD, fontSize: 220, fontWeight: '700', fill: '#5d6a8f' }, resolution: 2 });
    this.noSignal.anchor.set(0.5, 0.5);
    this.noSignal.position.set(SCREEN_D.w / 2, SCREEN_D.h / 2);
    const mkText = (size: number, head = false, right = false) => {
      const t = new Text({ text: '', style: { fontFamily: head ? HEAD : MONO, fontSize: size, fontWeight: '700', fill: '#ffffff' }, resolution: 2 });
      t.anchor.set(right ? 1 : 0, 0.5);
      return t;
    };
    this.psuTexts = { load: mkText(250, true), of: mkText(80), pct: mkText(80, true, true), temp: mkText(170, true), state: mkText(64, true), rpm: mkText(76, true) };
    const pf = new Graphics();
    blades(pf, 5, 22, 120, '#ffffff', '#ffffff', 4);
    this.panelFan.addChild(pf);
    this.placePsuTexts();
  }

  /** Put the PSU readout texts on the panel of the current tier (the panel moves with the board's height). */
  private placePsuTexts() {
    const p = PSU_PANEL;
    this.psuTexts.load.position.set(p.x + 50, p.y + 290);
    this.psuTexts.of.position.set(p.x + 50, p.y + 475);
    this.psuTexts.pct.position.set(p.x + 1100, p.y + 475);
    this.psuTexts.temp.position.set(p.x + 1190, p.y + 290);
    this.psuTexts.state.position.set(p.x + 1190, p.y + 475);
    this.psuTexts.rpm.position.set(p.x + 1660, p.y + 475);
    this.panelFan.position.set(p.x + 1890, p.y + 285);
  }

  /** (Re)build live objects for a scene. Called when the theme or the installed set changes. */
  setScene(
    T: Theme, targets: GlowTarget[], buses: Bus[], cables: Cable[], fans: { c: Container; kind: string }[], dramChips: Rect[], dimms: number[],
    flags: { psu: boolean; display: boolean }, drives: DriveHook[] = [],
  ) {
    this.T = T;
    this.placePsuTexts();
    const keep = new Set<unknown>([this.scr, this.vrmG, this.deadG, this.badgeG, this.badgeText, this.badge, this.screenText, this.noSignal, this.osG, ...this.osRows, this.bootG, this.extG, this.gauge, this.dramFlash, this.panelFan, ...Object.values(this.psuTexts)]);
    for (const ch of this.root.removeChildren()) if (!keep.has(ch)) ch.destroy({ children: true });
    for (const ch of this.ext.removeChildren()) if (!keep.has(ch)) ch.destroy({ children: true });
    this.extDots = [];
    this.root.addChild(this.deadG);
    this.deadDrawn = false;
    this.glows.clear(); this.lit.clear(); this.cables = [];
    this.dots = [];
    this.hasPsu = flags.psu;
    this.fans = fans.map((f) => ({ ...f, speed: 0, target: 0 }));
    this.dramChips = dramChips;
    for (const t of targets) {
      const g = new Graphics(), dim = new Graphics();
      if (this.additive) g.blendMode = 'add';
      this.root.addChild(g, dim);
      this.glows.set(t.id, { t, g, dim, base: 0, level: 0 });
    }
    const colorOf = (id: BusKind): string => {
      switch (id) {
        case 'mem': return T.alu;
        case 'nvme': case 'dmi': case 'sata': case 'usb': return T.mul;
        case 'video': return T.st;
        case 'pcie': return T.br;
        default: return T.ld;
      }
    };
    let nDots = 0;
    for (const bus of buses) {
      if ((bus.id === 'video') && !flags.display) continue;
      if (DECOR_BUSES.includes(bus.id)) continue; // decoration: never lit
      const power = bus.id === 'pwr12' || bus.id === 'pwrcpu' || bus.id === 'vdimm' || bus.id === 'vcore';
      const g = new Graphics();
      if (this.additive) g.blendMode = 'add';
      const lanes = bus.lanes.concat(bus.taps ? bus.taps.filter((t) => dimms.includes(Number(t.key.slice(4)))).flatMap((t) => t.lanes) : []);
      for (const l of lanes) { g.moveTo(l.pts[0]![0], l.pts[0]![1]); for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]); }
      g.stroke({ width: bus.w * (power ? 0.7 : 1.15), color: colorOf(bus.id), alpha: 1, cap: 'round', join: 'round' });
      g.alpha = 0;
      this.root.addChild(g);
      const pulses = power ? 0 : lanes.reduce((a, l) => a + Math.max(1, Math.min(3, Math.round(l.len / 900))), 0);
      nDots += pulses;
      this.lit.set(bus.id, { bus, lanes, g, level: 0, hold: 0, dir: 1, color: colorOf(bus.id), alwaysOn: false, pulses });
    }
    for (const cable of cables) {
      const g = new Graphics();
      if (this.additive) g.blendMode = 'add';
      // the glow stops where the plugs begin (plugs are drawn under the live layer)
      const pts = cable.path.pts.filter((_, i, a) => {
        let d = 0;
        for (let j = 1; j <= i; j++) d += Math.hypot(a[j]![0] - a[j - 1]![0], a[j]![1] - a[j - 1]![1]);
        return d >= 50 && cable.path.len - d >= 50;
      });
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
      const color = cable.kind === 'video' ? T.st : cable.kind === 'atx' ? T.ld : cable.kind === 'cpu' ? T.alu : T.br;
      g.stroke({ width: cable.w * 0.34, color, alpha: 1, cap: 'butt', join: 'round' });
      g.alpha = 0;
      // the video cable runs outside the case: its glow and pulses live in the always-visible layer
      if (cable.kind === 'video') this.ext.addChild(g); else { this.root.addChild(g); nDots += 3; }
      this.cables.push({ cable, g, level: 0, target: 0, color });
    }
    this.drives.clear();
    for (const d of drives) {
      const glow = new Graphics();
      if (this.additive) glow.blendMode = 'add';
      if (d.lane) {
        glow.moveTo(d.lane.pts[0]![0], d.lane.pts[0]![1]);
        for (let i = 1; i < d.lane.pts.length; i++) glow.lineTo(d.lane.pts[i]![0], d.lane.pts[i]![1]);
        glow.stroke({ width: 12, color: T.mul, alpha: 1, cap: 'round', join: 'round' });
        nDots += 4;
      }
      glow.alpha = 0;
      this.root.addChild(glow);
      this.drives.set(d.slot, { ...d, glow, busyUntil: -1e9, flowUntil: -1e9, speed: 0, spin: 0.6, head: 0, led: 0, level: 0, dir: 1, sig: '', burnt: false });
    }
    this.root.addChild(this.dramFlash);
    for (let i = 0; i < nDots; i++) {
      const s = new Sprite(this.dotTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.dots.push(s);
      this.root.addChild(s);
    }
    if (!this.badgeText) this.badgeText = new Text({ text: 'OS', style: { fontFamily: HEAD, fontSize: 44, fontWeight: '700', fill: '#ffffff' }, resolution: 2 });
    this.badgeText.anchor.set(0, 0.5);
    this.root.addChild(this.vrmG, this.badgeG, this.badgeText);
    this.root.addChild(this.bootG, this.gauge, this.badge, this.panelFan, ...Object.values(this.psuTexts));
    if (cables.some((c) => c.kind === 'video')) for (let i = 0; i < 3; i++) {
      const sp = new Sprite(this.dotTex);
      sp.anchor.set(0.5); sp.visible = false;
      this.extDots.push(sp); this.ext.addChild(sp);
    }
    // the screen's contents are laid out at the design size inside a container scaled onto the (bigger) monitor
    this.scr.removeChildren();
    this.buildStandby(T);
    this.scr.addChild(this.standby, this.screenText, this.osG, ...this.osRowsFor(), this.noSignal);
    this.scr.position.set(SCREEN.x, SCREEN.y); this.scr.scale.set(MONITOR_K);
    this.ext.addChild(this.extG, this.scr);
    const showPsu = flags.psu;
    for (const t of Object.values(this.psuTexts)) t.visible = showPsu;
    this.panelFan.visible = showPsu;
    this.screenText.visible = flags.display;
    this.osSig = '\u0000'; this.osOn = false; this.osG.visible = false;
    for (const t of this.osRows) t.visible = false;
    this.hasDisplay = flags.display;
    this.noSignal.visible = false;
    this.screenText.style.fill = T.st;
    this.badge.position.set(0, PKG.y - 160);
    this.shownText = '\u0000';
    this.panelFan.children.forEach((c) => { (c as Graphics).tint = LCD_MUTE; });
    this.psuTexts.of.style.fill = LCD_MUTE;
    this.psuTexts.rpm.style.fill = LCD_INK;
  }

  /** The blank screen's art, at the screen's design size: a faint light in the glass, the skyline mark of the chin made large, the brand and, while off, `STANDBY`. */
  private buildStandby(T: Theme) {
    for (const c of this.standby.removeChildren()) c.destroy({ children: true });
    const g = new Graphics(), W = SCREEN_D.w, H = SCREEN_D.h, cx = W / 2, cy = H / 2;
    for (let k = 0; k < 7; k++) g.ellipse(cx, cy, W * 0.5 * (1 - k / 8), H * 0.5 * (1 - k / 8)).fill({ color: T.dark ? '#1a2a4a' : '#2a3d63', alpha: 0.05 });
    for (const [i, hh] of [80, 136, 104, 160, 88].entries()) g.rect(cx - 140 + i * 56, cy - 40 - hh, 38, hh).fill({ color: T.mute, alpha: 0.5 });
    this.standbyCap = label('STANDBY', cx, cy + 330, 64, T.mute, { head: true, anchor: [0.5, 0.5], a: 0.65 });
    this.standby.addChild(g, label('PIPELINE CITY', cx, cy + 100, 130, T.mute, { head: true, anchor: [0.5, 0.5], a: 0.45 }), this.standbyCap);
    this.standby.visible = false;
  }

  /** The blank screen: dim glass with the mark instead of a black slab (still: it is a screen that is off, not an animation). */
  private frameStandby() {
    const k = this.blank ? standbyLook(this.blank, monitorView(this.blank), this.osOn) : null;
    this.standby.visible = k !== null;
    if (k === null) return;
    if (this.standbyCap) this.standbyCap.visible = k === 'off';
  }

  /** The pooled rows of the OS screen (created on first use). */
  private osRowsFor(): Text[] {
    if (!this.osRows.length) {
      for (let i = 0; i < OS_ROWS; i++) {
        const t = new Text({ text: '', style: { fontFamily: MONO, fontSize: OS_FONT, fontWeight: '600', fill: '#ffffff' }, resolution: 2 });
        t.position.set(90, 56 + i * OS_LINE);
        t.visible = false;
        this.osRows.push(t);
      }
    }
    return this.osRows;
  }

  /** The OS badge on the host drive (null: no OS). The dot animates on the game clock in `frame`. */
  setOsBadge(r: Rect | null, phase: Snapshot['phase'] | 'off') { this.badgeRect = r; this.badgePhase = phase; }

  setZoom(z: number) { this.zoom = z; }
  /** False while the exterior covers the interior: the per-frame interior work (buses, pulses, drive art, PSU panel) is skipped. */
  setInterior(on: boolean) { this.interior = on; }
  /** Which cables are plugged in right now (an unplugged cable shows no glow or pulses). */
  setConnected(c: Set<CableKind>) { this.connected = c; }
  setPlugged(p: boolean) { this.plugged = p; }

  /** Keep a bus lit for a boot phase (re-armed on every snapshot, so it fades about 1.6 s after the phase ends). */
  private flow(id: BusKind, now: number, dir: number) {
    const l = this.lit.get(id);
    if (!l) return;
    l.hold = Math.max(l.hold, now + 1700);
    l.dir = dir;
  }

  /** Light the bus (and SATA cable) that serves a drive slot. `busy` also keeps the platter / LEDs going. */
  private driveFlow(slot: string, now: number, toDrive: boolean, busy = false) {
    const m2 = slot.startsWith('m2');
    this.trigger(m2 ? 'nvme' : 'sata', now, toDrive ? 1 : -1);
    const dr = this.drives.get(slot);
    if (!dr) return;
    dr.flowUntil = Math.max(dr.flowUntil, now + 1500);
    if (busy) dr.busyUntil = Math.max(dr.busyUntil, now + 900);
    dr.dir = toDrive ? -1 : 1; // the cable lane runs drive -> board
  }

  private trigger(id: BusKind, now: number, dir = 1) {
    const l = this.lit.get(id);
    if (!l) return;
    l.hold = now + (HOLD[id] ?? 1000);
    l.dir = dir;
  }

  /** Per-snapshot update. `s` may be null before the sim has started. */
  update(s: Snapshot | null, now: number) {
    const T = this.T;
    if (!s) return;
    const cpu = s.devices.find((d) => d.kind === 'cpu');
    const running = !!s.request && !!cpu && !cpu.burnt && !s.power.off && !s.power.tripped && cpu.effectiveClock > 0;
    const spec = cpu && getSpec(cpu.spec);
    this.clockRatio = cpu && spec?.clock ? clamp(cpu.effectiveClock / spec.clock.base, 0.25, 3) : 1;
    this.cpuHeat = cpu ? clamp((cpu.tempC - 35) / 55) : 0;

    // ---- activity: only real traffic lights a bus ----
    const c = s.counters, misses = c.cacheMisses ?? 0, stall = c.stallCache ?? 0, cycles = c.cycles ?? 0;
    if (cycles < this.lastCycles) { this.lastMisses = 0; this.lastStall = 0; } // a new attempt
    const missed = misses > this.lastMisses || stall > this.lastStall;
    this.lastMisses = misses; this.lastStall = stall; this.lastCycles = cycles;
    const mem = s.pipe?.stages[3];
    const op = mem && mem.kind === 1 ? mem.op : '';
    if (running) {
      if (missed || LOADS.has(op) && !!mem && mem.stalled) { this.memAt = now; this.memWall = performance.now(); this.trigger('mem', now, -1); } // miss: RAM answers the CPU
      else if (STORES.has(op)) { this.memAt = now; this.memWall = performance.now(); this.trigger('mem', now, 1); } // stores always go out to RAM
    }
    const reqId = s.request?.id ?? -1;
    if (reqId !== this.lastReq) {
      if (reqId >= 0) this.trigger('dmi', now, -1); // program handed to the CPU
      else if (this.lastReq >= 0) this.trigger('dmi', now, 1); // request finished
      this.lastReq = reqId;
    }
    const shown = s.display || '';
    if (shown !== this.lastText) {
      if (shown && s.monitorLive) { this.trigger('video', now, 1); this.trigger('dmi', now, 1); }
      this.lastText = shown;
    }
    // boot: data moves USB port <-> PCH <-> CPU <-> RAM along the real buses (only in the phases that move data)
    this.bootPhase = s.phase; this.bootProgress = s.bootProgress; this.monitorLive = s.monitorLive; this.powered = s.powered;
    // the cold-boot wait (posting, before the first POST line: no progress yet) is the CPU idling: nothing is read yet
    const coldWait = s.phase === 'posting' && !(s.bootProgress > 0);
    this.coldWait = coldWait;
    if (s.powered) {
      if (s.phase === 'posting') { if (!coldWait) this.flow('dmi', now, Math.floor(now / 1100) % 2 ? 1 : -1); }
      else if (s.phase === 'loading') { this.flow('usb', now, -1); this.flow('dmi', now, -1); this.flow('mem', now, 1); }
      else if (s.phase === 'writing') { this.flow('mem', now, -1); this.flow('dmi', now, 1); this.flow('usb', now, 1); }
      else if (s.phase === 'booting-os' || s.phase === 'ingesting' || s.phase === 'flashing') {
        // OS flows on the real routes. Drive side: booting reads the kernel (drive -> RAM/CPU), ingesting writes the key's job to the
        // spool (key -> drive), flashing reads the result back (drive -> key).
        const toDrive = s.phase === 'ingesting';
        const bootSlot = s.os?.slot ?? s.storage.find((d) => d.hasOs)?.slot ?? null;
            if (bootSlot) this.driveFlow(bootSlot, now, toDrive);
        if (s.phase === 'booting-os') { this.flow('dmi', now, -1); this.flow('mem', now, 1); }
        else if (s.phase === 'ingesting') { this.flow('usb', now, -1); this.flow('dmi', now, -1); }
        else { this.flow('dmi', now, 1); this.flow('usb', now, 1); }
      }
    }
    // storage activity: the platter / LEDs / bus light only while the drive reports busy (held a moment so snapshots do not flicker)
    for (const st of s.storage ?? []) {
      const dr = this.drives.get(st.slot);
      if (dr) { dr.burnt = st.burnt; if (st.busy && s.powered) this.driveFlow(st.slot, now, s.phase === 'ingesting', true); }
    }
    this.keyActivity = s.keyActivity ?? 'none';
    this.updateOsScreen(s, now);
    // the board: VRM state for the glow, a dead board for the dimming; a new 'fault' in the log flashes the VRM once
    this.vrm = s.board?.vrm ?? null;
    this.ramVrm = s.board?.ramVrm ?? null;
    this.dead = !!s.board?.burnt;
    const fault = [...(s.log ?? [])].reverse().find((e) => e.kind === 'fault');
    const fkey = fault ? `${fault.tick}|${fault.text}` : '';
    if (this.lastFault === null) this.lastFault = fkey; // the first snapshot only records what is already in the log
    else if (fkey !== this.lastFault) { this.lastFault = fkey; this.vrmFlashAt = performance.now(); this.flashRam = !!fault?.text.includes('memory VRM'); }
    // power: a switched off, tripped or dead machine is dead (no fans, lights or current). A halted or error machine is still ON:
    // its fans, lights and power conductors run, but no data moves (no buses, drive activity or USB LED), so those go quiet here.
    this.liveOn = s.powered && !s.power.off && !s.power.tripped && !s.board?.burnt;
    const quiet = !this.liveOn || s.phase === 'halted' || s.phase === 'error' || coldWait;
    if (quiet) {
      for (const l of this.lit.values()) if (l.pulses > 0) l.hold = 0;
      for (const dr of this.drives.values()) { dr.busyUntil = -1e9; dr.flowUntil = -1e9; }
      this.memAt = -1e9; this.memWall = -1e9;
    }

    // ---- power ----
    const psuDev = s.devices.find((d) => d.kind === 'psu');
    const ratio = s.power.budgetW > 0 ? s.power.totalW / s.power.budgetW : 0;
    this.psuRatio = ratio; this.psuOff = s.power.off; this.psuTripped = s.power.tripped;
    // a hard power-off reads the ambient value at once: no cooling tail on a dead PSU (the low-pass only runs while it is on)
    if (s.power.off || !s.powered) this.psuTemp = 25;
    this.psuW = s.power.totalW; this.psuBudget = psuDev ? s.power.budgetW : 0;
    const flow = !s.power.off && !s.power.tripped && !s.board?.burnt;
    const level = (w: number) => (flow && s.power.budgetW > 0 ? clamp(Math.sqrt(w / s.power.budgetW) * 1.15) : 0);
    const cpuW = cpu?.powerW ?? 0;
    const ramW = s.devices.filter((d) => d.kind === 'ram').reduce((a, d) => a + d.powerW, 0);
    const lv: Partial<Record<BusKind, number>> = {
      pwrcpu: level(cpuW), vcore: level(cpuW), pwr12: level(s.power.totalW * 0.55), vdimm: level(ramW + 0.5),
    };
    for (const [id, v] of Object.entries(lv) as [BusKind, number][]) { const l = this.lit.get(id); if (l) l.hold = v; }
    for (const lc of this.cables) {
      lc.target = lc.cable.kind === 'cpu' ? level(cpuW) : lc.cable.kind === 'atx' ? level(s.power.totalW * 0.6) : lc.cable.kind === 'pcie' ? 0
        : (this.lit.get('video')?.hold ?? 0) > now ? 1 : 0;
      if (!this.connected.has(lc.cable.kind)) lc.target = 0;
    }

    // the case fans run with the machine and speed up with the CPU's heat
    for (const f of this.fans) if (f.kind === 'case') f.target = !this.liveOn ? 0 : 1.6 + 6 * this.cpuHeat;
    for (const d of s.devices) {
      const gl = this.glows.get(d.id);
      if (d.kind === 'cooler') {
        const f = this.fans.find((x) => x.kind === 'cooler');
        if (f) f.target = d.burnt || !this.liveOn ? 0 : 1.2 + 9 * this.cpuHeat + (running ? 2 : 0);
      }
      if (d.kind === 'vrm-sink') {
        // the heatsink fan follows the CPU load (its draw is 0.3 W idle to 1.5 W under load) and stops with the power
        const f = this.fans.find((x) => x.kind === 'vrm');
        if (f) f.target = d.burnt || !this.liveOn ? 0 : 1.5 + 7 * clamp((d.powerW - 0.3) / 1.2);
        continue;
      }
      if (d.kind === 'ram-sink') {
        const f = this.fans.find((x) => x.kind === 'ramvrm');
        if (f) f.target = d.burnt || !this.liveOn ? 0 : 1.5 + 7 * clamp((d.powerW - 0.3) / 1.2);
        continue;
      }
      if (d.kind === 'psu') {
        const f = this.fans.find((x) => x.kind === 'psu');
        if (f) f.target = !this.liveOn ? 0 : 1 + 8 * clamp(ratio);
        continue;
      }
      if (!gl) continue;
      // glow is heat, not load: a cool part at idle stays unlit
      const heat = clamp((d.tempC - 42) / 48);
      let col = heat < 0.5 ? mix(T.alu, T.ld, heat * 2) : mix(T.ld, T.bad, (heat - 0.5) * 2);
      if (d.unstable) col = T.bad;
      gl.base = d.burnt ? 0 : d.kind === 'display' ? 0 : heat * 0.85;
      this.drawGlow(gl, col, d.burnt);
    }
    this.drawPsu(s);
    this.drawDead();

    // badge over the CPU
    if (this.dead) this.setBadge('BOARD DEAD', T.bad);
    else if (cpu?.burnt) this.setBadge('CPU BURNT OUT', T.bad);
    else if (s.power.tripped) this.setBadge('PSU TRIPPED', T.bad);
    else if (s.power.off) this.setBadge('NO POWER', T.bad);
    else if (cpu?.unstable) this.setBadge('UNSTABLE', T.bad);
    else if (cpu && cpu.throttle < 0.985) this.setBadge(`THROTTLED ${Math.round(cpu.throttle * 100)}%`, T.ld);
    else this.badge.visible = false;

    // CLI monitor: last lines that fit, wrapped to the screen width
    // black while the cold-boot wait runs (the sim has no text yet) and after a power-off; a POST error shows its text; any other
    // error (a trip, a burnt part) shows NO SIGNAL rather than a stale line (see monitorView)
    this.blank = { hasDisplay: this.hasDisplay, powered: s.powered, monitorLive: s.monitorLive, phase: s.phase, postFailed: s.postFailed, display: s.display };
    const mv = monitorView(this.blank);
    const txt = mv.text;
    this.noSignal.visible = mv.noSignal;
    if (txt !== this.shownText) {
      this.shownText = txt;
      const cols = 32, rows = 8, lines: string[] = [];
      for (const ln of txt.split('\n')) { if (ln.length === 0) lines.push(''); for (let i = 0; i < ln.length; i += cols) lines.push(ln.slice(i, i + cols)); }
      this.screenText.text = lines.slice(-rows).join('\n');
    }
    this.screenText.alpha = 1;
  }

  /** A dead board: the whole board dimmed, the VRM scorched and cracked. Static; redrawn only when the state flips. */
  private drawDead() {
    if (this.dead === this.deadDrawn) return;
    this.deadDrawn = this.dead;
    const g = this.deadG, T = this.T;
    g.clear();
    if (!this.dead) return;
    box(g, BD.x, BD.y, BD.w, BD.h, 150, { fill: T.dark ? T.bg : '#1b2236', fa: T.dark ? 0.5 : 0.4 });
    const v = BR.vrm;
    // soot: dark, uneven blots over the phase blocks and the heatsink pad
    for (let i = 0; i < 6; i++) {
      const r = vrmPhase(i), k = (i * 37) % 5;
      g.ellipse(r.x + r.w / 2 + (k - 2) * 14, r.y + 120 + (k % 3) * 40, 150 - k * 8, 170 - k * 12).fill({ color: '#000000', alpha: 0.4 });
    }
    g.ellipse(v.x + v.w / 2, v.y + 150, v.w * 0.42, 150).fill({ color: '#000000', alpha: 0.28 });
    const s = VRM_SINK;
    g.rect(s.x, s.y, s.w, s.h).fill({ color: '#000000', alpha: 0.2 });
    const rs = RAM_SINK, dv = BR.dvrm;
    g.ellipse(dv.x + dv.w / 2, dv.y + dv.h / 2, dv.w * 0.4, dv.h * 0.4).fill({ color: '#000000', alpha: 0.3 });
    g.rect(rs.x, rs.y, rs.w, rs.h).fill({ color: '#000000', alpha: 0.2 });
    // cracks
    g.moveTo(v.x + 520, v.y + 40).lineTo(v.x + 560, v.y + 150).lineTo(v.x + 520, v.y + 250).lineTo(v.x + 590, v.y + 380);
    g.moveTo(v.x + 1500, v.y + 60).lineTo(v.x + 1460, v.y + 190).lineTo(v.x + 1530, v.y + 300);
    g.stroke({ width: 8, color: '#000000', alpha: 0.7, cap: 'round', join: 'round' });
    g.moveTo(v.x + 520, v.y + 40).lineTo(v.x + 560, v.y + 150).lineTo(v.x + 520, v.y + 250).lineTo(v.x + 590, v.y + 380);
    g.stroke({ width: 2.5, color: T.bad, alpha: 0.5, cap: 'round', join: 'round' });
  }

  /** The VRM glow (phases light in turn, calm when cool, amber when hot, red when unstable), the power-good light and the crash flash. */
  private drawVrm(now: number) {
    const g = this.vrmG, T = this.T, v = this.vrm;
    // the crash flash runs on wall time (it is an alarm, not machine state): a pause cannot hold it on screen
    const flashWall = clamp(1 - (performance.now() - this.vrmFlashAt) / 900);
    g.clear();
    if (!v) return;
    // power-good light: green when healthy, amber blink when unstable, red blink when the board is dead, dark with no power
    let col: string | null = null, on = true;
    if (this.dead) { col = T.bad; on = Math.floor(now / 450) % 2 === 0; }
    else if (this.liveOn) { col = v.unstable ? T.ld : T.st; on = v.unstable ? Math.floor(now / 220) % 2 === 0 : true; }
    if (col) {
      if (on) g.circle(VRM_LED.x, VRM_LED.y, 38).fill({ color: col, alpha: 0.28 });
      g.circle(VRM_LED.x, VRM_LED.y, 14).fill({ color: on ? col : '#2a3150', alpha: on ? 1 : 0.7 });
    }
    if (this.liveOn && !this.dead) {
      const load = clamp(v.loadRatio), heat = clamp((v.tempC - 45) / Math.max(10, v.throttleC - 45));
      const color = v.unstable ? T.bad : heat < 0.5 ? mix(T.alu, T.ld, heat * 2) : mix(T.ld, T.bad, (heat - 0.5) * 2);
      const level = clamp(0.1 + 0.5 * load + 0.45 * heat);
      const flick = v.unstable ? 0.65 + 0.35 * (Math.floor(now / 90) % 2) : 1;
      for (let i = 0; i < v.phases; i++) {
        // the phases fire one after another (interleaved), faster the harder the CPU pulls
        const a = level * flick * (0.78 + 0.22 * Math.sin(now * (0.004 + 0.012 * load) - (i * Math.PI * 2) / v.phases));
        const r = vrmPhase(i);
        for (let k = 0; k < 3; k++) { const e = 6 + k * 14; box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 24 + e, { stroke: color, lw: 12, sa: a * 0.55 * (1 - k / 3) }); }
        box(g, r.x, r.y, r.w, r.h, 18, { fill: color, fa: a * 0.1 });
      }
    }
    // the memory regulator: its phases glow the same way, driven by RAM current
    const rv = this.ramVrm;
    if (rv && this.liveOn && !this.dead) {
      const load = clamp(rv.loadRatio), heat = clamp((rv.tempC - 45) / Math.max(10, rv.throttleC - 45));
      const color = rv.unstable ? T.bad : heat < 0.5 ? mix(T.alu, T.ld, heat * 2) : mix(T.ld, T.bad, (heat - 0.5) * 2);
      const level = clamp(0.1 + 0.5 * load + 0.45 * heat);
      const flick = rv.unstable ? 0.65 + 0.35 * (Math.floor(now / 90) % 2) : 1;
      for (let i = 0; i < rv.phases; i++) {
        const a = level * flick * (0.78 + 0.22 * Math.sin(now * (0.004 + 0.012 * load) - (i * Math.PI * 2) / rv.phases));
        const r = dramPhase(i);
        for (let k = 0; k < 3; k++) { const e = 6 + k * 14; box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 24 + e, { stroke: color, lw: 12, sa: a * 0.55 * (1 - k / 3) }); }
        box(g, r.x, r.y, r.w, r.h, 18, { fill: color, fa: a * 0.1 });
      }
    }
    const fl = flashWall;
    if (fl > 0) {
      const b = this.flashRam ? BR.dvrm : BR.vrm, e = 30 * (1 - fl);
      box(g, b.x - e, b.y - e, b.w + 2 * e, b.h + 2 * e, 40, { fill: T.bad, fa: 0.55 * fl });
      box(g, b.x - e, b.y - e, b.w + 2 * e, b.h + 2 * e, 40, { stroke: '#ffffff', lw: 14, sa: 0.8 * fl });
    }
  }

  /** PSU readout: draw versus budget gauge, temperature, fan. */
  private drawPsu(s: Snapshot) {
    const T = this.T, p = PSU_PANEL, g = this.gauge, tx = this.psuTexts;
    g.clear();
    if (!this.hasPsu) return;
    const ratio = this.psuRatio, off = this.psuOff, trip = this.psuTripped;
    const col = trip || ratio > 1 ? T.bad : ratio > 0.8 ? T.ld : T.st;
    const set = (t: Text, v: string, fill: string) => { if (t.text !== v) t.text = v; if (t.style.fill !== fill) t.style.fill = fill; };
    set(tx.load, off ? '0' : String(Math.round(this.psuW)), off ? T.mute : col);
    set(tx.of, `W  /  ${Math.round(this.psuBudget)} W`, LCD_MUTE);
    set(tx.pct, trip ? 'TRIPPED' : off ? 'OFF' : `${Math.round(ratio * 100)}%`, off ? T.bad : col);
    // gauge bar with 20 segments
    const bx = p.x + 50, by = p.y + 560, bw = 1050, bh = 90, n = 20, seg = bw / n;
    box(g, bx - 8, by - 8, bw + 16, bh + 16, 12, { fill: '#000000', fa: 0.5, stroke: T.line, lw: 4 });
    const lit = Math.round(clamp(ratio, 0, 1.2) / 1.2 * n);
    for (let i = 0; i < n; i++) {
      const on = i < lit && !off, f = i / n * 1.2;
      const c = f > 1 ? T.bad : f > 0.8 ? T.ld : T.st;
      g.rect(bx + i * seg + 4, by, seg - 8, bh).fill({ color: on ? c : '#6c7aa8', alpha: on ? 0.95 : 0.3 });
    }
    // 100 % mark
    g.rect(bx + bw / 1.2 - 3, by - 14, 6, bh + 28).fill({ color: LCD_INK, alpha: 0.6 });
    // temperature (estimated from load: the sim has no PSU heat), thermal state
    const tc = Math.round(this.psuTemp);
    const hot = tc >= 70, warm = tc >= 55;
    const tcol = hot ? T.bad : warm ? T.ld : T.st;
    set(tx.temp, `${tc}°C`, tcol);
    set(tx.state, off ? 'COLD' : hot ? 'HOT' : warm ? 'WARM' : 'COOL', off ? LCD_MUTE : tcol);
    const tw = 420, tt = clamp((this.psuTemp - 25) / 55);
    box(g, p.x + 1190 - 8, by - 8, tw + 16, bh + 16, 12, { fill: '#000000', fa: 0.5, stroke: T.line, lw: 4 });
    box(g, p.x + 1190, by, Math.max(10, tw * tt), bh, 8, { fill: tcol, fa: 0.9 });
    void s;
  }

  /** PCH glow and scan bars (interior), USB activity LED, monitor power LED, thin boot progress bar (external). */
  private drawBoot(now: number, dt: number) {
    const T = this.T, g = this.bootG, ph = this.bootPhase;
    const busy = this.powered && !this.coldWait && (ph === 'posting' || ph === 'loading' || ph === 'writing');
    if (!this.powered) this.pchLevel = 0; // a hard power-off is dark on the next frame
    else this.pchLevel += ((busy ? 1 : 0) - this.pchLevel) * Math.min(1, dt * (busy ? 8 : 2.5));
    const showBar = this.hasDisplay && this.monitorLive && this.powered && (ph === 'posting' || ph === 'loading' || ph === 'booting-os');
    // PCH: outline glow plus a row of activity bars that scan while it works
    const c = BR.chip, lv = this.pchLevel;
    if (this.interior && (lv > 0.01 || this.pchDrawn)) {
      g.clear();
      this.pchDrawn = lv > 0.01;
      if (lv > 0.01) {
        for (let i = 0; i < 3; i++) { const e = 8 + i * 16; box(g, c.x - e, c.y - e, c.w + 2 * e, c.h + 2 * e, 26 + e, { stroke: T.mul, lw: 14, sa: 0.55 * lv * (1 - i / 3) }); }
        const n = 9, bw = (c.w - 100) / n;
        for (let i = 0; i < n; i++) {
          const k = (Math.sin(now * 0.012 + i * 0.9) + 1) / 2;
          g.rect(c.x + 50 + i * bw + 6, c.y + c.h - 120 - 110 * k, bw - 12, 30 + 110 * k).fill({ color: T.mul, alpha: (0.25 + 0.55 * k) * lv });
        }
      }
    }
    const e = this.extG;
    e.clear();
    // USB port LED: dark with no power, and dark while halted or in error (no data moves: a key in the port is not read); steady green with
    // a key in; with an OS it follows keyActivity (enumerating: slow amber blink, ingesting / flashing: fast blink, done: steady green that
    // breathes = collect the key); without an OS it blinks while loading or writing
    const lx = USB_PORT.x + 46, ly = USB_PORT.y - 52, act = this.keyActivity;
    let col: string | null = null, on = true, la = 1;
    if (!this.powered || ph === 'halted' || ph === 'error') { /* the USB port is dead, or nothing reads it */ }
    else if (act === 'enumerating') { col = T.ld; on = Math.floor(now / 450) % 2 === 0; }
    else if (act === 'ingesting') { col = T.ld; on = Math.floor(now / 130) % 2 === 0; }
    else if (act === 'flashing') { col = T.alu; on = Math.floor(now / 130) % 2 === 0; }
    else if (act === 'done') { col = T.st; la = 0.75 + 0.25 * Math.sin(now * 0.005); }
    else if (this.plugged) {
      const active = ph === 'loading' || ph === 'writing';
      col = active ? T.ld : T.st; on = active ? Math.floor(now / 140) % 2 === 0 : true;
    }
    if (col) {
      if (on) e.circle(lx, ly, 30).fill({ color: col, alpha: 0.3 * la });
      e.circle(lx, ly, 15).fill({ color: on ? col : '#2a3150', alpha: on ? la : 0.7 });
    } else e.circle(lx, ly, 15).fill({ color: '#2a3150', alpha: 0.6 });
    // monitor power LED (green live, amber standby) and the boot bar under the picture
    if (this.hasDisplay) {
      const m = MONITOR, s = SCREEN, K = MONITOR_K, cy = s.y + s.h + 14 * K + (m.y + m.h - (s.y + s.h + 14 * K)) / 2;
      e.circle(m.x + m.w - 150 * K, cy, 19 * K).fill({ color: '#0a0f1a' });
      const col2 = this.monitorLive ? (this.powered ? T.st : T.ld) : T.mute;
      e.circle(m.x + m.w - 150 * K, cy, 15 * K).fill({ color: col2, alpha: this.monitorLive ? 1 : 0.4 });
      if (showBar) {
        const bx = s.x + 60 * K, by = s.y + s.h - 36 * K, bw = s.w - 120 * K, th = 14 * K;
        e.roundRect(bx, by, bw, th, th / 2).fill({ color: '#0e1830' });
        e.roundRect(bx, by, Math.max(th, bw * clamp(this.bootProgress)), th, th / 2).fill({ color: T.st, alpha: 0.9 });
      }
    }
  }

  /**
   * The OS status screen on the monitor: composed from `snapshot.os`, `storage`, `display` (every field optional-safe).
   * Rows are pooled Texts; the progress cue is drawn per frame by `drawOsBar`.
   */
  private updateOsScreen(s: Snapshot, _now: number) {
    const ph = s.phase;
    const on = !!s.os && s.powered && s.monitorLive && this.hasDisplay && (ph === 'booting-os' || ph === 'idle-os' || ph === 'running-os' || ph === 'ingesting' || ph === 'flashing');
    if (s.os?.up) { if (this.osUpTick === null) this.osUpTick = s.baseTick; } else this.osUpTick = null;
    this.osOn = on;
    this.screenText.visible = this.hasDisplay && !on;
    this.osG.visible = on;
    this.osJob = 'none';
    if (!on || !s.os) { for (const t of this.osRows) t.visible = false; this.osSig = ''; return; }
    const os = s.os, q = os.queue ?? [];
    const pad = (a: string, b: string) => a + ' '.repeat(Math.max(1, OS_COLS - a.length - b.length)) + b;
    const rows: { t: string; c: string }[] = [];
    const status = ph === 'booting-os' ? 'BOOTING' : ph === 'idle-os' ? 'READY' : ph === 'ingesting' ? 'INGEST' : ph === 'running-os' ? 'RUNNING' : 'FLASHING';
    rows.push({ t: pad(`${(os.name ?? 'OS').toUpperCase().slice(0, 28)} T${os.tier ?? 1}`, status), c: OS_INK });
    const up = this.osUpTick === null ? null : Math.max(0, s.baseTick - this.osUpTick);
    const upTxt = up === null ? 'UP --:--' : `UP ${String(Math.floor(up / 60)).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
    rows.push({ t: `${upTxt}  PROG ${os.programSlots ?? 1}  QUEUE ${q.length}/${os.queueSlots ?? '?'}`, c: OS_DIM });
    rows.push({ t: '-'.repeat(OS_COLS), c: OS_RULE });
    if (ph === 'booting-os') {
      const lines: string[] = [];
      for (const ln of (s.display || '').split('\n')) { if (!ln.length) lines.push(''); for (let i = 0; i < ln.length; i += OS_COLS) lines.push(ln.slice(i, i + OS_COLS)); }
      for (const ln of lines.slice(-6)) rows.push({ t: ln, c: OS_DIM });
    } else {
      const running = q.find((j) => j.state === 'running');
      if (ph === 'ingesting') { rows.push({ t: `INGESTING KEY ${s.plugged?.label ?? ''}`, c: OS_CYAN }); this.osJob = 'ingest'; }
      else if (ph === 'flashing') { rows.push({ t: `WRITING RESULT ${s.plugged?.label ?? ''}`, c: OS_AMBER }); this.osJob = 'flash'; }
      else if (running) { rows.push({ t: `RUN  ${running.label}`, c: OS_INK }); this.osJob = 'run'; }
      else rows.push({ t: 'IDLE  insert a key', c: OS_DIM });
      const rest = q.filter((j) => j !== running);
      for (const j of rest.slice(0, 4)) {
        const st = j.state === 'result' ? 'DONE' : j.state === 'queued' ? (j.ahead <= 0 ? 'NEXT' : `+${j.ahead} AHEAD`) : 'RUN';
        rows.push({ t: pad(`  ${j.label}`.slice(0, 28), st), c: j.state === 'result' ? OS_AMBER : OS_INK });
      }
      if (rest.length > 4) rows.push({ t: `  +${rest.length - 4} MORE`, c: OS_DIM });
      while (rows.length < 8) rows.push({ t: '', c: OS_DIM });
      const ready = q.filter((j) => j.state === 'result');
      if (s.keyActivity === 'done' && s.plugged) rows.push({ t: `REMOVE KEY ${s.plugged.label}`, c: OS_INK });
      else if (ready.length) rows.push({ t: `PLUG KEY ${ready[0]!.label} TO COLLECT${ready.length > 1 ? ` (+${ready.length - 1})` : ''}`, c: OS_AMBER });
      else rows.push({ t: '', c: OS_DIM });
      const d = s.storage?.find((x) => x.hasOs) ?? s.storage?.find((x) => x.slot === os.slot);
      if (d && d.capacityBytes > 0) {
        const f = Math.max(0, Math.min(1, d.usedBytes / d.capacityBytes)), n = Math.round(f * 10);
        rows.push({ t: `DISK ${d.slot} [${'#'.repeat(n)}${'-'.repeat(10 - n)}] ${Math.round(d.usedBytes / 1024)}K/${Math.round(d.capacityBytes / 1024)}K`, c: OS_DIM });
      }
    }
    const sig = rows.map((r) => r.c + r.t).join('\n');
    if (sig === this.osSig) return;
    this.osSig = sig;
    this.osRowsFor().forEach((t, i) => {
      const r = rows[i];
      t.visible = !!r;
      if (!r) return;
      if (t.text !== r.t) t.text = r.t;
      if (t.style.fill !== r.c) t.style.fill = r.c;
    });
  }

  private drawBadge(now: number) {
    const g = this.badgeG, r = this.badgeRect, t = this.badgeText!, T = this.T;
    g.clear();
    t.visible = !!r;
    if (!r) return;
    const ph = this.badgePhase;
    box(g, r.x, r.y, r.w, r.h, 14, { fill: T.dark ? '#0b1226' : '#ffffff', fa: 0.92, stroke: T.st, lw: 5, sa: 0.85 });
    const dotX = r.x + r.w - 30, dotY = r.y + r.h / 2;
    let col = T.st, a = 1;
    if (ph === 'booting-os') { col = T.ld; a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.008)); }
    else if (ph === 'idle-os') col = T.st;
    else if (ph === 'ingesting') { col = T.mul; a = Math.floor(now / 140) % 2 ? 1 : 0.4; }
    else if (ph === 'running-os') { col = T.alu; a = 0.6 + 0.4 * Math.sin(now * 0.012); }
    else if (ph === 'flashing') { col = T.ld; a = Math.floor(now / 140) % 2 ? 1 : 0.4; }
    else if (ph === 'off' || ph === 'error') { col = T.mute; a = 0.5; }
    else col = T.mute;
    g.circle(dotX, dotY, 22).fill({ color: col, alpha: 0.25 * a });
    g.circle(dotX, dotY, 13).fill({ color: col, alpha: a });
    t.position.set(r.x + 20, r.y + r.h / 2);
    t.style.fill = T.st;
  }

  /** Per-frame progress cue under the current job row: an indeterminate block sliding on a track (game time). */
  private drawOsBar(now: number) {
    const g = this.osG;
    g.clear();
    if (!this.osOn || this.osJob === 'none') return;
    const x0 = 90 + 27 * 71, w = SCREEN_D.w - 120 - x0, y = 56 + 3 * OS_LINE + 42, bw = 300;
    const col = this.osJob === 'run' ? OS_INK : this.osJob === 'ingest' ? OS_CYAN : OS_AMBER;
    g.roundRect(x0, y, w, 34, 17).fill({ color: '#16241e' });
    const u = (now / 1500) % 1, left = x0 + (w + bw) * u - bw, a = Math.max(x0, left), b = Math.min(x0 + w, left + bw);
    if (b > a) g.roundRect(a, y, b - a, 34, 17).fill({ color: col, alpha: 0.9 });
  }

  private setBadge(text: string, color: string) {
    this.badge.visible = true;
    if (this.badge.text !== text) this.badge.text = text;
    this.badge.style.fill = color;
  }

  private drawGlow(gl: Glow, color: string, burnt: boolean) {
    const { g, dim, t } = gl, r = t.rect;
    g.clear(); dim.clear();
    if (burnt) {
      box(dim, r.x, r.y, r.w, r.h, 24, { fill: this.T.bg, fa: 0.62 });
      dim.moveTo(r.x + r.w * 0.2, r.y + r.h * 0.2).lineTo(r.x + r.w * 0.8, r.y + r.h * 0.8).moveTo(r.x + r.w * 0.8, r.y + r.h * 0.2).lineTo(r.x + r.w * 0.2, r.y + r.h * 0.8);
      dim.stroke({ width: Math.max(16, Math.min(r.w, r.h) * 0.03), color: this.T.bad, alpha: 0.85, cap: 'round' });
      return;
    }
    for (let i = 0; i < 4; i++) {
      const e = 8 + i * 14;
      box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 40 + e, { stroke: color, lw: 14, sa: 0.5 * (1 - i / 4) });
    }
  }

  /** Per-frame animation. dt in seconds. */
  frame(dt: number, now: number) {
    const inner = this.interior;
    this.frameStandby();
    this.phase += dt * 260 * this.clockRatio;
    for (const f of this.fans) {
      f.speed += (f.target - f.speed) * Math.min(1, dt * (f.target > f.speed ? 2 : 4));
      if (f.target === 0) f.speed = 0; // off, tripped or dead: the fan is still on the next frame (no coasting, no creep)
      if (f.c instanceof EdgeFan) f.c.spin(f.speed * dt * 0.8, Math.min(1, f.speed / 5)); // a case fan seen edge-on: the blades slide along it
      else f.c.rotation += f.speed * dt;
    }
    const psuFan = this.fans.find((f) => f.kind === 'psu');
    if (this.hasPsu && inner) {
      this.panelFan.rotation += (psuFan?.speed ?? 0) * dt;
      // fan rpm readout, and a first-order PSU temperature that follows load (estimated; the sim does not model PSU heat)
      const target = this.psuOff ? 25 : 25 + 34 * Math.pow(clamp(this.psuRatio, 0, 1.4), 1.5);
      this.psuTemp += (target - this.psuTemp) * Math.min(1, dt * 0.25);
      const rpm = psuFan && psuFan.speed > 0.05 ? Math.round((500 + (psuFan.speed / 9) * 2300) / 10) * 10 : 0;
      const txt = rpm === 0 ? 'STOPPED' : `${rpm} rpm`;
      if (this.psuTexts.rpm.text !== txt) this.psuTexts.rpm.text = txt;
      const tc = Math.round(this.psuTemp), tt = `${tc}°C`;
      if (this.psuTexts.temp.text !== tt) { const T = this.T; const c = tc >= 70 ? T.bad : tc >= 55 ? T.ld : T.st; this.psuTexts.temp.text = tt; this.psuTexts.temp.style.fill = c; }
    }
    if (inner) for (const gl of this.glows.values()) {
      const pulse = 0.85 + 0.15 * Math.sin(now * 0.004 + gl.t.rect.x);
      gl.g.alpha = clamp(gl.base * pulse, 0, 1);
    }

    // ---- buses and cables ----
    const T = this.T;
    const r = Math.max(9, 2.4 / this.zoom) / 16;
    let k = 0;
    const put = (p: [number, number], col: string, a: number, scale = 1) => {
      const sp = this.dots[k++];
      if (!sp) return;
      sp.visible = a > 0.02;
      sp.position.set(p[0], p[1]);
      sp.tint = col; sp.alpha = a; sp.scale.set(r * scale);
    };
    for (const l of inner ? this.lit.values() : []) {
      const power = l.pulses === 0;
      if (!this.liveOn) { l.level = 0; l.g.alpha = 0; continue; } // off, tripped or dead: no glow or pulses on the next frame
      if (power) { l.level += (l.hold - l.level) * Math.min(1, dt * 3); l.g.alpha = l.level * 0.55; continue; }
      const on = l.hold > now;
      l.level += ((on ? 1 : 0) - l.level) * Math.min(1, dt * (on ? 9 : 2.2));
      l.g.alpha = l.level * 0.5;
      if (l.level < 0.03) continue;
      const speed = (l.bus.id === 'mem' ? 2.4 : 1.4) * l.dir;
      for (const lane of l.lanes) {
        const n = Math.max(1, Math.min(3, Math.round(lane.len / 900)));
        for (let j = 0; j < n; j++) put(pointAt(lane, this.phase * speed + lane.ph + (j * lane.len) / n), l.color, 0.95 * l.level);
      }
    }
    for (const lc of this.cables) {
      const video = lc.cable.kind === 'video';
      if (!video && !inner) continue;
      if (!this.liveOn) { lc.level = 0; lc.g.alpha = 0; if (video) for (const sp of this.extDots) sp.visible = false; continue; }
      lc.level += (lc.target - lc.level) * Math.min(1, dt * 2.5);
      lc.g.alpha = lc.level * 0.55;
      if (video) for (const sp of this.extDots) sp.visible = false;
      if (lc.level < 0.03) continue;
      const lane = lc.cable.path, dir = video ? 1 : -1;
      for (let j = 0; j < 3; j++) {
        const pt = pointAt(lane, this.phase * 0.9 * dir + (j * lane.len) / 3);
        const sp = video ? this.extDots[j] : this.dots[k++];
        if (!sp) continue;
        sp.visible = true; sp.position.set(pt[0], pt[1]); sp.tint = lc.color; sp.alpha = 0.85 * lc.level; sp.scale.set(r * 1.4);
      }
    }
    // drives: platter / head / LED only while busy; SATA cable pulses while data moves
    this.diskLevel = 0;
    for (const dr of this.drives.values()) {
      if (!this.liveOn) { dr.speed = 0; dr.head = 0; dr.led = 0; dr.level = 0; } // off, tripped or dead: platter, arm, LED and cable are still at once
      const lit = dr.busyUntil > now, flow = dr.flowUntil > now || lit;
      dr.speed += ((lit ? 16 : 0) - dr.speed) * Math.min(1, dt * (lit ? 4 : 2.5));
      if (!lit && dr.speed < 0.05) dr.speed = 0;
      dr.spin += dr.speed * dt;
      dr.head += ((lit ? 0.5 + 0.5 * Math.sin(now * 0.009 + 1) : 0) - dr.head) * Math.min(1, dt * 6);
      const lt = lit ? (dr.kind === 'hdd' ? 0.65 + 0.35 * Math.sin(now * 0.03) : Math.floor(now / 80) % 2 ? 1 : 0.15) : 0;
      dr.led += (lt - dr.led) * Math.min(1, dt * 14);
      if (!lit && dr.led < 0.03) dr.led = 0;
      const sig = `${Math.round(dr.spin * 20)}|${Math.round(dr.head * 40)}|${Math.round(dr.led * 10)}|${dr.burnt}`;
      if (inner && sig !== dr.sig) { dr.sig = sig; drawDriveLive(dr.g, this.T, dr.kind, dr.slot, { spin: dr.spin, head: dr.head, led: dr.led, burnt: dr.burnt }); }
      this.diskLevel = Math.max(this.diskLevel, dr.led);
      if (dr.lane && inner) {
        dr.level += ((flow ? 1 : 0) - dr.level) * Math.min(1, dt * (flow ? 9 : 2.2));
        dr.glow.alpha = dr.level * 0.5;
        if (dr.level > 0.03) for (let j = 0; j < 4; j++) put(pointAt(dr.lane, this.phase * 1.4 * dr.dir + (j * dr.lane.len) / 4), T.mul, 0.95 * dr.level);
      }
    }
    while (k < this.dots.length) this.dots[k++]!.visible = false;
    this.drawOsBar(now);
    if (inner) { this.drawBadge(now); this.drawVrm(now); }

    this.drawBoot(now, dt);

    // DRAM chips flash while the memory bus is busy
    const mf = clamp(1 - (performance.now() - this.memWall) / 900); // wall time: a pause does not hold a flash on screen
    this.dramFlash.clear();
    if (mf > 0 && inner) {
      let n = 0;
      for (const c of this.dramChips) {
        if ((Math.floor(now / 140) + n++) % 3 === 0) box(this.dramFlash, c.x, c.y, c.w, c.h, 8, { fill: this.T.alu, fa: mf * 0.55, stroke: this.T.alu, lw: 5 });
      }
    }
  }
}

