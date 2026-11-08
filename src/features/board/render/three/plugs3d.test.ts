import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { MONITOR_PLUG } from '@/features/room/render/three/monitor3d';
import { IO_HALF, IO_Z } from './boardhw3d';
import { OUTPUTS } from './gpu3d';
import { MOUTH } from './nic3d';
import { boardHdmi, boardRj45, HDMI, hdmiLength, hdmiPlug, hdmiReal, RJ45, rj45Length, rj45Plug, rj45Real } from './plugs3d';

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
});
