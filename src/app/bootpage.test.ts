// Ticket #32: the boot page (index.html) in the void style. Reads source text only (node, no DOM).
// Written before the code: these fail until the boot page is restyled.
import { assert, describe, expect, it } from 'vitest';

// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'readFileSync' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
const nodeUrl = urlMod;

const fs = fsMod;
const ROOT: string = nodeUrl.fileURLToPath(new URL('../../', import.meta.url));
const html: string = fs.readFileSync(`${ROOT}index.html`, 'utf8');

// The value the spec gives for the void background (docs/pipeline-city-menu-ui/IMPLEMENTATION.md, step 2).
const VOID = '#04060f';

function meta(name: string): string | null {
  const m = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'u').exec(html);
  return m?.[1] ?? null;
}

// The body background: the `background:` declaration of the `html, body` rule in the page's own style block.
function bodyBackground(): string | null {
  const rule = /html,\s*body\s*\{(?<body>[^}]*)\}/u.exec(html);
  if (!rule) {
    return null;
  }
  const bg = /background:\s*(?<colour>#[0-9a-fA-F]{3,8})\b/u.exec(rule[1] ?? '');
  return bg?.[1]?.toLowerCase() ?? null;
}

describe('boot page colours', () => {
  it('theme-color matches the body background', () => {
    const theme = meta('theme-color');
    expect(theme).not.toBeNull();
    expect(bodyBackground()).not.toBeNull();
    assert.exists(theme);
    expect(theme.toLowerCase()).toBe(bodyBackground());
  });

  it('uses the void background from the spec', () => {
    const themeColorMeta = meta('theme-color');
    assert.exists(themeColorMeta);
    expect(themeColorMeta.toLowerCase()).toBe(VOID);
    expect(bodyBackground()).toBe(VOID);
  });
});

describe('boot page type and wordmark', () => {
  it('sets the boot screen in the Plex faces, not system fonts', () => {
    const boot = /#boot\s*\{(?<body>[^}]*)\}/u.exec(html);
    expect(boot).not.toBeNull();
    assert.exists(boot);
    const family = /font-family:\s*(?<family>[^;]+);/u.exec(boot[1] ?? '');
    expect(family, 'font-family on #boot').not.toBeNull();
    assert.exists(family);
    expect(family[1]).toMatch(/Plex/u);
    expect(family[1]).not.toMatch(/system-ui|Segoe UI/u);
  });

  it('keeps the static wordmark: the title is text, with no animation', () => {
    expect(html).toMatch(/<div class="boot-title">Pipeline City<\/div>/u);
    const title = /\.boot-title\s*\{(?<body>[^}]*)\}/u.exec(html);
    expect(title).not.toBeNull();
    assert.exists(title);
    expect(title[1]).not.toMatch(/animation/u);
  });

  it('asks for the cover viewport so the void fills notched screens', () => {
    expect(meta('viewport')).toMatch(/viewport-fit=cover/u);
  });
});
