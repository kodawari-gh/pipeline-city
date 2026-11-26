import { Graphics, Sprite, Text } from 'pixi.js';
import { HEAD } from '../ink';
import { FanMotor, fanBank } from '../fanmotor';
import { MONITOR_K, PKG, SCREEN } from './features';
import { LCD_INK, LCD_MUTE } from './consts';
import { buildStandby, osRowsFor } from './screen';
import type { LiveState } from './state';
import { placePsuTexts } from './texts';
import { sceneBuses, sceneCables } from './sceneBus';
import type { SceneInput } from './types';

/** Drop the last scene's objects (the pooled ones stay) and forget its state. */
function clearScene(s: LiveState): void {
  const keep = new Set<unknown>([
    s.scr,
    s.vrmG,
    s.deadG,
    s.badgeG,
    s.badgeText,
    s.badge,
    s.screenText,
    s.noSignal,
    s.osG,
    ...s.osRows,
    s.bootG,
    s.extG,
    s.busFlow.g,
    s.extFlow.g,
    s.gauge,
    s.dramFlash,
    s.ram.root,
    s.gpu.root,
    s.disk.root,
    s.tpm.root,
    s.npu.root,
    s.panelFan,
    ...Object.values(s.psuTexts),
  ]);
  for (const ch of s.root.removeChildren()) {
    if (!keep.has(ch)) {
      ch.destroy({ children: true });
    }
  }
  for (const ch of s.ext.removeChildren()) {
    if (!keep.has(ch)) {
      ch.destroy({ children: true });
    }
  }
  s.busFlow.clear();
  s.extFlow.clear();
  s.videoLane = null;
  s.root.addChild(s.deadG);
  s.deadDrawn = false;
  s.pgoodDrawn = null;
  s.glows.clear();
  s.lit.clear();
  s.memLit.clear();
  s.cables = [];
  s.dots = [];
}

/** The fans, the sticks, the card views and the glow of each target part. */
function sceneParts(s: LiveState, sc: SceneInput): void {
  const { T } = sc;
  s.hasPsu = sc.flags.psu;
  s.fans = sc.fans.map((f) => ({
    ...f,
    speed: fanBank.get(f.kind),
    target: 0,
    motor: new FanMotor(fanBank.get(f.kind)),
  }));
  s.dimmIdx = sc.dimms;
  s.ram.setScene(T, sc.dramChips);
  s.gpu.setScene(T, sc.gpuCards);
  s.disk.setScene(
    T,
    sc.drives.filter((d) => d.g).map((d) => ({ slot: d.slot, deviceId: d.deviceId, kind: d.kind, body: d.body })),
  );
  s.tpm.setScene(T, sc.tpmModules);
  s.npu.setScene(T, sc.npuCards);
  for (const t of sc.targets) {
    const g = new Graphics(),
      dim = new Graphics();
    g.blendMode = 'add';
    s.root.addChild(g, dim);
    s.glows.set(t.id, { t, g, dim, base: 0, level: 0 });
  }
}

/** The drives' live state, and the layers over the board: packets, card views, pulse dots, badges and the PSU panel. */
function sceneLayers(s: LiveState, sc: SceneInput, nDots: number): void {
  s.drives.clear();
  for (const d of sc.drives) {
    s.drives.set(d.slot, {
      ...d,
      busyUntil: -1e9,
      speed: 0,
      spin: 0.6,
      head: 0,
      led: 0,
      sig: '',
      burnt: false,
      read: -1,
      wrote: -1,
      ioUntil: -1e9,
      ioWrite: false,
    });
  }
  s.root.addChild(s.busFlow.g, s.ram.root, s.gpu.root, s.disk.root, s.tpm.root, s.npu.root, s.dramFlash);
  for (let i = 0; i < nDots; i++) {
    const sp = new Sprite(s.dotTex);
    sp.anchor.set(0.5);
    sp.visible = false;
    s.dots.push(sp);
    s.root.addChild(sp);
  }
  s.badgeText ??= new Text({
    text: 'OS',
    style: { fontFamily: HEAD, fontSize: 44, fontWeight: '700', fill: '#ffffff' },
    resolution: 2,
  });
  s.badgeText.anchor.set(0, 0.5);
  s.root.addChild(s.vrmG, s.badgeG, s.badgeText);
  s.root.addChild(s.bootG, s.gauge, s.badge, s.panelFan, ...Object.values(s.psuTexts));
}

/** The monitor's screen (laid out at the design size inside a container scaled onto the bigger monitor) and what shows at first. */
function sceneScreen(s: LiveState, sc: SceneInput): void {
  const { T, flags } = sc;
  s.scr.removeChildren();
  buildStandby(s, T);
  s.scr.addChild(s.standby, s.screenText, s.osG, ...osRowsFor(s), s.dash, s.frameV, s.noSignal);
  s.scr.position.set(SCREEN.x, SCREEN.y);
  s.scr.scale.set(MONITOR_K);
  s.ext.addChild(s.extFlow.g, s.extG, s.scr);
  const showPsu = flags.psu;
  for (const t of Object.values(s.psuTexts)) {
    t.visible = showPsu;
  }
  s.panelFan.visible = showPsu;
  s.screenText.visible = flags.display;
  s.osSig = '\u0000';
  s.osOn = false;
  s.osG.visible = false;
  for (const t of s.osRows) {
    t.visible = false;
  }
  s.hasDisplay = flags.display;
  s.gfxDisplay = flags.gfx === true;
  s.noSignal.visible = false;
  s.screenText.style.fill = T.st;
  s.badge.position.set(0, PKG.y - 160);
  s.shownText = '\u0000';
  for (const c of s.panelFan.children) {
    c.tint = LCD_MUTE;
  }
  s.psuTexts.of.style.fill = LCD_MUTE;
  s.psuTexts.rpm.style.fill = LCD_INK;
}

/** (Re)build live objects for a scene. Called when the theme or the installed set changes. */
export function buildScene(s: LiveState, sc: SceneInput): void {
  s.T = sc.T;
  placePsuTexts(s.psuTexts, s.panelFan);
  clearScene(s);
  sceneParts(s, sc);
  sceneBuses(s, sc);
  const nDots = sceneCables(s, sc.cables);
  sceneLayers(s, sc, nDots);
  sceneScreen(s, sc);
}
