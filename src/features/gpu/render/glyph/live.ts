import type { Rect } from '../../../cpu/render/core/cpuplan';
import { slotsOf } from '../../../cpu/render/die/blockart';
import { gpuDisassemble } from '../../sim/isa/isa';
import type { GpuStep } from '../../sim/isa/ref';
import type { GpuBlock } from '../plan/gpuplan';
import { decodeGeom, gpuControlIndices, gpuSlotValues } from './decode';
import { fetchGeom, launchGeom, pcArea, pcieGeom } from './geom';
import type { LiveGlyph } from './types';

// What the symbols show while the card runs: the host side (the PCIe link and the launch registers) and the front end (the program
// counter's digits, the word fetched, the decoded word and the control lines it raises).

/** What the host side of the card is doing, as the symbols of the PCIe and launch blocks need it. */
interface HostLive {
  phase: 'idle' | 'in' | 'run' | 'out';
  lanes: number;
  launches: number;
  /** The clock the motion runs on, in ms. */ ms: number;
}

/** The PCIe block in motion: the receive cells flow on the way in, the transmit cells on the way out, the DMA engine and its credits fill. */
function hostPcie(a: Rect, h: HostLive): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const wave = h.ms / 90;
  const q = pcieGeom(a),
    moving = h.phase === 'in' || h.phase === 'out';
  for (const [k, l] of q.lanes.entries()) {
    if (h.phase === 'in') {
      out.lit.push({ rect: l.rx, color: 'mul', a: 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(wave - k * 0.9)) });
    } else if (h.phase === 'out') {
      out.lit.push({ rect: l.tx, color: 'mul', a: 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(wave + k * 0.9)) });
    }
  }
  out.lit.push({ rect: q.dma, color: 'mul', a: moving ? 0.35 + 0.25 * Math.sin(wave) ** 2 : 0.18 });
  const up = moving ? 1 + (Math.floor(h.ms / 160) % 4) : 3;
  for (const [k, r] of q.credits.entries()) {
    if (k < up) {
      out.lit.push({ rect: r, color: 'mul', a: 0.85 });
    }
  }
  return out;
}

/** The launch block in motion: the registers hold the command, the go flag is up, the state machine sits at run until the kernel ends. */
function hostLaunch(a: Rect, h: HostLive): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const wave = h.ms / 90;
  const l = launchGeom(a),
    vals: string[] = ['0x0000', '', '', String(h.lanes || ''), h.phase === 'run' ? 'busy' : h.phase];
  for (const [k, r] of l.regs.entries()) {
    out.lit.push({ rect: r, color: 'br', a: k % 2 ? 0.5 : 0.35 });
    const v = vals[k];
    if (v !== undefined && v !== '') {
      out.texts.push({ rect: r, top: v, bottom: '' });
    }
  }
  out.lit.push({ rect: l.go, color: 'br', a: 0.5 + 0.3 * Math.sin(wave) ** 2 });
  const state = l.states[h.phase === 'out' ? 2 : 1],
    [slot] = l.slots;
  if (state) {
    out.lit.push({ rect: state, color: 'br', a: 0.7 });
  }
  if (slot) {
    out.lit.push({ rect: slot, color: 'br', a: 0.8 });
  }
  return out;
}

/**
 * The PCIe and launch blocks in motion: a launch crosses the link into the card (`in`: the receive cells flow, the DMA engine and its credits fill), the launch
 * registers hold the command, the go flag is up and the state machine sits at run until the kernel ends, and the result crosses back (`out`: the transmit cells).
 */
export function gpuHostLive(kind: 'pcie' | 'launch', a: Rect, h: HostLive): LiveGlyph {
  if (h.phase === 'idle') {
    return { texts: [], lit: [] };
  }
  return kind === 'pcie' ? hostPcie(a, h) : hostLaunch(a, h);
}

/** The instruction on show and how far it has got into the block (0..1), as on the CPU die. */
interface LiveStep {
  step: GpuStep;
  prog: number;
}

/** The program counter's digits. */
function livePc(b: Pick<GpuBlock, 'id' | 'label' | 'sub' | 'rect'>, a: Rect, s: LiveStep): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const { digits } = slotsOf({ ...b, kind: 'pc' }, pcArea(a));
  if (!digits) {
    return out;
  }
  const hex = (s.step.pc >>> 0).toString(16).padStart(8, '0');
  for (const [k, r] of digits.entries()) {
    out.texts.push({ rect: r, top: hex[k] ?? '', bottom: '' });
  }
  return out;
}

/** The word being fetched: its row wipes in, then shows the instruction. */
function liveFetch(a: Rect, s: LiveStep): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const [row] = fetchGeom(a).rows;
  if (!row) {
    return out;
  }
  const { step, prog } = s;
  out.lit.push({ rect: { ...row, w: row.w * prog }, color: 'alu', a: 0.92 });
  if (prog > 0.55) {
    out.texts.push({ rect: row, top: step.word === undefined ? step.name : gpuDisassemble(step.word), bottom: '' });
  }
  return out;
}

/** The decoded word: it wipes in, its slots fill, and the control lines it raises light one by one. */
function liveDecode(a: Rect, s: LiveStep): LiveGlyph {
  const out: LiveGlyph = { texts: [], lit: [] };
  const d = decodeGeom(a),
    { step, prog } = s;
  out.lit.push({ rect: { ...d.word, w: d.word.w * prog }, color: 'alu', a: 0.92 });
  if (prog > 0.55 && step.word !== undefined) {
    for (const [n, v] of gpuSlotValues(step.word).entries()) {
      const fr = d.fields[n];
      if (v && fr) {
        out.texts.push({ rect: fr, top: v, bottom: '' });
      }
    }
  }
  for (const [j, n] of gpuControlIndices(step).entries()) {
    const line = d.lines[n];
    if (line && prog > 0.45 + 0.1 * j) {
      out.lit.push({ rect: line, color: 'br', a: 0.6 });
    }
  }
  return out;
}

/** What the symbols of the shared kinds show for the instruction on show (the program counter's digits, the word fetched, the decoded word and the lines it raises). `prog` is how far the instruction has got into the block (0..1, default 1), as on the CPU die. */
export function gpuGlyphLive(
  b: Pick<GpuBlock, 'id' | 'kind' | 'label' | 'sub' | 'rect'>,
  a: Rect,
  on: { step: GpuStep | null; prog?: number },
): LiveGlyph {
  if (!on.step) {
    return { texts: [], lit: [] };
  }
  const s: LiveStep = { step: on.step, prog: on.prog ?? 1 };
  if (b.kind === 'pc') {
    return livePc(b, a, s);
  }
  if (b.kind === 'fetch') {
    return liveFetch(a, s);
  }
  if (b.kind === 'decode') {
    return liveDecode(a, s);
  }
  return { texts: [], lit: [] };
}
