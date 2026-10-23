import { useEffect } from 'preact/hooks';
import { selected } from '../game/hover';
import { ejectKey, plugKey, powerButton, powerCycle, purchase, setCpuClock, snapshot } from '../game/store';
import { getSpec } from '../sim/board/specs';
import { clockWarning, fmtClock, fmtMoney } from './logic';
import { pickerFor, type PickerAction, type PickerModel, type PickerRow } from './picker';

const TAG_HEAD: Record<PickerRow['tag'], string> = { installed: 'In the machine', crate: 'In the crate', upgrade: 'Buy' };

function Row({ row }: { row: PickerRow }) {
  return (
    <div class={`prow ${row.tag}`}>
      <div class="ptop">
        <span class="pname">{row.name}</span>
        {row.tag === 'upgrade' && row.price !== undefined && (
          <button
            class={row.state === 'ready' ? 'primary' : ''}
            disabled={row.state !== 'ready'}
            title={row.reason ?? `Buy for ${fmtMoney(row.price)}. It goes into the crate; drag it onto its socket.`}
            onClick={() => purchase(row.id)}
          >
            {row.state === 'ready' ? `Buy ${fmtMoney(row.price)}` : fmtMoney(row.price)}
          </button>
        )}
      </div>
      <div class="sub">
        {row.tier !== undefined ? `tier ${row.tier} | ` : ''}{row.brief}
      </div>
      {row.reason && <div class={`why ${row.state === 'blocked' ? 'bad' : row.tag === 'upgrade' ? 'warn' : ''}`}>{row.reason}</div>}
    </div>
  );
}

function ClockControl() {
  const s = snapshot.value!;
  const c = s.cpuClock;
  const cpu = s.devices.find((d) => d.kind === 'cpu');
  if (!c || !cpu) return null;
  const base = getSpec(cpu.spec)?.clock?.base;
  const warn = clockWarning(cpu);
  return (
    <section class="pblock">
      <h3 title="Run the processor faster than designed (overclock) or slower (underclock). Faster is quicker but hotter.">CPU clock</h3>
      <div class="row">
        <input
          type="range" min={c.min} max={c.max} step={0.05} value={c.value} aria-label="CPU clock"
          onInput={(e) => setCpuClock(Number(e.currentTarget.value))}
        />
        <span class="value">{fmtClock(c.value)}</span>
      </div>
      <div class="sub">
        {base !== undefined && c.value > base ? 'overclocked' : base !== undefined && c.value < base ? 'underclocked' : 'stock'}
        {` | ${cpu.tempC.toFixed(0)} C`}
      </div>
      {warn && <div class={`note ${warn.level}`} role="status">{warn.text}</div>}
    </section>
  );
}

function Action({ a }: { a: PickerAction }) {
  const run = () => {
    switch (a.id) {
      case 'power': powerButton(); break;
      case 'powerCycle': powerCycle(); break;
      case 'plug': if (a.keyId !== undefined) plugKey(a.keyId); break;
      case 'eject': ejectKey(); break;
    }
  };
  return (
    <button class={a.primary ? 'primary' : ''} disabled={!!a.why} title={a.why} onClick={run} >
      {a.label}
    </button>
  );
}

/** The contextual card for the selected id: a part, a socket, the crate, a key, the power button or the USB port. */
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
  const dev = m.device;
  const groups: Array<[PickerRow['tag'], PickerRow[]]> = (['installed', 'crate', 'upgrade'] as const)
    .map((t) => [t, m.rows.filter((r) => r.tag === t)] as [PickerRow['tag'], PickerRow[]])
    .filter(([, rs]) => rs.length > 0);
  return (
    <aside class="card picker" aria-label={m.title} data-kind={m.kind}>
      <button class="close" aria-label="Close" title="Close (Esc)" onClick={() => { selected.value = null; }}>x</button>
      <div class="ptitle">{m.title}</div>
      {m.plain && <div class="pplain">{m.plain}</div>}
      {m.nerd && <div class="nerd">{m.nerd}</div>}
      {dev && !dev.burnt && (
        <div class="live">
          <span>{dev.tempC.toFixed(0)} C</span>
          <span>{dev.powerW.toFixed(1)} W</span>
          <span>{dev.effectiveClock.toFixed(2)}x</span>
          {dev.throttle < 1 && <span class="note warn">throttled</span>}
          {dev.unstable && <span class="note bad">unstable</span>}
        </div>
      )}
      {m.lines.map((l, i) => (
        <div key={i} class={`pline ${l.level === 'info' ? '' : l.level}`}>{l.text}</div>
      ))}
      {m.clock && <ClockControl />}
      {groups.map(([tag, rs]) => (
        <section class="pblock" key={tag}>
          <h3>{TAG_HEAD[tag]}</h3>
          {rs.map((r) => <Row key={`${tag}-${r.id}`} row={r} />)}
        </section>
      ))}
      {m.rows.length === 0 && m.emptyText && <div class="sub">{m.emptyText}</div>}
      {m.actions.length > 0 && (
        <div class="pactions">
          {m.actions.map((a) => <Action key={a.id + (a.keyId ?? '')} a={a} />)}
        </div>
      )}
    </aside>
  );
}
