import { snapshot } from '../game/store';
import { getSpec } from '../sim/board/specs';
import { cacheHitRate, cpiIpc, fmtNum, powerLevel, stallsByCause, tempLevel, totalStalls } from './logic';
import { history } from './state';
import { Meter } from './Meter';

function Sparkline() {
  const h = history.value;
  if (h.length < 2) return <div class="mute sub">collecting...</div>;
  const w = 220;
  const ht = 36;
  const max = Math.max(1, ...h.map((x) => Math.max(x.retired, x.stalls)));
  const pts = (key: 'retired' | 'stalls') =>
    h.map((x, i) => `${((i / (h.length - 1)) * w).toFixed(1)},${(ht - 2 - (x[key] / max) * (ht - 4)).toFixed(1)}`).join(' ');
  return (
    <svg class="spark" viewBox={`0 0 ${w} ${ht}`} role="img" aria-label="Instructions retired and stall cycles per tick, last minute">
      <polyline class="s-ok" points={pts('retired')} fill="none" />
      <polyline class="s-warn" points={pts('stalls')} fill="none" stroke-dasharray="3 2" />
    </svg>
  );
}

export function Stats() {
  const s = snapshot.value!;
  const c = s.counters;
  const perf = cpiIpc(c);
  const hit = cacheHitRate(c);
  const stalls = stallsByCause(c);
  const stallMax = Math.max(1, ...stalls.map((x) => x.value));
  const power = s.power;
  return (
    <div class="stats">
      <h2>Stats</h2>
      <section>
        <h3 title="Cycles per instruction and its inverse. Lower CPI is better; 1.0 is the ideal for a simple pipeline.">Speed</h3>
        <div class="kv"><span>CPI</span><b>{perf ? fmtNum(perf.cpi, 2) : '-'}</b></div>
        <div class="kv"><span>IPC</span><b>{perf ? fmtNum(perf.ipc, 2) : '-'}</b></div>
        <div class="kv"><span>retired</span><b>{c.retired ?? 0}</b></div>
        <div class="kv"><span>cycles</span><b>{c.cycles ?? 0}</b></div>
        <div class="kv" title="Mispredicted branches that threw away work"><span>flushes</span><b>{c.flushes ?? 0}</b></div>
      </section>
      <section>
        <h3>Stalls <span class="mute">({totalStalls(c)})</span></h3>
        {stalls.map((x) => (
          <div class="bar-row" key={x.key} title={x.hint}>
            <span>{x.label}</span>
            <Meter value={x.value} max={stallMax} level="warn" label={x.label} text={String(x.value)} />
            <b>{x.value}</b>
          </div>
        ))}
      </section>
      <section>
        <h3>Cache</h3>
        <div class="kv"><span>hits</span><b>{c.cacheHits ?? 0}</b></div>
        <div class="kv"><span>misses</span><b>{c.cacheMisses ?? 0}</b></div>
        <div class="kv"><span>hit rate</span><b>{hit === null ? '-' : `${(hit * 100).toFixed(0)}%`}</b></div>
      </section>
      <section>
        <h3>Power</h3>
        <div class="bar-row" title="Total draw against what the power supply can deliver.">
          <span>load</span>
          <Meter value={power.totalW} max={Math.max(power.budgetW, power.totalW, 1)} mark={power.budgetW} level={powerLevel(power.totalW, power.budgetW)}
            label="Power load against budget" text={`${power.totalW.toFixed(0)} of ${power.budgetW} watts`} />
          <b>{power.totalW.toFixed(0)}/{power.budgetW} W</b>
        </div>
      </section>
      <section>
        <h3>Devices</h3>
        {s.devices.filter((d) => d.kind !== 'cooler' && d.kind !== 'psu').map((d) => {
          const spec = getSpec(d.spec);
          const max = spec ? spec.thermal.damageC : 100;
          return (
            <div class="dev" key={d.id}>
              <div class="kv"><span>{d.name}</span><b>{d.burnt ? 'burnt' : `${d.effectiveClock.toFixed(2)}x`}</b></div>
              <div class="bar-row" title={spec ? `Throttles at ${spec.thermal.throttleC} C, unstable at ${spec.thermal.unstableC} C, burns at ${spec.thermal.damageC} C` : ''}>
                <span>temp</span>
                <Meter value={d.tempC} max={max} mark={spec?.thermal.throttleC} level={d.burnt ? 'bad' : tempLevel(d.tempC, spec)} label={`${d.name} temperature`} text={`${d.tempC.toFixed(0)} C`} />
                <b>{d.tempC.toFixed(0)} C</b>
              </div>
              <div class="kv sub"><span>power</span><b>{d.powerW.toFixed(1)} W</b></div>
            </div>
          );
        })}
      </section>
      <section>
        <h3>Last minute</h3>
        <Sparkline />
        <div class="legend"><span class="key ok" /> retired <span class="key warn" /> stalls</div>
      </section>
    </div>
  );
}
