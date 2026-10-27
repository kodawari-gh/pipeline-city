// The Almanac: every kind of job as a card that fills in as the player meets it (docs/JOBS.md). Unseen jobs are silhouettes that say when they arrive;
// a job that has come in shows what it is, what it needs and its assembly; one that has been finished teaches how to do it better, shows the same job
// in C++ and Python, and keeps the player's record. A sandbox game has everything open.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { snapshot } from '../game/store';
import { dexEntry, dexNeeds, JOB_DEX, type DexEntry, type DexSnap } from '../sim/game/jobdex';
import { CODE_SOURCE, HIGH_LEVEL, mixShares, OP_CLASSES, OP_CLASS_NAME, profileOf, reliance, type CodeLine, type CodeProfile, type OpClass } from '../sim/game/jobcode';
import { highlightLines, type Lang, type Tok } from './highlight';
import { Icon } from './Icons';
import { netOpen, statsOpen } from './state';

export const almanacOpen = signal(false);
export const toggleAlmanac = () => {
  almanacOpen.value = !almanacOpen.value;
  if (almanacOpen.value) { statsOpen.value = false; netOpen.value = false; }
};
const picked = signal<string | null>(null);
type Tab = 'about' | 'asm' | 'cpp' | 'python';
const tab = signal<Tab>('about');
const asmView = signal<'listing' | 'source'>('listing');
const scaleOf = signal<Record<string, number>>({});

const STATE_TEXT = { unseen: 'not met', seen: 'met', done: 'done', planned: 'planned' } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');

/** Pieces of code as coloured spans; an instruction carries its class so a mnemonic reads as arithmetic, load, store, multiply or branch at a glance. */
function Code({ toks }: { toks: Tok[] }) {
  return <>{toks.map((t, i) => <span key={i} class={`tk tk-${t.k}${t.cls ? ` op-${t.cls}` : ''}`}>{t.t}</span>)}</>;
}

function Locked({ children }: { children: ComponentChildren }) {
  return <p class="mute alm-lock"><Icon name="lock" size={12} /> {children}</p>;
}

/** Where the work goes: a bar of what the program executed by class, and how much it leans on compute, memory and control. */
function MixPanel({ p }: { p: CodeProfile }) {
  const sh = mixShares(p), rel = reliance(p);
  return (
    <div class="alm-mix">
      <div class="alm-bar" role="img" aria-label="Instructions executed by kind">
        {OP_CLASSES.filter((c) => p.mix[c] > 0).map((c) => <span key={c} class={`seg bg-${c}`} style={{ width: `${Math.max(0.5, sh[c] * 100)}%` }} title={`${OP_CLASS_NAME[c]}: ${p.mix[c]} (${pct(sh[c])})`} />)}
      </div>
      <div class="alm-legend">
        {OP_CLASSES.filter((c) => p.mix[c] > 0).map((c) => <span key={c}><i class={`dot bg-${c}`} /> {OP_CLASS_NAME[c]} {pct(sh[c])}</span>)}
      </div>
      <div class="alm-rely">
        {([['Compute', rel.compute, 'the ALU and multiplier: CPU clock, width, multiplier'], ['Memory', rel.memory, 'loads and stores: caches, RAM latency and banks'], ['Control', rel.control, 'branches and jumps: the predictor and the redirect penalty']] as const).map(([name, v, hint]) => (
          <div key={name} class="row" title={hint}><span class="n">{name}</span><span class="b"><i style={{ width: pct(v) }} /></span><span class="v">{pct(v)}</span></div>
        ))}
      </div>
      <div class="alm-chips">
        <span>{p.steps} instructions run</span>
        <span>{p.codeWords} words of code</span>
        <span>{p.dataWords} of data</span>
        <span>{p.pages} pages touched</span>
        <span>{p.bytesMoved} bytes moved ({rel.bytesPerInstr.toFixed(2)} per instruction)</span>
        {p.branches > 0 && <span>{pct(p.taken / p.branches)} of branches taken</span>}
      </div>
    </div>
  );
}

/** The listing: each word of the program with its address, bytes, the instruction coloured by what it does, and how often it ran. */
function Listing({ p }: { p: CodeProfile }) {
  let lastExec = -1;
  p.lines.forEach((l, i) => { if (l.count > 0) lastExec = i; });
  const code = p.lines.slice(0, lastExec + 1), data = p.lines.slice(lastExec + 1);
  const max = Math.max(1, ...code.map((l) => l.count)), lg = Math.log(max + 1);
  const toks = highlightLines('asm', code.map((l) => l.text).join('\n'));
  const row = (l: CodeLine, i: number) => (
    <div key={l.addr} class={`ln${l.count === 0 ? ' cold' : ''}`}>
      {l.labels.filter((n) => !/^k\d+_.*_(loop|done)$/.test(n)).slice(0, 2).map((n) => <div key={n} class="lbl">{n}:</div>)}
      <div class="ins">
        <span class="ad">{hex(l.addr, 4)}</span>
        <span class="wd">{hex(l.word, 8)}</span>
        <span class="tx"><Code toks={toks[i]!} /></span>
        <span class="hc" title={`${l.count} times`}><i class={`bg-${l.cls as OpClass}`} style={{ width: `${l.count ? Math.max(6, (Math.log(l.count + 1) / lg) * 100) : 0}%` }} /></span>
        <span class="ct">{l.count || ''}</span>
      </div>
    </div>
  );
  return (
    <div class="alm-code alm-listing" aria-label="Disassembly">
      {code.map(row)}
      {data.length > 0 && <div class="mute alm-data">{data.length} words of data follow (the program's constants and tables)</div>}
    </div>
  );
}

function Source({ lang, text }: { lang: Lang; text: string }) {
  const lines = highlightLines(lang, text);
  return (
    <div class="alm-code alm-source">
      {lines.map((t, i) => <div key={i} class="sl"><span class="no">{i + 1}</span><span class="tx"><Code toks={t} /></span></div>)}
    </div>
  );
}

function CodeTabs({ e, rank, open }: { e: DexEntry; rank: number; open: boolean }) {
  const src = CODE_SOURCE[e.id];
  if (!src) return null;
  const t = tab.value;
  const scales = src.scales, scale = scaleOf.value[e.id] ?? scales[0]!;
  const canAsm = open || rank >= 1, canHigh = open || rank >= 2;
  const btn = (id: Tab, label: string, ok: boolean) => (
    <button key={id} role="tab" aria-selected={t === id} class={`${t === id ? 'on' : ''}${ok ? '' : ' off'}`} disabled={!ok} title={ok ? '' : id === 'asm' ? 'Meet this job to read its assembly' : 'Finish one of these jobs to read it in C++ and Python'} onClick={() => { tab.value = id; }}>
      {!ok && <Icon name="lock" size={10} />} {label}
    </button>
  );
  return (
    <>
      <div class="alm-tabs" role="tablist">{btn('about', 'About', true)}{btn('asm', 'Assembly', canAsm)}{btn('cpp', 'C++', canHigh)}{btn('python', 'Python', canHigh)}</div>
      {t === 'asm' && canAsm && (() => {
        const p = profileOf(src.template, scale);
        return (
          <>
            <div class="alm-ctl">
              {scales.length > 1 && <span class="seg" role="group" aria-label="Scale">{scales.map((x) => <button key={x} class={x === scale ? 'on' : ''} title={`Scale ${x}: the same job, bigger`} onClick={() => { scaleOf.value = { ...scaleOf.value, [e.id]: x }; }}>×{x}</button>)}</span>}
              <span class="seg" role="group" aria-label="View">
                <button class={asmView.value === 'listing' ? 'on' : ''} onClick={() => { asmView.value = 'listing'; }} title="Each word of the program, how often it ran">Listing</button>
                <button class={asmView.value === 'source' ? 'on' : ''} onClick={() => { asmView.value = 'source'; }} title="The assembler text with its labels and comments">Source</button>
              </span>
            </div>
            <MixPanel p={p} />
            {asmView.value === 'listing' ? <Listing p={p} /> : <Source lang="asm" text={p.asm} />}
            <div class="mute alm-out">It shows: <code>{p.display.split('\n').pop()}</code></div>
          </>
        );
      })()}
      {t === 'cpp' && canHigh && <><p class="mute alm-note">The same job as a person would write it. The assembly above is what the machine really runs.</p><Source lang="cpp" text={HIGH_LEVEL[e.id]!.cpp} /></>}
      {t === 'python' && canHigh && <><p class="mute alm-note">The same job as a person would write it. The assembly above is what the machine really runs.</p><Source lang="python" text={HIGH_LEVEL[e.id]!.python} /></>}
    </>
  );
}

function Detail({ e, d, level, sandbox }: { e: DexEntry; d: DexSnap; level: number; sandbox: boolean }) {
  const { needs, firstLevel } = dexNeeds(e);
  const state = sandbox && d.state !== 'planned' ? 'done' : d.state;
  if (state === 'unseen') {
    return (
      <div class="alm-detail">
        <h3>? ? ?</h3>
        <p class="mute">A job you have not met yet. {level >= firstLevel ? 'Clients may send one at any time.' : `Clients start sending this kind at level ${firstLevel}.`}</p>
      </div>
    );
  }
  if (state === 'planned') {
    return (
      <div class="alm-detail">
        <h3>{e.name}</h3>
        <p>{e.blurb}</p>
        <p class="mute">Planned: clients do not send this kind of job yet.</p>
      </div>
    );
  }
  const t = tab.value, rank = state === 'done' ? 2 : 1;
  return (
    <div class="alm-detail">
      <h3>{e.name}{sandbox && <span class="mute alm-sb"> sandbox: all open</span>}</h3>
      <CodeTabs e={e} rank={rank} open={sandbox} />
      {t === 'about' && (
        <>
          <p>{e.blurb}</p>
          <div class="alm-facts">
            <div><span class="mute">Leans on</span> {e.stresses.join(', ')}</div>
            <div><span class="mute">Memory</span> {e.footprint}</div>
            <div><span class="mute">Needs</span> {needs.length ? needs.join(', ') : 'nothing special'}</div>
            <div><span class="mute">Arrives from</span> level {firstLevel}</div>
          </div>
          {rank < 2 && !sandbox ? <Locked>Finish one to learn how to do it better, and to read it in C++ and Python.</Locked> : (
            <>
              <h4>How to do it better</h4>
              <ul class="alm-tips">{e.tips.map((x, i) => <li key={i}>{x}</li>)}</ul>
              {!sandbox && <div class="alm-rec">Finished {d.runs} · fastest {d.best} s of machine time</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}

export function AlmanacPanel() {
  if (!almanacOpen.value) return null;
  const s = snapshot.value;
  const sandbox = !!s?.sandbox;
  const dex = s?.dex ?? [];
  const stateOf = (id: string): DexSnap['state'] => { const st = dex.find((y) => y.id === id)?.state ?? 'unseen'; return sandbox && st !== 'planned' ? 'done' : st; };
  const met = JOB_DEX.filter((x) => { const st = stateOf(x.id); return st === 'seen' || st === 'done'; }).length, avail = JOB_DEX.filter((x) => !x.planned).length;
  const sel = picked.value ?? JOB_DEX.find((x) => !x.planned && stateOf(x.id) !== 'unseen')?.id ?? JOB_DEX[0]!.id;
  const e = dexEntry(sel)!, d = dex.find((x) => x.id === sel) ?? { id: sel, state: 'unseen', runs: 0, best: 0, seenTick: 0 } as DexSnap;
  const wide = tab.value !== 'about' && stateOf(sel) !== 'unseen' && stateOf(sel) !== 'planned';
  return (
    <aside class={`dock almanac${wide ? ' wide' : ''}`} aria-label="Almanac">
      <button class="close" aria-label="Close almanac" onClick={toggleAlmanac}><Icon name="close" size={11} /></button>
      <h2>Almanac <span class="mute">{met}/{avail} met</span></h2>
      <div class="alm-list" role="listbox" aria-label="Jobs">
        {JOB_DEX.map((x) => {
          const st = stateOf(x.id);
          return (
            <button key={x.id} role="option" aria-selected={sel === x.id} class={`alm-row alm-${st} ${sel === x.id ? 'on' : ''}`} onClick={() => { picked.value = x.id; if (!CODE_SOURCE[x.id]) tab.value = 'about'; }}>
              <span class="alm-name">{st === 'unseen' ? '? ? ?' : x.name}</span>
              <span class="alm-tag">{STATE_TEXT[st]}</span>
            </button>
          );
        })}
      </div>
      <Detail e={e} d={d} level={s?.level.level ?? 1} sandbox={sandbox} />
    </aside>
  );
}
