// Ticket #32: the boot page (index.html) in the void style. Reads source text only (node, no DOM).
// Written before the code: these fail until the boot page is restyled.
import { describe, expect, it } from 'vitest';

// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

const fs = fsMod as any;
const ROOT: string = urlMod.fileURLToPath(new URL('../../', import.meta.url));
const html: string = fs.readFileSync(`${ROOT}index.html`, 'utf8');

// The value the spec gives for the void background (docs/pipeline-city-menu-ui/IMPLEMENTATION.md, step 2).
const VOID = '#04060f';

function meta(name: string): string | null {
  const m = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`).exec(html);
  return m?.[1] ?? null;
}

// The body background: the `background:` declaration of the `html, body` rule in the page's own style block.
function bodyBackground(): string | null {
  const rule = /html,\s*body\s*\{([^}]*)\}/.exec(html);
  if (!rule) return null;
  const bg = /background:\s*(#[0-9a-fA-F]{3,8})\b/.exec(rule[1] ?? '');
  return bg?.[1]?.toLowerCase() ?? null;
}

describe('boot page colours', () => {
  it('theme-color matches the body background', () => {
    const theme = meta('theme-color');
    expect(theme).not.toBeNull();
    expect(bodyBackground()).not.toBeNull();
    expect(theme!.toLowerCase()).toBe(bodyBackground());
  });

  it('uses the void background from the spec', () => {
    expect(meta('theme-color')!.toLowerCase()).toBe(VOID);
    expect(bodyBackground()).toBe(VOID);
  });
});

describe('boot page type and wordmark', () => {
  it('sets the boot screen in the Plex faces, not system fonts', () => {
    const boot = /#boot\s*\{([^}]*)\}/.exec(html);
    expect(boot).not.toBeNull();
    const family = /font-family:\s*([^;]+);/.exec(boot![1] ?? '');
    expect(family, 'font-family on #boot').not.toBeNull();
    expect(family![1]).toMatch(/Plex/);
    expect(family![1]).not.toMatch(/system-ui|Segoe UI/);
  });

  it('keeps the static wordmark: the title is text, with no animation', () => {
    expect(html).toMatch(/<div class="boot-title">Pipeline City<\/div>/);
    const title = /\.boot-title\s*\{([^}]*)\}/.exec(html);
    expect(title).not.toBeNull();
    expect(title![1]).not.toMatch(/animation/);
  });

  it('asks for the cover viewport so the void fills notched screens', () => {
    expect(meta('viewport')).toMatch(/viewport-fit=cover/);
  });
});
