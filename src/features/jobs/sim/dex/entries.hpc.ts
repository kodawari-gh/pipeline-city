// The almanac's High-performance entries (the `hpc` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const HPC_ENTRIES: readonly DexEntry[] = [
  {
    id: 'hpc-reduce',
    name: 'Parallel sum',
    cls: 'hpc',
    template: 'hpc.reduce',
    level: 14,
    scale: 8,
    needs: [
      { kind: 'cores', min: 2 },
      { kind: 'os', min: 4 },
    ],
    blurb: 'Add up a long list of numbers: each of two threads takes half and the two halves are added at the end.',
    stresses: ['cores', 'memory bandwidth'],
    footprint: 'one array of 64 words per unit of scale, split between the threads',
    tips: [
      {
        part: 'cpu',
        short: 'More cores',
        text: 'Two threads share the list, so two cores finish in about half the time of one. A third core changes nothing: the job has two threads.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
      {
        part: 'cache',
        short: 'Little to cache',
        text: 'Every number is read once and multiplied by itself: a bigger cache helps only a little, and a faster core helps as much as it does anywhere.',
      },
    ],
  },
  {
    id: 'hpc-matmul',
    name: 'Matrix product',
    cls: 'hpc',
    template: 'hpc.matmul',
    level: 14,
    scale: 8,
    needs: [
      { kind: 'cores', min: 2 },
      { kind: 'os', min: 4 },
    ],
    blurb: 'Multiply two small square matrices: the rows of the answer are split between two threads.',
    stresses: ['cores', 'the multiplier'],
    footprint: 'an 8-row matrix, a matrix of 8 columns and the answer, a few K at most',
    tips: [
      {
        part: 'cpu',
        short: 'More cores',
        text: 'Each thread computes half the rows of the answer, so two cores finish in about half the time.',
      },
      {
        part: 'cpu',
        short: 'The multiplier',
        text: 'Almost all the time goes in multiplies: a core with a faster multiplier or a wider out-of-order engine shortens every row.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
  {
    id: 'hpc-nbody',
    name: 'N-body step',
    cls: 'hpc',
    template: 'hpc.nbody',
    level: 15,
    scale: 8,
    needs: [
      { kind: 'cores', min: 2 },
      { kind: 'os', min: 4 },
    ],
    blurb:
      'Work out the pull of every body on every other, and move them one step: two threads each take half the bodies.',
    stresses: ['cores', 'the multiplier', 'cache'],
    footprint: 'sixteen positions, twice (this step and the last)',
    tips: [
      {
        part: 'cpu',
        short: 'More cores',
        text: 'Each thread moves half of the bodies, but both read every position and they wait for each other after every step: two cores finish in somewhat over half the time.',
      },
      {
        part: 'cache',
        short: 'Shared reads',
        text: 'Both threads read all the positions: a cache that holds them keeps the second core from waiting on memory.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
  {
    id: 'hpc-montecarlo',
    name: 'Monte Carlo',
    cls: 'hpc',
    template: 'hpc.montecarlo',
    level: 15,
    scale: 8,
    needs: [
      { kind: 'cores', min: 4 },
      { kind: 'os', min: 4 },
    ],
    blurb:
      'Throw seeded random points and count how many land inside: four threads each throw a quarter and the counts are added.',
    stresses: ['cores', 'single-thread speed'],
    footprint: 'no table: each point comes from a hash of its number',
    tips: [
      {
        part: 'cpu',
        short: 'Four cores',
        text: 'Four independent streams of work with almost no memory traffic, and a single wait at the end: it is the job that scales best with the number of cores, up to four.',
      },
      {
        part: 'cpu',
        short: 'Threads on one core',
        text: 'Two threads on one core (SMT or switch-on-miss) share its units: they help less than a second core, but they cost less.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
  {
    id: 'hpc-sort',
    name: 'Parallel sort',
    cls: 'hpc',
    template: 'hpc.sort',
    level: 16,
    scale: 8,
    needs: [
      { kind: 'cores', min: 4 },
      { kind: 'os', min: 4 },
    ],
    blurb: 'Sort a list: four threads sort a quarter each and then the sorted quarters are merged one after the other.',
    stresses: ['cores', 'branch prediction', 'cache'],
    footprint: '16 words per unit of scale, and the merged copy',
    tips: [
      {
        part: 'cpu',
        short: 'Four cores',
        text: "The four quarters are sorted at once; the merge at the end is one thread's work, so the job does not get four times faster.",
      },
      {
        part: 'predictor',
        short: 'Branch predictor',
        text: 'Every comparison is a branch that goes either way: a better predictor shortens the sorting of each quarter.',
      },
      {
        part: 'cache',
        short: 'The copy',
        text: 'The merge reads from every quarter and writes a copy: a bigger cache keeps both close.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
  {
    id: 'hpc-bfs',
    name: 'Graph search',
    cls: 'hpc',
    template: 'hpc.bfs',
    level: 17,
    scale: 8,
    needs: [
      { kind: 'cores', min: 8 },
      { kind: 'os', min: 4 },
    ],
    blurb:
      'Find how far every point of a graph is from the first one, level by level: eight threads settle their own points each level and meet at a barrier before the next.',
    stresses: ['cores', 'memory latency', 'barriers'],
    footprint: 'two in-edges per vertex, and the level of each vertex',
    tips: [
      {
        part: 'cpu',
        short: 'Eight cores',
        text: 'Eight threads share every level: the job needs a CPU with eight logical cores, and on them it is several times faster than on two.',
      },
      {
        part: 'ram',
        short: 'Scattered reads',
        text: 'Each point looks up its two in-edges, which are all over the table: low memory latency matters more than bandwidth.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
  {
    id: 'hpc-fft',
    name: 'Fourier transform',
    cls: 'hpc',
    template: 'hpc.fft',
    level: 17,
    scale: 8,
    needs: [
      { kind: 'cores', min: 8 },
      { kind: 'os', min: 4 },
    ],
    blurb:
      'Transform a signal stage by stage with butterflies (a sum and a difference of two values): eight threads take their share of each stage and wait for each other between stages.',
    stresses: ['cores', 'barriers', 'memory'],
    footprint: 'one array of 64 to 256 words, updated in place',
    tips: [
      {
        part: 'cpu',
        short: 'Eight cores',
        text: 'Eight threads share every stage: the job needs eight logical cores, and on them it is several times faster than on two.',
      },
      {
        part: 'cpu',
        short: 'The barrier',
        text: 'After each stage every thread waits for the slowest: one slow core holds up all of them.',
      },
      {
        part: 'os',
        short: 'Needs OS 4',
        text: 'It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it.',
      },
    ],
  },
];
