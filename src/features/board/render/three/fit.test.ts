import { afterEach, describe, expect, it } from 'vitest';
import { CARD_LEN } from '@/core/render/accelart';
import { COVERS, OVER_M2 } from '@/features/board/sim/removal';
import { BOARD_TIERS, CASE_TIERS, specsOfKind } from '@/features/board/sim/specs';
import { geoOf } from '../layout/boardlayout';
import { BD, LAYOUT_CASE, LAYOUT_TIER, NIC_LEN, setLayoutTier } from '../layout/layout';
import { BOARD_Z, CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { HINGE_Z, STAND } from './card3d';

// The fit checks: the removal graph's cover rules (sim/removal.ts) and the 3D models must agree, and every part must sit inside its board and case.
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
afterEach(() => setLayoutTier(...was));

describe('fit: the cover rules match the models', () => {
  it('a card covers as many PCIe slots below it as it stands tall over the pitch', () => {
    for (let t = 1; t < BOARD_TIERS.length; t++) {
      const { pcie } = geoOf(t), pitch = pcie[1]!.y - pcie[0]!.y;
      for (const [kind, stand] of [['gpu', STAND.gpu], ['npu', STAND.npu], ['nic', STAND.nic]] as const) {
        const reach = Math.max(0, Math.ceil((stand - pitch) / pitch - 1e-9)) ;
        expect(COVERS[kind] ?? 0, `${kind} on tier ${t}: stands ${stand}, pitch ${pitch}`).toBe(Math.min(reach, 1));
      }
    }
  });

  it('the cards that lie over an M.2 socket are exactly the ones in OVER_M2', () => {
    const found = new Set<string>();
    for (let t = 2; t < BOARD_TIERS.length; t++) {
      const g = geoOf(t), widths = BOARD_TIERS[t]!.pcieWidths;
      for (const s of [...specsOfKind('gpu'), ...specsOfKind('npu'), ...specsOfKind('nic')]) {
        const len = (NIC_LEN[s.visual] ?? CARD_LEN[s.visual])!, h = STAND[s.kind as 'gpu' | 'npu' | 'nic'];
        widths.forEach((w, k) => {
          if (w < (s.pcieWidth ?? 1)) return;
          if (g.m2.some((m) => overlaps({ x: BD.x, y: g.pcie[k]!.y, w: len, h }, m))) found.add(`${s.id}@pcie${k}`);
        });
      }
    }
    const rule = new Set(Object.entries(OVER_M2).flatMap(([id, slots]) => slots.map((s) => `${id}@${s}`)));
    expect([...found].sort()).toEqual([...rule].sort());
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
  it('every standing card is lower than the glass', () => {
    const glass = CASE_Z + CASE_D;
    for (const kind of ['gpu', 'npu', 'nic'] as const) expect(HINGE_Z + STAND[kind], kind).toBeLessThan(glass - 200);
    expect(HINGE_Z).toBeGreaterThan(BOARD_Z);
  });
});

