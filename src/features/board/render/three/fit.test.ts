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
import * as card3d from './card3d';
import { cagePlan, onTray } from './drivecage3d';
import { HDD_MM, SSD_MM } from './drive3d';
import { COOLER_FROM, JACK, JACK_X } from './niccopper';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

// The fit checks: the removal graph's cover rules (sim/removal.ts) and the 3D models must agree, and every part must sit inside its board and case.
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
afterEach(() => {
  setLayoutTier(...was);
});

function recordM2Overlaps(
  g: ReturnType<typeof geoOf>,
  foot: { x: number; y: number; w: number; h: number },
  card: { id: string; k: number; found: string[]; rule: string[] },
): void {
  for (const [i, m] of g.m2.entries()) {
    if (overlaps(foot, m2Stick(m))) {
      card.found.push(`${card.id}@pcie${card.k}>m2${i}`);
    }
    if (overM2(card.id, `pcie${card.k}`, `m2${i}`)) {
      card.rule.push(`${card.id}@pcie${card.k}>m2${i}`);
    }
  }
}

describe('fit: the cover rules match the models', () => {
  it("a card covers the next PCIe slot when its cooler stands less than a finger from that slot's card, and never fouls it", () => {
    const FINGER = 15 * 23;
    for (let t = 1; t < BOARD_TIERS.length; t++) {
      const { pcie } = geoOf(t),
        pitch = must(pcie[1]).y - must(pcie[0]).y;
      for (const kind of ['gpu', 'npu', 'nic'] as const) {
        const reach = Math.max(...[...specsOfKind(kind)].map((s) => card3d.cardReach(kind, s.visual).south));
        const next = Math.max(
          ...(['gpu', 'npu', 'nic'] as const).flatMap((k) =>
            specsOfKind(k).map((s) => card3d.cardReach(k, s.visual).north),
          ),
        );
        expect(reach + next, `${kind} on tier ${t}: reaches ${reach} into a ${pitch} pitch`).toBeLessThan(pitch - 20);
        expect(or(COVERS[kind], 0), `${kind} on tier ${t}: reaches ${reach}, pitch ${pitch}`).toBe(
          pitch - reach < FINGER ? 1 : 0,
        );
      }
    }
  });

  it("a NIC's jacks stand 13.5 mm up its top face, toward the slot north of it: they would foul the cooler of a card there, so a cooler starts east of them", () => {
    for (let t = 1; t < BOARD_TIERS.length; t++) {
      const { pcie } = geoOf(t),
        pitch = must(pcie[1]).y - must(pcie[0]).y;
      for (const kind of ['gpu', 'npu'] as const) {
        const reach = Math.max(...[...specsOfKind(kind)].map((s) => card3d.cardReach(kind, s.visual).south));
        expect(
          reach + JACK.h,
          `${kind} on tier ${t}: a cooler of ${reach} over a jack of ${JACK.h} in a ${pitch} pitch`,
        ).toBeGreaterThan(pitch - 20);
      }
    }
    // (the jacks end west of where a cooler starts, and the cooler's start is no more than a finger from the bracket)
    expect(JACK_X + JACK.d - BD.x).toBeLessThan(COOLER_FROM);
    expect(COOLER_FROM).toBeLessThan(16 * 23);
  });

  it('the cards whose coolers stand over an M.2 stick are exactly the ones in OVER_M2', () => {
    for (let t = 2; t < BOARD_TIERS.length; t++) {
      const g = geoOf(t),
        widths = must(BOARD_TIERS[t]).pcieWidths,
        found: string[] = [],
        rule: string[] = [];
      for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu'), ...specsOfKind('nic')]) {
        const r = card3d.cardReach(s.kind, s.visual);
        for (const [k, w] of widths.entries()) {
          if (w < or(s.pcieWidth, 1)) {
            continue;
          }
          const y0 = must(g.pcie[k]).y + 30,
            foot = { x: BD.x, y: y0 - r.north, w: r.len, h: r.north + r.south };
          recordM2Overlaps(g, foot, { id: s.id, k, found, rule });
        }
      }
      expect(found.toSorted(), `tier ${t}`).toStrictEqual(rule.toSorted());
    }
  });
});

describe('fit: every part has a socket', () => {
  it('each CPU, RAM, cooler and card fits the board tiers that have its slot', () => {
    for (const k of ['cpu', 'ram', 'cooler', 'gpu', 'npu', 'nic', 'storage', 'tpm', 'vrm-sink', 'ram-sink'] as const) {
      for (const s of specsOfKind(k)) {
        const tiers = BOARD_TIERS.filter(
          (b) =>
            or(b.slots[s.slot], 0) > 0 &&
            (s.pcieWidth === undefined || b.pcieWidths.some((w) => w >= must(s.pcieWidth))),
        );
        expect(tiers.length, `${s.id} fits no board`).toBeGreaterThan(0);
      }
    }
  });

  it('every card is shorter than the board and its case holds the board', () => {
    for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu')]) {
      expect(CARD_LEN[s.visual]).toBeGreaterThan(0);
    }
    for (const b of BOARD_TIERS) {
      expect(CASE_TIERS.some((c) => c.maxBoard >= b.tier)).toBe(true);
    }
  });
});

describe('fit: parts stay inside the case', () => {
  it('every standing card is lower than the glass, and ends west of the cable gutter of the smallest case that takes it', () => {
    for (let t = 0; t < BOARD_TIERS.length; t++) {
      setLayoutTier(t, t);
      const glass = CASE_Z + CASE_D;
      for (const kind of ['gpu', 'npu', 'nic'] as const) {
        expect(card3d.HINGE_Z + card3d.STAND[kind], `${kind} in case ${t}`).toBeLessThan(glass - 200);
      }
      for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu'), ...specsOfKind('nic')]) {
        if (!must(BOARD_TIERS[t]).pcieWidths.some((w) => w >= or(s.pcieWidth, 1))) {
          continue;
        }
        expect(BD.x + card3d.cardReach(s.kind, s.visual).len, `${s.id} on board ${t}`).toBeLessThan(GUTTER_X - 40);
      }
    }
    expect(card3d.HINGE_Z).toBeGreaterThan(BOARD_Z);
  });
});

describe('fit: the drive cage in the air', () => {
  it('the share of each front fan a drive in the main cage blocks is the airflow table (sim/airflow.ts BAY_SHADE)', () => {
    for (let t = 0; t < CASE_TIERS.length; t++) {
      setLayoutTier(t, t);
      const fans = frontFanRects();
      for (const hdd of [true, false]) {
        const d = hdd ? HDD_MM : SSD_MM,
          o = onTray(hdd),
          table = must(BAY_SHADE[t])[hdd ? 'hdd' : 'ssd'];
        // the drive's cross-section across the air (layout y down, depth z) over each fan's face (its depth capped as the 3D fan is)
        const got = cagePlan().trays.map((tr) => {
          const y0 = -(tr.y + o.y) - d.t * 23,
            y1 = y0 + d.t * 23,
            z0 = tr.z + o.z,
            z1 = z0 + d.l * 23;
          return fans.map((f) => {
            const s = Math.min(f.h, FAN_MAX),
              a = FAN_ZC - s / 2;
            return (
              (Math.max(0, Math.min(y1, f.y + f.h) - Math.max(y0, f.y)) *
                Math.max(0, Math.min(z1, a + s) - Math.max(z0, a))) /
              (f.h * s)
            );
          });
        });
        expect(got).toHaveLength(table.length);
        for (const [i, row] of got.entries()) {
          for (const [k, v] of row.entries()) {
            expect(v, `case ${t} ${hdd ? 'hdd' : 'ssd'} bay ${i} fan ${k}`).toBeCloseTo(must(must(table[i])[k]), 2);
          }
        }
      }
    }
  });
});
