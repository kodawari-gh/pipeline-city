/** Characters per page: about two lines of the dialogue box. */
export const PAGE_CHARS = 120;

/** Typewriter speed, ms per character. */
export const CHAR_MS = 24;

/**
 * Split a step's text into dialogue pages: whole sentences, packed up to `max` characters. A single long sentence
 * stays one page (the box grows rather than cutting a sentence in two).
 */
export function pagesOf(text: string, max = PAGE_CHARS): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  const pages: string[] = [];
  for (const s of sentences) {
    const last = pages[pages.length - 1];
    if (last !== undefined && last.length + 1 + s.length <= max) pages[pages.length - 1] = `${last} ${s}`;
    else pages.push(s);
  }
  return pages.length ? pages : [text];
}
