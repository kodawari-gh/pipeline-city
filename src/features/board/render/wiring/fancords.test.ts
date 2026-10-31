import { describe, expect, it } from 'vitest';
import { caseMounts } from '../../sim/specs';
import { fanMounts, hubHeaders } from '@/features/room/render/desk/case';
import { fanCordPlans } from './fancords';
import { setLayoutTier } from '../layout/layout';

const TIERS = [0, 1, 2, 3];

describe('the case fan mounts', () => {
  it('are the sim\'s mounts, in the same order, for every case', () => {
    for (const t of TIERS) {
      setLayoutTier(t, t);
      expect(fanMounts().map((m) => m.id), `case ${t}`).toEqual(caseMounts(t));
    }
  });

  it('each has a header on the hub', () => {
    for (const t of TIERS) {
      setLayoutTier(t, t);
      expect(hubHeaders().length, `case ${t}`).toBe(fanMounts().length);
    }
  });
});

describe('the fan cables\' geometry', () => {
  it('has one cable per case fan next to the cooler\'s, the two heatsink fans\' and the hub\'s', () => {
    for (const t of TIERS) {
      setLayoutTier(t, t);
      const ids = fanCordPlans().map((p) => p.id);
      expect(new Set(ids).size, `case ${t}`).toBe(ids.length);
      for (const m of fanMounts()) expect(ids, `case ${t}`).toContain(`fan:${m.id}`);
      for (const id of ['cpufan', 'sysfan']) expect(ids, `case ${t}`).toContain(id);
    }
  });

  it('seats each plug inside its header and leaves it, when loose, outside the drop radius of every seat', () => {
    for (const t of TIERS) {
      setLayoutTier(t, t);
      const plans = fanCordPlans();
      for (const p of plans) {
        const h = p.header;
        expect(p.seat[0], `${t} ${p.id}`).toBeGreaterThan(h.x - 1); expect(p.seat[0], `${t} ${p.id}`).toBeLessThan(h.x + h.w + 1);
        expect(p.seat[1], `${t} ${p.id}`).toBeGreaterThan(h.y - 40); expect(p.seat[1], `${t} ${p.id}`).toBeLessThan(h.y + h.h + 40);
        for (const q of plans) {
          expect(Math.hypot(p.rest[0] - q.seat[0], p.rest[1] - q.seat[1]), `${t} ${p.id} rests on ${q.id}`).toBeGreaterThan(q.seatR);
        }
      }
    }
  });

  it('keeps the case fans\' seats a plug apart, so a drop can only mean one header', () => {
    for (const t of TIERS) {
      setLayoutTier(t, t);
      const seats = fanCordPlans().filter((p) => p.id.startsWith('fan:'));
      for (const a of seats) for (const b of seats) if (a !== b) expect(Math.hypot(a.seat[0] - b.seat[0], a.seat[1] - b.seat[1]), `${t} ${a.id}/${b.id}`).toBeGreaterThan(a.seatR + b.seatR - 1);
    }
  });
});
