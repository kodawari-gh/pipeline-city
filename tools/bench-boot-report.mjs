// Shared by tools/bench-boot.mjs. Pure: the raw capture of one visit in, the numbers of the boot table out, and the table (docs/render/load.md "Boot, 2026-11-18").
// A capture holds times in ms from the start of the page: `marks` (firstPaint, bootMenu, menuMounted, bootDone, bootFail), `stages` [[ms, label]] (what the boot
// screen said), `long` [[start, ms]] (main-thread tasks over 50 ms), `links` [[ms, name, defines]] (each `linkProgram`) and `slow` [[ms, ms]] (the `getProgramInfoLog` calls that waited).

/** The stage that shows when the first picture draws (`drawn`, board3d.ts): a program that links from there on was not in the batch (rule 11). */
export const DRAW_STAGE = 'Lighting the room';
/** The span in which the city and the room build (BOOT-05 wants it under 1.5 s cold). */
export const SPAN = ['Building the world', 'Assembling the machine'];
/** A `getProgramInfoLog` call slower than this waited for a link. */
export const SLOW_MS = 4;
/** A main-thread task of this length or more is listed. */
export const LONG_MS = 100;

const sum = (a) => a.reduce((x, y) => x + y, 0);

/** The middle element by `key` (the lower one when the count is even, so it is a run that happened); null when no element has a key. */
export function middle(items, key = (x) => x) {
  const have = items.filter((x) => key(x) !== null && key(x) !== undefined).sort((a, b) => key(a) - key(b));
  return have.length ? have[(have.length - 1) >> 1] : null;
}

/** A time: under 100 ms in ms, under 1 s with two decimals, then one decimal. `-` for no time. */
export function sec(ms) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 100) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`;
}

/** One visit's raw capture as the numbers of the table. A number is null when the visit never got there. */
export function describeVisit(raw) {
  const marks = raw.marks ?? {}, long = raw.long ?? [], links = raw.links ?? [], slow = raw.slow ?? [];
  const seen = new Set(), stages = [];
  for (const [at, label] of raw.stages ?? []) if (!seen.has(label)) { seen.add(label); stages.push({ label, at, took: null }); }
  for (let i = 0; i + 1 < stages.length; i++) stages[i].took = stages[i + 1].at - stages[i].at;
  const start = (label) => stages.find((s) => s.label === label)?.at ?? null;
  /** The stage the screen showed at time `t`. */
  const stageAt = (t) => stages.reduce((name, s) => (s.at <= t ? s.label : name), null);
  const draw = start(DRAW_STAGE), from = start(SPAN[0]), to = start(SPAN[1]);
  const menu = [marks.bootMenu, marks.menuMounted].filter((t) => t !== undefined && t !== null);
  const top = long.reduce((a, l) => (!a || l[1] > a[1] ? l : a), null);
  return {
    firstPaint: marks.firstPaint ?? null,
    menu: menu.length ? Math.max(...menu) : null,
    bootDone: marks.bootDone ?? null,
    failed: marks.bootFail !== undefined,
    span: from !== null && to !== null ? to - from : null,
    slowCalls: slow.length,
    slowMs: sum(slow.map((s) => s[1])),
    programs: links.length,
    /** The programs that linked at or after the first draw; null when the boot never showed `DRAW_STAGE`. */
    late: draw === null ? null : links.filter((l) => l[0] >= draw).map(([at, name, defs]) => ({ at, name, defs })),
    longest: top ? { ms: top[1], at: top[0], stage: stageAt(top[0] + top[1]) } : null,
    long: long.filter((l) => l[1] >= LONG_MS).map(([at, ms]) => ({ at, ms, stage: stageAt(at + ms) })),
    slow: slow.map(([at, ms]) => ({ at, ms, stage: stageAt(at) })),
    stages,
  };
}

/** What is wrong with a visit as a measurement (an empty list: it is good). A table made from a visit that fails any of these would mislead. */
export function problems(d) {
  const out = [];
  if (d.failed) out.push('the boot screen failed (no WebGL, or the 3D world threw)');
  else if (d.bootDone === null) out.push('the boot did not finish');
  if (d.menu === null) out.push('the menu never showed');
  if (d.late === null) out.push(`the boot never showed the stage "${DRAW_STAGE}": the programs after the first draw are not known (a stage was renamed?)`);
  if (d.span === null) out.push(`the boot never showed "${SPAN[0]}" and "${SPAN[1]}": their span is not known (a stage was renamed?)`);
  return out;
}

/** The rows of the table: a label, how to read the number from a visit, and how to show it (`note`: what follows the number, from the visit). */
const ROWS = [
  { label: 'First paint', get: (d) => d.firstPaint },
  { label: 'The menu shows over the screen', get: (d) => d.menu },
  { label: 'Boot done', get: (d) => d.bootDone },
  { label: `${SPAN[0]} to ${SPAN[1]}`, get: (d) => d.span },
  { label: `Slow driver calls (getProgramInfoLog over ${SLOW_MS} ms), total`, get: (d) => d.slowMs, note: (d) => ` (${d.slowCalls} calls)` },
  { label: 'Programs linked', get: (d) => d.programs, count: true },
  { label: 'Programs linked at or after the first draw', get: (d) => d.late?.length ?? null, count: true },
  { label: 'Longest main-thread task', get: (d) => d.longest?.ms ?? null, note: (d) => ` (${d.longest.stage ?? 'before the first stage'})` },
  { label: `Main-thread tasks over ${LONG_MS} ms`, get: (d) => d.long.length, count: true },
];

/** One cell: the middle visit's number, and the lowest and highest when the visits differ. */
function cell(visits, row) {
  const mid = middle(visits, row.get);
  if (!mid) return '-';
  const show = (v) => (row.count ? String(v) : sec(v));
  const all = visits.map(row.get).filter((v) => v !== null);
  const lo = Math.min(...all), hi = Math.max(...all);
  return `${show(row.get(mid))}${row.note ? row.note(mid) : ''}${lo === hi ? '' : ` [${show(lo)} to ${show(hi)}]`}`;
}

/** Cells in columns, as a Markdown table padded for the terminal. The first row is the head. */
export function grid(rows) {
  const width = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  const line = (r) => `| ${r.map((x, c) => x.padEnd(width[c])).join(' | ')} |`;
  return [line(rows[0]), `|${width.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.slice(1).map(line)].join('\n');
}

/** The table of both kinds of visit: `cold` and `warm` are lists of `describeVisit` results, one per run. */
export function table(cold, warm) {
  return grid([['', 'Cold', 'Warm'], ...ROWS.map((row) => [row.label, cell(cold, row), cell(warm, row)])]);
}

/** Each stage with the middle start and the middle time it took, over the visits; in order of start. */
export function stageTable(cold, warm) {
  const pick = (visits) => {
    const by = new Map();
    for (const d of visits) for (const s of d.stages) (by.get(s.label) ?? by.set(s.label, []).get(s.label)).push(s);
    return new Map([...by].map(([label, list]) => [label, { at: middle(list, (s) => s.at).at, took: middle(list, (s) => s.took)?.took ?? null }]));
  };
  const a = pick(cold), b = pick(warm);
  const labels = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (a.get(x)?.at ?? b.get(x).at) - (a.get(y)?.at ?? b.get(y).at));
  const two = (m, label) => (m.has(label) ? [sec(m.get(label).at), sec(m.get(label).took)] : ['-', '-']);
  return grid([['Stage', 'Cold start', 'took', 'Warm start', 'took'], ...labels.map((l) => [l, ...two(a, l), ...two(b, l)])]);
}

/** The lists of the visit in the middle of its kind: the programs after the first draw with their defines, the slow driver calls, the long tasks. */
export function lists(name, visits) {
  const d = middle(visits, (v) => v.bootDone);
  if (!d) return `${name}: no visit finished.`;
  const out = [];
  out.push(d.late === null ? `${name}: programs at or after the first draw: not known.` : d.late.length
    ? `${name}: programs at or after the first draw (${d.late.length}):\n${d.late.map((p) => `  ${sec(p.at).padStart(7)}  ${p.name}  ${p.defs}`).join('\n')}`
    : `${name}: no program linked at or after the first draw.`);
  if (d.slow.length) out.push(`${name}: slow driver calls (start, wait, stage):\n${d.slow.map((s) => `  ${sec(s.at).padStart(7)}  ${sec(s.ms).padStart(6)}  ${s.stage ?? '-'}`).join('\n')}`);
  if (d.long.length) out.push(`${name}: main-thread tasks over ${LONG_MS} ms (start, length, the stage showing at its end):\n${d.long.map((t) => `  ${sec(t.at).padStart(7)}  ${sec(t.ms).padStart(6)}  ${t.stage ?? '-'}`).join('\n')}`);
  return out.join('\n\n');
}
