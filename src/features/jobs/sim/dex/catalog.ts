// The almanac's list (docs/JOBS.md "The catalogue"): every entry in the order the collection shows it, and the groups that sort them.

import type { DexEntry, DexGroup } from './types';
import { EVERYDAY_ENTRIES } from './entries.everyday';
import { MEMORY_ENTRIES } from './entries.memory';
import { NETWORK_ENTRIES } from './entries.network';
import { TRUST_ENTRIES } from './entries.trust';
import { ACCEL_ENTRIES } from './entries.accel';
import { CLOUD_ENTRIES } from './entries.cloud';
import { HPC_ENTRIES } from './entries.hpc';

export const DEX_GROUPS: readonly DexGroup[] = [
  {
    id: 'everyday',
    name: 'Everyday',
    color: '#4fd1c5',
    ids: ['log', 'calc', 'checksum', 'fib', 'reverse', 'gcd', 'popcount', 'sort', 'matmul', 'crc'],
  },
  {
    id: 'memory',
    name: 'Memory-hungry',
    color: '#f0803c',
    ids: ['scan', 'chase', 'stream', 'stencil', 'transpose', 'sieve', 'db', 'hashtab'],
  },
  {
    id: 'network',
    name: 'Network',
    color: '#5b9cf5',
    ids: ['page', 'api', 'dns', 'form', 'search', 'upload', 'image', 'video'],
  },
  {
    id: 'trust',
    name: 'Trust',
    color: '#ef5b7b',
    ids: ['secure', 'verify', 'measure', 'encrypt', 'vault', 'rotate', 'attest'],
  },
  {
    id: 'accel',
    name: 'Accelerators',
    color: '#8b7cf6',
    ids: ['vadd', 'saxpy', 'thresh', 'blur3', 'poly', 'mandel', 'sphere', 'perceptron', 'npu', 'deep'],
  },
  {
    id: 'hpc',
    name: 'High-performance',
    color: '#f2c14e',
    ids: ['hpc-reduce', 'hpc-matmul', 'hpc-nbody', 'hpc-montecarlo', 'hpc-sort', 'hpc-bfs', 'hpc-fft'],
  },
  { id: 'cloud', name: 'Cloud storage', color: '#3be3ff', ids: ['cloud.archive', 'cloud.hot'] },
];

export const JOB_DEX: readonly DexEntry[] = [
  ...EVERYDAY_ENTRIES,
  ...MEMORY_ENTRIES,
  ...NETWORK_ENTRIES,
  ...TRUST_ENTRIES,
  ...ACCEL_ENTRIES,
  ...CLOUD_ENTRIES,
  ...HPC_ENTRIES,
];
