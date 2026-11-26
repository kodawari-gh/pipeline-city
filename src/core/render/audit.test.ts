import { describe, expect, it, vi } from 'vitest';
import { BOARD_TIERS } from '../../features/board/sim/specs';
import { IO_PORTS, TIER_GEO } from '../../features/board/render/layout/boardlayout';
import { standoffs } from '../../features/room/render/desk/props/case';
import { CASE_BD, GEO, PKG, SOCKET_E, setLayoutTier } from '../../features/board/render/layout/layout';
import type * as layoutTypes from '../../features/board/render/layout/layout';
import { buildBuses, buildCables } from '../../features/board/render/wiring/routes';
import { plugRect } from '../../features/board/render/devices';

vi.mock(import('./ink'), async (orig) => {
  const pixi = await import('pixi.js');
  return { ...(await orig()), label: (str: string) => new pixi.Text({ text: str }) };
});

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// The last look over every board in every case: the screws meet the case's standoffs, and every part of the board is wired to
// something (a trace from a pin of the part, a cable plug on its connector).

const pairs = TIER_GEO.flatMap((b) => TIER_GEO.filter((c) => c.tier >= b.tier).map((c) => [b.tier, c.tier] as const));
const near = (p: [number, number], r: layoutTypes.Rect, d: number) =>
  p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;

const onTray = (x: number, y: number) =>
  x > CASE_BD.x && x < CASE_BD.x + CASE_BD.w && y > CASE_BD.y && y < CASE_BD.y + CASE_BD.h;

describe.each(pairs)('board %i in case %i', (b, c) => {
  it('has a standoff under every mounting screw, inside the tray', () => {
    setLayoutTier(b, c);
    const studs = new Set(standoffs().map(([x, y]) => `${x},${y}`));
    for (const [x, y] of GEO.holes) {
      expect(studs.has(`${x},${y}`), `screw at ${x},${y}`).toBe(true);
    }
    for (const [x, y] of standoffs()) {
      expect(onTray(x, y), `standoff ${x},${y} on the tray`).toBe(true);
    }
  });
});

type Geo = typeof GEO;
type BoardSpec = NonNullable<(typeof BOARD_TIERS)[number]>;
type IoPort = (typeof IO_PORTS)[number];

/** Both ends of every lane of every bus (and of the buses' taps). */
function laneEnds(): [number, number][] {
  const ends: [number, number][] = [];
  const buses = buildBuses();
  const lanes = [
    ...buses.flatMap((bus) => bus.lanes),
    ...buses.flatMap((bus) => bus.taps ?? []).flatMap((t) => t.lanes),
  ];
  for (const l of lanes) {
    ends.push(must(l.pts[0]), must(l.pts.at(-1)));
  }
  return ends;
}

/** Whether the board fits this connector on its rear plate. */
function portFitted(p: IoPort, spec: BoardSpec): boolean {
  if (p.id === 'eth') {
    return spec.features.ethernetMbps > 0;
  }
  if (p.id === 'dp') {
    return spec.features.displayPorts >= 2;
  }
  if (p.id.startsWith('usb')) {
    return Number(p.id.slice(3)) < spec.features.usbPorts;
  }
  return true;
}

/** Every part of the board that has to be wired to something, by name. */
function partsToWire(g: Geo, spec: BoardSpec): [string, layoutTypes.Rect][] {
  const parts: [string, layoutTypes.Rect][] = [
    ['chipset', g.chip],
    ['usb hub', g.hub],
    ['audio codec', g.codec],
    ['bios', g.bios],
    ['sio', g.sio],
    ['vrm controller', g.pwm],
    ['memory controller', g.dpwm],
    ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }],
    ['battery', g.bat],
    ['8-pin', g.cpw],
    ['24-pin', g.atx],
  ];
  if (g.phy) {
    parts.push(['phy', g.phy]);
  }
  parts.push(
    ...g.dimm.map((d, i): [string, layoutTypes.Rect] => [`dimm ${i}`, d.rect]),
    ...g.pcie.map((r, i): [string, layoutTypes.Rect] => [`pcie ${i}`, r]),
    ...g.m2.map((r, i): [string, layoutTypes.Rect] => [`m2 ${i}`, r]),
    ...g.sata.map((r, i): [string, layoutTypes.Rect] => [`sata ${i}`, r]),
    ...g.vrmPhases.map((r, i): [string, layoutTypes.Rect] => [
      `vrm phase ${i}`,
      { x: r.x, y: r.y + 40, w: r.w, h: 130 },
    ]),
    ...g.dPhases.map((r, i): [string, layoutTypes.Rect] => [
      `memory phase ${i}`,
      { x: r.x, y: r.y + 30, w: r.w, h: 90 },
    ]),
  );
  for (const h of g.hdrs) {
    parts.push([`header ${h.name}`, { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }]);
  }
  // every connector on the rear plate the board fits
  for (const p of IO_PORTS.filter((port) => portFitted(port, spec))) {
    parts.push([`port ${p.id}`, { x: p.x, y: p.y - p.h / 2, w: p.w, h: p.h }]);
  }
  return parts;
}

/** The PSU cables that seat on the board, each with its plug and the board connector it belongs on (a PCIe lead plugs
 * into its card, not the board). */
function boardPlugs(g: Geo): { kind: string; plug: layoutTypes.Rect; on: layoutTypes.Rect }[] {
  const out: { kind: string; plug: layoutTypes.Rect; on: layoutTypes.Rect }[] = [];
  for (const cable of buildCables()) {
    if (cable.kind === 'atx') {
      out.push({ kind: cable.kind, plug: plugRect(cable.b), on: g.atx });
    } else if (cable.kind === 'cpu') {
      out.push({ kind: cable.kind, plug: plugRect(cable.b), on: g.cpw });
    }
  }
  return out;
}

const overlaps = (a: layoutTypes.Rect, b: layoutTypes.Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe.each(TIER_GEO.map((g) => g.tier))('board tier %i wiring', (tier) => {
  it('wires every part of the board to something', () => {
    setLayoutTier(tier);
    const g = GEO,
      spec = must(BOARD_TIERS[tier]);
    const ends = laneEnds();
    const wired = (r: layoutTypes.Rect) => ends.some((p) => near(p, r, 30));
    for (const [name, r] of partsToWire(g, spec)) {
      expect(wired(r), `${name} has a trace`).toBe(true);
    }
    // the PSU's cables seat on the board's power connectors
    for (const { kind, plug, on } of boardPlugs(g)) {
      expect(overlaps(plug, on), `${kind} plug on its connector`).toBe(true);
    }
  });
});
