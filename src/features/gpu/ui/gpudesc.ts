// Words for the parts of a graphics card the board draws (docs/ACCEL.md "Art as built", render/board/gpulayout.ts): the fans, the lanes, the
// banks, the registers, the mask and its stack, the program counter, the card memory, the PCIe link and the heatsink. An id is the card's slot
// and the part: `pcie1.lane3`. Pure. It imports nothing from logic.ts (logic.ts imports this).

import { getSpec, type CardSpec } from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { GPU_HOP_TICKS } from '@/core/sim/memmap';
import type { Description } from '@/core/ui/regions';

// An id is the slot and a part: a numbered one (`fan0`, `lane3`, `bank1`, `warp2`), a block of the die by its plan id (`pcie`, `launch`, `fetch`, `regs`,
// `sm1.lanes`, the frame `sm0`), the mask stack or the shroud. (`link` and `mem` are the older names of `pcie` and `dram`.)
const ID = /^(pcie\d+)\.([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)?)$/;
const KINDS = new Set(['fan', 'lane', 'bank', 'warp', 'regs', 'mask', 'maskstack', 'pc', 'mem', 'link', 'fins', 'pcie', 'launch', 'fetch', 'decode', 'sched', 'warps', 'lanes', 'coal', 'arb', 'banks', 'l1', 'l2', 'dram', 'sm']);
const PART = /^(?:sm\d+\.)?([a-z]+?)(\d*)$/;
/** The part's kind (a block's id without its SM prefix and number) and its number. */
function partOf(name: string): { kind: string; n: number } | null {
  // `l1` and `l2` end in digits that belong to their name
  if (/^(?:sm\d+\.)?l[12]$/.test(name)) return { kind: name.slice(-2), n: 0 };
  const m = PART.exec(name);
  if (!m) return null;
  const kind = m[1]!, n = Number(m[2] || 0);
  return KINDS.has(kind) ? { kind, n } : null;
}

/** Is this one of a graphics card's part ids? */
export const isGpuId = (id: string): boolean => { const m = ID.exec(id); return !!m && partOf(m[2]!) !== null; };

const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;

/** Describe a card part by its id; null when the id is not one. `s` adds what the card is doing right now. */
export function describeGpuId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id), part = m ? partOf(m[2]!) : null;
  if (!m || !part) return null;
  const slot = m[1]!, n = part.n, sm = /^sm(\d+)\./.exec(m[2]!)?.[1];
  const kind = part.kind === 'link' ? 'pcie' : part.kind === 'mem' ? 'dram' : part.kind;
  const dev = s?.devices.find((d) => d.slot === slot && d.kind === 'gpu');
  const spec = dev ? (getSpec(dev.spec) as CardSpec | undefined) : undefined;
  const g = s?.gpus?.find((x) => x.slot === slot);
  const lanes = g?.lanes ?? spec?.gpu?.lanes, banks = g?.banks ?? spec?.gpu?.banks;
  const card = spec ? spec.name : 'graphics card';
  const cfg = spec?.gpu, warps = cfg && 'warps' in cfg ? cfg.warps : 1, sms = cfg && 'sms' in cfg ? cfg.sms : 1, line = cfg && 'lineWords' in cfg ? cfg.lineWords : 1;
  const where = sm !== undefined ? ` | SM ${sm}` : '';
  switch (kind) {
    case 'fan': return {
      title: 'Card fan',
      plain: 'One of the fans on the top edge of the card. It turns faster as the card heats up and works harder while a kernel runs.',
      nerd: dev && spec
        ? `${card}: ${dev.tempC.toFixed(0)} C now, throttles at ${spec.thermal.throttleC} C, damage at ${spec.thermal.damageC} C | fan ${n + 1}`
        : 'speed follows the temperature of the card; the fans are art, not a part you buy',
    };
    case 'lane': return {
      title: `Lane ${n}`,
      plain: 'One of the card\'s lanes, a small arithmetic unit. Every lane runs the same instruction at once, each on its own data. A lane the mask switches off stays dark and does nothing for that instruction.',
      nerd: g ? `lane ${n} of ${g.lanes} | ${((g.mask >>> n) & 1) === 1 ? 'on' : 'off'} under the mask now (${hex(g.mask)})` : `lane ${n}${lanes ? ` of ${lanes}` : ''} | runs when its mask bit is set`,
    };
    case 'bank': return {
      title: `Memory bank ${n}`,
      plain: 'The card memory is split into banks, and a bank serves one address per cycle. When several lanes reach into the same bank at different addresses they queue, and the access takes several cycles. Lanes that read the very same address share one access.',
      nerd: g
        ? `bank ${n} of ${g.banks} | word w lives in bank w % ${g.banks} | ${g.stats.conflictCycles} cycles lost to conflicts this launch`
        : `word w lives in bank w % ${banks ?? 'banks'}; the busiest bank sets the cost of an access`,
    };
    case 'regs': return {
      title: 'Vector registers',
      plain: 'Eight registers, v0 to v7, each holding one value per lane. An instruction reads and writes a whole row at once. Only the lanes the mask leaves on are written. The row an instruction writes lights up.',
      nerd: `8 registers x ${lanes ?? 'N'} lanes x 32 bit | a cell is bright when its lane holds a non-zero value`,
    };
    case 'mask': return {
      title: 'Execution mask',
      plain: 'One bit per lane: lit means the lane takes part in the instruction. When the lanes disagree at an if, the card runs both sides one after the other, each under its own mask, and the lanes that sit out waste that time.',
      nerd: g ? `mask ${hex(g.mask)} | ${g.stats.idleLaneSlots} lane slots idle through divergence this launch` : 'mseteq / msetne / msetlt / msetge narrow it; melse flips it',
    };
    case 'maskstack': return {
      title: 'Mask stack',
      plain: 'Where the card saves the mask while it runs an if and an else: mpush stores it, melse switches to the other side, mpop restores it. It holds eight levels.',
      nerd: g ? `depth ${g.stack.length} of 8` : 'mpush, melse, mpop | 8 levels deep',
    };
    case 'pc': return {
      title: 'Program counter',
      plain: 'Which instruction of the kernel the card is on, and what it does. The card runs far faster than an eye can follow, so the view replays its last instructions in slow motion.',
      nerd: g ? `pc ${hex(g.pc)} | ${g.stats.instructions} instructions, ${g.stats.cycles} cycles this launch` : 'one instruction per cycle; a conflicted vld / vst takes one cycle per extra access',
    };
    case 'dram': return {
      title: 'Card memory',
      plain: 'The card\'s own small memory. The CPU copies the kernel and its data in with plain stores before a launch and the result out after it, so a tiny job costs more to send than to run.',
      nerd: g || spec?.gpu ? `${Math.round((g?.memBytes ?? spec!.gpu!.memBytes) / 1024)}K in ${banks} bank${banks === 1 ? '' : 's'} | cleared at power-on` : 'banked word memory, cleared at power-on',
    };
    case 'pcie': return {
      title: 'PCIe link',
      plain: 'The card\'s connection to the machine through its slot. A launch crosses it on the way in, and the answer crosses it on the way out. The block lights up while that happens.',
      nerd: `${GPU_HOP_TICKS} card ticks each way${g ? ` | now ${g.phase}` : ''}`,
    };
    case 'launch': return {
      title: 'Launch registers',
      plain: 'The registers the CPU writes to start a kernel: where it is in card memory, how many lanes to run, and the go flag. The card starts running the moment the go flag is set.',
      nerd: g ? `${g.launches} launches so far | now ${g.phase}` : 'written through the PCIe window',
    };
    case 'fetch': return {
      title: 'Fetch',
      plain: 'Reads the next instruction of the kernel from card memory, at the program counter, and hands it to the decoder.',
      nerd: `${cfg && 'warps' in cfg ? 'one instruction a cycle for the whole SM' : 'one instruction at a time, nothing overlaps'}${where}`,
    };
    case 'decode': return {
      title: 'Decode',
      plain: 'Splits the instruction word into its fields (the operation, the registers, the constant) and raises the control lines that tell the lanes, the memory and the mask what to do.',
      nerd: `fields: op 7, rd 4, rs1 4, rs2 4, imm 13 bits${where}`,
    };
    case 'sched': return {
      title: 'Warp scheduler',
      plain: 'Each cycle it picks one warp that is ready and sends its next instruction down the card. A scoreboard remembers which registers a warp is still waiting for (a load on its way), so a warp that waits steps aside and another one runs.',
      nerd: `${warps} warp${warps === 1 ? '' : 's'} per SM | round robin among the ready | scoreboard: a bit per register and warp${where}`,
    };
    case 'warp': return {
      title: `Warp ${n}`,
      plain: 'A group of lanes that move together. It has its own program counter, its own mask and its own mask stack, so a branch that splits this warp does not slow the other one down.',
      nerd: `warp ${n % warps} of ${warps}${sms > 1 ? ` on SM ${Math.floor(n / warps)}` : ''} | pc, mask and 8-deep stack of its own`,
    };
    case 'warps': return {
      title: 'Warps',
      plain: 'The warps of this SM, each with its own program counter, mask and mask stack. The chips light up for the warp that is issuing and show how many of its lanes are on.',
      nerd: `${warps} warp${warps === 1 ? '' : 's'} per SM, a pc and a mask each${where}`,
    };
    case 'lanes': return {
      title: 'Lane ALUs',
      plain: 'The row of arithmetic units. Every lane does the same operation on its own data in the same cycle; the mask decides which of them take part.',
      nerd: `${lanes ? `${lanes} lane${lanes === 1 ? '' : 's'} on the card` : 'one ALU per lane'}${where}`,
    };
    case 'coal': return {
      title: 'Coalescer',
      plain: 'When the lanes load or store at once, it gathers their addresses into whole memory lines. Lanes that touch the same line share one access, so neighbouring addresses are cheap and scattered ones are slow.',
      nerd: `${line}-word lines | cost = distinct lines touched${where}`,
    };
    case 'arb': return {
      title: 'Bank arbiter',
      plain: 'Sends each access to its memory bank and serves one address per bank per cycle. When two lanes want different words of the same bank they take turns, and the access takes extra cycles.',
      nerd: `one address per bank per cycle | ${banks ?? 'N'} banks${where}${g ? ` | ${g.stats.conflictCycles} conflict cycles this launch` : ''}`,
    };
    case 'banks': return {
      title: 'Memory banks',
      plain: 'The banks of the card memory next to the lanes. Each serves one address per cycle; the lit segments are the addresses queued on it during a load or store.',
      nerd: `${banks ?? 'N'} bank${banks === 1 ? '' : 's'}${where} | word w lives in bank w % ${banks ?? 'banks'}`,
    };
    case 'l1': return {
      title: 'L1 cache',
      plain: 'A small fast memory of recently used lines for one SM. A hit answers without going further; a miss goes on to the shared L2.',
      nerd: `${cfg && 'l1Lines' in cfg ? `${cfg.l1Lines} lines of ${line} words` : 'tags and lines'}${where}`,
    };
    case 'l2': return {
      title: 'L2 cache',
      plain: 'A bigger cache shared by every SM. A line one SM fetched is already there for the other, and its misses go to the card memory one at a time.',
      nerd: cfg && 'l2Lines' in cfg ? `${cfg.l2Lines} lines of ${line} words | shared by ${sms} SMs` : 'shared by every SM',
    };
    case 'sm': return {
      title: `Streaming multiprocessor${sm !== undefined ? ` ${sm}` : ` ${n}`}`,
      plain: sms > 1
        ? "One of the card's compute cores: its own front end, warps, registers, lanes and path to memory. The SMs split the lanes of a launch between them and run side by side."
        : "The card's one compute core: its front end, warps, registers, lanes and path to memory. A bigger card has several of these side by side.",
      nerd: `${sms} SMs | ${warps} warps and ${lanes && sms ? lanes / sms : 'N'} lanes each`,
    };
    default: return {
      title: 'Heatsink',
      plain: 'The card\'s own cooler under the shroud: fins the fans blow across. It is part of the card, not a part you can change.',
      nerd: spec ? `${card}: throttles at ${spec.thermal.throttleC} C` : 'built into the card; its heat adds to the case',
    };
  }
}
