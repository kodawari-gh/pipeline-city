import {
  connectCable, disconnectCable, ejectKey, install, plugKey, powerButton, powerCycle, purchase, setCpuClock, snapshot,
  uninstall,
} from '../game/store';
import { getSpec } from '../sim/board/specs';
import { clockWarning, describeId, fmtClock, fmtMoney, groupPurchases } from './logic';

function ClockControl() {
  const s = snapshot.value!;
  const c = s.cpuClock;
  if (!c) return null;
  const cpu = s.devices.find((d) => d.kind === 'cpu');
  const warn = clockWarning(cpu);
  const base = cpu ? getSpec(cpu.spec)?.clock?.base : undefined;
  return (
    <section>
      <h3 title="Run the processor faster than designed (overclock) or slower (underclock). Faster is quicker but hotter.">CPU clock</h3>
      <div class="row">
        <input
          type="range" min={c.min} max={c.max} step={0.05} value={c.value}
          aria-label="CPU clock"
          onInput={(e) => setCpuClock(Number(e.currentTarget.value))}
        />
        <span class="value">{fmtClock(c.value)}</span>
      </div>
      <div class="sub">{base !== undefined && c.value > base ? 'overclocked' : base !== undefined && c.value < base ? 'underclocked' : 'stock'}
        {cpu && ` | ${cpu.tempC.toFixed(0)} C`}</div>
      {warn && <div class={`note ${warn.level}`} role="status">{warn.text}</div>}
    </section>
  );
}

/** Minimal controls for the assembly API (power, cables, inventory, keys) until the drag-and-drop UI exists. */
function Machine() {
  const s = snapshot.value!;
  return (
    <section>
      <h3>Machine</h3>
      <button class="item ready" onClick={powerButton}>
        <span class="name">{s.powered ? 'Power off' : 'Power on'}</span>
        <span class="price">{s.phase}</span>
        {s.phaseReason && <span class="why">{s.phaseReason}</span>}
        {!s.powered && s.noPowerReason && <span class="why">{s.noPowerReason}</span>}
      </button>
      {s.cables.map((c) => (
        <button
          key={c.id} class={`item ${s.powered || (!c.connected && c.blocked) ? 'blocked' : 'ready'}`}
          onClick={() => (c.connected ? disconnectCable(c.id) : connectCable(c.id))}
        >
          <span class="name">{c.name}</span>
          <span class="price">{c.connected ? 'connected' : 'unplugged'}</span>
        </button>
      ))}
      {s.inventory.map((it) => (
        <button key={it.id} class={`item ${it.installable ? 'ready' : 'blocked'}`} title={it.reason} onClick={() => install(it.id)}>
          <span class="name">Install {it.name}</span>
          <span class="price">{[...it.freeSlots, ...it.swapSlots][0] ?? ''}</span>
          {!it.installable && it.reason && <span class="why">{it.reason}</span>}
        </button>
      ))}
      {s.devices.filter((d) => d.kind !== 'cooler').map((d) => (
        <button key={d.id} class="item" disabled={s.powered} onClick={() => uninstall(d.id)}>
          <span class="name">Remove {d.name}</span>
          <span class="price">{d.slot}</span>
        </button>
      ))}
      {s.plugged ? (
        <button class="item ready" onClick={ejectKey}>
          <span class="name">Remove key {s.plugged.label}</span>
          <span class="price">{s.plugged.done ? 'done' : 'in use'}</span>
        </button>
      ) : (
        s.tray.map((k) => (
          <button key={k.id} class="item ready" onClick={() => plugKey(k.id)}>
            <span class="name">Plug key {k.label}</span>
            <span class="price">{k.age}s{k.late ? ' late' : ''}</span>
          </button>
        ))
      )}
    </section>
  );
}

export function Shop() {
  const s = snapshot.value!;
  const groups = groupPurchases(s.purchases, s.pendingPurchases, s.money);
  return (
    <div class="shop">
      <h2>Shop</h2>
      {s.power.tripped && (
        <div class="note bad" role="alert">
          Power supply tripped. Everything is off.
          <button class="primary" onClick={powerCycle}>Power cycle</button>
        </div>
      )}
      <Machine />
      <ClockControl />
      {groups.map((g) => (
        <section key={g.kind}>
          <h3>{g.label}</h3>
          {g.items.map((it) => {
            const d = describeId(it.id);
            const title = [it.reason, d?.plain, d?.nerd].filter(Boolean).join('\n');
            return (
              <button
                key={it.id} class={`item ${it.state}`} title={title}
                aria-disabled={it.state !== 'ready'}
                onClick={() => { if (it.state === 'ready') purchase(it.id); }}
              >
                <span class="name">{it.name}</span>
                <span class="price">{fmtMoney(it.price)}</span>
                {it.state === 'blocked' && <span class="why">{it.reason}</span>}
                {it.state === 'poor' && <span class="why">{it.reason}</span>}
              </button>
            );
          })}
        </section>
      ))}
      {groups.length === 0 && <div class="mute">Nothing to buy right now.</div>}
    </div>
  );
}
