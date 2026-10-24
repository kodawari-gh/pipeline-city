import { useEffect, useState } from 'preact/hooks';
import { declineJob, declineKey, snapshot } from '../game/store';
import { Icon } from './Icons';
import { DECLINE_ARM_MS, declineStep, declineWords, deadlineInfo, needChips, type JobView } from './levelui';
import { fmtTicks } from './logic';

// Job needs, the deadline of an unrunnable job and the Decline button (docs/PROGRESSION.md "Declining"). Used by the key
// card and by the OS queue rows. Styles are in ui.css (the Jobs section).

/** Device icons for what the job needs; the ones the machine lacks are red. Nothing for a plain job. */
export function NeedChips({ job }: { job: JobView }) {
  const chips = needChips(job);
  if (!chips.length) return null;
  return (
    <span class="needs" role="list" aria-label="This job needs">
      {chips.map((c) => (
        <span role="listitem" key={c.short} class={`chip need-chip ${c.missing ? 'bad' : 'ok'}`}
          title={c.missing ? `Missing: this job needs ${c.long} and the machine has none that works.` : `Needs ${c.long}: the machine has it.`}>
          <Icon name={c.icon} size={11} /> {c.short}{c.missing && <span class="miss"> missing</span>}
        </span>
      ))}
    </span>
  );
}

/** The time left before the client takes an unrunnable job back: a thin bar and the time, red near the end. */
export function Deadline({ job }: { job: JobView }) {
  const now = snapshot.value?.baseTick ?? 0;
  const d = deadlineInfo(job, now);
  if (!d) return null;
  return (
    <span class={`deadline ${d.urgency}`} title={`The client takes this job back in ${fmtTicks(d.left)}. A missed job costs reputation.`}>
      <span class="dl-bar" aria-hidden="true"><i style={{ width: `${d.frac * 100}%` }} /></span>
      <span class="dl-t"><Icon name="clock" size={10} /> {fmtTicks(d.left)}</span>
    </span>
  );
}

/**
 * Decline: the first press arms (the button says what it costs), a second within 3 seconds declines. `via` picks the store
 * action: a tray key, or a job in the OS queue (which is keyed by its key id). Free in the sandbox.
 */
export function DeclineButton({ job, via, compact }: { job: JobView; via: 'key' | 'job'; compact?: boolean }) {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  useEffect(() => {
    if (armedAt === null) return;
    const t = setTimeout(() => setArmedAt(null), DECLINE_ARM_MS);
    return () => clearTimeout(t);
  }, [armedAt]);
  if (!job.declinable) return null;
  const sandbox = !!snapshot.value?.sandbox;
  const armed = armedAt !== null;
  const w = declineWords(sandbox, armed);
  const press = (e: Event) => {
    e.stopPropagation();
    if (declineStep(armedAt, Date.now()) === 'confirm') {
      setArmedAt(null);
      (via === 'key' ? declineKey : declineJob)(job.id);
    } else setArmedAt(Date.now());
  };
  return (
    <button class={`decline ${armed ? 'armed' : ''} ${compact ? 'compact' : ''}`} title={w.title} aria-label={`${w.label}: ${job.label}`} onClick={press}>
      <Icon name={armed ? 'warn' : 'close'} size={11} /> {w.label}
    </button>
  );
}
