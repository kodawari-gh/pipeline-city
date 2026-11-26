// The radiator's side plate toward the glass (cooler3d.ts `radiatorModel`): a lit edge along both folds, and a brushed panel with the model's
// plate in its middle, framed in the loop's accent.
import type { MeshStandardMaterial } from 'three';
import { drawLockup, lockupWidth } from '@/core/render/brands';
import { rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { FAN_LEN } from '../../layout/layout';
import { brushed as streaks, tex, tiled } from '../casekit3d';
import { radAlu } from './look';
import type { Rad } from './radFrame';

/** The model's plate: its name (the length of its fans and its thickness, as a radiator's name gives them), along the side or across it. */
function plateLabel(name: string, along: boolean) {
  return tex(`radiator-plate-${name}-${along}`, along ? 128 : 512, along ? 512 : 128, (c, w, h) => {
    c.fillStyle = '#121626';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#a68bff';
    c.lineWidth = 4;
    c.strokeRect(6, 6, w - 12, h - 12);
    if (along) {
      c.translate(w / 2, h / 2);
      c.rotate(-Math.PI / 2);
      c.translate(-h / 2, -w / 2);
    }
    // the maker's mark (its hub in the frame's accent) and the model in its face
    const W = along ? h : w,
      H = along ? w : h;
    const o = { acc: '#a68bff', text: name, cap: 0.56, align: 'center' as const },
      mh = Math.min(H * 0.56, (H * 0.56 * W * 0.88) / lockupWidth('fujin', H * 0.56, o));
    drawLockup(c, 'fujin', W / 2, H / 2, mh, '#c9d0e6', o);
  });
}

/**
 * The side plate toward the glass: a lit edge along both folds, a brushed panel let into it with the model's plate in its middle (the length of
 * its fans and its thickness, as a radiator's name gives them), framed in the loop's accent: its one touch of colour, as on a real radiator.
 * The edges' material back (`count`: the mounts the radiator spans).
 */
export function radPlate(rad: Rad, count: number): MeshStandardMaterial {
  const { root, fr, L, v0, v1, t, side, z1 } = rad;
  const edgeM = radAlu(0xa3_a8_b2, 0.28);
  for (const va of [v0 - 6, v1 - 4]) {
    root.add(rectBox(fr.rect(0, va, L, 10), z1, z1 + 2, edgeM));
  }
  const panel = mat(0x95_9a_a3, { metalness: 0.5, roughness: 0.34, map: tiled(streaks(), 4, 1) });
  root.add(rectBox(fr.rect(160, v0 + t * 0.2, L - 320, t * 0.6), z1, z1 + 3, panel));
  const name = `RX ${Math.round(FAN_LEN / 23) * count} / ${Math.round(t / 23)}`,
    PW = Math.min(1500, L * 0.4),
    PH = Math.min(t * 0.44, 420),
    along = side === 'front';
  const label = plateLabel(name, along);
  root.add(
    rectBox(
      fr.rect(L / 2 - PW / 2, v0 + t / 2 - PH / 2, PW, PH),
      z1 + 3,
      z1 + 7,
      mat(0xff_ff_ff, { map: label, roughness: 0.45, metalness: 0.2 }),
    ),
  );
  return edgeM;
}
