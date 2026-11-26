// The almanac's Cloud storage entries (the `cloud` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const CLOUD_ENTRIES: readonly DexEntry[] = [
  {
    id: 'cloud.archive',
    name: 'Cold archive',
    cls: 'cloud',
    template: 'cloud.archive',
    contract: true,
    needs: [{ kind: 'fs', min: 2 }],
    blurb:
      'A client leaves a dataset with you for a long time and reads it back now and then. It pays for every tick you hold it.',
    stresses: ['a drive with free space', 'an OS that allocates files', 'the drive staying mounted'],
    footprint: 'a file on the drive, no memory',
    tips: [
      {
        part: 'os',
        short: 'Needs OS 2',
        text: "Only an OS with a filesystem that allocates (Paged OS 2.0 or better) can store a client's file: format a data drive, then accept the offer.",
      },
      {
        part: 'drive',
        short: 'An HDD will do',
        text: 'Reads are rare and slow ones are fine: the cheap HDD holds an archive as well as an SSD. Its seeks cost time, but a read has a long deadline.',
      },
      {
        part: 'drive',
        short: 'Keep it mounted',
        text: 'A read is served only while the OS is up with the drive mounted. A powered-off machine misses every read in that time: each one is a fee, and too many breach the contract.',
      },
      {
        part: 'drive',
        short: 'Wear and loss',
        text: 'A burnt drive or bad blocks lose the dataset: a penalty and lost reputation. Mirrored storage (the RAID module, OS 4) pays a bonus and survives one member failing.',
      },
    ],
  },
  {
    id: 'cloud.hot',
    name: 'Hot storage',
    cls: 'cloud',
    template: 'cloud.hot',
    contract: true,
    needs: [
      { kind: 'fs', min: 2 },
      { kind: 'storage', minTier: 1 },
    ],
    blurb:
      'A smaller dataset that is read often and must answer quickly. It pays more per tick, and a missed read costs more.',
    stresses: ['an SSD or better', 'queue depth', 'the drive staying mounted'],
    footprint: 'a file on the drive, no memory',
    tips: [
      {
        part: 'drive',
        short: 'An SSD or better',
        text: 'Reads come every few ticks with a short deadline: a hard disk seeks too slowly. A SATA SSD or an NVMe drive holds it.',
      },
      {
        part: 'drive',
        short: 'A deep queue',
        text: 'A drive serves one read at a time and refuses new ones when its queue is deeper than its depth. The NVMe queue is much deeper than the SATA one: put several hot contracts on it.',
      },
      {
        part: 'drive',
        short: 'Mirror it',
        text: "Hot data pays the mirrored bonus too: a RAID module (OS 4) keeps it if one member's blocks go bad.",
      },
    ],
  },
];
