// The Almanac: every kind of job as a card in a collection, like a pokedex (docs/JOBS.md). Jobs are grouped into collapsible sections; each has a sprite,
// a picture of its real program, that is a dark silhouette until the job is met. A met job's page puts that program on the main page (its picture,
// what it leans on, its assembly); finishing one opens the C++ and Python and the ways to do it better, as icon chips. A sandbox game has everything open.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { gpuPicture } from '../../sim/gen';
import { frameColor, pictureOf } from '../../render/room/screenmodel';
import { snapshot } from '../../game/store';
import { DEX_GROUPS, dexEntry, dexGroup, JOB_DEX, needChips, dexNeeds, dexNumber, taskLevel, type DexEntry, type DexGroup, type DexSnap } from '../../sim/game/jobdex';
import { CODE_SOURCE, HIGH_LEVEL, mixShares, OP_CLASSES, profileOf, reliance, type CodeLine, type CodeProfile, type OpClass } from '../../sim/game/jobcode';
import { highlightLines, type Lang, type Tok } from '../tutorial/highlight';
import { Icon } from '../kit/Icons';
import { fmtTicks } from '../logic';
import { JobSprite, needIcon, PART_ICON } from '../kit/Sprite';

export const almanacOpen = signal(false);
export const toggleAlmanac = () => { almanacOpen.value = !almanacOpen.value; };
export const closeAlmanac = () => { almanacOpen.value = false; };
const picked = signal<string | null>(null);
type Tab = 'asm' | 'cpp' | 'python';
const tab = signal<Tab>('asm');
/** The assembly view: the listing (addresses, bytes, heat) or the assembler text. */
const asmText = signal(false);
const scaleOf = signal<Record<string, number>>({});
/** Groups the player has collapsed (the ones still to come start collapsed). */
const shut = signal<Record<string, boolean>>({ soon: true });
const tipOpen = signal<string | null>(null);
/** Open the almanac on a kind of job (the job log links here); a kind the almanac does not know opens it as it is. */
export const openAlmanacFor = (id: string) => {
  if (dexEntry(id)) { picked.value = id; tab.value = 'asm'; tipOpen.value = null; const g = dexGroup(id); if (g) shut.value = { ...shut.value, [g.id]: false }; }
  almanacOpen.value = true;
};

type State = DexSnap['state'];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
const MIX_NAME: Record<OpClass, string> = { alu: 'Arithmetic', ld: 'Load', st: 'Store', mul: 'Multiply', br: 'Branch', sys: 'System' };

/** Pieces of code as coloured spans; an instruction carries its class so a mnemonic reads as arithmetic, load, store, multiply or branch at a glance. */
function Code({ toks }: { toks: Tok[] }) {
  return <>{toks.map((t, i) => <span key={i} class={`tk tk-${t.k}${t.cls ? ` op-${t.cls}` : ''}`}>{t.t}</span>)}</>;
}

/** A ring with a percentage in the middle: how much of the job's work is of one kind. */
function Ring({ value, color, icon, label, title }: { value: number; color: string; icon: 'cpu' | 'memory' | 'gauge'; label: string; title: string }) {
  const r = 15.9, c = 2 * Math.PI * r;
  return (
    <div class="dx-ring" title={title}>
      <svg viewBox="0 0 36 36" role="img" aria-label={`${label} ${pct(value)}`}>
        <circle class="trk" cx="18" cy="18" r={r} />
        <circle class="arc" cx="18" cy="18" r={r} stroke={color} stroke-dasharray={`${Math.max(0.5, value * c)} ${c}`} transform="rotate(-90 18 18)" />
      </svg>
      <b>{Math.round(value * 100)}<small>%</small></b>
      <span class="lb" style={{ color }}><Icon name={icon} size={11} /> {label}</span>
    </div>
  );
}

/** What the job leans on, from the instructions it ran (compute, memory, control) and its mix as one coloured bar. */
function Leans({ e, p }: { e: DexEntry; p: CodeProfile }) {
  const sh = mixShares(p), rel = reliance(p);
  const scales = CODE_SOURCE[e.id]?.scales ?? [], scale = scaleOf.value[e.id] ?? scales[0]!;
  return (
    <div class="dx-leans">
      <div class="dx-metrics">
        <span class="dx-nums" title="Instructions run, 256-byte pages touched, bytes moved per instruction"><Icon name="clock" size={11} /> {p.steps.toLocaleString('en-US')} <Icon name="box" size={11} /> {p.pages} <Icon name="memory" size={11} /> {rel.bytesPerInstr.toFixed(1)}B</span>
        {scales.length > 1 && (
          <span class="dx-scale" title="The same job, bigger: the numbers and the program below change with it">
            Scale <span class="seg" role="group" aria-label="Scale">{scales.map((x) => <button key={x} class={x === scale ? 'on' : ''} onClick={() => { scaleOf.value = { ...scaleOf.value, [e.id]: x }; }}>x{x}</button>)}</span>
          </span>
        )}
      </div>
      <div class="rings">
        <Ring value={rel.compute} color="#3aa8d9" icon="cpu" label="Compute" title="The ALU and multiplier: CPU clock, width, multiplier" />
        <Ring value={rel.memory} color="#d9a23a" icon="memory" label="Memory" title="Loads and stores: caches, RAM latency and banks" />
        <Ring value={rel.control} color="#d96ad6" icon="gauge" label="Control" title="Branches and jumps: the predictor and the redirect penalty" />
      </div>
      <div class="alm-bar" role="img" aria-label="Instructions executed by kind">
        {OP_CLASSES.filter((c) => p.mix[c] > 0).map((c) => <span key={c} class={`seg bg-${c}`} style={{ width: `${Math.max(0.5, sh[c] * 100)}%` }} title={`${MIX_NAME[c]}: ${p.mix[c]} (${pct(sh[c])})`} />)}
      </div>
      <div class="alm-legend">{OP_CLASSES.filter((c) => p.mix[c] > 0).map((c) => <span key={c}><i class={`dot bg-${c}`} /> {MIX_NAME[c]}</span>)}</div>
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
      {data.length > 0 && <div class="mute alm-data">+ {data.length} words of data</div>}
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

/** The program on the main page, in a window of its own: a toggle for the language (assembly, C++, Python) in its title bar, and for assembly the listing or the assembler text. */
function CodePanel({ e, rank, open }: { e: DexEntry; rank: number; open: boolean }) {
  const src = CODE_SOURCE[e.id];
  if (!src) return null;
  const t = tab.value, scale = scaleOf.value[e.id] ?? src.scales[0]!;
  const canAsm = open || rank >= 1, canHigh = open || rank >= 2;
  const btn = (id: Tab, label: string, ok: boolean) => (
    <button key={id} role="tab" aria-selected={t === id} class={`${t === id ? 'on' : ''}${ok ? '' : ' off'}`} disabled={!ok} title={ok ? '' : id === 'asm' ? 'Meet this job to read its assembly' : 'Finish one of these jobs to read it in C++ and Python'} onClick={() => { tab.value = id; }}>
      {!ok && <Icon name="lock" size={10} />} {label}
    </button>
  );
  const p = canAsm ? profileOf(src.template, scale) : null;
  return (
    <div class="dx-code">
      <div class="dx-codebar">
        <span class="dx-win"><Icon name="cpu" size={12} /> Code</span>
        <span class="seg" role="tablist" aria-label="Language">{btn('asm', 'ASM', canAsm)}{btn('cpp', 'C++', canHigh)}{btn('python', 'Python', canHigh)}</span>
        {t === 'asm' && canAsm && (
          <span class="seg dx-view" role="group" aria-label="Assembly view">
            <button class={asmText.value ? '' : 'on'} title="Each word of the program with its bytes and how often it ran" onClick={() => { asmText.value = false; }}>Listing</button>
            <button class={asmText.value ? 'on' : ''} title="The assembler text with its labels and comments" onClick={() => { asmText.value = true; }}>Text</button>
          </span>
        )}
      </div>
      {t === 'asm' && p && (asmText.value ? <Source lang="asm" text={p.asm} /> : <Listing p={p} />)}
      {t === 'cpp' && canHigh && <Source lang="cpp" text={HIGH_LEVEL[e.id]!.cpp} />}
      {t === 'python' && canHigh && <Source lang="python" text={HIGH_LEVEL[e.id]!.python} />}
      {((t === 'asm' && !canAsm) || (t !== 'asm' && !canHigh)) && <div class="dx-lock"><Icon name="lock" size={22} /></div>}
    </div>
  );
}

/** The ways to do the job better as chips with an icon for the part of the machine; a click opens the sentence. A part that does not help is crossed out. */
function Tips({ e, locked }: { e: DexEntry; locked: boolean }) {
  if (e.tips.length === 0) return null;
  const openId = tipOpen.value, cur = e.tips.find((x) => `${e.id}:${x.short}` === openId);
  return (
    <div class="dx-tips">
      <div class="dx-tiphead"><Icon name="bolt" size={12} /> Do it better {locked && <span class="mute"><Icon name="lock" size={10} /> finish one</span>}</div>
      <div class="chips">
        {e.tips.map((x) => {
          const id = `${e.id}:${x.short}`;
          return locked
            ? <span key={id} class="dx-tip lock"><Icon name="lock" size={11} /> ? ? ?</span>
            : <button key={id} class={`dx-tip${x.none ? ' none' : ''}${openId === id ? ' on' : ''}`} aria-expanded={openId === id} onClick={() => { tipOpen.value = openId === id ? null : id; }}><Icon name={PART_ICON[x.part]} size={12} /> {x.short}</button>;
        })}
      </div>
      {cur && !locked && <p class="dx-tiptext">{cur.text}</p>}
    </div>
  );
}

function Hero({ e, g, state, d, level, sandbox, p }: { e: DexEntry; g: DexGroup | undefined; state: State; d: DexSnap; level: number; sandbox: boolean; p: CodeProfile | null }) {
  const { firstLevel } = dexNeeds(e), chips = needChips(e);
  const hidden = state === 'unseen' || state === 'planned';
  const no = String(dexNumber(e.id)).padStart(2, '0');
  return (
    <div class="dx-hero">
      <div class="dx-pic">
        <JobSprite id={e.id} silhouette={hidden} />
        <span class="no">No. {no}</span>
      </div>
      <div class="dx-info">
        <div class="dx-title">
          <h2>{state === 'unseen' ? '? ? ?' : e.name}</h2>
          {g && <span class="dx-gchip"><i class="dot" style={{ background: g.color }} /> {g.name}</span>}
        </div>
        {state === 'unseen' && <p class="dx-blurb mute">{level >= firstLevel ? 'Clients may send one at any time.' : `Clients start sending this at level ${firstLevel}.`}</p>}
        {state === 'planned' && <p class="dx-blurb mute">{e.blurb} <b>Coming soon.</b></p>}
        {!hidden && <p class="dx-blurb">{e.blurb}</p>}
        {!hidden && p && <Leans e={e} p={p} />}
        <div class="dx-needs">
          <span class={`dx-need ${level >= firstLevel ? 'ok' : 'lv'}`} title={level >= firstLevel ? `Level ${firstLevel}: clients can send this now` : `Locked until level ${firstLevel}: clients start sending this kind of job then`}><Icon name={level >= firstLevel ? 'check' : 'lock'} size={11} /> Lv {firstLevel}</span>
          {chips.length === 0 ? <span class="dx-need ok" title="Needs nothing special"><Icon name="check" size={11} /> any machine</span> : chips.map((n) => <span key={n.kind + n.short} class="dx-need" title={`Needs ${n.long}`}><Icon name={needIcon(n.kind)} size={11} /> {n.short}</span>)}
          {e.boost && <span class="dx-need boost" title={`Not needed, but it helps: ${e.boost}`}><Icon name="card" size={11} /> {e.boost}</span>}
          {!hidden && <span class="dx-need foot" title="The memory the job keeps"><Icon name="memory" size={11} /> {e.footprint}</span>}
        </div>
        {state === 'done' && !sandbox && (
          <div class="dx-record" title="Jobs finished and your fastest run">
            <span class="stars">{Array.from({ length: Math.min(5, d.runs) }, (_, i) => <Icon key={i} name="star" size={14} />)}</span> x{d.runs} <Icon name="clock" size={12} /> {fmtTicks(d.best)}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the job leaves on a graphics display: its output words as the display shows them, one cell per word, on the same heat scale. Only for a job a GPU draws. */
function Preview({ e }: { e: DexEntry }) {
  const src = CODE_SOURCE[e.id];
  const scale = scaleOf.value[e.id] ?? src?.scales[0] ?? 1;
  const pics = src ? gpuPicture(src.template, 7, scale) : null;
  const ref = useRef<HTMLCanvasElement>(null);
  const [k, setK] = useState(0);
  const n = pics?.length ?? 1;
  // an animation plays in a loop, as the display shows the card's frames one after the other
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setK((x) => (x + 1) % n), 150);
    return () => clearInterval(t);
  }, [n]);
  const m = pics ? pictureOf(pics[k % n]!) : null;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !m) return;
    cv.width = m.cols; cv.height = m.rows;
    const c = cv.getContext('2d');
    if (!c) return;
    const img = c.createImageData(m.cols, m.rows);
    m.cells.forEach((v, i) => {
      const hex = frameColor(v);
      img.data[i * 4] = parseInt(hex.slice(1, 3), 16); img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16); img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16); img.data[i * 4 + 3] = 255;
    });
    c.putImageData(img, 0, 0);
  });
  if (!m) return null;
  return (
    <div class="dx-code dx-preview">
      <div class="dx-codebar"><span class="dx-win"><Icon name="screen" size={12} /> Output</span><span class="mute">{m.cols} x {m.rows} on a graphics display{n > 1 ? `, ${n} frames` : ''}</span></div>
      <canvas ref={ref} class="dx-shot" style={{ aspectRatio: `${m.cols} / ${m.rows}` }} role="img" aria-label="The picture this job draws" />
    </div>
  );
}

function Page({ e, state, d, level, sandbox }: { e: DexEntry; state: State; d: DexSnap; level: number; sandbox: boolean }) {
  const g = dexGroup(e.id), rank = state === 'done' ? 2 : state === 'seen' ? 1 : 0;
  const src = CODE_SOURCE[e.id];
  const p = src && (sandbox || rank >= 1) ? profileOf(src.template, scaleOf.value[e.id] ?? src.scales[0]!) : null;
  return (
    <div class="dx-page" style={{ '--g': g?.color ?? '#8893b0' }}>
      <Hero e={e} g={g} state={state} d={d} level={level} sandbox={sandbox} p={p} />
      {e.cls === 'gpu' && state !== 'planned' && state !== 'unseen' && <Preview e={e} />}
      {state !== 'planned' && state !== 'unseen' && <CodePanel e={e} rank={rank} open={sandbox} />}
      {state === 'unseen' && src && <CodePanel e={e} rank={0} open={false} />}
      {state !== 'planned' && <Tips e={e} locked={rank < 2 && !sandbox} />}
    </div>
  );
}

/** What a kind of job is locked behind, small: the hardware it needs (an icon each) and the level clients start sending it. */
function Locks({ e, level }: { e: DexEntry; level: number }) {
  const lv = taskLevel(e), chips = needChips(e);
  return (
    <span class="lk">
      {chips.map((n) => <span key={n.kind + n.short} class="nd" title={`Needs ${n.long}`}><Icon name={needIcon(n.kind)} size={10} /></span>)}
      <span class={`lv${level < lv ? ' hi' : ''}`} title={level < lv ? `Locked until level ${lv}` : `Clients send this from level ${lv}`}>L{lv}</span>
    </span>
  );
}

function Tile({ e, state, on, no, level }: { e: DexEntry; state: State; on: boolean; no: number; level: number }) {
  const hidden = state === 'unseen' || state === 'planned';
  return (
    <button role="option" aria-selected={on} class={`dx-tile st-${state}${on ? ' on' : ''}`} title={hidden ? (state === 'planned' ? e.name : 'Not met yet') : e.name} onClick={() => { picked.value = e.id; tipOpen.value = null; }}>
      <span class="no">{String(no).padStart(2, '0')}</span>
      <span class="nm">{state === 'unseen' ? '? ? ?' : e.name}</span>
      {!e.planned && <Locks e={e} level={level} />}
      {state === 'done' && <span class="bdg gold" aria-label="Finished"><Icon name="star" size={10} /></span>}
      {state === 'seen' && <span class="bdg" aria-label="Met"><Icon name="check" size={10} /></span>}
      {(state === 'unseen' || state === 'planned') && <span class="bdg" aria-label="Locked"><Icon name="lock" size={10} /></span>}
    </button>
  );
}

function Group({ g, stateOf, sel, level }: { g: DexGroup; stateOf: (id: string) => State; sel: string; level: number }) {
  const closed = !!shut.value[g.id];
  const items = g.ids.map((id) => dexEntry(id)!).filter(Boolean);
  const got = items.filter((x) => { const s = stateOf(x.id); return s === 'seen' || s === 'done'; }).length;
  return (
    <section class={`dx-group${closed ? ' shut' : ''}`} style={{ '--g': g.color }}>
      <button class="dx-ghead" aria-expanded={!closed} onClick={() => { shut.value = { ...shut.value, [g.id]: !closed }; }}>
        <span class="chev" aria-hidden="true">›</span>
        <span class="gn">{g.name}</span>
        <span class="pips" aria-label={`${got} of ${items.length} met`}>{items.map((x) => { const s = stateOf(x.id); return <i key={x.id} class={s === 'done' ? 'full' : s === 'seen' ? 'half' : ''} />; })}</span>
        <span class="cnt">{got}/{items.length}</span>
      </button>
      {!closed && <div class="dx-grid">{items.map((x) => <Tile key={x.id} e={x} state={stateOf(x.id)} on={sel === x.id} no={dexNumber(x.id)} level={level} />)}</div>}
    </section>
  );
}

export function AlmanacPanel() {
  const open = almanacOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAlmanac(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const s = snapshot.value;
  const sandbox = !!s?.sandbox;
  const dex = s?.dex ?? [];
  const stateOf = (id: string): State => { const st = dex.find((y) => y.id === id)?.state ?? 'unseen'; return sandbox && st !== 'planned' ? 'done' : st; };
  const playable = JOB_DEX.filter((x) => !x.planned);
  const met = playable.filter((x) => { const st = stateOf(x.id); return st === 'seen' || st === 'done'; }).length;
  const sel = picked.value ?? playable.find((x) => stateOf(x.id) !== 'unseen')?.id ?? JOB_DEX[0]!.id;
  const e = dexEntry(sel)!, d = dex.find((x) => x.id === sel) ?? { id: sel, state: 'unseen', runs: 0, best: 0, seenTick: 0 } as DexSnap;
  return (
    <div class="modal-back almanac-back" onClick={(ev) => { if (ev.target === ev.currentTarget) closeAlmanac(); }}>
      <div class="card almanac" role="dialog" aria-modal="true" aria-label="Almanac">
        <header class="alm-head">
          <span class="alm-title"><Icon name="layers" size={16} /> Almanac</span>
          <span class="dx-prog" title={`${met} of ${playable.length} kinds of job met`}>
            <span class="bar"><i style={{ width: pct(met / Math.max(1, playable.length)) }} /></span> {met}/{playable.length}
          </span>
          {sandbox && <span class="chip">sandbox: all open</span>}
          <button class="close" aria-label="Close almanac" title="Close (Esc)" onClick={closeAlmanac}><Icon name="close" size={12} /></button>
        </header>
        <div class="alm-body">
          <div class="alm-list" role="listbox" aria-label="Jobs">
            {DEX_GROUPS.map((g) => <Group key={g.id} g={g} stateOf={stateOf} sel={sel} level={s?.level.level ?? 1} />)}
          </div>
          <div class="alm-main"><Page e={e} state={stateOf(sel)} d={d} level={s?.level.level ?? 1} sandbox={sandbox} /></div>
        </div>
      </div>
    </div>
  );
}
