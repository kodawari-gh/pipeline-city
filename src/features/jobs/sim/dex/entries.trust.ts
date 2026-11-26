// The almanac's Trust entries (the `trust` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const TRUST_ENTRIES: readonly DexEntry[] = [
  {
    id: 'secure',
    name: 'Signed transaction',
    cls: 'secure',
    template: 'secure.sign',
    legacy: true,
    blurb: 'Measure its data with the TPM, hash it in protected mode, seal the digest and unseal it.',
    stresses: ['TPM speed', 'protected-mode surcharge', 'ECC RAM'],
    footprint: 'a few words of data, in protected memory',
    tips: [
      {
        part: 'tpm',
        short: 'TPM and ECC',
        text: 'It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused.',
      },
      {
        part: 'clock',
        short: 'Faster CPU',
        text: 'Inside protected mode every RAM access pays an encryption surcharge, so the hashing is slower than a plain checksum: a faster CPU helps there.',
      },
      {
        part: 'tpm',
        short: 'TPM clock is fixed',
        none: true,
        text: 'The TPM itself runs on one slow clock: its measure and attest waits are fixed, whatever the CPU does.',
      },
    ],
  },
  {
    id: 'verify',
    name: 'Integrity check',
    cls: 'secure',
    template: 'secure.verify',
    level: 9,
    scale: 2,
    blurb: 'Measure blocks of data with the TPM and compare each with the digest that was promised for it.',
    stresses: ['TPM speed', 'the TPM header'],
    footprint: 'a few blocks of 32 bytes in the program',
    tips: [
      {
        part: 'tpm',
        short: 'A faster module',
        text: 'Each block is one measure command and the module hashes it word by word on its own slow clock (4 module ticks a word on the Secure module, 1 on module 2): the faster module shortens it, whatever the CPU does.',
      },
      {
        part: 'tpm',
        short: 'TPM and ECC',
        text: 'It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused.',
      },
      {
        part: 'clock',
        short: 'CPU speed barely helps',
        none: true,
        text: 'The CPU only starts a command and waits for the answer: a faster CPU shortens the few instructions in between and nothing else.',
      },
    ],
  },
  {
    id: 'measure',
    name: 'Measured boot',
    cls: 'secure',
    template: 'secure.measure',
    level: 10,
    scale: 2,
    blurb:
      'Measure several stages one after the other and fold each result into a chain, as a machine does when it boots.',
    stresses: ['TPM speed', 'the TPM header'],
    footprint: 'a few blocks of 32 bytes in the program',
    tips: [
      {
        part: 'tpm',
        short: 'A faster module',
        text: 'Every stage is a measure command, so the time is the number of stages times the module hashing eight words: module 2 hashes each word four times faster.',
      },
      {
        part: 'tpm',
        short: 'TPM and ECC',
        text: 'It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused.',
      },
      {
        part: 'clock',
        short: 'CPU speed barely helps',
        none: true,
        text: 'Between the commands there is one shift, one add and one xor: the CPU waits on the module the rest of the time.',
      },
    ],
  },
  {
    id: 'encrypt',
    name: 'Protected hash',
    cls: 'secure',
    template: 'secure.encrypt',
    level: 10,
    scale: 2,
    blurb: 'Hash two buffers inside protected mode, where every memory access costs extra.',
    stresses: ['the protected-mode surcharge', 'CPU clock'],
    footprint: 'two buffers of 64 bytes in the program',
    tips: [
      {
        part: 'tpm',
        short: 'A lower surcharge',
        text: 'Inside protected mode every RAM access pays extra cycles: +2 on the Secure module, +1 on module 2. This is the job where that difference counts most.',
      },
      {
        part: 'clock',
        short: 'A faster CPU',
        text: 'Only two commands go to the module: the rest is hashing, which a higher CPU clock shortens.',
      },
      {
        part: 'cache',
        short: 'D-cache does not help',
        none: true,
        text: 'The surcharge is charged on the access, not on the miss: a bigger D-cache does not avoid it.',
      },
    ],
  },
  {
    id: 'vault',
    name: 'Key vault',
    cls: 'secure',
    template: 'secure.vault',
    level: 11,
    scale: 2,
    blurb: 'Seal several secrets under their own handles, then unseal them all again.',
    stresses: ['the TPM header', 'TPM seal time'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'tpm',
        short: 'Module 2 no faster',
        none: true,
        text: 'Sealing and unsealing take the same time on both modules: the two trips over the header and the seal itself are fixed, so a second module does not help here.',
      },
      {
        part: 'tpm',
        short: 'TPM and ECC',
        text: 'It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused.',
      },
      {
        part: 'clock',
        short: 'CPU speed no help',
        none: true,
        text: 'The CPU sends a command and waits for it: nothing it does can be shorter than the header trip.',
      },
    ],
  },
  {
    id: 'rotate',
    name: 'Key rotation',
    cls: 'secure',
    template: 'secure.rotate',
    level: 12,
    scale: 2,
    blurb: 'Unseal a value, change it, seal it again, and do it round after round: each round needs the last one.',
    stresses: ['the TPM header', 'the multiplier'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'tpm',
        short: 'Module 2 no faster',
        none: true,
        text: 'Sealing and unsealing take the same time on both modules, and every round needs two of them one after the other: nothing can overlap.',
      },
      {
        part: 'tpm',
        short: 'TPM and ECC',
        text: 'It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused.',
      },
      {
        part: 'clock',
        short: 'Faster CPU, a little',
        text: 'Between the commands the CPU multiplies once: its speed shortens only that, and the trips over the header stay.',
      },
    ],
  },
  {
    id: 'attest',
    name: 'Attestation burst',
    cls: 'secure',
    template: 'secure.attest',
    level: 13,
    scale: 2,
    needs: [{ kind: 'tpm', minTier: 2 }, { kind: 'ecc' }],
    blurb: 'Answer a burst of attestation requests: each one is a quote the module works out on its own.',
    stresses: ['TPM attest time'],
    footprint: 'a few words in the program',
    tips: [
      {
        part: 'tpm',
        short: 'Module 2 attests faster',
        text: 'A quote takes 60 module ticks on the Secure module and 20 on module 2, and the job asks for a burst of them: it is the one job that needs the faster module.',
      },
      {
        part: 'tpm',
        short: 'Needs module 2',
        text: 'Clients only send it once a machine has the second module: with the first one it is refused at the port.',
      },
      {
        part: 'clock',
        short: 'CPU speed no help',
        none: true,
        text: 'The CPU starts a quote and waits: only the module decides how long it takes.',
      },
    ],
  },
];
