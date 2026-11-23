// `node tools/loop-seams.mjs`: the loop seams of the audio assets (ticket #67), offline. It plays nothing.
// The loops are the two ambience loops and the 73 music stems (each stem is one loop). Each file is decoded in headless Chrome with
// `decodeAudioData` at MIX.sampleRate, the decoder the engine uses (engine.ts `load`). A stem gets the engine's stitch first
// (music.ts `stitchStem`, read from the source through Vite SSR), so the seam is the one that plays.
// The seam is the wrap: the last sample the loop plays and the first sample it plays again. A file passes when:
//   - the seam step (|last - first|) is at most SEAM_FACTOR (4) times the typical step, the median |sample difference| in the
//     WINDOW (2400 samples, 50 ms) on each side of the seam, the seam pair left out. The floor FLOOR stops a silent file from dividing by 0;
//   - the decoded length is the manifest count (ambience, exact) or at least the padded length 2 x PAD + loop (stems).
// Each stem plays the same wrap on every loop, so one seam per file covers the three loops of a stem. The raw seam (before the stitch)
// is printed as INFO for the stems.
// A stem's stitch sets the last played sample to (almost) the pre-roll sample before the loop start, so its stitched seam tests
// the step into the loop start. The raw column (before the stitch) shows the bake's own wrap.
// This checks the asset's seam, not the engine's playback. It does not prove that no click or gap is heard.
// env: CHROME_PATH (default: the installed Chrome); SEAM_SHIFT (control runs only, e.g. -1000): moves each loop end by that many
// samples, so the wrap is in the wrong place and every file must FAIL. A control that passes means the check cannot fail.
// exit: 0 all files pass; 1 a file fails; 3 setup problem (Chrome, Vite SSR)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEAM_FACTOR = 4;
const WINDOW = 2400;
const FLOOR = 1e-6;
const SHIFT = Number(process.env.SEAM_SHIFT || 0);

// ---- the manifest and the stitch, from the source (TS modules, Vite SSR; no copy of the numbers here) ----
const vite = await createServer({ root: ROOT, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, ws: false } });
let MIX, music, LOOP_IDS;
try {
  ({ MIX } = await vite.ssrLoadModule('/src/app/audio/mixTokens.ts'));
  music = await vite.ssrLoadModule('/src/app/audio/music.ts');
  ({ LOOP_IDS } = await vite.ssrLoadModule('/src/app/audio/ambience.ts'));
} catch (e) {
  console.log('The source did not load through Vite SSR:', e.message);
  await vite.close();
  process.exit(3);
}
await vite.close();
const { PAD, stitchStem, MENU_ID } = music;

// ---- the files: each loop as [start, end) in its decoded buffer, and the length it must have ----
const AUDIO = resolve(ROOT, 'public/audio');
const files = [
  ...LOOP_IDS.map((id) => ({
    name: `ambience/${id}.ogg`, path: resolve(AUDIO, 'ambience', `${id}.ogg`), stitch: false,
    start: 0, end: MIX.ambience[id].samples + SHIFT, minLen: MIX.ambience[id].samples, exact: true,
  })),
  ...readdirSync(resolve(AUDIO, 'music/stems')).filter((f) => f.endsWith('.ogg')).sort().map((f) => {
    const loop = f === `${MENU_ID}.ogg` ? MIX.music.menuLoopSamples : MIX.music.loopSamples;
    return {
      name: `music/stems/${f}`, path: resolve(AUDIO, 'music/stems', f), stitch: true,
      start: PAD, end: PAD + loop + SHIFT, minLen: 2 * PAD + loop, exact: false,
    };
  }),
];

// ---- decode in Chrome: the page returns only the windows around the two seams (the stitch touches nothing else) ----
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) }).catch((e) => {
  console.log('Chrome did not start:', e.message);
  process.exit(3);
});
const rows = [];
let code = 0;
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const f of files) {
    const wins = [[f.start - WINDOW, f.start + WINDOW], [f.end - WINDOW, f.end + WINDOW]];
    const got = await page.evaluate(async ({ b64, rate, wins }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.buffer);
      const channels = [];
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        channels.push(wins.map(([a, b]) => {
          const s = Math.max(0, a), e = Math.min(d.length, b);
          return { start: s, v: Array.from(d.subarray(s, Math.max(s, e))) };
        }));
      }
      return { length: buf.length, rate: buf.sampleRate, channels };
    }, { b64: readFileSync(f.path).toString('base64'), rate: MIX.sampleRate, wins });

    const problems = [];
    if (got.rate !== MIX.sampleRate) problems.push(`rate ${got.rate}`);
    if (f.exact ? got.length !== f.minLen : got.length < f.minLen) problems.push(`length ${got.length} (want ${f.exact ? '=' : '>='} ${f.minLen})`);
    let worst = { ratio: 0, step: 0, typical: 0, raw: 0 };
    if (got.length < f.end) problems.push('decoded shorter than the loop');
    else {
      for (const win of got.channels) {
        const x = new Float32Array(got.length);
        for (const w of win) x.set(w.v, w.start);
        const raw = seamOf(x, f.start, f.end);
        if (f.stitch) stitchStem([x], f.end - f.start);
        const s = seamOf(x, f.start, f.end);
        if (s.ratio > worst.ratio) worst = { ...s, raw: raw.ratio };
      }
      if (worst.ratio > SEAM_FACTOR) problems.push(`seam ${worst.ratio.toFixed(2)} x typical (max ${SEAM_FACTOR})`);
    }
    rows.push({ name: f.name, length: got.length, want: f.minLen, exact: f.exact, ...worst, problems });
  }
} catch (e) {
  code = 1;
  console.log('The decode run failed:', e.message);
} finally {
  await browser.close();
}

/** The seam of one channel: the step at the wrap, the median step either side of it, and their ratio (floored). */
function seamOf(x, s, e) {
  const step = Math.abs(x[e - 1] - x[s]);
  const diffs = new Float64Array(2 * WINDOW - 2);
  let n = 0;
  for (let i = e - WINDOW; i < e - 1; i++) diffs[n++] = Math.abs(x[i + 1] - x[i]);
  for (let i = s; i < s + WINDOW - 1; i++) diffs[n++] = Math.abs(x[i + 1] - x[i]);
  diffs.sort();
  const typical = Math.max(diffs[n >> 1], FLOOR);
  return { step, typical, ratio: step / typical };
}

for (const r of rows) {
  if (r.problems.length) code = 1;
  const len = r.exact ? `len ${r.length} (exact ${r.want})` : `len ${r.length} (>= ${r.want})`;
  const seam = `seam ${r.step.toExponential(2)} typical ${r.typical.toExponential(2)} ratio ${r.ratio.toFixed(2)}`;
  const raw = r.exact ? '' : ` raw ${r.raw.toFixed(2)}`;
  console.log(`${r.problems.length ? 'FAIL' : 'PASS'}  ${r.name}  ${len}  ${seam}${raw}${r.problems.length ? '  ' + r.problems.join('; ') : ''}`);
}
const passed = rows.filter((r) => !r.problems.length).length;
const top = rows.reduce((a, r) => (r.ratio > a.ratio ? r : a), rows[0] ?? { ratio: 0, name: 'none' });
console.log(`${passed}/${rows.length} files pass; SEAM_FACTOR ${SEAM_FACTOR}; WINDOW ${WINDOW} samples; largest ratio ${top.ratio.toFixed(2)} (${top.name})`);
console.log('This checks each asset seam, not the engine playback: no click or gap is heard by this check.');
process.exit(code || (passed === rows.length && rows.length > 0 ? 0 : 1));
