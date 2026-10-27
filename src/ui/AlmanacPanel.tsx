// The Almanac: every kind of job as a card that fills in as the player meets it (docs/JOBS.md). Unseen jobs are silhouettes that say when they arrive;
// a job that has come in shows what it is and what it needs; one that has been finished teaches how to do it better and keeps the player's record.
import { signal } from '@preact/signals';
import { snapshot } from '../game/store';
import { dexEntry, dexNeeds, JOB_DEX, type DexEntry, type DexSnap } from '../sim/game/jobdex';
import { Icon } from './Icons';
import { netOpen, statsOpen } from './state';

export const almanacOpen = signal(false);
export const toggleAlmanac = () => {
  almanacOpen.value = !almanacOpen.value;
  if (almanacOpen.value) { statsOpen.value = false; netOpen.value = false; }
};
const picked = signal<string | null>(null);

const STATE_TEXT = { unseen: 'not met', seen: 'met', done: 'done', planned: 'planned' } as const;

function Detail({ e, d, level }: { e: DexEntry; d: DexSnap; level: number }) {
  const { needs, firstLevel } = dexNeeds(e);
  if (d.state === 'unseen') {
    return (
      <div class="alm-detail">
        <h3>? ? ?</h3>
        <p class="mute">A job you have not met yet. {level >= firstLevel ? 'Clients may send one at any time.' : `Clients start sending this kind at level ${firstLevel}.`}</p>
      </div>
    );
  }
  if (d.state === 'planned') {
    return (
      <div class="alm-detail">
        <h3>{e.name}</h3>
        <p>{e.blurb}</p>
        <p class="mute">Planned: clients do not send this kind of job yet.</p>
      </div>
    );
  }
  return (
    <div class="alm-detail">
      <h3>{e.name}</h3>
      <p>{e.blurb}</p>
      <div class="alm-facts">
        <div><span class="mute">Leans on</span> {e.stresses.join(', ')}</div>
        <div><span class="mute">Memory</span> {e.footprint}</div>
        <div><span class="mute">Needs</span> {needs.length ? needs.join(', ') : 'nothing special'}</div>
        <div><span class="mute">Arrives from</span> level {firstLevel}</div>
      </div>
      {d.state === 'seen' ? (
        <p class="mute alm-lock"><Icon name="lock" size={12} /> Finish one to learn how to do it better.</p>
      ) : (
        <>
          <h4>How to do it better</h4>
          <ul class="alm-tips">{e.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <div class="alm-rec">Finished {d.runs} · fastest {d.best} s of machine time</div>
        </>
      )}
    </div>
  );
}

export function AlmanacPanel() {
  if (!almanacOpen.value) return null;
  const s = snapshot.value;
  const dex = s?.dex ?? [];
  const met = dex.filter((d) => d.state === 'seen' || d.state === 'done').length, avail = JOB_DEX.filter((e) => !e.planned).length;
  const sel = picked.value ?? dex.find((d) => d.state !== 'planned')?.id ?? JOB_DEX[0]!.id;
  const e = dexEntry(sel)!, d = dex.find((x) => x.id === sel) ?? { id: sel, state: 'unseen', runs: 0, best: 0, seenTick: 0 } as DexSnap;
  return (
    <aside class="dock almanac" aria-label="Almanac">
      <button class="close" aria-label="Close almanac" onClick={toggleAlmanac}><Icon name="close" size={11} /></button>
      <h2>Almanac <span class="mute">{met}/{avail} met</span></h2>
      <div class="alm-list" role="listbox" aria-label="Jobs">
        {JOB_DEX.map((x) => {
          const st = dex.find((y) => y.id === x.id)?.state ?? 'unseen';
          const hidden = st === 'unseen';
          return (
            <button key={x.id} role="option" aria-selected={sel === x.id} class={`alm-row alm-${st} ${sel === x.id ? 'on' : ''}`} onClick={() => { picked.value = x.id; }}>
              <span class="alm-name">{hidden ? '? ? ?' : x.name}</span>
              <span class="alm-tag">{STATE_TEXT[st]}</span>
            </button>
          );
        })}
      </div>
      <Detail e={e} d={d} level={s?.level.level ?? 1} />
    </aside>
  );
}
