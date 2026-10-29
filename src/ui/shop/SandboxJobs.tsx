import { useEffect, useRef, useState } from 'preact/hooks';
import { setJobKinds, setLevel } from '../../game/store';
import type { Snapshot } from '../../sim/game/game';
import { dexEntry, DEX_GROUPS, taskLevel } from '../../sim/game/jobdex';
import { JOB_CLASSES, levelDef, LEVELS, MAX_LEVEL } from '../../sim/game/levels';

// The sandbox's "Level and jobs" button and panel (docs/SANDBOX.md): pick the rules level and switch single kinds of job on or off for the natural
// arrivals. Sandbox only (Hud.tsx). Styles are in ui.css (the sandbox section). The chip's own popover (SandboxTools.tsx) is unchanged.

/** Every kind of job a group lists that can arrive (the planned ones cannot). */
const groupIds = (ids: readonly string[]) => ids.filter((id) => { const e = dexEntry(id); return e && !e.planned; });

/** The arrival mix of a level as "cli 100%, scan 20% ...", for the line under the level grid. */
function mixLine(level: number): string {
  const mix = levelDef(level).mix;
  const shares = JOB_CLASSES.map((c) => [c.id, mix[c.id] ?? 0] as const).filter(([, v]) => v > 0);
  const total = shares.reduce((n, [, v]) => n + v, 0) || 1;
  return shares.map(([id, v]) => `${id} ${Math.round((100 * v) / total)}%`).join(', ');
}

export function SandboxJobs({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const level = s.level.level, off = s.level.kindsOff, classesOff = s.level.classesOff;
  const all = DEX_GROUPS.flatMap((g) => groupIds(g.ids));

  // Escape closes the panel (and returns focus to its button). Registered while it is open only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /** Switch the kinds in `ids` on or off, keeping every other choice. */
  const set = (ids: readonly string[], on: boolean) => {
    const rest = off.filter((id) => !ids.includes(id));
    setJobKinds(on ? rest : [...rest, ...ids]);
  };

  return (
    <div class="sbx">
      <button
        ref={btn} class={`sbx-chip sbj-btn ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="sbj-panel"
        title="Sandbox: pick the level the rules follow and which kinds of job arrive."
        onClick={() => setOpen(!open)}
      >
        LEVEL {level} · JOBS
      </button>
      {open && (
        <div id="sbj-panel" class="card sbx-pop sbj-pop" role="dialog" aria-label="Sandbox level and jobs">
          <h4>Level</h4>
          <div class="sbj-levels" role="group" aria-label="Rules level">
            {LEVELS.slice(0, MAX_LEVEL).map((l) => (
              <button key={l.level} class={l.level === level ? 'on' : ''} aria-pressed={l.level === level} title={`${l.level}: ${l.name}`} onClick={() => setLevel(l.level)}>{l.level}</button>
            ))}
          </div>
          <div class="sbx-msg"><b>{levelDef(level).name}</b>. Arrivals: {mixLine(level)}.</div>
          <h4>Kinds of job</h4>
          <div class="sbx-row">
            <button onClick={() => set(all, true)} title="Let every kind of job arrive again">All on</button>
            <button onClick={() => set(all, false)} title="Stop every kind of job: nothing arrives until you spawn one or switch a kind on">All off</button>
          </div>
          <div class="sbj-groups">
            {DEX_GROUPS.map((g) => {
              const ids = groupIds(g.ids);
              if (!ids.length) return null;
              const onCount = ids.filter((id) => !off.includes(id)).length;
              return (
                <section key={g.id} class="sbj-group" style={{ '--grp': g.color }}>
                  <div class="sbj-head">
                    <span>{g.name} <span class="sbj-count">{onCount}/{ids.length}</span></span>
                    <span>
                      <button onClick={() => set(ids, true)} aria-label={`${g.name}: all on`}>on</button>
                      <button onClick={() => set(ids, false)} aria-label={`${g.name}: all off`}>off</button>
                    </span>
                  </div>
                  {ids.map((id) => {
                    const e = dexEntry(id)!;
                    const atLevel = taskLevel(e) <= level, classOff = classesOff.includes(e.cls);
                    const why = !atLevel ? `Starts arriving at level ${taskLevel(e)}. Raise the level, or spawn one by hand.`
                      : classOff ? `Its class (${e.cls}) is switched off in the sandbox tools.` : undefined;
                    return (
                      <label key={id} class={why ? 'dim' : ''} title={why ?? e.blurb}>
                        <input type="checkbox" checked={!off.includes(id)} onChange={(ev) => set([id], ev.currentTarget.checked)} />
                        {e.name}
                        {!atLevel && <span class="sbj-lvl">L{taskLevel(e)}</span>}
                      </label>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <div class="sbx-msg">A kind arrives when its class is on, the level has reached it and it is on here.</div>
        </div>
      )}
    </div>
  );
}
