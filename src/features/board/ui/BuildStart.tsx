import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { BUILD_PRESETS, specSheet, type SavedBuild } from '@/features/board/sim/buildspecs';
import { freeName, pips, plural, presetBits } from './buildhud';
import { deleteBuild, saveBuild } from './savedbuilds';

type Stage = import('../render/three/buildmode3d').BuildStage;
type IconKey = Parameters<typeof Icon>[0]['name'];

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** One way to start: from nothing up to everything. `lit` is how many of the five pips it lights. */
interface Start { key: string; icon: IconKey; name: string; note: string; lit: number; title: string; said: string; run: (s: Stage) => unknown }

const PRESET_ICON: Record<string, IconKey> = { Budget: 'dollar', Gaming: 'card', Workstation: 'cpu' };

const STARTS: readonly Start[] = [
  { key: 'empty', icon: 'box', name: 'Empty', note: 'A bare case and board', lit: 0, title: 'Take every part out and start from nothing', said: 'Took every part out', run: (s) => s.clear() },
  ...BUILD_PRESETS.map((p): Start => ({
    key: p.name, icon: PRESET_ICON[p.name] ?? 'layers', name: p.name, note: presetBits(p).join(' · '), lit: pips(p.level * 10, 10),
    title: `Build a ${p.name.toLowerCase()} machine: ${presetBits(p).join(', ')}`, said: `Built the ${p.name} machine`, run: (s) => s.buildPreset(p),
  })),
  { key: 'full', icon: 'star', name: 'Full rig', note: 'Every part the case holds', lit: 5, title: 'Fit every part', said: 'Fitted every part', run: (s) => s.reset() },
];

/** Five pips: how high up the tiers a starting point reaches (none for an empty case). */
function Pips({ lit, label }: { lit: number; label: string }) {
  return <span class="bld-pips" role="img" aria-label={label}>{Array.from({ length: 5 }, (_, i) => <i key={i} class={i < lit ? 'on' : ''} />)}</span>;
}

/**
 * The ways to start, in the right panel: Empty, the ready-made machines (`BUILD_PRESETS`) and the full rig as one list that rises from nothing to
 * everything, then the builds the player saved, then Save. Each one replaces the machine (Undo puts it back, `BuildStage.undo`), so `done` says what
 * was done and the panel folds this away.
 */
export function BuildStart({ stage, saved, setSaved, off, hasParts, done }: {
  stage: Stage | null;
  saved: SavedBuild[];
  setSaved: (s: SavedBuild[]) => void;
  /** Busy or no stage yet: nothing here answers. */
  off: boolean;
  /** Is anything fitted (an empty machine has nothing to save). */
  hasParts: boolean;
  /** The machine was replaced: what was done, in a few words. */
  done: (line: string) => void;
}) {
  // the name being typed for a new saved build (null: not saving), and the saved build whose delete waits for a second press
  const [naming, setNaming] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const saving = naming !== null;
  useEffect(() => { if (saving) { input.current?.focus(); input.current?.select(); } }, [saving]);
  const name = (naming ?? '').trim();

  const go = (line: string, run: () => unknown) => { void Promise.resolve(run()).then(() => done(line)); };
  const submit = (e: Event) => {
    e.preventDefault();
    if (name && stage) { setSaved(saveBuild(name, stage.layout)); setNaming(null); }
  };

  return (
    <section class="bld-start" aria-label="Start from">
      <div class="bld-starts" role="group" aria-label="Ready-made machines">
        {STARTS.map((s) => (
          <button key={s.key} class="bld-srow" disabled={off} title={s.title} onClick={() => go(s.said, () => stage && s.run(stage))}>
            <span class="bld-sico"><Icon name={s.icon} size={14} /></span>
            <span class="bld-smain">
              <span class="bld-sline"><b>{s.name}</b><Pips lit={s.lit} label={s.lit ? `Parts ${Math.round((s.lit / 5) * 100)}% of the way up the tiers` : 'No parts'} /></span>
              <em>{s.note}</em>
            </span>
          </button>
        ))}
      </div>
      {saved.length > 0 && (
        <>
          <span class="bld-sub">Your builds</span>
          <div class="bld-starts" role="group" aria-label="Saved builds">
            {saved.map((b) => {
              const sheet = specSheet({ boardTier: b.layout.boardTier, caseTier: b.layout.caseTier, specs: b.layout.parts.map((p) => p.spec) });
              const askDelete = sure === b.name;
              return (
                <div class="bld-svrow" key={b.name}>
                  <button class="bld-srow" disabled={off} title={`Build ${b.name} again`} onClick={() => go(`Loaded ${b.name}`, () => stage?.loadLayout(b.layout, b.name))}>
                    <span class="bld-sico"><Icon name="save" size={13} /></span>
                    <span class="bld-smain"><b>{b.name}</b><em>{plural(sheet.parts, 'part')} · {money(sheet.budget)}</em></span>
                  </button>
                  <button
                    class={`bld-del ${askDelete ? 'sure' : ''}`} aria-label={`Delete ${b.name}`} title={askDelete ? 'Press again to delete it' : 'Delete this saved build'}
                    onBlur={() => setSure(null)} onClick={() => { if (askDelete) { setSaved(deleteBuild(b.name)); setSure(null); } else setSure(b.name); }}
                  >{askDelete ? 'Delete?' : <Icon name="close" size={10} />}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {saving ? (
        <form class="bld-saveform" onSubmit={submit}>
          <input
            ref={input} value={naming} maxLength={28} aria-label="Name of the build" placeholder="Name this build"
            onInput={(e) => setNaming((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }}
          />
          <button type="submit" disabled={!name} title={saved.some((b) => b.name === name) ? 'A build has this name: it is replaced' : 'Keep this machine under this name'}>{saved.some((b) => b.name === name) ? 'Replace' : 'Save'}</button>
          <button type="button" aria-label="Cancel" title="Cancel" onClick={() => setNaming(null)}><Icon name="close" size={10} /></button>
        </form>
      ) : (
        <button class="bld-save" disabled={off || !hasParts} title={hasParts ? 'Keep this machine under a name' : 'Fit some parts first'} onClick={() => setNaming(freeName(saved.map((b) => b.name)))}>
          <Icon name="save" size={12} />Save this machine…
        </button>
      )}
    </section>
  );
}
