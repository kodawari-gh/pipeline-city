import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { selected, viewInset } from '../../game/hover';
import { cameraRev, highlight } from '../../game/interaction';
import { ejectKey, plugKey, powerButton, powerCycle, purchase, setCpuClock, setRamClock, snapshot, uninstall, uninstallOs } from '../../game/store';
import { getSpec, type CpuSpec, type RamSpec } from '../../sim/board/specs';
import type { Snapshot } from '../../sim/game/game';
import { getOsSpec } from '../../sim/os';
import { describeId, fmtClock, fmtMoney } from '../logic';
import {
  boardId, caseId, clockZones, compareRows, estTempC, installedCooler, nextUpgrade, osSection, pickerFor, zoneOf,
  type CompareRow, type OsSection, type LadderStep, type PickerAction, type PickerLine, type PickerModel, type ZoneName,
} from './picker';
import {
  ramZones, VRM_BUSY_RATIO, VRM_ZONE_HELP, VRM_ZONE_WORD, vrmZone, type BoardCard, type VrmReadout, type VrmZone,
} from './vrm';
import { Icon } from '../kit/Icons';
import { DeclineButton, Deadline, NeedChips } from '../panels/Jobs';
import { lockBadge, type LevelLock, type MoreOffer } from '../panels/levelui';
import { openMilestones } from '../state';
import { PartArt } from './PartArt';
import { anchorOf } from '../tutorial/anchor';
import { dockPlacement, placePopup, type Rect, type Side } from './place';
import { STAT_HELP } from './stathelp';

const shortName = (name: string) => name.split(' (')[0]!;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The lock and "Level N" of an item the player level still gates. Pressing it opens the milestone screen at that level. */
function LockBadge({ lock, reason }: { lock: LevelLock; reason?: string }) {
  return (
    <button class="lockbadge" title={reason} aria-label={`Locked: unlocks at Level ${lock.level}, ${lock.name}. Show the levels`}
      onClick={(e) => { e.stopPropagation(); openMilestones(lock.level); }}>
      <Icon name="lock" size={11} /> {lockBadge(lock)}
    </button>
  );
}

/** The small "+ price" on a fitted or spare tile (or board card): buy another copy, which goes into the inventory. */
export function MoreButton({ specId, more }: { specId: string; more: MoreOffer | undefined }) {
  if (!more || (more.state !== 'ready' && more.state !== 'poor')) return null;
  const cost = more.free ? 'free' : fmtMoney(more.price);
  if (more.state === 'poor') return <span class="need warn more" title={`Buy another: ${more.reason}`}>+ {cost}</span>;
  return (
    <button class="primary buy more" aria-label={`Buy another for ${cost}`} title={`Buy another for ${cost}. It goes into your inventory.`}
      onClick={(e) => { e.stopPropagation(); purchase(specId); }}>
      + {cost}
    </button>
  );
}

/** One upgrade rung: owned, next (buy), blocked or later. Pressing the card compares it with the current part. */
export function Rung({ step, picked, onPick }: { step: LadderStep; picked: boolean; onPick: (id: string) => void }) {
  const cost = step.free ? 'free' : fmtMoney(step.price ?? 0);
  const foot = (() => {
    switch (step.state) {
      case 'installed': return <><span class="need ok" title={step.spares ? `${step.spares} more in your inventory` : undefined}><Icon name="check" size={11} /> Fitted{step.spares ? ` +${step.spares}` : ''}</span><MoreButton specId={step.specId} more={step.more} /></>;
      case 'crate': return <><span class="need ok"><Icon name="box" size={11} /> Spare{(step.spares ?? 1) > 1 ? ` x${step.spares}` : ''}</span><MoreButton specId={step.specId} more={step.more} /></>;
      case 'ready': return (
        <button class="primary buy" onClick={(e) => { e.stopPropagation(); purchase(step.specId); }}
          title={`Buy for ${cost}. It goes into your inventory.`}>
          Buy {cost}
        </button>
      );
      case 'poor': return <span class="need warn" title={step.reason}><Icon name="dollar" size={11} /> {cost}</span>;
      case 'blocked': return <span class="need bad" title={step.reason}><Icon name="lock" size={11} /> Blocked</span>;
      case 'locked': return <span class="need mute" title={step.reason}><Icon name="lock" size={11} /> Later</span>;
      case 'level': return <LockBadge lock={step.lock!} reason={step.reason} />;
    }
  })();
  // A spare the sim will not fit right now (e.g. the OS needs more memory fitted first): the reason is in the rung.
  const spareBlocked = step.state === 'crate' && !step.reason?.startsWith('In your inventory');
  const footText = spareBlocked
    ? <span class="need warn" title={step.reason}><Icon name="lock" size={11} /> Not yet</span>
    : foot;
  const title = step.reason ?? (step.state === 'installed' ? 'Fitted in the machine' : step.state === 'crate' ? step.reason : step.name);
  return (
    <div
      role="button" tabIndex={0} data-buy={step.specId}
      class={`rung ${step.state} ${step.soon ? 'soon' : ''} ${picked ? 'picked' : ''} ${highlight.value.includes(`buy:${step.specId}`) ? 'pulse' : ''}`}
      title={step.warn ? `${title}. Warning: ${step.warn}` : title} aria-pressed={picked}
      onClick={() => onPick(step.specId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(step.specId); } }}
    >
      {step.warn && <span class="rwarn" aria-label={`Warning: ${step.warn}`}><Icon name="warn" size={11} /></span>}
      <span class="rtier">Tier {step.tier}</span>
      <PartArt id={step.specId} size={76} />
      <span class="rname">{shortName(step.name)}</span>
      <span class="rfoot">{footText}</span>
    </div>
  );
}

/** Before/after bars: grey is the current part, coloured is the option; the delta is coloured by whether it is better. */
export function Compare({ rows, option }: { rows: CompareRow[]; option: string }) {
  if (!rows.length) return null;
  return (
    <div class="compare" aria-label={`Compared with ${shortName(getSpec(option)?.name ?? option)}`}>
      {rows.map((r) => (
        <div class="crow" key={r.key} title={`${r.curText ? `${r.label}: ${r.curText} now, ${r.optText} with this` : `${r.label}: ${r.optText}`}. ${STAT_HELP[r.key] ?? ''}`}>
          <div class="ctop">
            <Icon name={r.icon} size={12} />
            <span class="clabel">{r.label}</span>
            {r.deltaText && <b class={`delta ${r.trend ?? ''}`}>{r.deltaText}</b>}
          </div>
          {r.cur !== null && <div class="bar cur"><i style={{ width: `${r.cur * 100}%` }} /></div>}
          <div class={`bar opt ${r.trend ?? ''}`}><i style={{ width: `${r.opt * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

const ZONE_WORD: Record<ZoneName, string> = { safe: 'Safe', throttle: 'Throttle', unstable: 'Unstable' };
const ZONE_HELP: Record<ZoneName, string> = {
  safe: 'Runs at full speed with this cooler.',
  throttle: 'Too hot: the chip slows itself down, so it runs slower than you asked.',
  unstable: 'Too hot: errors restart the job. Cool it down or slow the clock.',
};

/** Overclock dial: the track is coloured by zone (safe, throttle, unstable) from the sim's heat model. */
function ClockDial({ s, cpu }: { s: Snapshot; cpu: NonNullable<PickerModel['device']> }) {
  const c = s.cpuClock!;
  const spec = getSpec(cpu.spec) as CpuSpec | undefined;
  if (!spec || spec.kind !== 'cpu') return null;
  const cooler = installedCooler(s);
  const z = clockZones(spec, cooler);
  const span = c.max - c.min || 1;
  const pos = (x: number) => clamp01((x - c.min) / span) * 100;
  const thrPct = pos(z.throttleAt);
  const badPct = pos(z.unstableAt);
  const zone = zoneOf(z, c.value);
  const est = estTempC(spec, cooler, c.value);
  return (
    <div class="dial" title={`${ZONE_HELP[zone]} Estimated steady temperature with ${cooler ? shortName(cooler.name) : 'no cooler'}.`}>
      <div class="dtrack" aria-hidden="true">
        <i class="z safe" style={{ left: '0%', width: `${thrPct}%` }} />
        <i class="z throttle" style={{ left: `${thrPct}%`, width: `${Math.max(0, badPct - thrPct)}%` }} />
        <i class="z unstable" style={{ left: `${badPct}%`, width: `${Math.max(0, 100 - badPct)}%` }} />
        <i class="dbase" style={{ left: `${pos(spec.clock.base)}%` }} title="Stock clock" />
        <i class={`knob ${zone}`} style={{ left: `${pos(c.value)}%` }} />
      </div>
      <input
        type="range" class="dinput" min={c.min} max={c.max} step={0.05} value={c.value} aria-label="CPU clock"
        onInput={(e) => setCpuClock(Number(e.currentTarget.value))}
      />
      <div class="drow">
        <span class={`zchip ${zone}`}>{ZONE_WORD[zone]}</span>
        <span class="readout" title="Estimated steady temperature"><Icon name="flame" size={12} /> ~{est.toFixed(0)} C</span>
        <span class="value">{fmtClock(c.value)}</span>
      </div>
    </div>
  );
}

/** Memory overclock dial: like the processor's, with a second marker where the memory regulator runs out of rating. */
function RamClockDial({ s, dev }: { s: Snapshot; dev: NonNullable<PickerModel['device']> }) {
  const spec = getSpec(dev.spec) as RamSpec | undefined;
  const z = ramZones(s, dev.id);
  if (!spec || spec.kind !== 'ram' || !z) return null;
  const value = dev.requestedClock ?? spec.clock.base;
  const span = z.max - z.min || 1;
  const pos = (x: number) => clamp01((x - z.min) / span) * 100;
  const thrPct = pos(Math.min(z.throttleAt, z.overloadAt)), badPct = pos(Math.min(z.unstableAt, z.overloadAt));
  const zone: ZoneName = value >= Math.min(z.unstableAt, z.overloadAt) ? 'unstable' : value >= z.throttleAt ? 'throttle' : 'safe';
  const est = 25 + (spec.loadW * spec.heatFactor * (value / spec.clock.base) ** 3) / spec.thermal.passive;
  return (
    <div class="dial" title={`Memory clock. ${ZONE_HELP[zone]} The memory regulator ${Number.isFinite(z.overloadAt) ? `runs out of rating near ${z.overloadAt.toFixed(2)}x` : 'can feed any clock here'} with the other sticks as they are now.`}>
      <div class="dtrack" aria-hidden="true">
        <i class="z safe" style={{ left: '0%', width: `${thrPct}%` }} />
        <i class="z throttle" style={{ left: `${thrPct}%`, width: `${Math.max(0, badPct - thrPct)}%` }} />
        <i class="z unstable" style={{ left: `${badPct}%`, width: `${Math.max(0, 100 - badPct)}%` }} />
        <i class="dbase" style={{ left: `${pos(z.base)}%` }} title="Stock clock" />
        <i class={`knob ${zone}`} style={{ left: `${pos(value)}%` }} />
      </div>
      <input
        type="range" class="dinput" min={z.min} max={z.max} step={0.05} value={value} aria-label="Memory clock"
        onInput={(e) => setRamClock(dev.id, Number(e.currentTarget.value))}
      />
      <div class="drow">
        <span class={`zchip ${zone}`}>{ZONE_WORD[zone]}</span>
        <span class="readout" title="Estimated steady temperature of the stick"><Icon name="flame" size={12} /> ~{est.toFixed(0)} C</span>
        <span class="value">{fmtClock(value)}</span>
      </div>
    </div>
  );
}

const VRM_CLASS: Record<VrmZone, string> = { safe: 'safe', busy: 'throttle', overload: 'unstable' };

/**
 * The VRM readout: a load bar with the safe, busy and overload zones (demand over the phases' rating), then the live
 * numbers as icon chips. Each chip explains itself on hover (describeId's plain line for its id).
 */
function VrmBlock({ v, s }: { v: VrmReadout; s: Snapshot }) {
  const zone = v.burnt ? 'overload' : vrmZone(v.loadRatio);
  const busyPct = (VRM_BUSY_RATIO / v.barMax) * 100;
  const overPct = (1 / v.barMax) * 100;
  const fillPct = clamp01(v.loadRatio / v.barMax) * 100;
  const tip = (id: string) => describeId(id, s)?.plain ?? '';
  return (
    <section class="pblock vrm-sec" aria-label="VRM">
      <h3><Icon name="bolt" size={11} /> {v.rail === 'ram' ? 'Memory VRM' : 'VRM'} <span class={`zchip ${VRM_CLASS[zone]}`}>{v.burnt ? 'Burnt' : VRM_ZONE_WORD[zone]}</span></h3>
      <div class="vtrack" title={`${v.rail === 'ram' ? 'The memory regulator. ' : ''}${VRM_ZONE_HELP[zone]} Demand ${v.demandA.toFixed(1)} A of ${v.capacityA} A.`}>
        <i class="vz safe" style={{ left: '0%', width: `${busyPct}%` }} />
        <i class="vz busy" style={{ left: `${busyPct}%`, width: `${Math.max(0, overPct - busyPct)}%` }} />
        <i class="vz overload" style={{ left: `${overPct}%`, width: `${Math.max(0, 100 - overPct)}%` }} />
        <i class="vfill" style={{ width: `${fillPct}%` }} />
      </div>
      <div class="vrow mute">
        <span title={tip('vrm.load')}><Icon name="gauge" size={11} /> {v.demandA.toFixed(1)} of {v.capacityA} A</span>
        <span title={tip('vrm.phases')}><Icon name="slot" size={11} /> {v.phases} x {v.ampsPerPhase} A</span>
      </div>
      <div class="chips">
        <span class={`chip ${v.tempLevel}`} title={`Temperature. Throttles at ${v.throttleC} C, unstable at ${v.unstableC} C, burns at ${v.damageC} C.`}>
          <Icon name="flame" size={12} /> {v.tempC.toFixed(0)} C
        </span>
        <span class="chip" title={tip('vrm.efficiency')}><Icon name="eff" size={12} /> {Math.round(v.efficiency * 100)}%</span>
        <span class={`chip ${v.throttle < 1 ? 'warn' : ''}`} title={`Throttle: the regulator's heat holds the ${v.rail === 'ram' ? 'memory' : 'processor'} back by this much (100% is none).`}>
          <Icon name="clock" size={12} /> {Math.round(v.throttle * 100)}%
        </span>
        <span class={`chip ${v.errProb > 0.02 ? 'bad' : ''}`} title="Chance per busy tick that voltage droop crashes the machine. Zero while the regulator is safe.">
          <Icon name="warn" size={12} /> {(v.errProb * 100).toFixed(1)}%
        </span>
        <span class="chip" title={tip('vrm.heat')}><Icon name="bolt" size={12} /> {v.lossW.toFixed(1)} W</span>
        <span class="chip" title={tip('vrm.ripple')}><Icon name="wave" size={12} /> {v.ripple.toFixed(2)}</span>
        <span class="chip" title={v.sink ? `${v.sink.name}: cools the regulator. Coolers with a fan blow over it too; liquid ones do not.` : `No ${v.rail === 'ram' ? 'RAM ' : ''}VRM heatsink: drag one onto the board's ${v.rail === 'ram' ? 'memory ' : ''}heatsink slot.`}>
          <Icon name="fan" size={12} /> {v.sink ? v.sink.name : 'no heatsink'}
        </span>
      </div>
    </section>
  );
}

/** One motherboard tier: slot counts and features as small icons, VRM strength against the strongest tier, and the state. */
function BoardCardView({ c }: { c: BoardCard }) {
  const cost = c.free ? 'free' : fmtMoney(c.price);
  const net = c.ethernetMbps ? (c.ethernetMbps >= 1000 ? '1 Gbit' : `${c.ethernetMbps} Mbit`) : 'none';
  const foot = (() => {
    switch (c.state) {
      case 'installed': return <><span class="need ok"><Icon name="check" size={11} /> Fitted{c.spares ? ` +${c.spares}` : ''}</span><MoreButton specId={c.id} more={c.more} /></>;
      case 'dead': return (
        <button class="primary buy" disabled={!c.canBuy}
          title={c.canBuy ? `Replace the dead board with a ${c.name} for ${cost}. Power off first; your parts move over.` : c.reason}
          onClick={(e) => { e.stopPropagation(); purchase(c.id); }}>
          Replace {cost}
        </button>
      );
      case 'crate': return <><span class="need ok" title={c.reason}><Icon name="box" size={11} /> Spare{(c.spares ?? 1) > 1 ? ` x${c.spares}` : ''}</span><MoreButton specId={c.id} more={c.more} /></>;
      case 'ready': return (
        <button class="primary buy" onClick={(e) => { e.stopPropagation(); purchase(c.id); }} title={`Buy for ${cost}. It goes into your inventory.`}>
          Buy {cost}
        </button>
      );
      case 'poor': return <span class="need warn" title={c.reason}><Icon name="dollar" size={11} /> {cost}</span>;
      case 'blocked': return <span class="need bad" title={c.reason}><Icon name="lock" size={11} /> Blocked</span>;
      case 'locked': return <span class="need mute" title={c.reason}><Icon name="lock" size={11} /> Later</span>;
      case 'level': return <LockBadge lock={c.lock!} reason={c.reason} />;
    }
  })();
  return (
    <div class={`bcard ${c.state} ${c.soon ? 'soon' : ''}`} role="group" aria-label={c.name} title={c.reason ?? c.name}>
      <div class="bhead"><span class="rtier">Tier {c.tier}</span><span class="rname">{c.name}</span></div>
      <div class="bart"><PartArt id={c.id} size={54} /></div>
      <div class="bslots">
        {c.slots.map((sl) => (
          <span class="bi" key={sl.key} title={`${sl.count} ${sl.label}`}><Icon name={sl.icon} size={11} /> {sl.count}</span>
        ))}
      </div>
      <div class="bslots">
        <span class="bi" title={c.ethernetMbps ? `Onboard ethernet, ${net}. Nothing uses it yet.` : 'No onboard ethernet on this board.'}><Icon name="net" size={11} /> {net}</span>
        <span class="bi" title={`${c.usbPorts} USB port${c.usbPorts === 1 ? '' : 's'}`}><Icon name="usb" size={11} /> {c.usbPorts}</span>
        <span class="bi" title={`${c.displayPorts} monitor port${c.displayPorts === 1 ? '' : 's'}`}><Icon name="screen" size={11} /> {c.displayPorts}</span>
      </div>
      <div class="vbars" title={`VRM strength: ${c.phases} phases x ${c.ampsPerPhase} A = ${c.totalA} A. Grey is your board now, coloured is this tier.`}>
        <div class="bar cur"><i style={{ width: `${c.curBar * 100}%` }} /></div>
        <div class={`bar opt ${c.trend}`}><i style={{ width: `${c.optBar * 100}%` }} /></div>
        <div class="ctext mute">
          <span><Icon name="bolt" size={10} /> {c.totalA} A</span>
          <b class={`delta ${c.trend}`}>{c.deltaText}</b>
        </div>
      </div>
      <div class="bslots" title={`Memory VRM: ${c.ramPhases} phases x ${c.ramAmpsPerPhase} A = ${c.ramTotalA} A. It feeds every RAM stick; memory overclocking loads it.`}>
        <span class="bi"><Icon name="memory" size={11} /> {c.ramTotalA} A</span>
      </div>
      <div class="bfoot">{foot}</div>
    </div>
  );
}

/** Live readings of an installed part as small icon chips. */
function Readings({ dev }: { dev: NonNullable<PickerModel['device']> }) {
  if (dev.burnt) return <div class="chips"><span class="chip bad"><Icon name="warn" size={12} /> burnt out</span></div>;
  return (
    <div class="chips">
      <span class="chip" title="Temperature right now, in degrees Celsius. Too hot and the part slows down (throttles), then becomes unstable."><Icon name="flame" size={12} /> {dev.tempC.toFixed(0)} C</span>
      <span class="chip" title="Power it is drawing right now, in watts. All parts together must stay under the power supply's capacity."><Icon name="bolt" size={12} /> {dev.powerW.toFixed(1)} W</span>
      <span class="chip" title="Speed it is really running at compared with its stock clock (1.00x). Above 1 is overclocked, below 1 is throttled by heat."><Icon name="clock" size={12} /> {dev.effectiveClock.toFixed(2)}x</span>
      {dev.throttle < 1 && <span class="chip warn" title="Throttled: too hot, running slower than asked"><Icon name="warn" size={12} /> slow</span>}
      {dev.unstable && <span class="chip bad" title="Unstable: errors restart the job"><Icon name="warn" size={12} /> unstable</span>}
    </div>
  );
}

function Action({ a }: { a: PickerAction }) {
  // Uninstalling wipes the drive: it takes two presses (the first asks, the second does it).
  const [armed, setArmed] = useState(false);
  const run = () => {
    switch (a.id) {
      case 'power': powerButton(); break;
      case 'powerCycle': powerCycle(); break;
      case 'plug': if (a.keyId !== undefined) plugKey(a.keyId); break;
      case 'eject': ejectKey(); break;
      case 'uninstall': if (a.deviceId) uninstall(a.deviceId); break;
      case 'uninstallOs':
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        uninstallOs();
        break;
    }
  };
  const label = a.id === 'uninstallOs' && armed ? 'Really uninstall? The drive is wiped' : a.label;
  return (
    <button
      class={a.primary || (a.id === 'uninstallOs' && armed) ? 'primary' : ''}
      disabled={!!a.why}
      title={a.why ?? (a.id === 'uninstallOs' ? 'Takes the OS off its drive and back into your inventory. The drive is wiped.' : a.id === 'uninstall' ? 'Takes it out of the machine and into your inventory (a processor takes its cooler along).' : undefined)}
      onClick={run}
    >
      {label}
    </button>
  );
}

/** The installed OS: status, slots, the queue, the running job, held keys to collect, the host drive and the later tiers. */
function OsBlock({ sec, picked, onPick }: { sec: OsSection; picked: string | null; onPick: (id: string) => void }) {
  return (
    <section class="pblock os-sec" aria-label={sec.name}>
      <h3 title={sec.name}><Icon name="cpu" size={11} /> OS <span class={`chip ${sec.level}`}>{sec.status}</span></h3>
      <div class="chips">
        <span class="chip" title="Operating system tier"><Icon name="gauge" size={12} /> tier {sec.tier}</span>
        <span class="chip" title="Programs it runs at once"><Icon name="cpu" size={12} /> {sec.programSlots} at once</span>
        <span class="chip" title="Jobs in the queue, out of its slots"><Icon name="slot" size={12} /> {sec.queue.length}/{sec.queueSlots}</span>
        {sec.host && (
          <span class="chip" title={`Space used on the drive in ${sec.host.slot}`}><Icon name="memory" size={12} /> {sec.host.usedK}/{sec.host.capK}K</span>
        )}
      </div>
      {sec.running && <div class="pline info"><Icon name="clock" size={12} /> Running {sec.running}</div>}
      {sec.queue.map((q) => (
        <div class={`osrow ${q.job && !q.job.runnable ? 'stuck' : ''}`} key={`q${q.keyId}`}>
          <span class="oname">{q.label}</span>
          <span class="mute">{q.type}</span>
          <span class={q.state === 'result' ? 'ok' : 'mute'}>{q.text}</span>
          {q.job && (q.job.needs.length > 0 || !q.job.runnable || q.job.declinable) && (
            <div class="osrow-sub">
              <NeedChips job={q.job} />
              <Deadline job={q.job} />
              <span class="grow" />
              <DeclineButton job={q.job} via="job" compact />
            </div>
          )}
        </div>
      ))}
      {sec.ladder.length > 0 && (
        <div class="rungs">
          {sec.ladder.map((r) => (
            <Rung key={r.specId} step={r} picked={r.specId === picked} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

function Body({ m, s, content }: { m: PickerModel; s: Snapshot; content: { current: HTMLDivElement | null } }) {
  // The option the bars compare against: the picked rung, else the selected part, else the first upgrade on offer.
  const [picked, setPicked] = useState<string | null>(null);
  const firstOffer = m.ladder.find((r) => r.state === 'crate' || r.state === 'ready' || r.state === 'poor' || r.state === 'blocked')?.specId ?? null;
  // With nothing on offer the bars still compare with the next tier up (locked or not), so its cost and delta show.
  const next = nextUpgrade(m.ladder);
  const option = picked ?? m.focus ?? firstOffer ?? next?.specId ?? null;
  // Operating systems have their own stats (programs, queue), so they are not compared with hardware bars.
  const rows = option && m.kind !== 'key' && m.kind !== 'info' && !getOsSpec(option) ? compareRows(m.kind, m.current, option) : [];
  const artId = m.device?.spec ?? (m.kind === 'board' ? boardId(s.boardTier) : m.kind === 'case' ? caseId(s.caseTier) : m.focus);
  // With a clock dial the overclock warnings are shown by the dial's zone, not as text.
  const lines: PickerLine[] = m.clock ? m.lines.filter((l) => l.level === 'info' || l.level === 'ok') : m.lines;
  // Words only where something is wrong or the object has nothing else to show: warnings always, one plain line for a bare socket.
  const calm = (l: PickerLine) => l.level === 'info' || l.level === 'ok';
  const shownLines = [...lines.filter((l) => !calm(l)), ...(m.device || m.ladder.length ? [] : lines.filter(calm).slice(0, 1))];
  const psu = m.kind === 'psu' ? s.power : null;
  const loadFrac = psu && psu.budgetW > 0 ? psu.totalW / psu.budgetW : 0;
  // A CPU row the board's VRM cannot feed says so in words, once, under the bars.
  const optWarn = (m.kind === 'cpu' || m.kind === 'os') && option ? m.ladder.find((r) => r.specId === option)?.warn : undefined;
  const optName = option ? shortName(getSpec(option)?.name ?? option) : '';

  return (
    <div class="pk-content" ref={content} data-kind={m.kind} aria-label={m.title}>
      <button class="close" aria-label="Close" title="Close (Esc)" onClick={() => { selected.value = null; }}>
        <Icon name="close" size={11} />
      </button>
      <header class="phead">
        {artId && (m.kind === 'cpu' || m.kind === 'ram' || m.kind === 'psu' || m.kind === 'cooler' || m.kind === 'radiator' || m.kind === 'display' || m.kind === 'board' || m.kind === 'vrm-sink' || m.kind === 'ram-sink') && (
          <div class="part"><PartArt id={artId} size={104} /></div>
        )}
        <div class="ptext">
          <div class="ptitle" title={m.nerd ? `${m.plain} ${m.nerd}` : m.plain}>{m.title}{m.tag && <> <span class="chip idle" title="The client is online now, so this key expires without a penalty.">{m.tag}</span></>}</div>
        </div>
      </header>
      {m.job && (m.job.needs.length > 0 || !m.job.runnable) && (
        <div class="jobrow"><NeedChips job={m.job} /><Deadline job={m.job} /></div>
      )}
      {m.device && !m.device.burnt && m.kind !== 'psu' && m.kind !== 'cooler' && <Readings dev={m.device} />}
      {psu && (
        <div class={`bar load ${psu.tripped ? 'bad' : loadFrac > 0.85 ? 'warn' : ''}`} title={`${psu.totalW.toFixed(0)} W of ${psu.budgetW} W`}>
          <i style={{ width: `${Math.min(100, loadFrac * 100)}%` }} />
        </div>
      )}
      {shownLines.map((l, i) => (
        <div key={i} class={`pline ${l.level === 'info' ? '' : l.level}`}>{l.text}</div>
      ))}
      {m.vrm && m.kind === 'info' && <VrmBlock v={m.vrm} s={s} />}
      {m.clock && m.device && m.kind === 'cpu' && s.cpuClock && <ClockDial s={s} cpu={m.device} />}
      {m.clock && m.device && m.kind === 'ram' && <RamClockDial s={s} dev={m.device} />}
      {m.vrm && (m.kind === 'cpu' || m.kind === 'ram') && <VrmBlock v={m.vrm} s={s} />}
      {optWarn && <div class="pline warn">{optName}: {optWarn}</div>}
      {m.osSection && <OsBlock sec={m.osSection} picked={option} onPick={setPicked} />}
      {m.shelf && m.shelf.length > 0 && (
        <section class="pblock" aria-label="Operating systems">
          <h3 title="Installs onto a drive. The machine boots from it, so it does not reboot for every job."><Icon name="cpu" size={11} /> Operating systems</h3>
          <div class="rungs">
            {m.shelf.map((r) => (
              <Rung key={r.specId} step={r} picked={r.specId === option} onPick={(id) => setPicked(id)} />
            ))}
          </div>
        </section>
      )}
      {m.boardCards && (
        <section class="pblock" aria-label="Motherboards">
          <h3 title="A bigger board needs the machine off. Everything you own moves over, and the VRM is the strength bar.">Motherboards</h3>
          <div class="bcards">
            {m.boardCards.map((c) => <BoardCardView key={c.id} c={c} />)}
          </div>
        </section>
      )}
      {m.ladder.length > 0 && !m.boardCards && (
        <section class="pblock">
          <h3>Upgrades</h3>
          <div class="rungs">
            {m.ladder.map((r) => (
              <Rung key={r.specId} step={r} picked={r.specId === option} onPick={(id) => setPicked(id)} />
            ))}
          </div>
          {option && m.current !== option && <Compare rows={rows} option={option} />}
        </section>
      )}
      {m.actions.length > 0 && (
        <div class="pactions">
          {m.actions.map((a) => <Action key={a.id + (a.keyId ?? '')} a={a} />)}
          {m.job && <DeclineButton job={m.job} via="key" />}
        </div>
      )}
    </div>
  );
}

const GAP_REM = 0.9;

/**
 * The contextual card for the selected id: a part (with upgrades), a key, the power button or the USB port. It is a popup
 * next to the object (`anchorOf`, recomputed on `cameraRev`): right, then left, below, above; flipped and clamped inside
 * the free area, with a tail pointing at the object. The shell persists across selections, so position and height glide.
 * Ids without a world rect (hidden at far zoom, off screen) dock at the bottom right of the free area, next to the
 * inventory shelf; `inv:<id>` tiles anchor to their DOM tile, above it.
 */
export function PickerCard() {
  const id = selected.value;
  const s = snapshot.value;
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const glideTimer = useRef<number>(0);
  const lastId = useRef<string | null>(null);

  // Escape closes the card. Registered while a card is open only.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') selected.value = null; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  // A spare part in the inventory shows its stats in the shelf's own side card, not here.
  const m = id && s && !id.startsWith('inv:') ? pickerFor(id, s) : null;
  const open = !!m;

  useEffect(() => {
    const el = shell.current, inner = content.current;
    if (!open || !el || !inner || !id) { lastId.current = null; return; }
    // A card that has just opened is placed at once (no glide in from the top left, where the shell starts).
    const first = lastId.current === null;
    if (first) el.classList.add('nomove');
    const reposition = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const inset = viewInset.peek();
      const vw = window.innerWidth, vh = window.innerHeight;
      const tile = id.startsWith('inv:') ? document.querySelector(`[data-inv~="${CSS.escape(id.slice(4))}"]`) : null;
      let free: Rect = { x: inset.left, y: inset.top, w: vw - inset.left - inset.right, h: vh - inset.top - inset.bottom };
      let anchor: Rect | null = null;
      let order: Side[] | undefined;
      if (tile) {
        const r = tile.getBoundingClientRect();
        anchor = { x: r.left, y: r.top, w: r.width, h: r.height };
        // The popup stays above the shelf it is anchored to (the shelf's reserved space is the bottom inset).
        free = { x: 0, y: inset.top, w: vw, h: vh - inset.top - inset.bottom };
        order = ['above', 'right', 'left'];
      } else {
        const a = anchorOf(id);
        if (a && a.visible) anchor = { x: a.x, y: a.y, w: a.w, h: a.h };
      }
      const margin = rem * 0.5;
      free = { x: free.x + margin, y: free.y, w: Math.max(1, free.w - 2 * margin), h: Math.max(1, free.h - margin) };
      const width = el.offsetWidth;
      const maxH = Math.max(rem * 8, free.h);
      const natural = inner.offsetHeight + 2;
      const h = Math.min(natural, maxH);
      el.style.height = `${h}px`;
      const pl = anchor ? placePopup(anchor, { w: width, h }, free, rem * GAP_REM, order) : dockPlacement({ w: width, h }, free);
      el.dataset.side = pl.side;
      el.style.setProperty('--tail', `${pl.tail}px`);
      el.style.transform = `translate(${Math.round(pl.x)}px, ${Math.round(pl.y)}px)`;
    };
    // A different object: glide (slow transition) instead of following (short one).
    if (lastId.current !== null && lastId.current !== id) {
      el.classList.add('glide');
      window.clearTimeout(glideTimer.current);
      glideTimer.current = window.setTimeout(() => el.classList.remove('glide'), 520);
    }
    lastId.current = id;
    reposition();
    if (first) { void el.offsetWidth; el.classList.remove('nomove'); }
    const ro = new ResizeObserver(reposition);
    ro.observe(inner);
    const stop = effect(() => { cameraRev.value; viewInset.value; reposition(); });
    window.addEventListener('resize', reposition);
    return () => { ro.disconnect(); stop(); window.removeEventListener('resize', reposition); };
  }, [open, id]);

  if (!id || !s || !m) return null;
  // The shell is not keyed (position and height glide); the content is (a different selection starts with the default comparison).
  return (
    <aside class="card picker" ref={shell} data-side="dock" aria-label={m.title}>
      <i class="tail" aria-hidden="true" />
      <div class="pk-body"><Body key={id} m={m} s={s} content={content} /></div>
    </aside>
  );
}
