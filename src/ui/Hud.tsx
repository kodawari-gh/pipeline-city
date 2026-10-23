import {
  autosaveOffer, exportSave, importSave, lastError, powerCycle, purchase, setSpeed, snapshot, speed, startSim,
} from '../game/store';
import { SPEEDS } from '../sim/protocol';

const label = (s: number) => (s === 0 ? 'pause' : `${s}x`);

// Functional dev HUD, not final UI.
export function Hud() {
  const offer = autosaveOffer.value;
  const s = snapshot.value;
  const err = lastError.value;

  if (offer && !s) {
    return (
      <div>
        <div>Autosave found (tick {offer.baseTick}, ${Math.floor(offer.money)})</div>
        <button onClick={() => startSim(offer)}>Continue</button>
        <button onClick={() => startSim(null)}>New game</button>
        {err && <div style={{ color: '#f66' }}>{err}</div>}
      </div>
    );
  }
  if (!s) return <div>starting...{err && <div style={{ color: '#f66' }}>{err}</div>}</div>;

  return (
    <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
      <div style={{ fontSize: '18px' }}>${Math.floor(s.money).toLocaleString()}</div>
      <div>tick {s.baseTick} | rep {s.reputation.toFixed(2)} | queue {s.queueLength}/{s.queueCap} | done {s.completed}</div>
      <div>
        {SPEEDS.map((v) => (
          <button key={v} disabled={speed.value === v} onClick={() => setSpeed(v)}>{label(v)}</button>
        ))}
        <button onClick={exportSave}>Export</button>
        <label style={{ cursor: 'pointer' }}>
          {' '}<span style={{ border: '1px solid #888', padding: '1px 6px' }}>Import</span>
          <input
            type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) importSave(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {s.power.tripped && <button onClick={powerCycle}>Power cycle</button>}
      </div>
      <pre style={{ margin: '6px 0', minHeight: '1.5em', color: '#8f8' }}>{s.display || '(display blank)'}</pre>
      <div>
        {s.purchases.map((p) => (
          <div key={p.id}>
            <button disabled={!p.affordable || !!p.blocked} title={p.blocked} onClick={() => purchase(p.id)}>
              {p.name} ${p.price}
            </button>
            {p.blocked && <span style={{ opacity: 0.6 }}> {p.blocked}</span>}
          </div>
        ))}
        {s.pendingPurchases.length > 0 && <div>pending: {s.pendingPurchases.join(', ')}</div>}
      </div>
      {err && <div style={{ color: '#f66' }}>{err}</div>}
    </div>
  );
}
