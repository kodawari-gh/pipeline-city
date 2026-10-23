import { useEffect, useState } from 'preact/hooks';
import { selected } from '../game/hover';
import { ejectKey, plugKey, powerButton, powerCycle, purchase, setCpuClock, snapshot, uninstallOs } from '../game/store';
import { getSpec, type CpuSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/game/game';
import { getOsSpec } from '../sim/os';
import { fmtClock, fmtMoney } from './logic';
import {
  boardId, clockZones, compareRows, estTempC, installedCooler, osSection, pickerFor, zoneOf,
  type CompareRow, type OsSection, type LadderStep, type PickerAction, type PickerLine, type PickerModel, type ZoneName,
} from './picker';
import { Icon } from './Icons';
import { PartArt } from './PartArt';

const shortName = (name: string) => name.split(' (')[0]!;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** One upgrade rung: owned, next (buy), blocked or later. Pressing the card compares it with the current part. */
function Rung({ step, picked, onPick }: { step: LadderStep; picked: boolean; onPick: (id: string) => void }) {
  const foot = (() => {
    switch (step.state) {
      case 'installed': return <span class="need ok"><Icon name="check" size={11} /> Fitted</span>;
      case 'crate': return <span class="need ok"><Icon name="box" size={11} /> Spare</span>;
      case 'ready': return (
        <button class="primary buy" onClick={(e) => { e.stopPropagation(); purchase(step.specId); }}
          title={`Buy for ${fmtMoney(step.price ?? 0)}. It goes into your inventory.`}>
          Buy {fmtMoney(step.price ?? 0)}
        </button>
      );
      case 'poor': return <span class="need warn" title={step.reason}><Icon name="dollar" size={11} /> {fmtMoney(step.price ?? 0)}</span>;
      case 'blocked': return <span class="need bad" title={step.reason}><Icon name="lock" size={11} /> Blocked</span>;
      case 'locked': return <span class="need mute" title={step.reason}><Icon name="lock" size={11} /> Later</span>;
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
      role="button" tabIndex={0} class={`rung ${step.state} ${picked ? 'picked' : ''}`}
      title={title} aria-pressed={picked}
      onClick={() => onPick(step.specId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(step.specId); } }}
    >
      <span class="rtier">Tier {step.tier}</span>
      <PartArt id={step.specId} size={64} />
      <span class="rname">{shortName(step.name)}</span>
      <span class="rfoot">{footText}</span>
    </div>
  );
}

/** Before/after bars: grey is the current part, coloured is the option; the delta is coloured by whether it is better. */
function Compare({ rows, option }: { rows: CompareRow[]; option: string }) {
  if (!rows.length) return null;
  return (
    <div class="compare" aria-label={`Compared with ${shortName(getSpec(option)?.name ?? option)}`}>
      {rows.map((r) => (
        <div class="crow" key={r.key}>
          <div class="ctop">
            <Icon name={r.icon} size={12} />
            <span class="clabel">{r.label}</span>
            {r.deltaText && <b class={`delta ${r.trend ?? ''}`}>{r.deltaText}</b>}
          </div>
          {r.cur !== null && <div class="bar cur"><i style={{ width: `${r.cur * 100}%` }} /></div>}
          <div class={`bar opt ${r.trend ?? ''}`}><i style={{ width: `${r.opt * 100}%` }} /></div>
          <div class="ctext mute">
            <span>{r.curText ?? ''}</span>
            <span>{r.optText}</span>
          </div>
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

/** Live readings of an installed part as small icon chips. */
function Readings({ dev }: { dev: NonNullable<PickerModel['device']> }) {
  if (dev.burnt) return <div class="chips"><span class="chip bad"><Icon name="warn" size={12} /> burnt out</span></div>;
  return (
    <div class="chips">
      <span class="chip" title="Temperature"><Icon name="flame" size={12} /> {dev.tempC.toFixed(0)} C</span>
      <span class="chip" title="Power draw"><Icon name="bolt" size={12} /> {dev.powerW.toFixed(1)} W</span>
      <span class="chip" title="Effective clock"><Icon name="clock" size={12} /> {dev.effectiveClock.toFixed(2)}x</span>
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
      title={a.why ?? (a.id === 'uninstallOs' ? 'Takes the OS off its drive and back into your inventory. The drive is wiped.' : undefined)}
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
      <h3><Icon name="cpu" size={11} /> {sec.name} <span class={`chip ${sec.level}`}>{sec.status}</span></h3>
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
        <div class="osrow" key={`q${q.keyId}`}>
          <span class="oname">{q.label}</span>
          <span class="mute">{q.type}</span>
          <span class={q.state === 'result' ? 'ok' : 'mute'}>{q.text}</span>
        </div>
      ))}
      {sec.held.map((h) => (
        <div class="pline warn" key={`h${h.keyId}`}><Icon name="box" size={12} /> {h.label}: {h.hint}</div>
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

function Body({ m, s }: { m: PickerModel; s: Snapshot }) {
  // The option the bars compare against: the picked rung, else the selected part, else the first upgrade on offer.
  const [picked, setPicked] = useState<string | null>(null);
  const firstOffer = m.ladder.find((r) => r.state === 'crate' || r.state === 'ready' || r.state === 'poor' || r.state === 'blocked')?.specId ?? null;
  const option = picked ?? m.focus ?? firstOffer;
  // Operating systems have their own stats (programs, queue), so they are not compared with hardware bars.
  const rows = option && m.kind !== 'key' && m.kind !== 'info' && !getOsSpec(option) ? compareRows(m.kind, m.current, option) : [];
  const artId = m.device?.spec ?? (m.kind === 'board' ? boardId(s.boardTier) : m.focus);
  // With a clock dial the overclock warnings are shown by the dial's zone, not as text.
  const lines: PickerLine[] = m.clock ? m.lines.filter((l) => l.level === 'info' || l.level === 'ok') : m.lines;
  const psu = m.kind === 'psu' ? s.power : null;
  const loadFrac = psu && psu.budgetW > 0 ? psu.totalW / psu.budgetW : 0;

  return (
    <aside class="card picker" aria-label={m.title} data-kind={m.kind}>
      <button class="close" aria-label="Close" title="Close (Esc)" onClick={() => { selected.value = null; }}>
        <Icon name="close" size={11} />
      </button>
      <header class="phead">
        {artId && (m.kind === 'cpu' || m.kind === 'ram' || m.kind === 'psu' || m.kind === 'cooler' || m.kind === 'display' || m.kind === 'board') && (
          <div class="part"><PartArt id={artId} size={80} /></div>
        )}
        <div class="ptext">
          <div class="ptitle">{m.title}</div>
          {m.plain && <div class="pplain">{m.plain}</div>}
        </div>
      </header>
      {m.device && !m.device.burnt && m.kind !== 'psu' && m.kind !== 'cooler' && <Readings dev={m.device} />}
      {psu && (
        <div class={`bar load ${psu.tripped ? 'bad' : loadFrac > 0.85 ? 'warn' : ''}`} title={`${psu.totalW.toFixed(0)} W of ${psu.budgetW} W`}>
          <i style={{ width: `${Math.min(100, loadFrac * 100)}%` }} />
        </div>
      )}
      {lines.map((l, i) => (
        <div key={i} class={`pline ${l.level === 'info' ? '' : l.level}`}>{l.text}</div>
      ))}
      {m.clock && m.device && s.cpuClock && <ClockDial s={s} cpu={m.device} />}
      {m.osSection && <OsBlock sec={m.osSection} picked={option} onPick={setPicked} />}
      {m.shelf && m.shelf.length > 0 && (
        <section class="pblock" aria-label="Operating systems">
          <h3><Icon name="cpu" size={11} /> Operating systems</h3>
          <div class="rungs">
            {m.shelf.map((r) => (
              <Rung key={r.specId} step={r} picked={r.specId === option} onPick={(id) => setPicked(id)} />
            ))}
          </div>
          <div class="sub">Installs onto a drive. The machine boots from it, so it does not reboot for every job.</div>
        </section>
      )}
      {m.ladder.length > 0 && (
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
      {m.emptyText && <div class="sub">{m.emptyText}</div>}
      {m.actions.length > 0 && (
        <div class="pactions">
          {m.actions.map((a) => <Action key={a.id + (a.keyId ?? '')} a={a} />)}
        </div>
      )}
      {m.nerd && (
        <details class="nerdwrap">
          <summary>Details</summary>
          <div class="nerd">{m.nerd}</div>
        </details>
      )}
    </aside>
  );
}

/** The contextual card for the selected id: a part (with upgrades), a key, the power button or the USB port. */
export function PickerCard() {
  const id = selected.value;
  const s = snapshot.value;
  // Escape closes the card. Registered while a card is open only.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') selected.value = null; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  if (!id || !s) return null;
  const m = pickerFor(id, s);
  if (!m) return null;
  // Keyed by id: a different selection starts with the default comparison.
  return <Body key={id} m={m} s={s} />;
}
