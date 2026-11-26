// The almanac's Memory-hungry entries (the `memory` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const MEMORY_ENTRIES: readonly DexEntry[] = [
  {
    id: 'scan',
    name: 'Memory scan',
    cls: 'scan',
    template: 'cli.scan',
    legacy: true,
    blurb: 'Fill a buffer at a fixed stride, then add it all up: every element on a new cache line.',
    stresses: ['RAM latency', 'DRAM banks and open rows', 'D-cache size', 'memory channels'],
    footprint: 'up to about 8K of buffer at 0x4000',
    tips: [
      {
        part: 'ram',
        short: 'Faster RAM timings',
        text: 'The stride defeats the cache, so it is bound by memory latency: faster RAM (lower tCL, tRCD, tRP) helps directly, and a RAM overclock helps more.',
      },
      {
        part: 'bank',
        short: 'Open rows',
        text: 'The fill walks memory in order: with the open page policy the next element is often in the row that is already open (a row hit).',
      },
      {
        part: 'bank',
        short: 'Banks, two channels',
        text: 'More banks keep more rows open at once, and two sticks on a dual-channel controller let two misses go out together.',
      },
      {
        part: 'cache',
        short: 'Bigger D-cache, L2',
        text: 'A bigger D-cache or an L2 keeps the second pass (the sum) from missing again.',
      },
    ],
  },
  {
    id: 'db',
    name: 'In-memory index',
    cls: 'db',
    template: 'db.index',
    legacy: true,
    blurb: 'Build a table of 256-byte records, one per page, then look them up all over.',
    stresses: ['how much RAM there is', 'page faults (paged OS)', 'TLB size', 'DRAM banks and row conflicts'],
    footprint: 'a 32K table at 0x10000 (64K to 512K at larger scales)',
    tips: [
      {
        part: 'ram',
        short: 'RAM past 96K',
        text: 'It needs RAM that reaches past the table: with less than 96K installed it is refused at the port, and bigger tables need more.',
      },
      {
        part: 'os',
        short: 'OS 1 is fastest',
        text: 'The table is claimed one page at a time. On OS 1 that is free; under a paged OS each page is a page fault the kernel has to serve, so OS 1 finishes it fastest.',
      },
      {
        part: 'bank',
        short: 'More banks',
        text: 'The lookups are scattered: they land in different DRAM rows, so row conflicts are the rule. More banks keep more rows open, and a DDR4 or DDR5 stick has many more banks than SDRAM.',
      },
      {
        part: 'tlb',
        short: 'Bigger TLB',
        text: 'A bigger TLB (a CPU with 16 or 32 entries) keeps the lookups from walking the page table each time.',
      },
      {
        part: 'drive',
        short: 'Needs an SSD',
        text: 'It needs an OS and a SATA SSD or better, because the program is loaded from the spool on the drive.',
      },
    ],
  },
  {
    id: 'chase',
    name: 'Pointer chase',
    cls: 'scan',
    template: 'mem.chase',
    level: 6,
    scale: 4,
    needs: [{ kind: 'ram', minBytes: 24_576 }],
    blurb: 'Follow a ring of linked nodes: every address is the answer to the load before it.',
    stresses: ['RAM latency', 'D-cache size'],
    footprint: 'a ring of 8K at 0x4000',
    tips: [
      {
        part: 'ram',
        short: 'Lower RAM latency',
        text: 'Every step waits for a load whose address is the load before it, so nothing overlaps: the time is the number of steps times the memory latency. Faster RAM (lower tCL, tRCD, tRP) or a RAM overclock cuts it directly.',
      },
      {
        part: 'cache',
        short: 'Cache holds the ring',
        text: 'The walk goes round the ring twice: a D-cache or an L2 big enough for it (and associative enough) turns the second lap into hits; one smaller than the ring misses at every step.',
      },
      {
        part: 'cpu',
        short: 'Width does nothing',
        none: true,
        text: 'A wider or out-of-order CPU has nothing to run ahead with, because each load needs the last: a higher clock is the only CPU help.',
      },
    ],
  },
  {
    id: 'stream',
    name: 'Block copy',
    cls: 'scan',
    template: 'mem.stream',
    level: 6,
    scale: 4,
    needs: [{ kind: 'ram', minBytes: 17_408 }],
    blurb: 'Fill a block, copy it to another, and hash the copy: every address is the next one along.',
    stresses: ['RAM bandwidth', 'open rows'],
    footprint: 'two blocks of 512 bytes at 0x4000',
    tips: [
      {
        part: 'bank',
        short: 'Open rows',
        text: 'The copy walks memory in order, so with the open page policy nearly every read and write lands in a row that is already open.',
      },
      {
        part: 'bank',
        short: 'Two channels',
        text: 'Two sticks on a dual-channel CPU let a read and a write go out together instead of one after the other.',
      },
      {
        part: 'cache',
        short: 'A bigger D-cache',
        text: 'The copy is read once going in and once again by the hash: a D-cache that holds it saves the second trip to RAM.',
      },
    ],
  },
  {
    id: 'stencil',
    name: 'Neighbour sum',
    cls: 'scan',
    template: 'mem.stencil',
    level: 7,
    scale: 4,
    needs: [{ kind: 'ram', minBytes: 17_408 }],
    blurb: 'Each output is the sum of three neighbours: three loads for every store, most of them seen a moment ago.',
    stresses: ['D-cache', 'CPU width'],
    footprint: 'two arrays of 512 bytes at 0x4000',
    tips: [
      {
        part: 'cache',
        short: 'D-cache pays',
        text: 'Each value is loaded three times in three different rounds: a D-cache that keeps the last lines turns two of the three loads into hits.',
      },
      {
        part: 'cpu',
        short: 'A wider CPU',
        text: 'The three loads of a round do not depend on each other: a 2-wide or out-of-order CPU overlaps them.',
      },
      {
        part: 'clock',
        short: 'Higher CPU clock',
        text: 'Between the loads there is little but additions: a higher clock shortens every round.',
      },
    ],
  },
  {
    id: 'transpose',
    name: 'Transpose',
    cls: 'scan',
    template: 'mem.transpose',
    level: 7,
    scale: 1,
    needs: [{ kind: 'ram', minBytes: 17_408 }],
    blurb: 'Turn rows into columns: read along a row, write down a column.',
    stresses: ['D-cache conflicts', 'DRAM banks'],
    footprint: 'two small matrices at 0x4000',
    tips: [
      {
        part: 'cache',
        short: 'Fewer conflicts',
        text: 'The writes jump a whole row each time, so they land on the same few cache lines and push each other out: a bigger or 2-way D-cache (the memory branch of the CPU tree) keeps them.',
      },
      {
        part: 'bank',
        short: 'More banks',
        text: 'Each write lands in a different DRAM row: more banks keep more rows open.',
      },
      {
        part: 'ram',
        short: 'Faster RAM timings',
        text: 'Most of the writes miss, so memory latency counts: faster RAM shortens every one.',
      },
    ],
  },
  {
    id: 'sieve',
    name: 'Prime sieve',
    cls: 'scan',
    template: 'mem.sieve',
    level: 8,
    scale: 2,
    needs: [{ kind: 'ram', minBytes: 17_408 }],
    blurb: 'Count the primes below a number by crossing off multiples in a row of byte flags.',
    stresses: ['D-cache', 'byte stores', 'branches'],
    footprint: 'one byte per number at 0x4000',
    tips: [
      {
        part: 'cache',
        short: 'Cache holds the flags',
        text: 'The flags are read and written over and over: a D-cache that holds them hits every time after the first.',
      },
      {
        part: 'predictor',
        short: 'Redirect speed',
        text: 'The test of each number goes one way for a prime and the other for a composite, in a pattern that is hard to guess: a quick redirect helps.',
      },
      {
        part: 'ram',
        short: 'RAM size no help',
        none: true,
        text: 'The flags are tiny: more RAM changes nothing, only the cache in front of it.',
      },
    ],
  },
  {
    id: 'hashtab',
    name: 'Hash table',
    cls: 'db',
    template: 'mem.hashtab',
    level: 8,
    scale: 1,
    needs: [
      { kind: 'os', min: 1 },
      { kind: 'ram', minBytes: 66_560 },
    ],
    blurb: 'Put keys in a table in the big heap by a scattering hash, then look every one up.',
    stresses: ['RAM past 64K', 'page faults (paged OS)', 'TLB', 'DRAM banks'],
    footprint: 'a 1K table at 0x10000',
    tips: [
      {
        part: 'ram',
        short: 'RAM past 65K',
        text: 'The table lives in the heap above 64K: with less RAM installed the job is refused at the port.',
      },
      {
        part: 'os',
        short: 'OS 1 is fastest',
        text: 'The heap is claimed a page at a time. On OS 1 that is free; under a paged OS each page is a page fault the kernel has to serve.',
      },
      {
        part: 'tlb',
        short: 'A bigger TLB',
        text: 'The keys scatter over the pages of the table: a bigger TLB keeps their translations instead of walking the page table.',
      },
      {
        part: 'bank',
        short: 'More banks',
        text: 'The slots land in different DRAM rows: more banks keep more rows open.',
      },
    ],
  },
];
