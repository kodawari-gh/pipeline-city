import { describe, expect, it } from 'vitest';
import { caseMounts } from '../../sim/specs';
import { fanMounts, hubHeaders } from '@/features/room/render/desk/props/case';
import { fanCordPlans } from './fancords';
import { setLayoutTier } from '../layout/layout';

const TIERS = [0, 1, 2, 3];

function assert_are_the_sim_s_mounts_in_the_same_order_for_every(): void {
  for (const t of TIERS) {
    setLayoutTier(t, t);
    expect(
      fanMounts().map((m) => m.id),
      `case ${t}`,
    ).toStrictEqual(caseMounts(t));
  }
}

function assert_each_has_a_header_on_the_hub(): void {
  for (const t of TIERS) {
    setLayoutTier(t, t);
    expect(hubHeaders()).toHaveLength(fanMounts().length);
  }
}

function assert_has_one_cable_per_case_fan_next_to_the_cooler_s_(): void {
  for (const t of TIERS) {
    setLayoutTier(t, t);
    const ids = fanCordPlans().map((p) => p.id);
    expect(new Set(ids).size, `case ${t}`).toBe(ids.length);
    for (const m of fanMounts()) {
      expect(ids, `case ${t}`).toContain(`fan:${m.id}`);
    }
    for (const id of ['cpufan', 'sysfan']) {
      expect(ids, `case ${t}`).toContain(id);
    }
  }
}

function assert_seats_each_plug_inside_its_header_and_leaves_it_(): void {
  for (const t of TIERS) {
    setLayoutTier(t, t);
    const plans = fanCordPlans();
    for (const p of plans) {
      const h = p.header;
      expect(p.seat[0], `${t} ${p.id}`).toBeGreaterThan(h.x - 1);
      expect(p.seat[0], `${t} ${p.id}`).toBeLessThan(h.x + h.w + 1);
      expect(p.seat[1], `${t} ${p.id}`).toBeGreaterThan(h.y - 40);
      expect(p.seat[1], `${t} ${p.id}`).toBeLessThan(h.y + h.h + 40);
      for (const q of plans) {
        expect(
          Math.hypot(p.rest[0] - q.seat[0], p.rest[1] - q.seat[1]),
          `${t} ${p.id} rests on ${q.id}`,
        ).toBeGreaterThan(q.seatR);
      }
    }
  }
}

function assert_keeps_the_case_fans_seats_a_plug_apart_so_a_drop(): void {
  for (const t of TIERS) {
    setLayoutTier(t, t);
    const seats = fanCordPlans().filter((p) => p.id.startsWith('fan:'));
    for (const [i, a] of seats.entries()) {
      for (const b of seats.slice(i + 1)) {
        expect(Math.hypot(a.seat[0] - b.seat[0], a.seat[1] - b.seat[1]), `${t} ${a.id}/${b.id}`).toBeGreaterThan(
          a.seatR + b.seatR - 1,
        );
      }
    }
  }
}

describe('the case fan mounts', () => {
  it("are the sim's mounts, in the same order, for every case", () => {
    expect.hasAssertions();
    assert_are_the_sim_s_mounts_in_the_same_order_for_every();
  });

  it('each has a header on the hub', () => {
    expect.hasAssertions();
    assert_each_has_a_header_on_the_hub();
  });
});

describe("the fan cables' geometry", () => {
  it("has one cable per case fan next to the cooler's, the two heatsink fans' and the hub's", () => {
    expect.hasAssertions();
    assert_has_one_cable_per_case_fan_next_to_the_cooler_s_();
  });

  it('seats each plug inside its header and leaves it, when loose, outside the drop radius of every seat', () => {
    expect.hasAssertions();
    assert_seats_each_plug_inside_its_header_and_leaves_it_();
  });

  it("keeps the case fans' seats a plug apart, so a drop can only mean one header", () => {
    expect.hasAssertions();
    assert_keeps_the_case_fans_seats_a_plug_apart_so_a_drop();
  });
});
