import { launchGeom, pcieGeom } from './geom';
import type { Pen } from './pen';

// The host side of the card: the PCIe link and the launch registers.

/** The registers of the launch block, in the order of its rows. */
const LAUNCH_REGS = ['kernel', 'arg0', 'arg1', 'lanes', 'status'] as const;
/** The states of a launch, in the order they are drawn. */
const LAUNCH_STATES = ['idle', 'run', 'done'] as const;

/** The lanes of the link, receive and transmit a pair of cells each, merged onto a bus into the DMA engine and its credit counters. */
export function drawPcie(p: Pen): void {
  const { x, y } = p.a,
    { rect, stub, soft, solid } = p.kit;
  const q = pcieGeom(p.a);
  if (q.top) {
    p.put('rx', x + q.cw / 2, y + 4, 6);
    p.put('tx', x + q.cw + 2 + q.cw / 2, y + 4, 6);
  }
  for (const l of q.lanes) {
    rect(l.rx.x, l.rx.y, l.rx.w, l.rx.h, soft);
    rect(l.tx.x, l.tx.y, l.tx.w, l.tx.h, solid);
    stub(l.tx.x + l.tx.w, l.y, q.busX, l.y);
  }
  const f = q.lanes.at(0),
    z = q.lanes.at(-1),
    d = q.dma,
    dcy = d.y + d.h / 2;
  if (!f || !z) {
    return;
  }
  stub(q.busX, f.y, q.busX, z.y);
  stub(q.busX, dcy, d.x, dcy);
  p.dot(q.busX, dcy);
  rect(d.x, d.y, d.w, d.h, soft);
  p.outline(d);
  p.put('dma', d.x + d.w / 2, dcy, 7);
  for (const [k, r] of q.credits.entries()) {
    rect(r.x, r.y, r.w, r.h, k < 3 ? solid : soft);
  }
}

/** Idle -> run -> done, and the commands waiting behind the one running. */
function drawLaunchStates(p: Pen, l: ReturnType<typeof launchGeom>): void {
  const { x } = p.a,
    { rect, soft, solid } = p.kit;
  const [first, , last] = l.states;
  if (!first || !last) {
    return;
  }
  p.lab('launch state', [x, first.y - 6], 6.5);
  for (const [k, r] of l.states.entries()) {
    rect(r.x, r.y, r.w, r.h, k === 1 ? solid : soft);
    p.outline(r);
    p.put(LAUNCH_STATES[k] ?? '', r.x + r.w / 2, r.y + 7, 6.5);
    if (k < 2) {
      p.wire(r.x + r.w, r.y + 7, r.x + r.w + 14, r.y + 7);
    }
  }
  const lx = last.x + last.w / 2,
    fx = first.x + first.w / 2;
  p.wire(lx, last.y + 14, lx, last.y + 22, fx, last.y + 22, fx, last.y + 14);
  const [slot] = l.slots;
  if (slot) {
    p.lab('command queue', [x, slot.y - 6], 6.5);
    for (const [k, r] of l.slots.entries()) {
      rect(r.x, r.y, r.w, r.h, k === 0 ? solid : soft);
    }
  }
}

/** The argument registers by name, merged onto a bus that raises the go flag; with room, the state machine of a launch and the command queue. */
export function drawLaunch(p: Pen): void {
  const { x } = p.a,
    { rect, stub, soft, solid } = p.kit;
  const l = launchGeom(p.a);
  for (const [k, r] of l.regs.entries()) {
    p.lab(LAUNCH_REGS[k] ?? '', [x, r.y + l.pitch / 2 - 1], 6.5);
    rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
    stub(r.x + r.w, r.y + r.h / 2, l.busX, r.y + r.h / 2);
  }
  const r0 = l.regs.at(0),
    rz = l.regs.at(-1),
    { go } = l,
    gcy = go.y + go.h / 2;
  if (!r0 || !rz) {
    return;
  }
  stub(l.busX, r0.y + r0.h / 2, l.busX, rz.y + rz.h / 2);
  stub(l.busX, gcy, go.x, gcy);
  p.dot(l.busX, gcy);
  rect(go.x, go.y, go.w, go.h, soft);
  p.outline(go);
  p.put('go', go.x + go.w / 2, gcy, 7);
  if (l.states.length > 0) {
    drawLaunchStates(p, l);
  }
}
