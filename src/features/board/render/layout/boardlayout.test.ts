import { describe, expect, it } from 'vitest';
import { BOARD_TIERS } from '../../sim/specs';
import { SINK_FAN_RIM, TIER_GEO, passiveRect, IO_PORTS, ioPort } from './boardlayout';
import * as layout from './layout';
import { fanStubs, frontFanRects, hubHeaders, sataCablePath } from '@/features/room/render/desk/props/case';
import * as routes from '../wiring/routes';
import {
  m2Tie,
  slotTie,
  atx12v,
  cellTop,
  pkgPads,
  xtalPads,
  cpuPowerPins,
  cpuStageCtl,
  atx12vSlots,
  pcieFeed,
  dimmPads,
  dimmPinX,
  dramStageCtl,
  headerPin,
  ioPads,
  legsOf,
  m2Pads,
  pciePads,
  sataPads,
} from './pins';
import { plugRect } from '../devices';

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

const inside = (r: layout.Rect, o: layout.Rect, pad = 0) =>
  r.x >= o.x - pad && r.y >= o.y - pad && r.x + r.w <= o.x + o.w + pad && r.y + r.h <= o.y + o.h + pad;
const overlap = (a: layout.Rect, b: layout.Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const near = (p: [number, number], r: layout.Rect, d: number) =>
  p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;

function lanesCross(x: routes.Lane, y: routes.Lane) {
  for (let i = 1; i < x.pts.length; i++) {
    for (let j = 1; j < y.pts.length; j++) {
      if (cross(must(x.pts[i - 1]), must(x.pts[i]), must(y.pts[j - 1]), must(y.pts[j]))) {
        return true;
      }
    }
  }
  return false;
}

describe.each(TIER_GEO.map((g) => g.tier))('board tier %i geometry', (tier) => {
  const spec = must(BOARD_TIERS[tier]);
  const sockets = () => {
    layout.setLayoutTier(tier);
    return layout.GEO;
  };

  it('has exactly the sockets and phases the sim gives the tier', () => {
    const g = sockets();
    expect(g.dimm).toHaveLength(or(spec.slots.dimm, 0));
    expect(g.pcie).toHaveLength(or(spec.slots.pcie, 0));
    expect(g.sata).toHaveLength(or(spec.slots.sata, 0));
    expect(g.m2).toHaveLength(or(spec.slots.m2, 0));
    expect(g.vrmPhases).toHaveLength(spec.vrm.phases);
    expect(g.dPhases).toHaveLength(spec.ramVrm.phases);
    expect(g.memLand).toHaveLength(g.dimm.length);
  });
  function assert_keeps_every_part_on_the_board_and_nothing_on_top(): void {
    const g = sockets();
    const parts: [string, layout.Rect][] = [
      ['io', g.io],
      ['xtalCpu', g.xtalCpu],
      ['xtalPch', g.xtalPch],
      ['chip', g.chip],
      ['hub', g.hub],
      ['bios', g.bios],
      ['sio', g.sio],
      ['dpwm', g.dpwm],
      ['codec', g.codec],
      ['bat', g.bat],
      ['cpw', g.cpw],
      ['atx', g.atx],
      ['vrm', g.vrm],
      ['dvrm', g.dvrm],
      [
        'socket',
        {
          x: layout.PKG.x - layout.SOCKET_E,
          y: layout.PKG.y - layout.SOCKET_E,
          w: layout.PKG.w + 2 * layout.SOCKET_E,
          h: layout.PKG.h + 2 * layout.SOCKET_E,
        },
      ],
    ];
    for (const [i, d] of g.dimm.entries()) {
      parts.push([`dimm${i}`, { x: d.rect.x - 10, y: d.rect.y - 40, w: d.rect.w + 20, h: d.rect.h + 80 }]);
    }
    for (const [i, r] of g.pcie.entries()) {
      parts.push([`pcie${i}`, r]);
    }
    for (const [i, r] of g.sata.entries()) {
      parts.push([`sata${i}`, r]);
    }
    for (const [i, r] of g.m2.entries()) {
      parts.push([`m2_${i}`, r]);
    }
    for (const h of g.hdrs) {
      parts.push([`hdr_${h.name}`, { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }]);
    }
    if (g.phy) {
      parts.push(['phy', g.phy]);
    }
    if (g.hex) {
      parts.push(['hex', g.hex]);
    }
    if (g.qr) {
      parts.push(['qr', g.qr]);
    }
    for (const [i, p] of g.passives.entries()) {
      parts.push([`passives${i}`, passiveRect(p)]);
    }
    for (const [name, r] of parts) {
      if (name !== 'io') {
        expect(inside(r, g.bd), `${name} inside the board`).toBe(true);
      }
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        expect(
          overlap(must(parts[i])[1], must(parts[j])[1]),
          `${must(parts[i])[0]} and ${must(parts[j])[0]} overlap`,
        ).toBe(false);
      }
    }
    // the phases sit inside their regulator, the heat-sink pads cover the power stages
    for (const p of g.vrmPhases) {
      expect(inside(p, g.vrm)).toBe(true);
    }
    for (const p of g.dPhases) {
      expect(inside(p, g.dvrm)).toBe(true);
    }
    expect(inside(g.pwm, g.vrm)).toBe(true);
  }

  it('keeps every part on the board and nothing on top of anything else', () => {
    expect.hasAssertions();
    assert_keeps_every_part_on_the_board_and_nothing_on_top();
  });

  it("stands each sink fan, its housing round it, on the board and clear of the tall parts and of the cooler's shroud", () => {
    expect.hasAssertions();
    assert_stands_each_sink_fan_its_housing_round_it_on_the();
  });

  function assert_keeps_the_decoupling_out_of_the_socket_s_printed(): void {
    const g = sockets(),
      e = layout.SOCKET_E + layout.SOCKET_KEEP,
      x = Math.min(layout.PKG.x - e, layout.COOLER.x),
      y = Math.min(layout.PKG.y - e, layout.COOLER.y);
    const keep = { x, y, w: -2 * x, h: -2 * y }; // (both centred on the socket, the origin)
    for (const p of g.passives) {
      expect(overlap(passiveRect(p), keep), `passives at ${p.x},${p.y}`).toBe(false);
    }
  }

  it("keeps the decoupling out of the socket's printed keep-out and from under the cooler's plate", () => {
    expect.hasAssertions();
    assert_keeps_the_decoupling_out_of_the_socket_s_printed();
  });

  function assert_routes_every_memory_bundle_without_crossing_another(): void {
    sockets();
    const mem = must(routes.buildBuses().find((b) => b.id === 'mem'));
    const taps = must(mem.taps);
    expect(taps.length).toBe(spec.slots.dimm);
    for (let i = 0; i < taps.length; i++) {
      for (let j = i + 1; j < taps.length; j++) {
        for (const a of must(taps[i]).lanes) {
          for (const b of must(taps[j]).lanes) {
            expect(lanesCross(a, b), `dimm${i} and dimm${j} cross`).toBe(false);
          }
        }
      }
    }
  }

  it('routes every memory bundle without crossing another', () => {
    expect.hasAssertions();
    assert_routes_every_memory_bundle_without_crossing_another();
  });
  function assert_gives_every_stick_its_lanes_along_its_length_non(): void {
    const g = sockets();
    const mem = must(routes.buildBuses().find((b) => b.id === 'mem'));
    for (const [i, t] of must(mem.taps).entries()) {
      const ys = t.lanes.map((l) => must(l.pts.at(-1))[1]);
      if (ys.length > 1) {
        expect(Math.max(...ys) - Math.min(...ys), `stick ${i}'s lanes spread along it`).toBeGreaterThan(900);
      }
      for (const l of t.lanes) {
        for (const part of routes.visibleParts(l)) {
          for (const [x] of part) {
            for (const d of g.dimm.slice(0, i)) {
              expect(
                x > d.rect.x + 40 && x < d.rect.x + d.rect.w,
                `stick ${i}'s lane shows on the surface at socket x ${d.rect.x}`,
              ).toBe(false);
            }
          }
        }
      }
    }
  }

  it('gives every stick its lanes along its length, none of them showing on the surface under a socket before its own', () => {
    expect.hasAssertions();
    assert_gives_every_stick_its_lanes_along_its_length_non();
  });
  function assert_ends_every_signal_bus_on_a_footprint(): void {
    const g = sockets();
    const buses = routes.buildBuses();
    const by = (id: routes.Bus['id']) => buses.find((b) => b.id === id);
    const socket = {
      x: layout.PKG.x - layout.SOCKET_E,
      y: layout.PKG.y - layout.SOCKET_E,
      w: layout.PKG.w + 2 * layout.SOCKET_E,
      h: layout.PKG.h + 2 * layout.SOCKET_E,
    };
    const ends = (lanes: routes.Lane[]) => lanes.flatMap((l) => [must(l.pts[0]), must(l.pts.at(-1))]);
    // memory: one end on the socket frame, the other on the pin column of its DIMM, along the socket's length
    for (const [i, t] of must(must(by('mem')).taps).entries()) {
      for (const l of t.lanes) {
        expect(near(must(l.pts[0]), socket, 4)).toBe(true);
        const d = must(g.dimm[i]),
          e = must(l.pts.at(-1));
        expect(e[0], "the lane lands on its socket's pin column").toBeCloseTo(dimmPinX(d.rect), 5);
        expect(e[1]).toBeGreaterThan(d.rect.y + 60);
        expect(e[1]).toBeLessThan(d.rect.y + d.rect.h - 60);
      }
    }
    const lands = (id: routes.Bus['id'], a: layout.Rect, b: layout.Rect, d = 14) => {
      const bus = by(id);
      if (!bus) {
        return;
      }
      for (const l of bus.lanes) {
        const p0 = must(l.pts[0]),
          p1 = must(l.pts.at(-1));
        expect(
          (near(p0, a, d) && near(p1, b, d)) || (near(p0, b, d) && near(p1, a, d)),
          `${id} lane ends on its footprints`,
        ).toBe(true);
      }
    };
    lands('dmi', socket, g.chip);
    // USB: socket to hub (the uplink), hub to the plate (a link per port)
    for (const l of must(by('usb')).lanes) {
      const p0 = must(l.pts[0]),
        p1 = must(l.pts.at(-1));
      expect(
        (near(p0, socket, 6) && near(p1, g.hub, 14)) || (near(p0, g.hub, 14) && near(p1, g.io, 14)),
        'usb lane ends on its footprints',
      ).toBe(true);
    }
    expect(must(by('usb')).lanes).toHaveLength(4 + 2 * g.usb);
    const pcieLaneEnds = (): void => {
      if (!g.pcie[0]) {
        return;
      }
      const b = must(by('pcie'));
      for (const [k, r] of g.pcie.entries()) {
        const { pairs, cpu } = must(g.pcieLinks[k]),
          { lanes } = must(must(b.heads).find((h) => h.name === `pcie${k}`));
        expect(pairs, 'two pairs a lane').toBe(2 * Math.min(must(spec.pcieWidths[k]), 16));
        expect(lanes).toHaveLength(pairs);
        for (const l of lanes) {
          const start = must(l.pts[0]);
          const endPt = must(l.pts.at(-1));
          expect(
            near(start, cpu ? socket : g.chip, 14) && near(endPt, r, 14),
            `slot ${k} lane ends on its footprints`,
          ).toBe(true);
        }
      }
    };
    pcieLaneEnds();
    const nv = by('nvme');
    expect(or(nv?.lanes.length, 0)).toBe(g.m2.length * routes.NVME_LANES);
    for (const l of or(nv?.lanes, [])) {
      expect(
        near(must(l.pts[0]), socket, 6) && g.m2.some((m) => near(must(l.pts.at(-1)), m, 14)),
        'nvme lane ends on a connector',
      ).toBe(true);
    }
    // no two M.2 bundles cross
    const nl = or(nv?.lanes, []);
    for (let i = 0; i < nl.length; i++) {
      for (let j = i + 1; j < nl.length; j++) {
        if (Math.floor(i / routes.NVME_LANES) !== Math.floor(j / routes.NVME_LANES)) {
          expect(lanesCross(must(nl[i]), must(nl[j])), 'nvme bundles cross').toBe(false);
        }
      }
    }
    lands('video', socket, g.io);
    for (const l of must(by('sata')).lanes) {
      expect(g.sata.some((p) => near(must(l.pts.at(-1)), p, 14)) && near(must(l.pts[0]), g.chip, 14)).toBe(true);
    }
    void ends;
  }

  it('ends every signal bus on a footprint', () => {
    expect.hasAssertions();
    assert_ends_every_signal_bus_on_a_footprint();
  });

  it('never runs a signal trace across a PCIe slot, a DIMM, the M.2 or another chip it does not end on', () => {
    expect.hasAssertions();
    assert_never_runs_a_signal_trace_across_a_PCIe_slot_a_D();
  });

  it('ends every signal lane exactly on a pin the art draws', () => {
    expect.hasAssertions();
    assert_ends_every_signal_lane_exactly_on_a_pin_the_art_();
  });

  function assert_never_doubles_a_lane_back_on_itself_and_keeps_ev(): void {
    sockets();
    for (const b of routes.buildBuses()) {
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) {
        for (let i = 2; i < l.pts.length; i++) {
          const a = must(l.pts[i - 2]),
            p = must(l.pts[i - 1]),
            q = must(l.pts[i]);
          const u = [p[0] - a[0], p[1] - a[1]],
            v = [q[0] - p[0], q[1] - p[1]];
          const lu = Math.hypot(must(u[0]), must(u[1])),
            lv = Math.hypot(must(v[0]), must(v[1]));
          if (lu < 1e-6 || lv < 1e-6) {
            continue;
          }
          const cos = (must(u[0]) * must(v[0]) + must(u[1]) * must(v[1])) / (lu * lv);
          expect(cos).toBeGreaterThan(0.05);
          const ang = Math.round((Math.atan2(must(v[1]), must(v[0])) * 180) / Math.PI);
          expect([0, 45, 90, 135, 180, -45, -90, -135, -180].some((d) => Math.abs(ang - d) <= 1)).toBe(true);
        }
      }
    }
  }

  it('starts every lane that leaves the CPU on a pin of its package (one of its three rows, on the 20 grid), each pin used once', () => {
    expect.hasAssertions();
    assert_starts_every_lane_that_leaves_the_CPU_on_a_pin_o();
  });

  it('wires every controller, bridge and header to a pin the art draws', () => {
    expect.hasAssertions();
    assert_wires_every_controller_bridge_and_header_to_a_pi();
  });

  it('never doubles a lane back on itself, and keeps every bend at 45 or 90 degrees', () => {
    expect.hasAssertions();
    assert_never_doubles_a_lane_back_on_itself_and_keeps_ev();
  });

  it('crosses no two signal lanes of different buses, except where one dives under the other', () => {
    expect.hasAssertions();
    assert_crosses_no_two_signal_lanes_of_different_buses_e();
  });

  it('puts no hop via on a trace of another bus', () => {
    expect.hasAssertions();
    assert_puts_no_hop_via_on_a_trace_of_another_bus();
  });

  function assert_matches_the_length_of_every_group_of_lanes_that_(): void {
    sockets();
    for (const b of routes.buildBuses()) {
      for (const grp of or(b.groups, [])) {
        const lens = grp.map((l) => l.len),
          skew = Math.max(...lens) - Math.min(...lens);
        expect(
          skew,
          `${b.id} group of ${grp.length} (${Math.round(Math.max(...lens))} long) differs by ${skew.toFixed(1)}`,
        ).toBeLessThan(1.5);
      }
    }
  }

  it('matches the length of every group of lanes that must arrive together', () => {
    expect.hasAssertions();
    assert_matches_the_length_of_every_group_of_lanes_that_();
  });

  it('keeps the traces of different buses apart (the junctions of the controller lines and the header trunk aside)', () => {
    expect.hasAssertions();
    assert_keeps_the_traces_of_different_buses_apart_the_ju();
  });
  function assert_lines_the_power_rails_up_every_phase_lands_on_it(): void {
    const g = sockets();
    const buses = routes.buildBuses(),
      by = (id: routes.Bus['id']) => must(buses.find((b) => b.id === id));
    // the 12 V run from the 24-pin arrives level with the memory regulator's input rail and covers every phase's input stub
    const p12 = must(by('pwr12').lanes[0]),
      rail12 = must(p12.pts[0])[1];
    expect(rail12).toBeCloseTo(g.dRailY, 5);
    for (const r of g.dPhases) {
      expect(
        must(p12.pts.at(-1))[0] <= r.x + routes.DRAM_IN_X + 1 && must(p12.pts[0])[0] >= r.x + routes.DRAM_IN_X,
        'input stub on the 12 V run',
      ).toBe(true);
    }
    // the memory rail: it starts before the first phase's output and ends after the last, every phase's output and every socket's drop lands on it
    const vd = by('vdimm'),
      runs = vd.lanes.slice(0, 2),
      x0 = Math.min(...runs.map((l) => must(l.pts[0])[0])),
      x1 = routes.vdimmEnd(g);
    expect(x0).toBeLessThanOrEqual(must(g.dimm[0]).rect.x + 36);
    for (const r of g.dPhases) {
      const x = r.x + routes.DRAM_OUT_X;
      expect(x >= x0 && x <= x1, 'phase output on the rail').toBe(true);
    }
    for (const [i, d] of g.dimm.entries()) {
      const t = must(must(must(vd.taps)[i]).lanes[0]),
        [cx] = must(t.pts[0]),
        y0 = must(t.pts[0])[1];
      expect(cx > d.rect.x && cx < d.rect.x + d.rect.w, `socket ${i}'s drop is on the socket`).toBe(true);
      expect(y0, `socket ${i} drops from the rail`).toBeCloseTo(g.vdimmY, 5);
      expect(cx >= x0 && cx <= x1, `socket ${i} is under the rail`).toBe(true);
    }
    // the core-voltage supply: the 8-pin's comb rail covers every phase's input stubs; each phase's output stub is inside its block
    const comb = must(by('pwrcpu').lanes[0]),
      railEnd = must(comb.pts.at(-1))[0];
    expect(must(comb.pts.at(-1))[1]).toBeCloseTo(g.vrmRailY, 5);
    for (const r of g.vrmPhases) {
      expect(
        railEnd >= r.x + 232 && Math.min(...comb.pts.map((q) => q[0])) <= r.x + 60,
        'input stubs under the comb rail',
      ).toBe(true);
      expect(routes.VRM_OUT_X > 0 && routes.VRM_OUT_X < r.w, 'output stub inside the block').toBe(true);
    }
    // the 24-pin's 12 V pin sits on the memory regulator's rail
    expect(atx12v(g.atx)[1]).toBeCloseTo(g.dRailY, 5);
  }

  it('lines the power rails up: every phase lands on its rail, every socket takes its voltage from the rail', () => {
    expect.hasAssertions();
    assert_lines_the_power_rails_up_every_phase_lands_on_it();
  });

  it('keeps every mounting hole clear: no part, lane or other hole within its keepout', () => {
    expect.hasAssertions();
    assert_keeps_every_mounting_hole_clear_no_part_lane_or_();
  });

  function assert_seats_every_cable_plug_on_its_connector(): void {
    const g = sockets();
    const cables = routes.buildCables();
    const conn: Record<string, layout.Rect | null> = {
      atx: g.atx,
      cpu: g.cpw,
      video: {
        x: layout.HDMI_PORT.x - 20,
        y: layout.HDMI_PORT.y - 20,
        w: layout.HDMI_PORT.w + 40,
        h: layout.HDMI_PORT.h + 40,
      },
    };
    for (const c of cables) {
      const want = conn[c.kind];
      expect(want, `${c.kind} has a connector on this board`).toBeTruthy();
      const plug = plugRect(routes.movablePlug(c));
      expect(overlap(plug, must(want)), `${c.kind} plug sits on its connector`).toBe(true);
    }
    expect(
      cables.some((c) => c.kind.startsWith('pcie')),
      'no card, no PCIe lead',
    ).toBe(false);
  }

  it('seats every cable plug on its connector', () => {
    expect.hasAssertions();
    assert_seats_every_cable_plug_on_its_connector();
  });
  function assert_plugs_every_PCIe_lead_into_a_power_socket_of_its(): void {
    sockets();
    // a two-socket card in slot 0 and a one-socket card in slot 1: leads 1, 2 and 3
    const targets: routes.PcieTarget[] = [
      { kind: 'pcie', x: -3400 + 2000, top: 980, plug: 0 },
      { kind: 'pcie2', x: -3400 + 1860, top: 980, plug: 1 },
      { kind: 'pcie3', x: -3400 + 1500, top: 1680, plug: 0 },
    ];
    const cables = routes.buildCables(targets).filter((c) => c.kind.startsWith('pcie'));
    expect(cables.map((c) => c.kind).toSorted()).toStrictEqual(['pcie', 'pcie2', 'pcie3']);
    for (const c of cables) {
      const t = must(targets.find((q) => q.kind === c.kind)),
        pr = plugRect(c.b);
      expect(
        pr.x < t.x && pr.x + pr.w > t.x && Math.abs(c.b.y - (t.top + 20)) < 1,
        `${c.kind} plug sits on its card socket`,
      ).toBe(true);
      expect(
        layout.PSU_PORTS.pcie.some((x) => x === c.a.x),
        `${c.kind} leaves a PSU socket`,
      ).toBe(true);
    }
    expect(new Set(cables.map((c) => c.a.x)).size, 'one PSU socket each').toBe(cables.length);
    for (let i = 0; i < cables.length; i++) {
      for (let j = i + 1; j < cables.length; j++) {
        expect(lanesCross(must(cables[i]).path, must(cables[j]).path), `leads ${i} and ${j} cross`).toBe(false);
      }
    }
  }

  it('plugs every PCIe lead into a power socket of its card, on its own PSU socket, with no two leads crossing', () => {
    expect.hasAssertions();
    assert_plugs_every_PCIe_lead_into_a_power_socket_of_its();
  });

  it('puts a drive-cage cell, with a short cable that crosses no other of its cage, for every SATA port: the first in the basement, the rest in the main cage', () => {
    expect.hasAssertions();
    assert_puts_a_drive_cage_cell_with_a_short_cable_that_c();
  });
  function assert_lays_the_PSU_out_the_unit_under_the_cable_socket(): void {
    sockets();
    expect(inside(layout.PSU_UNIT, layout.PSU)).toBe(true);
    for (const x of [...layout.PSU_PORTS.pcie, layout.PSU_PORTS.atx, layout.PSU_PORTS.cpu]) {
      expect(x > layout.PSU_UNIT.x && x < layout.PSU_UNIT.x + layout.PSU_UNIT.w, 'socket on the unit').toBe(true);
    }
    const fan = {
      x: layout.PSU_FAN.x - layout.PSU_FAN.r - 70,
      y: layout.PSU_FAN.y - layout.PSU_FAN.r - 70,
      w: 2 * layout.PSU_FAN.r + 140,
      h: 2 * layout.PSU_FAN.r + 140,
    };
    for (const [n, r] of [
      ['fan', fan],
      ['label', layout.PSU_LABEL],
    ] as const) {
      expect(inside(r, layout.PSU_UNIT), `${n} on the unit`).toBe(true);
    }
    expect(overlap(fan, layout.PSU_LABEL), 'fan and label').toBe(false);
    for (const [n, r] of [
      ['panel', layout.PSU_PANEL],
      ['vents', layout.VENTS],
    ] as const) {
      expect(inside(r, layout.PSU), `${n} in the strip`).toBe(true);
      expect(overlap(r, layout.PSU_UNIT), `${n} off the unit`).toBe(false);
    }
    expect(overlap(layout.PSU_PANEL, layout.VENTS)).toBe(false);
    expect(layout.VENTS.w, 'the shroud has room for vents').toBeGreaterThan(300);
  }

  it('lays the PSU out: the unit under the cable sockets, the shroud with the readout and the vents beside it, nothing overlapping', () => {
    expect.hasAssertions();
    assert_lays_the_PSU_out_the_unit_under_the_cable_socket();
  });
  function assert_puts_the_fan_hub_in_the_basement_inside_the_case(): void {
    sockets();
    expect(inside(layout.FAN_HUB, layout.CASE_IN), 'hub in the case').toBe(true);
    expect(layout.FAN_HUB.y, 'under the shroud').toBeGreaterThan(layout.PSU.y + 30);
    for (const [n, r] of [
      ['cage', layout.BAY],
      ['slot', layout.FAN_SLOT],
      ...layout.BAY_CELLS.map((c, i) => [`cell ${i}`, c] as const),
    ] as const) {
      expect(overlap(layout.FAN_HUB, r), `hub and ${n}`).toBe(false);
    }
    for (const r of frontFanRects()) {
      expect(overlap(layout.FAN_HUB, r), 'hub and a front fan').toBe(false);
    }
    expect(layout.FAN_HUB.x + layout.FAN_HUB.w, 'west of the cages').toBeLessThan(must(layout.BAY_CELLS[0]).x);
    expect(
      layout.HUB_POWER_Y > layout.FAN_HUB.y && layout.HUB_POWER_Y < layout.FAN_HUB.y + layout.FAN_HUB.h,
      'its power cable runs straight in',
    ).toBe(true);
    expect(
      inside(layout.FAN_SLOT, layout.CASE_IN) && layout.FAN_SLOT.y > layout.BAY.y + layout.BAY.h,
      'the slot is under the cage',
    ).toBe(true);
    const stubs = fanStubs(),
      hdrs = hubHeaders();
    expect(stubs).toHaveLength(frontFanRects().length + layout.TOP_FANS.length + (layout.REAR_FAN_FITTED ? 1 : 0));
    expect(hdrs).toHaveLength(stubs.length);
    for (const h of hdrs) {
      expect(
        h.x - 40 > layout.FAN_HUB.x + 150 && h.x + 40 < layout.FAN_HUB.x + layout.FAN_HUB.w,
        'header on the hub',
      ).toBe(true);
    }
    for (let i = 1; i < hdrs.length; i++) {
      expect(must(hdrs[i]).x - must(hdrs[i - 1]).x, 'headers do not touch').toBeGreaterThan(90);
    }
    for (const f of stubs) {
      expect(
        f.x + f.dx * 90 < layout.CASE_IN.x + layout.CASE_IN.w && f.y + f.dy * 90 < layout.CASE_IN.y + layout.CASE_IN.h,
        'stub inside the case',
      ).toBe(true);
    }
    const sysFan = must(layout.GEO.hdrs.find((h) => h.name === 'SYS_FAN'));
    expect(sysFan.y + 100, 'the board has the header the hub is cabled to').toBeLessThan(layout.BD.y + layout.BD.h);
  }

  it('puts the fan hub in the basement: inside the case under the shroud, west of the basement cage and clear of the fans, a header and a stub for every fan', () => {
    expect.hasAssertions();
    assert_puts_the_fan_hub_in_the_basement_inside_the_case();
  });
  function assert_ties_every_slot_and_M_2_into_the_plane_clear_of_(): void {
    const g = sockets();
    const patches: [string, layout.Rect][] = [
      ...g.pcie.map((r, i) => [`slot ${i}`, slotTie(r, i)] as [string, layout.Rect]),
      ...g.m2.map((m, i) => [`m2 ${i}`, m2Tie(m)] as [string, layout.Rect]),
    ];
    const lanes = routes
      .buildBuses()
      .filter((b) => !['pwrpcie', 'vdimm', 'pwr12', 'pwrcpu', 'vcore'].includes(b.id))
      .flatMap((b) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []));
    for (const [n, r] of patches) {
      expect(inside(r, g.bd), `${n} tie on the board`).toBe(true);
      const grown = { x: r.x - 14, y: r.y - 14, w: r.w + 28, h: r.h + 28 };
      for (const l of lanes) {
        for (const part of routes.visibleParts(l)) {
          for (let i = 1; i < part.length; i++) {
            const a = must(part[i - 1]),
              b = must(part[i]),
              x0 = Math.min(a[0], b[0]),
              x1 = Math.max(a[0], b[0]),
              y0 = Math.min(a[1], b[1]),
              y1 = Math.max(a[1], b[1]);
            if (n.startsWith('slot')) {
              expect(
                x1 > grown.x && x0 < grown.x + grown.w && y1 > grown.y && y0 < grown.y + grown.h,
                `${n}'s tie meets a lane`,
              ).toBe(false);
            }
          }
        }
      }
    }
    for (const [n, r] of patches) {
      if (n.startsWith('slot')) {
        for (const o of [...g.pcie.map((q) => q), ...g.m2, g.chip, g.hub, ...g.dimm.map((d) => d.rect)]) {
          expect(overlap(r, o), `${n}'s tie sits on a part`).toBe(false);
        }
      }
    }
  }

  it('ties every slot and M.2 into the plane clear of everything: the patch is on the board and no lane comes near it', () => {
    expect.hasAssertions();
    assert_ties_every_slot_and_M_2_into_the_plane_clear_of_();
  });

  it('puts the board inside the case, the PSU under it, the bay in the case, and everything in the world', () => {
    sockets();
    expect(inside(layout.BD, layout.CASE_GLASS)).toBe(true);
    expect(layout.PSU.y).toBeGreaterThanOrEqual(layout.BD.y + layout.BD.h);
    expect(layout.PORT_Y).toBe(layout.PSU.y);
    expect(inside(layout.BAY, layout.CASE)).toBe(true);
    expect(inside(layout.CASE, layout.WORLD)).toBe(true);
    expect(layout.PSU.x + layout.PSU.w).toBeLessThanOrEqual(layout.BAY.x);
  });
  function assert_stands_each_sink_fan_its_housing_round_it_on_the(): void {
    const g = sockets(),
      rim = (r: layout.Rect) => ({
        x: r.x - SINK_FAN_RIM,
        y: r.y - SINK_FAN_RIM,
        w: r.w + 2 * SINK_FAN_RIM,
        h: r.h + 2 * SINK_FAN_RIM,
      });
    const tall: [string, layout.Rect][] = [
      ['cpw', g.cpw],
      ['atx', g.atx],
      ['io', g.io],
      ['shroud', { x: -1090, y: -1090, w: 2180, h: 2180 }],
    ];
    for (const [i, d] of g.dimm.entries()) {
      tall.push([`dimm${i}`, d.rect]);
    }
    for (const [i, r] of g.pcie.entries()) {
      tall.push([`pcie${i}`, r]);
    }
    for (const [name, f] of [
      ['vrm', g.vrmFan],
      ['ram', g.dFan],
    ] as const) {
      // (the mini-ITX's memory fan overhangs the board's top edge a little: boardlayout.ts)
      const bd = tier === 0 && name === 'ram' ? { ...g.bd, y: g.bd.y - 100, h: g.bd.h + 100 } : g.bd;
      expect(inside(rim(f), bd), `the ${name} sink fan on the board`).toBe(true);
      expect(inside(rim(f), layout.CASE_IN), `the ${name} sink fan in the case`).toBe(true);
      for (const [t, r] of tall) {
        expect(overlap(rim(f), r), `the ${name} sink fan over ${t}`).toBe(false);
      }
    }
    expect(overlap(rim(g.vrmFan), rim(g.dFan)), 'the two sink fans apart').toBe(false);
  }

  function assert_never_runs_a_signal_trace_across_a_PCIe_slot_a_D(): void {
    const g = sockets();
    const shrink = (r: layout.Rect, d: number): layout.Rect => ({
      x: r.x + d,
      y: r.y + d,
      w: r.w - 2 * d,
      h: r.h - 2 * d,
    });
    // does the segment a-b pass through the inside of r (clipped to it, Liang-Barsky: a 45 degree run beside a part does not count)
    const through = (a: [number, number], b: [number, number], r: layout.Rect) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      let t0 = 0,
        t1 = 1;
      for (const [p, q] of [
        [-dx, a[0] - r.x],
        [dx, r.x + r.w - a[0]],
        [-dy, a[1] - r.y],
        [dy, r.y + r.h - a[1]],
      ] as const) {
        if (p === 0) {
          if (q <= 0) {
            return false;
          }
        } else if (p < 0) {
          t0 = Math.max(t0, q / p);
        } else {
          t1 = Math.min(t1, q / p);
        }
      }
      return t0 < t1;
    };
    const hits = (l: routes.Lane, r: layout.Rect) => {
      for (const part of routes.visibleParts(l)) {
        for (let i = 1; i < part.length; i++) {
          if (through(must(part[i - 1]), must(part[i]), r)) {
            return true;
          }
        }
      } // (where a lane dives it is on an inner layer)
      return false;
    };
    const lanes = routes
      .buildBuses()
      .filter((b) => !['pwr12', 'pwrcpu', 'vcore', 'vdimm', 'mem', 'pwrpcie'].includes(b.id))
      .flatMap((b) => b.lanes.map((l) => ({ id: b.id, l })));
    const solid: [string, layout.Rect][] = [
      ['chip', g.chip],
      ['hub', g.hub],
      ['bat', g.bat],
      ['codec', g.codec],
    ];
    if (g.phy) {
      solid.push(['phy', g.phy]);
    }
    for (const [i, r] of g.m2.entries()) {
      solid.push([`m2_${i}`, r]);
    }
    for (const [i, r] of g.pcie.entries()) {
      solid.push([`pcie${i}`, { x: r.x, y: r.y - 20, w: r.w, h: r.h + 40 }]);
    }
    for (const [i, d] of g.dimm.entries()) {
      solid.push([`dimm${i}`, d.rect]);
    }
    for (const [i, r] of g.sata.entries()) {
      solid.push([`sata${i}`, r]);
    }
    solid.push(['bios', g.bios]);
    for (const [i, p] of g.passives.entries()) {
      solid.push([`passives${i}`, passiveRect(p)]);
    }
    for (const { id, l } of lanes) {
      for (const [name, r] of solid) {
        // a lane may end on its own footprint (its first or last point is on the rect); anything else through it is a crossing
        const ends = near(must(l.pts[0]), r, 16) || near(must(l.pts.at(-1)), r, 16);
        if (id === 'usb' && name === 'hub') {
          continue;
        } // the USB lanes run under their hub controller
        expect(ends || !hits(l, shrink(r, 4)), `${id} crosses ${name}`).toBe(true);
      }
    }
  }

  function assert_ends_every_signal_lane_exactly_on_a_pin_the_art_(): void {
    const g = sockets();
    const buses = routes.buildBuses();
    const by = (id: routes.Bus['id']) => buses.find((b) => b.id === id);
    const hit = (p: [number, number], pins: [number, number][], what: string) => {
      expect(
        pins.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6),
        `${what} ${p}`,
      ).toBe(true);
    };
    const end = (l: routes.Lane) => must(l.pts.at(-1));
    for (const [i, t] of must(must(by('mem')).taps).entries()) {
      const pads = dimmPads(must(g.dimm[i]).rect, must(g.memLand[i]));
      for (const l of t.lanes) {
        hit(end(l), pads, `dimm${i} lane ends on a pad`);
      }
    }
    const nv = by('nvme');
    if (nv) {
      const pads = g.m2.flatMap((m) => m2Pads(m));
      for (const l of nv.lanes) {
        hit(end(l), pads, 'nvme lane ends on a contact');
      }
    }
    const legsN = legsOf(g.chip, 'n');
    for (const l of must(by('dmi')).lanes) {
      hit(end(l), legsN, 'dmi lane ends on a leg');
    }
    for (const l of must(by('sata')).lanes) {
      hit(
        end(l),
        g.sata.flatMap((p) => sataPads(p)),
        'sata lane ends on a port pad',
      );
      hit(must(l.pts[0]), legsOf(g.chip, 'e'), 'sata lane starts on a leg');
    }
    const pciePinEnds = (): void => {
      for (const [k, r] of g.pcie.entries()) {
        const n = must(g.pcieLinks[k]).pairs / 2,
          pcieBus = must(by('pcie')),
          pcieHead = must(must(pcieBus.heads).find((h) => h.name === `pcie${k}`)),
          { lanes } = pcieHead,
          north = pciePads(r, n, 'n'),
          south = pciePads(r, n, 's');
        for (const l of lanes) {
          hit(end(l), [...north, ...south], 'pcie lane ends on a slot pad');
        }
        for (const side of [north, south]) {
          for (const p of side) {
            expect(lanes.filter((l) => Math.hypot(end(l)[0] - p[0], end(l)[1] - p[1]) < 0.6)).toHaveLength(1);
          }
        }
      }
    };
    pciePinEnds();
    const hubW = legsOf(g.hub, 'w'),
      hubE = legsOf(g.hub, 'e');
    for (const l of must(by('usb')).lanes) {
      const a = must(l.pts[0]),
        b = end(l);
      if (b[0] < g.io.x + g.io.w) {
        hit(a, hubW, 'usb lane starts on a hub leg');
        hit(
          b,
          g.usb ? Array.from({ length: g.usb }, (_, p) => ioPads(ioPort(`usb${p}`), 2)).flat() : [],
          'usb lane ends on a port',
        );
      } else {
        hit(b, hubE, 'usb uplink ends on a hub leg');
      }
    }
    for (const l of must(by('video')).lanes) {
      hit(end(l), ioPads(ioPort('hdmi'), 4), 'video lane ends on the HDMI pads');
    }
    if (g.dp) {
      for (const l of must(by('dp')).lanes) {
        hit(end(l), ioPads(ioPort('dp'), 4), 'dp lane ends on the DP pads');
      }
    }
    for (const [k, id] of ['line-out', 'line-in', 'mic'].entries()) {
      const l = must(must(by('audio')).lanes[k]);
      hit(end(l), ioPads(ioPort(id), 1), id);
      hit(must(l.pts[0]), legsOf(g.codec, 'w', 7), 'audio lane starts on a codec leg');
    }
    if (g.phy) {
      for (const l of must(by('lan')).lanes) {
        hit(end(l), ioPads(ioPort('eth'), 4), 'lan lane ends on the RJ45 pads');
        hit(must(l.pts[0]), legsOf(g.phy, 'w', 8), 'lan lane starts on a PHY leg');
      }
    }
    for (const l of must(by('svid')).lanes) {
      hit(must(l.pts[0]), legsOf(g.pwm, 's', 6, 26), 'svid lane starts on a controller leg');
      expect(
        near(
          end(l),
          {
            x: layout.PKG.x - layout.SOCKET_E,
            y: layout.PKG.y - layout.SOCKET_E,
            w: layout.PKG.w + 2 * layout.SOCKET_E,
            h: layout.PKG.h + 2 * layout.SOCKET_E,
          },
          6,
        ),
        'svid lane ends on the socket',
      ).toBe(true);
    }
    // power: the comb starts on the 8-pin's four pins, the 12 V run on the 24-pin's top pin
    for (const [k, l] of must(by('pwrcpu')).lanes.entries()) {
      hit(must(l.pts[0]), [must(cpuPowerPins(g.cpw)[k])], 'pwrcpu lane starts on its pin');
    }
    const pwr12Lane = must(must(by('pwr12')).lanes[0]);
    const pwr12Start = must(pwr12Lane.pts[0]);
    hit(pwr12Start, [atx12v(g.atx)], 'pwr12 starts on the 24-pin');
  }

  function assert_starts_every_lane_that_leaves_the_CPU_on_a_pin_o(): void {
    const g = sockets();
    const onPin = (p: [number, number]) => {
      const gx = (p[0] - (layout.PKG.x + 70)) / 20,
        gy = (p[1] - (layout.PKG.y + 70)) / 20,
        whole = (v: number) => Math.abs(v - Math.round(v)) < 0.03;
      return [24, 44, 64].some(
        (o) =>
          (Math.abs(p[0] - (layout.PKG.x + layout.PKG.w - o)) < 0.6 && whole(gy)) ||
          (Math.abs(p[0] - (layout.PKG.x + o)) < 0.6 && whole(gy)) ||
          (Math.abs(p[1] - (layout.PKG.y + layout.PKG.h - o)) < 0.6 && whole(gx)) ||
          (Math.abs(p[1] - (layout.PKG.y + o)) < 0.6 && whole(gx)),
      );
    };
    const starts: string[] = [];
    for (const b of routes.buildBuses()) {
      if (b.id === 'mem') {
        for (const t of must(b.taps)) {
          for (const l of t.lanes) {
            expect(onPin(must(l.pts[0])), 'mem lane on a pin').toBe(true);
            starts.push(must(l.pts[0]).join(','));
          }
        }
      } else if (b.id === 'nvme' || b.id === 'dmi' || b.id === 'video' || b.id === 'dp' || b.id === 'svid') {
        for (const l of b.lanes) {
          const pin = b.id === 'svid' ? must(l.pts.at(-1)) : must(l.pts[0]);
          expect(onPin(pin), `${b.id} lane on a pin`).toBe(true);
          starts.push(must(l.pts[b.id === 'svid' ? l.pts.length - 1 : 0]).join(','));
        }
      } else if (b.id === 'pcie') {
        for (const [k, c] of g.pcieLinks.entries()) {
          if (c.cpu) {
            for (const l of must(must(b.heads).find((h) => h.name === `pcie${k}`)).lanes) {
              expect(onPin(must(l.pts[0])), 'pcie lane on a pin').toBe(true);
              starts.push(must(l.pts[0]).join(','));
            }
          }
        }
      } else if (b.id === 'usb') {
        for (const l of b.lanes.slice(0, 4)) {
          expect(onPin(must(l.pts[0])), 'usb uplink on a pin').toBe(true);
          starts.push(must(l.pts[0]).join(','));
        }
      }
    }
    expect(new Set(starts).size, 'no two lanes on one pin').toBe(starts.length);
  }

  function assert_wires_every_controller_bridge_and_header_to_a_pi(): void {
    const g = sockets();
    const buses = routes.buildBuses();
    const hit = (p: [number, number], pins: [number, number][], what: string) => {
      expect(
        pins.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6),
        `${what} ${p}`,
      ).toBe(true);
    };
    const end = (l: routes.Lane) => must(l.pts.at(-1)),
      ids = (id: routes.Bus['id']) => buses.filter((b) => b.id === id);
    const wireControllers = (): void => {
      // the regulators' controllers: every phase has a lane from a leg of its controller to its control leg
      const [cpuC, dramC] = ids('pwmc');
      expect(must(cpuC).lanes).toHaveLength(g.vrmPhases.length);
      for (const [k, l] of must(cpuC).lanes.entries()) {
        hit(must(l.pts[0]), legsOf(g.pwm, 'e'), 'cpu phase lane starts on a controller leg');
        hit(end(l), [cpuStageCtl(must(g.vrmPhases[k]))], `cpu phase ${k} lane ends on its control leg`);
      }
      expect(must(dramC).lanes).toHaveLength(g.dPhases.length);
      const dseq = g.dpwmWest ? g.dPhases : [...g.dPhases].toReversed();
      for (const [k, l] of must(dramC).lanes.entries()) {
        hit(must(l.pts[0]), legsOf(g.dpwm, g.dpwmWest ? 'e' : 'w'), 'dram phase lane starts on a controller leg');
        hit(end(l), [dramStageCtl(must(dseq[k]))], `dram phase ${k} lane ends on its control leg`);
      }
      // the I/O hub's links
      for (const l of must(ids('hda')[0]).lanes) {
        hit(must(l.pts[0]), legsOf(g.codec, 'e'), 'hda starts on a codec leg');
        hit(end(l), legsOf(g.hub, 'n').slice(4), 'hda ends on a hub leg');
      }
      if (g.phy) {
        for (const l of must(ids('phyl')[0]).lanes) {
          hit(must(l.pts[0]), legsOf(g.phy, 'e'), 'phy link starts on a PHY leg');
          hit(end(l), legsOf(g.hub, 'n').slice(0, 4), 'phy link ends on a hub leg');
        }
      } else {
        expect(ids('phyl')).toHaveLength(0);
      }
    };
    wireControllers();
    // the I/O controller: its link to the chipset, its header trunk
    for (const l of must(ids('lpc')[0]).lanes) {
      hit(must(l.pts[0]), legsOf(g.sio, 'e'), 'lpc starts on a SIO leg');
      hit(end(l), legsOf(g.chip, 'w'), 'lpc ends on a chipset leg');
    }
    const hdr = must(ids('hdr')[0]),
      row = g.hdrs.filter((h) => !['CLR_CMOS', 'CPU_FAN', 'VRM_FAN', 'RAM_FAN'].includes(h.name));
    expect(hdr.lanes).toHaveLength(1 + row.length);
    hit(must(must(hdr.lanes[0]).pts[0]), legsOf(g.sio, 's'), 'the trunk starts on a SIO leg');
    for (const [i, h] of row.entries()) {
      hit(end(must(hdr.lanes[1 + i])), [headerPin(h.x, h.y, 0, h.rows - 1)], `${h.name} has its tap`);
    }
    // the cell: two lanes from the chipset's south legs onto its top rim, two from its side to the clear-CMOS jumper; the CPU fan's header; the 6-pin's rail
    const rtc = must(ids('rtc')[0]),
      clr = must(g.hdrs.find((h) => h.name === 'CLR_CMOS')),
      fan = must(g.hdrs.find((h) => h.name === 'CPU_FAN'));
    expect(rtc.lanes).toHaveLength(4);
    for (const [i, dx] of [-34, 34].entries()) {
      hit(must(must(rtc.lanes[i]).pts[0]), legsOf(g.chip, 's'), 'rtc starts on a chipset leg');
      hit(end(must(rtc.lanes[i])), [cellTop(g.bat, dx)], 'rtc ends on the cell rim');
    }
    for (const i of [0, 1]) {
      const rtcLane = must(rtc.lanes[2 + i]);
      hit(end(rtcLane), [headerPin(clr.x, clr.y, 0, i)], 'clear-CMOS lane ends on its pin');
      expect(Math.abs(must(rtcLane.pts[0])[1] - end(rtcLane)[1]), 'straight into the jumper').toBeLessThan(0.5);
    }
    expect(inside(g.bat, g.bd) && !overlap(g.bat, g.chip), 'the cell is on the board, clear of the chipset').toBe(true);
    for (const l of must(ids('fanc')[0]).lanes) {
      hit(
        end(l),
        [0, 1, 2, 3].map((i) => headerPin(fan.x, fan.y, i, 0)),
        'cpu fan lane ends on a header pin',
      );
    }
    const fanLane = must(must(ids('fanc')[0]).lanes[0]);
    const fanStart = must(fanLane.pts[0]);
    hit(fanStart, legsOf(g.hub, 's'), 'cpu fan lane starts on a hub leg');
    // the heatsink fans' headers, the crystals
    const [, vf, rf] = ids('fanc'),
      vh = must(g.hdrs.find((h) => h.name === 'VRM_FAN')),
      rh = must(g.hdrs.find((h) => h.name === 'RAM_FAN'));
    for (const l of must(vf).lanes) {
      hit(must(l.pts[0]), legsOf(g.pwm, 'w'), 'vrm fan lane starts on a controller leg');
      hit(
        end(l),
        [0, 1, 2, 3].map((j) => headerPin(vh.x, vh.y, 0, j)),
        'vrm fan lane ends on a pin',
      );
    }
    for (const l of must(rf).lanes) {
      hit(must(l.pts[0]), legsOf(g.dpwm, g.dpwmWest ? 'w' : 'e'), 'ram fan lane starts on a controller leg');
      hit(
        end(l),
        [0, 1, 2, 3].map((j) => headerPin(rh.x, rh.y, 0, j)),
        'ram fan lane ends on a pin',
      );
    }
    // each sink fan's square leaves its header in sight
    const housing = (f: layout.Rect) => ({
      x: f.x - SINK_FAN_RIM,
      y: f.y - SINK_FAN_RIM,
      w: f.w + 2 * SINK_FAN_RIM,
      h: f.h + 2 * SINK_FAN_RIM,
    });
    for (const [f, h] of [
      [g.vrmFan, vh],
      [g.dFan, rh],
    ] as const) {
      expect(
        overlap(housing(f), { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }),
        "a sink fan's housing over its header",
      ).toBe(false);
    }
    const clk = must(ids('clk')[0]);
    expect(clk.lanes).toHaveLength(4);
    for (const [k, l] of clk.lanes.slice(0, 2).entries()) {
      const xtalX = must(xtalPads(g.xtalCpu, 'n')[0])[0];
      hit(must(l.pts[0]), xtalPads(g.xtalCpu, 'n'), 'cpu clock starts on a crystal pad');
      hit(end(l), pkgPads(layout.PKG, 's', xtalX + 10, 2), `cpu clock ${k} ends on a package pin`);
    }
    for (const l of clk.lanes.slice(2)) {
      hit(must(l.pts[0]), xtalPads(g.xtalPch, 's', 13), 'chipset clock starts on a crystal pad');
      hit(end(l), legsOf(g.chip, 'n'), 'chipset clock ends on a north leg');
    }
    {
      const l = must(must(ids('pwrpcie')[0]).lanes[0]);
      hit(must(l.pts[0]), [atx12vSlots(g.atx)], 'the slot rail leaves the 24-pin');
      hit(end(l), [pcieFeed(must(g.pcie[0]))], 'the rail ends on the x16 slot tab');
    }
    // the top board's debug display and RGB strip
    if (g.dbg) {
      for (const l of must(ids('dbg')[0]).lanes) {
        hit(must(l.pts[0]), legsOf(g.chip, 's'), 'dbg starts on a chipset leg');
        expect(end(l)[1]).toBeCloseTo(g.dbg.y, 5);
        expect(end(l)[0] > g.dbg.x && end(l)[0] < g.dbg.x + g.dbg.w).toBe(true);
      }
    } else {
      expect(ids('dbg')).toHaveLength(0);
    }
    if (g.rgb) {
      const l = must(must(ids('rgb')[0]).lanes[0]);
      const argb = must(g.hdrs.find((h) => h.name === 'ARGB'));
      expect(end(l)[0]).toBeCloseTo(g.rgb.x, 5);
      hit(must(l.pts[0]), [headerPin(argb.x, argb.y, 1, 0)], 'rgb starts on the ARGB data pin');
    }
  }

  function assert_crosses_no_two_signal_lanes_of_different_buses_e(): void {
    sockets();
    const groups: { id: string; l: routes.Lane }[] = [];
    for (const b of routes.buildBuses()) {
      if (['pwr12', 'pwrcpu', 'vcore', 'vdimm'].includes(b.id) && !routes.HOP_BUSES.includes(b.id)) {
        continue;
      }
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) {
        groups.push({ id: b.id, l });
      }
    }
    const covered = (l: routes.Lane, s: number) => or(l.hops, []).some(([a, z]) => s > a && s < z);
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const A = must(groups[i]),
          B = must(groups[j]);
        if (A.id === B.id) {
          continue;
        }
        for (const c of routes.crossings(A.l, B.l)) {
          expect(covered(A.l, c.s) || covered(B.l, c.t), `${A.id} crosses ${B.id} without diving under it`).toBe(true);
        }
      }
    }
  }

  function assert_puts_no_hop_via_on_a_trace_of_another_bus(): void {
    sockets();
    const buses = routes.buildBuses(),
      lanesOf = (b: routes.Bus) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []);
    const sd = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy || 1,
        t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const nearestOnBus = (o: routes.Bus, p: [number, number]): number => {
      let gap = Infinity; // (one check a via and bus: the zigzags make for thousands of segments)
      for (const m of lanesOf(o)) {
        for (const part of routes.visibleParts(m)) {
          for (let i = 1; i < part.length; i++) {
            gap = Math.min(gap, sd(p, must(part[i - 1]), must(part[i])));
          }
        }
      }
      return gap;
    };
    for (const b of buses) {
      for (const l of lanesOf(b)) {
        for (const [a, z] of or(l.hops, [])) {
          for (const s of [a, z]) {
            const p = routes.pointAt(l, s),
              vr = Math.max(11, b.w * 0.6);
            for (const o of buses) {
              if (o === b) {
                continue;
              }
              const clearance = nearestOnBus(o, p);
              expect(clearance, `${b.id} via at ${Math.round(p[0])},${Math.round(p[1])} on ${o.id}`).toBeGreaterThan(
                vr + o.w / 2 - 2,
              );
            }
          }
        }
      }
    }
  }

  function assert_keeps_the_traces_of_different_buses_apart_the_ju(): void {
    sockets();
    const sd = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy || 1,
        t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const dist = (x: routes.Lane, y: routes.Lane) => {
      let m = 1e9;
      for (const px of routes.visibleParts(x)) {
        for (const py of routes.visibleParts(y)) {
          for (let i = 1; i < px.length; i++) {
            for (let j = 1; j < py.length; j++) {
              const a = must(px[i - 1]),
                b = must(px[i]),
                c = must(py[j - 1]),
                d = must(py[j]);
              m = Math.min(m, sd(a, c, d), sd(b, c, d), sd(c, a, b), sd(d, a, b));
            }
          }
        }
      }
      return m;
    };
    const lanes: { id: string; l: routes.Lane }[] = [];
    for (const b of routes.buildBuses()) {
      if (['pwr12', 'pwrcpu', 'vcore', 'vdimm', 'pwmc', 'hdr', 'svid', 'pwrpcie'].includes(b.id)) {
        continue;
      }
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) {
        lanes.push({ id: b.id, l });
      }
    }
    for (let i = 0; i < lanes.length; i++) {
      for (let j = i + 1; j < lanes.length; j++) {
        expect(
          dist(must(lanes[i]).l, must(lanes[j]).l),
          `${must(lanes[i]).id} lane ${i} and ${must(lanes[j]).id} lane ${j} too close`,
        ).toBeGreaterThan(12.5);
      }
    }
  }

  function assert_keeps_every_mounting_hole_clear_no_part_lane_or_(): void {
    const g = sockets();
    const R = 66 + 34 + 8; // the hole, its clear ring and a margin
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    const rectDist = (p: [number, number], r: layout.Rect) =>
      Math.hypot(Math.max(r.x - p[0], 0, p[0] - (r.x + r.w)), Math.max(r.y - p[1], 0, p[1] - (r.y + r.h)));
    const buses = routes.buildBuses();
    const lanes = buses.flatMap((b) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []));
    const parts: [string, layout.Rect][] = [
      ['chip', g.chip],
      ['hub', g.hub],
      ['codec', g.codec],
      ['bat', g.bat],
      ['cpw', g.cpw],
      ['atx', g.atx],
      ['vrm', g.vrm],
      ['dvrm', g.dvrm],
      ['io', g.io],
      [
        'socket',
        {
          x: layout.PKG.x - layout.SOCKET_E,
          y: layout.PKG.y - layout.SOCKET_E,
          w: layout.PKG.w + 2 * layout.SOCKET_E,
          h: layout.PKG.h + 2 * layout.SOCKET_E,
        },
      ],
    ];
    for (const [i, d] of g.dimm.entries()) {
      parts.push([`dimm${i}`, d.rect]);
    }
    for (const [i, r] of g.pcie.entries()) {
      parts.push([`pcie${i}`, r]);
    }
    for (const [i, r] of g.sata.entries()) {
      parts.push([`sata${i}`, r]);
    }
    for (const [i, r] of g.m2.entries()) {
      parts.push([`m2_${i}`, r]);
    }
    const pushIf = (n: string, r: layout.Rect | null | undefined): void => {
      if (r) {
        parts.push([n, r]);
      }
    };
    pushIf('phy', g.phy);
    pushIf('hex', g.hex);
    pushIf('qr', g.qr);
    pushIf('dbg', g.dbg);
    pushIf('rgb', g.rgb);
    for (const [n, r] of [
      ['bios', g.bios],
      ['sio', g.sio],
      ['pwm', g.pwm],
      ['dpwm', g.dpwm],
      ['xtalCpu', g.xtalCpu],
      ['xtalPch', g.xtalPch],
    ] as const) {
      parts.push([n, r]);
    }
    for (const h of g.hdrs) {
      parts.push([`hdr_${h.name}`, { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }]);
    }
    for (const [i, p] of g.passives.entries()) {
      parts.push([`passives${i}`, passiveRect(p)]);
    }
    for (const [i, [hx, hy]] of g.holes.entries()) {
      const p: [number, number] = [hx, hy];
      for (const [name, r] of parts) {
        expect(rectDist(p, r), `hole ${i} vs ${name}`).toBeGreaterThan(R);
      }
      let near = Infinity;
      for (const l of lanes) {
        for (let k = 1; k < l.pts.length; k++) {
          near = Math.min(near, segDist(p, must(l.pts[k - 1]), must(l.pts[k])));
        }
      }
      expect(near, `hole ${i} vs a lane`).toBeGreaterThan(R);
      for (const [j, [ox, oy]] of g.holes.entries()) {
        if (j > i) {
          expect(Math.hypot(ox - hx, oy - hy), `holes ${i} and ${j}`).toBeGreaterThan(2 * R);
        }
      }
      // the screw stays on the board
      expect(inside({ x: hx - 66, y: hy - 66, w: 132, h: 132 }, g.bd)).toBe(true);
    }
    // the cooler's holes round the socket: a smaller keep-out (no screw head), clear of the socket's printed keep-out too
    const sk = layout.SOCKET_E + layout.SOCKET_KEEP,
      keep = { x: layout.PKG.x - sk, y: layout.PKG.y - sk, w: layout.PKG.w + 2 * sk, h: layout.PKG.h + 2 * sk };
    for (const [hx, hy] of layout.COOLER_HOLES) {
      const p: [number, number] = [hx, hy],
        K = layout.COOLER_HOLE.keep;
      for (const [name, r] of [...parts, ['keep-out', keep] as [string, layout.Rect]]) {
        expect(rectDist(p, r), `cooler hole ${p} vs ${name}`).toBeGreaterThan(K);
      }
      let near = Infinity;
      for (const l of lanes) {
        for (let k = 1; k < l.pts.length; k++) {
          near = Math.min(near, segDist(p, must(l.pts[k - 1]), must(l.pts[k])));
        }
      }
      expect(near, `cooler hole ${p} vs a lane`).toBeGreaterThan(K);
      for (const [ox, oy] of g.holes) {
        expect(Math.hypot(ox - hx, oy - hy), `cooler hole ${p} vs a board hole`).toBeGreaterThan(K + R);
      }
    }
  }

  function assert_puts_a_drive_cage_cell_with_a_short_cable_that_c(): void {
    const g = sockets();
    expect(layout.BAY_CELLS.length).toBeGreaterThanOrEqual(g.sata.length);
    expect((layout.BAY_CELLS.length * 785) / layout.CASE_BD.h, 'the cages fill the case').toBeGreaterThan(0.6);
    const cables = g.sata.map((_, i) => sataCablePath(i)),
      floor = layout.CASE.y + layout.CASE.h - 150;
    for (const [i, c] of layout.BAY_CELLS.entries()) {
      if (i < layout.BASE_BAYS) {
        // under the shroud's top (30 thick, and the cage's own 70 over its top cell), on the basement's floor
        expect(c.y - 70, `cell ${i} under the shroud`).toBeGreaterThan(layout.PSU.y + 30);
        expect(c.y + c.h + 60, `cell ${i} on the floor`).toBeLessThanOrEqual(floor);
      } else {
        expect(inside(c, layout.CASE_GLASS), `cell ${i} in the glass`).toBe(true);
        expect(inside(c, layout.BAY), `cell ${i} in the cage`).toBe(true);
        const p = g.sata[i];
        if (p) {
          expect(c.y + must(layout.SATA_LINK[i]).plug, `cell ${i} is above its port`).toBeLessThan(p.y + p.h / 2);
        }
      }
      expect(c.x, 'the cages are east of the board').toBeGreaterThan(layout.BD.x + layout.BD.w);
      if (i) {
        expect(overlap(c, must(layout.BAY_CELLS[i - 1]))).toBe(false);
      }
    }
    const cage = (i: number) => (i < layout.BASE_BAYS ? 0 : 1);
    for (let i = 0; i < cables.length; i++) {
      for (let j = i + 1; j < cables.length; j++) {
        if (cage(i) === cage(j)) {
          expect(lanesCross(must(cables[i]), must(cables[j])), `cables ${i} and ${j} cross`).toBe(false);
        }
      }
    }
  }
});

/** Do the segments (a,b) and (c,d) cross (properly)? */
function cross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a),
    d2 = o(c, d, b),
    d3 = o(a, b, c),
    d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function assert_grows_from_tier_to_tier(): void {
  for (let t = 1; t < TIER_GEO.length; t++) {
    expect(must(TIER_GEO[t]).bd.w * must(TIER_GEO[t]).bd.h).toBeGreaterThan(
      must(TIER_GEO[t - 1]).bd.w * must(TIER_GEO[t - 1]).bd.h,
    );
    expect(must(TIER_GEO[t]).dimm.length).toBeGreaterThanOrEqual(must(TIER_GEO[t - 1]).dimm.length);
  }
}

function assert_the_Micro_Mid_and_Full_carry_one_above_the_mains(): void {
  for (const tier of [0, 1, 2, 3]) {
    layout.setLayoutTier(tier, tier);
    if (tier === 0) {
      expect(layout.PSU_REAR_FAN).toBeNull();
      continue;
    }
    const f = must(layout.PSU_REAR_FAN);
    expect(f.y).toBeGreaterThanOrEqual(layout.PSU.y);
    expect(f.y + f.h, 'the inlet is below the fan').toBeLessThan(layout.PC_POWER.y - 100);
    expect(layout.PC_POWER.y).toBeLessThan(layout.CASE.y + layout.CASE.h);
    expect(f.y + f.h, 'clear of the rear fan above').toBeLessThan(layout.PSU.y + layout.PSU.h);
  }
  layout.setLayoutTier(2, 2);
}

describe('board ladder', () => {
  it('grows from tier to tier', () => {
    expect.hasAssertions();
    assert_grows_from_tier_to_tier();
  });
});

describe.each(TIER_GEO.map((g) => g.tier))('tier %i: the far board texture', (tier) => {
  function assert_covers_the_board_and_the_whole_rear_I_O_plate_wi(): void {
    layout.setLayoutTier(tier);
    const f = layout.boardBakeFrame(layout.GEO.bd, layout.GEO.io);
    expect(inside(layout.GEO.bd, f)).toBe(true);
    expect(inside(layout.GEO.io, f)).toBe(true);
    for (const p of IO_PORTS) {
      expect(inside({ x: p.x, y: p.y - p.h / 2, w: p.w, h: p.h }, f), `port ${p.id}`).toBe(true);
    }
    expect(f.x).toBeLessThanOrEqual(layout.CASE.x); // out to the case's west wall, where the plate stands
  }

  it('covers the board and the whole rear I/O plate with its ports, so the back panel shows at every zoom', () => {
    expect.hasAssertions();
    assert_covers_the_board_and_the_whole_rear_I_O_plate_wi();
  });
});

describe('the PSU exhaust fan in the rear wall', () => {
  it('the Micro, Mid and Full carry one above the mains inlet, the Mini none', () => {
    expect.hasAssertions();
    assert_the_Micro_Mid_and_Full_carry_one_above_the_mains();
  });
});
