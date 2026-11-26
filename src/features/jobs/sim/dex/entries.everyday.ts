// The almanac's Everyday entries (the `everyday` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const EVERYDAY_ENTRIES: readonly DexEntry[] = [
  {
    id: 'log',
    name: 'Log line',
    cls: 'cli',
    template: 'cli.log',
    legacy: true,
    blurb: 'A few status lines written to the display.',
    stresses: ['display speed', 'CPU clock'],
    footprint: 'a few bytes of the display',
    tips: [
      {
        part: 'display',
        short: 'Faster display',
        text: 'It waits for the display to be idle and writes line by line: a faster display (its write latency) and a higher CPU clock shorten it.',
      },
      {
        part: 'ram',
        short: 'RAM does nothing',
        none: true,
        text: 'Memory does not matter: a bigger or faster stick changes nothing here.',
      },
      {
        part: 'os',
        short: 'Cheap with an OS',
        text: 'It is the cheapest job there is: with an OS it costs almost nothing to keep the machine busy with them.',
      },
    ],
  },
  {
    id: 'calc',
    name: 'Calculation',
    cls: 'cli',
    template: 'cli.calc',
    legacy: true,
    blurb: 'A chain of multiply-and-add rounds, shown as a two-digit result.',
    stresses: ['CPU clock', 'multiplier and branch speed'],
    footprint: 'registers only',
    tips: [
      {
        part: 'clock',
        short: 'Clock beats width',
        text: 'Every round depends on the one before, so a wider CPU (2-wide, out-of-order) gains little: a higher clock gains more.',
      },
      {
        part: 'predictor',
        short: 'Loop predictor',
        text: 'The loop branch is taken every round: a predictor that learns a loop (2-bit counters) saves the redirect penalty.',
      },
      {
        part: 'ram',
        short: 'No memory use',
        none: true,
        text: 'No memory traffic at all: RAM and caches are irrelevant.',
      },
    ],
  },
  {
    id: 'checksum',
    name: 'Checksum',
    cls: 'cli',
    template: 'cli.checksum',
    legacy: true,
    blurb: 'Hash a few words of data and show the low bits.',
    stresses: ['load and ALU speed', 'D-cache'],
    footprint: 'a few dozen bytes',
    tips: [
      {
        part: 'cache',
        short: 'Forwarding, D-cache',
        text: 'Each word is loaded, mixed, and the next load waits for it: forwarding and a bigger D-cache hide the load latency.',
      },
      {
        part: 'ram',
        short: 'One cold miss',
        none: true,
        text: 'The data is tiny, so only the first touch misses: RAM latency matters once, not per word.',
      },
    ],
  },
  {
    id: 'fib',
    name: 'Fibonacci',
    cls: 'cli',
    template: 'cli.fib',
    level: 4,
    blurb: 'Add the last two numbers, again and again: every step waits for the one before.',
    stresses: ['ALU latency', 'forwarding'],
    footprint: 'registers only',
    tips: [
      {
        part: 'cpu',
        short: 'Forwarding helps',
        text: 'Every add needs the sum before it: a CPU that forwards results between stages (the Tiny-5F and up) saves a stall on every step, and the one without forwarding pays it each time.',
      },
      {
        part: 'clock',
        short: 'Clock beats width',
        text: 'It is one long chain with nothing to overlap, so a wider CPU gains nothing: a higher clock does.',
      },
      {
        part: 'ram',
        short: 'No memory use',
        none: true,
        text: 'No memory traffic at all: RAM and caches are irrelevant.',
      },
    ],
  },
  {
    id: 'reverse',
    name: 'Reverse text',
    cls: 'cli',
    template: 'cli.reverse',
    level: 4,
    blurb: 'Write a word to the display backwards, one byte at a time.',
    stresses: ['display speed', 'byte stores'],
    footprint: 'a few bytes of the display',
    tips: [
      {
        part: 'display',
        short: 'Faster display',
        text: 'Every byte goes straight to the display, which takes its time on each store: a faster display (its write latency) shortens it most.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'Between the stores the CPU only counts down and steps two pointers: a higher clock shortens the gaps.',
      },
      {
        part: 'ram',
        short: 'RAM does nothing',
        none: true,
        text: 'The word sits in the program: memory does not matter.',
      },
    ],
  },
  {
    id: 'gcd',
    name: 'Greatest common divisor',
    cls: 'cli',
    template: 'cli.gcd',
    level: 5,
    blurb: 'Take the smaller number from the larger until they meet: which way each step goes depends on the data.',
    stresses: ['branch predictor', 'CPU clock'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'predictor',
        short: 'Better predictor',
        text: 'Each step goes one of two ways, and the numbers decide: a CPU that guesses wrong throws work away, so a quicker redirect (or a bigger predictor table) helps, though no table learns data this random.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'The loop is short and its branches cost cycles: a higher clock shortens every one of them.',
      },
      {
        part: 'ram',
        short: 'No memory use',
        none: true,
        text: 'Two loads per pair and then registers only: RAM and caches are irrelevant.',
      },
    ],
  },
  {
    id: 'popcount',
    name: 'Bit count',
    cls: 'cli',
    template: 'cli.popcount',
    level: 5,
    blurb: 'Count the 1 bits in a few words, one shift at a time.',
    stresses: ['CPU clock', 'branch speed'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'predictor',
        short: 'Loop predictor',
        text: 'The inner loop runs once per bit and stops when the word is empty: a predictor with 2-bit counters learns it and misses only when it ends.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'Five instructions per bit, nothing to overlap: a higher clock helps most.',
      },
      { part: 'ram', short: 'No memory use', none: true, text: 'One load per word: RAM and caches are irrelevant.' },
    ],
  },
  {
    id: 'sort',
    name: 'Sort',
    cls: 'cli',
    template: 'cli.sort',
    level: 6,
    blurb: 'Put a handful of numbers in order by shuffling them along in memory.',
    stresses: ['loads and stores', 'D-cache', 'branches'],
    footprint: 'a few dozen bytes at 0x4000',
    tips: [
      {
        part: 'cache',
        short: 'D-cache helps',
        text: 'The array is walked back and forth many times: a D-cache that holds all of it turns each pass into hits, and one that does not misses again and again.',
      },
      {
        part: 'predictor',
        short: 'Predictor',
        text: 'Whether a number moves on depends on the data: mispredicted branches cost a redirect each, so a CPU that recovers fast helps.',
      },
      {
        part: 'cpu',
        short: 'Forwarding again',
        text: 'A load, then a compare of what it loaded: forwarding hides the wait between them.',
      },
    ],
  },
  {
    id: 'matmul',
    name: 'Matrix product',
    cls: 'cli',
    template: 'cli.matmul',
    level: 7,
    blurb: 'Multiply two small square matrices and add up the result: three loops of multiply-and-add.',
    stresses: ['the multiplier', 'loads', 'CPU width'],
    footprint: 'two small tables in the program',
    tips: [
      {
        part: 'cpu',
        short: 'A wider CPU',
        text: 'The products of different elements do not depend on each other, so a 2-wide or out-of-order CPU overlaps them and finishes sooner.',
      },
      {
        part: 'cache',
        short: 'D-cache holds both',
        text: 'Both matrices are read again and again: a D-cache big enough for them avoids misses on every pass.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'Three multiplies per step: the multiplier is the busiest unit, and its speed follows the clock.',
      },
    ],
  },
  {
    id: 'crc',
    name: 'CRC check',
    cls: 'cli',
    template: 'cli.crc',
    level: 8,
    blurb: 'A cyclic redundancy check, one bit at a time: 32 shifts for every word.',
    stresses: ['branch predictor', 'CPU clock'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'predictor',
        short: 'Bigger predictor',
        text: 'Whether the polynomial is mixed in follows each bit of the data, so about half the branches go each way: no predictor can learn random data, but one that recovers fast loses less.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'Six instructions per bit with nothing to overlap: a higher clock helps most.',
      },
      { part: 'ram', short: 'No memory use', none: true, text: 'One load per word: RAM and caches are irrelevant.' },
    ],
  },
];
