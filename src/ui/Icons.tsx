import type { IconName } from './picker';
import { rem } from './units';

// Tiny stroke icons (16 px grid, currentColor). Used instead of sentences: bolt for power, flame for heat, clock for
// speed and latency, dollar for price, lock for blocked, check for installed, box for the inventory.
const PATHS: Record<IconName | 'sun' | 'moon' | 'menu' | 'close' | 'stats' | 'export' | 'import', string[]> = {
  bolt: ['M9.2 1.5 3.6 9h3.7l-.9 5.5L12.4 7H8.7z'],
  flame: ['M8 1.6c.6 2.3 3.4 3.4 3.4 6.8a3.4 3.4 0 0 1-6.8 0c0-1.8.9-3 1.7-3.8.2 1.2.7 2 1.5 2.3C7.4 5.2 7.5 3.4 8 1.6z'],
  clock: ['M8 14.4a6.4 6.4 0 1 0 0-12.8 6.4 6.4 0 0 0 0 12.8z', 'M8 4.6V8l2.3 1.6'],
  dollar: ['M8 1.8v12.4', 'M10.9 4.8H6.6a2 2 0 0 0 0 4h2.8a2 2 0 0 1 0 4H5.1'],
  memory: ['M2.5 5h11v6.5h-11z', 'M4.5 5V3.5M7 5V3.5M9.5 5V3.5M12 5V3.5', 'M4.5 11.5v1.5M7.5 11.5v1.5M10.5 11.5v1.5'],
  cpu: ['M4.5 4.5h7v7h-7z', 'M6.5 4.5v-2M9.5 4.5v-2M6.5 11.5v2M9.5 11.5v2M4.5 6.5h-2M4.5 9.5h-2M11.5 6.5h2M11.5 9.5h2'],
  lock: ['M3.8 7.2h8.4v6.6H3.8z', 'M5.6 7.2V5.2a2.4 2.4 0 0 1 4.8 0v2'],
  check: ['M3 8.6 6.6 12 13 4.4'],
  box: ['M2.2 5.2 8 2.4l5.8 2.8v5.8L8 13.8l-5.8-2.8z', 'M2.2 5.2 8 8l5.8-2.8', 'M8 8v5.8'],
  fan: ['M8 9.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z', 'M8 6.4C7 3.6 7.6 1.9 9.4 2.3c.8 1.6.1 3.1-1.4 4.1', 'M9.6 8c2.8-1 4.5-.4 4.1 1.4-1.6.8-3.1.1-4.1-1.4', 'M8 9.6c-2.8 1-4.5.4-4.1-1.4 1.6-.8 3.1-.1 4.1 1.4', 'M6.4 8C5.4 10.8 3.9 12.1 2.5 11.7c.3-1.6 1.9-3 3.9-3.7'],
  slot: ['M1.8 5.5h12.4v5H1.8z', 'M4 5.5v5M6.6 5.5v5M9.2 5.5v5M11.8 5.5v5'],
  warn: ['M8 2.2 14.2 13H1.8z', 'M8 6.4v3.2', 'M8 11.3v.2'],
  gauge: ['M2.2 11.6a5.8 5.8 0 1 1 11.6 0', 'M8 11.6 10.9 7.8'],
  net: ['M5.5 10.5a3.5 3.5 0 0 1 5 0', 'M3.4 8.3a6.3 6.3 0 0 1 9.2 0', 'M8 13.2h.01'],
  usb: ['M8 2v9.5', 'M5.8 4.3 8 2l2.2 2.3', 'M4.6 9.2h6.8l-3.4 3.6z', 'M5.6 7.2h-2.4v2.4', 'M10.4 6.2h2.4v2.2'],
  screen: ['M2 3h12v8H2z', 'M6 14h4', 'M8 11v3'],
  disk: ['M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4z', 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z'],
  eff: ['M3 13 13 3', 'M4.3 4.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z', 'M11.7 9a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z'],
  wave: ['M1.5 8c1.6-2.8 3.1-2.8 4.6 0s3 2.8 4.6 0 2.2-2.4 3.8-1.6'],
  sun: ['M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z', 'M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1'],
  moon: ['M12.8 9.6A5.4 5.4 0 0 1 6.4 3.2a5.4 5.4 0 1 0 6.4 6.4z'],
  menu: ['M3.5 8h.01M8 8h.01M12.5 8h.01'],
  close: ['M4 4l8 8M12 4l-8 8'],
  stats: ['M3 13.5V9M8 13.5V4.5M13 13.5V7'],
  export: ['M8 2.5v8', 'M5 7.5 8 10.5l3-3', 'M2.5 11.5v2h11v-2'],
  import: ['M8 10.5v-8', 'M5 5.5 8 2.5l3 3', 'M2.5 11.5v2h11v-2'],
};

export function Icon({ name, size = 14, class: cls }: { name: keyof typeof PATHS; size?: number; class?: string }) {
  const filled = name === 'bolt' || name === 'menu';
  return (
    <svg class={`ico ${cls ?? ''}`} style={{ width: rem(size), height: rem(size) }} viewBox="0 0 16 16" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      {PATHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
