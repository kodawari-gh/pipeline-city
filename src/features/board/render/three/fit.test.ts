import { afterEach, describe, expect, it } from 'vitest';
import { CARD_LEN } from '@/core/render/accelart';
import { COVERS, overM2 } from '@/features/board/sim/removal';
import { BAY_SHADE } from '@/features/board/sim/airflow';
import { frontFanRects } from '@/features/room/render/desk/props/case';
import { BOARD_TIERS, CASE_TIERS, specsOfKind } from '@/features/board/sim/specs';
import { geoOf } from '../layout/boardlayout';
import { BD, GUTTER_X, LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { m2Stick } from '../layout/pins';
import { BOARD_Z, CASE_D, CASE_Z, FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { HINGE_Z, STAND, cardReach, type CardKind } from './card3d';
import { cagePlan, onTray } from './drivecage3d';
import { HDD_MM, SSD_MM } from './drive3d';

// The fit checks: the removal graph's cover rules (sim/removal.ts) and the 3D models must agree, and every part must sit inside its board and case.
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
afterEach(() => setLayoutTier(...was));

describe('fit: the cover rules match the models', () => {
  it('a card covers the next PCIe slot when its cooler stands less than a finger from that slot\'s card, and never fouls it', () => {
    const FINGER = 15 * 23;
    for (let t = 1; t < BOARD_TIERS.length; t++) {
      const { pcie } = geoOf(t), pitch = pcie[1]!.y - pcie[0]!.y;
      for (const kind of ['gpu', 'npu', 'nic'] as const) {
        const reach = Math.max(...[...specsOfKind(kind)].map((s) => cardReach(kind, s.visual!).south));
        const next = Math.max(...(['gpu', 'npu', 'nic'] as const).flatMap((k) => specsOfKind(k).map((s) => cardReach(k, s.visual!).north)));
        expect(reach + next, `${kind} on tier ${t}: reaches ${reach} into a ${pitch} pitch`).toBeLessThan(pitch - 20);
        expect(COVERS[kind] ?? 0, `${kind} on tier ${t}: reaches ${reach}, pitch ${pitch}`).toBe(pitch - reach < FINGER ? 1 : 0);
      }
    }
  });

  it('the cards whose coolers stand over an M.2 stick are exactly the ones in OVER_M2', () => {
    for (let t = 2; t < BOARD_TIERS.length; t++) {
      const g = geoOf(t), widths = BOARD_TIERS[t]!.pcieWidths, found: string[] = [], rule: string[] = [];
      for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu'), ...specsOfKind('nic')]) {
        const r = cardReach(s.kind as CardKind, s.visual!);
        widths.forEach((w, k) => {
          if (w < (s.pcieWidth ?? 1)) return;
          const y0 = g.pcie[k]!.y + 30, foot = { x: BD.x, y: y0 - r.north, w: r.len, h: r.north + r.south };
          g.m2.forEach((m, i) => {
            if (overlaps(foot, m2Stick(m))) found.push(`${s.id}@pcie${k}>m2${i}`);
            if (overM2(s.id, `pcie${k}`, `m2${i}`)) rule.push(`${s.id}@pcie${k}>m2${i}`);
          });
        });
      }
      expect(found.sort(), `tier ${t}`).toEqual(rule.sort());
    }
  });
});

describe('fit: every part has a socket', () => {
  it('each CPU, RAM, cooler and card fits the board tiers that have its slot', () => {
    for (const k of ['cpu', 'ram', 'cooler', 'gpu', 'npu', 'nic', 'storage', 'tpm', 'vrm-sink', 'ram-sink'] as const) {
      for (const s of specsOfKind(k)) {
        const tiers = BOARD_TIERS.filter((b) => (b.slots[s.slot] ?? 0) > 0 && (s.pcieWidth === undefined || b.pcieWidths.some((w) => w >= s.pcieWidth!)));
        expect(tiers.length, `${s.id} fits no board`).toBeGreaterThan(0);
      }
    }
  });

  it('every card is shorter than the board and its case holds the board', () => {
    for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu')]) expect(CARD_LEN[s.visual], s.id).toBeGreaterThan(0);
    for (const b of BOARD_TIERS) expect(CASE_TIERS.some((c) => c.maxBoard >= b.tier), b.name).toBe(true);
  });
});

describe('fit: parts stay inside the case', () => {
  it('every standing card is lower than the glass, and ends west of the cable gutter of the smallest case that takes it', () => {
    for (let t = 0; t < BOARD_TIERS.length; t++) {
      setLayoutTier(t, t);
      const glass = CASE_Z + CASE_D;
      for (const kind of ['gpu', 'npu', 'nic'] as const) expect(HINGE_Z + STAND[kind], `${kind} in case ${t}`).toBeLessThan(glass - 200);
      for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu'), ...specsOfKind('nic')]) {
        if (!BOARD_TIERS[t]!.pcieWidths.some((w) => w >= (s.pcieWidth ?? 1))) continue;
        expect(BD.x + cardReach(s.kind as CardKind, s.visual!).len, `${s.id} on board ${t}`).toBeLessThan(GUTTER_X - 40);
      }
    }
    expect(HINGE_Z).toBeGreaterThan(BOARD_Z);
  });
});

describe('fit: the drive cage in the air', () => {
  it('the share of each front fan a drive in the main cage blocks is the airflow table (sim/airflow.ts BAY_SHADE)', () => {
    for (let t = 0; t < CASE_TIERS.length; t++) {
      setLayoutTier(t, t);
      const fans = frontFanRects();
      for (const hdd of [true, false]) {
        const d = hdd ? HDD_MM : SSD_MM, o = onTray(hdd), table = BAY_SHADE[t]![hdd ? 'hdd' : 'ssd'];
        // the drive's cross-section across the air (layout y down, depth z) over each fan's face (its depth capped as the 3D fan is)
        const got = cagePlan().trays.map((tr) => {
          const y0 = -(tr.y + o.y) - d.t * 23, y1 = y0 + d.t * 23, z0 = tr.z + o.z, z1 = z0 + d.l * 23;
          return fans.map((f) => {
            const s = Math.min(f.h, FAN_MAX), a = FAN_ZC - s / 2;
            return (Math.max(0, Math.min(y1, f.y + f.h) - Math.max(y0, f.y)) * Math.max(0, Math.min(z1, a + s) - Math.max(z0, a))) / (f.h * s);
          });
        });
        expect(got.length, `case ${t}`).toBe(table.length);
        got.forEach((row, i) => row.forEach((v, k) => expect(v, `case ${t} ${hdd ? 'hdd' : 'ssd'} bay ${i} fan ${k}`).toBeCloseTo(table[i]![k]!, 2)));
      }
    }
  });
});
