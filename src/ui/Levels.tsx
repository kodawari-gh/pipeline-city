import { useEffect, useRef } from 'preact/hooks';
import type { Snapshot } from '../sim/game/game';
import { Icon } from './Icons';
import { hasArt, levelBar, milestoneRows, type MilestoneRow, type MilestoneUnlock } from './levelui';
import { fmtNum } from './logic';
import { PartArt } from './PartArt';
import { closeMilestones, milestones, openMilestones } from './state';

/**
 * The HUD level bar: level number and name, a thin progress bar to the next threshold and the client base as a fraction.
 * Hover explains "client base" in plain words; a click opens the milestone screen. In the sandbox it is a chip
 * ("rules level N") because the sandbox pins the rules level and has no progress.
 */
export function LevelBar({ s }: { s: Snapshot }) {
  const m = levelBar(s);
  if (m.sandbox) {
    return (
      <button class="lvl-chip" title={m.tooltip} aria-label={`Rules level ${m.level}, ${m.name}. Open the levels`} onClick={() => openMilestones()}>
        {m.label}
      </button>
    );
  }
  return (
    <button class={`lvl ${m.atMax ? 'max' : ''}`} title={m.tooltip} aria-label={`Level ${m.level}, ${m.name}. Client base ${m.label}. Open the levels`} onClick={() => openMilestones()}>
      <span class="lvl-n">{m.level}</span>
      <span class="lvl-name">{m.name}</span>
      <span class="lvl-bar" aria-hidden="true"><i style={{ width: `${m.pct}%` }} /></span>
      <span class="lvl-num">{m.label}{m.atMax ? ' +' : ''}</span>
    </button>
  );
}

/** One unlocked (or coming) item: its illustration, or its kind's icon when it has no art yet, and its name. */
export function UnlockChip({ u, small }: { u: MilestoneUnlock; small?: boolean }) {
  const art = hasArt(u.id, u.kind, u.planned);
  return (
    <span class={`ut ${small ? 'small' : ''} ${u.planned ? 'planned' : ''}`} title={u.planned ? `${u.name}: planned, not in the game yet` : u.name}>
      <span class="ut-art">{art ? <PartArt id={u.id} size={small ? 30 : 48} /> : <Icon name={u.icon} size={small ? 14 : 22} />}</span>
      <span class="ut-name">{u.name.split(' (')[0]}</span>
    </span>
  );
}

function Row({ r }: { r: MilestoneRow }) {
  const pay = r.pay === 'bigger';
  const strict = r.patience === 'stricter';
  return (
    <li class={`ms-row ${r.status}`} data-level={r.level} aria-current={r.status === 'current' ? 'step' : undefined}>
      <div class="ms-badge" aria-hidden="true">{r.status === 'passed' ? <Icon name="check" size={13} /> : r.level}</div>
      <div class="ms-main">
        <div class="ms-head">
          <b class="ms-name">{r.name}</b>
          <span class="ms-thr" title="Client base needed for this level">{r.threshold === 0 ? 'start' : `${r.threshold} clients`}</span>
          <span class="ms-sr">{r.status === 'passed' ? 'Reached' : r.status === 'current' ? 'You are here' : 'Not reached yet'}</span>
        </div>
        {r.status === 'current' && <div class="ms-prog" aria-hidden="true"><i style={{ width: `${r.progress * 100}%` }} /></div>}
        <div class="ms-chips">
          <span class="chip" title={`Clients wait about ${r.waitS} s${strict ? ': less patient than the level before' : ''}.`}>
            <Icon name="clock" size={11} /> {r.waitS} s{strict && <span class="ms-arrow down" aria-label="stricter">&#9660;</span>}
          </span>
          <span class="chip" title={`Payouts x${fmtNum(r.payMul, 2)}${pay ? ': bigger than the level before' : ''}.`}>
            <Icon name="dollar" size={11} /> x{fmtNum(r.payMul, 2)}{pay && <span class="ms-arrow up" aria-label="bigger">&#9650;</span>}
          </span>
          {r.newJobs.map((j) => (
            <span class="chip" key={j.id} title={`New clients: ${j.hint}`}><Icon name={j.icon} size={11} /> {j.label}</span>
          ))}
        </div>
        {r.unlocks.length > 0 && (
          <div class="ms-unl" role="list" aria-label={`Unlocks at level ${r.level}`}>
            {r.unlocks.map((u) => <span role="listitem" key={u.id}><UnlockChip u={u} /></span>)}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The milestone screen: a centred modal with every level as a card. Reached levels are dimmed with a check, the current one
 * is highlighted with its progress, the coming ones show what they unlock. Escape and the backdrop close it; Tab stays inside.
 */
function MilestoneModal({ s, focus }: { s: Snapshot; focus: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const rows = milestoneRows(s);
  const target = focus ?? s.level.level;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button.close')?.focus();
    const row = list.current?.querySelector<HTMLElement>(`[data-level="${target}"]`);
    // Show the target level near the top, with the level before it peeking in.
    if (row && list.current) list.current.scrollTop = Math.max(0, row.offsetTop - list.current.offsetTop - row.offsetHeight * 0.6);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMilestones(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !box.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !box.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [target]);
  return (
    <div class="modal-back ms-back" onClick={(e) => { if (e.target === e.currentTarget) closeMilestones(); }}>
      <div ref={box} class="card ms" role="dialog" aria-modal="true" aria-labelledby="ms-title">
        <header class="ms-top">
          <div>
            <h2 id="ms-title">Levels</h2>
            <div class="mute ms-sub">
              {s.level.sandbox
                ? `Sandbox: everything is unlocked. The rules are pinned at level ${s.level.level}.`
                : 'Serve clients to grow your client base. Each level unlocks parts and brings new kinds of work.'}
            </div>
          </div>
          <button class="close" aria-label="Close levels" title="Close (Esc)" onClick={closeMilestones}><Icon name="close" size={12} /></button>
        </header>
        <ol class="ms-list" ref={list} tabIndex={0} aria-label="All levels">
          {rows.map((r) => <Row key={r.level} r={r} />)}
        </ol>
        <div class="ms-foot mute">Later levels are stricter: clients wait less, and pay more.</div>
      </div>
    </div>
  );
}

export function MilestoneScreen({ s }: { s: Snapshot }) {
  const m = milestones.value;
  if (!m) return null;
  return <MilestoneModal s={s} focus={m.focus} />;
}
