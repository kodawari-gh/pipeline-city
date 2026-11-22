// Ticket #32: the Plex fonts and the design tokens. Reads source text only (node, no DOM).
// Written before the code: tokens.css and fonts/ do not exist yet, so these fail until they do.
import { describe, expect, it } from 'vitest';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
const fs = fsMod as any;
const ROOT: string = urlMod.fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => fs.readFileSync(`${ROOT}${rel}`, 'utf8');
const exists = (rel: string): boolean => fs.existsSync(`${ROOT}${rel}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const TOKENS = 'src/core/ui/tokens.css';
const FONT_DIR = 'src/core/ui/fonts';
const FACES = [
  { file: 'IBMPlexSansCondensed-SemiBold.woff2', family: 'Plex Cond', weight: '600' },
  { file: 'IBMPlexSans-Regular.woff2', family: 'Plex Sans', weight: '400' },
  { file: 'IBMPlexSans-Medium.woff2', family: 'Plex Sans', weight: '500' },
  { file: 'IBMPlexSans-SemiBold.woff2', family: 'Plex Sans', weight: '600' },
  { file: 'IBMPlexMono-Medium.woff2', family: 'Plex Mono', weight: '500' },
];

function fontFaces(css: string): string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
}

describe('fonts are self-hosted', () => {
  it('ships the five Plex woff2 files and the OFL licence next to them', () => {
    for (const f of FACES) expect(exists(`${FONT_DIR}/${f.file}`), f.file).toBe(true);
    expect(exists(`${FONT_DIR}/LICENSE.txt`)).toBe(true);
    expect(read(`${FONT_DIR}/LICENSE.txt`)).toMatch(/SIL Open Font License/);
  });

  it('declares every face in tokens.css with a relative url, woff2, and font-display: swap', () => {
    const css = read(TOKENS);
    const rules = fontFaces(css);
    expect(rules.length).toBe(FACES.length);
    for (const f of FACES) {
      const rule = rules.find((r) => r.includes(f.file));
      expect(rule, f.file).toBeDefined();
      expect(rule as string).toMatch(new RegExp(`font-family:\\s*'${f.family}'`));
      expect(rule as string).toMatch(new RegExp(`font-weight:\\s*${f.weight}\\b`));
      expect(rule as string).toMatch(/url\('\.\/fonts\/[^']+\.woff2'\)\s*format\('woff2'\)/);
      expect(rule as string).toMatch(/font-display:\s*swap/);
    }
  });

  it('keeps the UI font variables on the Plex families, not the system fonts', () => {
    const ui = read('src/core/ui/ui.css');
    const uiVar = ui.match(/--ui:\s*([^;]+);/);
    const monoVar = ui.match(/--mono:\s*([^;]+);/);
    expect(uiVar, '--ui in ui.css').not.toBeNull();
    expect(monoVar, '--mono in ui.css').not.toBeNull();
    expect(uiVar![1]).toMatch(/'Plex Sans'|'Plex Cond'/);
    expect(uiVar![1]).not.toMatch(/system-ui|Segoe UI/);
    expect(monoVar![1]).toMatch(/'Plex Mono'/);
    expect(monoVar![1]).not.toMatch(/ui-monospace|Cascadia|Consolas/);
  });
});

describe('fonts are preloaded', () => {
  // Condensed 600 and Mono 500 draw the wordmark and every tag (SPEC section 3, IMPLEMENTATION step 2).
  // The preload may sit in index.html (the built, hashed href keeps the base name) or in main.tsx.
  it('preloads Plex Cond 600 and Plex Mono 500 as woff2 fonts', () => {
    const html = read('index.html');
    const main = read('src/app/main.tsx');
    const tags = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    // Attribute order does not matter: each attribute is read on its own.
    const attr = (tag: string, name: string): string | undefined =>
      tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    for (const base of ['IBMPlexSansCondensed-SemiBold', 'IBMPlexMono-Medium']) {
      const inHtml = tags.some((tag) =>
        attr(tag, 'rel') === 'preload'
        && attr(tag, 'as') === 'font'
        && /\scrossorigin\b/.test(tag)
        && (attr(tag, 'href') ?? '').includes(base));
      const inMain = main.includes('preload') && main.includes(base);
      expect(inHtml || inMain, `preload for ${base}`).toBe(true);
    }
  });

  it('gives the preload links crossorigin, as font preloads need', () => {
    const html = read('index.html');
    const links = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]);
    for (const l of links.filter((x) => /as="font"/.test(x))) expect(l).toMatch(/crossorigin/);
  });
});

describe('no CDN', () => {
  const CDN = /fonts\.googleapis|fonts\.gstatic|use\.typekit|cdnjs|cdn\.jsdelivr|unpkg\.com/i;

  it('index.html has no font or CDN URL', () => {
    expect(read('index.html')).not.toMatch(CDN);
  });

  it('no stylesheet or @import in the app pulls a remote font', () => {
    const css = walk(`${ROOT}src`).filter((p) => p.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    for (const p of css) {
      const text = fs.readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(CDN);
      // No remote url() or @import: the only web fonts are the files above.
      expect(text, p).not.toMatch(/@import\s+(url\()?['"]?https?:/);
      expect(text, p).not.toMatch(/url\(\s*['"]?https?:\/\/[^)]*\.(woff2?|ttf|otf)/i);
    }
  });

  it('no app source loads a remote font by URL', () => {
    const ts = walk(`${ROOT}src/app`).concat(walk(`${ROOT}src/core/ui`));
    for (const p of ts) {
      const text = fs.readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(/https?:\/\/[^'"`)\s]*\.(woff2?|ttf|otf)/i);
    }
  });
});
