// The network lens's lines and words (docs/render/net.md "The network lens"). Two steps, as the power lens: `netShape` is the path as built (the plan's line from the
// wall plate to the router, then the real LAN lead from the router to the machine's jack): it changes only when the cable or the machine does. `netDraw` is one snapshot
// on that shape: how hard data moves on each line, the state of each line, and the words (the four limits of the link, pinned to the pieces they belong to).
// Pure: no Three, no DOM, so it is tested alone (`shape.test.ts`).
import type { Snapshot } from '@/worker/protocol';
import type { V3 } from '@/core/render/three/rope';
import type { AirTag } from '@/features/board/render/three/air/airtags';
import { hasNetwork, limiterLadder, netStateChip, type LimiterId } from '../../ui/netui';

/** The places the path runs through, in the machine's space (x east, y up, z toward the viewer). */
export interface NetAnchors {
  /** The ISP's wall plate: the middle of its face, and half its width and height. */
  plate: { at: V3; hw: number; hh: number };
  /** The router: the middle of its box, and half its width and height. */
  router: { at: V3; hw: number; hh: number };
  /** The LAN lead as the machine built it, from the router's jack to the plug, and the jack the plug goes in. Null while the machine has no such lead. */
  lan: { strands: V3[][]; seated: boolean; jack: V3; r: number } | null;
  /** The top of the OS drive's box, or null with no OS drive. */
  drive: V3 | null;
}

/** One line of the path. Data goes down its points in the order given (toward the machine). */
export interface NetLine {
  id: 'isp' | 'lan';
  pts: V3[];
  /** Half the width, units: the light is a little wider than the sleeve it runs along. */
  width: number;
  /** How far toward the eye the line is lifted, units: out of its cable's sleeve. */
  lift: number;
}

export interface NetShape { lines: NetLine[] }

/** Half-widths and lifts, in units (23000 to the metre). */
const W_LAN = 24, W_ISP = 20, LIFT_CLEAR = 14;
/** How far in front of its wall the plan's line runs, units. */
const WALL_Z = 110;

/**
 * The plan's line: out of the plate's west side, along the wall, then forward into the router's back (its WAN socket, low on the east end). Not a cable the machine
 * models: the lens draws where the plan comes in.
 */
export function ispLine(a: NetAnchors): V3[] {
  const p = a.plate, r = a.router;
  const side = p.at[0] - p.hw, mid = p.at[1];
  const wanX = r.at[0] + r.hw - 260, wanY = r.at[1] - r.hh * 0.45, back = 300;
  return [
    [side, mid, WALL_Z],
    [side - 420, mid, WALL_Z],
    [wanX, wanY, WALL_Z],
    [wanX, wanY, back],
  ];
}

/** The path of one machine: the plan's line, then the LAN lead's strands (the lead's order is the router's end first, the way the data comes in). */
export function netShape(a: NetAnchors): NetShape {
  const lines: NetLine[] = [{ id: 'isp', pts: ispLine(a), width: W_ISP, lift: 0 }];
  if (a.lan) a.lan.strands.forEach((pts) => { if (pts.length > 1) lines.push({ id: 'lan', pts: pts.map((p) => [...p] as V3), width: W_LAN, lift: a.lan!.r + LIFT_CLEAR }); });
  return { lines };
}

/** What a line does now: nothing runs (a dim thread), data may run, the lead is out or the link is down (red, pulsing, still). */
export type LineState = 0 | 1 | 2;

/** The slowest and the fastest link the pulses tell apart (Mbit/s): a pulse's pace and spacing follow a link's speed on a log scale between them. */
const MBPS_FOOT = 10, MBPS_TOP = 20000;
/** A link's speed as a place on the pulses' scale, 0.08 (the foot) to 1 (the top). */
export function speedLevel(mbps: number): number {
  if (!(mbps > 0)) return 0.08;
  const f = Math.log(mbps / MBPS_FOOT) / Math.log(MBPS_TOP / MBPS_FOOT);
  return Math.min(1, Math.max(0.08, f));
}

export interface NetDraw {
  /** Per line (the shape's order): how hard data comes in, 0 to 1. 0 with the link up and nothing moving: a slow trickle. */
  down: Float32Array;
  /** The same for results going out; 0: none go. */
  up: Float32Array;
  state: Uint8Array;
  tags: AirTag[];
  /** The piece the words call the limit (`limiterLadder`), or null. */
  limit: LimiterId | null;
}

const LABEL: Record<LimiterId, string> = { port: 'Port', router: 'Router', isp: 'Plan', disk: 'Drive' };

/** The line `id` is in this state in this snapshot. The plan's line lives while a plan and a router are there; the lead while the link is up or saturated. */
function lineState(id: NetLine['id'], s: Snapshot): LineState {
  const n = s.net;
  if (id === 'isp') return n.isp && n.router ? 1 : 0;
  const lead = s.cables.find((c) => c.id === 'lan');
  if (!lead?.connected) return n.router || n.isp ? 2 : 0;
  switch (n.state) {
    case 'link-up': case 'saturated': return 1;
    case 'down': return 2;
    default: return 0;
  }
}

const above = (p: V3, dy: number): V3 => [p[0], p[1] + dy, p[2] + 60];

/** One snapshot on the shape: each line's pace and state, and the words. */
export function netDraw(shape: NetShape, s: Snapshot, a: NetAnchors): NetDraw {
  const n = s.net, ladder = limiterLadder(s), chip = netStateChip(s);
  const downs = n.transfers.filter((t) => t.dir === 'down').length, ups = n.transfers.filter((t) => t.dir === 'up').length;
  const down = new Float32Array(shape.lines.length), up = new Float32Array(shape.lines.length), state = new Uint8Array(shape.lines.length);
  shape.lines.forEach((l, i) => {
    state[i] = lineState(l.id, s);
    if (state[i] !== 1) return;
    down[i] = downs > 0 ? speedLevel(ladder.downMbps) : 0;
    up[i] = ups > 0 ? speedLevel(ladder.upMbps) : 0;
  });

  const tags: AirTag[] = [];
  const seg = (id: LimiterId) => ladder.segs.find((g) => g.id === id);
  const word = (id: LimiterId, extra = ''): { text: string; tone: AirTag['tone'] } => {
    const g = seg(id);
    if (!g || g.mbps === null) return { text: `${LABEL[id]} · none`, tone: 'warn' };
    const hit = ladder.binding === id && ladder.downMbps > 0;
    return { text: `${LABEL[id]} · ${g.text}${extra}${hit ? ' · limit' : ''}`, tone: hit ? 'limit' : 'net' };
  };
  const plan = a.plate;
  if (n.isp) tags.push({ id: 'plan', at: above(plan.at, plan.hh + 150), ...word('isp') });
  else tags.push({ id: 'plan', at: above(plan.at, plan.hh + 150), text: 'No plan · click the plate', tone: 'warn' });
  const router = a.router, busy = new Set(n.transfers.map((t) => t.jobId)).size;
  if (n.router) tags.push({ id: 'router', at: above(router.at, router.hh + 120), ...word('router', ` · ${busy}/${n.bandwidth.clients || n.router.clients} clients`) });
  else tags.push({ id: 'router', at: above(router.at, router.hh + 120), text: 'No router · drop one here', tone: 'warn' });
  if (a.lan) {
    const port = seg('port');
    if (n.port.kind && port) tags.push({ id: 'port', at: above(a.lan.jack, 330), ...word('port') });
    else if (chip) tags.push({ id: 'port', at: above(a.lan.jack, 330), text: 'Port · plug the cable in', tone: 'warn' });
  }
  if (a.drive && seg('disk')?.mbps) tags.push({ id: 'drive', at: above(a.drive, 160), ...word('disk') });
  // the link, when it is not up: what is wrong in the chip's words, under the router's
  if (chip && (chip.level === 'warn' || chip.level === 'bad')) tags.push({ id: 'link', at: above(router.at, router.hh + 120), text: chip.text, tone: chip.level === 'bad' ? 'warn' : 'limit', under: 'router' });
  tags.push({ id: 'legend', at: above(router.at, router.hh + 120), text: '', tone: 'dim', legend: 'net', under: chip && (chip.level === 'warn' || chip.level === 'bad') ? 'link' : 'router' });
  return { down, up, state, tags, limit: hasNetwork(s) ? ladder.binding : null };
}
