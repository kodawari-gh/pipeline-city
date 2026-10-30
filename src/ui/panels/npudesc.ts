// Words for the parts of an AI card the board draws (docs/ACCEL.md "NPU internal view", render/board/npulayout.ts): the lid, the blocks of its die, each tile
// register, each row of the descriptor queue and each multiply-accumulate cell of the array. An id is the card's slot and the part: `pcie1.array`,
// `pcie1.mac2x3`. Pure. It imports nothing from logic.ts (logic.ts imports this).

import { getSpec, type CardSpec } from '../../sim/board/specs';
import type { Snapshot } from '../../sim/game/game';
import { GPU_HOP_TICKS, NpuOp } from '../../sim/isa/memmap';
import type { Description } from '../regions';

const ID = /^(pcie\d+)\.(lid|host|ctl|desc|tiles|array|post|cardmem|mac(\d+)x(\d+)|tile(\d+)|entry(\d+))$/;

/** Is this one of an AI card's part ids? */
export const isNpuId = (id: string): boolean => ID.test(id);

const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;
const OP = ['no operation', 'load', 'matmul', 'macc', 'bias', 'relu', 'store', 'layer'];
const OP_PLAIN = [
  'Nothing this card knows: it stops the launch with a fault.',
  'copies a tile of numbers from card memory into one of the tile registers.',
  'multiplies two tiles and leaves the result in the accumulators of the array.',
  'multiplies two tiles and adds the result to what the accumulators already hold.',
  'adds one number to every cell of a row of the accumulators, a bias for each row.',
  'turns every negative sum into 0.',
  'writes the accumulators back to card memory.',
  'does a whole dense layer in one step: the weights times the activations plus the bias, then relu, tile after tile.',
];

/** What the card costs a descriptor, in card ticks, on a grid of `K` (a layer's cost depends on its size). */
const costOf = (op: number, K: number): string => {
  switch (op) {
    case NpuOp.Load: case NpuOp.Store: case NpuOp.Bias: return `${1 + K} ticks`;
    case NpuOp.Matmul: case NpuOp.Macc: return `${2 + 3 * K} ticks`;
    case NpuOp.Relu: return '2 ticks';
    default: return 'by its size';
  }
};

/** Describe a card part by its id; null when the id is not one. `s` adds what the card is doing right now. */
export function describeNpuId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m) return null;
  const slot = m[1]!, part = m[2]!;
  const dev = s?.devices.find((d) => d.slot === slot && d.kind === 'npu');
  const spec = dev ? (getSpec(dev.spec) as CardSpec | undefined) : undefined;
  const v = s?.npus?.find((x) => x.slot === slot);
  const K = v?.grid ?? spec?.npu?.grid, memK = Math.round((v?.memBytes ?? spec?.npu?.memBytes ?? 0) / 1024);
  const card = spec ? spec.name : 'AI card', cells = K ? `${K} x ${K}` : 'K x K';
  const now = v ? (v.phase === 'idle' ? 'idle' : v.phase === 'run' ? `running descriptor ${v.index + 1} of ${v.count}` : v.phase === 'in' ? 'launch crossing the link' : 'answer crossing the link') : 'off';
  if (m[3] !== undefined) {
    const r = Number(m[3]), c = Number(m[4]);
    return {
      title: `Cell ${r}, ${c}`,
      plain: `One multiply-accumulate cell. It multiplies the two numbers that reach it and adds the product to the sum it keeps. Row ${r} of the first tile and column ${c} of the second meet here, and the cell passes both numbers on, to the right and downwards, so its neighbours get them a tick later.`,
      nerd: v && K ? `sum ${v.acc[r * K + c] ?? 0} | cell ${r * K + c} of ${K * K} | one multiply and one add a tick` : 'one multiply and one add a tick | passes its inputs east and south',
    };
  }
  if (m[5] !== undefined) {
    const t = Number(m[5]);
    return {
      title: `Tile register ${t}`,
      plain: `One of four small registers, each holding a ${cells} tile of numbers. A load fills it from card memory; a matrix product takes two of them. It lights up once something has been loaded into it.`,
      nerd: v ? `t${t} ${v.tiles[t] ? 'loaded this launch' : 'not loaded yet'} | ${cells} words of 32 bit` : `${cells} words of 32 bit | filled by a load`,
    };
  }
  if (m[6] !== undefined) {
    const k = Number(m[6]), d = v?.list[k];
    return {
      title: `Descriptor ${k}`,
      plain: d
        ? `Row ${k} of the list the CPU left in card memory: ${OP[d.op] ?? 'an unknown operation'} ${OP_PLAIN[d.op] ?? OP_PLAIN[0]!}`
        : `Row ${k} of the list the CPU leaves in card memory: an operation and its operands. The card runs the rows from the top, one at a time.`,
      nerd: d && K
        ? `${OP[d.op] ?? `op ${d.op}`} | a ${hex(d.a)} | b ${hex(d.b)} | ${costOf(d.op, K)}${v!.index === k ? ' | on it now' : v!.index > k ? ' | done' : ''}`
        : 'four words: op, a, b, c | cost by the operation and the grid',
    };
  }
  switch (part) {
    case 'lid': return {
      title: 'AI card',
      plain: 'A card that does one thing fast: multiply grids of numbers, the heart of a neural network. The CPU leaves it a list of small jobs and starts it; it works down the list on its own. Zoom in and the lid fades away to show its parts.',
      nerd: `${card} | ${cells} multiply-accumulate cells${memK ? ` | ${memK}K card memory` : ''}${v ? ` | ${now} | ${v.launches} launches` : ''}${dev ? ` | ${dev.tempC.toFixed(0)} C` : ''}`,
    };
    case 'host': return {
      title: 'PCIe link',
      plain: 'The card\'s connection to the machine through its slot. A launch crosses it on the way in and the answer on the way out, and it lights up while that happens. The CPU also fills card memory through it, before the launch.',
      nerd: `${GPU_HOP_TICKS} card ticks each way${spec?.pcieWidth ? ` | x${spec.pcieWidth}` : ''}${v ? ` | now ${now}` : ''}`,
    };
    case 'ctl': return {
      title: 'Control registers',
      plain: 'What the CPU writes to start the card: where the list of jobs lies in card memory (desc), how many there are (count), and the go command. It then reads the status until it says done. The cycles register tells how long the last launch took on the card.',
      nerd: v
        ? `status ${[v.busy && 'busy', v.error && 'error', v.done && 'done'].filter(Boolean).join(' ') || 'idle'} | desc ${hex(v.descAt)} | count ${v.count} | cycles ${v.cycles} | fault ${v.fault}`
        : 'status, cmd, desc, count, grid, memory size, cycles, fault | word access',
    };
    case 'desc': return {
      title: 'Descriptor queue',
      plain: 'The list of small jobs the CPU left in card memory: load a tile, multiply two tiles, add a bias, relu, store, or a whole layer at once. The card walks down it one row at a time. The bright row is the one it is on, the green ones are done.',
      nerd: `four words each: op, a, b, c | ${K ? `load, store, bias ${1 + K} ticks, matmul ${2 + 3 * K}, relu 2` : 'cost by the operation and the grid'}${v ? ` | ${now}` : ''}`,
    };
    case 'tiles': return {
      title: 'Tile registers',
      plain: `Four small registers, each holding a ${cells} tile of numbers. A load fills one from card memory; a matrix product reads two of them and feeds the array. A tile lights up once it holds something.`,
      nerd: `4 tiles of ${cells} words${v ? ` | loaded: ${v.tiles.map((t, k) => (t ? `t${k}` : '')).filter(Boolean).join(' ') || 'none'}` : ''}`,
    };
    case 'array': return {
      title: 'MAC array',
      plain: `A grid of ${cells} cells that each multiply two numbers and add the product to a sum they keep. One tile comes in from the west and the other from the north, and the numbers pass from cell to cell, right and down, so every cell meets the right pair at the right moment. The wave of light is the data moving through. A bigger grid finishes a big product in fewer steps, but each step costs the same set-up.`,
      nerd: K ? `${K * K} cells | a product takes ${2 + 3 * K} ticks: set-up 2, ${K} to fill, ${K} rows out, ${K} to drain${v ? ` | ${v.descriptors} descriptors run since power-on` : ''}` : 'set-up, fill, rows out, drain',
    };
    case 'post': return {
      title: 'Bias and relu',
      plain: 'The stage the sums pass on their way out of the array. The bias unit adds one number to every cell of a row; the relu unit turns every negative sum into 0, which is what a neural network layer does after each product.',
      nerd: `bias: ${K ? 1 + K : 'K + 1'} ticks | relu: 2 ticks | out = max(0, sum + bias)`,
    };
    case 'cardmem': return {
      title: 'Card memory',
      plain: 'The card\'s own memory. The CPU copies the weights, the activations and the descriptor list in with plain stores before a launch and reads the result out after it. The ruler is all of it; amber is what the step on show reads, green what it writes, pink the descriptor list.',
      nerd: memK ? `${memK}K | cleared at power-on${v && v.count > 0 ? ` | list at ${hex(v.descAt)}, ${v.count * 16} bytes` : ''}` : 'cleared at power-on',
    };
    default: return null;
  }
}
