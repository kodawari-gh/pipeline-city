import type { JSX } from 'preact';
import { BOARD_TIERS, getSpec, type CpuSpec, type PsuSpec, type RamSpec } from '@/features/board/sim/specs';
import { getOsSpec } from '@/features/os/sim';
import { getIspSpec, getRouterSpec } from '@/features/network/sim/specs';
import { goodness } from './picker';
import { rem } from '@/core/ui/kit/units';
import { thumbOf, thumbsVersion } from '@/features/board/render/thumbs';

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
          {(e.kind === 'inorder' || e.kind === 'inorder2') && e.forwarding && (
            <path d="M34 28 Q60 12 86 28" class="fwd" fill="none" stroke-width={1.6} />
          )}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={28 + i * 14} y={34} width={11} height={14} rx={2} class={i === 2 ? 'ink' : 'ink2'} />
          ))}
          {e.kind !== 'ref' && e.cacheLines ? (
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
      <text x={98} y={70} class="gauge-txt" font-size={12}>{spec.latency}</text>
      <text x={98} y={52} class="gauge-lab" font-size={7}>lat</text>
    </>
  );
}

function Cooler({ tier }: { tier: number }) {
  const vanes = (cx: number, cy: number, r: number) => (
    <>
      <circle cx={cx} cy={cy} r={r} class="fanring" />
      <circle cx={cx} cy={cy} r={r * 0.3} class="ink" />
      <path d={`M${cx} ${cy - r * 0.3}a${r * 0.3} ${r * 0.3} 0 0 1 ${r * 0.3} ${r * 0.3}M${cx + r * 0.3} ${cy}a${r * 0.3} ${r * 0.3} 0 0 1-${r * 0.3} ${r * 0.3}M${cx} ${cy + r * 0.3}a${r * 0.3} ${r * 0.3} 0 0 1-${r * 0.3}-${r * 0.3}M${cx - r * 0.3} ${cy}a${r * 0.3} ${r * 0.3} 0 0 1 ${r * 0.3}-${r * 0.3}`} class="blade" />
    </>
  );
  const stack = (x: number) => (
    <>
      <rect x={x} y={14} width={14} height={56} rx={2} class="plate edge" />
      {Array.from({ length: 7 }, (_, i) => <rect key={i} x={x + 1.5} y={17 + i * 7.5} width={11} height={2} rx={1} class="fin" />)}
    </>
  );
  if (tier === 0) { // a plate with a radial-vaned fan
    return (
      <>
        <rect x={20} y={10} width={80} height={64} rx={5} class="plate edge" />
        {Array.from({ length: 12 }, (_, i) => {
          const th = (i / 12) * Math.PI * 2;
          return <path key={i} d={`M${60 + Math.cos(th) * 18} ${42 + Math.sin(th) * 18}L${60 + Math.cos(th) * 28} ${42 + Math.sin(th) * 28}`} class="fin" stroke-width={2} fill="none" />;
        })}
        {vanes(60, 42, 17)}
      </>
    );
  }
  if (tier === 1) { // two fin stacks, copper pipes between them, a frame fan
    return (
      <>
        {stack(14)}
        {stack(92)}
        <path d="M21 26H99M21 42H99M21 58H99" class="tube" fill="none" stroke-width={3} />
        <rect x={34} y={14} width={52} height={56} rx={4} class="plate edge" />
        {vanes(60, 42, 20)}
      </>
    );
  }
  return ( // an all-in-one: the pump on the CPU, two tubes up to a radiator with a fan
    <>
      <rect x={14} y={58} width={34} height={20} rx={5} class="ink2" />
      <circle cx={31} cy={68} r={7} class="fanring" />
      <path d="M22 58V36C22 22 34 22 34 14M40 58V44C40 26 52 26 52 14" class="tube" fill="none" stroke-width={3} />
      <rect x={28} y={6} width={84} height={12} rx={3} class="plate edge" />
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x={46 + i * 6} y={8} width={2} height={8} class="fin" />)}
      {vanes(96, 12, 5)}
    </>
  );
}

function Psu({ spec }: { spec: PsuSpec }) {
  const frac = Math.min(1, Math.sqrt(spec.watts / 1000)); // 40 W to 1 kW on one dial
  const arc = 'M28 62 A32 32 0 0 1 92 62';
  return (
    <>
      <rect x={10} y={10} width={100} height={64} rx={6} class="plate edge" />
      <path d={arc} pathLength={100} class="gauge-track" fill="none" stroke-width={7} stroke-linecap="round" />
      <path d={arc} pathLength={100} class="gauge-fill" fill="none" stroke-width={7} stroke-linecap="round"
        stroke-dasharray={`${Math.max(3, frac * 100)} 100`} />
      <text x={60} y={60} class="dial-txt" font-size={15}>{spec.watts}</text>
      <text x={60} y={70} class="dial-lab" font-size={8}>watts</text>
    </>
  );
}

/** A graphics card: PCB, a shroud with one to three fans by tier, the bracket with its ports and the power plug. */
function GpuCard({ tier }: { tier: number }) {
  const n = Math.max(1, Math.min(3, tier));
  const w = 76 / n;
  return (
    <>
      <rect x={10} y={22} width={100} height={40} rx={4} class="plate edge" />
      <rect x={4} y={18} width={6} height={48} rx={1} class="ink2" />
      {[0, 1, 2].map((i) => <rect key={i} x={0} y={26 + i * 12} width={5} height={7} rx={1} class="jack" />)}
      <rect x={18} y={27} width={84} height={30} rx={3} class="ink" />
      {Array.from({ length: n }, (_, i) => {
        const cx = 22 + w * (i + 0.5);
        return (
          <g key={i}>
            <circle cx={cx} cy={42} r={Math.min(11, w / 2 - 2)} class="fanring" />
            <circle cx={cx} cy={42} r={2.4} class="ink-on" />
          </g>
        );
      })}
      <rect x={88} y={16} width={14} height={7} rx={1.5} class="jack" />
      {tier >= 3 && <rect x={70} y={16} width={14} height={7} rx={1.5} class="jack" />}
      {Array.from({ length: 8 }, (_, i) => <rect key={i} x={30 + i * 3.5} y={62} width={2} height={6} class="pin" />)}
    </>
  );
}

/** An AI card: a die made of a grid of multiply-accumulate cells (4 x 4 or 8 x 8), a heatsink on the big one. */
function NpuCard({ tier }: { tier: number }) {
  const k = tier >= 2 ? 8 : 4, size = tier >= 2 ? 34 : 28, c = size / k;
  return (
    <>
      <rect x={10} y={22} width={100} height={40} rx={4} class="plate edge" />
      <rect x={4} y={18} width={6} height={48} rx={1} class="ink2" />
      <circle cx={2.5} cy={42} r={1.8} class="led-on" />
      <rect x={20} y={42 - size / 2 - 3} width={size + 6} height={size + 6} rx={3} class="ink" />
      {Array.from({ length: k * k }, (_, i) => (
        <rect key={i} x={23 + (i % k) * c + 0.5} y={42 - size / 2 + Math.floor(i / k) * c + 0.5} width={c - 1} height={c - 1} class="ink-on" />
      ))}
      {tier >= 2 && Array.from({ length: 7 }, (_, i) => <rect key={i} x={62 + i * 5} y={30} width={2.6} height={24} rx={0.8} class="fin" />)}
      {tier >= 2 && <rect x={90} y={16} width={14} height={7} rx={1.5} class="jack" />}
      {Array.from({ length: 8 }, (_, i) => <rect key={i} x={30 + i * 3.5} y={62} width={2} height={6} class="pin" />)}
    </>
  );
}

/** The secure module: a small board on a pin row, with the secure chip (and a shield on the second). */
function TpmModule({ tier }: { tier: number }) {
  return (
    <>
      <rect x={28} y={14} width={64} height={46} rx={4} class="plate edge" />
      <rect x={38} y={22} width={30} height={26} rx={2} class="ink" />
      <circle cx={43} cy={27} r={1.6} class="ink-on" />
      {tier >= 2 && <rect x={72} y={22} width={14} height={16} rx={2} class="ink2" />}
      {Array.from({ length: 6 }, (_, i) => <rect key={i} x={35 + i * 9} y={60} width={4} height={8} class="pin" />)}
      <text x={60} y={56} class="gauge-lab" font-size={7}>TPM</text>
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

/**
 * A VRM heatsink, bolted over the board's regulator: fins (tier 0), big fins (tier 1), fins and a small fan (tier 2).
 * The base sits on a row of MOSFET blocks so it reads as "on the board's voltage regulators".
 */
function VrmSink({ tier }: { tier: number }) {
  const mosfets = [0, 1, 2, 3, 4].map((i) => <rect key={i} x={26 + i * 15} y={66} width={10} height={8} rx={1.5} class="chipd" />);
  if (tier === 0) {
    return (
      <>
        {mosfets}
        <rect x={22} y={56} width={76} height={8} rx={2} class="ink2" />
        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={26 + i * 12} y={28} width={4} height={28} rx={1} class="fin" />)}
      </>
    );
  }
  if (tier === 1) {
    return (
      <>
        {mosfets}
        <rect x={18} y={52} width={84} height={12} rx={2} class="ink2" />
        {Array.from({ length: 7 }, (_, i) => <rect key={i} x={22 + i * 11} y={14} width={6} height={38} rx={1.5} class="fin" />)}
      </>
    );
  }
  return (
    <>
      {mosfets}
      <rect x={14} y={54} width={62} height={10} rx={2} class="ink2" />
      {Array.from({ length: 4 }, (_, i) => <rect key={i} x={18 + i * 13} y={26} width={5} height={28} rx={1} class="fin" />)}
      <circle cx={92} cy={38} r={20} class="fanring" />
      <circle cx={92} cy={38} r={5} class="ink" />
      <path d="M92 33a5 5 0 0 1 5 5M97 38a5 5 0 0 1-5 5M92 43a5 5 0 0 1-5-5M87 38a5 5 0 0 1 5-5" class="blade" />
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

/**
 * A network card: PCB with its controller chip, gold fingers along the slot edge, a bracket with the ethernet jack and its two
 * LED wells. Tier 1 is bare, tier 2 has a finned heatsink, tier 3 a big heatsink with a heat pipe and a small fan.
 */
function NicCard({ tier }: { tier: number }) {
  return (
    <>
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={14 + i * 6.4} y={64} width={3.6} height={7} rx={0.6} class="pin" />)}
      <rect x={8} y={18} width={92} height={46} rx={3} class="plate edge" />
      <rect x={100} y={12} width={6} height={58} rx={1} class="ink2" />
      <rect x={90} y={26} width={10} height={14} rx={1.2} class="jack" />
      <rect x={92} y={29} width={6} height={8} rx={0.8} class="screen" />
      <circle cx={92.6} cy={45} r={1.3} class="led-on" />
      <circle cx={97} cy={45} r={1.3} class="led-on dim" />
      {tier === 1 && (
        <>
          <rect x={28} y={30} width={22} height={20} rx={2} class="ink" />
          <rect x={56} y={34} width={9} height={9} rx={1} class="chipd" />
          <rect x={56} y={46} width={9} height={5} rx={1} class="chipd" />
        </>
      )}
      {tier === 2 && (
        <>
          <rect x={22} y={26} width={36} height={28} rx={2} class="ink2" />
          {Array.from({ length: 7 }, (_, i) => <rect key={i} x={25 + i * 4.8} y={22} width={2.6} height={32} rx={0.8} class="fin" />)}
          <rect x={64} y={32} width={9} height={9} rx={1} class="chipd" />
          <rect x={64} y={44} width={9} height={5} rx={1} class="chipd" />
        </>
      )}
      {tier >= 3 && (
        <>
          <rect x={14} y={24} width={44} height={32} rx={2} class="ink2" />
          {Array.from({ length: 9 }, (_, i) => <rect key={i} x={17 + i * 4.7} y={18} width={2.6} height={38} rx={0.8} class="fin" />)}
          <path d="M58 34 C68 34 68 44 78 44" class="tube" fill="none" stroke-width={2.6} />
          <rect x={66} y={34} width={18} height={20} rx={2} class="ink2" />
          {Array.from({ length: 4 }, (_, i) => <rect key={i} x={68 + i * 4} y={30} width={2} height={24} rx={0.7} class="fin" />)}
          <circle cx={40} cy={40} r={9} class="fanring" />
          <circle cx={40} cy={40} r={2.4} class="ink" />
        </>
      )}
    </>
  );
}

const led = (x: number, y: number, on = true) => <circle key={`l${x}`} cx={x} cy={y} r={1.5} class={on ? 'led-on' : 'led-on dim'} />;

/** The four routers: a small home box with antennas, a dark gigabit box, a brushed 10G box with an SFP cage, a 1U rack unit. */
function RouterArt({ tier }: { tier: number }) {
  if (tier <= 1) {
    return (
      <>
        <path d="M34 42 28 14M86 42 92 14" class="antenna" />
        <rect x={20} y={40} width={80} height={26} rx={6} class="plate edge" />
        {[0, 1, 2].map((i) => led(32 + i * 8, 49, i < 2))}
        <rect x={34} y={58} width={8} height={5} rx={1} class="jack" />
        {[0, 1].map((i) => <rect key={i} x={70 + i * 12} y={58} width={8} height={5} rx={1} class="jack" />)}
        <rect x={52} y={46} width={30} height={4} rx={2} class="vent" />
      </>
    );
  }
  if (tier === 2) {
    return (
      <>
        <path d="M32 40 26 22M88 40 94 22" class="antenna" />
        <rect x={12} y={38} width={96} height={30} rx={5} class="plate accent-edge" />
        <rect x={12} y={38} width={96} height={4} rx={2} class="accent-bar" />
        {[0, 1, 2, 3].map((i) => led(24 + i * 8, 50, i !== 3))}
        <rect x={22} y={58} width={9} height={6} rx={1} class="jack" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={50 + i * 12} y={58} width={9} height={6} rx={1} class="jack" />)}
        <rect x={72} y={46} width={28} height={4} rx={2} class="vent" />
      </>
    );
  }
  if (tier === 3) {
    return (
      <>
        <rect x={8} y={32} width={104} height={38} rx={4} class="plate edge" />
        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={14 + i * 9} y={37} width={6} height={2} rx={1} class="vent" />)}
        <rect x={72} y={36} width={32} height={12} rx={1.5} class="ink2" />
        <rect x={76} y={40} width={24} height={4} class="screen" />
        {[0, 1, 2, 3].map((i) => led(16 + i * 7, 48, i < 3))}
        {Array.from({ length: 8 }, (_, i) => <rect key={i} x={14 + i * 11} y={56} width={8} height={7} rx={1} class="jack" />)}
      </>
    );
  }
  return (
    <>
      <rect x={4} y={34} width={112} height={34} rx={2} class="plate edge" />
      <rect x={4} y={34} width={9} height={34} class="ink2" />
      <rect x={107} y={34} width={9} height={34} class="ink2" />
      {[40, 60].map((y) => <circle key={`a${y}`} cx={8.5} cy={y} r={1.6} class="screw" />)}
      {[40, 60].map((y) => <circle key={`b${y}`} cx={111.5} cy={y} r={1.6} class="screw" />)}
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x={18 + i * 5} y={38} width={2.4} height={10} rx={1} class="vent" />)}
      {[0, 1, 2, 3, 4].map((i) => led(76 + i * 6, 42, i !== 4))}
      <rect x={18} y={54} width={80} height={9} rx={1} class="ink2" />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={20 + i * 6.5} y={56} width={4.6} height={5} rx={0.8} class="jack" />)}
    </>
  );
}

/** Short speed for a plate: 50 Mb, 1 Gb, 20 Gb. */
const plateSpeed = (mbps: number) => (mbps >= 1000 ? `${mbps / 1000} Gb` : `${mbps} Mb`);

/** An internet plan as a wall plate: a speed dial (log scale), the speed, five tier pips and the jack. */
function PlanPlate({ tier, down }: { tier: number; down: number }) {
  const arc = 'M34 60 A26 26 0 0 1 86 60';
  const frac = Math.min(1, Math.max(0.06, Math.log10(down / 25) / Math.log10(20000 / 25)));
  return (
    <>
      <rect x={14} y={6} width={92} height={72} rx={9} class="plate edge" />
      {Array.from({ length: 5 }, (_, i) => <circle key={i} cx={36 + i * 12} cy={16} r={2.4} class={i < tier ? 'pip-on' : 'pip'} />)}
      <path d={arc} pathLength={100} class="gauge-track" fill="none" stroke-width={6} stroke-linecap="round" />
      <path d={arc} pathLength={100} class="gauge-fill" fill="none" stroke-width={6} stroke-linecap="round" stroke-dasharray={`${frac * 100} 100`} />
      <text x={60} y={55} class="dial-txt" font-size={13}>{plateSpeed(down)}</text>
      <rect x={50} y={64} width={20} height={9} rx={2} class="jack" />
      <rect x={54} y={66} width={12} height={5} rx={1} class="screen" />
    </>
  );
}

/** Illustration for a spec id or a board tier id (`board1`). Unknown ids draw nothing. */
export function PartArt({ id, size = 64, label }: { id: string; size?: number; label?: string }) {
  // the real thing first: the picture the board's own art renders (reading the version re-renders this when it arrives)
  void thumbsVersion.value;
  const url = thumbOf(id);
  if (url) {
    return <img class="art art-img" src={url} alt={label ?? id} draggable={false} style={{ width: rem(size), aspectRatio: `${VB.w} / ${VB.h}` }} />;
  }
  let body: JSX.Element | null = null;
  const bm = /^board(\d+)$/.exec(id);
  const os = getOsSpec(id);
  const router = getRouterSpec(id);
  const isp = getIspSpec(id);
  if (bm) body = <Board tier={Number(bm[1])} />;
  else if (os) body = <OsDisc tier={os.tier} />;
  else if (router) body = <RouterArt tier={router.tier} />;
  else if (isp) body = <PlanPlate tier={isp.tier} down={isp.downMbps} />;
  else {
    const spec = getSpec(id);
    if (spec) {
      switch (spec.kind) {
        case 'cpu': body = <Cpu spec={spec} />; break;
        case 'ram': body = <Ram spec={spec} />; break;
        case 'cooler': body = <Cooler tier={spec.tier} />; break;
        case 'psu': body = <Psu spec={spec} />; break;
        case 'display': body = <Display />; break;
        case 'vrm-sink': case 'ram-sink': body = <VrmSink tier={spec.tier} />; break;
        case 'nic': body = <NicCard tier={spec.tier} />; break;
        case 'gpu': body = <GpuCard tier={spec.tier} />; break;
        case 'npu': body = <NpuCard tier={spec.tier} />; break;
        case 'tpm': body = <TpmModule tier={spec.tier} />; break;
        case 'storage':
          body = spec.visual === 'hdd' ? <Hdd /> : spec.visual === 'ssd-nvme' ? <SsdNvme /> : <SsdSata />;
          break;
      }
    }
  }
  if (!body) return null;
  return (
    <svg class="art" style={{ width: rem(size), aspectRatio: `${VB.w} / ${VB.h}` }} viewBox={`0 0 ${VB.w} ${VB.h}`}
      role="img" aria-label={label ?? id}>
      {body}
    </svg>
  );
}
