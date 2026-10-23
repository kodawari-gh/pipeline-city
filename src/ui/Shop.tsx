import { powerCycle, purchase, setCpuClock, snapshot } from '../game/store';
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
                {it.pending && <span class="why">bought, installs after the current request</span>}
              </button>
            );
          })}
        </section>
      ))}
      {groups.length === 0 && <div class="mute">Nothing to buy right now.</div>}
    </div>
  );
}
