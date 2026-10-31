// The Contracts section of the job log (docs/JOBS.md "Contracts"): cloud-storage offers to accept or ignore, the contracts running, and the last
// ones that ended. Offers are opt-in: nothing is sent to the tray or the network queue, and an ignored offer costs nothing.
import { signal } from '@preact/signals';
import { acceptContract, ignoreContract } from '@/app/store';
import type { ContractsSnap } from '@/worker/game/types';
import type { JobLogEntry } from '@/features/jobs/sim/joblog';
import { Icon } from '@/core/ui/kit/Icons';
import { activeView, finishedView, offerView } from './contractui';

/** The drive picked on each offer card, when the player chose one (offer id -> device id). */
const chosen = signal<Record<number, string>>({});
const FINISHED_ROWS = 4;

export function ContractsSection({ contracts, finished }: { contracts: ContractsSnap; finished: JobLogEntry[] }) {
  if (!contracts.open && contracts.active.length === 0 && finished.length === 0) return null;
  return (
    <section class="jl-contracts" aria-label="Contracts">
      <h4><Icon name="disk" size={12} /> Contracts <span class="chip">{contracts.active.length} running</span><span class="chip">{contracts.offers.length} on offer</span></h4>
      {contracts.offers.length === 0 && contracts.active.length === 0 && <p class="mute jl-more">No offers right now. Clients with data to store ask from time to time; ignoring them costs nothing.</p>}
      <div class="jc-grid">
        {contracts.offers.map((o) => {
          const v = offerView(o);
          const pick = chosen.value[o.id] ?? '';
          return (
            <article key={o.id} class={`jc-card k-${v.tone}`}>
              <header><b>{v.title}</b> <span class="mute">{v.client}</span></header>
              <ul class="jc-facts">{v.facts.map((f) => <li key={f.text} title={f.title}><Icon name={f.icon} size={11} /> {f.text}</li>)}</ul>
              {v.accept.why && <p class="jc-why"><Icon name="lock" size={11} /> {v.accept.why}</p>}
              <footer>
                {v.choices.length > 1 && (
                  <select aria-label="Which drive holds it" value={pick} onChange={(e) => { chosen.value = { ...chosen.value, [o.id]: (e.currentTarget as HTMLSelectElement).value }; }}>
                    <option value="">Best drive</option>
                    {v.choices.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.name}</option>)}
                  </select>
                )}
                <button class="primary" disabled={!v.accept.enabled} title={v.accept.why ?? 'Put the dataset on a drive and start holding it'} onClick={() => acceptContract(o.id, pick || undefined)}>Accept</button>
                <button onClick={() => ignoreContract(o.id)} title="Turn it down: it goes away, no penalty">Ignore</button>
                <span class="mute jc-exp">{v.expires}</span>
              </footer>
            </article>
          );
        })}
        {contracts.active.map((c) => {
          const v = activeView(c);
          return (
            <article key={c.id} class={`jc-card jc-live k-${v.health.tone}`}>
              <header><b>{v.title}</b> <span class="mute">{v.client}</span>
                <span class={`jl-tag k-${v.health.tone}`} title={v.health.hint}><Icon name={v.health.tone === 'compute' ? 'check' : v.health.tone === 'queue' ? 'warn' : 'lock'} size={11} /> {v.health.label}</span>
              </header>
              <span class="jl-bar" role="img" aria-label={`${Math.round(v.progress * 100)}% of the hold done`}><i class="jl-run" style={{ width: `${v.progress * 100}%` }} /></span>
              <ul class="jc-facts">
                <li title="The drive that holds the data"><Icon name="disk" size={11} /> {v.drive}{v.mirrored ? ' (mirrored)' : ''}</li>
                <li><Icon name="clock" size={11} /> {v.left}</li>
                <li title="Read requests come at seeded times; a read the drive cannot serve in time is missed">{v.nextRead}</li>
                <li class={v.atRisk ? 'jc-risk' : ''} title="Too many missed reads breach the contract"><Icon name="warn" size={11} /> {v.misses}</li>
                <li><Icon name="dollar" size={11} /> {v.income}</li>
              </ul>
            </article>
          );
        })}
      </div>
      {finished.length > 0 && (
        <ul class="jc-done" aria-label="Contracts that ended">
          {finished.slice(0, FINISHED_ROWS).map((e) => {
            const v = finishedView(e);
            return <li key={e.id}><span class={`jl-tag k-${v.tone}`}>{v.label}</span> <b>{v.title}</b> <span class="mute">{v.detail}</span> <span class="jl-pay">{v.net}</span></li>;
          })}
        </ul>
      )}
    </section>
  );
}
