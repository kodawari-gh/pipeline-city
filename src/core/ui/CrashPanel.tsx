// The crash screen: the sim threw and paused itself, so show what it was doing instead of leaving the player to open devtools. The report is built
// in the worker (src/sim/crash.ts); this only shows its headline and facts, and lets the player copy or download it (docs/ARCHITECTURE.md "Crash report").
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { crash, exportCrash, exportCrashSave } from '../../app/store';
import { Icon } from './kit/Icons';

const copied = signal(false);
const showText = signal(false);
const closeCrash = () => { crash.value = null; showText.value = false; copied.value = false; };

async function copyReport(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    showText.value = true; // no clipboard access: show the text so it can be selected by hand
  }
}

export function CrashPanel() {
  const r = crash.value;
  useEffect(() => {
    if (!r) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeCrash(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r]);
  if (!r) return null;
  const core0 = r.cores[0];
  return (
    <div class="modal-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeCrash(); }}>
      <div class="card modal crash" role="alertdialog" aria-modal="true" aria-label="The machine crashed">
        <header class="crash-head">
          <span class="alm-title"><Icon name="warn" size={16} /> The simulation crashed</span>
          <button class="close" aria-label="Close" title="Close (Esc)" onClick={closeCrash}><Icon name="close" size={12} /></button>
        </header>
        <p class="pplain">It is paused so nothing is lost. This is a bug: please copy or download the report and send it.</p>
        <p class="crash-line">{r.headline}</p>
        <div class="chips">
          <span class="chip bad">tick {r.tick}</span>
          <span class="chip">{r.phase}</span>
          {r.os && <span class="chip">{r.os.name}</span>}
          {core0?.pc != null && <span class="chip">pc 0x{(core0.pc >>> 0).toString(16)}</span>}
          {r.cores.length > 1 && <span class="chip">{r.cores.length} cores</span>}
          {r.keys.plugged !== null && <span class="chip">key {r.keys.plugged} plugged</span>}
        </div>
        {showText.value && <pre class="crash-text" tabIndex={0} aria-label="Crash report">{r.text}</pre>}
        <div class="pactions">
          <button onClick={() => { showText.value = !showText.value; }}>{showText.value ? 'Hide details' : 'Show details'}</button>
          <button onClick={() => copyReport(r.text)}>{copied.value ? <><Icon name="check" size={11} /> Copied</> : 'Copy report'}</button>
          <button onClick={() => exportCrash(r)}>Download report</button>
          {r.save && <button onClick={() => exportCrashSave(r)} title="The game as it was when it crashed, as a normal save file">Download save</button>}
          <button onClick={closeCrash}>Close</button>
        </div>
      </div>
    </div>
  );
}
