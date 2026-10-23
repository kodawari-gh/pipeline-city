import type { JSX } from 'preact';
import { BOARD_TIERS, getSpec, type CpuSpec, type PsuSpec, type RamSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import { goodness } from './picker';

// Inline SVG illustrations of each part, drawn from its spec: a CPU die with its pipeline per tier, RAM sticks (count
// and size) with a latency gauge, a cooler with fins/fan/tubes, a PSU wattage dial, a board with its slot counts.
// Colours come from the theme classes in ui.css (`.art .ink` etc.), so light and dark both work.

const VB = { w: 120, h: 84 };

function Cpu({ spec }: { spec: CpuSpec }) {
  const e = spec.engine;
  const pins = Array.from({ length: 7 }, (_, i) => 26 + i * 11);
  return (
    <>
      {pins.map((x) => <rect key={`t${x}`} x={x} y={6} width={4} height={6} class="pin" />)}
      {pins.map((x) => <rect key={`b${x}`} x={x} y={72} width={4} height={6} class="pin" />)}
      <rect x={14} y={12} width={92} height={60} rx={6} class="plate edge" />
      <rect x={24} y={20} width={72} height={44} rx={3} class="die" />
      {e.kind === 'unpipelined' ? (
        <>
          <rect x={32} y={30} width={56} height={24} rx={2} class="ink" />
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={36 + i * 10} y={36} width={6} height={12} rx={1} class="ink-on" />)}
        </>
      ) : (
        <>
          {e.kind === 'inorder' && e.forwarding && (
            <path d="M34 28 Q60 12 86 28" class="fwd" fill="none" stroke-width={1.6} />
          )}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={28 + i * 14} y={34} width={11} height={14} rx={2} class={i === 2 ? 'ink' : 'ink2'} />
          ))}
          {e.kind === 'inorder' && e.cacheLines ? (
            <>
              {Array.from({ length: 8 }, (_, i) => (
                <rect key={i} x={30 + i * 8} y={53} width={6} height={6} rx={1} class="cache" />
              ))}
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function Ram({ spec }: { spec: RamSpec }) {
  const sticks = Math.max(1, Math.min(4, Math.round(spec.sizeBytes / (16 * 1024))));
  const g = goodness('ram', 'latency', spec.latency, false);
  const x0 = 18;
  const gap = 4;
  const w = 9;
  const h = 46;
  const arc = 'M80 62 A18 18 0 0 1 116 62';
  return (
    <>
      {Array.from({ length: sticks }, (_, i) => (
        <g key={i}>
          <rect x={x0 + i * (w + gap)} y={16} width={w} height={h} rx={1.5} class="stick" />
          <rect x={x0 + i * (w + gap)} y={16} width={w} height={6} rx={1.5} class="ink" />
          <rect x={x0 + i * (w + gap) + 2} y={28} width={w - 4} height={5} class="chipd" />
        </g>
      ))}
      <path d={arc} pathLength={100} class="gauge-track" fill="none" stroke-width={5} stroke-linecap="round" />
      <path d={arc} pathLength={100} class="gauge-fill" fill="none" stroke-width={5} stroke-linecap="round"
        stroke-dasharray={`${Math.max(2, g * 100)} 100`} />
      <text x={98} y={70} class="gauge-txt">{spec.latency}</text>
      <text x={98} y={52} class="gauge-lab">lat</text>
    </>
  );
}

function Cooler({ tier }: { tier: number }) {
  const fins = Array.from({ length: 7 }, (_, i) => 18 + i * 8);
  if (tier === 0) {
    return (
      <>
        <rect x={16} y={62} width={88} height={8} rx={2} class="ink2" />
        {fins.map((y) => <rect key={y} x={22} y={y - 4} width={76} height={3} rx={1} class="fin" />)}
      </>
    );
  }
  if (tier === 1) {
    return (
      <>
        {fins.map((y) => <rect key={y} x={14} y={y - 4} width={56} height={3} rx={1} class="fin" />)}
        <rect x={12} y={60} width={60} height={8} rx={2} class="ink2" />
        <circle cx={92} cy={42} r={20} class="fanring" />
        <circle cx={92} cy={42} r={6} class="ink" />
        <path d="M92 36a6 6 0 0 1 6 6M98 42a6 6 0 0 1-6 6M92 48a6 6 0 0 1-6-6M86 42a6 6 0 0 1 6-6" class="blade" />
      </>
    );
  }
  return (
    <>
      <rect x={10} y={34} width={30} height={30} rx={5} class="ink2" />
      <path d="M40 40 C52 40 52 26 64 26 M40 56 C52 56 52 68 64 68" class="tube" fill="none" stroke-width={3} />
      <rect x={64} y={14} width={22} height={62} rx={3} class="plate edge" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={66} y={18 + i * 7} width={18} height={2} class="fin" />)}
      <circle cx={100} cy={44} r={9} class="fanring" />
      <circle cx={100} cy={44} r={2.5} class="ink" />
    </>
  );
}

function Psu({ spec }: { spec: PsuSpec }) {
  const frac = Math.min(1, spec.watts / 250);
  const arc = 'M28 62 A32 32 0 0 1 92 62';
  return (
    <>
      <rect x={10} y={10} width={100} height={64} rx={6} class="plate edge" />
      <path d={arc} pathLength={100} class="gauge-track" fill="none" stroke-width={7} stroke-linecap="round" />
      <path d={arc} pathLength={100} class="gauge-fill" fill="none" stroke-width={7} stroke-linecap="round"
        stroke-dasharray={`${Math.max(3, frac * 100)} 100`} />
      <text x={60} y={60} class="dial-txt">{spec.watts}</text>
      <text x={60} y={70} class="dial-lab">watts</text>
    </>
  );
}

function Board({ tier }: { tier: number }) {
  const slots = BOARD_TIERS[tier]?.slots ?? {};
  const dimm = slots.dimm ?? 0;
  const pcie = slots.pcie ?? 0;
  const bigAtx = (slots['atx-plus'] ?? 0) > 0;
  return (
    <>
      <rect x={6} y={6} width={108} height={72} rx={6} class="plate edge" />
      <rect x={16} y={18} width={26} height={26} rx={2} class="ink" />
      {Array.from({ length: dimm }, (_, i) => (
        <rect key={i} x={60 + i * 10} y={18} width={5} height={36} rx={1} class="stick" />
      ))}
      {Array.from({ length: pcie }, (_, i) => (
        <rect key={i} x={16} y={52 + i * 9} width={70} height={4} rx={1} class="fin" />
      ))}
      <rect x={100} y={18} width={8} height={bigAtx ? 36 : 22} rx={1} class="pin" />
    </>
  );
}

/** HDD: a spinning platter with an actuator arm (slow and cheap). */
function Hdd() {
  return (
    <>
      <rect x={14} y={10} width={92} height={64} rx={6} class="plate edge" />
      <circle cx={52} cy={42} r={27} class="die" />
      <circle cx={52} cy={42} r={19} class="fanring" />
      <circle cx={52} cy={42} r={11} class="fanring" />
      <circle cx={52} cy={42} r={3.5} class="ink" />
      <path d="M92 20 L84 52" class="blade" />
      <rect x={80} y={50} width={10} height={6} rx={1.5} class="ink" />
      <rect x={18} y={66} width={14} height={5} rx={1} class="pin" />
    </>
  );
}

/** SATA SSD: a flat 2.5-inch board with memory chips and the SATA connector (fast, but on the old bus). */
function SsdSata() {
  return (
    <>
      <rect x={18} y={14} width={84} height={56} rx={4} class="plate edge" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={28 + i * 17} y={24} width={12} height={16} rx={1.5} class="stick" />)}
      {[0, 1, 2, 3].map((i) => <rect key={i} x={28 + i * 17} y={46} width={12} height={5} rx={1} class="chipd" />)}
      <rect x={22} y={60} width={62} height={6} rx={1} class="ink2" />
      <rect x={86} y={62} width={14} height={8} rx={1.5} class="pin" />
    </>
  );
}

/** NVMe stick: a long thin M.2 card with a notch and a row of chips (the fastest). */
function SsdNvme() {
  return (
    <>
      <rect x={10} y={34} width={100} height={18} rx={2} class="plate edge" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={22 + i * 15} y={39} width={10} height={8} rx={1} class="chipd" />)}
      <rect x={98} y={34} width={12} height={18} rx={1} class="ink2" />
      <rect x={10} y={52} width={100} height={3} rx={1} class="pin" />
    </>
  );
}

/** The OS as a disc: one ring for the resident OS, more rings and a scheduler dot for the later tiers. */
function OsDisc({ tier }: { tier: number }) {
  const rings = Math.max(1, Math.min(3, tier));
  return (
    <>
      <circle cx={60} cy={42} r={34} class="plate edge" />
      {Array.from({ length: rings }, (_, i) => (
        <circle key={i} cx={60} cy={42} r={27 - i * 8} class="fanring" />
      ))}
      <path d="M60 22 L68 42 L60 62 L52 42 Z" class="ink" />
      <circle cx={60} cy={42} r={3} class="ink-on" />
      {tier >= 3 && Array.from({ length: 4 }, (_, i) => {
        const a = (i * Math.PI) / 2;
        return <circle key={i} cx={60 + Math.cos(a) * 20} cy={42 + Math.sin(a) * 20} r={2.2} class="ink-on" />;
      })}
    </>
  );
}

function Display() {
  return (
    <>
      <rect x={20} y={12} width={80} height={52} rx={4} class="plate edge" />
      <rect x={26} y={18} width={68} height={40} rx={2} class="screen" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={32} y={24 + i * 8} width={38 - i * 6} height={3} rx={1} class="scrtxt" />)}
      <rect x={52} y={64} width={16} height={6} class="ink2" />
      <rect x={36} y={70} width={48} height={4} rx={2} class="ink2" />
    </>
  );
}

/** Illustration for a spec id or a board tier id (`board1`). Unknown ids draw nothing. */
export function PartArt({ id, size = 64, label }: { id: string; size?: number; label?: string }) {
  let body: JSX.Element | null = null;
  const bm = /^board(\d+)$/.exec(id);
  const os = getOsSpec(id);
  if (bm) body = <Board tier={Number(bm[1])} />;
  else if (os) body = <OsDisc tier={os.tier} />;
  else {
    const spec = getSpec(id);
    if (spec) {
      switch (spec.kind) {
        case 'cpu': body = <Cpu spec={spec} />; break;
        case 'ram': body = <Ram spec={spec} />; break;
        case 'cooler': body = <Cooler tier={spec.tier} />; break;
        case 'psu': body = <Psu spec={spec} />; break;
        case 'display': body = <Display />; break;
        case 'storage':
          body = spec.visual === 'hdd' ? <Hdd /> : spec.visual === 'ssd-nvme' ? <SsdNvme /> : <SsdSata />;
          break;
      }
    }
  }
  if (!body) return null;
  return (
    <svg class="art" width={size} height={Math.round((size * VB.h) / VB.w)} viewBox={`0 0 ${VB.w} ${VB.h}`}
      role="img" aria-label={label ?? id}>
      {body}
    </svg>
  );
}
