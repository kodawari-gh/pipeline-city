import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { boardSlots, deviceSpec } from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';
import { deviceFor, fitSlots, screenRect, socketFor } from './buildpick';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const full = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

function assert_lists_only_sockets_of_the_part_s_own_kind(): void {
  const g = full();
  const { free, swap } = fitSlots(g.board, 'ram0');
  const kind = must(getSpec('ram0')).slot;
  for (const id of [...free, ...swap]) {
    expect(boardSlots(g.board).find((s) => s.id === id)?.type).toBe(kind);
  }
  expect(free.length + swap.length).toBeGreaterThan(0);
}

function assert_knows_a_device_by_its_id_and_by_the_block_or_lan(): void {
  const g = full();
  const cpu = must(g.board.devices.find((d) => deviceSpec(d).kind === 'cpu'));
  expect(deviceFor(cpu.id, g.board)).toBe(cpu);
  expect(deviceFor('cpu.fetch', g.board)).toBe(cpu);
  // (a card in a slot: a lane of it stands for the card)
  const card = must(g.board.devices.find((d) => d.slot.startsWith('pcie')));
  expect(deviceFor(`${card.slot}.lane3`, g.board)).toBe(card);
}

const camera = () => {
  const c = new PerspectiveCamera(30, 2, 1, 1000);
  c.position.set(0, 0, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
};

describe('fitSlots: the sockets a dragged part would fit', () => {
  it("lists only sockets of the part's own kind", () => {
    expect.hasAssertions();
    assert_lists_only_sockets_of_the_part_s_own_kind();
  });

  it('puts the socket of a part of its kind in `swap`, an empty one in `free`', () => {
    const g = full();
    const ram = must(g.board.devices.find((d) => deviceSpec(d).kind === 'ram'));
    const before = fitSlots(g.board, ram.spec);
    expect(before.swap).toContain(ram.slot);
    expect(before.free).not.toContain(ram.slot);
    g.uninstall(ram.id);
    const after = fitSlots(g.board, ram.spec);
    expect(after.free).toContain(ram.slot);
    expect(after.swap).not.toContain(ram.slot);
  });

  it('has no socket for a whole case or board, or an unknown part', () => {
    const g = full();
    expect(fitSlots(g.board, 'case2')).toStrictEqual({ free: [], swap: [] });
    expect(fitSlots(g.board, 'board1')).toStrictEqual({ free: [], swap: [] });
    expect(fitSlots(g.board, 'nothing')).toStrictEqual({ free: [], swap: [] });
  });
});

describe('deviceFor and socketFor: what an id of the scene stands for', () => {
  it('knows a device by its id, and by the block or lane of it that was hit', () => {
    expect.hasAssertions();
    assert_knows_a_device_by_its_id_and_by_the_block_or_lan();
  });

  it("answers the power supply's stand-in, and nothing for a cable, a socket or the case", () => {
    const g = full();
    expect(deviceFor('psu', g.board)).toBe(g.board.devices.find((d) => deviceSpec(d).kind === 'psu'));
    expect(deviceFor('cable.atx', g.board)).toBeNull();
    expect(deviceFor('dimm0', g.board)).toBeNull();
    expect(deviceFor('case.side', g.board)).toBeNull();
    expect(deviceFor(null, g.board)).toBeNull();
  });

  it('knows a socket by its id', () => {
    const g = full();
    expect(socketFor('dimm0', g.board)).toBe('dimm0');
    expect(socketFor('case.side', g.board)).toBeNull();
    expect(socketFor(null, g.board)).toBeNull();
  });
});

describe('screenRect', () => {
  const canvas = { x: 10, y: 20, w: 400, h: 200 };

  it('puts a box in front of the eye inside the canvas, around its middle', () => {
    const box = new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5));
    const r = must(screenRect(box, camera(), canvas));
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x + r.w / 2).toBeCloseTo(canvas.x + canvas.w / 2, 0);
    expect(r.y + r.h / 2).toBeCloseTo(canvas.y + canvas.h / 2, 0);
    expect(r.x).toBeGreaterThanOrEqual(canvas.x);
    expect(r.x + r.w).toBeLessThanOrEqual(canvas.x + canvas.w);
  });

  it('is null for an empty box and for a box behind the eye', () => {
    expect(screenRect(new Box3(), camera(), canvas)).toBeNull();
    const behind = new Box3(new Vector3(-5, -5, 200), new Vector3(5, 5, 210));
    expect(screenRect(behind, camera(), canvas)).toBeNull();
  });
});
