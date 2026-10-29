// Words for the parts of a graphics card the board draws (docs/ACCEL.md "Art as built", render/board/gpulayout.ts): the fans, the lanes, the
// banks, the registers, the mask and its stack, the program counter, the card memory, the PCIe link and the heatsink. An id is the card's slot
// and the part: `pcie1.lane3`. Pure. It imports nothing from logic.ts (logic.ts imports this).

import { getSpec, type CardSpec } from '../../sim/board/specs';
import type { Snapshot } from '../../sim/game/game';
import { GPU_HOP_TICKS } from '../../sim/isa/memmap';
import type { Description } from '../regions';

const ID = /^(pcie\d+)\.(fan|lane|bank)(\d+)$|^(pcie\d+)\.(regs|mask|maskstack|pc|mem|link|fins)$/;

/** Is this one of a graphics card's part ids? */
export const isGpuId = (id: string): boolean => ID.test(id);

const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;

/** Describe a card part by its id; null when the id is not one. `s` adds what the card is doing right now. */
export function describeGpuId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m) return null;
  const slot = (m[1] ?? m[4])!, kind = m[2] ?? m[5]!, n = Number(m[3] ?? 0);
  const dev = s?.devices.find((d) => d.slot === slot && d.kind === 'gpu');
  const spec = dev ? (getSpec(dev.spec) as CardSpec | undefined) : undefined;
  const g = s?.gpus?.find((x) => x.slot === slot);
  const lanes = g?.lanes ?? spec?.gpu?.lanes, banks = g?.banks ?? spec?.gpu?.banks;
  const card = spec ? spec.name : 'graphics card';
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
    case 'mem': return {
      title: 'Card memory',
      plain: 'The card\'s own small memory. The CPU copies the kernel and its data in with plain stores before a launch and the result out after it, so a tiny job costs more to send than to run.',
      nerd: g || spec?.gpu ? `${Math.round((g?.memBytes ?? spec!.gpu!.memBytes) / 1024)}K in ${banks} bank${banks === 1 ? '' : 's'} | cleared at power-on` : 'banked word memory, cleared at power-on',
    };
    case 'link': return {
      title: 'PCIe link',
      plain: 'The card\'s connection to the machine through its slot. A launch crosses it on the way in, and the answer crosses it on the way out. The block lights up while that happens.',
      nerd: `${GPU_HOP_TICKS} card ticks each way${g ? ` | now ${g.phase}` : ''}`,
    };
    default: return {
      title: 'Heatsink',
      plain: 'The card\'s own cooler under the shroud: fins the fans blow across. It is part of the card, not a part you can change.',
      nerd: spec ? `${card}: throttles at ${spec.thermal.throttleC} C` : 'built into the card; its heat adds to the case',
    };
  }
}
