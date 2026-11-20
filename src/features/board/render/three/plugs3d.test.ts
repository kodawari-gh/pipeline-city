import { describe, expect, it } from 'vitest';
import { Box3, Mesh, type MeshStandardMaterial } from 'three';
import { MONITOR_PLUG } from '@/features/room/render/three/monitor3d';
import { IO_HALF, IO_Z } from './boardhw3d';
import { OUTPUTS } from './gpu3d';
import { MOUTH } from './nic3d';
import {
  boardHdmi, boardRj45, HDMI, hdmiLength, hdmiPlug, hdmiReal, lozenge, RJ45, rj45Length, rj45Plug, rj45Real, SWISS, swissEngage, swissLength, swissPlug, swissReal, T13,
} from './plugs3d';

const MM = 23, VIDEO_R = 34, LAN_R = 40;

describe('the cables plugs', () => {
  it('fit each socket they go into: a card output and the NIC jack at real size, the board rear I/O at its own', () => {
    const card = hdmiReal(VIDEO_R), hdmi = OUTPUTS[0]!, e = 0.45 * MM;
    expect(card.tip.w).toBeLessThan(hdmi.w - 2 * e);
    expect(card.tip.h).toBeLessThan(hdmi.h - 2 * e);
    const nic = rj45Real(LAN_R, 0);
    expect(nic.body.w).toBeLessThanOrEqual(MOUTH.w);
    expect(nic.body.h).toBeLessThanOrEqual(MOUTH.main);
    expect(nic.latch.w).toBeLessThan(MOUTH.slotW);
    expect(nic.latch.rise).toBeLessThan(MOUTH.slot);
    // the board's mouths (ioShield): the HDMI 8 in from its shell, the RJ45 16 and 12 in along y, 12 along z, its notch 48 x 8
    const bh = boardHdmi(VIDEO_R), br = boardRj45(LAN_R, 0);
    expect(bh.tip.w).toBeLessThan(2 * IO_HALF.video - 16);
    expect(bh.tip.h).toBeLessThan(IO_Z.video[1] - IO_Z.video[0] - 16);
    expect(br.body.w).toBeLessThan(IO_Z.rj45[1] - IO_Z.rj45[0] - 24);
    expect(br.body.h).toBeLessThan(2 * IO_HALF.rj45 - 28);
    expect(br.latch.w).toBeLessThan(48);
    expect(br.latch.rise).toBeLessThan(8);
  });

  it('build real plugs at a real socket, and keep a real boot to the cable at a smaller one', () => {
    const real = hdmiPlug(hdmiReal(VIDEO_R)), b = new Box3().setFromObject(real.body);
    expect(real.l).toBeCloseTo(HDMI.l * MM);
    expect(real.l).toBeCloseTo(MONITOR_PLUG.l);
    expect((b.max.x - b.min.x) / MM).toBeCloseTo(HDMI.boot.w, 0);
    expect((b.max.y - b.min.y) / MM).toBeGreaterThan(HDMI.boot.h - 0.2);
    expect((b.max.y - b.min.y) / MM).toBeLessThan(HDMI.boot.h + 1.6);
    // the tip goes into the socket, ahead of the mouth (z = -l); the cable leaves at 0
    expect(b.min.z).toBeCloseTo(-real.l - HDMI.in * MM, 0);
    expect(b.max.z).toBeLessThanOrEqual(1);
    const lan = rj45Plug(rj45Real(LAN_R, 0)), c = new Box3().setFromObject(lan.body);
    expect(lan.l).toBeCloseTo(RJ45.l * MM);
    expect((c.max.x - c.min.x) / MM).toBeCloseTo(RJ45.boot.w, 0);
    expect(c.min.z).toBeCloseTo(-lan.l - RJ45.in * MM, 0);
    // at the board, the boot stays a real plug's size to the cable: never thinner than the cable over a real share
    for (const [f, l, h, share] of [[boardHdmi(VIDEO_R), hdmiLength(boardHdmi(VIDEO_R)), HDMI.boot.h, 0.68], [boardRj45(LAN_R, 0), rj45Length(boardRj45(LAN_R, 0)), RJ45.boot.h, 0.62]] as const) {
      const scale = l / (h === HDMI.boot.h ? HDMI.l : RJ45.l);
      expect(scale).toBeGreaterThanOrEqual(f.k);
      expect((2 * f.cable) / (h * scale)).toBeLessThanOrEqual(share + 1e-9);
    }
  });

  it('builds a Swiss plug at real size: the head and the pins go in ahead of the mouth, the plug stands out of it, the cord leaves at 0', () => {
    const f = swissReal(60, 0x18181b), plug = swissPlug(f), b = new Box3().setFromObject(plug.body);
    expect(plug.l).toBeCloseTo(SWISS.l * MM);
    expect(swissLength(f)).toBeCloseTo(plug.l);
    // the head goes 12.5 into the recess and the pins 19 more
    expect(b.min.z).toBeCloseTo(-plug.l - (SWISS.head.l + SWISS.pin.l) * MM, 0);
    expect(b.max.z).toBeLessThanOrEqual(1);
    // (its widest part is the shoulder, a hair over the recess's 39 x 22.1: no more than the 3 mm the pinwheel leaves between two recesses, ribs and all)
    expect((b.max.x - b.min.x) / MM).toBeGreaterThan(39);
    expect((b.max.x - b.min.x) / MM).toBeLessThan(41);
    expect((b.max.y - b.min.y) / MM).toBeGreaterThan(22);
    expect((b.max.y - b.min.y) / MM).toBeLessThan(23.6);
  });

  it('builds the room\'s Swiss plug at its own scale: the head at 14 a mm, the boot kept to the 70 cord, drawn out far enough to clear the pins', () => {
    const k = 14, f = swissReal(70, 0x18181b, k), plug = swissPlug(f), b = new Box3().setFromObject(plug.body);
    // (a cord of 70 needs the boot of a plug 23 units a mm: the grip is 11 mm high at its end and the cord takes 55 of it)
    expect(swissLength(f)).toBeCloseTo((SWISS.l * (2 * 70)) / 0.55 / (22 * SWISS.grip.scale));
    expect(plug.l).toBeCloseTo(swissLength(f));
    expect(b.min.z).toBeCloseTo(-plug.l - (SWISS.head.l + SWISS.pin.l) * k, 0);
    expect((b.max.x - b.min.x) / k).toBeGreaterThan(39);
    expect((b.max.x - b.min.x) / k).toBeLessThan(41);
    // (lined up to go in, the head and the pins are out of the recess and the holes)
    expect(swissEngage(k)).toBeGreaterThan((SWISS.head.l + SWISS.pin.l) * k);
    expect(swissEngage(k)).toBeLessThan((SWISS.head.l + SWISS.pin.l + 2) * k);
    // (and at the studio's scale it is a plug of the same drawing)
    expect(swissReal(70, 0x18181b).k).toBe(MM);
  });

  it('puts the three pins over the three holes of a socket: live and neutral 19 apart, the earth pin 5 under them, all 4 across', () => {
    const plug = swissPlug(swissReal(70, 0x18181b)), pins: Box3[] = [];
    plug.body.traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | undefined;
      if ((o as Mesh).isMesh && m && m.metalness > 0.5) pins.push(new Box3().setFromObject(o));
    });
    expect(pins).toHaveLength(3);
    const at = pins.map((p) => [(p.min.x + p.max.x) / 2 / MM, (p.min.y + p.max.y) / 2 / MM]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    // (west live or neutral pin, the earth pin in the middle, the east one)
    expect(at[0]![0]).toBeCloseTo(-T13.pitch / 2, 1);
    expect(at[2]![0]).toBeCloseTo(T13.pitch / 2, 1);
    expect(at[1]![0]).toBeCloseTo(0, 1);
    expect(at[0]![1]).toBeCloseTo(T13.ln, 1);
    expect(at[2]![1]).toBeCloseTo(T13.ln, 1);
    expect(at[1]![1]).toBeCloseTo(T13.ln - T13.earth, 1);
    for (const p of pins) {
      expect((p.max.x - p.min.x) / MM).toBeCloseTo(4, 1);
      expect(p.min.z).toBeCloseTo(-plug.l - (SWISS.head.l + SWISS.pin.l) * MM, 0);
    }
    // each pin goes into a hole 4.6 across: a hair of play
    expect(T13.hole).toBeGreaterThan(SWISS.pin.d);
  });

  it('draws the socket\'s recess as the traced hexagon, 39 x 22.1, and the plug\'s head a hair inside it', () => {
    const w = (p: [number, number][]): number => Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]));
    const h = (p: [number, number][]): number => Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]));
    const r = lozenge(0), hd = lozenge(SWISS.head.fit);
    expect(w(r)).toBeGreaterThan(38.5);
    expect(w(r)).toBeLessThan(39.5);
    expect(h(r)).toBeCloseTo(22.1, 1);
    expect(w(hd)).toBeCloseTo(w(r) - 2 * SWISS.head.fit, 0);
    expect(h(hd)).toBeCloseTo(h(r) - 2 * SWISS.head.fit, 0);
    // (the three holes of the socket lie inside its recess, clear of its edge)
    for (const [x, y] of [[-T13.pitch / 2, T13.ln], [T13.pitch / 2, T13.ln], [0, T13.ln - T13.earth]] as const) {
      expect(Math.abs(x) + T13.hole / 2).toBeLessThan(w(r) / 2 - 4);
      expect(Math.abs(y) + T13.hole / 2).toBeLessThan(h(r) / 2 - 3);
    }
  });
});
