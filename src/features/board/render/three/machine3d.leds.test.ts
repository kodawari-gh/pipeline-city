// The Ethernet jacks on the machine (Machine3D.frame, docs/render/net.md "LED meanings"): the jack the cable is in takes the levels the link's frames give (`LinkLeds`), every other
// jack stays dark, and a jack lit by the levels is not a lamp the merges and the shares took away.
import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { DARK, JACK_GLOW, LinkLeds, type LinkLevels } from '@/features/network/render/jackleds';
import { netRig } from '@/worker/game/testkit';
import type { Snapshot } from '@/worker/protocol';
import { buildMachine, quietCanvas } from './testutil';

quietCanvas();

/** The lights' colours: the board's own jack (`jackLook`), and a network card's (`nicParts`). */
const BOARD = { link: 0x58e08a, act: 0xffb547 },
  CARD = { link: 0x5cff9a, act: 0xffc247 };

/** The glow of the lights of one colour: the strongest intensity of the materials that draw with it, or null when none is built. */
function glow(root: Object3D, hex: number): number | null {
  let best: number | null = null;
  root.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!(o as Mesh).isMesh || !m || Array.isArray(m) || m.emissive?.getHex() !== hex) return;
    best = Math.max(best ?? 0, m.emissiveIntensity);
  });
  return best;
}
const level = (link: number, act: number): LinkLevels => ({
  pc: { link, act },
  lan: { link, act },
  wan: { link, act },
  moving: false,
});

describe.each([
  ['merged', true],
  ['unmerged', false],
] as const)("the jacks' lights on the %s machine", (_name, merge) => {
  it("light the board's jack from the levels, link and activity each by itself, while the cable is in it", () => {
    const s = netRig('ssd1').snapshot();
    expect(s.net.port.kind).toBe('board');
    const m = buildMachine(s, merge);
    // (built dark: the model lights nothing by itself)
    expect(glow(m.root, BOARD.link)).toBe(0);
    expect(glow(m.root, BOARD.act)).toBe(0);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(1, 0) });
    expect(glow(m.root, BOARD.link)).toBeCloseTo(JACK_GLOW.link, 9);
    expect(glow(m.root, BOARD.act)).toBe(0);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(1, 1) });
    expect(glow(m.root, BOARD.link)).toBeCloseTo(JACK_GLOW.link, 9);
    expect(glow(m.root, BOARD.act)).toBeCloseTo(JACK_GLOW.act, 9);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(0, 0) });
    expect(glow(m.root, BOARD.link)).toBe(0);
    expect(glow(m.root, BOARD.act)).toBe(0);
  });

  it('are dark with no levels given, and with no game', () => {
    const s = netRig('ssd1').snapshot(),
      m = buildMachine(s, merge);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(1, 1) });
    m.frame(s, { dt: 0.016 });
    expect(glow(m.root, BOARD.link)).toBe(0);
    expect(glow(m.root, BOARD.act)).toBe(0);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(1, 1) });
    m.frame(null, { dt: 0.016, doorDt: 0.016, net: DARK });
    expect(glow(m.root, BOARD.link)).toBe(0);
    expect(glow(m.root, BOARD.act)).toBe(0);
  });

  it("light the card's jack when the cable is in the card, and leave the board's jack dark", () => {
    const s = netRig('ssd1', { port: 'nic1' }).snapshot();
    expect(s.net.port.kind).toBe('nic');
    const m = buildMachine(s, merge);
    m.frame(s, { dt: 0.016, doorDt: 0.016, net: level(1, 1) });
    expect(glow(m.root, CARD.link)).toBeCloseTo(JACK_GLOW.link, 9);
    expect(glow(m.root, CARD.act)).toBeCloseTo(JACK_GLOW.act, 9);
    expect(glow(m.root, BOARD.link)).toBe(0);
    expect(glow(m.root, BOARD.act)).toBe(0);
  });

  it('light no jack when the cable is in none, whatever the levels say', () => {
    const s = netRig('ssd1', { port: 'nic1' }).snapshot();
    const out: Snapshot = { ...s, net: { ...s.net, port: { kind: null, deviceId: null, mbps: 0 } } };
    const m = buildMachine(out, merge);
    m.frame(out, { dt: 0.016, doorDt: 0.016, net: level(1, 1) });
    for (const hex of [BOARD.link, BOARD.act, CARD.link, CARD.act])
      expect(glow(m.root, hex) ?? 0, hex.toString(16)).toBe(0);
  });
});

describe("the jacks' lights from a running game", () => {
  it('follow the frames of a download: lit while it moves data, out again once it is done, with nothing set by hand', () => {
    const g = netRig('ssd1');
    const m = buildMachine(g.snapshot(), true),
      leds = new LinkLeds();
    const lit = (): number => glow(m.root, BOARD.act) ?? 0;
    const run = (n: number, dt: number): number => {
      let seen = 0;
      for (let i = 0; i < n; i++) {
        g.advanceBaseTick();
        const s = g.snapshot();
        m.frame(s, { dt, doorDt: dt, net: leds.step(s, dt) });
        if (lit() > 0) seen++;
      }
      return seen;
    };
    // (an idle link: green, and no amber)
    expect(run(3, 0.1)).toBe(0);
    expect(glow(m.root, BOARD.link)).toBeCloseTo(JACK_GLOW.link, 9);
    // (a download at the plan's speed: the frames come close, the light stays on for as long as it moves)
    g.enqueue({ template: 'cli.log', scale: 1, net: true });
    expect(run(2, 0.1)).toBe(2);
    // (the job has run and its result is out, the link is idle: the amber light goes)
    for (let i = 0; i < 3000 && !g.snapshot().progress.firstNetJob; i++) g.advanceBaseTick();
    expect(g.snapshot().progress.firstNetJob).toBeTruthy();
    run(2, 0.1);
    expect(run(3, 0.1)).toBe(0);
    expect(glow(m.root, BOARD.link)).toBeCloseTo(JACK_GLOW.link, 9);
  });
});
