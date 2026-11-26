// Icons and labels for the level UI (unlock-table kinds, job classes, job groups).

export type IconKey =
  | 'bolt'
  | 'flame'
  | 'clock'
  | 'dollar'
  | 'memory'
  | 'cpu'
  | 'lock'
  | 'check'
  | 'box'
  | 'fan'
  | 'slot'
  | 'warn'
  | 'gauge'
  | 'net'
  | 'usb'
  | 'screen'
  | 'disk'
  | 'eff'
  | 'wave'
  | 'card'
  | 'grid';

const KIND_ICON: Record<string, IconKey> = {
  cpu: 'cpu',
  os: 'cpu',
  npu: 'grid',
  ram: 'memory',
  cooler: 'fan',
  fan: 'fan',
  radiator: 'fan',
  'vrm-sink': 'fan',
  'ram-sink': 'fan',
  psu: 'bolt',
  display: 'screen',
  gpu: 'card',
  storage: 'disk',
  raid: 'disk',
  board: 'slot',
  case: 'slot',
  router: 'net',
  isp: 'net',
  nic: 'net',
  tpm: 'lock',
};

/** Icon for an unlock-table kind, for items that have no illustration yet (planned devices). */
export function kindIcon(kind: string): IconKey {
  return KIND_ICON[kind] ?? 'box';
}

/** Plain name and icon of a job class, for "new jobs at this level". */
export const JOB_CLASS_LABEL: Record<string, { label: string; icon: IconKey; hint: string }> = {
  cli: { label: 'Plain jobs', icon: 'clock', hint: 'Small jobs any machine can run.' },
  scan: { label: 'Scans', icon: 'memory', hint: 'Memory-heavy scans: more work, better pay.' },
  db: { label: 'Database', icon: 'disk', hint: 'Needs an operating system and a SATA SSD or better.' },
  web: { label: 'Web', icon: 'net', hint: 'Needs a network link.' },
  secure: { label: 'Secure', icon: 'lock', hint: 'Needs a secure module (TPM).' },
  gpu: {
    label: 'GPU',
    icon: 'screen',
    hint: 'Array jobs: a graphics card makes them faster (they run without one, slowly).',
  },
  npu: {
    label: 'AI',
    icon: 'cpu',
    hint: 'Network jobs: a neural accelerator makes them faster (they run without one, slowly).',
  },
  hpc: { label: 'Heavy compute', icon: 'fan', hint: 'Needs OS 4 and a multicore processor.' },
  cloud: {
    label: 'Cloud storage',
    icon: 'disk',
    hint: "Opt-in contracts in the job log: hold a client's data on a formatted drive (Paged OS 2.0 or better).",
  },
};

/** The icon of each group of kinds of job, for a kind that arrives after its class did. */
export const GROUP_ICON: Record<string, IconKey> = {
  everyday: 'clock',
  memory: 'memory',
  network: 'net',
  trust: 'lock',
  accel: 'card',
};
